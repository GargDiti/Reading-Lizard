import assert from "node:assert/strict";
import test from "node:test";

import Conversation from "../src/models/conversation.js";
import Message from "../src/models/message.js";
import aiService from "../src/services/aiService.js";
import { buildConversationContext, estimateTokens } from "../src/services/conversationMemory.js";

const conversationId = "64b000000000000000000010";

test("memory token estimate uses the conservative shared three-character ratio", () => {
  assert.equal(estimateTokens("1234567890"), 4);
});

function stub(t, target, key, replacement) {
  const original = target[key];
  target[key] = replacement;
  t.after(() => { target[key] = original; });
}

function setMemoryConfig(t, {
  threshold = "1",
  recentWindow = "2",
  target = "50",
  inputLimit = "12000",
} = {}) {
  const previous = {
    threshold: process.env.CONVERSATION_HISTORY_TOKEN_THRESHOLD,
    recentWindow: process.env.CONVERSATION_RECENT_MESSAGE_WINDOW,
    target: process.env.CONVERSATION_SUMMARY_TARGET_TOKENS,
    inputLimit: process.env.CONVERSATION_SUMMARY_INPUT_TOKEN_LIMIT,
  };
  process.env.CONVERSATION_HISTORY_TOKEN_THRESHOLD = threshold;
  process.env.CONVERSATION_RECENT_MESSAGE_WINDOW = recentWindow;
  process.env.CONVERSATION_SUMMARY_TARGET_TOKENS = target;
  process.env.CONVERSATION_SUMMARY_INPUT_TOKEN_LIMIT = inputLimit;
  t.after(() => {
    if (previous.threshold === undefined) delete process.env.CONVERSATION_HISTORY_TOKEN_THRESHOLD;
    else process.env.CONVERSATION_HISTORY_TOKEN_THRESHOLD = previous.threshold;
    if (previous.recentWindow === undefined) delete process.env.CONVERSATION_RECENT_MESSAGE_WINDOW;
    else process.env.CONVERSATION_RECENT_MESSAGE_WINDOW = previous.recentWindow;
    if (previous.target === undefined) delete process.env.CONVERSATION_SUMMARY_TARGET_TOKENS;
    else process.env.CONVERSATION_SUMMARY_TARGET_TOKENS = previous.target;
    if (previous.inputLimit === undefined) delete process.env.CONVERSATION_SUMMARY_INPUT_TOKEN_LIMIT;
    else process.env.CONVERSATION_SUMMARY_INPUT_TOKEN_LIMIT = previous.inputLimit;
  });
}

function messageSet(count) {
  return Array.from({ length: count }, (_, index) => ({
    _id: `message-${index}`,
    role: index % 2 ? "assistant" : "user",
    content: `Learning turn ${index} covers a useful concept.`,
    status: "complete",
    createdAt: new Date(index * 1000),
  }));
}

function setupReads(t, conversation, messages) {
  stub(t, Conversation, "findById", () => ({ lean: async () => ({ ...conversation }) }));
  stub(t, Message, "find", () => ({
    sort() { return this; },
    lean: async () => messages,
  }));
}

test("long histories summarize only older unsummarized turns and preserve recent full messages", async (t) => {
  setMemoryConfig(t);
  const messages = messageSet(9);
  const conversation = {
    _id: conversationId,
    rollingSummary: "",
    summaryThroughMessageId: null,
    summaryVersion: 0,
  };
  setupReads(t, conversation, messages);

  let summarizedMessages;
  let summaryTarget;
  stub(t, aiService, "generateSummary", async (payload) => {
    summarizedMessages = payload.messages;
    summaryTarget = payload.targetTokens;
    return "Learner is studying concepts and has an unresolved follow-up.";
  });
  stub(t, Conversation, "updateOne", async (filter, update) => {
    assert.deepEqual(filter.summaryVersion, { $in: [0, null] });
    Object.assign(conversation, update.$set);
    return { modifiedCount: 1 };
  });

  const context = await buildConversationContext({
    conversationId,
    currentMessageId: "message-8",
  });

  assert.equal(summarizedMessages.length, 6);
  assert.equal(summarizedMessages[0].content, messages[0].content);
  assert.equal(summaryTarget, 50);
  assert.equal(String(conversation.summaryThroughMessageId), "message-5");
  assert.equal(conversation.summaryVersion, 1);
  assert.match(context.summary, /unresolved follow-up/);
  assert.deepEqual(context.history, messages.slice(6, 8).map(({ role, content }) => ({ role, content })));
});

test("summary failures retain all original turns for safe prompt-budget fallback", async (t) => {
  setMemoryConfig(t);
  const messages = messageSet(6);
  const conversation = {
    _id: conversationId,
    rollingSummary: "",
    summaryThroughMessageId: null,
    summaryVersion: 0,
  };
  setupReads(t, conversation, messages);
  stub(t, aiService, "generateSummary", async () => { throw new Error("provider unavailable"); });
  stub(t, Conversation, "updateOne", async () => {
    assert.fail("A failed summary must not advance its checkpoint");
  });

  const context = await buildConversationContext({
    conversationId,
    currentMessageId: "message-5",
  });

  assert.equal(context.summary, "");
  assert.equal(context.history.length, 5);
  assert.equal(context.history[0].content, messages[0].content);
  assert.equal(conversation.summaryThroughMessageId, null);
});

test("summary compare-and-swap retries from the latest checkpoint instead of overwriting it", async (t) => {
  setMemoryConfig(t);
  const messages = messageSet(9);
  const conversation = {
    _id: conversationId,
    rollingSummary: "",
    summaryThroughMessageId: null,
    summaryVersion: 0,
  };
  setupReads(t, conversation, messages);

  const summaryInputs = [];
  stub(t, aiService, "generateSummary", async ({ existingSummary, messages: older }) => {
    summaryInputs.push({ existingSummary, older });
    return `summary-${summaryInputs.length}`;
  });
  let updates = 0;
  stub(t, Conversation, "updateOne", async (_filter, update) => {
    updates += 1;
    if (updates === 1) {
      conversation.rollingSummary = "summary-from-another-request";
      conversation.summaryThroughMessageId = messages[1]._id;
      conversation.summaryVersion = 1;
      return { modifiedCount: 0 };
    }
    Object.assign(conversation, update.$set);
    return { modifiedCount: 1 };
  });

  const context = await buildConversationContext({
    currentMessageId: "message-8",
  });

  assert.equal(updates, 2);
  assert.equal(summaryInputs.length, 2);
  assert.equal(summaryInputs[1].existingSummary, "summary-from-another-request");
  assert.equal(summaryInputs[1].older[0].content, messages[2].content);
  assert.equal(conversation.rollingSummary, "summary-2");
  assert.equal(String(conversation.summaryThroughMessageId), "message-5");
  assert.equal(conversation.summaryVersion, 2);
  assert.deepEqual(context.history, messages.slice(6, 8).map(({ role, content }) => ({ role, content })));
});

test("the configured recent-message window rolls older turns even below the token threshold", async (t) => {
  setMemoryConfig(t, { threshold: "6000", recentWindow: "10", target: "50" });
  const messages = messageSet(13);
  const conversation = {
    _id: conversationId,
    rollingSummary: "",
    summaryThroughMessageId: null,
    summaryVersion: 0,
  };
  setupReads(t, conversation, messages);

  let summarizedCount = 0;
  stub(t, aiService, "generateSummary", async ({ messages: older }) => {
    summarizedCount = older.length;
    return "Older learning context.";
  });
  stub(t, Conversation, "updateOne", async (_filter, update) => {
    Object.assign(conversation, update.$set);
    return { modifiedCount: 1 };
  });

  const context = await buildConversationContext({
    conversationId,
    currentMessageId: "message-12",
  });

  assert.equal(summarizedCount, 2);
  assert.equal(context.history.length, 10);
  assert.equal(context.history[0].content, messages[2].content);
  assert.match(context.summary, /Older learning context/);
});

test("bounded summary batches advance checkpoints only through messages actually summarized", async (t) => {
  setMemoryConfig(t, { threshold: "1", recentWindow: "2", target: "50", inputLimit: "30" });
  const messages = messageSet(9);
  const conversation = {
    _id: conversationId,
    rollingSummary: "",
    summaryThroughMessageId: null,
    summaryVersion: 0,
  };
  setupReads(t, conversation, messages);

  const summarizedIds = [];
  stub(t, aiService, "generateSummary", async ({ existingSummary, messages: batch }) => {
    summarizedIds.push(...batch.map((message) => message.content));
    return `${existingSummary} updated`.trim();
  });
  stub(t, Conversation, "updateOne", async (_filter, update) => {
    Object.assign(conversation, update.$set);
    return { modifiedCount: 1 };
  });

  const context = await buildConversationContext({
    conversationId,
    currentMessageId: "message-8",
  });

  assert.equal(summarizedIds.length, 6);
  assert.equal(String(conversation.summaryThroughMessageId), "message-5");
  assert.equal(conversation.summaryVersion, 6);
  assert.equal(context.history.length, 2);
});
