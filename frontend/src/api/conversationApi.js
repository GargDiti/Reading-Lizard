import { API_BASE_URL } from "./config";

async function request(path, { token, method = "GET", body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Could not reach the LearnLoom backend. Check that it is running.");
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Request failed (${response.status})`);
  }
  return data;
}

export function listConversations(token) {
  return request("/api/conversations", { token });
}

export function createConversation(token, title) {
  return request("/api/conversations", {
    token,
    method: "POST",
    body: { title },
  });
}

export function getConversation(token, conversationId) {
  return request(`/api/conversations/${conversationId}`, { token });
}

export function deleteConversation(token, conversationId) {
  return request(`/api/conversations/${conversationId}`, {
    token,
    method: "DELETE",
  });
}

export function sendConversationMessage(token, conversationId, message, selectedTopic) {
  const body = { message };
  if (selectedTopic !== undefined && selectedTopic !== null) {
    body.selectedTopic = selectedTopic;
  }
  return request(`/api/conversations/${conversationId}/messages`, {
    token,
    method: "POST",
    body,
  });
}

export async function streamConversationMessage(
  token,
  conversationId,
  message,
  selectedTopic,
  { signal, requestId, onToken } = {},
) {
  const body = { message, stream: true, requestId };
  if (selectedTopic !== undefined && selectedTopic !== null) {
    body.selectedTopic = selectedTopic;
  }

  let response;
  try {
    response = await fetch(`${API_BASE_URL}/api/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw new Error("Could not reach the LearnLoom backend. Check that it is running.");
  }

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || `Request failed (${response.status})`);
  }
  if (!response.body) throw new Error("The backend returned no streaming response body");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let partialContent = "";
  let completion = null;

  function handleBlock(block) {
    let event = "message";
    const dataLines = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!dataLines.length) return;

    const data = JSON.parse(dataLines.join("\n"));
    if (event === "token") {
      partialContent += data.text || "";
      onToken?.(data.text || "");
    } else if (event === "done") {
      completion = data;
    } else if (event === "error") {
      const error = new Error(data.message || "The AI response failed");
      error.incomplete = data.incomplete === true;
      error.partialContent = partialContent;
      throw error;
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffered += done ? decoder.decode() : decoder.decode(value, { stream: true });
      const blocks = buffered.split(/\r?\n\r?\n/);
      buffered = blocks.pop() || "";
      for (const block of blocks) handleBlock(block);
      if (done) break;
    }
    if (buffered.trim()) handleBlock(buffered);
    if (!completion) {
      const error = new Error("The AI stream ended before completion");
      error.incomplete = partialContent.length > 0;
      error.partialContent = partialContent;
      throw error;
    }
    return completion;
  } catch (error) {
    if (error.name === "AbortError") {
      error.incomplete = partialContent.length > 0;
      error.partialContent = partialContent;
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}