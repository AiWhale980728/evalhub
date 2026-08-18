import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight, ChartBar, CheckCircle, ClipboardText, Database, DownloadSimple, Eye,
  FileText, GearSix, ImageSquare, Key, Plus, Pulse, Robot, ShieldCheck, Trash, WarningCircle, XCircle,
} from "@phosphor-icons/react";

const statusLabel = { queued: "排队中", running: "运行中", completed: "已完成", completed_with_errors: "部分失败", failed: "失败" };
const modelTypeLabel = { text: "文本模型", image: "生图模型" };
const resultScore = (result) => Number.isFinite(result?.humanScore) ? result.humanScore : result?.assessment?.score;
const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const money = (value) => `$${Number(value || 0).toFixed(value >= 0.01 ? 3 : 5)}`;
const short = (value, length = 52) => value?.length > length ? `${value.slice(0, length)}…` : value || "—";
const percentile = (values, ratio) => values.length ? [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * ratio) - 1)] : null;

function decisionRows(run) {
  if (!run) return [];
  const blind = new Map(run.models.map((model) => [model.key, { wins: 0, battles: 0 }]));
  for (const item of run.blindComparisons || []) {
    if (!item.verdict) continue;
    const left = blind.get(item.leftModelKey); const right = blind.get(item.rightModelKey);
    if (!left || !right) continue;
    left.battles += 1; right.battles += 1;
    if (item.verdict === "left") left.wins += 1;
    else if (item.verdict === "right") right.wins += 1;
    else if (item.verdict === "tie") { left.wins += 0.5; right.wins += 0.5; }
  }
  return run.models.map((model) => {
    const results = (run.results || []).filter((item) => item.modelKey === model.key);
    const scores = results.map(resultScore).filter(Number.isFinite);
    const latencies = results.map((item) => Number(item.latencyMs)).filter((item) => item > 0);
    const quality = average(scores);
    const variance = scores.length ? average(scores.map((item) => (item - quality) ** 2)) : null;
    const totalCost = results.reduce((sum, item) => sum + Number(item.cost || 0), 0);
    const caseCount = new Set(results.map((item) => item.caseId)).size;
    const duel = blind.get(model.key);
    return {
      modelKey: model.key, model: model.model, quality,
      minimum: scores.length ? Math.min(...scores) : null, stdDev: variance == null ? null : Math.sqrt(variance),
      passRate: scores.length ? scores.filter((item) => item >= 8).length / scores.length * 100 : null,
      avgLatency: average(latencies), p95Latency: percentile(latencies, .95), totalCost,
      costPerCase: totalCost / Math.max(1, caseCount), runs: results.length,
      winRate: duel?.battles ? duel.wins / duel.battles * 100 : null, battles: duel?.battles || 0,
    };
  }).map((row, _, rows) => ({
    ...row,
    pareto: !rows.some((other) => other.modelKey !== row.modelKey && Number(other.quality) >= Number(row.quality) && Number(other.costPerCase) <= Number(row.costPerCase) && Number(other.p95Latency || Infinity) <= Number(row.p95Latency || Infinity) && (Number(other.quality) > Number(row.quality) || Number(other.costPerCase) < Number(row.costPerCase) || Number(other.p95Latency || Infinity) < Number(row.p95Latency || Infinity))),
  })).sort((a, b) => Number(b.quality || 0) - Number(a.quality || 0));
}

function DecisionScatter({ rows, xKey, xLabel, formatX }) {
  const values = rows.map((item) => Number(item[xKey] || 0));
  const maximum = Math.max(...values, 0.000001);
  return <section className="decision-scatter"><header><strong>质量 × {xLabel}</strong><span>越靠左上越优</span></header><div className="scatter-plot"><i className="axis-y">质量</i><i className="axis-x">{xLabel}</i>{rows.map((row, index) => {
    const peers = rows.filter((item) => Number(item[xKey] || 0) === Number(row[xKey] || 0) && Number(item.quality || 0) === Number(row.quality || 0));
    const peerIndex = peers.findIndex((item) => item.modelKey === row.modelKey);
    const offset = (peerIndex - (peers.length - 1) / 2) * 3.2;
    return <span key={row.modelKey} className={row.pareto ? "pareto" : ""} style={{ left: `${8 + Number(row[xKey] || 0) / maximum * 82 + offset}%`, bottom: `${8 + Number(row.quality || 0) / 10 * 82}%` }} title={`${row.model}：质量 ${row.quality?.toFixed(2) || "—"}，${xLabel} ${formatX(row[xKey])}`}><b>{index + 1}</b></span>;
  })}</div><div className="scatter-legend">{rows.map((row, index) => <span key={row.modelKey}><b>{index + 1}</b>{short(row.model, 18)}</span>)}</div></section>;
}

function PageHeader({ eyebrow, title, description, children }) {
  return <header className="module-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="module-actions">{children}</div></header>;
}

function Empty({ icon: Icon, title, text, action }) {
  return <div className="module-empty"><Icon /><strong>{title}</strong><span>{text}</span>{action}</div>;
}

function Stat({ label, value, hint, tone = "blue" }) {
  return <article className={`stat-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{hint}</small></article>;
}

export function ManagementPages({
  activeNav, state, evaluation, selectedDatasetId, setSelectedDatasetId, openDatasetImport,
  openApi, openRun, openEvaluation, openMatrix, exportEvaluation, deleteDataset,
  updateDataset, deleteEvaluation, openReview, saveSettings, loadDemo, demoBusy,
}) {
  const [caseQuery, setCaseQuery] = useState("");
  const [editingCase, setEditingCase] = useState(null);
  const [settings, setSettings] = useState(state.settings || {});
  const [decisionFilters, setDecisionFilters] = useState({ quality: 0, cost: "", latency: "" });
  useEffect(() => setSettings(state.settings || {}), [state.settings]);

  const completed = state.evaluations.filter((item) => !["queued", "running"].includes(item.status));
  const allResults = useMemo(() => completed.flatMap((run) => run.results.map((result) => ({ run, result }))), [completed]);
  const scored = allResults.filter(({ result }) => Number.isFinite(resultScore(result)));
  const failures = allResults.filter(({ result }) => result.error || Number(resultScore(result)) < 6.5);
  const reviewQueue = allResults.filter(({ run, result }) => {
    const reviewed = run.reviews?.some((item) => item.resultId === result.id || (!item.resultId && item.caseId === result.caseId && item.modelKey === result.modelKey));
    return !reviewed && (result.error || !Number.isFinite(resultScore(result)) || resultScore(result) < 8);
  });
  const selectedDataset = state.datasets.find((item) => item.id === selectedDatasetId) || state.datasets[0];
  const totalCost = allResults.reduce((sum, { result }) => sum + Number(result.cost || 0), 0);
  const avgScore = average(scored.map(({ result }) => resultScore(result)));
  const avgLatency = average(allResults.filter(({ result }) => result.latencyMs > 0).map(({ result }) => result.latencyMs));
  const providerCount = new Set(state.connections.map((item) => item.provider)).size;

  function beginEdit(testCase) {
    setEditingCase({ ...testCase, expectedKeywordsText: (testCase.expectedKeywords || []).join(" | "), tagsText: (testCase.tags || []).join(" | ") });
  }

  async function commitCase(event) {
    event.preventDefault();
    const nextCase = {
      id: editingCase.id.trim(), input: editingCase.input.trim(),
      expectedKeywords: editingCase.expectedKeywordsText.split("|").map((item) => item.trim()).filter(Boolean),
      tags: editingCase.tagsText.split("|").map((item) => item.trim()).filter(Boolean),
    };
    const cases = editingCase.originalId
      ? selectedDataset.cases.map((item) => item.id === editingCase.originalId ? nextCase : item)
      : [...selectedDataset.cases, nextCase];
    await updateDataset(selectedDataset, cases);
    setEditingCase(null);
  }

  async function removeCase(testCase) {
    if (selectedDataset.cases.length <= 1) return;
    await updateDataset(selectedDataset, selectedDataset.cases.filter((item) => item.id !== testCase.id));
  }

  function Overview() {
    const latest = state.evaluations.slice(0, 5);
    const pristine = state.connections.length === 0 && state.datasets.length === 0 && state.evaluations.length === 0;
    const demoLoaded = state.connections.some((item) => item.id === "connection-mock") && state.datasets.some((item) => item.id === "dataset-demo-rag");
    return <><PageHeader eyebrow="工作台 / 概览" title="模型评测概览" description="从数据准备、模型接入到复核导出，快速掌握本地评测状态。"><button className="secondary-button" disabled={demoBusy || demoLoaded} onClick={loadDemo}><ChartBar />{demoBusy ? "正在加载…" : demoLoaded ? "示例已加载" : "加载示例项目"}</button><button className="primary-button" onClick={openRun}><Plus />新建评测</button></PageHeader>
      {pristine ? <section className="onboarding-card"><div><span className="onboarding-mark"><ChartBar weight="fill" /></span><div><strong>这是一个全新的本地工作台</strong><p>先连接你自己的模型 API，再导入评测数据集。这里不会预置虚构的评分、历史任务或业务数据。</p></div></div><ol><li><b>1</b><span><strong>连接模型</strong><small>添加厂商 API 与模型型号</small></span></li><li><b>2</b><span><strong>导入数据</strong><small>CSV、JSON 或 JSONL</small></span></li><li><b>3</b><span><strong>开始评测</strong><small>同时比较 2–8 个模型</small></span></li></ol><footer><button className="primary-button" onClick={openApi}><Key />添加 API 连接</button><button className="secondary-button" onClick={openDatasetImport}><Database />导入数据集</button></footer></section> : null}
      <div className="stat-grid"><Stat label="API 连接" value={state.connections.length} hint={`${providerCount} 类厂商`} /><Stat label="可用模型" value={state.connections.reduce((sum, item) => sum + item.models.length, 0)} hint="支持单厂商多型号" tone="indigo" /><Stat label="数据集 / 用例" value={`${state.datasets.length} / ${state.datasets.reduce((sum, item) => sum + item.cases.length, 0)}`} hint="全部保存在本地" tone="green" /><Stat label="已完成评测" value={completed.length} hint={`${allResults.length} 次模型调用`} tone="amber" /></div>
      <div className="module-grid two"><section className="module-card"><header><div><strong>最近评测</strong><span>任务状态与进度</span></div><button onClick={() => openEvaluation()}>查看全部 <ArrowRight /></button></header>{latest.length ? <div className="compact-list">{latest.map((run) => <button key={run.id} onClick={() => openMatrix(run.id)}><span className={`status-dot ${run.status}`} /><div><strong>{run.name}</strong><small>{run.datasetName} · {run.models.length} 个模型</small></div><em>{statusLabel[run.status] || run.status}</em></button>)}</div> : <Empty icon={ChartBar} title="还没有评测任务" text="完成模型连接和数据导入后即可创建。" />}</section>
      <section className="module-card"><header><div><strong>评测质量</strong><span>全部历史任务汇总</span></div></header><div className="quality-summary"><div><strong>{avgScore == null ? "—" : avgScore.toFixed(1)}</strong><span>平均得分</span></div><div><strong>{allResults.length ? `${Math.round((allResults.length - failures.length) / allResults.length * 100)}%` : "—"}</strong><span>非失败率</span></div><div><strong>{reviewQueue.length}</strong><span>待人工复核</span></div><div><strong>{money(totalCost)}</strong><span>估算成本</span></div></div><button className="wide-action" onClick={() => openEvaluation("指标看板")}>查看指标看板 <ArrowRight /></button></section></div></>;
  }

  function Datasets() {
    return <><PageHeader eyebrow="评测资产 / 数据集" title="数据集管理" description="管理评测数据集、查看覆盖场景，并安全地导入或删除未被引用的数据。"><button className="primary-button" onClick={openDatasetImport}><Plus />导入数据集</button></PageHeader>
      {!selectedDataset ? <section className="module-card table-card"><Empty icon={Database} title="还没有数据集" text="导入 CSV、JSON 或 JSONL 后即可创建测试用例和评测任务。" action={<button className="primary-button" onClick={openDatasetImport}>导入第一个数据集</button>} /></section> :
      <div className="asset-layout"><aside className="asset-list">{state.datasets.map((item) => <button key={item.id} className={selectedDataset?.id === item.id ? "active" : ""} onClick={() => setSelectedDatasetId(item.id)}><Database /><div><strong>{item.name}</strong><span>{item.cases.length} 条用例 · {new Set(item.cases.flatMap((entry) => entry.tags || [])).size} 个场景</span></div><ArrowRight /></button>)}</aside>
      <section className="module-card asset-detail"><header><div><strong>{selectedDataset?.name}</strong><span>{selectedDataset?.description || "暂无说明"}</span></div><button className="danger-link" onClick={() => deleteDataset(selectedDataset)}><Trash />删除</button></header><div className="dataset-facts"><span><strong>{selectedDataset?.cases.length || 0}</strong> 测试用例</span><span><strong>{new Set(selectedDataset?.cases.flatMap((item) => item.tags || [])).size || 0}</strong> 覆盖场景</span><span><strong>{new Set(selectedDataset?.cases.flatMap((item) => item.expectedKeywords || [])).size || 0}</strong> 关键词</span></div><div className="tag-cloud">{[...new Set(selectedDataset?.cases.flatMap((item) => item.tags || []))].map((tag) => <span key={tag}>{tag}</span>)}</div><button className="wide-action" onClick={() => openEvaluation("测试用例")}>管理测试用例 <ArrowRight /></button></section></div>}</>;
  }

  function TestCases() {
    if (!selectedDataset) return <><PageHeader eyebrow="评测资产 / 测试用例" title="测试用例" description="维护输入、期望关键词和场景标签；修改后会用于下一次评测。" /><section className="module-card table-card"><Empty icon={ClipboardText} title="请先创建数据集" text="测试用例必须归属于一个数据集。" action={<button className="primary-button" onClick={openDatasetImport}>导入数据集</button>} /></section></>;
    const visible = (selectedDataset?.cases || []).filter((item) => `${item.id}${item.input}${item.tags?.join("")}`.toLowerCase().includes(caseQuery.toLowerCase()));
    return <><PageHeader eyebrow="评测资产 / 测试用例" title="测试用例" description="维护输入、期望关键词和场景标签；修改后会用于下一次评测。"><button className="primary-button" onClick={() => beginEdit({ id: `TC-${String((selectedDataset?.cases.length || 0) + 1).padStart(3, "0")}`, originalId: "", input: "", expectedKeywords: [], tags: [] })}><Plus />新增用例</button></PageHeader>
      <section className="module-card table-card"><div className="table-toolbar"><select value={selectedDatasetId} onChange={(event) => setSelectedDatasetId(event.target.value)}>{state.datasets.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.cases.length} 条</option>)}</select><input value={caseQuery} onChange={(event) => setCaseQuery(event.target.value)} placeholder="搜索 ID、问题或标签" /><button className="secondary-button" onClick={openDatasetImport}>批量导入</button></div><div className="data-table"><div className="data-row head"><span>ID</span><span>输入</span><span>期望关键词</span><span>场景</span><span>操作</span></div>{visible.map((item) => <div className="data-row" key={item.id}><strong>{item.id}</strong><span title={item.input}>{short(item.input)}</span><span>{item.expectedKeywords?.join("、") || "人工评审"}</span><span>{item.tags?.join("、") || "未分类"}</span><div><button onClick={() => beginEdit({ ...item, originalId: item.id })}>编辑</button><button className="danger-link" disabled={selectedDataset.cases.length <= 1} onClick={() => removeCase(item)}>删除</button></div></div>)}</div></section>
      {editingCase && <div className="inline-editor"><form onSubmit={commitCase}><header><div><strong>{editingCase.originalId ? "编辑测试用例" : "新增测试用例"}</strong><span>保存到 {selectedDataset.name}</span></div><button type="button" onClick={() => setEditingCase(null)}><XCircle /></button></header><div className="editor-grid"><label><span>用例 ID</span><input required value={editingCase.id} onChange={(event) => setEditingCase({ ...editingCase, id: event.target.value })} /></label><label className="full"><span>输入内容</span><textarea required value={editingCase.input} onChange={(event) => setEditingCase({ ...editingCase, input: event.target.value })} /></label><label><span>期望关键词（| 分隔）</span><input value={editingCase.expectedKeywordsText} onChange={(event) => setEditingCase({ ...editingCase, expectedKeywordsText: event.target.value })} /></label><label><span>场景标签（| 分隔）</span><input value={editingCase.tagsText} onChange={(event) => setEditingCase({ ...editingCase, tagsText: event.target.value })} /></label></div><footer><button type="button" className="secondary-button" onClick={() => setEditingCase(null)}>取消</button><button className="primary-button">保存用例</button></footer></form></div>}</>;
  }

  function Tasks() {
    return <><PageHeader eyebrow="评测执行 / 评测任务" title="评测任务" description="创建、追踪和管理全部评测任务；任务完成后可进入矩阵查看。"><button className="primary-button" onClick={openRun}><Plus />新建评测</button></PageHeader>
      <section className="module-card table-card"><div className="data-table tasks"><div className="data-row head"><span>任务</span><span>数据集</span><span>模型 / 调用</span><span>状态</span><span>创建时间</span><span>操作</span></div>{state.evaluations.map((run) => <div className="data-row" key={run.id}><div><strong>{run.name}</strong><small>{modelTypeLabel[run.modelType || "text"]} · {run.comparisonMode === "baseline" ? "统一基线" : "模型优化"} · 重复 {run.repeatCount || 1} 次 · {run.models.map((item) => item.model).join(" · ")}</small></div><span>{run.datasetName}</span><span>{run.models.length} / {run.completedRuns}/{run.totalRuns}</span><span className={`status-pill ${run.status}`}>{statusLabel[run.status] || run.status}</span><span>{new Date(run.createdAt).toLocaleString("zh-CN")}</span><div><button onClick={() => openMatrix(run.id)}>查看</button><button className="danger-link" disabled={["queued", "running"].includes(run.status)} onClick={() => deleteEvaluation(run)}>删除</button></div></div>)}{!state.evaluations.length && <Empty icon={CheckCircle} title="暂无评测任务" text="创建任务后可在这里追踪进度。" action={<button className="primary-button" onClick={openRun}>立即创建</button>} />}</div></section></>;
  }

  function Models() {
    return <><PageHeader eyebrow="模型接入 / 模型管理" title="模型与 API 连接" description="统一管理厂商连接和模型型号；API Key 只在本机加密保存。"><button className="primary-button" onClick={openApi}><Key />管理 API 连接</button></PageHeader>
      <div className="connection-grid">{state.connections.map((connection) => { const Icon = (connection.modelType || "text") === "image" ? ImageSquare : Robot; return <article className="connection-card" key={connection.id}><header><span className="connection-logo"><Icon /></span><div><strong>{connection.name}</strong><small>{modelTypeLabel[connection.modelType || "text"]} · {connection.provider} · {connection.baseUrl}</small></div><em><CheckCircle weight="fill" />已连接</em></header><div className="model-tags">{connection.models.map((model) => <span key={model}>{model}</span>)}</div><footer><span>{connection.models.length} 个模型型号</span><span>{connection.hasApiKey ? `Key •••• ${connection.keySuffix}` : "无需 API Key"}</span></footer></article>; })}{!state.connections.length ? <Empty icon={Robot} title="还没有模型连接" text="添加自己的 API 连接，或在概览页主动加载离线示例。" action={<button className="primary-button" onClick={openApi}>添加 API 连接</button>} /> : null}</div></>;
  }

  function Failures() {
    return <><PageHeader eyebrow="质量分析 / 失败分析" title="失败分析" description="聚合低分、调用错误与常见失败场景，直接进入人工复核。"><button className="secondary-button" onClick={() => openEvaluation("评测矩阵")}>返回矩阵</button></PageHeader>
      <div className="stat-grid"><Stat label="失败结果" value={failures.length} hint={`来自 ${new Set(failures.map(({ run }) => run.id)).size} 个任务`} tone="red" /><Stat label="调用错误" value={failures.filter(({ result }) => result.error).length} hint="接口、超时或模型错误" tone="amber" /><Stat label="低分结果" value={failures.filter(({ result }) => !result.error).length} hint="自动评分低于 6.5" /><Stat label="待复核" value={reviewQueue.length} hint="尚无人工结论" tone="indigo" /></div>
      <section className="module-card table-card"><div className="data-table failures"><div className="data-row head"><span>用例</span><span>模型</span><span>任务</span><span>问题</span><span>分数</span><span>操作</span></div>{failures.map(({ run, result }) => <div className="data-row" key={`${run.id}:${result.id}`}><strong>{result.caseId}</strong><span>{result.model}</span><span>{run.name}</span><span className="failure-reason">{short(result.error || result.assessment?.reason)}</span><span><b className="bad-score">{resultScore(result) ?? 0}</b></span><button onClick={() => openReview(run, result)}>人工复核</button></div>)}{!failures.length && <Empty icon={ShieldCheck} title="暂无失败结果" text="完成真实评测后，这里会自动聚合失败项。" />}</div></section></>;
  }

  function Metrics() {
    const target = evaluation && !["queued", "running"].includes(evaluation.status) ? evaluation : completed[0];
    const rows = decisionRows(target);
    const eligible = rows.filter((row) => Number(row.quality || 0) >= Number(decisionFilters.quality || 0) && (!decisionFilters.cost || row.costPerCase <= Number(decisionFilters.cost)) && (!decisionFilters.latency || row.p95Latency <= Number(decisionFilters.latency) * 1000));
    const recommended = [...eligible].sort((a, b) => Number(b.quality || 0) - Number(a.quality || 0) || a.costPerCase - b.costPerCase || Number(a.p95Latency || Infinity) - Number(b.p95Latency || Infinity))[0];
    const targetResults = target?.results || [];
    const targetScores = targetResults.map(resultScore).filter(Number.isFinite);
    const targetLatency = targetResults.map((item) => item.latencyMs).filter((item) => item > 0);
    return <><PageHeader eyebrow="模型决策 / 质量—成本—延迟" title="模型决策面板" description="在同一评测任务内比较质量、稳定性、成本和尾延迟；推荐只在当前约束下成立。"><button className="secondary-button" onClick={() => target && exportEvaluation(target)}>导出当前报告</button></PageHeader>
      <div className="decision-context"><div><strong>{target?.name || "尚无已完成评测"}</strong><span>{target ? `${target.comparisonMode === "baseline" ? "统一基线" : "模型优化"} · 每条用例 ${target.repeatCount || 1} 次` : "完成评测后生成决策面板"}</span></div>{recommended ? <div className="decision-recommendation"><span>当前约束下优先候选</span><strong>{recommended.model}</strong><small>质量 {recommended.quality?.toFixed(2)} · P95 {(recommended.p95Latency / 1000).toFixed(2)}s · {money(recommended.costPerCase)}/用例</small></div> : <div className="decision-recommendation empty"><span>当前约束下</span><strong>没有模型满足条件</strong></div>}</div>
      <div className="stat-grid"><Stat label="平均质量" value={average(targetScores)?.toFixed(2) || "—"} hint={`${targetScores.length} 个有效评分`} /><Stat label="P95 延迟" value={percentile(targetLatency, .95) == null ? "—" : `${(percentile(targetLatency, .95) / 1000).toFixed(2)}s`} hint="关注尾部响应" tone="indigo" /><Stat label="Pareto 候选" value={rows.filter((item) => item.pareto).length} hint="无明显支配方案" tone="green" /><Stat label="任务总成本" value={money(targetResults.reduce((sum, item) => sum + Number(item.cost || 0), 0))} hint="按价格快照估算" tone="amber" /></div>
      {rows.length ? <><section className="decision-filters"><label><span>最低质量</span><input type="number" min="0" max="10" step="0.1" value={decisionFilters.quality} onChange={(event) => setDecisionFilters({ ...decisionFilters, quality: event.target.value })} /></label><label><span>最高成本 / 用例（USD）</span><input type="number" min="0" step="0.0001" placeholder="不限制" value={decisionFilters.cost} onChange={(event) => setDecisionFilters({ ...decisionFilters, cost: event.target.value })} /></label><label><span>最高 P95 延迟（秒）</span><input type="number" min="0" step="0.1" placeholder="不限制" value={decisionFilters.latency} onChange={(event) => setDecisionFilters({ ...decisionFilters, latency: event.target.value })} /></label><span>{eligible.length}/{rows.length} 个模型满足约束</span></section>
      <div className="decision-charts"><DecisionScatter rows={rows} xKey="costPerCase" xLabel="成本 / 用例" formatX={money} /><DecisionScatter rows={rows} xKey="p95Latency" xLabel="P95 延迟" formatX={(value) => `${(Number(value || 0) / 1000).toFixed(2)}s`} /></div>
      <section className="module-card decision-table"><header><div><strong>决策明细</strong><span>Pareto 表示不存在质量更高、同时更便宜且更快的模型；不代表绝对最佳。</span></div></header><div className="decision-row head"><span>模型</span><span>质量 / 最低</span><span>稳定性 σ</span><span>通过率</span><span>平均 / P95 延迟</span><span>成本 / 用例</span><span>盲测胜率</span><span>结论</span></div>{rows.map((row) => <div className={`decision-row ${eligible.some((item) => item.modelKey === row.modelKey) ? "eligible" : "filtered"}`} key={row.modelKey}><strong>{row.model}</strong><span>{row.quality?.toFixed(2) || "—"} / {row.minimum?.toFixed(1) || "—"}</span><span>{row.stdDev?.toFixed(2) || "—"}</span><span>{row.passRate?.toFixed(0) || "—"}%</span><span>{row.avgLatency ? `${(row.avgLatency / 1000).toFixed(2)}s` : "—"} / {row.p95Latency ? `${(row.p95Latency / 1000).toFixed(2)}s` : "—"}</span><span>{money(row.costPerCase)}</span><span>{row.winRate == null ? "待盲测" : `${row.winRate.toFixed(0)}% · ${row.battles} 场`}</span><em>{recommended?.modelKey === row.modelKey ? "优先候选" : row.pareto ? "Pareto 候选" : "被支配"}</em></div>)}</section></> : <section className="module-card metric-card"><Empty icon={Pulse} title="暂无决策数据" text="先运行一次真实评测；当前不会用占位数据生成推荐。" /></section>}</>;
  }

  function Reports() {
    return <><PageHeader eyebrow="评测交付 / 对比报告" title="对比报告" description="查看每次评测的模型配置快照，并导出含原始输出与人工结论的 CSV。"><button className="primary-button" onClick={openRun}><Plus />新建评测</button></PageHeader>
      <div className="report-grid">{completed.map((run) => { const values = run.results.map(resultScore).filter(Number.isFinite); const cases = run.totalRuns / run.models.length / (run.repeatCount || 1); return <article className="report-card" key={run.id}><header>{(run.modelType || "text") === "image" ? <ImageSquare /> : <FileText />}<div><strong>{run.name}</strong><span>{modelTypeLabel[run.modelType || "text"]} · {new Date(run.createdAt).toLocaleString("zh-CN")}</span></div><em>{average(values)?.toFixed(1) || "—"}</em></header><dl><div><dt>数据集</dt><dd>{run.datasetName}</dd></div><div><dt>对比规模</dt><dd>{run.models.length} 模型 × {cases} 用例 × {run.repeatCount || 1} 次</dd></div><div><dt>公平口径</dt><dd>{run.comparisonMode === "baseline" ? "统一基线参数" : "逐模型优化参数"}</dd></div><div><dt>评分维度</dt><dd>{run.rubric?.criteria?.map((item, _, criteria) => `${item.name} ${Math.round(Number(item.normalizedWeight ?? (Number(item.weight || 1) / criteria.reduce((sum, entry) => sum + Number(entry.weight || 1), 0))) * 100)}%`).join("；") || "综合质量"}</dd></div></dl><footer><button onClick={() => openMatrix(run.id)}>查看矩阵</button><button className="primary-button" onClick={() => exportEvaluation(run)}><DownloadSimple />导出 CSV</button></footer></article>})}{!completed.length && <Empty icon={FileText} title="暂无可导出的报告" text="评测完成后会自动生成报告入口。" />}</div></>;
  }

  function Reviews() {
    return <><PageHeader eyebrow="评测交付 / 人工复核" title="人工复核队列" description="优先处理失败、低分和无规则评分结果，人工结论将写入对应评测记录。"><span className="queue-count">{reviewQueue.length} 项待处理</span></PageHeader>
      <section className="module-card review-queue">{reviewQueue.map(({ run, result }) => <article key={`${run.id}:${result.id}`}><div><span className="case-badge">{result.caseId}</span><strong>{result.model}</strong><small>{run.name}</small></div><p>{result.imageUrl ? "图片已生成，等待人工评分" : short(result.text || result.error, 100)}</p><span className="review-score">{resultScore(result) ?? "—"}</span><button className="primary-button" onClick={() => openReview(run, result)}><Eye />开始复核</button></article>)}{!reviewQueue.length && <Empty icon={CheckCircle} title="复核队列已清空" text="当前没有待处理结果。" />}</section></>;
  }

  function Settings() {
    return <><PageHeader eyebrow="工作台 / 系统设置" title="系统设置" description="配置本地评测默认值与数据保留策略；这些设置不会离开本机。" />
      <form className="settings-layout" onSubmit={(event) => { event.preventDefault(); saveSettings(settings); }}><section className="module-card settings-card"><header><div><GearSix /><span><strong>评测默认值</strong><small>创建任务时自动带入，可在任务中覆盖</small></span></div></header><div className="settings-grid"><label><span>默认并发数</span><input type="number" min="1" max="12" value={settings.defaultConcurrency || 4} onChange={(event) => setSettings({ ...settings, defaultConcurrency: event.target.value })} /></label><label><span>请求超时（毫秒）</span><input type="number" min="5000" max="300000" step="1000" value={settings.defaultTimeoutMs || 60000} onChange={(event) => setSettings({ ...settings, defaultTimeoutMs: event.target.value })} /></label><label><span>通过分数</span><input type="number" min="0" max="10" step="0.1" value={settings.passScore ?? 8} onChange={(event) => setSettings({ ...settings, passScore: event.target.value })} /></label><label><span>进入复核分数</span><input type="number" min="0" max="10" step="0.1" value={settings.reviewScore ?? 6.5} onChange={(event) => setSettings({ ...settings, reviewScore: event.target.value })} /></label><label><span>数据保留天数</span><input type="number" min="1" max="3650" value={settings.retentionDays || 90} onChange={(event) => setSettings({ ...settings, retentionDays: event.target.value })} /></label></div></section><section className="module-card security-card"><ShieldCheck weight="fill" /><div><strong>本地优先与密钥保护</strong><p>评测数据写入本地 JSON；API Key 采用 AES-256-GCM 加密，前端接口永不返回明文密钥。</p><span>EvalHub by YJW · Community License 标识始终保留</span></div></section><footer><button className="primary-button">保存设置</button></footer></form></>;
  }

  if (activeNav === "概览") return Overview();
  if (activeNav === "数据集") return Datasets();
  if (activeNav === "测试用例") return TestCases();
  if (activeNav === "评测任务") return Tasks();
  if (activeNav === "模型管理") return Models();
  if (activeNav === "失败分析") return Failures();
  if (activeNav === "指标看板") return Metrics();
  if (activeNav === "对比报告") return Reports();
  if (activeNav === "人工复核") return Reviews();
  return Settings();
}
