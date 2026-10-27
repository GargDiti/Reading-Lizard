import { useState } from "react";
import { Link } from "react-router-dom";
import "./LandingSections.css";

const STEPS = [
  { number: "01", title: "Bring a question or a page", you: "Paste a link or ask a question.", lizard: "Gets your research started." },
  { number: "02", title: "Read for the useful parts", you: "Give it a moment to explore.", lizard: "Reads and extracts the page." },
  { number: "03", title: "Ask follow-ups", you: "Ask what you want to know next.", lizard: "Answers with source context." },
  { number: "04", title: "Keep exploring", you: "Follow connected topics and return later.", lizard: "Helps you explore and saves your research." },
];
const TOPICS = ["JavaScript closures", "RAG", "Vector search", "System design", "Python async", "Research methods", "Neural networks"];

const FAQS = [
  { question: "What can I research with Reading Lizard?", answer: "Start with a webpage URL or ask a question. Reading Lizard helps you explore the material, understand key ideas, and follow connected topics." },
  { question: "Are answers grounded in sources?", answer: "When you research a webpage, answers are grounded in the page you shared and include source context to help you verify what you learn." },
  { question: "Can I come back to a conversation later?", answer: "Yes. Sign in and your research conversations are saved in your library so you can revisit them and continue exploring." },
];

function LandingSections() {
  const [openFaq, setOpenFaq] = useState(0);
  return <>
    <section className="topic-strip" aria-label="Explore example topics"><div className="topic-track">{[...TOPICS, ...TOPICS].map((topic, index) => <span className="topic-pill" key={`${topic}-${index}`}>{topic}</span>)}</div></section>
    <section className="difference-section" aria-labelledby="difference-heading"><div className="landing-section-inner"><div className="landing-section-heading"><p className="section-kicker">A CALMER WAY TO RESEARCH</p><h2 id="difference-heading">Less tab juggling. More understanding.</h2></div><div className="difference-grid"><article className="difference-card usual"><h3>The usual way</h3><p><i aria-hidden="true">×</i> Tabbing between a dozen pages</p><p><i aria-hidden="true">×</i> Losing track of where facts came from</p><p><i aria-hidden="true">×</i> Forgetting what you read</p></article><article className="difference-card with-lizard"><h3>With Reading Lizard</h3><p><i aria-hidden="true">✓</i> Answers tied to the page you shared</p><p><i aria-hidden="true">✓</i> Connected topics to explore</p><p><i aria-hidden="true">✓</i> Saved research to return to</p></article></div></div></section>
    <section className="how-section" id="how-it-works" aria-labelledby="how-heading">
      <div className="landing-section-inner">
        <div className="landing-section-heading"><p className="section-kicker">A SIMPLE WAY TO GO DEEPER</p><h2 id="how-heading">How it works</h2><p>From the first link to a clearer understanding, your curiosity sets the pace.</p></div>
        <div className="steps-grid">{STEPS.map((step) => <article className="step-card" key={step.number}><span className="step-number">{step.number}</span><span className="step-rule" /><h3>{step.title}</h3><p className="step-dialogue"><b>You:</b> {step.you}</p><p className="step-dialogue"><b>Reading Lizard:</b> {step.lizard}</p></article>)}</div>
      </div>
    </section>
    <section className="comparison-section" aria-labelledby="comparison-heading"><div className="landing-section-inner"><div className="landing-section-heading"><p className="section-kicker">MADE FOR RESEARCH</p><h2 id="comparison-heading">A little more context, in one place.</h2></div><div className="comparison-scroll" tabIndex="0"><table className="comparison-table"><thead><tr><th scope="col">What matters</th><th scope="col">Reading Lizard</th><th scope="col">Search engine</th><th scope="col">Generic chatbot</th></tr></thead><tbody><tr><th scope="row">Answers tied to your source</th><td>Yes, for a shared page</td><td>Browse results yourself</td><td>Depends on the prompt</td></tr><tr><th scope="row">Connected topics</th><td>Explore related concepts</td><td>Open more results</td><td>Ask follow-up questions</td></tr><tr><th scope="row">Saved research</th><td>Saved conversations</td><td>Browser history</td><td>Varies by product</td></tr></tbody></table></div></div></section>
    <section className="faq-section" id="faq" aria-labelledby="faq-heading">
      <div className="faq-layout"><div className="landing-section-heading"><p className="section-kicker">GOOD QUESTIONS</p><h2 id="faq-heading">A little more clarity.</h2><p>What to know before you start exploring.</p></div>
        <div className="faq-list">{FAQS.map((faq, index) => <article className={`faq-item${openFaq === index ? " is-open" : ""}`} key={faq.question}>
          <h3><button type="button" aria-expanded={openFaq === index} aria-controls={`faq-answer-${index}`} onClick={() => setOpenFaq(openFaq === index ? -1 : index)}>{faq.question}<span aria-hidden="true">{openFaq === index ? "−" : "+"}</span></button></h3>
          <p id={`faq-answer-${index}`} className="faq-answer" hidden={openFaq !== index}>{faq.answer}</p>
        </article>)}</div>
      </div>
    </section>
    <section className="closing-cta" aria-labelledby="closing-cta-heading"><div className="closing-cta-inner"><p className="section-kicker">YOUR NEXT GOOD QUESTION IS WAITING</p><h2 id="closing-cta-heading">Make room for curiosity.</h2><p>Bring a page, follow an idea, and keep the useful things you learn.</p><Link to="/research" className="closing-cta-button">Start researching <span aria-hidden="true">→</span></Link></div></section>
  </>;
}

export function StatsRow() {
  return <section className="stats-section" aria-label="Reading Lizard at a glance"><div className="stats-row">
    <div className="stat-item"><strong>01</strong><span>Source-grounded<br />answers for shared pages</span></div>
    <div className="stat-item"><strong>↗</strong><span>Paste any link<br />or ask a question</span></div>
    <div className="stat-item"><strong>∞</strong><span>Saved conversations<br />to revisit later</span></div>
  </div></section>;
}

export function HomeFooter() {
  return <footer className="home-footer" id="about"><div className="footer-inner">
    <div className="footer-brand"><Link to="/" aria-label="Reading Lizard home">Reading Lizard<span aria-hidden="true"> ✳</span></Link><p>Curiosity, with sources.</p></div>
    <div className="footer-column"><strong>Explore</strong><Link to="/#features">Features</Link><Link to="/#how-it-works">How it works</Link><Link to="/#faq">FAQs</Link></div>
    <div className="footer-column"><strong>Your space</strong><Link to="/research">My research</Link><Link to="/account">Account</Link><Link to="/signup">Get started</Link></div>
    <div className="footer-bottom"><span>© 2026 Reading Lizard</span><span>Made for curious minds.</span></div>
  </div></footer>;
}

export default LandingSections;
