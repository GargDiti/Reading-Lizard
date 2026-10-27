import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext";
import "./ResearchCard.css";

const EXAMPLES = [
  "How does retrieval augmented generation work?",
  "Compare vector search and keyword search",
  "Explain JavaScript closures simply",
];

function ResearchCard() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState("website");
  const [inputHint, setInputHint] = useState("");
  const inputRef = useRef(null);
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const handleSubmit = (event) => {
    event.preventDefault();
    const draft = query.trim();
    if (!draft) {
      setInputHint(mode === "website" ? "Paste a page link or enter a question to get started." : "Enter a question to get started.");
      inputRef.current?.focus();
      return;
    }
    setInputHint("");
    navigate(isAuthenticated ? "/research" : "/login", {
      state: isAuthenticated ? { draft } : { from: { pathname: "/research", state: { draft } } },
    });
  };

  return (
    <div className="research-card-wrap">
      <form className="research-card" onSubmit={handleSubmit}>
        <div className="research-mode-tabs" role="tablist" aria-label="Research input type">
          <button type="button" role="tab" aria-selected={mode === "website"} className={mode === "website" ? "active" : ""} onClick={() => setMode("website")}><span aria-hidden="true">↗</span> Website URL</button>
          <button type="button" role="tab" aria-selected={mode === "question"} className={mode === "question" ? "active" : ""} onClick={() => setMode("question")}><span aria-hidden="true">◌</span> Ask a question</button>
        </div>
        <label className="research-input-label" htmlFor="research-prompt">{mode === "website" ? "Paste a page link to research" : "What would you like to understand?"}</label>
        <div className="research-input-row">
          <span className="research-input-icon" aria-hidden="true">{mode === "website" ? "↗" : "⌕"}</span>
          <textarea ref={inputRef} id="research-prompt" value={query} onChange={(event) => { setQuery(event.target.value); setInputHint(""); }} aria-describedby={inputHint ? "research-input-hint" : undefined} placeholder={mode === "website" ? "Paste a link or ask anything you want to understand…" : "Ask a question or explore a concept…"} rows={2} maxLength={20000} />
          <button className="research-submit" type="submit">{mode === "website" ? "Start researching" : "Ask Reading Lizard"}<span aria-hidden="true">→</span></button>
        </div>
        <div className="research-card-assurance"><span aria-hidden="true">✓</span> Answers grounded in sources <i /> Links are detected automatically</div>
      </form>
      {inputHint && <p className="research-input-hint" id="research-input-hint" role="status">{inputHint}</p>}
      <div className="research-examples"><span>TRY ASKING</span>{EXAMPLES.map((example) => <button key={example} type="button" onClick={() => { setMode("question"); setQuery(example); }}>{example}</button>)}</div>
    </div>
  );
}

export default ResearchCard;
