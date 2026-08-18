import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "../server/crypto.mjs";
import { JsonStore, publicConnection } from "../server/store.mjs";
import { invokeImageModel, invokeModel, testProvider } from "../server/adapters.mjs";
import { aggregateModelResults, buildBlindComparisons, heuristicScore, newEvaluation, normalizeRubric } from "../server/evaluator.mjs";

test("AES-256-GCM encrypts, decrypts, and rejects tampering", () => {
  const key = randomBytes(32);
  const encrypted = encryptSecret("test-secret-value", key);
  assert.equal(decryptSecret(encrypted, key), "test-secret-value");
  encrypted.ciphertext = `${encrypted.ciphertext.slice(0, -2)}AA`;
  assert.throws(() => decryptSecret(encrypted, key));
});

test("JSON store persists atomically and public connections redact secrets", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "evalhub-store-"));
  const file = path.join(directory, "state.json");
  const store = await new JsonStore(file).init();
  assert.deepEqual(store.snapshot().connections, []);
  assert.deepEqual(store.snapshot().datasets, []);
  assert.deepEqual(store.snapshot().evaluations, []);
  const encryptedApiKey = encryptSecret("example-credential-placeholder", randomBytes(32));
  await store.mutate((state) => state.connections.push({ id: "private", name: "Private", provider: "openai", baseUrl: "https://example.test", encryptedApiKey, keySuffix: "-use", models: ["test"] }));
  const disk = JSON.parse(await readFile(file, "utf8"));
  assert.equal(disk.connections.at(-1).encryptedApiKey.algorithm, "aes-256-gcm");
  const safe = publicConnection(disk.connections.at(-1));
  assert.equal(safe.encryptedApiKey, undefined);
  assert.equal(safe.hasApiKey, true);
  assert.equal(JSON.stringify(safe).includes("example-credential-placeholder"), false);
});

test("version 3 state migrates existing connections and evaluations to text models", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "evalhub-migrate-"));
  const file = path.join(directory, "state.json");
  await writeFile(file, JSON.stringify({ version: 3, settings: {}, connections: [{ id: "legacy", provider: "mock", models: ["mock-balanced"] }], datasets: [], evaluations: [{ id: "legacy-run", models: [], results: [] }] }), "utf8");
  const store = await new JsonStore(file).init();
  assert.equal(store.snapshot().version, 4);
  assert.equal(store.snapshot().connections[0].modelType, "text");
  assert.equal(store.snapshot().evaluations[0].modelType, "text");
});

test("mock adapter supports discovery and deterministic invocation", async () => {
  const connection = { provider: "mock", models: ["mock-safe"] };
  assert.deepEqual(await testProvider(connection, ""), { ok: true, models: ["mock-safe"] });
  const output = await invokeModel({ connection, apiKey: "", model: "mock-safe", input: "请提供手机号敏感信息", systemPrompt: "", maxTokens: 100 });
  assert.match(output.text, /无法提供/);
  assert.ok(output.latencyMs >= 0);
});

test("mock image adapter returns a durable image artifact", async () => {
  const connection = { provider: "mock", modelType: "image", models: ["mock-image-art", "mock-image-fast"] };
  const output = await invokeImageModel({ connection, apiKey: "", model: "mock-image-art", prompt: "一只在月球上的鲸鱼", size: "1024x1024", seed: 7 });
  assert.match(output.imageUrl, /^data:image\/svg\+xml/);
  assert.equal(output.mimeType, "image/svg+xml");
  assert.match(output.revisedPrompt, /鲸鱼/);
  assert.equal(decodeURIComponent(output.imageUrl).includes("mock-image-art"), false);
  const edited = await invokeImageModel({ connection, apiKey: "", model: "mock-image-fast", prompt: "把背景改成夜晚", referenceImage: "data:image/png;base64,iVBORw0KGgo=", size: "1024x1024" });
  assert.match(edited.imageUrl, /^data:image\/svg\+xml/);
  assert.equal(edited.revisedPrompt, "把背景改成夜晚");
});

test("OpenAI-compatible image editing sends reference image and text as multipart input", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(url, "https://images.example.test/v1/images/edits");
    assert.equal(options.method, "POST");
    assert.ok(options.body instanceof FormData);
    assert.equal(options.body.get("model"), "image-edit-model");
    assert.equal(options.body.get("prompt"), "把背景改成夜晚");
    assert.ok(options.body.get("image") instanceof Blob);
    return new Response(JSON.stringify({ data: [{ b64_json: "aGVsbG8=" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const output = await invokeImageModel({ connection: { provider: "compatible", baseUrl: "https://images.example.test/v1" }, apiKey: "placeholder-key", model: "image-edit-model", prompt: "把背景改成夜晚", referenceImage: "data:image/png;base64,iVBORw0KGgo=" });
    assert.match(output.imageUrl, /^data:image\/png;base64,/);
  } finally { globalThis.fetch = originalFetch; }
});

test("heuristic scoring handles hits, missing rubrics, and errors", () => {
  assert.equal(heuristicScore({ text: "这是退款规则的完整说明内容，足够长以得到完整性分数。" }, { expectedKeywords: ["退款", "规则"] }).score, 10);
  assert.equal(heuristicScore({ text: "任意回答" }, { expectedKeywords: [] }).score, null);
  assert.equal(heuristicScore({ text: "", error: "timeout" }, { expectedKeywords: ["规则"] }).score, 0);
});

test("fair baseline overrides per-model parameters while optimized mode preserves them", () => {
  const dataset = { id: "dataset", name: "Dataset", cases: [{ id: "TC-1", input: "test" }] };
  const models = [
    { connectionId: "a", model: "model-a", temperature: 1.7, maxTokens: 200, systemPrompt: "custom-a" },
    { connectionId: "b", model: "model-b", temperature: 0.1, maxTokens: 900, systemPrompt: "custom-b" },
  ];
  const baseline = newEvaluation({ datasetId: dataset.id, models, comparisonMode: "baseline", repeatCount: 4, temperature: 0.3, maxTokens: 500, systemPrompt: "shared" }, dataset);
  assert.equal(baseline.repeatCount, 4);
  assert.equal(baseline.totalRuns, 8);
  assert.deepEqual(baseline.models.map((item) => [item.temperature, item.maxTokens, item.systemPrompt]), [[0.3, 500, "shared"], [0.3, 500, "shared"]]);
  const optimized = newEvaluation({ datasetId: dataset.id, models, comparisonMode: "optimized", repeatCount: 3 }, dataset);
  assert.deepEqual(optimized.models.map((item) => item.temperature), [1.7, 0.1]);
});

test("image evaluations snapshot generation parameters and per-image pricing", () => {
  const dataset = { id: "dataset", name: "Image prompts", cases: [{ id: "IMG-1", input: "editorial portrait" }] };
  const models = [
    { connectionId: "a", model: "image-a", size: "1536x1024", quality: "high", style: "vivid", negativePrompt: "watermark", pricePerImage: .04 },
    { connectionId: "b", model: "image-b", size: "1024x1536", quality: "low", pricePerImage: .02 },
  ];
  const baseline = newEvaluation({ modelType: "image", datasetId: dataset.id, models, size: "1024x1024", quality: "standard", negativePrompt: "blur", repeatCount: 3 }, dataset);
  assert.equal(baseline.modelType, "image");
  assert.deepEqual(baseline.models.map((item) => [item.modelType, item.size, item.quality, item.negativePrompt]), [["image", "1024x1024", "standard", "blur"], ["image", "1024x1024", "standard", "blur"]]);
  assert.deepEqual(baseline.models.map((item) => item.pricePerImage), [.04, .02]);

  const referenceImage = "data:image/png;base64,iVBORw0KGgo=";
  const imageToImage = newEvaluation({ modelType: "image", imageMode: "image-to-image", imageInstruction: "把背景改成夜晚", referenceImage, models, repeatCount: 3 }, null);
  assert.equal(imageToImage.imageMode, "image-to-image");
  assert.equal(imageToImage.datasetId, null);
  assert.equal(imageToImage.datasetName, "即时图生图输入");
  assert.deepEqual(imageToImage.cases, [{ id: "IMG-001", input: "把背景改成夜晚", referenceImage }]);
  assert.equal(imageToImage.totalRuns, 6);
});

test("multi-dimensional rubrics normalize weights and model summaries expose stability", () => {
  const rubric = normalizeRubric({ criteria: [{ id: "a", name: "准确", weight: 3 }, { id: "b", name: "安全", weight: 1, evaluator: "human" }] });
  assert.equal(rubric.criteria[0].normalizedWeight, 0.75);
  assert.equal(rubric.criteria[1].normalizedWeight, 0.25);
  const evaluation = { models: [{ key: "model-a", model: "A" }], results: [
    { caseId: "TC-1", modelKey: "model-a", assessment: { score: 8 }, latencyMs: 100, cost: .01 },
    { caseId: "TC-1", modelKey: "model-a", assessment: { score: 10 }, latencyMs: 300, cost: .01 },
    { caseId: "TC-2", modelKey: "model-a", assessment: { score: 9 }, latencyMs: 200, cost: .01 },
  ] };
  const [summary] = aggregateModelResults(evaluation);
  assert.equal(summary.quality, 9);
  assert.equal(summary.minimumScore, 8);
  assert.equal(summary.scoreStdDev, 0.816);
  assert.equal(summary.p95LatencyMs, 300);
  assert.equal(summary.costPerCase, 0.015);
});

test("blind comparisons cover every case, repeat, and model pair", () => {
  const dataset = { cases: [{ id: "TC-1" }, { id: "TC-2" }] };
  const evaluation = { repeatCount: 3, models: [{ key: "a" }, { key: "b" }, { key: "c" }], results: [] };
  for (const testCase of dataset.cases) for (let attempt = 1; attempt <= 3; attempt += 1) for (const model of evaluation.models) evaluation.results.push({ id: `${testCase.id}-${attempt}-${model.key}`, caseId: testCase.id, attempt, modelKey: model.key });
  const comparisons = buildBlindComparisons(evaluation, dataset);
  assert.equal(comparisons.length, 2 * 3 * 3);
  assert.ok(comparisons.every((item) => item.leftModelKey !== item.rightModelKey && item.verdict === null));
});

test("corrupted JSON state fails visibly instead of overwriting data", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "evalhub-corrupt-"));
  const file = path.join(directory, "state.json");
  await writeFile(file, "{invalid", "utf8");
  await assert.rejects(() => new JsonStore(file).init());
});

test("a rejected mutation does not poison later writes", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "evalhub-queue-"));
  const store = await new JsonStore(path.join(directory, "state.json")).init();
  await assert.rejects(() => store.mutate(() => { throw new Error("expected rejection"); }));
  await store.mutate((state) => { state.version = 2; });
  assert.equal(store.snapshot().version, 2);
});
