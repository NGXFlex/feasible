import React, { useEffect, useState } from "react";
import { C, Tap, inputStyle, notice, choice, NumField, useIsDesktop, PAGE_PAD } from "./ui.jsx";
import {
  PRESETS, DEFAULT_MINUTES, MAX_MINUTES, startTimer, remainingMs, isFinished, pauseTimer, resumeTimer,
  minutesSpent, clock, breakFor, cycleSlot, CYCLE,
} from "./engine/timer.js";
import { fmtH, fmtMinutes } from "./engine/format.js";
import { toDate } from "./engine/plan.js";

/* ------------------------------------------------------------------ */
/*  Study timer. It exists to measure real study time so the hours      */
/*  model gets more accurate: a finished or stopped session is offered  */
/*  for logging, and nothing is logged without the student saying yes.  */
/*  No streaks, points, badges or sounds.                               */
/*                                                                      */
/*  session (kept by App, saved on this device):                        */
/*    { subjectId, chapter, minutes, custom, from,                      */
/*      phase: "setup" | "run" | "confirm" | "after" | "break",          */
/*      timer, spent, completed, before, added, breakTimer,              */
/*      rounds: finished work sessions this sitting (for the long break),*/
/*      longBreak }                                                     */
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
  ({ subjectId, chapter: null, minutes: DEFAULT_MINUTES, custom: false, from, phase: "setup", rounds: 0 });
/* the next work session of the same sitting: same subject, length, chapter and cycle */
const nextSession = (p) =>
  ({ ...newSession(p.subjectId, p.from), minutes: p.minutes, custom: p.custom, chapter: p.chapter, rounds: p.rounds ?? 0 });

const chapterName = (s, i) => s.names?.[i] || `Chapter ${i + 1}`;

/* the subject being studied: every subject with an exam still ahead.
   Two with the same name are told apart by their exam date. */
function SubjectSelect({ subjects, value, onChange, id, label = "Subject" }) {
  const shortDate = (d) => toDate(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  return (
    <>
      <label style={{ fontSize: 13, color: C.dim, marginBottom: 8, display: "block" }} htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        style={{ ...inputStyle, appearance: "auto", marginBottom: 16, color: value ? C.text : C.dim }}
      >
        <option value="" disabled>Choose a subject</option>
        {subjects.map((x) => <option key={x.id} value={x.id}>{x.name}{x.sameName ? ` (exam ${shortDate(x.date)})` : ""}</option>)}
      </select>
    </>
  );
}

/* the chapter being studied: open chapters, plus the one already picked */
function ChapterSelect({ s, value, onChange, id, label, style }) {
  const open = s.done.map((d, i) => (d && i !== value ? null : i)).filter((i) => i != null);
  return (
    <>
      <label style={{ fontSize: 13, color: C.dim, marginBottom: 8, display: "block" }} htmlFor={id}>{label}</label>
      <select
        id={id}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        style={{ ...inputStyle, appearance: "auto", ...style }}
      >
        <option value="">No particular chapter</option>
        {open.map((i) => <option key={i} value={i}>{chapterName(s, i)}</option>)}
      </select>
    </>
  );
}

/* "Session 2 of 4 before a long break" */
function CycleNote({ rounds, style }) {
  const slot = cycleSlot(rounds);
  return (
    <div data-cycle={slot} style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 8, fontSize: 13, color: C.dim, ...style }}>
      <span aria-hidden="true" style={{ display: "flex", gap: 4 }}>
        {Array.from({ length: CYCLE }, (_, i) => (
          <span key={i} style={{ width: 7, height: 7, borderRadius: 99, background: i < slot - 1 ? C.accent : i === slot - 1 ? C.accentText : C.line, opacity: i === slot - 1 ? 0.55 : 1 }} />
        ))}
      </span>
      Session {slot} of {CYCLE} before a long break
    </div>
  );
}

export default function Timer({ subjects, session, setSession, onLog, onClose }) {
  const s = subjects.find((x) => x.id === session.subjectId) ?? null;
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
      set({ phase: "confirm", timer: pauseTimer(timer, now), spent: Math.round(timer.durationMs / 60000), completed: true, before: s?.perDay ?? null, rounds: (session.rounds ?? 0) + 1 });
    }
    if (phase === "break" && session.breakTimer?.running && isFinished(session.breakTimer, now)) {
      set({ breakTimer: pauseTimer(session.breakTimer, now) });
    }
  }, [now, phase, timer, session.breakTimer]);

  const big = { fontSize: desktop ? 112 : 84, fontWeight: 700, letterSpacing: desktop ? -5 : -4, lineHeight: 1, fontVariantNumeric: "tabular-nums", textAlign: "center" };
  const primary = { width: "100%", background: C.accent, color: C.onAccent, padding: "17px 0", borderRadius: 16, fontSize: 17, fontWeight: 650 };
  const secondary = { width: "100%", background: "transparent", border: `1px solid ${C.line}`, color: C.text, padding: "15px 0", borderRadius: 16, fontSize: 15, fontWeight: 600 };
  const lbl = { fontSize: 13, color: C.dim, marginBottom: 8, display: "block" };
  const wrap = { padding: PAGE_PAD, maxWidth: 520, margin: desktop ? "0 auto" : undefined };
  // started from Today or a subject: a way back there. Started on the Timer tab: the tabs are the way out.
  const back = session.from === "timer" ? null : (
    <Tap className="focus-ring" onClick={onClose} style={{ background: "transparent", color: C.accentText, padding: 0, fontSize: 16, marginBottom: 22, fontWeight: 500 }}>
      ‹ Back
    </Tap>
  );

  if (!s && phase === "after") {
    return (
      <div style={wrap}>
        {back}
        <div style={{ ...notice, fontSize: 15, lineHeight: 1.5 }}>This subject isn't here any more, so there's nothing to log time against.</div>
        <Tap className="focus-ring" onClick={() => { setSession(null); onClose(); }} style={{ ...secondary, marginTop: 16 }}>Close</Tap>
      </div>
    );
  }

  /* changing the subject clears the chapter: chapters belong to a subject.
     "before" follows it, so "down from" compares the same subject. */
  const subjectPick = (id, label) => (
    <SubjectSelect subjects={subjects} id={id} label={label} value={s ? session.subjectId : null}
      onChange={(subjectId) => set({ subjectId, chapter: null, markDone: false, ...(phase === "confirm" ? { before: subjects.find((x) => x.id === subjectId)?.perDay ?? null } : {}) })} />
  );
  const chapterPick = (id, label, style) => (s ? (
    <ChapterSelect s={s} id={id} label={label} value={session.chapter} onChange={(chapter) => set({ chapter, markDone: false })} style={style} />
  ) : (
    <>
      <label style={{ fontSize: 13, color: C.dim, marginBottom: 8, display: "block" }} htmlFor={id}>{label}</label>
      <select id={id} disabled value="" style={{ ...inputStyle, appearance: "auto", color: C.dim, ...style }}>
        <option value="">Choose a subject first</option>
      </select>
    </>
  ));

  const heading = (
    <div style={{ textAlign: "center", marginBottom: 28 }}>
      <div style={{ fontSize: 13, color: C.dim, fontWeight: 600, letterSpacing: ".06em", textTransform: "uppercase" }}>
        {phase === "break" ? "Break" : "Studying"}
      </div>
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: -0.8, margin: "6px 0 0", overflowWrap: "anywhere", color: s ? C.text : C.dim }}>{s ? s.name : "Pick a subject"}</h1>
      {s && session.chapter != null && phase !== "break" && (
        <div style={{ fontSize: 15, color: C.dim, marginTop: 4, overflowWrap: "anywhere" }}>{chapterName(s, session.chapter)}</div>
      )}
    </div>
  );

  /* ------------------------------ setup ------------------------------ */
  if (phase === "setup") {
    const minutes = session.minutes;
    const valid = minutes >= 1 && minutes <= MAX_MINUTES;
    return (
      <div style={wrap}>
        {back}
        {heading}
        {session.note && <div role="status" style={{ textAlign: "center", fontSize: 14, color: C.dim, marginTop: -14, marginBottom: 20 }}>{session.note}</div>}
        <div role="timer" aria-label={`${fmtMinutes(minutes)} session`} style={{ ...big, color: C.text }}>{clock(minutes * 60000)}</div>
        <CycleNote rounds={session.rounds} style={{ marginTop: 14, marginBottom: 28 }} />

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

        {subjectPick("session-subject")}
        {chapterPick("session-chapter", "Chapter (optional)", { marginBottom: 24 })}

        <Tap className="focus-ring" disabled={!valid || !s} onClick={() => set({ phase: "run", timer: startTimer(minutes, Date.now()), note: null })} style={primary}>
          Start
        </Tap>
        <div style={{ fontSize: 12.5, color: C.dim, textAlign: "center", marginTop: 12, lineHeight: 1.5 }}>
          {s ? `When the session ends, you'll be asked before any time is added to ${s.name}.` : "Choose the subject you're studying to start."}
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
              set({ phase: "confirm", timer: pauseTimer(timer, t), spent: minutesSpent(timer, t), completed: false, before: s?.perDay ?? null });
            }}
            style={{ ...secondary, flex: 1 }}
          >
            Stop
          </Tap>
        </div>
        <div style={{ marginTop: 28 }}>
          <div style={{ fontSize: 13, color: C.dim, marginBottom: 12 }}>Moved on to something else? Change it here.</div>
          {subjectPick("run-subject")}
          {chapterPick("run-chapter", "Chapter (optional)")}
        </div>
        <CycleNote rounds={session.rounds} style={{ marginTop: 22 }} />
      </div>
    );
  }

  /* ------------------------------ confirm ------------------------------ */
  if (phase === "confirm") {
    const spent = session.spent;
    const ch = session.chapter;
    const canMark = !!s && ch != null && !s.done[ch];
    if (spent < 1) {
      return (
        <div style={wrap}>
          {heading}
          <div style={{ fontSize: 20, fontWeight: 650, textAlign: "center" }}>Less than a minute — nothing to add.</div>
          <Tap className="focus-ring" onClick={() => set(nextSession(session))} style={{ ...primary, marginTop: 28 }}>
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
          {s ? `Add ${fmtMinutes(spent)} to ${s.name}?` : `Which subject gets these ${fmtMinutes(spent)}?`}
        </div>
        <div style={{ fontSize: 14, color: C.dim, textAlign: "center", marginTop: 8, lineHeight: 1.5 }}>
          {session.completed ? "Session finished." : `You stopped after ${fmtMinutes(spent)}. Only the time you spent is added.`}
        </div>
        <div style={{ marginTop: 24 }}>
          {subjectPick("confirm-subject", "Subject you studied")}
          {chapterPick("confirm-chapter", "Chapter you studied")}
        </div>
        {canMark && (
          <Tap
            role="checkbox"
            aria-checked={!!session.markDone}
            className="focus-ring"
            onClick={() => set({ markDone: !session.markDone })}
            style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, marginTop: 12, background: C.surface, border: `1px solid ${session.markDone ? C.accent : C.line}`, borderRadius: 14, padding: "14px 16px", color: C.text }}
          >
            <span aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, border: `1.5px solid ${session.markDone ? C.accent : C.lineHi}`, background: session.markDone ? C.accent : "transparent", color: C.onAccent, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
              {session.markDone ? "✓" : ""}
            </span>
            <span style={{ fontSize: 15, overflowWrap: "anywhere" }}>Mark this chapter done — {chapterName(s, ch)}</span>
          </Tap>
        )}
        <Tap
          className="focus-ring"
          disabled={!s}
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
    const rest = breakFor(Math.round((timer?.durationMs ?? 0) / 60000), session.rounds ?? 0);
    const again = () => set(nextSession(session));
    return (
      <div style={wrap}>
        {heading}
        <div role="status" style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.4, textAlign: "center", lineHeight: 1.35 }}>
          {session.added ? `Added ${fmtMinutes(session.spent)} to ${s.name}.` : "Nothing was added."}
        </div>
        {moved && <div style={{ fontSize: 15, color: C.dim, textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>{moved}</div>}

        {session.completed && (
          <div style={{ background: C.surface, border: `1px solid ${C.line}`, borderRadius: 16, padding: "16px 18px", marginTop: 28 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>
              {rest.long
                ? `That's ${CYCLE} sessions. Time for a long break: ${rest.minutes} minutes.`
                : `A ${rest.minutes}-minute break is a good idea now.`}
            </div>
            <Tap
              className="focus-ring"
              onClick={() => set({ phase: "break", breakTimer: startTimer(rest.minutes, Date.now()), longBreak: rest.long })}
              style={{ ...primary, marginTop: 12, padding: "13px 0", fontSize: 15.5 }}
            >
              Start a {rest.minutes}-minute break
            </Tap>
          </div>
        )}

        <CycleNote rounds={session.rounds} style={{ marginTop: 20 }} />
        <Tap className="focus-ring" onClick={again} style={{ ...(session.completed ? secondary : primary), marginTop: 20 }}>{session.completed ? "Skip the break" : "Start another session"}</Tap>
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
      <div role="status" style={{ textAlign: "center", fontSize: 15, color: C.dim, marginTop: 12, marginBottom: 20 }}>
        {over ? `Break's over. Ready for session ${cycleSlot(session.rounds)}?` : `${session.longBreak ? "Long break" : "Break"} — nothing is logged for a break.`}
      </div>
      <CycleNote rounds={session.rounds} style={{ marginBottom: 24 }} />
      <Tap className="focus-ring" onClick={() => set({ ...nextSession(session), phase: "run", timer: startTimer(session.minutes, Date.now()) })} style={primary}>
        {over ? `Start the next ${fmtMinutes(session.minutes)}` : `End the break and start the next ${fmtMinutes(session.minutes)}`}
      </Tap>
      <Tap className="focus-ring" onClick={() => set(nextSession(session))} style={{ ...secondary, marginTop: 10 }}>
        Change length or chapter first
      </Tap>
      <Tap className="focus-ring" onClick={() => { setSession(null); onClose(); }} style={{ ...secondary, marginTop: 10 }}>Done</Tap>
    </div>
  );
}
