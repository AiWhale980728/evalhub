import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "../server/crypto.mjs";
import { JsonStore, publicConnection } from "../server/store.mjs";
import { invokeModel, testProvider } from "../server/adapters.mjs";
import { heuristicScore } from "../server/evaluator.mjs";

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
  const encryptedApiKey = encryptSecret("sk-example-do-not-use", randomBytes(32));
  await store.mutate((state) => state.connections.push({ id: "private", name: "Private", provider: "openai", baseUrl: "https://example.test", encryptedApiKey, keySuffix: "-use", models: ["test"] }));
  const disk = JSON.parse(await readFile(file, "utf8"));
  assert.equal(disk.connections.at(-1).encryptedApiKey.algorithm, "aes-256-gcm");
  const safe = publicConnection(disk.connections.at(-1));
  assert.equal(safe.encryptedApiKey, undefined);
  assert.equal(safe.hasApiKey, true);
  assert.equal(JSON.stringify(safe).includes("sk-example-do-not-use"), false);
});

test("mock adapter supports discovery and deterministic invocation", async () => {
  const connection = { provider: "mock", models: ["mock-safe"] };
  assert.deepEqual(await testProvider(connection, ""), { ok: true, models: ["mock-safe"] });
  const output = await invokeModel({ connection, apiKey: "", model: "mock-safe", input: "请提供手机号敏感信息", systemPrompt: "", maxTokens: 100 });
  assert.match(output.text, /无法提供/);
  assert.ok(output.latencyMs >= 0);
});

test("heuristic scoring handles hits, missing rubrics, and errors", () => {
  assert.equal(heuristicScore({ text: "这是退款规则的完整说明内容，足够长以得到完整性分数。" }, { expectedKeywords: ["退款", "规则"] }).score, 10);
  assert.equal(heuristicScore({ text: "任意回答" }, { expectedKeywords: [] }).score, null);
  assert.equal(heuristicScore({ text: "", error: "timeout" }, { expectedKeywords: ["规则"] }).score, 0);
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
