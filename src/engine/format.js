/* Hours, the same way everywhere: whole numbers with no decimal ("1h",
   "12h"), anything else to one decimal place ("1.5h", "0.4h"). */
export function fmtHours(h) {
  const x = Math.round((Number(h) || 0) * 10) / 10;
  return Number.isInteger(x) ? String(x === 0 ? 0 : x) : x.toFixed(1);
}
export const fmtH = (h) => `${fmtHours(h)}h`;

/* minutes as "25 minutes" / "1 minute" */
export const fmtMinutes = (m) => `${m} minute${m === 1 ? "" : "s"}`;
