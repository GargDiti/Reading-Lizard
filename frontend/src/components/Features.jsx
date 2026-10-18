import SpotlightCard from "./reactbits/SpotlightCard";
import AnimatedContent from "./reactbits/AnimatedContent";
import "./Features.css";

const FEATURES = [
  { number: "01", icon: "▤", title: "Answers with context", text: "Get clear, source-grounded answers with references to the content you brought into the conversation." },
  { number: "02", icon: "⌘", title: "Follow connected topics", text: "Explore extracted page sections, related concepts, and connections as you learn." },
  { number: "03", icon: "↗", title: "Keep your research", text: "Save conversations, revisit them at any time, and continue building your knowledge." },
];

function Features() {
  return (
    <section className="features" id="features">
      <div className="features-inner">
        <div className="features-heading"><p className="section-kicker">BUILT FOR CURIOUS MINDS</p><h2>From first question to real understanding.</h2></div>
        <div className="features-grid">{FEATURES.map((feature) => <AnimatedContent key={feature.number}><SpotlightCard className="feature-card" spotlightColor="rgba(49, 104, 68, 0.09)"><span className="feature-icon" aria-hidden="true">{feature.icon}</span><div className="feature-copy"><span className="feature-number">{feature.number}</span><h3>{feature.title}</h3><p>{feature.text}</p></div></SpotlightCard></AnimatedContent>)}</div>
      </div>
    </section>
  );
}

export default Features;
