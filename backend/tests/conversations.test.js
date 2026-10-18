import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

import { getProfile, login, register } from "../src/controllers/authcontroller.js";
import {
  createConversation,
  deleteConversation,
  getConversation,
  sendMessage,
} from "../src/controllers/conversationController.js";
import authMiddleware from "../src/middleware/authmiddleware.js";
import Conversation from "../src/models/conversation.js";
import Message from "../src/models/message.js";
import User from "../src/models/User.js";
import aiService, { generateAnswer, streamAnswer } from "../src/services/aiService.js";

const userId = "64b000000000000000000001";
const otherUserId = "64b000000000000000000002";
const conversationId = "64b000000000000000000010";

function mockResponse() {
  return {
    statusCode: 200,
    body: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function mockStreamingResponse() {
  const response = new EventEmitter();
  response.statusCode = 200;
  response.headersSent = false;
  response.writableEnded = false;
  response.destroyed = false;
  response.events = [];
  response.status = function status(code) {
    this.statusCode = code;
    return this;
  };
  response.json = function json(body) {
    this.body = body;
    return this;
  };
  response.set = function set(headers) {
    this.headers = headers;
    return this;
  };
  response.flushHeaders = function flushHeaders() {
    this.headersSent = true;
  };
  response.write = function write(chunk) {
    this.events.push(chunk);
    return true;
  };
  response.end = function end() {
    this.writableEnded = true;
    this.emit("close");
  };
  return response;
}

function stub(t, target, key, replacement) {
  const original = target[key];
  target[key] = replacement;
  t.after(() => {
    target[key] = original;
  });
}

test("production AI requests require a non-local deployed service URL", async (t) => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousAIServiceUrl = process.env.AI_SERVICE_URL;
  process.env.NODE_ENV = "production";
  delete process.env.AI_SERVICE_URL;
  t.after(() => {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousAIServiceUrl === undefined) delete process.env.AI_SERVICE_URL;
    else process.env.AI_SERVICE_URL = previousAIServiceUrl;
  });

  const request = { query: "test", conversationHistory: [] };
  await assert.rejects(
    generateAnswer(request),
    /AI_SERVICE_URL must be configured with the deployed AI service URL/,
  );

  process.env.AI_SERVICE_URL = "http://127.0.0.1:8000";
  await assert.rejects(
    generateAnswer(request),
    /AI_SERVICE_URL must not point to localhost in production/,
  );
});

test("production AI requests require and forward the shared internal service token", async (t) => {
  const priorNodeEnv = process.env.NODE_ENV;
  const priorServiceUrl = process.env.AI_SERVICE_URL;
  const priorServiceToken = process.env.AI_SERVICE_TOKEN;
  process.env.NODE_ENV = "production";
  process.env.AI_SERVICE_URL = "https://reading-lizard-ai.example.com";
  delete process.env.AI_SERVICE_TOKEN;
  t.after(() => {
    if (priorNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = priorNodeEnv;
    if (priorServiceUrl === undefined) delete process.env.AI_SERVICE_URL;
    else process.env.AI_SERVICE_URL = priorServiceUrl;
    if (priorServiceToken === undefined) delete process.env.AI_SERVICE_TOKEN;
    else process.env.AI_SERVICE_TOKEN = priorServiceToken;
  });

  await assert.rejects(
    generateAnswer({ query: "test" }),
    /AI_SERVICE_TOKEN must be configured/,
  );

  process.env.AI_SERVICE_TOKEN = "shared-test-token";
  let authHeader;
  stub(t, globalThis, "fetch", async (_url, options) => {
    authHeader = options.headers.Authorization;
    return { ok: true, json: async () => ({ result: "Safe response" }) };
  });
  await generateAnswer({ query: "test" });
  assert.equal(authHeader, "Bearer shared-test-token");
});

test("register hashes passwords and login returns a JWT accepted by auth middleware", async (t) => {
  const priorSecret = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-only-jwt-secret";
  t.after(() => {
    if (priorSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = priorSecret;
  });

  let insertedUser;
  let loginUser;
  let loginLookupMatched = false;
  stub(t, User, "findOne", (filter) => {
    if (loginUser && filter.email === loginUser.email) {
      loginLookupMatched = true;
      return { select: async () => loginUser };
    }
    return null;
  });
  stub(t, User, "create", async (details) => {
    insertedUser = { ...details, _id: userId };
    return insertedUser;
  });

  const registerResponse = mockResponse();
  await register(
    { body: { name: "A Student", email: "student@example.com", password: "password123" } },
    registerResponse,
    (error) => { throw error; },
  );

  assert.equal(registerResponse.statusCode, 201);
  assert.notEqual(insertedUser.password, "password123");
  assert.equal(await bcrypt.compare("password123", insertedUser.password), true);

  loginUser = { ...insertedUser };
  const loginResponse = mockResponse();
  await login(
    { body: { email: "student@example.com", password: "password123" } },
    loginResponse,
    (error) => { throw error; },
  );

  assert.equal(loginLookupMatched, true);
  assert.equal(
    loginResponse.statusCode,
    200,
    loginResponse.body?.message,
  );
  const decoded = jwt.verify(loginResponse.body.token, process.env.JWT_SECRET);
  assert.equal(decoded.userId, userId);

  const middlewareResponse = mockResponse();
  const authenticatedRequest = {
    headers: { authorization: `Bearer ${loginResponse.body.token}` },
  };
  authMiddleware(
    authenticatedRequest,
    middlewareResponse,
    () => {},
  );
  assert.equal(authenticatedRequest.user.id, userId);
});

test("profile endpoint returns only the authenticated user's public account fields", async (t) => {
  let selectedFields;
  stub(t, User, "findById", (id) => {
    assert.equal(id, userId);
    return { select: async (fields) => {
      selectedFields = fields;
      return { _id: userId, name: "A Student", email: "student@example.com", createdAt: new Date("2026-01-01") };
    } };
  });
  const response = mockResponse();
  await getProfile({ user: { id: userId } }, response, (error) => { throw error; });
  assert.equal(response.statusCode, 200);
  assert.equal(selectedFields, "name email createdAt");
  assert.equal(response.body.user.name, "A Student");
  assert.equal(response.body.user.email, "student@example.com");
  assert.equal("password" in response.body.user, false);
});

test("auth middleware rejects missing and invalid JWTs", () => {
  for (const headers of [{}, { authorization: "Bearer invalid" }]) {
    const response = mockResponse();
    let passed = false;
    authMiddleware({ headers }, response, () => { passed = true; });
    assert.equal(passed, false);
    assert.equal(response.statusCode, 401);
  }
});

test("conversation creation always takes its owner from the verified request user", async (t) => {
  let created;
  stub(t, Conversation, "create", async (details) => {
    created = details;
    return { ...details, _id: conversationId };
  });

  const response = mockResponse();
  await createConversation(
    { user: { id: userId }, body: { title: "Node.js", userId: otherUserId } },
    response,
  );

  assert.equal(response.statusCode, 201);
  assert.equal(created.userId, userId);
  assert.equal(created.title, "Node.js");
});

test("conversation detail and deletion are owner-scoped", async (t) => {
  const conversation = { _id: conversationId, userId };
  const emptyConversationId = "64b000000000000000000011";
  let ownerFilter;
  stub(t, Conversation, "findOne", async (filter) => {
    ownerFilter = filter;
    if (filter.userId !== userId) return null;
    return filter._id === emptyConversationId
      ? { _id: emptyConversationId, userId }
      : conversation;
  });
  stub(t, Message, "find", (filter) => ({
    sort: async () => filter.conversationId === emptyConversationId
      ? []
      : [{ role: "user", content: "Hello" }],
  }));
  let deletedMessages = false;
  let deletedConversation = false;
  stub(t, Message, "deleteMany", async () => { deletedMessages = true; });
  stub(t, Conversation, "deleteOne", async () => { deletedConversation = true; });

  const detailResponse = mockResponse();
  await getConversation({ params: { id: conversationId }, user: { id: userId } }, detailResponse);
  assert.equal(detailResponse.statusCode, 200);
  assert.equal(ownerFilter.userId, userId);
  assert.equal(detailResponse.body.messages.length, 1);

  const forbiddenResponse = mockResponse();
  await getConversation(
    { params: { id: conversationId }, user: { id: otherUserId } },
    forbiddenResponse,
  );
  assert.equal(forbiddenResponse.statusCode, 404);
  assert.equal(ownerFilter.userId, otherUserId);

  const emptyResponse = mockResponse();
  await getConversation(
    { params: { id: emptyConversationId }, user: { id: userId } },
    emptyResponse,
  );
  assert.equal(emptyResponse.statusCode, 200);
  assert.deepEqual(emptyResponse.body.messages, []);

  const invalidIdResponse = mockResponse();
  await getConversation(
    { params: { id: "bad-id" }, user: { id: userId } },
    invalidIdResponse,
  );
  assert.equal(invalidIdResponse.statusCode, 400);

  const deleteResponse = mockResponse();
  await deleteConversation(
    { params: { id: conversationId }, user: { id: userId } },
    deleteResponse,
  );
  assert.equal(deleteResponse.statusCode, 200);
  assert.equal(deletedMessages, true);
  assert.equal(deletedConversation, true);
});

test("message flow stores both roles and sends recent history plus the saved source URL", async (t) => {
  const sourceUrl = "https://nodejs.org/learn/getting-started/introduction-to-nodejs";
  const conversation = { _id: conversationId, userId, title: "New Conversation", sourceUrl: null };
  const storedMessages = [];
  const aiCalls = [];

  stub(t, Conversation, "findOne", async (filter) =>
    filter.userId === userId ? conversation : null,
  );
  stub(t, Conversation, "findById", () => ({ lean: async () => conversation }));
  stub(t, Message, "create", async (message) => {
    const saved = {
      ...message,
      _id: `64b0000000000000000000${String(storedMessages.length + 20).padStart(2, "0")}`,
      createdAt: new Date(Date.now() + storedMessages.length),
    };
    storedMessages.push(saved);
    return saved;
  });
  stub(t, Message, "find", () => {
    const results = storedMessages
      .slice()
      .sort((left, right) => left.createdAt - right.createdAt);
    return {
      sort() { return this; },
      lean: async () => results,
    };
  });
  stub(t, Conversation, "updateOne", async (_filter, update) => {
    Object.assign(conversation, update.$set);
  });
  stub(t, aiService, "generateAnswer", async (payload) => {
    aiCalls.push(payload);
    return {
      result: payload.conversationHistory.length
        ? "It is fast because of its event-driven runtime."
        : "Node.js is a JavaScript runtime.",
      url: sourceUrl,
      topics: payload.query.includes(sourceUrl)
        ? [{ level: 1, title: "Introduction" }]
        : [],
      awaiting_topic_selection: payload.query.includes(sourceUrl),
      allow_whole_website: payload.query.includes(sourceUrl),
    };
  });

  const firstResponse = mockResponse();
  await sendMessage(
    {
      params: { id: conversationId },
      user: { id: userId },
      body: { message: `What is Node.js? ${sourceUrl}` },
    },
    firstResponse,
  );
  assert.equal(firstResponse.statusCode, 200);
  assert.equal(storedMessages[0].role, "user");
  assert.equal(storedMessages[1].role, "assistant");
  assert.equal(conversation.title, `What is Node.js? ${sourceUrl}`.slice(0, 120));
  assert.equal(conversation.sourceUrl, sourceUrl);
  assert.equal(firstResponse.body.sourceUrl, sourceUrl);
  assert.equal(conversation.awaitingTopicSelection, true);
  assert.deepEqual(conversation.availableTopics, [{ level: 1, title: "Introduction" }]);
  assert.deepEqual(aiCalls[0].conversationHistory, []);
  assert.deepEqual(firstResponse.body.topics, [{ level: 1, title: "Introduction" }]);
  assert.equal(firstResponse.body.awaitingTopicSelection, true);

  const followUpResponse = mockResponse();
  await sendMessage(
    {
      params: { id: conversationId },
      user: { id: userId },
      body: { message: "Why is it fast?" },
    },
    followUpResponse,
  );

  assert.equal(followUpResponse.statusCode, 200);
  assert.equal(storedMessages[2].role, "user");
  assert.equal(storedMessages[3].role, "assistant");
  assert.equal(aiCalls[1].sourceUrl, sourceUrl);
  assert.equal(aiCalls[1].selectedTopic, undefined);
  assert.deepEqual(aiCalls[1].conversationHistory, [
    { role: "user", content: `What is Node.js? ${sourceUrl}` },
    { role: "assistant", content: "Node.js is a JavaScript runtime." },
  ]);
  assert.match(followUpResponse.body.message.content, /event-driven/);
});

test("message endpoint forwards and returns a selected website topic", async (t) => {
  const conversation = {
    _id: conversationId,
    userId,
    title: "Node.js",
    sourceUrl: "https://nodejs.org/learn",
  };
  stub(t, Conversation, "findOne", async () => conversation);
  stub(t, Conversation, "findById", () => ({ lean: async () => conversation }));
  stub(t, Message, "create", async (message) => ({ _id: "message-id", ...message }));
  stub(t, Message, "find", () => ({
    sort() { return this; },
    lean: async () => [],
  }));
  stub(t, Conversation, "updateOne", async () => ({ modifiedCount: 1 }));
  let aiPayload;
  stub(t, aiService, "generateAnswer", async (payload) => {
    aiPayload = payload;
    return {
      result: "Node.js is event-driven.",
      topics: [],
      awaiting_topic_selection: false,
      allow_whole_website: false,
    };
  });

  const response = mockResponse();
  await sendMessage({
    params: { id: conversationId },
    user: { id: userId },
    body: { message: "Why is it fast?", selectedTopic: "Introduction" },
  }, response);

  assert.equal(response.statusCode, 200);
  assert.equal(aiPayload.selectedTopic, "Introduction");
  assert.deepEqual(response.body.topics, []);
  assert.equal(response.body.awaitingTopicSelection, false);
});

test("an empty assistant placeholder is valid only while it is streaming", async () => {
  const streamingPlaceholder = new Message({
    conversationId,
    role: "assistant",
    content: "",
    status: "streaming",
  });
  await assert.doesNotReject(streamingPlaceholder.validate());

  const completedWithoutContent = new Message({
    conversationId,
    role: "assistant",
    content: "",
    status: "complete",
  });
  await assert.rejects(completedWithoutContent.validate(), /content/);
});

test("streamed message persists one assistant response and replays duplicate request IDs", async (t) => {
  const conversation = {
    _id: conversationId,
    userId,
    title: "New Conversation",
    sourceUrl: null,
    toObject() { return { ...this }; },
  };
  const storedMessages = [];
  const updates = [];
  let createCount = 0;

  stub(t, Conversation, "findOne", async () => conversation);
  stub(t, Conversation, "findById", () => ({ lean: async () => conversation }));
  stub(t, Conversation, "updateOne", async (_filter, update) => {
    Object.assign(conversation, update.$set);
    return { modifiedCount: 1 };
  });
  stub(t, Message, "find", () => ({
    sort() { return this; },
    lean: async () => storedMessages.filter(({ status }) => status !== "streaming"),
  }));
  stub(t, Message, "create", async (details) => {
    createCount += 1;
    if (details.requestId && storedMessages.some(({ requestId }) => requestId === details.requestId)) {
      const duplicate = new Error("duplicate request ID");
      duplicate.code = 11000;
      throw duplicate;
    }
    const saved = {
      ...details,
      _id: `stream-message-${createCount}`,
      createdAt: new Date(Date.now() + createCount),
      toObject() { return { ...this, toObject: undefined }; },
    };
    storedMessages.push(saved);
    return saved;
  });
  stub(t, Message, "findOne", async (filter) => {
    if (filter.requestId) {
      return storedMessages.find((message) => message.requestId === filter.requestId) || null;
    }
    return storedMessages.find((message) => String(message.inReplyTo) === String(filter.inReplyTo)) || null;
  });
  stub(t, Message, "updateOne", async (filter, update) => {
    updates.push({ filter, update });
    const message = storedMessages.find(({ _id }) => String(_id) === String(filter._id));
    if (!message || message.status !== filter.status) return { modifiedCount: 0 };
    Object.assign(message, update.$set);
    return { modifiedCount: 1 };
  });
  stub(t, aiService, "streamAnswer", async function* () {
    yield { event: "token", data: { text: "Streaming " } };
    yield { event: "token", data: { text: "works." } };
    yield { event: "done", data: {
      result: "Streaming works.",
      url: null,
      topics: [],
      awaiting_topic_selection: false,
      allow_whole_website: false,
    } };
  });

  const request = {
    params: { id: conversationId },
    user: { id: userId },
    body: { message: "Explain streaming", stream: true, requestId: "request-0001" },
  };
  const response = mockStreamingResponse();
  await sendMessage(request, response);

  assert.equal(response.writableEnded, true);
  assert.equal(storedMessages.length, 2);
  assert.equal(storedMessages[0].role, "user");
  assert.equal(storedMessages[1].role, "assistant");
  assert.equal(storedMessages[1].content, "Streaming works.");
  assert.equal(storedMessages[1].status, "complete");
  assert.equal(updates.length, 1);
  assert.equal(response.events.filter((event) => event.startsWith("event: token")).length, 2);
  assert.match(response.events.at(-1), /event: done/);

  const replay = mockStreamingResponse();
  await sendMessage(request, replay);
  assert.equal(createCount, 3);
  assert.equal(replay.events.filter((event) => event.startsWith("event: token")).length, 1);
  assert.match(replay.events.at(-1), /"replayed":true/);
});

test("client disconnect saves partial assistant text once with incomplete status", async (t) => {
  const conversation = { _id: conversationId, userId, title: "Node.js", sourceUrl: null };
  const storedMessages = [];
  const updates = [];
  stub(t, Conversation, "findOne", async () => conversation);
  stub(t, Conversation, "findById", () => ({ lean: async () => conversation }));
  stub(t, Message, "find", () => ({ sort() { return this; }, lean: async () => [] }));
  stub(t, Message, "create", async (details) => {
    const saved = {
      ...details,
      _id: `disconnect-${storedMessages.length}`,
      toObject() { return { ...this }; },
    };
    storedMessages.push(saved);
    return saved;
  });
  stub(t, Message, "findOne", async () => null);
  stub(t, Message, "updateOne", async (filter, update) => {
    updates.push(update.$set);
    const message = storedMessages.find(({ _id }) => _id === filter._id);
    if (message?.status !== filter.status) return { modifiedCount: 0 };
    Object.assign(message, update.$set);
    return { modifiedCount: 1 };
  });
  stub(t, aiService, "streamAnswer", async function* (_payload, { signal }) {
    yield { event: "token", data: { text: "partial answer" } };
    if (!signal.aborted) {
      await new Promise((resolve) => {
        signal.addEventListener("abort", resolve, { once: true });
        if (signal.aborted) resolve();
      });
    }
    throw signal.reason;
  });

  const response = mockStreamingResponse();
  const write = response.write;
  response.write = function writeThenDisconnect(chunk) {
    const accepted = write.call(this, chunk);
    if (chunk.startsWith("event: token")) {
      this.destroyed = true;
      this.emit("close");
    }
    return accepted;
  };
  await sendMessage({
    params: { id: conversationId },
    user: { id: userId },
    body: { message: "Explain this", stream: true, requestId: "request-disconnect" },
  }, response);

  assert.equal(storedMessages.length, 2);
  assert.equal(storedMessages[1].content, "partial answer");
  assert.equal(storedMessages[1].status, "incomplete");
  assert.equal(updates.length, 1);
  assert.equal(response.events.filter((event) => event.startsWith("event: token")).length, 1);
});

test("message endpoint rejects invalid IDs, empty or oversized messages, and other users", async (t) => {
  let lookupCount = 0;
  stub(t, Conversation, "findOne", async (filter) => {
    lookupCount += 1;
    return filter.userId === userId ? { _id: conversationId, userId } : null;
  });
  stub(t, Message, "create", async () => {
    throw new Error("Should not save rejected messages");
  });
  stub(t, aiService, "generateAnswer", async () => {
    throw new Error("Should not call AI for rejected messages");
  });

  const invalidIdResponse = mockResponse();
  await sendMessage(
    { params: { id: "not-an-object-id" }, user: { id: userId }, body: { message: "Hello" } },
    invalidIdResponse,
  );
  assert.equal(invalidIdResponse.statusCode, 400);

  const emptyResponse = mockResponse();
  await sendMessage(
    { params: { id: conversationId }, user: { id: userId }, body: { message: "  " } },
    emptyResponse,
  );
  assert.equal(emptyResponse.statusCode, 400);

  const tooLongResponse = mockResponse();
  await sendMessage(
    { params: { id: conversationId }, user: { id: userId }, body: { message: "x".repeat(20001) } },
    tooLongResponse,
  );
  assert.equal(tooLongResponse.statusCode, 400);

  const otherUserResponse = mockResponse();
  await sendMessage(
    { params: { id: conversationId }, user: { id: otherUserId }, body: { message: "Hello" } },
    otherUserResponse,
  );
  assert.equal(otherUserResponse.statusCode, 404);

  const streamingOtherUserResponse = mockResponse();
  await sendMessage({
    params: { id: conversationId },
    user: { id: otherUserId },
    body: { message: "Hello", stream: true, requestId: "request-0002" },
  }, streamingOtherUserResponse);
  assert.equal(streamingOtherUserResponse.statusCode, 404);
  assert.equal(lookupCount, 2);
});

test("Node AI client posts query, history, and source URL to FastAPI", async (t) => {
  const priorUrl = process.env.AI_SERVICE_URL;
  t.after(() => {
    if (priorUrl === undefined) delete process.env.AI_SERVICE_URL;
    else process.env.AI_SERVICE_URL = priorUrl;
  });

  let requestBody;
  stub(t, globalThis, "fetch", async (url, options) => {
    assert.equal(url, "http://localhost:8000/analyze-query");
    requestBody = JSON.parse(options.body);
    return { ok: true, json: async () => ({ result: "Contextual answer" }) };
  });

  const { generateAnswer } = await import("../src/services/aiService.js");
  for (const serviceUrl of [
    "http://localhost:8000",
    "http://localhost:8000/analyze-query",
  ]) {
    process.env.AI_SERVICE_URL = serviceUrl;
    const result = await generateAnswer({
      query: "Why is it fast?",
      conversationHistory: [{ role: "user", content: "What is Node.js?" }],
      sourceUrl: "https://nodejs.org/learn",
    });

    assert.equal(result.result, "Contextual answer");
  }
  assert.deepEqual(requestBody, {
    query: "Why is it fast?",
    conversation_history: [{ role: "user", content: "What is Node.js?" }],
    source_url: "https://nodejs.org/learn",
    selected_topic: null,
  });
});

test("Node AI client forwards SSE tokens and rejects incomplete streams", async (t) => {
  const priorUrl = process.env.AI_SERVICE_URL;
  process.env.AI_SERVICE_URL = "http://localhost:8000";
  t.after(() => {
    if (priorUrl === undefined) delete process.env.AI_SERVICE_URL;
    else process.env.AI_SERVICE_URL = priorUrl;
  });

  let requestBody;
  const frames = [
    'event: token\ndata: {"text":"first "}\n\n',
    'event: token\ndata: {"text":"second"}\n\n',
    'event: done\ndata: {"result":"first second"}\n\n',
  ];
  stub(t, globalThis, "fetch", async (_url, options) => {
    requestBody = JSON.parse(options.body);
    let index = 0;
    return {
      ok: true,
      body: new ReadableStream({
        pull(controller) {
          if (index === frames.length) return controller.close();
          controller.enqueue(new TextEncoder().encode(frames[index++]));
        },
      }),
    };
  });

  const received = [];
  for await (const event of streamAnswer({ query: "Teach me", conversationHistory: [] })) {
    received.push(event);
  }

  assert.deepEqual(received.map(({ event }) => event), ["token", "token", "done"]);
  assert.deepEqual(received.slice(0, 2).map(({ data }) => data.text), ["first ", "second"]);
  assert.equal(requestBody.stream, true);
  assert.equal(requestBody.query, "Teach me");

  stub(t, globalThis, "fetch", async () => ({
    ok: true,
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: token\ndata: {"text":"partial"}\n\n'));
        controller.close();
      },
    }),
  }));
  await assert.rejects(
    async () => {
      for await (const _event of streamAnswer({ query: "Incomplete" })) {}
    },
    /AI stream ended before completion/,
  );
});
