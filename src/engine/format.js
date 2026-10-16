/* Hours, the same way everywhere: whole numbers with no decimal ("1h"),
   fractions to one decimal place ("1.5h", "0.4h"), and anything above 10
   rounded to a whole number ("46h", not "45.7h"). */
export function fmtHours(h) {
  const x = roundHours(h);
  return Number.isInteger(x) ? String(x === 0 ? 0 : x) : x.toFixed(1);
}
export const fmtH = (h) => `${fmtHours(h)}h`;

/* An hours figure at the precision it's shown at. The plan rounds each
   chapter with this, so the chapter figures on screen add up to the totals. */
export function roundHours(h) {
  const n = Number(h) || 0;
  return Math.abs(n) > 10 ? Math.round(n) : Math.round(n * 10) / 10;
}

/* Every percentage in the app goes through these: never below 0 or above
   100, and "done" once the part covers the whole. */
export const pctOf = (part, whole) =>
  whole > 1e-9 ? Math.max(0, Math.min(100, (Number(part) || 0) / whole * 100)) : 100;
export const coverage = (part, whole) => {
  const pct = pctOf(part, whole);
  return { pct, done: whole <= 1e-9 || part >= whole - 1e-9, label: whole <= 1e-9 || part >= whole - 1e-9 ? "Done" : `${Math.min(99, Math.floor(pct))}%` };
};

/* minutes as "25 minutes" / "1 minute" */
export const fmtMinutes = (m) => `${m} minute${m === 1 ? "" : "s"}`;
