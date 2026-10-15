import { DEFAULT_WEIGHT } from "./portions.js";

/* ------------------------------------------------------------------ */
/*  The chapter editor works on rows. Each row remembers which saved     */
/*  chapter it came from (orig), so removing one from the middle can't  */
/*  shift a tick, a syllabus link or a weightage onto its neighbours.   */
/* ------------------------------------------------------------------ */

let nextKey = 0;
const row = (fields) => ({ key: `r${nextKey++}`, ...fields });

/* s may be a saved or an analysed subject (analysed ones carry diffs) */
export function rowsFromSubject(s) {
  const n = Math.max(0, s?.chapters | 0);
  return Array.from({ length: n }, (_, i) => row({
    orig: i,
    name: s.names?.[i] ?? "",
    diff: s.diffs?.[i] ?? s.diff?.[i] ?? 2,
    weight: s.weight?.[i] ?? DEFAULT_WEIGHT,
  }));
}

export const newRow = () => row({ orig: null, name: "", diff: 2, weight: DEFAULT_WEIGHT });

/* grow or shrink from the end, never below one chapter or above 60 */
export function resizeRows(rows, n) {
  const want = Math.max(1, Math.min(60, n));
  if (want <= rows.length) return rows.slice(0, want);
  return [...rows, ...Array.from({ length: want - rows.length }, newRow)];
}

/* drop one row, wherever it is, keeping at least one */
export const removeRow = (rows, key) => (rows.length > 1 ? rows.filter((r) => r.key !== key) : rows);

/* What to save. Every per-chapter list is rebuilt from the rows, so they
   stay the same length and in the same order; done and refs follow each
   row's original chapter, and new rows start not done, with no link. */
export function applyRows(s, rows, { weighable = true } = {}) {
  return {
    chapters: rows.length,
    names: rows.map((r) => r.name),
    diff: rows.map((r) => r.diff),
    done: rows.map((r) => r.orig != null && !!s.done?.[r.orig]),
    ...(weighable ? { weight: rows.map((r) => r.weight ?? DEFAULT_WEIGHT) } : {}),
    ...(Array.isArray(s.refs) ? { refs: rows.map((r) => (r.orig != null ? s.refs[r.orig] ?? null : null)) } : {}),
  };
}
