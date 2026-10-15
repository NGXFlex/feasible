/* ------------------------------------------------------------------ */
/*  Hours studied, stored as dated entries so a day's work can be seen  */
/*  later:  log: [{ d: "YYYY-MM-DD", h: hours, src: "manual"|"timer" }]  */
/*  The running total is always worked out from the entries. Saves from */
/*  before this kept one number, logged; migrateLog turns that into a   */
/*  single entry dated the day it is migrated.                          */
/* ------------------------------------------------------------------ */

const entries = (s) => (Array.isArray(s?.log) ? s.log : []);
const hoursOf = (e) => Math.max(0, Number(e?.h) || 0);

/* every hour logged on a subject */
export function loggedTotal(s) {
  if (!Array.isArray(s?.log)) return Math.max(0, Number(s?.logged) || 0);   // not migrated yet
  return entries(s).reduce((t, e) => t + hoursOf(e), 0);
}

/* hours logged on one day ("YYYY-MM-DD") */
export const loggedOn = (s, day) =>
  entries(s).filter((e) => e?.d === day).reduce((t, e) => t + hoursOf(e), 0);

/* an older save's total becomes one entry dated today; already migrated stays as it is */
export function migrateLog(s, today) {
  if (!s || typeof s !== "object") return s;
  const { logged, ...rest } = s;
  if (Array.isArray(s.log)) return "logged" in s ? rest : s;
  const total = Math.max(0, Number(logged) || 0);
  return { ...rest, log: total > 0 ? [{ d: today, h: total, src: "manual" }] : [] };
}

/* add hours to a subject on a day */
export function addLog(s, hours, day, src = "manual") {
  const base = migrateLog(s, day);
  if (!(hours > 0)) return base;
  return { ...base, log: [...base.log, { d: day, h: hours, src }] };
}

/* Set the total (the Reality check slider). More than before: the
   difference is logged today. Less: hours come off the newest entries
   first, so the record stays a list of real, positive sessions. */
export function setLoggedTotal(s, total, day) {
  const base = migrateLog(s, day);
  const now = loggedTotal(base);
  const want = Math.max(0, Number(total) || 0);
  if (Math.abs(want - now) < 1e-9) return base;
  if (want > now) return addLog(base, want - now, day, "manual");
  let cut = now - want;
  const log = base.log.map((e) => ({ ...e }));
  for (let i = log.length - 1; i >= 0 && cut > 1e-9; i--) {
    const take = Math.min(cut, hoursOf(log[i]));
    log[i].h = hoursOf(log[i]) - take;
    cut -= take;
  }
  return { ...base, log: log.filter((e) => e.h > 1e-9) };
}
