import { motion, MotionConfig, useInView, useReducedMotion } from "motion/react";
import { useMemo, useRef } from "react";
import "./reactbits.css";

// Blur Text, using the official React Bits Motion-based reveal and accessible text pattern.
function BlurText({ text = "", className = "", delay = 110, stepDuration = 0.4, direction = "top", threshold = 0.1 }) {
  const ref = useRef(null);
  const inView = useInView(ref, { once: true, amount: threshold });
  const reduceMotion = useReducedMotion();
  const words = useMemo(() => text.split(" "), [text]);
  const initialY = direction === "bottom" ? 12 : -12;
  return (
    <MotionConfig reducedMotion="user">
      <span ref={ref} className={`rb-blur-text ${className}`}>
        <span className="rb-sr-only">{text}</span>
        {words.map((word, index) => <motion.span aria-hidden="true" key={`${word}-${index}`} className="rb-blur-word" initial={{ filter: "blur(10px)", opacity: 0, y: initialY }} animate={inView ? { filter: "blur(0px)", opacity: 1, y: 0 } : undefined} transition={reduceMotion ? { duration: 0 } : { duration: stepDuration, delay: index * delay / 1000, ease: [0.22, 1, 0.36, 1] }}>{word}{index < words.length - 1 ? "\u00a0" : ""}</motion.span>)}
      </span>
    </MotionConfig>
  );
}

export default BlurText;
