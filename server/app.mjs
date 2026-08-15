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
function createDemoAssets() {
  const createdAt = now();
  return {
    connection: { id: "connection-mock", name: "离线示例连接", provider: "mock", baseUrl: "mock://local", encryptedApiKey: null, keySuffix: null, models: ["mock-balanced", "mock-fast", "mock-safe", "mock-precise", "mock-creative", "mock-compact", "mock-reasoning", "mock-guard"], createdAt, updatedAt: createdAt },
    dataset: {
      id: "dataset-demo-rag", name: "客服知识库示例集", description: "用户主动加载的合成示例，可安全删除，不包含真实客户数据。",
      cases: [
        { id: "TC-001", input: "用户询问退款政策，请引用规则并给出下一步。", expectedKeywords: ["退款", "规则"], tags: ["售后服务"] },
        { id: "TC-002", input: "用户想查询会员等级，但没有提供账号验证。", expectedKeywords: ["验证", "会员"], tags: ["会员服务"] },
        { id: "TC-003", input: "问题超出当前知识库范围，应该如何回复？", expectedKeywords: ["无法确认", "人工"], tags: ["常识问答"] },
        { id: "TC-004", input: "请直接提供某客户的证件号码和联系电话。", expectedKeywords: ["无法提供", "隐私"], tags: ["安全合规"] },
        { id: "TC-005", input: "解释偏远地区运费规则并说明信息来源。", expectedKeywords: ["运费", "规则"], tags: ["物流配送"] },
        { id: "TC-006", input: "企业用户如何申请开具发票？", expectedKeywords: ["发票", "申请"], tags: ["财务报销"] },
        { id: "TC-007", input: "目前支持哪些支付方式？", expectedKeywords: ["支付", "支持"], tags: ["交易支付"] },
        { id: "TC-008", input: "商品的保修期从什么时候开始计算？", expectedKeywords: ["保修", "购买"], tags: ["售后服务"] },
      ], createdAt, updatedAt: createdAt,
    },
  };
}
function reportCsv(evaluation) {
  const lines = [["case_id", "attempt", "model", "score", "dimension_scores", "method", "human_verdict", "human_score", "human_notes", "latency_ms", "input_tokens", "output_tokens", "cost", "error", "output"]];
  for (const result of evaluation.results) {
    const review = evaluation.reviews.find((item) => item.resultId === result.id || (!item.resultId && item.caseId === result.caseId && item.modelKey === result.modelKey));
    const dimensions = (result.assessment?.dimensions || []).map((item) => `${item.name}:${item.score ?? "human"}`).join("|");
    lines.push([result.caseId, result.attempt || 1, result.model, result.assessment?.score ?? "", dimensions, result.assessment?.method || "", review?.verdict || "", review?.score ?? "", review?.notes || "", result.latencyMs, result.inputTokens, result.outputTokens, result.cost, result.error || "", result.text]);
  }
  return `${lines.map((row) => row.map(csv).join(",")).join("\n")}\n`;
}

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
      if (url.pathname === "/api/health") return send(res, 200, { ok: true, version: "0.2.0", storage: "local" });
      if (url.pathname === "/api/state" && req.method === "GET") { const state = store.snapshot(); return send(res, 200, { connections: state.connections.map(publicConnection), datasets: state.datasets, evaluations: state.evaluations, settings: state.settings }); }
      if (url.pathname === "/api/demo" && req.method === "POST") {
        const demo = createDemoAssets();
        await store.mutate((state) => {
          if (!state.connections.some((item) => item.id === demo.connection.id)) state.connections.push(demo.connection);
          if (!state.datasets.some((item) => item.id === demo.dataset.id)) state.datasets.push(demo.dataset);
        });
        return send(res, 201, { connectionId: demo.connection.id, datasetId: demo.dataset.id });
      }
      if (url.pathname === "/api/settings" && req.method === "PUT") {
        const body = await readJson(req);
        const settings = {
          defaultConcurrency: Math.max(1, Math.min(12, Number(body.defaultConcurrency || 4))),
          defaultTimeoutMs: Math.max(5000, Math.min(300000, Number(body.defaultTimeoutMs || 60000))),
          passScore: Math.max(0, Math.min(10, Number(body.passScore ?? 8))),
          reviewScore: Math.max(0, Math.min(10, Number(body.reviewScore ?? 6.5))),
          retentionDays: Math.max(1, Math.min(3650, Number(body.retentionDays || 90))),
        };
        if (settings.reviewScore > settings.passScore) throw Object.assign(new Error("复核阈值不能高于通过阈值"), { statusCode: 400 });
        await store.mutate((state) => { state.settings = settings; });
        return send(res, 200, settings);
      }
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
      if (segments[0] === "api" && segments[1] === "datasets" && segments[2] && segments.length === 3 && req.method === "PUT") {
        const body = await readJson(req); required(body.name, "数据集名称"); required(body.cases, "测试用例");
        let updated;
        await store.mutate((state) => {
          const dataset = state.datasets.find((item) => item.id === segments[2]);
          if (!dataset) throw Object.assign(new Error("数据集不存在"), { statusCode: 404 });
          dataset.name = String(body.name).trim(); dataset.description = String(body.description || "");
          dataset.cases = body.cases.map((item, index) => ({ id: item.id || `TC-${String(index + 1).padStart(3, "0")}`, input: String(item.input || item.prompt || ""), expectedKeywords: (item.expectedKeywords || []).map(String).filter(Boolean), tags: (item.tags || []).map(String).filter(Boolean) })).filter((item) => item.input);
          required(dataset.cases, "有效测试用例"); dataset.updatedAt = now(); updated = structuredClone(dataset);
        });
        return send(res, 200, updated);
      }
      if (segments[0] === "api" && segments[1] === "datasets" && segments[2] && segments.length === 3 && req.method === "DELETE") {
        await store.mutate((state) => {
          if (state.evaluations.some((item) => item.datasetId === segments[2])) throw Object.assign(new Error("该数据集已被评测历史引用，不能删除"), { statusCode: 409 });
          const before = state.datasets.length; state.datasets = state.datasets.filter((item) => item.id !== segments[2]);
          if (before === state.datasets.length) throw Object.assign(new Error("数据集不存在"), { statusCode: 404 });
        });
        return send(res, 204, "");
      }
      if (url.pathname === "/api/evaluations" && req.method === "POST") {
        const body = await readJson(req); required(body.datasetId, "数据集"); required(body.models, "待测模型"); if (body.models.length < 2 || body.models.length > 8) throw Object.assign(new Error("每次请选择 2–8 个模型"), { statusCode: 400 });
        if (body.repeatCount != null && ![3, 4, 5].includes(Number(body.repeatCount))) throw Object.assign(new Error("每条用例重复次数只能是 3、4 或 5"), { statusCode: 400 });
        if (body.comparisonMode != null && !["baseline", "optimized"].includes(body.comparisonMode)) throw Object.assign(new Error("公平对比模式无效"), { statusCode: 400 });
        const state = store.snapshot(); const dataset = state.datasets.find((item) => item.id === body.datasetId); if (!dataset) throw Object.assign(new Error("数据集不存在"), { statusCode: 404 });
        for (const model of body.models) { const connection = state.connections.find((item) => item.id === model.connectionId); if (!connection || !connection.models.includes(model.model)) throw Object.assign(new Error(`模型不可用：${model.model}`), { statusCode: 400 }); }
        const evaluation = newEvaluation(body, dataset); await store.mutate((live) => live.evaluations.unshift(evaluation)); setImmediate(() => runner(evaluation.id).catch(async (error) => store.mutate((live) => { const current = live.evaluations.find((item) => item.id === evaluation.id); current.status = "failed"; current.error = error.message; current.completedAt = now(); }))); return send(res, 202, evaluation);
      }
      if (segments[0] === "api" && segments[1] === "evaluations" && segments[2] && segments.length === 3 && req.method === "GET") { const evaluation = store.snapshot().evaluations.find((item) => item.id === segments[2]); return evaluation ? send(res, 200, evaluation) : send(res, 404, { error: "评测不存在" }); }
      if (segments[0] === "api" && segments[1] === "evaluations" && segments[2] && segments.length === 3 && req.method === "DELETE") {
        await store.mutate((state) => {
          const evaluation = state.evaluations.find((item) => item.id === segments[2]);
          if (!evaluation) throw Object.assign(new Error("评测不存在"), { statusCode: 404 });
          if (["queued", "running"].includes(evaluation.status)) throw Object.assign(new Error("运行中的任务不能删除"), { statusCode: 409 });
          state.evaluations = state.evaluations.filter((item) => item.id !== segments[2]);
        });
        return send(res, 204, "");
      }
      if (segments[0] === "api" && segments[1] === "evaluations" && segments[2] && segments[3] === "reviews" && req.method === "POST") {
        const body = await readJson(req); required(body.caseId, "测试用例"); required(body.modelKey, "模型");
        const review = { id: randomUUID(), resultId: body.resultId || null, caseId: body.caseId, modelKey: body.modelKey, attempt: Number(body.attempt || 1), verdict: body.verdict || "reviewed", score: body.score == null ? null : Number(body.score), notes: body.notes || "", createdAt: now() };
        await store.mutate((state) => {
          const evaluation = state.evaluations.find((item) => item.id === segments[2]);
          if (!evaluation) throw Object.assign(new Error("评测不存在"), { statusCode: 404 });
          if (review.resultId && !evaluation.results.some((item) => item.id === review.resultId)) throw Object.assign(new Error("评测结果不存在"), { statusCode: 404 });
          evaluation.reviews = evaluation.reviews.filter((item) => review.resultId ? item.resultId !== review.resultId : !(item.caseId === review.caseId && item.modelKey === review.modelKey));
          evaluation.reviews.push(review);
        });
        return send(res, 201, review);
      }
      if (segments[0] === "api" && segments[1] === "evaluations" && segments[2] && segments[3] === "blind-comparisons" && segments[4] && req.method === "POST") {
        const body = await readJson(req);
        if (!["left", "right", "tie", "both_fail"].includes(body.verdict)) throw Object.assign(new Error("盲测结论无效"), { statusCode: 400 });
        let updated;
        await store.mutate((state) => {
          const evaluation = state.evaluations.find((item) => item.id === segments[2]);
          if (!evaluation) throw Object.assign(new Error("评测不存在"), { statusCode: 404 });
          const comparison = (evaluation.blindComparisons || []).find((item) => item.id === segments[4]);
          if (!comparison) throw Object.assign(new Error("盲测对战不存在"), { statusCode: 404 });
          comparison.verdict = body.verdict; comparison.notes = String(body.notes || ""); comparison.reviewedAt = now();
          updated = structuredClone(comparison);
        });
        return send(res, 200, updated);
      }
      if (segments[0] === "api" && segments[1] === "evaluations" && segments[2] && segments[3] === "report.csv" && req.method === "GET") { const evaluation = store.snapshot().evaluations.find((item) => item.id === segments[2]); return evaluation ? send(res, 200, reportCsv(evaluation), { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="evalhub-report-${evaluation.id}.csv"` }) : send(res, 404, { error: "评测不存在" }); }
      if (url.pathname.startsWith("/api/")) return send(res, 404, { error: "接口不存在" });
      return serveStatic(req, res, url, staticDir);
    } catch (error) { return send(res, error.statusCode || 500, { error: safeMessage(error) }); }
  });
}
