/* Hours, the same way everywhere: whole numbers with no decimal ("1h"),
   fractions to one decimal place ("1.5h", "0.4h"), and anything above 10
   rounded to a whole number ("46h", not "45.7h"). */
export function fmtHours(h) {
  const n = Number(h) || 0;
  const x = Math.abs(n) > 10 ? Math.round(n) : Math.round(n * 10) / 10;
  return Number.isInteger(x) ? String(x === 0 ? 0 : x) : x.toFixed(1);
}
export const fmtH = (h) => `${fmtHours(h)}h`;

/* minutes as "25 minutes" / "1 minute" */
export const fmtMinutes = (m) => `${m} minute${m === 1 ? "" : "s"}`;
