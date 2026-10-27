import Conversation from "../models/conversation.js";
import Message from "../models/message.js";
import mongoose from "mongoose";
import aiService from "../services/aiService.js";
import { buildConversationContext } from "../services/conversationMemory.js";

const MAX_MESSAGE_LENGTH = 20000;

function getStreamTimeoutMs() {
  return Number(process.env.AI_STREAM_TIMEOUT_MS) || 180000;
}

function isValidConversationId(id) {
  return mongoose.Types.ObjectId.isValid(id);
}

async function findOwnedConversation(id, userId) {
  if (!isValidConversationId(id)) {
    return { error: "invalid" };
  }

  const conversation = await Conversation.findOne({ _id: id, userId });
  return conversation ? { conversation } : { error: "not_found" };
}

// Create a new conversation
const createConversation = async (req, res) => {
  try {
    const requestedTitle = req.body?.title;
    if (requestedTitle !== undefined && typeof requestedTitle !== "string") {
      return res.status(400).json({ success: false, message: "Title must be text" });
    }

    const conversation = await Conversation.create({
      userId: req.user.id,
      title: requestedTitle?.trim().slice(0, 120) || "New Conversation",
    });

    res.status(201).json({
      success: true,
      conversation,
    });
  } catch (error) {
    console.error("Create conversation error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to create conversation",
    });
  }
};

const getConversation = async (req, res) => {
  try {
    const found = await findOwnedConversation(req.params.id, req.user.id);
    if (found.error === "invalid") {
      return res.status(400).json({ success: false, message: "Invalid conversation ID" });
    }
    if (!found.conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    const conversation = found.conversation;
    if (!conversation.availableTopics?.length && conversation.sourceUrl) {
      try {
        const recoveredTopics = await aiService.getIndexedTopics(conversation.sourceUrl);
        if (recoveredTopics.length) {
          conversation.availableTopics = recoveredTopics;
          conversation.allowWholeWebsite = true;
          await conversation.save();
        }
      } catch (error) {
        console.warn("[CONVERSATION] Could not recover indexed topics:", error.message);
      }
    }

    const messages = await Message.find({ conversationId: conversation._id })
      .sort({ createdAt: 1, _id: 1 });
    return res.status(200).json({
      success: true,
      conversation,
      messages,
    });
  } catch (error) {
    console.error("[CONVERSATION] Could not fetch conversation:", error.message);
    return res.status(500).json({ success: false, message: "Failed to fetch conversation" });
  }
};

const deleteConversation = async (req, res) => {
  try {
    const found = await findOwnedConversation(req.params.id, req.user.id);
    if (found.error === "invalid") {
      return res.status(400).json({ success: false, message: "Invalid conversation ID" });
    }
    if (!found.conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    await Message.deleteMany({ conversationId: found.conversation._id });
    await Conversation.deleteOne({ _id: found.conversation._id, userId: req.user.id });
    return res.status(200).json({ success: true, message: "Conversation deleted" });
  } catch (error) {
    console.error("[CONVERSATION] Could not delete conversation:", error.message);
    return res.status(500).json({ success: false, message: "Failed to delete conversation" });
  }
};

// Get all conversations of the logged-in user
const getConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({
      userId: req.user.id,
    }).sort({ updatedAt: -1 });

    res.status(200).json({
      success: true,
      conversations,
    });
  } catch (error) {
    console.error("Get conversations error:", error.message);
    res.status(500).json({
      success: false,
      message: "Failed to fetch conversations",
    });
  }
};

//get messages
const getMessages = async (req, res) => {
  try {
    const { id } = req.params;

    // Validate the conversation ID
    if (!isValidConversationId(id)) {
      return res.status(400).json({
        success: false,
        message: "Invalid conversation ID",
      });
    }

    // Check that the conversation belongs to this user
    const conversation = await Conversation.findOne({
      _id: id,
      userId: req.user.id,
    });

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    // Retrieve messages in chronological order
    const messages = await Message.find({
      conversationId: conversation._id,
    }).sort({ createdAt: 1 });

    return res.status(200).json({
      success: true,
      messages,
    });
  } catch (error) {
    console.error("Get messages error:", error.message);

    return res.status(500).json({
      success: false,
      message: "Failed to fetch messages",
    });
  }
};

function writeSse(res, event, payload) {
  if (res.destroyed || res.writableEnded) return Promise.resolve(false);
  const accepted = res.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
  if (accepted) return Promise.resolve(true);
  return new Promise((resolve) => {
    const onDrain = () => {
      cleanup();
      resolve(true);
    };
    const onClose = () => {
      cleanup();
      resolve(false);
    };
    const cleanup = () => {
      res.off("drain", onDrain);
      res.off("close", onClose);
    };
    res.once("drain", onDrain);
    res.once("close", onClose);
  });
}

function validateMessageRequest(req, res) {
  const content = req.body?.message;
  if (typeof content !== "string" || !content.trim()) {
    res.status(400).json({ success: false, message: "Message cannot be empty" });
    return null;
  }
  if (content.trim().length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({
      success: false,
      message: `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`,
    });
    return null;
  }
  const selectedTopic = req.body?.selectedTopic;
  if (selectedTopic !== undefined && selectedTopic !== null && typeof selectedTopic !== "string") {
    res.status(400).json({ success: false, message: "Selected topic must be text" });
    return null;
  }
  if (typeof req.body?.requestId !== "string"
    || !/^[\w-]{8,128}$/.test(req.body.requestId)) {
    res.status(400).json({ success: false, message: "A valid requestId is required" });
    return null;
  }
  return { content: content.trim(), selectedTopic, requestId: req.body.requestId };
}

async function sendStreamingMessage(req, res) {
  const input = validateMessageRequest(req, res);
  if (!input) return;

  const { id } = req.params;
  try {
    const found = await findOwnedConversation(id, req.user.id);
    if (found.error === "invalid") {
      return res.status(400).json({ success: false, message: "Invalid conversation ID" });
    }
    if (!found.conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    let userMessage;
    try {
      userMessage = await Message.create({
        conversationId: found.conversation._id,
        role: "user",
        content: input.content,
        requestId: input.requestId,
        status: "complete",
      });
    } catch (error) {
      if (error.code !== 11000) throw error;
      userMessage = await Message.findOne({
        conversationId: found.conversation._id,
        requestId: input.requestId,
        role: "user",
      });
      const previousAssistant = userMessage
        ? await Message.findOne({ inReplyTo: userMessage._id })
        : null;
      if (previousAssistant?.status === "complete") {
        res.set({
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          "X-Accel-Buffering": "no",
        });
        res.flushHeaders();
        await writeSse(res, "token", { text: previousAssistant.content });
        await writeSse(res, "done", {
          success: true,
          message: previousAssistant,
          replayed: true,
        });
        return res.end();
      }
      return res.status(409).json({
        success: false,
        message: "This request was already accepted; submit a new requestId to retry.",
      });
    }

    let assistantMessage;
    try {
      assistantMessage = await Message.create({
        conversationId: found.conversation._id,
        role: "assistant",
        content: "",
        status: "streaming",
        inReplyTo: userMessage._id,
      });
    } catch (error) {
      if (error.code === 11000) {
        return res.status(409).json({ success: false, message: "A response is already being generated" });
      }
      throw error;
    }

    res.set({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders();

    const controller = new AbortController();
    let clientDisconnected = false;
    const timeout = setTimeout(
      () => controller.abort(new Error("AI request timed out")),
      getStreamTimeoutMs(),
    );
    const abortForDisconnect = () => {
      if (!res.writableEnded) {
        clientDisconnected = true;
        controller.abort(new Error("Client disconnected"));
      }
    };
    res.once("close", abortForDisconnect);

    let fullResponse = "";
    let completed = false;
    let finalized = false;
    try {
      const context = await buildConversationContext({
        conversationId: found.conversation._id,
        currentMessageId: userMessage._id,
      });
      if (controller.signal.aborted) throw controller.signal.reason;
      const events = aiService.streamAnswer({
        query: input.content,
        conversationHistory: context.history,
        conversationSummary: context.summary,
        sourceUrl: found.conversation.sourceUrl,
        selectedTopic: input.selectedTopic,
      }, { signal: controller.signal });

      for await (const item of events) {
        if (item.event === "token") {
          fullResponse += item.data.text;
          const writable = await writeSse(res, "token", item.data);
          if (!writable) {
            clientDisconnected = true;
            controller.abort(new Error("Client disconnected"));
            break;
          }
        } else if (item.event === "done") {
          if (item.data.result && item.data.result !== fullResponse) {
            fullResponse = item.data.result;
          }
          const completion = await Message.updateOne(
            { _id: assistantMessage._id, status: "streaming" },
            { $set: { content: fullResponse, status: "complete" } },
          );
          if (completion.modifiedCount !== 1) {
            throw new Error("Could not persist the completed assistant response");
          }
          completed = true;

          const updates = {};
          if (found.conversation.title === "New Conversation") {
            updates.title = input.content.slice(0, 120);
          }
          if (item.data.url && !found.conversation.sourceUrl) {
            updates.sourceUrl = item.data.url;
          }
          const responseTopics = Array.isArray(item.data.topics) && item.data.topics.length
            ? item.data.topics
            : (found.conversation.availableTopics || []);
          const awaitingTopicSelection = item.data.awaiting_topic_selection === true;
          const allowWholeWebsite = item.data.allow_whole_website === true
            || found.conversation.allowWholeWebsite === true;
          updates.awaitingTopicSelection = awaitingTopicSelection;
          updates.allowWholeWebsite = allowWholeWebsite;
          updates.availableTopics = responseTopics;
          await Conversation.updateOne(
            { _id: found.conversation._id, userId: req.user.id },
            { $set: { ...updates, updatedAt: new Date() } },
          );

          await writeSse(res, "done", {
            success: true,
            conversationId: found.conversation._id,
            message: { ...assistantMessage.toObject(), content: fullResponse, status: "complete" },
            sourceUrl: item.data.url || found.conversation.sourceUrl || null,
            topics: responseTopics,
            awaitingTopicSelection,
            allowWholeWebsite,
          });
          break;
        }
      }
    } catch (error) {
      const disconnected = clientDisconnected;
      await Message.updateOne(
        { _id: assistantMessage._id, status: "streaming" },
        { $set: { content: fullResponse, status: fullResponse ? "incomplete" : "failed" } },
      ).then(() => { finalized = true; }).catch((persistError) => {
        console.error("[MESSAGE] Could not mark interrupted response:", persistError.message);
      });

      if (!disconnected && !res.destroyed) {
        await writeSse(res, "error", {
          message: controller.signal.aborted ? "AI response timed out" : error.message,
          incomplete: !completed && Boolean(fullResponse),
        });
      }
    } finally {
      clearTimeout(timeout);
      res.off("close", abortForDisconnect);
      if (!completed && !finalized && assistantMessage.status === "streaming") {
        await Message.updateOne(
          { _id: assistantMessage._id, status: "streaming" },
          { $set: { content: fullResponse, status: fullResponse ? "incomplete" : "failed" } },
        ).then(() => { finalized = true; }).catch((error) => {
          console.error("[MESSAGE] Could not finalize interrupted response:", error.message);
        });
      }
      if (!res.writableEnded && !res.destroyed) res.end();
    }
  } catch (error) {
    console.error("[MESSAGE] Could not start streaming response:", error.message);
    if (!res.headersSent) {
      return res.status(500).json({ success: false, message: "Failed to start response stream" });
    }
    if (!res.destroyed) {
      await writeSse(res, "error", { message: "Failed to start response stream", incomplete: false });
      res.end();
    }
  }
}

const sendMessage = async (req, res) => {
  if (req.body?.stream === true) return sendStreamingMessage(req, res);
  try {
    const { id } = req.params;
    const content = req.body?.message;
    if (typeof content !== "string" || !content.trim()) {
      return res.status(400).json({ success: false, message: "Message cannot be empty" });
    }
    if (content.trim().length > MAX_MESSAGE_LENGTH) {
      return res.status(400).json({
        success: false,
        message: `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters`,
      });
    }
    const selectedTopic = req.body?.selectedTopic;
    if (selectedTopic !== undefined && selectedTopic !== null && typeof selectedTopic !== "string") {
      return res.status(400).json({ success: false, message: "Selected topic must be text" });
    }

    const found = await findOwnedConversation(id, req.user.id);
    if (found.error === "invalid") {
      return res.status(400).json({ success: false, message: "Invalid conversation ID" });
    }
    if (!found.conversation) {
      return res.status(404).json({ success: false, message: "Conversation not found" });
    }

    const conversation = found.conversation;
    console.log(`[CONVERSATION] Conversation found: ${conversation._id}`);
    const userMessage = await Message.create({
      conversationId: conversation._id,
      role: "user",
      content: content.trim(),
    });
    console.log(`[MESSAGE] User message saved: ${userMessage._id}`);

    const { history: conversationHistory, summary: conversationSummary } =
      await buildConversationContext({
        conversationId: conversation._id,
        currentMessageId: userMessage._id,
      });
    console.log(`[HISTORY] Previous messages retrieved: ${conversationHistory.length}`);

    let aiResult;
    try {
      console.log("[AI] Sending request to FastAPI");
      aiResult = await aiService.generateAnswer({
        query: content.trim(),
        conversationHistory,
        conversationSummary,
        sourceUrl: conversation.sourceUrl,
        selectedTopic,
      });
      console.log("[AI] Response received");
    } catch (error) {
      console.error("[AI] FastAPI request failed:", error.message);
      return res.status(502).json({
        success: false,
        message: "The AI service could not generate a response",
        userMessage,
      });
    }

    const assistantMessage = await Message.create({
      conversationId: conversation._id,
      role: "assistant",
      content: aiResult.result.trim(),
    });
    console.log(`[MESSAGE] Assistant message saved: ${assistantMessage._id}`);

    const updates = {};
    if (conversation.title === "New Conversation") {
      updates.title = content.trim().slice(0, 120);
    }
    if (aiResult.url && !conversation.sourceUrl) {
      updates.sourceUrl = aiResult.url;
    }
    const responseTopics = Array.isArray(aiResult.topics) && aiResult.topics.length
      ? aiResult.topics
      : (conversation.availableTopics || []);
    const awaitingTopicSelection = aiResult.awaiting_topic_selection === true;
    const allowWholeWebsite = aiResult.allow_whole_website === true
      || conversation.allowWholeWebsite === true;
    updates.awaitingTopicSelection = awaitingTopicSelection;
    updates.allowWholeWebsite = allowWholeWebsite;
    updates.availableTopics = responseTopics;
    if (Object.keys(updates).length) {
      await Conversation.updateOne({ _id: conversation._id }, { $set: updates });
    } else {
      await Conversation.updateOne({ _id: conversation._id }, { $set: { updatedAt: new Date() } });
    }

    return res.status(200).json({
      success: true,
      conversationId: conversation._id,
      message: assistantMessage,
      sourceUrl: aiResult.url || conversation.sourceUrl || null,
      topics: responseTopics,
      awaitingTopicSelection,
      allowWholeWebsite,
    });
  } catch (error) {
    console.error("[MESSAGE] Could not process message:", error.message);
    return res.status(500).json({ success: false, message: "Failed to process message" });
  }
};

export {
  createConversation,
  getConversations,
  getConversation,
  deleteConversation,
  getMessages,
  sendMessage,
};
