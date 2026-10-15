/* ------------------------------------------------------------------ */
/*  Palettes. Each has a light and a dark set, so palette and mode are  */
/*  independent. The CSS in palettes.css is generated from this file    */
/*  (npm run palettes); a test checks the two match.                    */
/*                                                                      */
/*  The base colours are as designed. A few tokens are worked out from  */
/*  them so every palette passes WCAG AA (4.5:1) for small text:        */
/*    accentText  the accent, darkened (light) or lightened (dark)      */
/*                until it reads as text on every surface               */
/*    dim         nudged towards text only where the given grey falls   */
/*                short on a raised surface                             */
/*    onAccent    whichever of white or the palette's ink reads best    */
/*                on the accent                                         */
/* ------------------------------------------------------------------ */

export const PALETTES = [
  {
    id: "sand", name: "Sand Terracotta",
    light: { bg: "#F5F0E8", surface: "#FFFCF7", raised: "#EDE6DA", line: "#E0D6C7", lineHi: "#C9BCA8", text: "#211C16", dim: "#8A7D6D", accent: "#C45B3C", accentSoft: "#F8E6DF" },
    dark: { bg: "#171310", surface: "#221C18", raised: "#2D2520", line: "#3A312A", lineHi: "#52453B", text: "#F7F1E8", dim: "#A29483", accent: "#E8744F", accentSoft: "#3A2219" },
  },
  {
    id: "cobalt", name: "Porcelain Cobalt",
    light: { bg: "#F4F6FA", surface: "#FFFFFF", raised: "#EAEEF6", line: "#DDE3EE", lineHi: "#C2CBDB", text: "#141821", dim: "#6E778A", accent: "#2B5CE6", accentSoft: "#E4EAFC" },
    dark: { bg: "#0C0F16", surface: "#151A24", raised: "#1E2531", line: "#28303E", lineHi: "#3B465A", text: "#F0F3F9", dim: "#8A94A8", accent: "#6B93FF", accentSoft: "#16233F" },
  },
  {
    id: "coral", name: "Midnight Coral",
    light: { bg: "#F6F2F2", surface: "#FFFDFD", raised: "#EDE6E6", line: "#E2D8D8", lineHi: "#C9B9B9", text: "#1B1618", dim: "#827275", accent: "#E8554E", accentSoft: "#FBE5E3" },
    dark: { bg: "#10131C", surface: "#191D28", raised: "#232836", line: "#2D3342", lineHi: "#424A5E", text: "#F5F2F4", dim: "#92909C", accent: "#FF7A70", accentSoft: "#351C1C" },
  },
  {
    id: "lime", name: "Graphite Lime",
    light: { bg: "#F4F5F3", surface: "#FFFFFF", raised: "#EBEDE8", line: "#DFE2DB", lineHi: "#C4C8BE", text: "#161815", dim: "#727668", accent: "#4D8B1F", accentSoft: "#E8F2DC" },
    dark: { bg: "#0E100E", surface: "#171A17", raised: "#212520", line: "#2B302A", lineHi: "#3E453C", text: "#F1F3EF", dim: "#8C9189", accent: "#A3D85F", accentSoft: "#1E2A14" },
  },
  {
    id: "lavender", name: "Lavender",
    light: { bg: "#F6F4FA", surface: "#FFFFFF", raised: "#EEEBF5", line: "#E3DEEE", lineHi: "#C8C0DC", text: "#19161F", dim: "#776E89", accent: "#6246C4", accentSoft: "#EBE5FA" },
    dark: { bg: "#110F17", surface: "#1A1722", raised: "#241F2E", line: "#2F293B", lineHi: "#443B55", text: "#F3F0F8", dim: "#948CA4", accent: "#A28CF5", accentSoft: "#241B3C" },
  },
  {
    id: "sage", name: "Sage",
    light: { bg: "#EEF1EA", surface: "#F9FBF6", raised: "#E3E9DD", line: "#D6DED0", lineHi: "#BCC8B4", text: "#1C231C", dim: "#73806F", accent: "#4F7D5A", accentSoft: "#E1ECDF" },
    dark: { bg: "#0F1410", surface: "#171D18", raised: "#202821", line: "#2A332B", lineHi: "#3D493E", text: "#EEF2EC", dim: "#8D998B", accent: "#8DC59A", accentSoft: "#1A2A1E" },
  },
  {
    id: "copper", name: "Copper Night",
    light: { bg: "#F6F1EC", surface: "#FFFCF9", raised: "#EEE5DD", line: "#E3D7CC", lineHi: "#CDBBAB", text: "#231A14", dim: "#86766A", accent: "#B8683C", accentSoft: "#F6E5D9" },
    dark: { bg: "#141210", surface: "#1D1A17", raised: "#27231F", line: "#332D28", lineHi: "#4A4139", text: "#F0E9E1", dim: "#9A8F84", accent: "#D4875A", accentSoft: "#33231A" },
  },
  {
    id: "mono", name: "Mono Signal",
    light: { bg: "#FAFAFA", surface: "#FFFFFF", raised: "#F0F0F0", line: "#E4E4E4", lineHi: "#C8C8C8", text: "#111111", dim: "#767676", accent: "#D93349", accentSoft: "#FCE6E9" },
    dark: { bg: "#0D0D0D", surface: "#171717", raised: "#212121", line: "#2C2C2C", lineHi: "#424242", text: "#F5F5F5", dim: "#9A9A9A", accent: "#FF5A6E", accentSoft: "#33161B" },
  },
  {
    id: "hydra", name: "Hydra",
    light: { bg: "#F0F6F6", surface: "#FFFFFF", raised: "#E4EEEF", line: "#D5E3E4", lineHi: "#B6CDCF", text: "#102225", dim: "#64807F", accent: "#12838B", accentSoft: "#DDF0F1" },
    dark: { bg: "#0B1719", surface: "#122326", raised: "#1A2F33", line: "#22393E", lineHi: "#33525A", text: "#E4F1F2", dim: "#7F9A9D", accent: "#3FC1C9", accentSoft: "#0E2D31" },
  },
  {
    id: "aureus", name: "Aureus",
    light: { bg: "#F7F3EA", surface: "#FFFDF8", raised: "#EEE7D8", line: "#E3DAC6", lineHi: "#CDBF9F", text: "#221C11", dim: "#85796A", accent: "#A87A22", accentSoft: "#F5EAD2" },
    dark: { bg: "#12100C", surface: "#1B1813", raised: "#25211A", line: "#302A21", lineHi: "#463E30", text: "#F3ECDF", dim: "#9B917F", accent: "#D6A84A", accentSoft: "#2F2614" },
  },
];

/* the same in every palette: the feasibility verdict and information */
export const SEMANTIC_BASE = {
  light: { shortfall: "#B3261E", fits: "#1A7F5A", info: "#3B6FD4" },
  dark: { shortfall: "#FF5A4D", fits: "#4ED6A0", info: "#7BA6F5" },
};

export const DEFAULT_PALETTE = "sand";    // the redesign's look; a saved choice always wins
export const paletteById = (id) => PALETTES.find((p) => p.id === id) ?? PALETTES.find((p) => p.id === DEFAULT_PALETTE);

/* ------------------------------ colour maths ------------------------------ */
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb) => `#${rgb.map((v) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
export const mix = (a, b, t) => toHex(hex(a).map((v, i) => v + (hex(b)[i] - v) * t));
const rgba = (h, a) => `rgba(${hex(h).join(", ")}, ${a})`;
const lum = (h) => {
  const [r, g, b] = hex(h).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const worst = (fg, bgs) => Math.min(...bgs.map((b) => contrast(fg, b)));

/* move fg towards `to` in small steps until it reaches 4.5:1 on every background */
function readable(fg, bgs, to, min = 4.5) {
  let c = fg;
  for (let t = 0; t <= 1.0001 && worst(c, bgs) < min; t += 0.02) c = mix(fg, to, t);
  return c;
}

/* The verdict colours stay one fixed value per mode in every palette: each
   base colour, moved only as far as it takes to read on every palette's
   surfaces (the light green and blue fall a little short as given). */
export const SEMANTIC = Object.fromEntries(["light", "dark"].map((mode) => {
  const surfaces = PALETTES.flatMap((p) => [p[mode].bg, p[mode].surface, p[mode].raised]);
  const to = mode === "dark" ? "#FFFFFF" : "#000000";
  return [mode, Object.fromEntries(Object.entries(SEMANTIC_BASE[mode]).map(([k, v]) => [k, readable(v, surfaces, to)]))];
}));

/* every token a component reads, for one palette in one mode */
export function tokens(palette, mode) {
  const p = palette[mode];
  const sem = SEMANTIC[mode];
  const dark = mode === "dark";
  const surfaces = [p.bg, p.surface, p.raised];
  // the palette's own ink when it reads on the accent, else plain white or black
  const best = (list) => list.reduce((a, b) => (contrast(b, p.accent) > contrast(a, p.accent) ? b : a));
  const ink = best([p.text, p.bg]);
  const onAccent = contrast(ink, p.accent) >= 4.5 ? ink : best(["#FFFFFF", "#000000"]);
  return {
    "color-scheme": mode,
    bg: p.bg,
    surface: p.surface,
    raised: p.raised,
    hover: mix(p.raised, p.lineHi, dark ? 0.3 : 0.35),
    line: p.line,
    lineHi: p.lineHi,
    text: p.text,
    dim: readable(p.dim, surfaces, p.text),
    accent: p.accent,
    accentText: readable(p.accent, [...surfaces, p.accentSoft], dark ? "#FFFFFF" : p.text),
    accentSoft: p.accentSoft,
    accentLine: mix(p.accentSoft, p.accent, dark ? 0.35 : 0.3),
    onAccent,
    shortfall: sem.shortfall,
    fits: sem.fits,
    info: sem.info,
    "wash-accent": rgba(p.accent, 0.06),
    "wash-shortfall": rgba(sem.shortfall, 0.06),
    "wash-fits": rgba(sem.fits, 0.06),
    shadow: dark ? "inset 0 1px 0 rgba(255, 255, 255, .05), 0 4px 20px rgba(0, 0, 0, .4)" : `0 1px 2px ${rgba(p.text, 0.04)}, 0 8px 24px ${rgba(p.text, 0.06)}`,
    "shadow-lift": dark ? "inset 0 1px 0 rgba(255, 255, 255, .07), 0 8px 28px rgba(0, 0, 0, .5)" : `0 2px 4px ${rgba(p.text, 0.05)}, 0 14px 32px ${rgba(p.text, 0.09)}`,
    "shadow-pop": dark ? "0 12px 34px rgba(0, 0, 0, .55)" : `0 12px 34px ${rgba(p.text, 0.16)}`,
    glass: rgba(p.surface, dark ? 0.82 : 0.78),
    scrim: dark ? "rgba(0, 0, 0, .6)" : rgba(p.text, 0.32),
    "picker-filter": dark ? "invert(1)" : "none",
  };
}

/* palettes.css: light under data-palette, dark under data-theme="dark", and
   dark again for data-theme="system" when the device is dark */
export function paletteCss() {
  const block = (sel, t) =>
    `${sel} {\n${Object.entries(t).map(([k, v]) => (k === "color-scheme" ? `  color-scheme: ${v};` : `  --${k}: ${v};`)).join("\n")}\n}\n`;
  let css = "/* Generated from src/palettes.js by `npm run palettes`. Don't edit by hand. */\n\n";
  for (const p of PALETTES) {
    const def = p.id === DEFAULT_PALETTE;
    // the default palette also covers a page with no data-palette yet
    const root = def ? `:root, :root[data-palette="${p.id}"]` : `:root[data-palette="${p.id}"]`;
    const darkSel = def ? `:root[data-theme="dark"]:not([data-palette]), :root[data-palette="${p.id}"][data-theme="dark"]` : `:root[data-palette="${p.id}"][data-theme="dark"]`;
    const sysSel = def ? `:root[data-theme="system"]:not([data-palette]), :root[data-palette="${p.id}"][data-theme="system"]` : `:root[data-palette="${p.id}"][data-theme="system"]`;
    css += `/* ${p.name} */\n`;
    css += block(root, tokens(p, "light"));
    css += block(darkSel, tokens(p, "dark"));
    css += `@media (prefers-color-scheme: dark) {\n${block(sysSel, tokens(p, "dark")).replace(/^/gm, "  ").replace(/ +$/gm, "")}}\n\n`;
  }
  return css;
}
