import React, { useEffect, useState } from "react";
import { C, Tap, inputStyle, notice, choice, NumField, useIsDesktop } from "./ui.jsx";
import {
  PRESETS, DEFAULT_MINUTES, MAX_MINUTES, startTimer, remainingMs, isFinished, pauseTimer, resumeTimer,
  minutesSpent, clock, breakMinutes,
} from "./engine/timer.js";
import { fmtH, fmtMinutes } from "./engine/format.js";

/* ------------------------------------------------------------------ */
/*  Study timer. It exists to measure real study time so the hours      */
/*  model gets more accurate: a finished or stopped session is offered  */
/*  for logging, and nothing is logged without the student saying yes.  */
/*  No streaks, points, badges or sounds.                               */
/*                                                                      */
/*  session (kept by App, saved on this device):                        */
/*    { subjectId, chapter, minutes, custom, from,                      */
/*      phase: "setup" | "run" | "confirm" | "after" | "break",          */
/*      timer, spent, completed, before, added, breakTimer }            */
/* ------------------------------------------------------------------ */

const SESSION_KEY = "feasible-timer-v1";
export function readSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY)) ?? null; } catch { return null; }
}
export function writeSession(session) {
  try {
    if (session) localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(SESSION_KEY);
  } catch { /* private mode: the session just won't survive a reload */ }
}
/* a session with time on the clock, or one still waiting for "Add 25 minutes?":
   leaving the screen keeps it, so nothing is lost and nothing is logged silently */
export const sessionActive = (session) =>
  !!session && (session.phase === "run" || session.phase === "break" || session.phase === "confirm");
export const newSession = (subjectId, from) =>
  ({ subjectId, chapter: null, minutes: DEFAULT_MINUTES, custom: false, from, phase: "setup" });

const chapterName = (s, i) => s.names?.[i] || `Chapter ${i + 1}`;

export default function Timer({ s, session, setSession, onLog, onClose }) {
  const desktop = useIsDesktop();
  const [now, setNow] = useState(Date.now());

  /* the clock face redraws a few times a second; the time itself always
     comes from timestamps, so a background tab or a locked phone can't
     make it drift */
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const id = setInterval(tick, 250);
    document.addEventListener("visibilitychange", tick);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", tick); };
  }, []);

  const set = (changes) => setSession((p) => (p ? { ...p, ...changes } : p));
  const { phase, timer } = session;

  /* the session ran out (maybe while the tab was hidden): ask before logging */
  useEffect(() => {
    if (phase === "run" && timer?.running && isFinished(timer, now)) {
      set({ phase: "confirm", timer: pauseTimer(timer, now), spent: Math.round(timer.durationMs / 60000), completed: true, before: s?.perDay ?? null });
    }
    if (phase === "break" && session.breakTimer?.running && isFinished(session.breakTimer, now)) {
      set({ breakTimer: pauseTimer(session.breakTimer, now) });
    }
  }, [now, phase, timer, session.breakTimer]);

  const big = { fontSize: desktop ? 112 : 84, fontWeight: 700, letterSpacing: desktop ? -5 : -4, lineHeight: 1, fontVariantNumeric: "tabular-nums", textAlign: "center" };
  const primary = { width: "100%", background: C.accent, color: C.onAccent, padding: "17px 0", borderRadius: 16, fontSize: 17, fontWeight: 650 };
  const secondary = { width: "100%", background: "transparent", border: `1px solid ${C.line}`, color: C.text, padding: "15px 0", borderRadius: 16, fontSize: 15, fontWeight: 600 };
  const lbl = { fontSize: 13, color: C.dim, marginBottom: 8, display: "block" };
  const wrap = { padding: "60px 24px 0", maxWidth: 520, margin: desktop ? "0 auto" : undefined };
  const back = (
    <Tap className="focus-ring" onClick={onClose} style={{ background: "transparent", color: C.accentText, padding: 0, fontSize: 16, marginBottom: 22, fontWeight: 500 }}>
      ‹ Back
    </Tap>
  );

  if (!s) {
    return (
      <div style={wrap}>
        {back}
        <div style={{ ...notice, fontSize: 15, lineHeight: 1.5 }}>This subject isn't here any more, so there's nothing to log time against.</div>
        <Tap className="focus-ring" onClick={() => { setSession(null); onClose(); }} style={{ ...secondary, marginTop: 16 }}>Close</Tap>
      </div>
    );
  }

  const heading = (
    <div style={{ textAlign: "center", marginBottom: 28 }}>
      <div style={{ fontSize: 13, color: C.dim, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase" }}>
        {phase === "break" ? "Break" : "Studying"}
      </div>
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.8, margin: "6px 0 0", overflowWrap: "anywhere" }}>{s.name}</h1>
      {session.chapter != null && phase !== "break" && (
        <div style={{ fontSize: 15, color: C.dim, marginTop: 4, overflowWrap: "anywhere" }}>{chapterName(s, session.chapter)}</div>
      )}
    </div>
  );

  /* ------------------------------ setup ------------------------------ */
  if (phase === "setup") {
    const open = s.done.map((d, i) => (d ? null : i)).filter((i) => i != null);
    const minutes = session.minutes;
    const valid = minutes >= 1 && minutes <= MAX_MINUTES;
    return (
      <div style={wrap}>
        {back}
        {heading}
        {session.note && <div role="status" style={{ textAlign: "center", fontSize: 14, color: C.dim, marginTop: -14, marginBottom: 20 }}>{session.note}</div>}
        <div role="timer" aria-label={`${fmtMinutes(minutes)} session`} style={{ ...big, color: C.text, marginBottom: 28 }}>{clock(minutes * 60000)}</div>

        <span style={lbl}>How long</span>
        <div role="group" aria-label="Session length" style={{ display: "flex", gap: 8, marginBottom: session.custom ? 10 : 20 }}>
          {PRESETS.map((m) => {
            const on = !session.custom && minutes === m;
            return (
              <Tap key={m} aria-pressed={on} onClick={() => set({ minutes: m, custom: false })} style={{ flex: 1, ...choice(on), borderRadius: 12, padding: "12px 0", fontSize: 14, fontWeight: 650 }}>
                {m} min
              </Tap>
            );
          })}
          <Tap aria-pressed={!!session.custom} onClick={() => set({ custom: true })} style={{ flex: 1, ...choice(!!session.custom), borderRadius: 12, padding: "12px 0", fontSize: 14, fontWeight: 650 }}>
            Custom
          </Tap>
        </div>
        {session.custom && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 20 }}>
            <NumField id="custom-minutes" aria-label="Minutes" value={minutes} min={1} max={MAX_MINUTES} onChange={(v) => set({ minutes: Math.round(v) })} style={{ ...inputStyle, width: 110, textAlign: "center" }} />
            <span style={{ fontSize: 14, color: C.dim }}>minutes (up to {MAX_MINUTES})</span>
          </div>
        )}

        <label style={lbl} htmlFor="session-chapter">Chapter (optional)</label>
        <select
          id="session-chapter"
          value={session.chapter ?? ""}
          onChange={(e) => set({ chapter: e.target.value === "" ? null : Number(e.target.value) })}
          style={{ ...inputStyle, marginBottom: 24, appearance: "auto" }}
        >
          <option value="">No particular chapter</option>
          {open.map((i) => <option key={i} value={i}>{chapterName(s, i)}</option>)}
        </select>

        <Tap className="focus-ring" disabled={!valid} onClick={() => set({ phase: "run", timer: startTimer(minutes, Date.now()), note: null })} style={primary}>
          Start
        </Tap>
        <div style={{ fontSize: 12.5, color: C.dim, textAlign: "center", marginTop: 12, lineHeight: 1.5 }}>
          When the session ends, you'll be asked before any time is added to {s.name}.
        </div>
      </div>
    );
  }

  /* ------------------------------ running ------------------------------ */
  if (phase === "run") {
    const left = remainingMs(timer, now);
    return (
      <div style={wrap}>
        {back}
        {heading}
        <div role="timer" aria-label={`${clock(left)} left`} style={{ ...big, color: timer.running ? C.accent : C.dim }}>{clock(left)}</div>
        <div style={{ textAlign: "center", fontSize: 14, color: C.dim, marginTop: 12, marginBottom: 32 }}>
          {timer.running ? `of ${fmtMinutes(Math.round(timer.durationMs / 60000))}` : "Paused"}
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <Tap
            className="focus-ring"
            onClick={() => set({ timer: timer.running ? pauseTimer(timer, Date.now()) : resumeTimer(timer, Date.now()) })}
            style={{ ...primary, flex: 1 }}
          >
            {timer.running ? "Pause" : "Resume"}
          </Tap>
          <Tap
            className="focus-ring"
            onClick={() => {
              const t = Date.now();
              set({ phase: "confirm", timer: pauseTimer(timer, t), spent: minutesSpent(timer, t), completed: false, before: s.perDay ?? null });
            }}
            style={{ ...secondary, flex: 1 }}
          >
            Stop
          </Tap>
        </div>
      </div>
    );
  }

  /* ------------------------------ confirm ------------------------------ */
  if (phase === "confirm") {
    const spent = session.spent;
    const ch = session.chapter;
    const canMark = ch != null && !s.done[ch];
    if (spent < 1) {
      return (
        <div style={wrap}>
          {heading}
          <div style={{ fontSize: 20, fontWeight: 650, textAlign: "center" }}>Less than a minute — nothing to add.</div>
          <Tap className="focus-ring" onClick={() => set({ ...newSession(session.subjectId, session.from), chapter: ch, minutes: session.minutes, custom: session.custom })} style={{ ...primary, marginTop: 28 }}>
            Start again
          </Tap>
          <Tap className="focus-ring" onClick={() => { setSession(null); onClose(); }} style={{ ...secondary, marginTop: 10 }}>Done</Tap>
        </div>
      );
    }
    return (
      <div style={wrap}>
        {heading}
        <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.5, textAlign: "center", lineHeight: 1.3 }}>
          Add {fmtMinutes(spent)} to {s.name}?
        </div>
        <div style={{ fontSize: 14, color: C.dim, textAlign: "center", marginTop: 8, lineHeight: 1.5 }}>
          {session.completed ? "Session finished." : `You stopped after ${fmtMinutes(spent)}. Only the time you spent is added.`}
        </div>
        {canMark && (
          <Tap
            role="checkbox"
            aria-checked={!!session.markDone}
            className="focus-ring"
            onClick={() => set({ markDone: !session.markDone })}
            style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, marginTop: 24, background: C.surface, border: `1px solid ${session.markDone ? C.accent : C.line}`, borderRadius: 14, padding: "14px 16px", color: C.text }}
          >
            <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, border: `1.5px solid ${session.markDone ? C.accent : C.lineHi}`, background: session.markDone ? C.accent : "transparent", color: C.onAccent, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {session.markDone ? "✓" : ""}
            </span>
            <span style={{ fontSize: 15, overflowWrap: "anywhere" }}>Mark this chapter done — {chapterName(s, ch)}</span>
          </Tap>
        )}
        <Tap
          className="focus-ring"
          onClick={() => { onLog(spent, canMark && session.markDone ? ch : null); set({ phase: "after", added: true }); }}
          style={{ ...primary, marginTop: 24 }}
        >
          Add {fmtMinutes(spent)}
        </Tap>
        <Tap className="focus-ring" onClick={() => set({ phase: "after", added: false })} style={{ ...secondary, marginTop: 10 }}>
          Don't add
        </Tap>
      </div>
    );
  }

  /* ------------------------------ after ------------------------------ */
  if (phase === "after") {
    const before = session.before;
    const after = s.perDay;
    let moved = null;
    if (session.added && before != null) {
      if (s.needed <= 1e-6) moved = `${s.name} needs no more hours before its exam.`;
      else if (after != null && fmtH(after) !== fmtH(before)) moved = `${s.name} now needs ${fmtH(after)} a day, down from ${fmtH(before)}.`;
      else if (after != null) moved = `${s.name} still needs about ${fmtH(after)} a day.`;
    }
    const rest = breakMinutes(Math.round((timer?.durationMs ?? 0) / 60000));
    const again = () => set({ ...newSession(session.subjectId, session.from), minutes: session.minutes, custom: session.custom });
    return (
      <div style={wrap}>
        {heading}
        <div role="status" style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4, textAlign: "center", lineHeight: 1.35 }}>
          {session.added ? `Added ${fmtMinutes(session.spent)} to ${s.name}.` : "Nothing was added."}
        </div>
        {moved && <div style={{ fontSize: 15, color: C.dim, textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>{moved}</div>}

        {session.completed && (
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "16px 18px", marginTop: 28 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>A {rest}-minute break is a good idea now.</div>
            <Tap
              className="focus-ring"
              onClick={() => set({ phase: "break", breakTimer: startTimer(rest, Date.now()) })}
              style={{ ...secondary, marginTop: 12, padding: "12px 0" }}
            >
              Start a {rest}-minute break
            </Tap>
          </div>
        )}

        <Tap className="focus-ring" onClick={again} style={{ ...primary, marginTop: 24 }}>Start another session</Tap>
        <Tap className="focus-ring" onClick={() => { setSession(null); onClose(); }} style={{ ...secondary, marginTop: 10 }}>Done</Tap>
      </div>
    );
  }

  /* ------------------------------ break ------------------------------ */
  const bt = session.breakTimer;
  const left = bt ? remainingMs(bt, now) : 0;
  const over = left <= 0;
  return (
    <div style={wrap}>
      {heading}
      <div role="timer" aria-label={`${clock(left)} of break left`} style={{ ...big, color: over ? C.dim : C.info }}>{clock(left)}</div>
      <div style={{ textAlign: "center", fontSize: 15, color: C.dim, marginTop: 12, marginBottom: 32 }}>
        {over ? "Break's over." : "Nothing is logged for a break."}
      </div>
      <Tap className="focus-ring" onClick={() => set({ ...newSession(session.subjectId, session.from), minutes: session.minutes, custom: session.custom })} style={primary}>
        {over ? "Start another session" : "End break and start another session"}
      </Tap>
      <Tap className="focus-ring" onClick={() => { setSession(null); onClose(); }} style={{ ...secondary, marginTop: 10 }}>Done</Tap>
    </div>
  );
}
