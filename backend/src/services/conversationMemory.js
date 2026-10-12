import Conversation from "../models/conversation.js";
import Message from "../models/message.js";
import aiService from "./aiService.js";

function positiveInteger(name, fallback) {
  const parsed = Number.parseInt(process.env[name] || "", 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getConversationMemoryConfig() {
  return {
    historyTokenThreshold: positiveInteger("CONVERSATION_HISTORY_TOKEN_THRESHOLD", 6000),
    summaryTargetTokens: positiveInteger("CONVERSATION_SUMMARY_TARGET_TOKENS", 800),
    summaryInputTokenLimit: positiveInteger("CONVERSATION_SUMMARY_INPUT_TOKEN_LIMIT", 12000),
    recentMessageWindow: positiveInteger("CONVERSATION_RECENT_MESSAGE_WINDOW", 10),
    charsPerToken: positiveInteger("TOKEN_ESTIMATE_CHARS_PER_TOKEN", 3),
  };
}

export function estimateTokens(text, charsPerToken = positiveInteger("TOKEN_ESTIMATE_CHARS_PER_TOKEN", 3)) {
  return Math.ceil(String(text || "").length / charsPerToken);
}

function messageTokens(messages, charsPerToken) {
  return messages.reduce(
    (total, message) => total + estimateTokens(`${message.role}: ${message.content}`, charsPerToken),
    0,
  );
}

function isCompleteMessage(message) {
  return message.status === undefined || message.status === "complete";
}

function versionCondition(version) {
  return version > 0
    ? version
    : { $in: [0, null] };
}

function checkpointIndex(messages, checkpointId) {
  if (!checkpointId) return -1;
  return messages.findIndex(({ _id }) => String(_id) === String(checkpointId));
}

export async function buildConversationContext({ conversationId, currentMessageId }) {
  const config = getConversationMemoryConfig();
  let conversation = await Conversation.findById(conversationId).lean();
  if (!conversation) throw new Error("Conversation not found while building memory");

  const allMessages = await Message.find({ conversationId })
    .sort({ createdAt: 1, _id: 1 })
    .lean();
  const currentIndex = allMessages.findIndex(
    ({ _id }) => String(_id) === String(currentMessageId),
  );
  const beforeCurrent = (currentIndex < 0 ? allMessages : allMessages.slice(0, currentIndex))
    .filter(isCompleteMessage);

  let compareAndSwapConflicts = 0;
  while (true) {
    const summary = conversation.rollingSummary || "";
    const checkpoint = conversation.summaryThroughMessageId || null;
    const checkpointAt = checkpointIndex(beforeCurrent, checkpoint);
    const unsummarized = beforeCurrent.slice(checkpointAt + 1);
    const olderMessages = unsummarized.slice(
      0,
      Math.max(0, unsummarized.length - config.recentMessageWindow),
    );
    const batch = [];
    let batchTokens = 0;
    for (const message of olderMessages) {
      const tokens = estimateTokens(`${message.role}: ${message.content}`, config.charsPerToken);
      if (batch.length && batchTokens + tokens > config.summaryInputTokenLimit) break;
      batch.push(message);
      batchTokens += tokens;
    }

    const estimatedHistoryTokens = estimateTokens(summary, config.charsPerToken)
      + messageTokens(unsummarized, config.charsPerToken);
    const summaryRequired = estimatedHistoryTokens > config.historyTokenThreshold
      || unsummarized.length > config.recentMessageWindow;
    if (!summaryRequired || batch.length === 0) {
      break;
    }

    try {
      const summarized = await aiService.generateSummary({
        existingSummary: summary,
        messages: batch.map(({ role, content }) => ({ role, content })),
        targetTokens: config.summaryTargetTokens,
      });
      const lastSummarized = batch.at(-1);
      const expectedVersion = conversation.summaryVersion || 0;
      const update = await Conversation.updateOne(
        { _id: conversationId, summaryVersion: versionCondition(expectedVersion) },
        {
          $set: {
            rollingSummary: summarized,
            summaryThroughMessageId: lastSummarized._id,
            summaryUpdatedAt: new Date(),
            summaryVersion: expectedVersion + 1,
          },
        },
      );

      if (update.modifiedCount === 1) {
        conversation = {
          ...conversation,
          rollingSummary: summarized,
          summaryThroughMessageId: lastSummarized._id,
          summaryVersion: expectedVersion + 1,
        };
        continue;
      }

      conversation = await Conversation.findById(conversationId).lean();
      if (!conversation) throw new Error("Conversation disappeared while updating memory");
      compareAndSwapConflicts += 1;
      if (compareAndSwapConflicts >= 3) break;
    } catch (error) {
      console.error("[MEMORY] Summary update failed; retaining original messages:", error.message);
      break;
    }
  }

  const latestCheckpoint = checkpointIndex(
    beforeCurrent,
    conversation.summaryThroughMessageId || null,
  );
  const unsummarizedMessages = beforeCurrent
    .slice(latestCheckpoint + 1)
    .map(({ role, content }) => ({ role, content }));

  return {
    summary: conversation.rollingSummary || "",
    history: unsummarizedMessages,
  };
}
