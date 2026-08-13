const DEFAULT_TIMEOUT = 60_000;

const endpoint = (baseUrl, suffix) => `${baseUrl.replace(/\/$/, "")}${suffix}`;
async function requestJson(url, options = {}, timeoutMs = DEFAULT_TIMEOUT) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    let body;
    try { body = text ? JSON.parse(text) : {}; } catch { body = { message: text }; }
    if (!response.ok) throw new Error(body?.error?.message || body?.message || `HTTP ${response.status}`);
    return body;
  } finally { clearTimeout(timer); }
}

function mockText(model, prompt) {
  if (/证件|隐私|手机号|敏感/.test(prompt)) {
    if (/safe/.test(model)) return "抱歉，我无法提供或推断任何个人敏感信息。请通过授权的身份验证流程查询；如需帮助，我可以说明安全办理步骤。";
    if (/fast/.test(model)) return "无法提供该信息，请联系管理员。";
    return "抱歉，我无法提供个人隐私信息。建议通过企业安全服务台完成身份核验，我可以继续协助您了解办理流程。";
  }
  return `根据现有知识库，我会先确认适用规则，再给出可执行步骤。针对“${prompt.slice(0, 42)}”，建议核对账户与订单状态；若资料不足，将转交人工处理并明确说明信息边界。`;
}

export async function testProvider(connection, apiKey) {
  if (connection.provider === "mock") return { ok: true, models: connection.models || ["mock-balanced", "mock-fast", "mock-safe"] };
  const headers = { "content-type": "application/json" };
  if (connection.provider === "anthropic") {
    headers["x-api-key"] = apiKey; headers["anthropic-version"] = "2023-06-01";
    const body = await requestJson(endpoint(connection.baseUrl, "/v1/models"), { headers });
    return { ok: true, models: (body.data || []).map((item) => item.id) };
  }
  if (connection.provider === "gemini") {
    const body = await requestJson(endpoint(connection.baseUrl, `/v1beta/models?key=${encodeURIComponent(apiKey)}`));
    return { ok: true, models: (body.models || []).filter((item) => item.supportedGenerationMethods?.includes("generateContent")).map((item) => item.name.replace("models/", "")) };
  }
  headers.authorization = `Bearer ${apiKey}`;
  const body = await requestJson(endpoint(connection.baseUrl, "/models"), { headers });
  return { ok: true, models: (body.data || body.models || []).map((item) => item.id || item.name).filter(Boolean) };
}

export async function invokeModel({ connection, apiKey, model, input, systemPrompt, temperature = 0.2, maxTokens = 1024, timeoutMs = DEFAULT_TIMEOUT }) {
  const started = performance.now();
  if (connection.provider === "mock") {
    await new Promise((resolve) => setTimeout(resolve, model.includes("fast") ? 40 : 90));
    const text = mockText(model, input);
    return { text, inputTokens: Math.ceil((input.length + (systemPrompt?.length || 0)) / 3), outputTokens: Math.ceil(text.length / 3), latencyMs: Math.round(performance.now() - started), finishReason: "stop" };
  }
  if (connection.provider === "anthropic") {
    const body = await requestJson(endpoint(connection.baseUrl, "/v1/messages"), { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, system: systemPrompt || undefined, messages: [{ role: "user", content: input }], temperature, max_tokens: maxTokens }) }, timeoutMs);
    return { text: (body.content || []).map((item) => item.text || "").join("\n"), inputTokens: body.usage?.input_tokens || 0, outputTokens: body.usage?.output_tokens || 0, latencyMs: Math.round(performance.now() - started), finishReason: body.stop_reason || "stop" };
  }
  if (connection.provider === "gemini") {
    const body = await requestJson(endpoint(connection.baseUrl, `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined, contents: [{ role: "user", parts: [{ text: input }] }], generationConfig: { temperature, maxOutputTokens: maxTokens } }) }, timeoutMs);
    return { text: body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "", inputTokens: body.usageMetadata?.promptTokenCount || 0, outputTokens: body.usageMetadata?.candidatesTokenCount || 0, latencyMs: Math.round(performance.now() - started), finishReason: body.candidates?.[0]?.finishReason || "stop" };
  }
  const body = await requestJson(endpoint(connection.baseUrl, "/chat/completions"), { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages: [...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []), { role: "user", content: input }], temperature, max_tokens: maxTokens }) }, timeoutMs);
  return { text: body.choices?.[0]?.message?.content || "", inputTokens: body.usage?.prompt_tokens || 0, outputTokens: body.usage?.completion_tokens || 0, latencyMs: Math.round(performance.now() - started), finishReason: body.choices?.[0]?.finish_reason || "stop" };
}
