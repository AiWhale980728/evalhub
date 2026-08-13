import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { encryptSecret } from "./crypto.mjs";
import { publicConnection } from "./store.mjs";
import { testProvider } from "./adapters.mjs";
import { createEvaluationRunner, newEvaluation } from "./evaluator.mjs";

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };
const now = () => new Date().toISOString();

function safeMessage(error) {
  const message = String(error?.message || "服务器错误");
  return message
    .replace(/(api[_-]?key|authorization|token)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2[REDACTED]")
    .replace(/([?&](?:key|api_key)=)[^&\s]+/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi, "$1[REDACTED]");
}

function send(res, status, body, headers = {}) {
  if (status === 204) { res.writeHead(204, headers); return res.end(); }
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain; charset=utf-8" : "application/json; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'", "cross-origin-resource-policy": "same-origin", "permissions-policy": "camera=(), microphone=(), geolocation=()", "x-content-type-options": "nosniff", "x-frame-options": "DENY", "referrer-policy": "no-referrer", ...headers });
  res.end(payload);
}

async function readJson(req, maxBytes = 10 * 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > maxBytes) throw Object.assign(new Error("请求体过大"), { statusCode: 413 }); chunks.push(chunk); }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw Object.assign(new Error("JSON 格式无效"), { statusCode: 400 }); }
}
function required(value, name) { if (!value || (Array.isArray(value) && !value.length)) throw Object.assign(new Error(`${name}不能为空`), { statusCode: 400 }); }
function csv(value) { let text = String(value ?? ""); if (/^[=+\-@]/.test(text)) text = `'${text}`; return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text; }
function reportCsv(evaluation) { const lines = [["case_id", "model", "score", "method", "human_verdict", "human_score", "human_notes", "latency_ms", "input_tokens", "output_tokens", "cost", "error", "output"]]; for (const result of evaluation.results) { const review = evaluation.reviews.find((item) => item.caseId === result.caseId && item.modelKey === result.modelKey); lines.push([result.caseId, result.model, result.assessment?.score ?? "", result.assessment?.method || "", review?.verdict || "", review?.score ?? "", review?.notes || "", result.latencyMs, result.inputTokens, result.outputTokens, result.cost, result.error || "", result.text]); } return `${lines.map((row) => row.map(csv).join(",")).join("\n")}\n`; }

function assertSameOrigin(req) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return;
  const origin = req.headers.origin;
  const host = req.headers.host;
  if (!origin || !host) return;
  let originHost;
  try { originHost = new URL(origin).host; } catch { throw Object.assign(new Error("请求来源无效"), { statusCode: 403 }); }
  if (originHost !== host) throw Object.assign(new Error("拒绝跨站写入请求"), { statusCode: 403 });
}

async function serveStatic(req, res, url, staticDir) {
  if (!staticDir || !["GET", "HEAD"].includes(req.method)) return send(res, 404, "Not found");
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { return send(res, 400, "Bad path"); }
  if (pathname.includes("\0") || pathname.split("/").includes("..")) return send(res, 400, "Bad path");
  const root = path.resolve(staticDir);
  let filePath = path.resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) return send(res, 400, "Bad path");
  try { if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, "index.html"); }
  catch {
    const acceptsHtml = req.headers.accept?.includes("text/html");
    if (!acceptsHtml) return send(res, 404, "Not found");
    filePath = path.join(root, "index.html");
  }
  const data = await readFile(filePath);
  const headers = { "content-type": MIME[path.extname(filePath)] || "application/octet-stream", "cache-control": path.basename(filePath) === "index.html" ? "no-cache" : "public, max-age=31536000, immutable" };
  if (req.method === "HEAD") return send(res, 200, "", { ...headers, "content-length": data.byteLength });
  return send(res, 200, data, headers);
}

export function createApp({ store, key, staticDir }) {
  const runner = createEvaluationRunner({ store, key });
  return createServer(async (req, res) => {
    const url = new URL(req.url, "http://localhost"); const segments = url.pathname.split("/").filter(Boolean);
    try {
      assertSameOrigin(req);
      if (req.method === "OPTIONS") return send(res, 204, "");
      if (url.pathname === "/api/health") return send(res, 200, { ok: true, version: "0.1.0", storage: "local" });
      if (url.pathname === "/api/state" && req.method === "GET") { const state = store.snapshot(); return send(res, 200, { connections: state.connections.map(publicConnection), datasets: state.datasets, evaluations: state.evaluations }); }
      if (url.pathname === "/api/connections" && req.method === "GET") return send(res, 200, store.snapshot().connections.map(publicConnection));
      if (url.pathname === "/api/connections/test" && req.method === "POST") { const body = await readJson(req); required(body.provider, "厂商"); required(body.baseUrl, "Base URL"); return send(res, 200, await testProvider(body, body.apiKey || "")); }
      if (url.pathname === "/api/connections" && req.method === "POST") {
        const body = await readJson(req); required(body.name, "连接名称"); required(body.provider, "厂商"); required(body.baseUrl, "Base URL"); required(body.models, "模型列表"); if (body.provider !== "mock") required(body.apiKey, "API Key");
        const connection = { id: randomUUID(), name: body.name.trim(), provider: body.provider, baseUrl: body.baseUrl.trim(), encryptedApiKey: encryptSecret(body.apiKey || "", key), keySuffix: body.apiKey ? body.apiKey.slice(-4) : null, models: [...new Set(body.models.map((item) => String(item).trim()).filter(Boolean))], createdAt: now(), updatedAt: now() };
        await store.mutate((state) => state.connections.push(connection)); return send(res, 201, publicConnection(connection));
      }
      if (segments[0] === "api" && segments[1] === "connections" && segments[2] && req.method === "DELETE") {
        await store.mutate((state) => {
          const referenced = state.evaluations.some((evaluation) => evaluation.models.some((model) => model.connectionId === segments[2]) || evaluation.judge?.connectionId === segments[2]);
          if (referenced) throw Object.assign(new Error("该连接已被评测历史引用，不能删除"), { statusCode: 409 });
          state.connections = state.connections.filter((item) => item.id !== segments[2]);
        });
        return send(res, 204, "");
      }
      if (url.pathname === "/api/datasets" && req.method === "POST") {
        const body = await readJson(req); required(body.name, "数据集名称"); required(body.cases, "测试用例");
        const dataset = { id: randomUUID(), name: body.name.trim(), description: body.description || "", cases: body.cases.map((item, index) => ({ id: item.id || `TC-${String(index + 1).padStart(3, "0")}`, input: String(item.input || item.prompt || ""), expectedKeywords: item.expectedKeywords || [], tags: item.tags || [] })).filter((item) => item.input), createdAt: now(), updatedAt: now() };
        required(dataset.cases, "有效测试用例"); await store.mutate((state) => state.datasets.push(dataset)); return send(res, 201, dataset);
      }
      if (url.pathname === "/api/evaluations" && req.method === "POST") {
        const body = await readJson(req); required(body.datasetId, "数据集"); required(body.models, "待测模型"); if (body.models.length < 2 || body.models.length > 8) throw Object.assign(new Error("每次请选择 2–8 个模型"), { statusCode: 400 });
        const state = store.snapshot(); const dataset = state.datasets.find((item) => item.id === body.datasetId); if (!dataset) throw Object.assign(new Error("数据集不存在"), { statusCode: 404 });
        for (const model of body.models) { const connection = state.connections.find((item) => item.id === model.connectionId); if (!connection || !connection.models.includes(model.model)) throw Object.assign(new Error(`模型不可用：${model.model}`), { statusCode: 400 }); }
        const evaluation = newEvaluation(body, dataset); await store.mutate((live) => live.evaluations.unshift(evaluation)); setImmediate(() => runner(evaluation.id).catch(async (error) => store.mutate((live) => { const current = live.evaluations.find((item) => item.id === evaluation.id); current.status = "failed"; current.error = error.message; current.completedAt = now(); }))); return send(res, 202, evaluation);
      }
      if (segments[0] === "api" && segments[1] === "evaluations" && segments[2] && segments.length === 3 && req.method === "GET") { const evaluation = store.snapshot().evaluations.find((item) => item.id === segments[2]); return evaluation ? send(res, 200, evaluation) : send(res, 404, { error: "评测不存在" }); }
      if (segments[0] === "api" && segments[1] === "evaluations" && segments[2] && segments[3] === "reviews" && req.method === "POST") {
        const body = await readJson(req); required(body.caseId, "测试用例"); required(body.modelKey, "模型"); const review = { id: randomUUID(), caseId: body.caseId, modelKey: body.modelKey, verdict: body.verdict || "reviewed", score: body.score == null ? null : Number(body.score), notes: body.notes || "", createdAt: now() };
        await store.mutate((state) => { const evaluation = state.evaluations.find((item) => item.id === segments[2]); if (!evaluation) throw Object.assign(new Error("评测不存在"), { statusCode: 404 }); evaluation.reviews = evaluation.reviews.filter((item) => !(item.caseId === review.caseId && item.modelKey === review.modelKey)); evaluation.reviews.push(review); }); return send(res, 201, review);
      }
      if (segments[0] === "api" && segments[1] === "evaluations" && segments[2] && segments[3] === "report.csv" && req.method === "GET") { const evaluation = store.snapshot().evaluations.find((item) => item.id === segments[2]); return evaluation ? send(res, 200, reportCsv(evaluation), { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="evalhub-report-${evaluation.id}.csv"` }) : send(res, 404, { error: "评测不存在" }); }
      if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "接口不存在" });
      return serveStatic(req, res, url, staticDir);
    } catch (error) { return send(res, error.statusCode || 500, { error: safeMessage(error) }); }
  });
}
