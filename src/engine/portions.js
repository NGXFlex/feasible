/* ------------------------------------------------------------------ */
/*  Portions — turn a pasted list ("1. Solutions", "• Electrochemistry") */
/*  into chapter names, and chapter weightage into marks.               */
/*  Plain functions, no React.                                          */
/* ------------------------------------------------------------------ */

/* Leading "1.", "1)", "12 -", "Ch 3 -", "Chapter 4:", "•", "-", "*", repeated.
   A number must be followed by a separator or a space, so "3D Geometry"
   keeps its name. */
const LEAD = /^(?:(?:ch(?:apter)?\.?\s*)?\d+(?:\s*[.):\-–—]\s*|\s+|$)|[•●▪◦*\-–—]\s*)+/i;
const HEADING_WORD = /^(unit|chapter|part|section|term)\s*[\divxl]*$/i;

/* A line that names a group rather than a chapter: "UNIT II", "ORGANIC",
   "Term 1". */
function isHeading(text) {
  if (HEADING_WORD.test(text)) return true;
  return text.length < 25 && /[A-Z]/.test(text) && text === text.toUpperCase();
}

/* [{ name, line }] in order; `line` is the index of the source line, so a
   chapter can be removed from the pasted text itself. */
export function parsePortions(text) {
  const out = [];
  String(text ?? "").split(/\r?\n/).forEach((raw, line) => {
    const trimmed = raw.trim();
    if (!trimmed || HEADING_WORD.test(trimmed)) return;
    const name = trimmed.replace(LEAD, "").trim();
    if (!name || isHeading(name)) return;
    out.push({ name, line });
  });
  return out;
}

/* Weightage per chapter: how much of the paper it is likely to carry.
   Labels always say "marks", so they can't be mistaken for difficulty. */
export const WEIGHTS = [
  { v: 1, label: "Low marks" },
  { v: 2, label: "Medium marks" },
  { v: 3, label: "High marks" },
];
export const DEFAULT_WEIGHT = 2;

/* Each chapter's share of a 100-mark paper, from its weight. */
export function marksFromWeights(weights, count = weights.length) {
  const w = Array.from({ length: count }, (_, i) => weights[i] ?? DEFAULT_WEIGHT);
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => (sum > 0 ? (x / sum) * 100 : 0));
}
