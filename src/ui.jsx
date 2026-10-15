import React, { useEffect, useState } from "react";

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

/* ---------------------------- layout ----------------------------
   Phones get the original single column with the floating tab bar.
   From DESKTOP_MIN wide, the app switches to a sidebar on the left and
   a wider content column on the right; sheets become centred dialogs. */
export const DESKTOP_MIN = 900;
export const SIDEBAR_W = 240;
export const CONTENT_MAX = 820;   // content column on desktop
export const MOBILE_MAX = 430;    // the phone column

const desktopQuery = `(min-width: ${DESKTOP_MIN}px)`;
const matchDesktop = () =>
  typeof window !== "undefined" && !!window.matchMedia?.(desktopQuery).matches;

export function useIsDesktop() {
  const [desktop, setDesktop] = useState(matchDesktop);
  useEffect(() => {
    const mq = window.matchMedia?.(desktopQuery);
    if (!mq) return;
    const on = () => setDesktop(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desktop;
}

/* The dimmed backdrop and the panel of a sheet. On a phone it slides up
   from the bottom; on desktop it is a centred dialog. */
export const sheetOverlay = (desktop, zIndex) => ({
  position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex,
  display: "flex", alignItems: desktop ? "center" : "flex-end", justifyContent: "center",
  padding: desktop ? 24 : 0, animation: "fadeIn .25s ease both",
});

export const sheetPanel = (desktop) =>
  desktop
    ? {
        background: C.bg, border: `1px solid ${C.line}`, borderRadius: 24,
        width: "100%", maxWidth: 480, boxSizing: "border-box",
        boxShadow: "0 24px 60px rgba(0,0,0,.6)",
        animation: "dialogIn .3s cubic-bezier(.32,.72,0,1) both",
      }
    : {
        background: C.bg, borderTop: `1px solid ${C.line}`, borderRadius: "26px 26px 0 0",
        width: "100%", maxWidth: MOBILE_MAX, boxSizing: "border-box",
        animation: "sheetUp .42s cubic-bezier(.32,.72,0,1) both",
      };

/* The grab handle only makes sense on a sheet you can see slide up */
export function SheetHandle({ desktop }) {
  return desktop
    ? <div style={{ height: 14 }} />
    : <div style={{ width: 38, height: 4, background: C.line, borderRadius: 99, margin: "0 auto 20px" }} />;
}

export const inputStyle = {
  background: C.cardHi, border: `1px solid ${C.line}`, color: C.text,
  borderRadius: 12, padding: "13px 14px", fontSize: 16, fontFamily: FONT,
  width: "100%", outline: "none", boxSizing: "border-box",
};
