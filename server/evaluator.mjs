import { randomUUID } from "node:crypto";
import { decryptSecret } from "./crypto.mjs";
import { invokeModel } from "./adapters.mjs";

const now = () => new Date().toISOString();

function priceResult(result, modelConfig) {
  const input = (result.inputTokens / 1_000_000) * Number(modelConfig.inputCostPerMillion || 0);
  const output = (result.outputTokens / 1_000_000) * Number(modelConfig.outputCostPerMillion || 0);
  return Number((input + output).toFixed(6));
}

export function heuristicScore(output, testCase) {
  if (!output || output.error) return { score: 0, reason: output?.error || "无输出", method: "heuristic" };
  const keywords = testCase.expectedKeywords || [];
  if (!keywords.length) return { score: null, reason: "该用例未配置期望关键词，等待人工评审", method: "none" };
  const hits = keywords.filter((keyword) => output.text.toLowerCase().includes(String(keyword).toLowerCase())).length;
  return { score: Math.min(10, Number(((hits / keywords.length) * 9 + (output.text.trim().length >= 24 ? 1 : 0)).toFixed(1))), reason: `命中 ${hits}/${keywords.length} 个期望关键词`, method: "heuristic" };
}

async function judgeWithModel({ evaluation, output, testCase, state, key }) {
  const judge = evaluation.judge;
  if (!judge?.enabled || !judge.connectionId || !judge.model) return heuristicScore(output, testCase);
  const connection = state.connections.find((item) => item.id === judge.connectionId);
  if (!connection) return heuristicScore(output, testCase);
  const prompt = [
    "你是严格的模型评测员。请仅返回 JSON：{\"score\":0到10的数字,\"reason\":\"简短理由\"}。",
    `用户输入：${testCase.input}`,
    `待评输出：${output.text}`,
    `期望关键词：${(testCase.expectedKeywords || []).join("、") || "未配置"}`,
    `评分标准：${(evaluation.rubric?.criteria || []).map((item) => `${item.name}(${item.weight || 1})：${item.description || ""}`).join("；") || "准确、完整、安全、遵循指令"}`,
  ].join("\n");
  try {
    const judged = await invokeModel({ connection, apiKey: decryptSecret(connection.encryptedApiKey, key), model: judge.model, input: prompt, systemPrompt: "只输出合法 JSON，不要 Markdown。", temperature: 0, maxTokens: 256 });
    const match = judged.text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match?.[0] || judged.text);
    const rawScore = Number(parsed.score);
    if (!Number.isFinite(rawScore)) throw new Error("Judge 返回的分数无效");
    return { score: Math.max(0, Math.min(10, rawScore)), reason: String(parsed.reason || "LLM Judge"), method: "llm", judgeLatencyMs: judged.latencyMs };
  } catch (error) {
    return { ...heuristicScore(output, testCase), reason: `Judge 失败，已回退规则评分：${error.message}` };
  }
}

async function parallelLimit(items, limit, worker) {
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) { const index = cursor++; await worker(items[index], index); }
  }));
}

export function createEvaluationRunner({ store, key }) {
  return async function runEvaluation(evaluationId) {
    const initial = store.snapshot();
    const evaluation = initial.evaluations.find((item) => item.id === evaluationId);
    const dataset = initial.datasets.find((item) => item.id === evaluation?.datasetId);
    if (!evaluation || !dataset) return;
    await store.mutate((state) => { const current = state.evaluations.find((item) => item.id === evaluationId); current.status = "running"; current.startedAt = now(); });

    const jobs = dataset.cases.flatMap((testCase) => evaluation.models.map((modelConfig) => ({ testCase, modelConfig })));
    await parallelLimit(jobs, Number(evaluation.concurrency || 4), async ({ testCase, modelConfig }) => {
      const state = store.snapshot();
      const connection = state.connections.find((item) => item.id === modelConfig.connectionId);
      let result;
      try {
        if (!connection) throw new Error("模型连接不存在");
        result = await invokeModel({ connection, apiKey: decryptSecret(connection.encryptedApiKey, key), model: modelConfig.model, input: testCase.input, systemPrompt: modelConfig.systemPrompt || evaluation.systemPrompt, temperature: modelConfig.temperature ?? evaluation.temperature, maxTokens: modelConfig.maxTokens ?? evaluation.maxTokens, timeoutMs: evaluation.timeoutMs });
        result.cost = priceResult(result, modelConfig);
      } catch (error) { result = { text: "", inputTokens: 0, outputTokens: 0, latencyMs: 0, cost: 0, error: error.message }; }
      const assessment = await judgeWithModel({ evaluation, output: result, testCase, state: store.snapshot(), key });
      await store.mutate((live) => { const current = live.evaluations.find((item) => item.id === evaluationId); current.results.push({ id: randomUUID(), caseId: testCase.id, modelKey: modelConfig.key, model: modelConfig.model, connectionId: modelConfig.connectionId, ...result, assessment, createdAt: now() }); current.completedRuns = current.results.length; });
    });
    await store.mutate((state) => { const current = state.evaluations.find((item) => item.id === evaluationId); current.status = current.results.some((item) => item.error) ? "completed_with_errors" : "completed"; current.completedAt = now(); });
  };
}

export function newEvaluation(payload, dataset) {
  const models = (payload.models || []).map((model, index) => ({ ...model, key: model.key || `${model.connectionId}:${model.model}:${index}` }));
  return { id: randomUUID(), name: payload.name || "未命名评测", datasetId: payload.datasetId, datasetName: dataset.name, status: "queued", models, totalRuns: dataset.cases.length * models.length, completedRuns: 0, results: [], reviews: [], rubric: payload.rubric || { criteria: [] }, judge: payload.judge || { enabled: false }, systemPrompt: payload.systemPrompt || "", temperature: Number(payload.temperature ?? 0.2), maxTokens: Number(payload.maxTokens ?? 1024), timeoutMs: Number(payload.timeoutMs ?? 60_000), concurrency: Math.max(1, Math.min(12, Number(payload.concurrency || 4))), createdAt: now() };
}
