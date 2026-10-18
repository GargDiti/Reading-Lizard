import { useEffect, useRef, useState } from "react";
import "./reactbits.css";

// Animated Content uses the lightweight reveal-on-view behavior from React Bits.
function AnimatedContent({ children, className = "" }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setVisible(true); return undefined; }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { setVisible(true); observer.disconnect(); }
    }, { threshold: 0.12 });
    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return <div ref={ref} className={`rb-animated-content${visible ? " is-visible" : ""} ${className}`}>{children}</div>;
}

export default AnimatedContent;
