import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { JsonStore } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";

async function fixture({ demo = false } = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "evalhub-api-"));
  const staticDir = path.join(directory, "dist");
  await mkdir(staticDir);
  await writeFile(path.join(staticDir, "index.html"), "<h1>EvalHub test</h1>");
  await writeFile(path.join(staticDir, "asset.js"), "export default true");
  const store = await new JsonStore(path.join(directory, "state.json")).init();
  const server = createApp({ store, key: randomBytes(32), staticDir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  if (demo) await json(await fetch(`${baseUrl}/api/demo`, { method: "POST" }));
  return { directory, store, server, baseUrl };
}

async function json(response) {
  const body = await response.json();
  if (!response.ok) throw Object.assign(new Error(body.error), { status: response.status });
  return body;
}

async function waitForEvaluation(baseUrl, id) {
  for (let index = 0; index < 80; index += 1) {
    const evaluation = await json(await fetch(`${baseUrl}/api/evaluations/${id}`));
    if (!["queued", "running"].includes(evaluation.status)) return evaluation;
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  throw new Error("evaluation timeout");
}

test("API provides health, redacts keys, and rejects cross-origin writes", async (t) => {
  const { server, baseUrl } = await fixture(); t.after(() => server.close());
  assert.equal((await json(await fetch(`${baseUrl}/api/health`))).ok, true);
  const created = await json(await fetch(`${baseUrl}/api/connections`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Example", provider: "openai", baseUrl: "https://example.test/v1", apiKey: "example-credential-placeholder", models: ["model-a"] }) }));
  assert.equal(created.keySuffix, "lder");
  assert.equal(JSON.stringify(created).includes("example-credential-placeholder"), false);
  const stateResponse = await fetch(`${baseUrl}/api/state`);
  const stateText = await stateResponse.text();
  assert.equal(stateText.includes("encryptedApiKey"), false);
  assert.equal(stateText.includes("sk-test-secret-value"), false);
  const blocked = await fetch(`${baseUrl}/api/datasets`, { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.test" }, body: "{}" });
  assert.equal(blocked.status, 403);
});

test("fresh installs are empty and optional demo assets load idempotently", async (t) => {
  const { server, baseUrl } = await fixture(); t.after(() => server.close());
  let state = await json(await fetch(`${baseUrl}/api/state`));
  assert.deepEqual(state.connections, []);
  assert.deepEqual(state.datasets, []);
  assert.deepEqual(state.evaluations, []);

  const first = await json(await fetch(`${baseUrl}/api/demo`, { method: "POST" }));
  const second = await json(await fetch(`${baseUrl}/api/demo`, { method: "POST" }));
  assert.deepEqual(second, first);
  state = await json(await fetch(`${baseUrl}/api/state`));
  assert.equal(state.connections.length, 1);
  assert.equal(state.connections[0].id, "connection-mock");
  assert.equal(state.datasets.length, 1);
  assert.equal(state.datasets[0].id, "dataset-demo-rag");
  assert.equal(state.evaluations.length, 0);

  assert.equal((await fetch(`${baseUrl}/api/datasets/dataset-demo-rag`, { method: "DELETE" })).status, 204);
  assert.equal((await fetch(`${baseUrl}/api/connections/connection-mock`, { method: "DELETE" })).status, 204);
  state = await json(await fetch(`${baseUrl}/api/state`));
  assert.deepEqual(state.connections, []);
  assert.deepEqual(state.datasets, []);
  assert.deepEqual(state.evaluations, []);
});

test("API validates 2–8 models and completes mock evaluation, review, and CSV export", async (t) => {
  const { server, baseUrl } = await fixture({ demo: true }); t.after(() => server.close());
  const state = await json(await fetch(`${baseUrl}/api/state`));
  const basePayload = { name: "Lifecycle", datasetId: state.datasets[0].id, models: [], concurrency: 8 };
  for (const count of [1, 9]) {
    const response = await fetch(`${baseUrl}/api/evaluations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...basePayload, models: Array.from({ length: count }, (_, index) => ({ connectionId: "connection-mock", model: `mock-${index}` })) }) });
    assert.equal(response.status, 400);
  }
  const invalidRepeat = await fetch(`${baseUrl}/api/evaluations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...basePayload, repeatCount: 2, models: [{ connectionId: "connection-mock", model: "mock-balanced" }, { connectionId: "connection-mock", model: "mock-safe" }] }) });
  assert.equal(invalidRepeat.status, 400);
  const created = await json(await fetch(`${baseUrl}/api/evaluations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...basePayload, comparisonMode: "optimized", repeatCount: 3, rubric: { criteria: [{ id: "accuracy", name: "准确性", description: "覆盖关键词", weight: 70 }, { id: "safety", name: "安全性", description: "不泄露隐私", weight: 30 }] }, models: [{ connectionId: "connection-mock", model: "mock-balanced", key: "balanced", temperature: 0.1, maxTokens: 321, topP: 0.8, seed: 42, stopSequences: "END|###" }, { connectionId: "connection-mock", model: "mock-safe", key: "safe", temperature: 1.2, maxTokens: 654, topK: 20 }] }) }));
  assert.equal(created.models[0].temperature, 0.1);
  assert.equal(created.models[1].temperature, 1.2);
  assert.deepEqual(created.models[0].stopSequences, ["END", "###"]);
  const completed = await waitForEvaluation(baseUrl, created.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.results.length, state.datasets[0].cases.length * 2 * 3);
  assert.ok(completed.results.every((item) => [1, 2, 3].includes(item.attempt)));
  assert.equal(completed.results[0].assessment.dimensions.length, 2);
  assert.equal(completed.blindComparisons.length, state.datasets[0].cases.length * 3);
  assert.equal(completed.modelSummaries.length, 2);
  const first = completed.results[0];
  const review = await json(await fetch(`${baseUrl}/api/evaluations/${created.id}/reviews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ resultId: first.id, caseId: first.caseId, modelKey: first.modelKey, attempt: first.attempt, verdict: "approved", score: 9.2, notes: "human verified" }) }));
  assert.equal(review.score, 9.2);
  const refreshed = await json(await fetch(`${baseUrl}/api/evaluations/${created.id}`));
  assert.equal(refreshed.reviews.length, 1);
  const duel = refreshed.blindComparisons[0];
  const voted = await json(await fetch(`${baseUrl}/api/evaluations/${created.id}/blind-comparisons/${duel.id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ verdict: "left" }) }));
  assert.equal(voted.verdict, "left");
  const report = await fetch(`${baseUrl}/api/evaluations/${created.id}/report.csv`);
  assert.equal(report.status, 200);
  assert.match(report.headers.get("content-type"), /text\/csv/);
  assert.match(await report.text(), /case_id,attempt,model,score,dimension_scores/);
  const deletion = await fetch(`${baseUrl}/api/connections/connection-mock`, { method: "DELETE" });
  assert.equal(deletion.status, 409);
});

test("dataset editing, settings, and completed-task deletion are persistent", async (t) => {
  const { server, baseUrl } = await fixture({ demo: true }); t.after(() => server.close());
  let state = await json(await fetch(`${baseUrl}/api/state`));
  assert.equal(state.settings.passScore, 8);
  const settings = await json(await fetch(`${baseUrl}/api/settings`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ defaultConcurrency: 7, defaultTimeoutMs: 45000, passScore: 8.5, reviewScore: 6, retentionDays: 120 }) }));
  assert.equal(settings.defaultConcurrency, 7);
  const dataset = state.datasets[0];
  const updated = await json(await fetch(`${baseUrl}/api/datasets/${dataset.id}`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...dataset, cases: [...dataset.cases, { id: "TC-999", input: "新增用例", expectedKeywords: ["新增"], tags: ["测试"] }] }) }));
  assert.equal(updated.cases.at(-1).id, "TC-999");
  const run = await json(await fetch(`${baseUrl}/api/evaluations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Disposable", datasetId: dataset.id, models: [{ connectionId: "connection-mock", model: "mock-balanced" }, { connectionId: "connection-mock", model: "mock-safe" }] }) }));
  await waitForEvaluation(baseUrl, run.id);
  assert.equal((await fetch(`${baseUrl}/api/evaluations/${run.id}`, { method: "DELETE" })).status, 204);
  state = await json(await fetch(`${baseUrl}/api/state`));
  assert.equal(state.evaluations.some((item) => item.id === run.id), false);
  assert.equal(state.settings.retentionDays, 120);
});

test("production static server handles assets, SPA fallback, and traversal safely", async (t) => {
  const { server, baseUrl } = await fixture(); t.after(() => server.close());
  assert.match(await (await fetch(`${baseUrl}/asset.js`)).text(), /export default/);
  assert.match(await (await fetch(`${baseUrl}/evaluation/history`, { headers: { accept: "text/html" } })).text(), /EvalHub test/);
  assert.equal((await fetch(`${baseUrl}/missing.js`)).status, 404);
  const rawStatus = await new Promise((resolve, reject) => {
    const port = server.address().port;
    const req = httpRequest({ host: "127.0.0.1", port, path: "/%2e%2e%2fsecret.txt", headers: { accept: "text/plain" } }, (response) => { response.resume(); resolve(response.statusCode); });
    req.on("error", reject); req.end();
  });
  assert.equal(rawStatus, 400);
});
