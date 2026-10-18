import AnimatedContent from "./reactbits/AnimatedContent";

function ResearchVisual() {
  return (
    <AnimatedContent className="research-visual-reveal">
      <div className="research-visual" aria-hidden="true">
        <div className="visual-orbit visual-orbit-one" />
        <div className="visual-orbit visual-orbit-two" />
        <svg className="visual-connections" viewBox="0 0 500 390" fill="none">
          <path d="M91 105C143 105 137 148 197 154M301 93C321 121 307 140 331 155M113 270C167 250 160 229 203 223M329 250C305 230 319 218 342 214" stroke="currentColor" strokeWidth="1.2" strokeDasharray="3 5" />
          <path d="M116 108C159 41 278 43 343 108M103 268C153 329 286 333 365 266" stroke="currentColor" strokeWidth="1" opacity=".45" />
          <circle cx="91" cy="105" r="4" fill="currentColor"/><circle cx="301" cy="93" r="4" fill="currentColor"/><circle cx="113" cy="270" r="4" fill="currentColor"/><circle cx="342" cy="214" r="4" fill="currentColor"/>
        </svg>
        <div className="visual-source-card visual-main-card">
          <div className="visual-browser-bar"><i /><i /><i /><span>developer.mozilla.org</span></div>
          <div className="visual-document"><span className="visual-doc-mark">JS</span><strong>JavaScript Guide</strong><small>Core concepts · Web APIs · Examples</small><div /><div /><div /></div>
        </div>
        <div className="visual-source-card visual-note-card"><span className="visual-note-icon">▤</span><strong>Source-backed answers</strong><small>Grounded in the page you shared</small></div>
        <div className="visual-source-card visual-topic-card"><span className="visual-topic-icon">⌘</span><strong>Connected topics</strong><small>Explore ideas as you learn</small></div>
        <div className="visual-source-card visual-page-card"><span className="visual-page-icon">↗</span><strong>Webpage</strong></div>
        <div className="visual-orbit-dot dot-a" /><div className="visual-orbit-dot dot-b" /><div className="visual-orbit-dot dot-c" />
      </div>
    </AnimatedContent>
  );
}

export default ResearchVisual;
