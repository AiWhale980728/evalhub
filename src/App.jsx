import { useEffect, useMemo, useState } from "react";
import {
  ArrowsClockwise, CaretDown, CaretRight, ChartBar, Check, CheckCircle, ClipboardText,
  CloudArrowUp, Database, DownloadSimple, Eye, FileText, GearSix, Key, MagnifyingGlass,
  PlugsConnected, Plus, Pulse, Robot, ShieldCheck, SlidersHorizontal, SquaresFour,
  Trash, UploadSimple, WarningCircle, X, XCircle,
} from "@phosphor-icons/react";
import { ManagementPages } from "./ManagementPages.jsx";

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body,
  });
  const type = response.headers.get("content-type") || "";
  const body = type.includes("json") ? await response.json() : await response.text();
  if (!response.ok) throw new Error(body?.error || body || `HTTP ${response.status}`);
  return body;
}

function parseDatasetText(text) {
  const clean = text.trim();
  if (!clean) throw new Error("请粘贴 JSONL 或 CSV 数据");
  if (clean.startsWith("{") || clean.startsWith("[")) {
    const parsed = clean.startsWith("[") ? JSON.parse(clean) : clean.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    return parsed.map((item, index) => ({
      id: item.id || `TC-${String(index + 1).padStart(3, "0")}`,
      input: item.input || item.prompt,
      expectedKeywords: Array.isArray(item.expectedKeywords) ? item.expectedKeywords : String(item.expected_keywords || "").split("|").filter(Boolean),
      tags: Array.isArray(item.tags) ? item.tags : String(item.tags || "").split("|").filter(Boolean),
    }));
  }
  const rows = clean.split(/\r?\n/).map((row) => row.split(",").map((cell) => cell.trim()));
  const headers = rows.shift().map((item) => item.toLowerCase());
  return rows.filter((row) => row.some(Boolean)).map((row, index) => {
    const value = (name) => row[headers.indexOf(name)] || "";
    return { id: value("id") || `TC-${String(index + 1).padStart(3, "0")}`, input: value("input") || value("prompt"), expectedKeywords: value("expected_keywords").split("|").filter(Boolean), tags: value("tags").split("|").filter(Boolean) };
  });
}

const providerPresets = {
  mock: "mock://local",
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com",
  gemini: "https://generativelanguage.googleapis.com",
  compatible: "http://localhost:11434/v1",
};

const nav = [
  { label: "概览", icon: SquaresFour }, { label: "数据集", icon: Database },
  { label: "测试用例", icon: ClipboardText }, { label: "评测任务", icon: CheckCircle },
  { label: "模型管理", icon: Robot, expandable: true }, { label: "评测矩阵", icon: ChartBar },
  { label: "失败分析", icon: WarningCircle }, { label: "指标看板", icon: Pulse },
  { label: "对比报告", icon: FileText }, { label: "人工复核", icon: Eye },
];

const tones = ["blue", "amber", "purple", "indigo", "violet", "slate"];
const formatMoney = (value) => `$${Number(value || 0).toFixed(value >= 0.01 ? 3 : 5)}`;
const shortText = (value, length = 22) => value?.length > length ? `${value.slice(0, length)}…` : value || "未命名用例";

function ScoreState({ score }) {
  if (!Number.isFinite(score)) return <span className="score-state empty"><strong>—</strong></span>;
  const state = score >= 8 ? "pass" : score >= 6.5 ? "review" : "fail";
  return <span className={`score-state ${state}`}><strong>{score.toFixed(1)}</strong>{state === "pass" ? <CheckCircle weight="fill" /> : state === "review" ? <WarningCircle weight="fill" /> : <XCircle weight="fill" />}</span>;
}

function ModelMark({ model }) {
  return <span className={`model-mark ${model.tone}`}>{(model.name || "M").slice(0, 1).toUpperCase()}</span>;
}

function Modal({ children, className = "", onClose }) {
  return <div className="modal-backdrop" onMouseDown={onClose}><section className={`modal ${className}`} onMouseDown={(event) => event.stopPropagation()}>{children}</section></div>;
}

function RunEvaluationModal({
  runForm, setRunForm, selectedModels, selectedDatasetId, setSelectedDatasetId, state,
  availableModels, defaultModelParams, setModelParam, toggleModelParams,
  setRubricCriterion, addRubricCriterion, removeRubricCriterion,
  onClose, onSubmit, busy,
}) {
  const caseCount = state.datasets.find((item) => item.id === selectedDatasetId)?.cases.length || 0;
  const baseline = runForm.comparisonMode === "baseline";
  return <Modal className="form-modal run-modal" onClose={onClose}>
    <header><div><h2>创建模型评测</h2><p>{selectedModels.length} 个模型 × {caseCount} 条用例 × {runForm.repeatCount} 次重复</p></div><button className="close-button" onClick={onClose}><X /></button></header>
    <form onSubmit={onSubmit}><div className="form-grid">
      <label><span>任务名称</span><input required value={runForm.name} onChange={(event) => setRunForm({ ...runForm, name: event.target.value })} /></label>
      <label><span>数据集</span><select required value={selectedDatasetId} onChange={(event) => setSelectedDatasetId(event.target.value)}>{state.datasets.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.cases.length} 条</option>)}</select></label>

      <section className="full fairness-selector"><div><strong>公平对比模式</strong><span>任务创建后保存不可变参数快照，确保结论可复现。</span></div><div>
        <button type="button" className={baseline ? "active" : ""} onClick={() => setRunForm({ ...runForm, comparisonMode: "baseline" })}><strong>统一基线</strong><small>统一参数和 System Prompt，比较模型本身</small></button>
        <button type="button" className={!baseline ? "active" : ""} onClick={() => setRunForm({ ...runForm, comparisonMode: "optimized" })}><strong>模型优化</strong><small>允许独立调参，比较各模型最佳表现</small></button>
      </div></section>
      <label><span>每条用例重复运行</span><select value={runForm.repeatCount} onChange={(event) => setRunForm({ ...runForm, repeatCount: Number(event.target.value) })}><option value="3">3 次（推荐）</option><option value="4">4 次</option><option value="5">5 次</option></select></label>
      <label><span>预计模型调用</span><input readOnly value={`${selectedModels.length * caseCount * runForm.repeatCount} 次`} /></label>
      <label className="full"><span>{baseline ? "统一" : "默认"} System Prompt</span><textarea value={runForm.systemPrompt} onChange={(event) => setRunForm({ ...runForm, systemPrompt: event.target.value })} /></label>
      <label><span>{baseline ? "统一" : "默认"} Temperature</span><input type="number" min="0" max="2" step="0.1" value={runForm.temperature} onChange={(event) => setRunForm({ ...runForm, temperature: event.target.value })} /></label>
      <label><span>{baseline ? "统一" : "默认"} Max tokens</span><input type="number" min="1" max="32768" value={runForm.maxTokens} onChange={(event) => setRunForm({ ...runForm, maxTokens: event.target.value })} /></label>
      <label><span>Top P</span><input type="number" min="0" max="1" step="0.05" value={runForm.topP} onChange={(event) => setRunForm({ ...runForm, topP: event.target.value })} /></label>
      <label><span>Top K</span><input type="number" min="0" placeholder="可选" value={runForm.topK} onChange={(event) => setRunForm({ ...runForm, topK: event.target.value })} /></label>
      <label><span>Presence penalty</span><input type="number" min="-2" max="2" step="0.1" value={runForm.presencePenalty} onChange={(event) => setRunForm({ ...runForm, presencePenalty: event.target.value })} /></label>
      <label><span>Frequency penalty</span><input type="number" min="-2" max="2" step="0.1" value={runForm.frequencyPenalty} onChange={(event) => setRunForm({ ...runForm, frequencyPenalty: event.target.value })} /></label>
      <label><span>Seed <small>每轮自动 +1</small></span><input type="number" placeholder="可选" value={runForm.seed} onChange={(event) => setRunForm({ ...runForm, seed: event.target.value })} /></label>
      <label><span>Stop 序列（| 分隔）</span><input value={runForm.stopSequences} onChange={(event) => setRunForm({ ...runForm, stopSequences: event.target.value })} /></label>
      <label><span>本地并发数</span><input type="number" min="1" max="12" value={runForm.concurrency} onChange={(event) => setRunForm({ ...runForm, concurrency: event.target.value })} /></label>
      <label><span>请求超时（秒）</span><input type="number" min="5" max="300" value={Number(runForm.timeoutMs || 60000) / 1000} onChange={(event) => setRunForm({ ...runForm, timeoutMs: Number(event.target.value) * 1000 })} /></label>

      <section className={`full model-params-section ${baseline ? "locked" : ""}`}><header><div><strong>逐模型独立参数</strong><span>{baseline ? "统一基线已锁定；服务端会强制使用上方统一参数" : "展开任一模型进行覆盖；未修改字段继承上方默认值"}</span></div></header>{selectedModels.map((id) => {
        const model = availableModels.find((item) => item.id === id); if (!model) return null;
        const params = defaultModelParams(id); const expanded = runForm.expandedModel === id;
        return <article className={`model-param-card ${expanded ? "expanded" : ""}`} key={id}><button disabled={baseline} type="button" className="model-param-summary" onClick={() => toggleModelParams(id)}><ModelMark model={model} /><span><strong>{model.name}</strong><small>{model.provider}</small></span><em>{baseline ? "使用统一基线" : `T ${params.temperature} · Top P ${params.topP} · ${params.maxTokens} tokens`}</em><CaretDown /></button>{expanded && !baseline && <div className="model-param-grid">
          <label><span>Temperature</span><input aria-label={`${model.name} Temperature`} type="number" min="0" max="2" step="0.1" value={params.temperature} onChange={(event) => setModelParam(id, "temperature", event.target.value)} /></label>
          <label><span>Max tokens</span><input aria-label={`${model.name} Max tokens`} type="number" min="1" max="32768" value={params.maxTokens} onChange={(event) => setModelParam(id, "maxTokens", event.target.value)} /></label>
          <label><span>Top P</span><input aria-label={`${model.name} Top P`} type="number" min="0" max="1" step="0.05" value={params.topP} onChange={(event) => setModelParam(id, "topP", event.target.value)} /></label>
          <label><span>Top K</span><input aria-label={`${model.name} Top K`} type="number" min="0" placeholder="可选" value={params.topK} onChange={(event) => setModelParam(id, "topK", event.target.value)} /></label>
          <label><span>Presence penalty</span><input aria-label={`${model.name} Presence penalty`} type="number" min="-2" max="2" step="0.1" value={params.presencePenalty} onChange={(event) => setModelParam(id, "presencePenalty", event.target.value)} /></label>
          <label><span>Frequency penalty</span><input aria-label={`${model.name} Frequency penalty`} type="number" min="-2" max="2" step="0.1" value={params.frequencyPenalty} onChange={(event) => setModelParam(id, "frequencyPenalty", event.target.value)} /></label>
          <label><span>Seed</span><input aria-label={`${model.name} Seed`} type="number" placeholder="可选" value={params.seed} onChange={(event) => setModelParam(id, "seed", event.target.value)} /></label>
          <label><span>Stop 序列（| 分隔）</span><input aria-label={`${model.name} Stop sequences`} value={params.stopSequences} onChange={(event) => setModelParam(id, "stopSequences", event.target.value)} /></label>
          <label className="full"><span>独立 System Prompt</span><textarea aria-label={`${model.name} System Prompt`} value={params.systemPrompt} onChange={(event) => setModelParam(id, "systemPrompt", event.target.value)} /></label>
        </div>}</article>;
      })}</section>

      <section className="full rubric-editor"><header><div><strong>多维评分 Rubric</strong><span>综合分按权重归一化；人工维度不进入自动综合分。</span></div><button type="button" onClick={addRubricCriterion}><Plus />添加维度</button></header>{runForm.rubricCriteria.map((item) => <div className="rubric-row" key={item.id}>
        <input aria-label="维度名称" required value={item.name} onChange={(event) => setRubricCriterion(item.id, "name", event.target.value)} />
        <input aria-label={`${item.name} 说明`} required value={item.description} onChange={(event) => setRubricCriterion(item.id, "description", event.target.value)} />
        <label><input aria-label={`${item.name} 权重`} type="number" min="1" max="100" value={item.weight} onChange={(event) => setRubricCriterion(item.id, "weight", event.target.value)} /><span>% 权重</span></label>
        <select aria-label={`${item.name} 评分方式`} value={item.evaluator} onChange={(event) => setRubricCriterion(item.id, "evaluator", event.target.value)}><option value="auto">自动评分</option><option value="human">仅人工</option></select>
        <button type="button" aria-label={`删除 ${item.name}`} disabled={runForm.rubricCriteria.length <= 1} onClick={() => removeRubricCriterion(item.id)}><Trash /></button>
      </div>)}</section>

      <fieldset className="full"><legend>可选：LLM-as-a-Judge</legend><label className="check-row"><input type="checkbox" checked={runForm.judgeEnabled} onChange={(event) => setRunForm({ ...runForm, judgeEnabled: event.target.checked })} />让独立模型逐维评分；失败时回退关键词启发式代理</label>{runForm.judgeEnabled && <div className="inline-fields"><select required value={runForm.judgeConnectionId} onChange={(event) => setRunForm({ ...runForm, judgeConnectionId: event.target.value, judgeModel: state.connections.find((item) => item.id === event.target.value)?.models[0] || "" })}><option value="">选择 Judge 连接</option>{state.connections.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select><input required value={runForm.judgeModel} onChange={(event) => setRunForm({ ...runForm, judgeModel: event.target.value })} placeholder="Judge 模型 ID" /></div>}</fieldset>
      <div className="full pricing-section"><div><strong>可选：每百万 Token 价格（USD）</strong><span>用于质量—成本—延迟决策面板</span></div>{selectedModels.map((id) => { const model = availableModels.find((item) => item.id === id); if (!model) return null; return <div className="pricing-row" key={id}><span>{model.name}</span><input type="number" min="0" step="0.0001" placeholder="输入价" value={runForm.pricing[id]?.input || ""} onChange={(event) => setRunForm({ ...runForm, pricing: { ...runForm.pricing, [id]: { ...runForm.pricing[id], input: event.target.value } } })} /><input type="number" min="0" step="0.0001" placeholder="输出价" value={runForm.pricing[id]?.output || ""} onChange={(event) => setRunForm({ ...runForm, pricing: { ...runForm.pricing, [id]: { ...runForm.pricing[id], output: event.target.value } } })} /></div>; })}</div>
    </div><footer><span className="format-help">将保存公平口径、重复次数、参数、Rubric 与价格快照。</span><button className="primary-button" disabled={busy === "evaluation"}>{busy === "evaluation" ? "正在创建…" : "开始评测"}</button></footer></form>
  </Modal>;
}

export function App() {
  const [state, setState] = useState({ connections: [], datasets: [], evaluations: [], settings: {} });
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedModels, setSelectedModels] = useState([]);
  const [draftModels, setDraftModels] = useState([]);
  const [activeEvaluationId, setActiveEvaluationId] = useState("");
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [selectedCase, setSelectedCase] = useState("");
  const [showModels, setShowModels] = useState(false);
  const [showApi, setShowApi] = useState(false);
  const [showConnectionForm, setShowConnectionForm] = useState(false);
  const [showDataset, setShowDataset] = useState(false);
  const [showRun, setShowRun] = useState(false);
  const [reviewing, setReviewing] = useState(null);
  const [activeNav, setActiveNav] = useState("概览");
  const [query, setQuery] = useState("");
  const [scoreFilter, setScoreFilter] = useState("all");
  const [toast, setToast] = useState("");
  const [view, setView] = useState("matrix");
  const [activeBlindComparisonId, setActiveBlindComparisonId] = useState("");
  const [busy, setBusy] = useState("");
  const [connectionForm, setConnectionForm] = useState({ name: "", provider: "openai", baseUrl: providerPresets.openai, apiKey: "", models: "" });
  const [connectionTest, setConnectionTest] = useState(null);
  const [datasetForm, setDatasetForm] = useState({ name: "", description: "", text: "" });
  const [runForm, setRunForm] = useState({
    name: "模型横向评测", comparisonMode: "baseline", repeatCount: 3,
    systemPrompt: "请依据企业知识库准确、安全地回答用户问题。", temperature: 0.2, maxTokens: 1024,
    topP: 1, topK: "", presencePenalty: 0, frequencyPenalty: 0, seed: "", stopSequences: "",
    concurrency: 4, timeoutMs: 60000,
    rubricCriteria: [
      { id: "accuracy", name: "准确性", description: "事实正确并覆盖期望信息", weight: 40, evaluator: "auto" },
      { id: "completeness", name: "完整性", description: "回答完整、可执行且无关键遗漏", weight: 25, evaluator: "auto" },
      { id: "instruction", name: "指令遵循", description: "遵循输入和 System Prompt 的要求", weight: 20, evaluator: "auto" },
      { id: "safety", name: "安全合规", description: "不泄露隐私，不生成高风险内容", weight: 15, evaluator: "auto" },
    ],
    judgeEnabled: false, judgeConnectionId: "", judgeModel: "", pricing: {}, modelParams: {}, expandedModel: "",
  });

  async function refresh(preferredEvaluationId) {
    try {
      const next = await api("/api/state");
      setState(next);
      setLoadError("");
      setSelectedDatasetId((current) => current && next.datasets.some((item) => item.id === current) ? current : next.datasets[0]?.id || "");
      setActiveEvaluationId((current) => preferredEvaluationId || (current && next.evaluations.some((item) => item.id === current) ? current : next.evaluations[0]?.id || ""));
      return next;
    } catch (error) {
      setLoadError(error.message);
      throw error;
    } finally { setLoading(false); }
  }

  useEffect(() => { refresh().catch(() => {}); }, []);

  const availableModels = useMemo(() => state.connections.flatMap((connection, connectionIndex) => connection.models.map((model) => ({
    id: `${connection.id}:${model}`, connectionId: connection.id, apiModel: model, name: model,
    provider: `${connection.provider} · ${connection.name}`, connectionName: connection.name,
    providerName: connection.provider, tone: tones[connectionIndex % tones.length],
  }))), [state.connections]);

  useEffect(() => {
    const availableIds = new Set(availableModels.map((item) => item.id));
    setSelectedModels((current) => {
      const valid = current.filter((id) => availableIds.has(id));
      const next = valid.length >= 2 ? valid : availableModels.slice(0, Math.min(6, availableModels.length)).map((item) => item.id);
      return next.length === current.length && next.every((id, index) => id === current[index]) ? current : next;
    });
  }, [availableModels]);

  const evaluation = state.evaluations.find((item) => item.id === activeEvaluationId) || null;
  const dataset = state.datasets.find((item) => item.id === (evaluation?.datasetId || selectedDatasetId)) || state.datasets[0] || null;
  const evaluationModels = useMemo(() => evaluation?.models.map((config, index) => {
    const found = availableModels.find((item) => item.connectionId === config.connectionId && item.apiModel === config.model);
    return { ...(found || { id: `${config.connectionId}:${config.model}`, connectionId: config.connectionId, apiModel: config.model, name: config.model, provider: "已保存连接", tone: tones[index % tones.length] }), key: config.key };
  }) || [], [evaluation, availableModels]);
  const previewModels = selectedModels.map((id) => availableModels.find((item) => item.id === id)).filter(Boolean);
  const models = evaluation ? evaluationModels : previewModels;
  const isPreview = !evaluation;

  const resultMap = useMemo(() => {
    const map = new Map();
    for (const item of evaluation?.results || []) {
      const key = `${item.caseId}:${item.modelKey}`;
      map.set(key, [...(map.get(key) || []), item].sort((a, b) => Number(a.attempt || 1) - Number(b.attempt || 1)));
    }
    return map;
  }, [evaluation]);
  function getResults(caseId, model) { return resultMap.get(`${caseId}:${model.key}`) || []; }
  function getResult(caseId, model) { return getResults(caseId, model)[0]; }
  function getScore(item, model) {
    const scores = getResults(item.id, model).map((result) => result.assessment?.score).filter(Number.isFinite);
    return scores.length ? scores.reduce((sum, score) => sum + score, 0) / scores.length : null;
  }

  const summaries = useMemo(() => new Map(models.map((model) => {
    if (isPreview) return [model.id, { score: null, pass: 0, latency: "—", cost: "—" }];
    const results = (evaluation.results || []).filter((item) => item.modelKey === model.key);
    const scores = results.map((item) => item.assessment?.score).filter(Number.isFinite);
    const score = scores.length ? scores.reduce((sum, item) => sum + item, 0) / scores.length : null;
    const variance = scores.length ? scores.reduce((sum, item) => sum + (item - score) ** 2, 0) / scores.length : null;
    return [model.id, { score, pass: scores.length ? Math.round(scores.filter((item) => item >= 8).length / scores.length * 100) : 0, stability: variance == null ? null : Math.sqrt(variance), latency: results.length ? `${(results.reduce((sum, item) => sum + item.latencyMs, 0) / results.length / 1000).toFixed(2)}s` : "—", cost: formatMoney(results.reduce((sum, item) => sum + Number(item.cost || 0), 0)) }];
  })), [models, evaluation, isPreview]);

  const cases = dataset?.cases || [];
  useEffect(() => { if (cases.length && !cases.some((item) => item.id === selectedCase)) setSelectedCase(cases[0].id); }, [cases, selectedCase]);

  useEffect(() => {
    if (!evaluation || !["queued", "running"].includes(evaluation.status)) return undefined;
    const timer = setInterval(() => refresh(evaluation.id).catch(() => {}), 650);
    return () => clearInterval(timer);
  }, [evaluation?.id, evaluation?.status]);

  const visibleCases = cases.filter((item) => {
    if (!`${item.id}${item.input}${(item.tags || []).join("")}`.toLowerCase().includes(query.toLowerCase())) return false;
    if (scoreFilter === "all") return true;
    const values = models.map((model) => getScore(item, model)).filter(Number.isFinite);
    return scoreFilter === "failed" ? values.some((score) => score < 6.5) : scoreFilter === "review" ? values.some((score) => score >= 6.5 && score < 8) : values.length > 0 && values.every((score) => score >= 8);
  });
  const currentCase = cases.find((item) => item.id === selectedCase) || cases[0];
  const caseBlindComparisons = (evaluation?.blindComparisons || []).filter((item) => item.caseId === currentCase?.id);
  const blindComparison = caseBlindComparisons.find((item) => item.id === activeBlindComparisonId) || caseBlindComparisons.find((item) => !item.verdict) || caseBlindComparisons[0] || null;
  const blindLeftResult = evaluation?.results.find((item) => item.id === blindComparison?.leftResultId);
  const blindRightResult = evaluation?.results.find((item) => item.id === blindComparison?.rightResultId);
  const blindLeftModel = evaluationModels.find((item) => item.key === blindComparison?.leftModelKey);
  const blindRightModel = evaluationModels.find((item) => item.key === blindComparison?.rightModelKey);

  function notify(message) { setToast(message); window.setTimeout(() => setToast(""), 2800); }
  function toggleDraft(id) { setDraftModels((current) => current.includes(id) ? (current.length <= 2 ? current : current.filter((item) => item !== id)) : (current.length >= 8 ? current : [...current, id])); }
  function defaultModelParams(id, source = runForm) { return { temperature: source.temperature, maxTokens: source.maxTokens, topP: 1, topK: "", presencePenalty: 0, frequencyPenalty: 0, seed: "", stopSequences: "", systemPrompt: "", ...(source.modelParams[id] || {}) }; }
  function setModelParam(id, field, value) { setRunForm((current) => ({ ...current, modelParams: { ...current.modelParams, [id]: { ...defaultModelParams(id, current), [field]: value } } })); }
  function toggleModelParams(id) { setRunForm((current) => ({ ...current, expandedModel: current.expandedModel === id ? "" : id })); }
  function setRubricCriterion(id, field, value) {
    setRunForm((current) => ({ ...current, rubricCriteria: current.rubricCriteria.map((item) => item.id === id ? { ...item, [field]: value } : item) }));
  }
  function addRubricCriterion() {
    setRunForm((current) => current.rubricCriteria.length >= 12 ? current : ({ ...current, rubricCriteria: [...current.rubricCriteria, { id: `criterion-${Date.now()}`, name: "新评分维度", description: "", weight: 10, evaluator: "auto" }] }));
  }
  function removeRubricCriterion(id) {
    setRunForm((current) => current.rubricCriteria.length <= 1 ? current : ({ ...current, rubricCriteria: current.rubricCriteria.filter((item) => item.id !== id) }));
  }
  function openRun() {
    if (state.connections.length === 0 || state.datasets.length === 0) { setActiveNav("概览"); return notify("请先添加 API 连接并导入数据集，或加载示例项目"); }
    setRunForm((current) => ({ ...current, name: `${dataset?.name || "数据集"}模型评测`, concurrency: state.settings?.defaultConcurrency || current.concurrency, timeoutMs: state.settings?.defaultTimeoutMs || current.timeoutMs })); setShowRun(true);
  }
  function handleNav(item) {
    setActiveNav(item.label);
  }

  function exportReport() {
    if (!evaluation) return notify("当前没有可导出的评测，请先运行一次评测");
    window.location.assign(`/api/evaluations/${evaluation.id}/report.csv`);
  }

  function exportEvaluation(run) { window.location.assign(`/api/evaluations/${run.id}/report.csv`); }

  function openMatrix(id) { if (id) setActiveEvaluationId(id); setActiveNav("评测矩阵"); }

  function openReview(run, result) {
    setActiveEvaluationId(run.id);
    const config = run.models.find((item) => item.key === result.modelKey);
    const model = availableModels.find((item) => item.connectionId === result.connectionId && item.apiModel === result.model) || { name: result.model, tone: "blue", key: config?.key };
    setReviewing({ result, model, score: result.assessment?.score ?? 0, verdict: "reviewed", notes: "" });
  }

  async function updateDataset(target, nextCases) {
    try { await api(`/api/datasets/${target.id}`, { method: "PUT", body: { name: target.name, description: target.description, cases: nextCases } }); await refresh(); notify("数据集已更新"); }
    catch (error) { notify(error.message); }
  }

  async function deleteDataset(target) {
    try { await api(`/api/datasets/${target.id}`, { method: "DELETE" }); await refresh(); notify("数据集已删除"); }
    catch (error) { notify(error.message); }
  }

  async function deleteEvaluation(target) {
    try { await api(`/api/evaluations/${target.id}`, { method: "DELETE" }); await refresh(); notify("评测任务已删除"); }
    catch (error) { notify(error.message); }
  }

  async function saveSettings(settings) {
    try { await api("/api/settings", { method: "PUT", body: settings }); await refresh(); notify("系统设置已保存"); }
    catch (error) { notify(error.message); }
  }

  async function loadDemo() {
    setBusy("demo");
    try {
      const demo = await api("/api/demo", { method: "POST" });
      await refresh(); setSelectedDatasetId(demo.datasetId); setActiveEvaluationId(""); setActiveNav("概览"); notify("示例项目已加载，可随时删除");
    } catch (error) { notify(error.message); } finally { setBusy(""); }
  }

  async function saveConnection(event) {
    event.preventDefault(); setBusy("connection-save");
    try {
      const payload = { ...connectionForm, models: connectionForm.models.split(/[\n,]/).map((item) => item.trim()).filter(Boolean) };
      await api("/api/connections", { method: "POST", body: payload });
      await refresh(); setShowConnectionForm(false); setConnectionForm({ name: "", provider: "openai", baseUrl: providerPresets.openai, apiKey: "", models: "" }); setConnectionTest(null); notify("API 连接已安全保存");
    } catch (error) { notify(error.message); } finally { setBusy(""); }
  }

  async function testConnection() {
    setBusy("connection-test"); setConnectionTest(null);
    try {
      const result = await api("/api/connections/test", { method: "POST", body: { ...connectionForm, models: connectionForm.models.split(/[\n,]/).filter(Boolean) } });
      setConnectionTest(result); if (!connectionForm.models && result.models?.length) setConnectionForm((current) => ({ ...current, models: result.models.slice(0, 20).join(", ") }));
    } catch (error) { setConnectionTest({ ok: false, error: error.message }); } finally { setBusy(""); }
  }

  async function deleteConnection(connection) {
    setBusy(`delete-${connection.id}`);
    try { await api(`/api/connections/${connection.id}`, { method: "DELETE" }); await refresh(); notify("连接已删除"); }
    catch (error) { notify(error.message); } finally { setBusy(""); }
  }

  async function importDataset(event) {
    event.preventDefault(); setBusy("dataset");
    try { const created = await api("/api/datasets", { method: "POST", body: { name: datasetForm.name, description: datasetForm.description, cases: parseDatasetText(datasetForm.text) } }); await refresh(); setSelectedDatasetId(created.id); setDatasetForm({ name: "", description: "", text: "" }); setShowDataset(false); notify(`已导入 ${created.cases.length} 条测试用例`); }
    catch (error) { notify(error.message); } finally { setBusy(""); }
  }

  async function readDatasetFile(file) { if (file) { const text = await file.text(); setDatasetForm((current) => ({ ...current, name: current.name || file.name.replace(/\.[^.]+$/, ""), text })); } }

  async function createEvaluation(event) {
    event.preventDefault(); setBusy("evaluation");
    try {
      const chosen = selectedModels.map((id) => availableModels.find((item) => item.id === id)).filter(Boolean);
      if (chosen.length < 2 || chosen.length > 8) throw new Error("请选择 2–8 个模型");
      const payload = {
        ...runForm, datasetId: selectedDatasetId,
        models: chosen.map((item) => { const params = defaultModelParams(item.id); return { connectionId: item.connectionId, model: item.apiModel, key: item.id, temperature: params.temperature, maxTokens: params.maxTokens, topP: params.topP, topK: params.topK, presencePenalty: params.presencePenalty, frequencyPenalty: params.frequencyPenalty, seed: params.seed, stopSequences: params.stopSequences, systemPrompt: params.systemPrompt || undefined, inputCostPerMillion: runForm.pricing[item.id]?.input || 0, outputCostPerMillion: runForm.pricing[item.id]?.output || 0 }; }),
        rubric: { criteria: runForm.rubricCriteria.map((item) => ({ ...item, weight: Number(item.weight) })) },
        judge: { enabled: runForm.judgeEnabled, connectionId: runForm.judgeConnectionId, model: runForm.judgeModel },
      };
      const created = await api("/api/evaluations", { method: "POST", body: payload });
      setShowRun(false); setActiveEvaluationId(created.id); await refresh(created.id); notify("评测已启动，结果会自动刷新");
    } catch (error) { notify(error.message); } finally { setBusy(""); }
  }

  async function saveReview(event) {
    event.preventDefault(); setBusy("review");
    try { await api(`/api/evaluations/${evaluation.id}/reviews`, { method: "POST", body: { resultId: reviewing.result.id, caseId: reviewing.result.caseId, modelKey: reviewing.result.modelKey, attempt: reviewing.result.attempt || 1, verdict: reviewing.verdict, score: Number(reviewing.score), notes: reviewing.notes } }); await refresh(evaluation.id); setReviewing(null); notify("人工复核已保存"); }
    catch (error) { notify(error.message); } finally { setBusy(""); }
  }

  async function saveBlindVerdict(comparison, verdict) {
    setBusy(`blind-${comparison.id}`);
    try {
      setActiveBlindComparisonId(comparison.id);
      await api(`/api/evaluations/${evaluation.id}/blind-comparisons/${comparison.id}`, { method: "POST", body: { verdict } });
      await refresh(evaluation.id); notify("盲测结论已记录，模型身份现已揭示");
    } catch (error) { notify(error.message); } finally { setBusy(""); }
  }

  if (loading) return <div className="loading-screen"><ChartBar weight="fill" /><strong>EvalHub</strong><span>正在启动本地评测工作台…</span></div>;
  if (loadError) return <div className="loading-screen error"><WarningCircle /><strong>无法连接本地服务</strong><span>{loadError}</span><button className="primary-button" onClick={() => { setLoading(true); refresh().catch(() => {}); }}><ArrowsClockwise />重试</button></div>;

  const statusText = evaluation ? evaluation.status === "completed" ? "任务已完成" : evaluation.status === "completed_with_errors" ? "完成，部分失败" : evaluation.status === "failed" ? "任务失败" : `运行中 ${evaluation.completedRuns}/${evaluation.totalRuns}` : state.connections.length || state.datasets.length ? "准备就绪" : "尚未配置";

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><ChartBar weight="fill" /></span><span>EvalHub</span></div>
      <nav className="nav-list">{nav.map((item) => { const Icon = item.icon; return <button key={item.label} className={`nav-item ${activeNav === item.label ? "active" : ""}`} onClick={() => handleNav(item)}><Icon /><span>{item.label}</span>{item.expandable && <CaretRight className="nav-caret" />}</button>; })}</nav>
      <div className="nav-bottom"><button className={`nav-item ${activeNav === "系统设置" ? "active" : ""}`} onClick={() => setActiveNav("系统设置")}><GearSix /><span>系统设置</span></button><div className="license-lockup"><div><ChartBar weight="fill" /> EvalHub by YJW</div><span>Community License</span></div></div>
    </aside>

    <main className="main-area">
      <header className="topbar">
        <label className="history-select"><span>评测历史</span><select value={activeEvaluationId} onChange={(event) => setActiveEvaluationId(event.target.value)}><option value="">{state.evaluations.length ? "未选择评测" : "暂无评测历史"}</option>{state.evaluations.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.status}</option>)}</select><CaretDown /></label>
        <div className="top-actions"><span className={`run-meta status-${evaluation?.status || "preview"}`}><CheckCircle weight="fill" /> {statusText}</span>{evaluation && <span>{new Date(evaluation.createdAt).toLocaleString("zh-CN")}</span>}<span className="top-divider" /><button className="primary-button" onClick={openRun}><ArrowsClockwise />新建评测</button><button className="secondary-button" onClick={exportReport}><DownloadSimple />导出报告</button></div>
      </header>

      {evaluation && ["queued", "running"].includes(evaluation.status) && <div className="run-progress"><i style={{ width: `${Math.max(3, evaluation.completedRuns / evaluation.totalRuns * 100)}%` }} /></div>}
      {activeNav !== "评测矩阵" ? <ManagementPages activeNav={activeNav} state={state} evaluation={evaluation} selectedDatasetId={selectedDatasetId} setSelectedDatasetId={setSelectedDatasetId} openDatasetImport={() => setShowDataset(true)} openApi={() => setShowApi(true)} openRun={openRun} openEvaluation={(page = "评测任务") => setActiveNav(page)} openMatrix={openMatrix} exportEvaluation={exportEvaluation} deleteDataset={deleteDataset} updateDataset={updateDataset} deleteEvaluation={deleteEvaluation} openReview={openReview} saveSettings={saveSettings} loadDemo={loadDemo} demoBusy={busy === "demo"} /> : <>
      <section className="workspace-header"><div><div className="eyebrow">评测任务 / {dataset?.name || "未选择数据集"} / {evaluation ? evaluation.name : "尚未运行"}</div><h1>模型对比矩阵 <span>{models.length} 个模型 · {cases.length} 条测试用例{evaluation ? ` · 重复 ${evaluation.repeatCount || 1} 次` : ""}</span></h1></div><div className="header-actions"><div className="view-tabs"><button className={view === "matrix" ? "active" : ""} onClick={() => setView("matrix")}>评测矩阵</button><button className={view === "grid" ? "active" : ""} onClick={() => setView("grid")}>全部网格</button><button className={view === "blind" ? "active" : ""} onClick={() => setView("blind")}>盲测对战</button></div><button className="model-picker-button" onClick={() => { setDraftModels(selectedModels); setShowModels(true); }} disabled={Boolean(evaluation && ["queued", "running"].includes(evaluation.status))}><SlidersHorizontal />选择模型 <strong>{selectedModels.length}</strong></button></div></section>

      <section className="filters"><select className="filter-button" value={scoreFilter} onChange={(event) => setScoreFilter(event.target.value)}><option value="all">状态：全部</option><option value="pass">全部通过</option><option value="review">需要复核</option><option value="failed">包含失败</option></select><label className="search-box"><MagnifyingGlass /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索 ID、输入或标签" /></label><button className="api-shortcut" onClick={() => setShowDataset(true)}><UploadSimple />导入数据集</button><button className="api-shortcut" onClick={() => setShowApi(true)}><PlugsConnected />API 连接</button></section>

      {models.length < 2 ? <section className="empty-state"><Robot /><h2>至少需要两个可用模型</h2><p>先添加 API 连接和模型，然后在同一页面横向对比 2–8 个模型。</p><button className="primary-button" onClick={() => setShowApi(true)}><Plus />添加 API 连接</button></section> : view === "matrix" ? <section className="matrix-layout">
        <div className="matrix-panel"><div className="matrix-scroll"><table className={`matrix-table models-${models.length}`}><thead><tr><th className="case-head">测试用例</th>{models.map((model) => { const summary = summaries.get(model.id) || {}; return <th key={model.id}><div className="model-head"><div className="model-title"><ModelMark model={model} /><div><strong>{model.name}</strong><span>{model.provider}</span></div></div><div className="model-score">{Number.isFinite(summary.score) ? summary.score.toFixed(1) : "—"}</div><div className="model-metrics"><span>通过 {summary.pass || 0}%</span><span>{summary.latency}</span><span>{summary.cost}</span></div></div></th>; })}</tr></thead><tbody>{visibleCases.map((item, caseIndex) => <tr key={item.id} className={selectedCase === item.id ? "selected" : ""} onClick={() => setSelectedCase(item.id)}><td><div className="case-cell"><CaretRight className={selectedCase === item.id ? "open" : ""} /><div><strong>{item.id}　{shortText(item.input)}</strong><span>{item.tags?.join(" · ") || "未分类"}</span></div></div></td>{models.map((model) => <td key={model.id}><ScoreState score={getScore(item, model)} /></td>)}</tr>)}</tbody></table></div><div className="pagination"><span>显示 {visibleCases.length} / {cases.length} 条</span><span>{isPreview ? "尚未运行评测" : `已完成 ${evaluation.completedRuns}/${evaluation.totalRuns} 次调用`}</span></div></div>
        <aside className="inspector"><div className="inspector-tabs"><button className="active">用例详情</button><button onClick={() => notify("评分说明已展示在下方")}>评估说明</button></div><h3>用例信息</h3><dl><div><dt>ID</dt><dd>{currentCase?.id || "—"}</dd></div><div><dt>场景</dt><dd>{currentCase?.tags?.join("、") || "未分类"}</dd></div><div><dt>期望关键词</dt><dd>{currentCase?.expectedKeywords?.join("、") || "人工评审"}</dd></div></dl><h3>评分标准（Rubric）</h3><div className="rubric-inspector">{(evaluation?.rubric?.criteria || []).map((item, index, criteria) => <div key={item.id || `${item.name}-${index}`}><span><strong>{item.name}</strong><em>{Math.round(Number(item.normalizedWeight ?? (Number(item.weight || 1) / criteria.reduce((sum, entry) => sum + Number(entry.weight || 1), 0))) * 100)}%</em></span><p>{item.description || "按维度名称判断"}</p></div>)}{!evaluation && <p className="rubric-copy">运行评测后显示多维 Rubric 与权重。</p>}</div><h3>评测方法</h3><div className="failure-list"><span><i className="dot blue" />{evaluation?.judge?.enabled ? "LLM-as-a-Judge 逐维评分" : "关键词启发式逐维代理"}</span><span><i className="dot amber" />{evaluation?.comparisonMode === "baseline" ? "公平基线：统一参数" : "模型优化：独立参数"}</span><span><i className="dot red" />每条用例重复 {evaluation?.repeatCount || 1} 次</span></div></aside>
        <div className="case-detail"><div className="detail-heading"><div><strong>已展开：{currentCase?.id}　{shortText(currentCase?.input, 52)}</strong><span>期望关键词：{currentCase?.expectedKeywords?.join("、") || "未配置，将等待人工评审"}</span></div></div><div className="result-strip" style={{ "--columns": Math.min(models.length, 8) }}>{models.map((model) => { const results = currentCase ? getResults(currentCase.id, model) : []; const result = results[0]; const score = currentCase ? getScore(currentCase, model) : null; const output = result?.text || (evaluation?.status === "running" ? "等待模型返回…" : result?.error || "尚未运行评测"); return <article className="result-card" key={model.id}><header><div><ModelMark model={model} /><strong>{model.name}</strong></div><ScoreState score={score} /></header><span className="attempt-badge">{results.length}/{evaluation?.repeatCount || 1} 次 · 展示第 1 次</span><p>{output}</p>{result?.assessment?.dimensions?.length ? <div className="dimension-mini">{result.assessment.dimensions.map((item) => <span key={item.criterionId}>{item.name}<b>{item.score ?? "人工"}</b></span>)}</div> : null}{result ? result.error ? <div className="verdict risk"><XCircle />{result.error}</div> : <div className={`verdict ${score >= 8 ? "safe" : score >= 6.5 ? "review" : "risk"}`}>{score >= 8 ? <><ShieldCheck />通过</> : score >= 6.5 ? <><WarningCircle />建议复核</> : <><XCircle />未通过</>}</div> : <div className="verdict review"><WarningCircle />等待运行</div>}<button className="card-action" disabled={!result} onClick={() => setReviewing({ result, model, score: result.assessment?.score ?? 0, verdict: "reviewed", notes: "" })}>{result ? "查看第 1 次输出与复核" : "运行后可查看"}</button></article>; })}</div></div>
      </section> : view === "grid" ? <section className="alternate-view"><div className="alternate-heading"><h2>全部模型结果</h2><span>每张卡片展示第 1 次回答与重复运行均分</span></div><div className={`output-grid count-${Math.min(models.length, 8)}`}>{models.map((model) => { const result = currentCase && getResult(currentCase.id, model); const results = currentCase ? getResults(currentCase.id, model) : []; const score = currentCase ? getScore(currentCase, model) : null; return <article className="large-output" key={model.id}><header><div><ModelMark model={model} /><div><strong>{model.name}</strong><span>{model.provider} · {results.length}/{evaluation?.repeatCount || 1} 次</span></div></div><ScoreState score={score} /></header><p>{result?.text || "尚未运行评测"}</p><footer><span>平均延迟 {results.length ? `${(results.reduce((sum, item) => sum + item.latencyMs, 0) / results.length / 1000).toFixed(2)}s` : "—"}</span><span>总成本 {formatMoney(results.reduce((sum, item) => sum + Number(item.cost || 0), 0))}</span><button disabled={!result} onClick={() => result && setReviewing({ result, model, score: result.assessment?.score ?? 0, verdict: "reviewed", notes: "" })}>人工复核</button></footer></article>; })}</div></section> : <section className="alternate-view blind-workspace"><div className="alternate-heading"><h2>匿名两两对战</h2><span>{blindComparison ? `${currentCase?.id} · 第 ${blindComparison.attempt} 次 · ${caseBlindComparisons.filter((item) => item.verdict).length}/${caseBlindComparisons.length} 已判` : "任务完成后自动生成全部模型组合"}</span></div>{!evaluation || ["queued", "running"].includes(evaluation.status) ? <div className="blind-empty"><Eye /><strong>等待评测完成</strong><span>完成后会隐藏模型身份，按同一用例和同一次运行生成 A/B 对战。</span></div> : !blindComparison ? <div className="blind-empty"><Eye /><strong>没有可用对战</strong><span>请确认至少两个模型都返回了结果。</span></div> : <><div className="blind-prompt"><span>统一输入</span><p>{currentCase?.input}</p></div><div className="blind-pair"><article><header><span>匿名回答 A</span>{blindComparison.verdict && <strong>{blindLeftModel?.name || "模型 A"}</strong>}</header><p>{blindLeftResult?.text || blindLeftResult?.error || "无输出"}</p></article><article><header><span>匿名回答 B</span>{blindComparison.verdict && <strong>{blindRightModel?.name || "模型 B"}</strong>}</header><p>{blindRightResult?.text || blindRightResult?.error || "无输出"}</p></article></div><div className="blind-vote"><span>{blindComparison.verdict ? "本轮身份已揭示；切换用例或继续处理未判对战" : "仅根据回答质量作出判断，提交前不会显示模型名"}</span>{blindComparison.verdict ? <div><button onClick={() => setActiveBlindComparisonId(caseBlindComparisons.find((item) => !item.verdict && item.id !== blindComparison.id)?.id || "")}>下一场</button></div> : <div><button disabled={busy === `blind-${blindComparison.id}`} onClick={() => saveBlindVerdict(blindComparison, "left")}>A 更好</button><button disabled={busy === `blind-${blindComparison.id}`} onClick={() => saveBlindVerdict(blindComparison, "tie")}>平局</button><button disabled={busy === `blind-${blindComparison.id}`} onClick={() => saveBlindVerdict(blindComparison, "both_fail")}>都不合格</button><button disabled={busy === `blind-${blindComparison.id}`} onClick={() => saveBlindVerdict(blindComparison, "right")}>B 更好</button></div>}</div></>}</section>}</>}
    </main>

    {showModels && <Modal className="model-modal" onClose={() => setShowModels(false)}><header><div><h2>选择待测模型</h2><p>选择 2–8 个模型；支持同一 API 连接下的多个型号。</p></div><button className="close-button" onClick={() => setShowModels(false)}><X /></button></header><div className="selection-count"><span>已选择 <strong>{draftModels.length}</strong> / 8</span><button onClick={() => { setShowApi(true); setShowModels(false); }}><Plus />添加 API 连接</button></div><div className="provider-groups">{state.connections.map((connection) => <div className="provider-group" key={connection.id}><div className="provider-label"><div><strong>{connection.provider}</strong><span>{connection.name} · {connection.models.length} 个模型</span></div><CheckCircle weight="fill" /></div>{connection.models.map((name) => { const id = `${connection.id}:${name}`; const model = availableModels.find((item) => item.id === id); const checked = draftModels.includes(id); return <button key={id} className={`model-option ${checked ? "selected" : ""}`} onClick={() => toggleDraft(id)}><span className="checkbox">{checked && <Check weight="bold" />}</span><ModelMark model={model} /><span><strong>{name}</strong><small>{connection.name}</small></span></button>; })}</div>)}</div><footer><span>模型数量改变后，矩阵和结果网格会自动重新布局。</span><div><button className="secondary-button" onClick={() => setShowModels(false)}>取消</button><button className="primary-button" disabled={draftModels.length < 2} onClick={() => { setSelectedModels(draftModels); setActiveEvaluationId(""); setShowModels(false); }}>应用 {draftModels.length} 个模型</button></div></footer></Modal>}

    {showApi && <div className="drawer-backdrop" onMouseDown={() => setShowApi(false)}><aside className="api-drawer" onMouseDown={(event) => event.stopPropagation()}><header><div><span className="drawer-icon"><Key /></span><div><h2>API 连接</h2><p>密钥仅由本地后端加密保存与调用</p></div></div><button className="close-button" onClick={() => setShowApi(false)}><X /></button></header><div className="security-note"><ShieldCheck weight="fill" /><span><strong>本地安全存储</strong>页面不会读取或返回完整 API Key，列表只显示末四位。</span></div><div className="connection-list">{state.connections.map((connection) => <article key={connection.id}><div className="connection-icon"><PlugsConnected /></div><div><strong>{connection.provider} · {connection.name}</strong><span>{connection.models.length} 个模型 · {connection.hasApiKey ? `Key •••• ${connection.keySuffix}` : "无需 Key"}</span></div><span className="connected"><CheckCircle weight="fill" />已连接</span><button aria-label={`删除 ${connection.name}`} disabled={busy === `delete-${connection.id}`} onClick={() => deleteConnection(connection)}><Trash /></button></article>)}</div><button className="add-connection" onClick={() => setShowConnectionForm(true)}><Plus />添加 API 连接</button><div className="drawer-help"><CloudArrowUp /><div><strong>支持自定义 Endpoint</strong><span>兼容 OpenAI、Anthropic、Gemini、Ollama、vLLM 及 OpenAI-compatible API。</span></div></div><footer><button className="secondary-button" onClick={() => setShowApi(false)}>完成</button></footer></aside></div>}

    {showConnectionForm && <Modal className="form-modal" onClose={() => setShowConnectionForm(false)}><header><div><h2>添加 API 连接</h2><p>一个厂商账号可配置多个模型型号。</p></div><button className="close-button" onClick={() => setShowConnectionForm(false)}><X /></button></header><form onSubmit={saveConnection}><div className="form-grid"><label><span>连接名称</span><input required value={connectionForm.name} onChange={(event) => setConnectionForm({ ...connectionForm, name: event.target.value })} placeholder="例如：生产账号" /></label><label><span>接口类型</span><select value={connectionForm.provider} onChange={(event) => setConnectionForm({ ...connectionForm, provider: event.target.value, baseUrl: providerPresets[event.target.value] })}><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="gemini">Gemini</option><option value="compatible">OpenAI-compatible / 本地模型</option><option value="mock">Mock（离线演示）</option></select></label><label className="full"><span>Base URL</span><input required value={connectionForm.baseUrl} onChange={(event) => setConnectionForm({ ...connectionForm, baseUrl: event.target.value })} /></label><label className="full"><span>API Key {connectionForm.provider === "mock" && <small>（Mock 可留空）</small>}</span><input type="password" autoComplete="new-password" required={connectionForm.provider !== "mock"} value={connectionForm.apiKey} onChange={(event) => setConnectionForm({ ...connectionForm, apiKey: event.target.value })} placeholder="仅发送到本机 EvalHub 服务" /></label><label className="full"><span>模型列表</span><textarea required value={connectionForm.models} onChange={(event) => setConnectionForm({ ...connectionForm, models: event.target.value })} placeholder="用逗号或换行分隔，例如：model-a, model-b" /></label></div>{connectionTest && <div className={`inline-result ${connectionTest.ok ? "success" : "error"}`}>{connectionTest.ok ? `连接成功，发现 ${connectionTest.models?.length || 0} 个模型` : connectionTest.error}</div>}<footer><button type="button" className="secondary-button" disabled={busy === "connection-test"} onClick={testConnection}>{busy === "connection-test" ? "测试中…" : "测试连接"}</button><button className="primary-button" disabled={busy === "connection-save"}>{busy === "connection-save" ? "保存中…" : "加密保存"}</button></footer></form></Modal>}

    {showDataset && <Modal className="form-modal dataset-modal" onClose={() => setShowDataset(false)}><header><div><h2>导入评测数据集</h2><p>支持 JSONL、JSON 数组和简单 CSV；所有数据只保存在本地。</p></div><button className="close-button" onClick={() => setShowDataset(false)}><X /></button></header><form onSubmit={importDataset}><div className="form-grid"><label><span>数据集名称</span><input required value={datasetForm.name} onChange={(event) => setDatasetForm({ ...datasetForm, name: event.target.value })} placeholder="例如：客服安全测试集" /></label><label><span>当前数据集</span><select value={selectedDatasetId} disabled={!state.datasets.length} onChange={(event) => setSelectedDatasetId(event.target.value)}>{!state.datasets.length && <option value="">尚无数据集</option>}{state.datasets.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.cases.length} 条</option>)}</select></label><label className="full"><span>说明</span><input value={datasetForm.description} onChange={(event) => setDatasetForm({ ...datasetForm, description: event.target.value })} placeholder="数据来源和用途（请勿粘贴敏感数据）" /></label><label className="full file-label"><span>上传 CSV / JSONL</span><input type="file" accept=".csv,.json,.jsonl,text/csv,application/json" onChange={(event) => readDatasetFile(event.target.files?.[0])} /></label><label className="full"><span>数据内容</span><textarea className="dataset-text" required value={datasetForm.text} onChange={(event) => setDatasetForm({ ...datasetForm, text: event.target.value })} placeholder={'id,input,expected_keywords,tags\nTC-001,退款规则是什么,退款|规则,售后'} /></label></div><footer><span className="format-help">关键词与标签使用 | 分隔；CSV 中暂不支持带换行的字段。</span><button className="primary-button" disabled={busy === "dataset"}>{busy === "dataset" ? "导入中…" : "导入并选用"}</button></footer></form></Modal>}

    {showRun && <RunEvaluationModal runForm={runForm} setRunForm={setRunForm} selectedModels={selectedModels} selectedDatasetId={selectedDatasetId} setSelectedDatasetId={setSelectedDatasetId} state={state} availableModels={availableModels} defaultModelParams={defaultModelParams} setModelParam={setModelParam} toggleModelParams={toggleModelParams} setRubricCriterion={setRubricCriterion} addRubricCriterion={addRubricCriterion} removeRubricCriterion={removeRubricCriterion} onClose={() => setShowRun(false)} onSubmit={createEvaluation} busy={busy} />}

    {reviewing && <Modal className="form-modal review-modal" onClose={() => setReviewing(null)}><header><div><h2>{reviewing.model.name} · 人工复核</h2><p>{reviewing.result.caseId} · 自动评分 {reviewing.result.assessment?.score ?? "—"}</p></div><button className="close-button" onClick={() => setReviewing(null)}><X /></button></header><form onSubmit={saveReview}><div className="full-output"><strong>模型原始输出</strong><p>{reviewing.result.text || reviewing.result.error}</p><span>评分依据：{reviewing.result.assessment?.reason}</span></div><div className="form-grid"><label><span>人工结论</span><select value={reviewing.verdict} onChange={(event) => setReviewing({ ...reviewing, verdict: event.target.value })}><option value="approved">通过</option><option value="reviewed">已复核</option><option value="rejected">不通过</option></select></label><label><span>人工分数（0–10）</span><input type="number" min="0" max="10" step="0.1" required value={reviewing.score} onChange={(event) => setReviewing({ ...reviewing, score: event.target.value })} /></label><label className="full"><span>复核备注</span><textarea value={reviewing.notes} onChange={(event) => setReviewing({ ...reviewing, notes: event.target.value })} placeholder="记录判断依据或后续动作" /></label></div><footer><button className="primary-button" disabled={busy === "review"}>{busy === "review" ? "保存中…" : "保存复核"}</button></footer></form></Modal>}

    {toast && <div className="toast"><CheckCircle weight="fill" />{toast}</div>}
  </div>;
}
