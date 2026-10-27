import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listConversations } from "../api/conversationApi";
import { useAuth } from "../context/AuthContext";
import ResearchCard from "./ResearchCard";
import ResearchVisual from "./ResearchVisual";
import SpotlightCard from "./reactbits/SpotlightCard";
import AnimatedContent from "./reactbits/AnimatedContent";
import { StatsRow } from "./LandingSections";
import "./Hero.css";

const RECENT_LIMIT = 3;
const BlurText = lazy(() => import("./reactbits/BlurText"));

function formatRelativeDate(value) {
  if (!value) return "Saved research";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Saved research";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function getSourceLabel(sourceUrl) {
  if (!sourceUrl) return "Learning conversation";
  try { return new URL(sourceUrl).hostname.replace(/^www\./, ""); }
  catch { return sourceUrl; }
}

function RecentResearch({ token, isAuthenticated }) {
  const [recent, setRecent] = useState([]);
  const [status, setStatus] = useState(isAuthenticated ? "loading" : "idle");
  const [retry, setRetry] = useState(0);
  const loadRecent = useCallback(async (active) => {
    if (!token) { setRecent([]); setStatus("ready"); return; }
    setStatus("loading");
    try {
      const { conversations = [] } = await listConversations(token);
      if (active()) { setRecent(conversations.slice(0, RECENT_LIMIT)); setStatus("ready"); }
    } catch {
      if (active()) setStatus("error");
    }
  }, [token]);

  useEffect(() => {
    let active = true;
    void loadRecent(() => active);
    return () => { active = false; };
  }, [loadRecent, retry]);

  return (
    <section className="recent-section" aria-labelledby="recent-heading">
      <div className="recent-heading-row">
        <div><p className="section-kicker">YOUR RESEARCH SPACE</p><h2 id="recent-heading">Pick up where you left off</h2><p className="recent-heading-copy">Continue a recent conversation or start a new exploration.</p></div>
        <Link to={isAuthenticated ? "/research" : "/login"}>View all <span aria-hidden="true">→</span></Link>
      </div>
      {status === "loading" && <div className="recent-grid" aria-label="Loading saved research">{Array.from({ length: RECENT_LIMIT }, (_, index) => <div className="recent-skeleton" key={index} />)}</div>}
      {status === "error" && <div className="recent-state recent-error" role="alert"><span>Saved research could not be loaded.</span><button type="button" onClick={() => setRetry((count) => count + 1)}>Try again</button></div>}
      {status === "ready" && recent.length > 0 && <div className="recent-grid">{recent.map((item, index) => (
        <AnimatedContent key={item._id}><SpotlightCard className="recent-card" spotlightColor="rgba(50, 106, 72, 0.08)">
          <Link to="/research" state={{ conversationId: item._id }} className="recent-card-link" aria-label={`Open research: ${item.title || "Untitled research"}`}>
            <span className={`recent-card-art recent-art-${index}`} aria-hidden="true"><span className="recent-art-orbit" /><span className="recent-card-symbol">{item.sourceUrl ? "↗" : "▤"}</span><span className="recent-art-caption">READING LIZARD <i>✳</i></span></span>
            <span className="recent-card-body">
              <span className="recent-card-overline">{item.sourceUrl ? "WEB RESEARCH" : "LEARNING SESSION"}<span>{formatRelativeDate(item.updatedAt || item.createdAt)}</span></span>
              <strong className="recent-card-title">{item.title || "Untitled research"}</strong>
              <span className="recent-card-foot"><span className="recent-card-source" title={item.sourceUrl || "Learning conversation"}>{getSourceLabel(item.sourceUrl)}</span><span className="recent-card-arrow" aria-hidden="true">↗</span></span>
            </span>
          </Link>
        </SpotlightCard></AnimatedContent>
      ))}</div>}
      {status === "ready" && recent.length === 0 && <div className="recent-empty-card">
        <span className="recent-empty-mark" aria-hidden="true">↗</span>
        <div><strong>{isAuthenticated ? "Your research library is ready" : "Your research space starts here"}</strong><p>{isAuthenticated ? "Start a conversation and it will be saved here for later." : "Sign in to revisit saved research and continue where you left off."}</p></div>
        <Link to={isAuthenticated ? "/research" : "/login"}>{isAuthenticated ? "Start researching" : "Get started"} <span aria-hidden="true">→</span></Link>
      </div>}
    </section>
  );
}

function Hero() {
  const { token, isAuthenticated } = useAuth();
  return (
    <>
      <section className="hero" id="top">
        <div className="hero-layout">
          <div className="hero-content">
            <span className="hero-kicker"><span /> YOUR PERSONAL WEB RESEARCH COMPANION</span>
            <h1 className="hero-heading"><Suspense fallback={<><span>Research deeper.</span><br /><span className="hero-title-accent">Understand faster.</span></>}><span><BlurText text="Research deeper." delay={90} /></span><br /><span className="hero-title-accent"><BlurText text="Understand faster." delay={170} /></span></Suspense></h1>
            <p className="hero-copy">Turn any website or question into a guided research conversation. Get source-grounded answers, explore key concepts, and build lasting knowledge.</p>
            <ResearchCard />
          </div>
          <ResearchVisual />
        </div>
      </section>
      <StatsRow />
      <RecentResearch token={token} isAuthenticated={isAuthenticated} />
    </>
  );
}

export default Hero;
