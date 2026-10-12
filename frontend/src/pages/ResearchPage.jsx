import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  createConversation,
  deleteConversation,
  getConversation,
  listConversations,
  streamConversationMessage,
} from "../api/conversationApi";
import { useAuth } from "../context/AuthContext";
import Navbar from "../components/navbar";
import logo from "../components/logo.png";
import "./ResearchPage.css";

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function ResearchPage() {
  const { token } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [conversations, setConversations] = useState([]);
  const [conversation, setConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [topics, setTopics] = useState([]);
  const [awaitingTopicSelection, setAwaitingTopicSelection] = useState(false);
  const [allowWholeWebsite, setAllowWholeWebsite] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState(null);
  const [draft, setDraft] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingConversation, setLoadingConversation] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const composerRef = useRef(null);
  const autoStartRef = useRef(false);
  const submitMessageRef = useRef(null);
  const activeStreamRef = useRef(null);

  useEffect(() => () => activeStreamRef.current?.abort(), []);

  useEffect(() => {
    if (!token) {
      navigate("/login", {
        replace: true,
        state: { from: { pathname: "/research", state: location.state } },
      });
      return;
    }

    let active = true;
    listConversations(token)
      .then(({ conversations: saved = [] }) => {
        if (active) setConversations(saved);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoadingList(false);
      });

    return () => {
      active = false;
    };
  }, [token, navigate, location.state]);

  useEffect(() => {
    const initialDraft = location.state?.draft;
    if (!initialDraft || autoStartRef.current || !token || loadingList) return;

    autoStartRef.current = true;
    navigate(location.pathname, { replace: true, state: null });
    setDraft(initialDraft);
    void submitMessageRef.current(initialDraft);
  }, [location.pathname, location.state, loadingList, token, navigate]);

  async function openConversation(conversationId) {
    activeStreamRef.current?.abort();
    setLoadingConversation(true);
    setError("");
    setNotice("");
    setSelectedTopic(null);
    try {
      const data = await getConversation(token, conversationId);
      setConversation(data.conversation);
      setMessages(data.messages || []);
      setTopics(data.conversation.availableTopics || []);
      setAwaitingTopicSelection(data.conversation.awaitingTopicSelection === true);
      setAllowWholeWebsite(data.conversation.allowWholeWebsite === true);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingConversation(false);
    }
  }

  async function startNewConversation() {
    activeStreamRef.current?.abort();
    setError("");
    setConversation(null);
    setMessages([]);
    setTopics([]);
    setAwaitingTopicSelection(false);
    setAllowWholeWebsite(false);
    setSelectedTopic(null);
    setNotice("");
    setDraft("");
  }

  async function removeConversation(event, item) {
    event.stopPropagation();
    setError("");
    try {
      await deleteConversation(token, item._id);
      setConversations((current) => current.filter(({ _id }) => _id !== item._id));
      if (conversation?._id === item._id) await startNewConversation();
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  async function submitMessage(value = draft) {
    const messageText = value.trim();
    if (!messageText || sending) return;

    setError("");
    setNotice("");
    setSending(true);
    setDraft("");
    const requestId = crypto.randomUUID?.()
      || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const streamController = new AbortController();
    activeStreamRef.current = streamController;
    const streamingAssistantId = `stream-${requestId}`;
    const optimisticUserMessage = {
      _id: `pending-${Date.now()}`,
      role: "user",
      content: messageText,
      createdAt: new Date().toISOString(),
    };
    setMessages((current) => [...current, optimisticUserMessage, {
      _id: streamingAssistantId,
      role: "assistant",
      content: "",
      status: "streaming",
      createdAt: new Date().toISOString(),
    }]);

    try {
      let activeConversation = conversation;
      if (!activeConversation) {
        const created = await createConversation(token, messageText.slice(0, 120));
        activeConversation = created.conversation;
        setConversation(activeConversation);
        setConversations((current) => [
          activeConversation,
          ...current.filter(({ _id }) => _id !== activeConversation._id),
        ]);
      }

      const response = await streamConversationMessage(
        token,
        activeConversation._id,
        messageText,
        selectedTopic,
        {
          requestId,
          signal: streamController.signal,
          onToken: (text) => setMessages((current) => current.map((message) =>
            message._id === streamingAssistantId
              ? { ...message, content: message.content + text }
              : message,
          )),
        },
      );
      const assistantMessage = response.message;
      setMessages((current) => current.map((message) => {
        if (message._id === optimisticUserMessage._id) {
          return { ...optimisticUserMessage, _id: `sent-${optimisticUserMessage._id}` };
        }
        return message._id === streamingAssistantId ? assistantMessage : message;
      }));
      setTopics(response.topics || []);
      setAwaitingTopicSelection(response.awaitingTopicSelection === true);
      setAllowWholeWebsite(response.allowWholeWebsite === true);
      setSelectedTopic(null);
      setConversations((current) => current.map((item) =>
        item._id === activeConversation._id
          ? {
              ...item,
              title: item.title === "New Conversation" ? messageText.slice(0, 120) : item.title,
              sourceUrl: response.sourceUrl || item.sourceUrl || null,
              availableTopics: response.topics || [],
              awaitingTopicSelection: response.awaitingTopicSelection === true,
              allowWholeWebsite: response.allowWholeWebsite === true,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ));
      setConversation((current) => current ? {
        ...current,
        title: current.title === "New Conversation" ? messageText.slice(0, 120) : current.title,
        sourceUrl: response.sourceUrl || current.sourceUrl || null,
        availableTopics: response.topics || [],
        awaitingTopicSelection: response.awaitingTopicSelection === true,
        allowWholeWebsite: response.allowWholeWebsite === true,
      } : current);
      if (response.awaitingTopicSelection) {
        setNotice("Choose a section to focus the next answer, or ask about the whole page.");
      }
    } catch (requestError) {
      const interrupted = requestError.name === "AbortError" || requestError.incomplete;
      setMessages((current) => current.map((message) => {
        if (message._id === optimisticUserMessage._id) {
          return { ...message, _id: `sent-${optimisticUserMessage._id}` };
        }
        if (message._id === streamingAssistantId) {
          return {
            ...message,
            content: requestError.partialContent ?? message.content,
            status: interrupted ? "incomplete" : "failed",
          };
        }
        return message;
      }));
      if (requestError.name !== "AbortError") {
        setError(requestError.message);
      } else {
        setNotice("Response stopped. Its partial answer is marked incomplete.");
      }
    } finally {
      if (activeStreamRef.current === streamController) activeStreamRef.current = null;
      setSending(false);
      requestAnimationFrame(() => composerRef.current?.focus());
    }
  }

  function stopResponse() {
    activeStreamRef.current?.abort();
  }

  submitMessageRef.current = submitMessage;

  function handleComposerSubmit(event) {
    event.preventDefault();
    void submitMessage();
  }

  return (
    <div className="research-page">
      <Navbar />
      <div className="research-shell">
        <aside className="research-sidebar" aria-label="Saved conversations">
          <div className="research-sidebar-head">
            <div>
              <p className="research-eyebrow">YOUR WORKSPACE</p>
              <h1>Research</h1>
            </div>
            <button className="new-research-button" onClick={startNewConversation} aria-label="Start a new conversation" title="New conversation">
              +
            </button>
          </div>
          <button className="sidebar-new-button" onClick={startNewConversation}>
            <span aria-hidden="true">＋</span> New research
          </button>
          <div className="conversation-list-label">RECENT</div>
          {loadingList ? (
            <p className="sidebar-empty">Loading saved research…</p>
          ) : conversations.length ? (
            <div className="conversation-list">
              {conversations.map((item) => (
                <div className={`conversation-item${conversation?._id === item._id ? " active" : ""}`} key={item._id}>
                  <button className="conversation-open" onClick={() => openConversation(item._id)}>
                    <span className="conversation-title">{item.title || "New Conversation"}</span>
                    <span className="conversation-date">{formatDate(item.updatedAt || item.createdAt)}</span>
                  </button>
                  <button className="conversation-delete" onClick={(event) => removeConversation(event, item)} aria-label={`Delete ${item.title || "conversation"}`} title="Delete conversation">×</button>
                </div>
              ))}
            </div>
          ) : (
            <p className="sidebar-empty">Your saved research will appear here.</p>
          )}
          <div className="sidebar-footnote">
            <img src={logo} alt="" />
            <span>Reading Lizard<br /><small>Research that remembers.</small></span>
          </div>
        </aside>

        <main className="research-main">
          <div className="research-main-topline">
            <div>
              <p className="research-eyebrow">AI RESEARCH MODE</p>
              <h2>{conversation?.title || "What are you curious about?"}</h2>
            </div>
            {conversation?.sourceUrl && <span className="source-indicator" title={conversation.sourceUrl}>Website source attached</span>}
          </div>

          {error && <div className="research-alert" role="alert">{error}</div>}
          {notice && <div className="research-notice" role="status">{notice}</div>}

          {loadingConversation ? (
            <div className="research-empty-state">Opening your research…</div>
          ) : messages.length ? (
            <div className="message-thread" aria-live="polite">
              {messages.map((message) => (
                <article className={`message-row ${message.role}`} key={message._id}>
                  {message.role === "assistant" && <img className="message-avatar" src={logo} alt="Reading Lizard" />}
                  <div className="message-bubble">
                    <span className="message-role">
                      {message.role === "assistant" ? "Reading Lizard" : "You"}
                      {message.status === "incomplete" && " · Incomplete"}
                    </span>
                    <div className="message-content">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {message.content}
                      </ReactMarkdown>
                    </div>
                  </div>
                </article>
              ))}
              {sending && <div className="message-pending"><span /><span /><span /> Generating response…</div>}
            </div>
          ) : (
            <div className="research-empty-state">
              <img src={logo} alt="" />
              <p>Paste a link, ask a question, or share a large text source.</p>
              <span>Your answers stay in this conversation.</span>
            </div>
          )}

          {awaitingTopicSelection && topics.length > 0 && (
            <section className="topic-picker" aria-label="Website topics">
              <div className="topic-picker-heading">
                <div>
                  <p className="research-eyebrow">PAGE SECTIONS</p>
                  <h3>Choose where to begin</h3>
                </div>
                <span>{topics.length} topics</span>
              </div>
              <div className="topic-list">
                {topics.map((topic) => (
                  <button
                    key={`${topic.level}-${topic.title}`}
                    className={`topic-option${selectedTopic === topic.title ? " selected" : ""}`}
                    onClick={() => {
                      setSelectedTopic(topic.title);
                      composerRef.current?.focus();
                    }}
                  >
                    <span className="topic-level">H{topic.level}</span>
                    <span>{topic.title}</span>
                    <span className="topic-arrow" aria-hidden="true">→</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {allowWholeWebsite && awaitingTopicSelection && (
            <button className={`whole-source-button${selectedTopic === "" ? " selected" : ""}`} onClick={() => {
              setSelectedTopic("");
              composerRef.current?.focus();
            }}>
              Ask about the whole website
            </button>
          )}

          {selectedTopic && <div className="selected-topic-label">Focused on <strong>{selectedTopic}</strong><button onClick={() => setSelectedTopic(null)} aria-label="Clear selected topic">×</button></div>}

          <form className="message-composer" onSubmit={handleComposerSubmit}>
            <textarea
              ref={composerRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  handleComposerSubmit(event);
                }
              }}
              placeholder={selectedTopic ? `Ask about ${selectedTopic}…` : "Paste a website URL or ask a question…"}
              rows={2}
              maxLength={20000}
              disabled={sending}
              aria-label="Your question or source URL"
            />
            <div className="composer-footer">
              <span>Enter to send · Shift+Enter for a new line</span>
              {sending ? (
                <button type="button" onClick={stopResponse} aria-label="Stop response" title="Stop response">■</button>
              ) : (
                <button type="submit" disabled={!draft.trim()} aria-label="Send message" title="Send message">↑</button>
              )}
            </div>
          </form>
        </main>
      </div>
    </div>
  );
}

export default ResearchPage;
