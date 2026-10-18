function getAIServiceUrl() {
  const configuredUrl = process.env.AI_SERVICE_URL;
  const isProduction = process.env.NODE_ENV === "production";
  if (!configuredUrl) {
    throw new Error("AI_SERVICE_URL must be configured with the deployed AI service URL");
  }

  const serviceUrl = new URL(configuredUrl);
  if (
    isProduction
    && ["localhost", "127.0.0.1", "::1", "[::1]"].includes(serviceUrl.hostname)
  ) {
    throw new Error("AI_SERVICE_URL must not point to localhost in production");
  }

  const path = serviceUrl.pathname.replace(/\/+$/, "");

  if (!path.endsWith("/analyze-query")) {
    serviceUrl.pathname = `${path}/analyze-query`;
  }

  return serviceUrl.toString();
}

function getAIServiceHeaders(accept) {
  const token = process.env.AI_SERVICE_TOKEN?.trim();
  if (process.env.NODE_ENV === "production" && !token) {
    throw new Error("AI_SERVICE_TOKEN must be configured for the production AI service");
  }
  const headers = { "Content-Type": "application/json" };
  if (accept) headers.Accept = accept;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function requestBody({
  query,
  conversationHistory,
  sourceUrl,
  selectedTopic,
  conversationSummary,
  operation,
  messages,
  targetTokens,
  stream,
}) {
  const body = {
    query,
    conversation_history: conversationHistory || [],
    source_url: sourceUrl || null,
    selected_topic: selectedTopic ?? null,
  };
  if (conversationSummary) body.conversation_summary = conversationSummary;
  if (operation) body.operation = operation;
  if (messages) body.messages = messages;
  if (targetTokens) body.summary_target_tokens = targetTokens;
  if (stream) body.stream = true;
  return body;
}

function parseSseBlock(block) {
  let event = "message";
  const data = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
  }
  if (!data.length) return null;
  return { event, data: JSON.parse(data.join("\n")) };
}

async function generateAnswer({
  query,
  conversationHistory,
  sourceUrl,
  selectedTopic,
  conversationSummary,
}) {
  const serviceUrl = getAIServiceUrl();
  const response = await fetch(serviceUrl, {
    method: "POST",
    headers: getAIServiceHeaders(),
    body: JSON.stringify(requestBody({
      query,
      conversationHistory,
      sourceUrl,
      selectedTopic,
      conversationSummary,
    })),
    signal: AbortSignal.timeout(Number(process.env.AI_REQUEST_TIMEOUT_MS) || 180000),
  });

  if (!response.ok) {
    throw new Error(`AI service returned HTTP ${response.status}`);
  }

  const result = await response.json();
  if (typeof result.result !== "string" || !result.result.trim()) {
    throw new Error("AI service returned an empty answer");
  }

  return result;
}

async function generateSummary({ existingSummary, messages, targetTokens }) {
  const response = await fetch(getAIServiceUrl(), {
    method: "POST",
    headers: getAIServiceHeaders(),
    body: JSON.stringify(requestBody({
      query: "Update the rolling conversation summary",
      operation: "summarize",
      conversationSummary: existingSummary,
      messages,
      targetTokens,
    })),
    signal: AbortSignal.timeout(Number(process.env.AI_SUMMARY_TIMEOUT_MS) || 90000),
  });

  if (!response.ok) {
    throw new Error(`AI summary service returned HTTP ${response.status}`);
  }

  const result = await response.json();
  if (typeof result.summary !== "string" || !result.summary.trim()) {
    throw new Error("AI summary service returned an empty summary");
  }
  return result.summary.trim();
}

async function* streamAnswer(payload, { signal } = {}) {
  const response = await fetch(getAIServiceUrl(), {
    method: "POST",
    headers: getAIServiceHeaders("text/event-stream"),
    body: JSON.stringify(requestBody({ ...payload, stream: true })),
    signal: signal || AbortSignal.timeout(Number(process.env.AI_STREAM_TIMEOUT_MS) || 180000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI service returned HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  if (!response.body) throw new Error("AI service returned no streaming response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let completed = false;

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffered += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const blocks = buffered.split(/\r?\n\r?\n/);
      buffered = blocks.pop() || "";

      for (const block of blocks) {
        const parsed = parseSseBlock(block);
        if (!parsed) continue;
        if (parsed.event === "error") {
          throw new Error(parsed.data.message || "AI streaming request failed");
        }
        if (parsed.event === "done") completed = true;
        yield parsed;
      }

      if (done) break;
    }

    if (buffered.trim()) {
      const parsed = parseSseBlock(buffered);
      if (parsed) {
        if (parsed.event === "error") {
          throw new Error(parsed.data.message || "AI streaming request failed");
        }
        if (parsed.event === "done") completed = true;
        yield parsed;
      }
    }
    if (!completed) throw new Error("AI stream ended before completion");
  } finally {
    reader.releaseLock();
  }
}

const aiService = { generateAnswer, generateSummary, streamAnswer };

export { aiService, generateAnswer, generateSummary, streamAnswer };
export default aiService;
