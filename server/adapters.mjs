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

function mockImage(model, prompt, size = "1024x1024") {
  const [width, height] = String(size).split("x").map(Number);
  const safeWidth = Number.isFinite(width) ? width : 1024;
  const safeHeight = Number.isFinite(height) ? height : 1024;
  const hue = [...`${model}:${prompt}`].reduce((sum, character) => sum + character.codePointAt(0), 0) % 360;
  const title = String(prompt || "EvalHub image prompt").slice(0, 72).replace(/[<>&]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${safeWidth}" height="${safeHeight}" viewBox="0 0 ${safeWidth} ${safeHeight}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="hsl(${hue} 72% 55%)"/><stop offset="1" stop-color="hsl(${(hue + 80) % 360} 68% 22%)"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><circle cx="${safeWidth * .72}" cy="${safeHeight * .28}" r="${Math.min(safeWidth, safeHeight) * .18}" fill="white" opacity=".18"/><path d="M0 ${safeHeight * .78} Q ${safeWidth * .28} ${safeHeight * .48} ${safeWidth * .52} ${safeHeight * .76} T ${safeWidth} ${safeHeight * .6} V ${safeHeight} H0Z" fill="white" opacity=".2"/><text x="${safeWidth * .07}" y="${safeHeight * .12}" fill="white" font-family="system-ui,sans-serif" font-size="${Math.max(20, safeWidth * .032)}" font-weight="700">EvalHub · offline preview</text><text x="${safeWidth * .07}" y="${safeHeight * .9}" fill="white" font-family="system-ui,sans-serif" font-size="${Math.max(16, safeWidth * .022)}">${title}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
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

function imageFromResponse(body) {
  const item = body.data?.[0] || body.images?.[0] || body.predictions?.[0] || body.outputs?.[0] || {};
  const base64 = item.b64_json || item.bytesBase64Encoded || item.bytesBase64 || item.image_base64 || (typeof item === "string" && !item.startsWith("http") ? item : "");
  const mimeType = item.mimeType || item.mime_type || body.outputFormat || "image/png";
  const remoteUrl = item.url || item.image_url || (typeof item === "string" && item.startsWith("http") ? item : "");
  const inlineData = body.candidates?.[0]?.content?.parts?.find((part) => part.inlineData || part.inline_data);
  const inline = inlineData?.inlineData || inlineData?.inline_data;
  if (inline?.data) return { imageUrl: `data:${inline.mimeType || inline.mime_type || "image/png"};base64,${inline.data}`, mimeType: inline.mimeType || inline.mime_type || "image/png" };
  if (base64) return { imageUrl: String(base64).startsWith("data:") ? String(base64) : `data:${mimeType};base64,${base64}`, mimeType };
  if (remoteUrl) return { imageUrl: remoteUrl, mimeType };
  throw new Error("生图接口未返回可识别的图片数据");
}

function aspectRatioForSize(size) {
  return ({ "1024x1024": "1:1", "1536x1024": "3:2", "1024x1536": "2:3", "1792x1024": "16:9", "1024x1792": "9:16" })[size] || "1:1";
}

function decodeReferenceImage(referenceImage) {
  const match = String(referenceImage || "").match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i);
  if (!match) throw new Error("参考图片必须是 PNG、JPEG 或 WebP 文件");
  const bytes = Buffer.from(match[2], "base64");
  if (!bytes.length || bytes.length > 5 * 1024 * 1024) throw new Error("参考图片大小必须在 5 MB 以内");
  return { mimeType: match[1].toLowerCase(), base64: match[2], bytes };
}

function imageExtension(mimeType) {
  return mimeType === "image/jpeg" ? "jpg" : mimeType.split("/")[1];
}

export async function invokeImageModel({ connection, apiKey, model, prompt, referenceImage = "", negativePrompt = "", size = "1024x1024", quality = "standard", style = "", seed, timeoutMs = DEFAULT_TIMEOUT }) {
  const started = performance.now();
  if (connection.provider === "mock") {
    await new Promise((resolve) => setTimeout(resolve, model.includes("fast") ? 35 : 75));
    return { imageUrl: mockImage(model, `${referenceImage ? "参考图编辑：" : ""}${prompt}`, size), mimeType: "image/svg+xml", revisedPrompt: prompt, latencyMs: Math.round(performance.now() - started) };
  }
  if (connection.provider === "anthropic") throw new Error("Anthropic 连接暂不支持生图模型");
  if (connection.provider === "gemini") {
    const parameters = { sampleCount: 1, aspectRatio: aspectRatioForSize(size), ...(negativePrompt ? { negativePrompt } : {}), ...(Number.isFinite(Number(seed)) ? { seed: Number(seed) } : {}) };
    let body;
    if (referenceImage && String(model).startsWith("gemini-")) {
      const image = decodeReferenceImage(referenceImage);
      body = await requestJson(endpoint(connection.baseUrl, `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }, { inlineData: { mimeType: image.mimeType, data: image.base64 } }] }], generationConfig: { responseModalities: ["TEXT", "IMAGE"] } }) }, timeoutMs);
    } else {
      const instance = referenceImage ? { prompt, referenceImages: [{ referenceId: 1, referenceType: "REFERENCE_TYPE_RAW", referenceImage: { bytesBase64Encoded: decodeReferenceImage(referenceImage).base64 } }] } : { prompt };
      body = await requestJson(endpoint(connection.baseUrl, `/v1beta/models/${encodeURIComponent(model)}:predict?key=${encodeURIComponent(apiKey)}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ instances: [instance], parameters }) }, timeoutMs);
    }
    return { ...imageFromResponse(body), revisedPrompt: body.predictions?.[0]?.prompt || prompt, latencyMs: Math.round(performance.now() - started) };
  }
  const gptImage = connection.provider === "openai" && String(model).startsWith("gpt-image");
  const dalle = connection.provider === "openai" && String(model).startsWith("dall-e");
  const effectiveQuality = gptImage && quality === "standard" ? "medium" : dalle && ["low", "medium"].includes(quality) ? "standard" : dalle && quality === "high" ? "hd" : quality;
  const imageBody = { model, prompt, n: 1, size, ...(effectiveQuality ? { quality: effectiveQuality } : {}), ...(!gptImage && style ? { style } : {}), ...(negativePrompt && connection.provider !== "openai" ? { negative_prompt: negativePrompt } : {}), ...(Number.isFinite(Number(seed)) && connection.provider !== "openai" ? { seed: Number(seed) } : {}) };
  if (referenceImage) {
    const image = decodeReferenceImage(referenceImage);
    const form = new FormData();
    form.append("model", model); form.append("prompt", prompt); form.append("image", new Blob([image.bytes], { type: image.mimeType }), `reference.${imageExtension(image.mimeType)}`);
    form.append("n", "1"); form.append("size", size);
    if (effectiveQuality) form.append("quality", effectiveQuality);
    if (!gptImage && style) form.append("style", style);
    if (negativePrompt && connection.provider !== "openai") form.append("negative_prompt", negativePrompt);
    if (Number.isFinite(Number(seed)) && connection.provider !== "openai") form.append("seed", String(Number(seed)));
    const body = await requestJson(endpoint(connection.baseUrl, "/images/edits"), { method: "POST", headers: { authorization: `Bearer ${apiKey}` }, body: form }, timeoutMs);
    return { ...imageFromResponse(body), revisedPrompt: body.data?.[0]?.revised_prompt || prompt, latencyMs: Math.round(performance.now() - started) };
  }
  if (!String(model).startsWith("gpt-image")) imageBody.response_format = "b64_json";
  const body = await requestJson(endpoint(connection.baseUrl, "/images/generations"), { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify(imageBody) }, timeoutMs);
  return { ...imageFromResponse(body), revisedPrompt: body.data?.[0]?.revised_prompt || prompt, latencyMs: Math.round(performance.now() - started) };
}

export async function invokeModel({ connection, apiKey, model, input, systemPrompt, temperature = 0.2, maxTokens = 1024, topP, topK, presencePenalty, frequencyPenalty, seed, stopSequences = [], timeoutMs = DEFAULT_TIMEOUT }) {
  const started = performance.now();
  if (connection.provider === "mock") {
    await new Promise((resolve) => setTimeout(resolve, model.includes("fast") ? 40 : 90));
    const text = mockText(model, input);
    return { text, inputTokens: Math.ceil((input.length + (systemPrompt?.length || 0)) / 3), outputTokens: Math.ceil(text.length / 3), latencyMs: Math.round(performance.now() - started), finishReason: "stop" };
  }
  if (connection.provider === "anthropic") {
    const body = await requestJson(endpoint(connection.baseUrl, "/v1/messages"), { method: "POST", headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, body: JSON.stringify({ model, system: systemPrompt || undefined, messages: [{ role: "user", content: input }], temperature, max_tokens: maxTokens, top_p: topP ?? undefined, top_k: topK ?? undefined, stop_sequences: stopSequences.length ? stopSequences : undefined }) }, timeoutMs);
    return { text: (body.content || []).map((item) => item.text || "").join("\n"), inputTokens: body.usage?.input_tokens || 0, outputTokens: body.usage?.output_tokens || 0, latencyMs: Math.round(performance.now() - started), finishReason: body.stop_reason || "stop" };
  }
  if (connection.provider === "gemini") {
    const body = await requestJson(endpoint(connection.baseUrl, `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ systemInstruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined, contents: [{ role: "user", parts: [{ text: input }] }], generationConfig: { temperature, maxOutputTokens: maxTokens, topP: topP ?? undefined, topK: topK ?? undefined, stopSequences: stopSequences.length ? stopSequences : undefined } }) }, timeoutMs);
    return { text: body.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("\n") || "", inputTokens: body.usageMetadata?.promptTokenCount || 0, outputTokens: body.usageMetadata?.candidatesTokenCount || 0, latencyMs: Math.round(performance.now() - started), finishReason: body.candidates?.[0]?.finishReason || "stop" };
  }
  const body = await requestJson(endpoint(connection.baseUrl, "/chat/completions"), { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, messages: [...(systemPrompt ? [{ role: "system", content: systemPrompt }] : []), { role: "user", content: input }], temperature, max_tokens: maxTokens, top_p: topP ?? undefined, presence_penalty: presencePenalty ?? undefined, frequency_penalty: frequencyPenalty ?? undefined, seed: seed ?? undefined, stop: stopSequences.length ? stopSequences : undefined }) }, timeoutMs);
  return { text: body.choices?.[0]?.message?.content || "", inputTokens: body.usage?.prompt_tokens || 0, outputTokens: body.usage?.completion_tokens || 0, latencyMs: Math.round(performance.now() - started), finishReason: body.choices?.[0]?.finish_reason || "stop" };
}
