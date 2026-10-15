/* ------------------------------------------------------------------ */
/*  Study timer arithmetic. The timer is a start timestamp plus the time */
/*  banked before the last pause, so it stays right while the tab is in */
/*  the background or the phone is locked: nothing counts ticks.        */
/*  timer: { durationMs, startedAt, banked, running }                   */
/* ------------------------------------------------------------------ */

export const PRESETS = [15, 25, 50];
export const DEFAULT_MINUTES = 25;
export const MAX_MINUTES = 180;

export const startTimer = (minutes, now) =>
  ({ durationMs: Math.round(minutes * 60000), startedAt: now, banked: 0, running: true });

/* time studied so far, never more than the session length */
export const elapsedMs = (t, now) =>
  Math.min(t.durationMs, t.banked + (t.running ? Math.max(0, now - t.startedAt) : 0));

export const remainingMs = (t, now) => Math.max(0, t.durationMs - elapsedMs(t, now));
export const isFinished = (t, now) => remainingMs(t, now) <= 0;

export const pauseTimer = (t, now) => (t.running ? { ...t, banked: elapsedMs(t, now), running: false } : t);
export const resumeTimer = (t, now) => (t.running ? t : { ...t, startedAt: now, running: true });

/* whole minutes to offer for logging: to the nearest minute */
export const minutesSpent = (t, now) => Math.round(elapsedMs(t, now) / 60000);

/* "12:05", or "1:02:05" past an hour */
export function clock(ms) {
  const total = Math.ceil(Math.max(0, ms) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

/* a short break after a short session, a longer one after a long session */
export const breakMinutes = (sessionMinutes) => (sessionMinutes > 30 ? 10 : 5);
