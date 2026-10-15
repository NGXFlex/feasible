import React, { Children, useEffect, useState } from "react";

/* ------------------------------------------------------------------ */
/*  Shared look: colour tokens, font, the tap button, the text input    */
/*  style, cards and layout pieces. Every screen (App, Login) uses      */
/*  these instead of copying them.                                      */
/* ------------------------------------------------------------------ */

/* Colours are CSS custom properties (index.css), so switching theme is
   instant and nothing re-renders. The older names (card, cardHi, amber,
   red, green, blue) stay as aliases so existing styles keep working. */
export const C = {
  bg: "var(--bg)",
  surface: "var(--surface)",
  raised: "var(--raised)",
  hover: "var(--hover)",
  line: "var(--line)",
  lineHi: "var(--lineHi)",
  text: "var(--text)",
  dim: "var(--dim)",
  accent: "var(--accent)",
  accentText: "var(--accentText)",
  accentSoft: "var(--accentSoft)",
  accentLine: "var(--accentLine)",
  onAccent: "var(--onAccent)",
  shortfall: "var(--shortfall)",   // only for "you are short"
  fits: "var(--fits)",             // only for "this fits"
  info: "var(--info)",
  glass: "var(--glass)",
  scrim: "var(--scrim)",

  card: "var(--surface)",
  cardHi: "var(--raised)",
  amber: "var(--accent)",
  red: "var(--shortfall)",
  green: "var(--fits)",
  blue: "var(--info)",
};

export const EASE = "cubic-bezier(.32,.72,0,1)";

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
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      onPointerDown={() => setDown(true)}
      onPointerUp={() => setDown(false)}
      onPointerLeave={() => setDown(false)}
      style={{
        appearance: "none", border: "none", font: "inherit",
        cursor: disabled ? "default" : "pointer",
        transform: down ? "scale(0.965)" : "scale(1)",
        opacity: disabled ? 0.4 : down ? 0.9 : 1,
        transition: `transform .18s ${EASE}, opacity .18s ${EASE}`,
        ...style,
      }}
    >
      {children}
    </button>
  );
}

/* ---------------------------- theme ----------------------------
   "light", "dark" or "system". The attribute on <html> picks the token
   set in index.css; index.html sets it before the first paint. */
export const THEMES = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

const darkQuery = "(prefers-color-scheme: dark)";
export const resolveTheme = (theme) =>
  theme === "light" || theme === "dark"
    ? theme
    : typeof window !== "undefined" && window.matchMedia?.(darkQuery).matches ? "dark" : "light";

const MARK_COLORS = {
  light: { accent: "#E8554E", dim: "#6F645B", bg: "#F5F1EC" },
  dark: { accent: "#FF7A70", dim: "#A3948A", bg: "#16110F" },
};

/* The tab icon and the browser chrome colour follow the theme in use */
function paintChrome(resolved) {
  const c = MARK_COLORS[resolved];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${markBars(c.accent, c.dim)}</svg>`;
  let icon = document.querySelector('link[rel="icon"]');
  if (!icon) { icon = document.createElement("link"); icon.rel = "icon"; document.head.appendChild(icon); }
  icon.type = "image/svg+xml";
  icon.href = `data:image/svg+xml,${encodeURIComponent(svg)}`;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement("meta"); meta.name = "theme-color"; document.head.appendChild(meta); }
  meta.content = c.bg;
}

export function useTheme(theme) {
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    paintChrome(resolveTheme(theme));
    if (theme !== "system") return;
    const mq = window.matchMedia?.(darkQuery);
    if (!mq) return;
    const on = () => paintChrome(resolveTheme("system"));
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [theme]);
}

/* ------------------------------ mark ------------------------------
   Three rounded bars: the app's own "have versus need" bars, reduced to
   a sign. The longest is the accent. */
const markBars = (accent, dim) =>
  `<rect x="3" y="4" width="18" height="4.4" rx="2.2" fill="${accent}"/>` +
  `<rect x="3" y="9.8" width="12.5" height="4.4" rx="2.2" fill="${dim}"/>` +
  `<rect x="3" y="15.6" width="7.5" height="4.4" rx="2.2" fill="${dim}" fill-opacity=".55"/>`;

export function Mark({ size = 20, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ display: "block", flexShrink: 0, ...style }}>
      <rect x="3" y="4" width="18" height="4.4" rx="2.2" style={{ fill: C.accent }} />
      <rect x="3" y="9.8" width="12.5" height="4.4" rx="2.2" style={{ fill: C.dim }} />
      <rect x="3" y="15.6" width="7.5" height="4.4" rx="2.2" style={{ fill: C.dim, fillOpacity: 0.55 }} />
    </svg>
  );
}

/* ---------------------------- layout ----------------------------
   Phones get the original single column with the floating tab bar.
   From DESKTOP_MIN wide, the app switches to a sidebar on the left and
   a wider content column on the right; sheets become centred dialogs. */
export const DESKTOP_MIN = 900;
export const SPLIT_MIN = 1100;    // Plan, Time, Detail: main 62% / side 38%
export const SIDEBAR_W = 240;
export const CONTENT_MAX = 1240;  // content column on desktop
export const MOBILE_MAX = 430;    // the phone column

/* spacing rhythm */
export const SP = { section: 32, group: 16, card: 20, hero: 28 };

export function useMedia(query) {
  const read = () => typeof window !== "undefined" && !!window.matchMedia?.(query).matches;
  const [on, setOn] = useState(read);
  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    const sync = () => setOn(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, [query]);
  return on;
}

export const useIsDesktop = () => useMedia(`(min-width: ${DESKTOP_MIN}px)`);
export const useSplit = () => useMedia(`(min-width: ${SPLIT_MIN}px)`);

/* Cards fill the width by how many there are, so a page never looks empty:
   1 → full width, 2 → halves, 3 → thirds above 1200px (halves below),
   4+ → as many 320px+ columns as fit. Phone layout and under 760px: one. */
export function CardGrid({ children, align = "stretch", style }) {
  const desktop = useIsDesktop();
  const wide = useMedia("(min-width: 1200px)");
  const narrow = useMedia("(max-width: 759px)");
  const n = Children.toArray(children).length;
  let cols = "minmax(0, 1fr)";
  if (desktop && !narrow && n > 1) {
    if (n === 2) cols = "repeat(2, minmax(0, 1fr))";
    else if (n === 3) cols = wide ? "repeat(3, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))";
    else cols = "repeat(auto-fit, minmax(320px, 1fr))";
  }
  return (
    <div style={{ display: "grid", gridTemplateColumns: cols, gap: SP.group, alignItems: align, ...style }}>
      {children}
    </div>
  );
}

/* Above SPLIT_MIN: main content left at 62%, secondary cards right at 38% */
export function Split({ main, side }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 62fr) minmax(0, 38fr)", gap: 24, alignItems: "start" }}>
      <div>{main}</div>
      <div>{side}</div>
    </div>
  );
}

/* Small uppercase label above a group of cards */
export function SectionLabel({ children, style }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 650, letterSpacing: ".08em", textTransform: "uppercase", color: C.dim, margin: "0 0 10px 2px", ...style }}>
      {children}
    </div>
  );
}

/* ----------------------------- surfaces ----------------------------- */
export const card = {
  background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: SP.card,
};

/* A soft 6% wash of a semantic colour from the top-left:
   "accent", "shortfall" or "fits" */
const wash = (kind) => `radial-gradient(120% 100% at 0% 0%, var(--wash-${kind}), transparent 62%), ${C.surface}`;

export const hero = (kind = "accent") => ({
  background: wash(kind), border: `1px solid ${C.line}`, borderRadius: 22, padding: SP.hero,
});

/* A status card tinted like a hero, at standard card size */
export const tinted = (kind) => ({ ...card, background: wash(kind) });

/* Warnings and nudges: soft accent fill */
export const notice = {
  background: C.accentSoft, border: `1px solid ${C.accentLine}`, borderRadius: 18,
  padding: "16px 20px", color: C.text,
};

/* Selected option in a row of choices */
export const choice = (on) => ({
  background: on ? C.accent : C.raised, color: on ? C.onAccent : C.dim,
  border: `1px solid ${on ? C.accent : C.line}`,
  transition: `background .2s ${EASE}, color .2s ${EASE}, border-color .2s ${EASE}`,
});

export const primaryBtn = { background: C.accent, color: C.onAccent };

/* The dimmed backdrop and the panel of a sheet. On a phone it slides up
   from the bottom; on desktop it is a centred dialog. */
export const sheetOverlay = (desktop, zIndex) => ({
  position: "fixed", inset: 0, background: C.scrim, zIndex,
  backdropFilter: "blur(6px)", WebkitBackdropFilter: "blur(6px)",
  display: "flex", alignItems: desktop ? "center" : "flex-end", justifyContent: "center",
  padding: desktop ? 24 : 0, animation: `fadeIn .25s ${EASE} both`,
});

export const sheetPanel = (desktop) =>
  desktop
    ? {
        background: C.bg, border: `1px solid ${C.line}`, borderRadius: 24,
        width: "100%", maxWidth: 480, boxSizing: "border-box",
        boxShadow: "var(--shadow-pop)",
        animation: `dialogIn .3s ${EASE} both`,
      }
    : {
        background: C.bg, borderTop: `1px solid ${C.line}`, borderRadius: "26px 26px 0 0",
        width: "100%", maxWidth: MOBILE_MAX, boxSizing: "border-box",
        boxShadow: "var(--shadow-pop)",
        animation: `sheetUp .42s ${EASE} both`,
      };

/* The grab handle only makes sense on a sheet you can see slide up */
export function SheetHandle({ desktop }) {
  return desktop
    ? <div style={{ height: 14 }} />
    : <div style={{ width: 38, height: 4, background: C.lineHi, borderRadius: 99, margin: "0 auto 20px" }} />;
}

export const inputStyle = {
  background: C.raised, border: `1px solid ${C.line}`, color: C.text,
  borderRadius: 12, padding: "13px 14px", fontSize: 16, fontFamily: FONT,
  width: "100%", outline: "none", boxSizing: "border-box",
};

/* number field you can actually clear while typing */
export function NumField({ value, onChange, min = 0, max = 9999, style, placeholder, ...rest }) {
  const [t, setT] = useState(String(value));
  useEffect(() => { setT(String(value)); }, [value]);
  const clamp = (n) => Math.min(max, Math.max(min, n));
  return (
    <input
      inputMode="decimal"
      {...rest}
      value={t}
      placeholder={placeholder}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9.]/g, "");
        setT(raw);
        const n = parseFloat(raw);
        if (!isNaN(n)) onChange(clamp(n));
      }}
      onBlur={() => {
        const n = parseFloat(t);
        const v = isNaN(n) ? min : clamp(n);
        onChange(v);
        setT(String(v));
      }}
      style={style}
    />
  );
}
