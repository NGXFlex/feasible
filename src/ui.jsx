import React, { useState } from "react";

/* ------------------------------------------------------------------ */
/*  Shared look: colour tokens, font, the tap button and the text       */
/*  input style. Moved out of App.jsx unchanged so other screens (like  */
/*  Login) use the exact same pieces instead of copying them.           */
/* ------------------------------------------------------------------ */

export const C = {
  bg: "#0B0E13",
  card: "#141920",
  cardHi: "#1B222C",
  line: "#232C38",
  text: "#EEF1F6",
  dim: "#7B8798",
  amber: "#F2A93B",
  red: "#FF6B6B",
  green: "#43D6A0",
  blue: "#5B8DEF",
};

export const FONT =
  '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto, sans-serif';

/* Any extra props (type, className, aria-*) pass straight through to the
   <button>. type defaults to "button" so a Tap inside a <form> never
   submits it by accident. */
export function Tap({ children, onClick, style, disabled, ...rest }) {
  const [down, setDown] = useState(false);
  return (
    <button
      type="button"
      {...rest}
      onClick={disabled ? undefined : onClick}
      onPointerDown={() => setDown(true)}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      style={{
        appearance: "none", border: "none", font: "inherit",
        cursor: disabled ? "default" : "pointer",
        transform: down ? "scale(0.965)" : "scale(1)",
        opacity: disabled ? 0.4 : down ? 0.9 : 1,
        transition: "transform .18s cubic-bezier(.34,1.56,.64,1), opacity .18s ease",
        ...style,
      }}
    >
      {children}
    </button>
  );
}

export const inputStyle = {
  background: C.cardHi, border: `1px solid ${C.line}`, color: C.text,
  borderRadius: 12, padding: "13px 14px", fontSize: 16, fontFamily: FONT,
  width: "100%", outline: "none", boxSizing: "border-box",
};
