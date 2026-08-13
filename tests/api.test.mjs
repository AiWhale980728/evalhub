import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { JsonStore } from "../server/store.mjs";
import { createApp } from "../server/app.mjs";

async function fixture() {
  const directory = await mkdtemp(path.join(tmpdir(), "evalhub-api-"));
  const staticDir = path.join(directory, "dist");
  await mkdir(staticDir);
  await writeFile(path.join(staticDir, "index.html"), "<h1>EvalHub test</h1>");
  await writeFile(path.join(staticDir, "asset.js"), "export default true");
  const store = await new JsonStore(path.join(directory, "state.json")).init();
  const server = createApp({ store, key: randomBytes(32), staticDir });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
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
  const created = await json(await fetch(`${baseUrl}/api/connections`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Example", provider: "openai", baseUrl: "https://example.test/v1", apiKey: "sk-test-secret-value", models: ["model-a"] }) }));
  assert.equal(created.keySuffix, "alue");
  assert.equal(JSON.stringify(created).includes("sk-test-secret-value"), false);
  const stateResponse = await fetch(`${baseUrl}/api/state`);
  const stateText = await stateResponse.text();
  assert.equal(stateText.includes("encryptedApiKey"), false);
  assert.equal(stateText.includes("sk-test-secret-value"), false);
  const blocked = await fetch(`${baseUrl}/api/datasets`, { method: "POST", headers: { "content-type": "application/json", origin: "https://attacker.test" }, body: "{}" });
  assert.equal(blocked.status, 403);
});

test("API validates 2–8 models and completes mock evaluation, review, and CSV export", async (t) => {
  const { server, baseUrl } = await fixture(); t.after(() => server.close());
  const state = await json(await fetch(`${baseUrl}/api/state`));
  const basePayload = { name: "Lifecycle", datasetId: state.datasets[0].id, models: [], concurrency: 8 };
  for (const count of [1, 9]) {
    const response = await fetch(`${baseUrl}/api/evaluations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...basePayload, models: Array.from({ length: count }, (_, index) => ({ connectionId: "connection-mock", model: `mock-${index}` })) }) });
    assert.equal(response.status, 400);
  }
  const created = await json(await fetch(`${baseUrl}/api/evaluations`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...basePayload, models: [{ connectionId: "connection-mock", model: "mock-balanced", key: "balanced" }, { connectionId: "connection-mock", model: "mock-safe", key: "safe" }] }) }));
  const completed = await waitForEvaluation(baseUrl, created.id);
  assert.equal(completed.status, "completed");
  assert.equal(completed.results.length, state.datasets[0].cases.length * 2);
  const first = completed.results[0];
  const review = await json(await fetch(`${baseUrl}/api/evaluations/${created.id}/reviews`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ caseId: first.caseId, modelKey: first.modelKey, verdict: "approved", score: 9.2, notes: "human verified" }) }));
  assert.equal(review.score, 9.2);
  const refreshed = await json(await fetch(`${baseUrl}/api/evaluations/${created.id}`));
  assert.equal(refreshed.reviews.length, 1);
  const report = await fetch(`${baseUrl}/api/evaluations/${created.id}/report.csv`);
  assert.equal(report.status, 200);
  assert.match(report.headers.get("content-type"), /text\/csv/);
  assert.match(await report.text(), /case_id,model,score/);
  const deletion = await fetch(`${baseUrl}/api/connections/connection-mock`, { method: "DELETE" });
  assert.equal(deletion.status, 409);
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
