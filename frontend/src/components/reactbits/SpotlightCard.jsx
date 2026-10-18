import { useRef } from "react";
import "./reactbits.css";

// Spotlight Card, based on the official React Bits pointer-position CSS variables.
function SpotlightCard({ children, className = "", spotlightColor = "rgba(43, 91, 65, 0.08)" }) {
  const ref = useRef(null);
  const handlePointerMove = (event) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    ref.current.style.setProperty("--mouse-x", `${event.clientX - rect.left}px`);
    ref.current.style.setProperty("--mouse-y", `${event.clientY - rect.top}px`);
    ref.current.style.setProperty("--spotlight-color", spotlightColor);
  };
  return <div ref={ref} onPointerMove={handlePointerMove} className={`rb-spotlight ${className}`}>{children}</div>;
}

export default SpotlightCard;
