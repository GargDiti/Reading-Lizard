import { useEffect, useMemo, useRef, useState } from "react";
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

function buildTopicTree(topics) {
  const roots = [];
  const ancestors = [];
  topics.forEach((topic, index) => {
    const level = Math.min(3, Math.max(1, Number(topic.level) || 1));
    const title = String(topic.title || "").trim().replace(/\s+/g, " ");
    if (!title) return;
    while (ancestors.length && ancestors[ancestors.length - 1].level >= level) ancestors.pop();
    const parent = ancestors[ancestors.length - 1] || null;
    const siblings = parent ? parent.children : roots;
    const existing = siblings.find((item) => item.title.toLocaleLowerCase() === title.toLocaleLowerCase());
    const node = existing || { ...topic, title, level, key: `${level}-${index}-${title}`, children: [] };
    if (!existing) siblings.push(node);
    ancestors.push(node);
  });
  return roots;
}

function filterTopicTree(nodes, query) {
  if (!query) return nodes;
  const normalizedQuery = query.toLocaleLowerCase();
  return nodes.reduce((matches, node) => {
    const children = filterTopicTree(node.children, query);
    if (node.title.toLocaleLowerCase().includes(normalizedQuery) || children.length) {
      matches.push({ ...node, children });
    }
    return matches;
  }, []);
}

function countTopicTree(nodes) {
  return nodes.reduce((total, node) => total + 1 + countTopicTree(node.children), 0);
}

function TopicTreeNode({ node, expandedTopics, onToggle, selectedTopic, onSelect, onAsk, searchActive }) {
  const isExpanded = searchActive || expandedTopics.has(node.key);
  const hasChildren = node.children.length > 0;
  const handleKeyDown = (event) => {
    const currentItem = event.currentTarget.closest("[role='treeitem']");
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const buttons = Array.from(currentItem.closest("[role='tree']").querySelectorAll("button[data-topic-key]"))
        .filter((button) => button.getClientRects().length > 0);
      const currentIndex = buttons.indexOf(event.currentTarget);
      const nextIndex = event.key === "ArrowDown"
        ? Math.min(buttons.length - 1, currentIndex + 1)
        : Math.max(0, currentIndex - 1);
      buttons[nextIndex]?.focus();
    } else if (event.key === "ArrowRight" && hasChildren) {
      event.preventDefault();
      if (!isExpanded) onToggle(node.key);
      else currentItem.querySelector(":scope > ul button[data-topic-key]")?.focus();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      if (hasChildren && isExpanded) onToggle(node.key);
      else currentItem.parentElement.closest("[role='treeitem']")?.querySelector(":scope > .topic-row button[data-topic-key]")?.focus();
    }
  };
  return (
    <li className={`topic-tree-node level-${node.level}`} role="treeitem" aria-expanded={hasChildren ? isExpanded : undefined}>
      <div className={`topic-row${selectedTopic === node.title ? " is-active" : ""}`}>
        <button
          className={`topic-expand-toggle${isExpanded ? " is-open" : ""}`}
          type="button"
          aria-label={`${isExpanded ? "Collapse" : "Expand"} ${node.title}`}
          aria-expanded={isExpanded}
          tabIndex={hasChildren ? 0 : -1}
          onKeyDown={handleKeyDown}
          onClick={() => hasChildren && onToggle(node.key)}
        >{hasChildren ? "›" : ""}</button>
        <button
          className={`topic-option level-${node.level}${hasChildren ? " has-children" : ""}${selectedTopic === node.title ? " selected" : ""}`}
          title={node.title}
          aria-current={selectedTopic === node.title ? "true" : undefined}
          data-topic-key={node.key}
          onKeyDown={handleKeyDown}
          onClick={() => onSelect(node.title)}
        >
          <span className="topic-title">{node.title}</span>
        </button>
        <button className="topic-ask-button" type="button" title={`Ask about ${node.title}`} aria-label={`Ask about ${node.title}`} onClick={() => onAsk(node.title)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H8l-4 2v-5a7.5 7.5 0 1 1 16-4.5Z" /><path d="M9.8 9.5a2.3 2.3 0 1 1 3.7 1.8c-.9.6-1.5 1.1-1.5 2.2M12 16.4v.1" /></svg>
        </button>
      </div>
      {hasChildren && isExpanded && <ul className="topic-children" role="group">
        {node.children.map((child) => <TopicTreeNode key={child.key} node={child} expandedTopics={expandedTopics} onToggle={onToggle} selectedTopic={selectedTopic} onSelect={onSelect} onAsk={onAsk} searchActive={searchActive} />)}
      </ul>}
    </li>
  );
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
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [topicDrawerOpen, setTopicDrawerOpen] = useState(false);
  const [topicSearch, setTopicSearch] = useState("");
  const [expandedTopics, setExpandedTopics] = useState(() => new Set());
  const topicSearchRef = useRef(null);
  const topicTree = useMemo(() => buildTopicTree(topics), [topics]);
  const visibleTopicTree = useMemo(() => filterTopicTree(topicTree, topicSearch.trim()), [topicTree, topicSearch]);
  const topicCount = useMemo(() => countTopicTree(topicTree), [topicTree]);
  const expandableTopicKeys = useMemo(() => {
    const keys = [];
    const visit = (nodes) => nodes.forEach((node) => {
      if (node.children.length) keys.push(node.key);
      visit(node.children);
    });
    visit(topicTree);
    return keys;
  }, [topicTree]);

  useEffect(() => {
    setExpandedTopics(new Set(expandableTopicKeys.slice(0, 2)));
  }, [conversation?._id, expandableTopicKeys]);

  useEffect(() => {
    if (!topicDrawerOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setTopicDrawerOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    topicSearchRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [topicDrawerOpen]);
  const composerRef = useRef(null);
  const threadRef = useRef(null);
  const autoStartRef = useRef(false);
  const submitMessageRef = useRef(null);
  const activeStreamRef = useRef(null);
  const autoOpenConversationRef = useRef(null);
  const openConversationRef = useRef(null);

  useEffect(() => () => activeStreamRef.current?.abort(), []);

  useEffect(() => {
    const thread = threadRef.current;
    if (thread) thread.scrollTop = thread.scrollHeight;
  }, [messages]);

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

  useEffect(() => {
    const conversationId = location.state?.conversationId;
    if (!conversationId || loadingList || !token || autoOpenConversationRef.current === conversationId) return;
    autoOpenConversationRef.current = conversationId;
    navigate(location.pathname, { replace: true, state: null });
    void openConversationRef.current(conversationId);
  }, [location.pathname, location.state, loadingList, token, navigate]);

  async function openConversation(conversationId) {
    activeStreamRef.current?.abort();
    setLoadingConversation(true);
    setError("");
    setNotice("");
    setSelectedTopic(null);
    setTopicSearch("");
    setTopicDrawerOpen(false);
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
  openConversationRef.current = openConversation;

  async function startNewConversation() {
    activeStreamRef.current?.abort();
    setError("");
    setConversation(null);
    setMessages([]);
    setTopics([]);
    setAwaitingTopicSelection(false);
    setAllowWholeWebsite(false);
    setSelectedTopic(null);
    setTopicSearch("");
    setTopicDrawerOpen(false);
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
      const responseTopics = Array.isArray(response.topics) && response.topics.length
        ? response.topics
        : topics;
      const responseAllowsWholeWebsite = response.allowWholeWebsite === true || allowWholeWebsite;
      setMessages((current) => current.map((message) => {
        if (message._id === optimisticUserMessage._id) {
          return { ...optimisticUserMessage, _id: `sent-${optimisticUserMessage._id}` };
        }
        return message._id === streamingAssistantId ? assistantMessage : message;
      }));
      setTopics(responseTopics);
      setAwaitingTopicSelection(response.awaitingTopicSelection === true);
      setAllowWholeWebsite(responseAllowsWholeWebsite);
      setSelectedTopic(null);
      setConversations((current) => current.map((item) =>
        item._id === activeConversation._id
          ? {
              ...item,
              title: item.title === "New Conversation" ? messageText.slice(0, 120) : item.title,
              sourceUrl: response.sourceUrl || item.sourceUrl || null,
              availableTopics: responseTopics,
              awaitingTopicSelection: response.awaitingTopicSelection === true,
              allowWholeWebsite: responseAllowsWholeWebsite,
              updatedAt: new Date().toISOString(),
            }
          : item,
      ));
      setConversation((current) => current ? {
        ...current,
        title: current.title === "New Conversation" ? messageText.slice(0, 120) : current.title,
        sourceUrl: response.sourceUrl || current.sourceUrl || null,
        availableTopics: responseTopics,
        awaitingTopicSelection: response.awaitingTopicSelection === true,
        allowWholeWebsite: responseAllowsWholeWebsite,
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

  function toggleTopic(topicKey) {
    setExpandedTopics((current) => {
      const next = new Set(current);
      if (next.has(topicKey)) next.delete(topicKey);
      else next.add(topicKey);
      return next;
    });
  }

  function selectTopic(title) {
    setSelectedTopic(title);
    const matchingHeading = Array.from(threadRef.current?.querySelectorAll("h1, h2, h3, h4") || [])
      .find((heading) => heading.textContent.trim().toLocaleLowerCase() === title.toLocaleLowerCase());
    if (matchingHeading) {
      document.querySelectorAll(".topic-anchor-highlight").forEach((heading) => heading.classList.remove("topic-anchor-highlight"));
      matchingHeading.classList.add("topic-anchor-highlight");
      matchingHeading.scrollIntoView({ behavior: "smooth", block: "center" });
      window.setTimeout(() => matchingHeading.classList.remove("topic-anchor-highlight"), 1800);
    }
    composerRef.current?.focus();
  }

  return (
    <div className="research-page">
      <Navbar />
      <div className="research-shell">
        <aside className={`research-sidebar${sidebarOpen ? "" : " sidebar-collapsed"}`} aria-label="Saved conversations">
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
          <div id="research-sidebar-list"><div className="conversation-list-label">RECENT</div>
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
          )}</div>
          <div className="sidebar-footnote">
            <img src={logo} alt="" />
            <span>Reading Lizard<br /><small>Research that remembers.</small></span>
          </div>
        </aside>

        <main className="research-main">
          <div className="research-main-topline">
            <div>
              <div className="workspace-label-row"><button className="sidebar-toggle" type="button" onClick={() => setSidebarOpen((open) => !open)} aria-expanded={sidebarOpen} aria-controls="research-sidebar-list" aria-label={sidebarOpen ? "Collapse research sidebar" : "Expand research sidebar"}>☰</button><p className="research-eyebrow">AI RESEARCH MODE</p></div>
              <h2>{conversation?.title || "What are you curious about?"}</h2>
            </div>
            {conversation?.sourceUrl && <span className="source-indicator" title={conversation.sourceUrl}>Website source attached</span>}
            {conversation?.sourceUrl && topicCount > 0 && <button className="topic-drawer-trigger" type="button" aria-expanded={topicDrawerOpen} aria-controls="learning-tree-panel" onClick={() => setTopicDrawerOpen(true)}>Learning tree <span>{topicCount}</span></button>}
          </div>

          {error && <div className="research-alert" role="alert">{error}</div>}
          {notice && <div className="research-notice" role="status">{notice}</div>}

          <div className={`research-workspace${conversation?.sourceUrl && topicCount > 0 ? " has-topic-tree" : ""}`}>
            {loadingConversation ? (
              <div className="research-empty-state">Opening your research…</div>
            ) : messages.length ? (
              <div className="message-thread" aria-live="polite" ref={threadRef}>
                {messages.map((message) => (
                  <article className={`message-row ${message.role}`} key={message._id}>
                    {message.role === "assistant" && <img className="message-avatar" src={logo} alt="Reading Lizard" />}
                    <div className="message-bubble">
                      <span className="message-role">
                        {message.role === "assistant" ? "Reading Lizard" : "You"}
                        {message.status === "incomplete" && " · Incomplete"}
                      </span>
                      <div className="message-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ children, ...props }) => <a {...props} target="_blank" rel="noreferrer">{children}</a>, pre: ({ children }) => <pre className="message-code">{children}</pre> }}>
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

            {conversation?.sourceUrl && topicCount > 0 && (
              <>
              {topicDrawerOpen && <button className="topic-drawer-backdrop" type="button" aria-label="Close learning tree" onClick={() => setTopicDrawerOpen(false)} />}
              <aside className={`topic-picker${topicDrawerOpen ? " drawer-open" : ""}`} id="learning-tree-panel" aria-label="Indexed page topics">
                <div className="topic-picker-heading">
                  <div>
                    <p className="research-eyebrow">LEARNING TREE</p>
                    <h3>{awaitingTopicSelection ? "Choose a topic" : "Page topics"}</h3>
                  </div>
                  <span className="topic-tree-count">{topicCount} topics</span>
                  <button className="topic-tree-close" type="button" aria-label="Close learning tree" onClick={() => setTopicDrawerOpen(false)}>×</button>
                  <button className="topic-expand-all" type="button" disabled={!expandableTopicKeys.length} onClick={() => setExpandedTopics(expandableTopicKeys.length && expandableTopicKeys.every((key) => expandedTopics.has(key)) ? new Set() : new Set(expandableTopicKeys))}>
                    {expandableTopicKeys.length && expandableTopicKeys.every((key) => expandedTopics.has(key)) ? "Collapse all" : "Expand all"}
                  </button>
                </div>
                <label className="topic-search-wrap">
                  <span aria-hidden="true">⌕</span>
                  <input ref={topicSearchRef} type="search" value={topicSearch} onChange={(event) => setTopicSearch(event.target.value)} placeholder="Search topics" aria-label="Search topics" />
                </label>
                <nav className="topic-list" id="indexed-topic-tree" aria-label="Choose a topic">
                  {visibleTopicTree.length ? (
                    <ul role="tree">
                      {visibleTopicTree.map((node) => <TopicTreeNode key={node.key} node={node} expandedTopics={expandedTopics} onToggle={toggleTopic} selectedTopic={selectedTopic} onSelect={selectTopic} onAsk={selectTopic} searchActive={Boolean(topicSearch.trim())} />)}
                    </ul>
                  ) : <p className="topic-search-empty">No topics match that search.</p>}
                </nav>
                <div className="topic-tree-footer"><button className={`whole-source-button${selectedTopic === "" ? " selected" : ""}`} onClick={() => {
                    setSelectedTopic("");
                    composerRef.current?.focus();
                  }}>
                    Ask about the whole page
                  </button></div>
              </aside>
              </>
            )}
          </div>

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
