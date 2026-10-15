import React, { useState, useMemo, useEffect, useRef } from "react";
import {
  C, FONT, DISPLAY, EASE, Tap, inputStyle, useIsDesktop, useSplit, sheetOverlay, sheetPanel, SheetHandle,
  SIDEBAR_W, RAIL_W, PAGE_PAD, CONTENT_MAX, MOBILE_MAX, SP, THEMES, useTheme, Mark, CardGrid, Split, SectionLabel,
  card, CARD_BG, hero, tinted, notice, choice, NumField, useMedia,
} from "./ui.jsx";
import Backdrop from "./Backdrop.jsx";
import { PALETTES, DEFAULT_PALETTE, paletteById, tokens as paletteTokens } from "./palettes.js";
import Login from "./Login.jsx";
import ImportPdf from "./ImportPdf.jsx";
import Timer, { readSession, writeSession, sessionActive, newSession } from "./Timer.jsx";
import { SYLLABI, getSyllabus, readinessFactor, dailyNeed, planForTarget, exerciseMinutes, MODEL } from "./engine/syllabusEngine.js";
import { parsePortions, WEIGHTS, DEFAULT_WEIGHT } from "./engine/portions.js";
import {
  TYPE_META, PACE, paceMult, DIFF_MULT, diffMult, toDate, addDays, key, daysUntil,
  defaultHours, hoursBetween, analysePlan, todayPlan, upcomingDays, rankByUrgency, urgencyOf,
  verdictOf, riskOrder, shortfallAction,
} from "./engine/plan.js";
import { migrateLog, setLoggedTotal, addLog } from "./engine/log.js";
import { fmtH } from "./engine/format.js";
import { rowsFromSubject, resizeRows, removeRow, applyRows } from "./engine/chapters.js";


/* ------------------------------------------------------------------ */

const PHASE_COLORS = [C.accent, C.info, C.lineHi];

const DIFF = [
  { v: 1, label: "Easy", mult: DIFF_MULT[1], color: C.info },
  { v: 2, label: "Medium", mult: DIFF_MULT[2], color: C.dim },
  { v: 3, label: "Hard", mult: DIFF_MULT[3], color: C.accentText },
];
const diffMeta = (v) => DIFF.find((d) => d.v === v) ?? DIFF[1];
const STORE_KEY = "feasible-state-v1";

const fmtDate = (d) => toDate(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const fmtDay = (d) => toDate(d).toLocaleDateString("en-IN", { weekday: "short" });
/* ------------------------- persistence -------------------------
   Firestore is the system of record. A local copy is always kept as
   well, so the app opens instantly and still works with no internet.

   Order on load:   Firestore  ->  local copy  ->  memory
   Order on save:   local copy immediately, Firestore debounced

   firebase.js is imported dynamically. If it is missing or the config
   has not been filled in, the app falls back to local storage instead
   of crashing, so the same build runs before and after Firebase setup.
------------------------------------------------------------------ */
let memoryStore = null;
let cloudPromise = null;   // resolves to the firebase module, or null
let saveTimer = null;

/* The promise is cached (not a flag), so two callers that arrive while the
   import is still loading both wait for the same result. */
function getCloud() {
  if (!cloudPromise) {
    cloudPromise = import("./firebase.js")
      .then((mod) => (mod?.cloudLoad && mod?.cloudSave ? mod : null))
      .catch(() => null);  // not installed / not configured — local only
  }
  return cloudPromise;
}

function localGet() {
  try {
    if (typeof window !== "undefined" && window.storage?.get) return null;
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {}
  return null;
}

function localSet(obj) {
  memoryStore = obj;
  try {
    if (typeof window !== "undefined" && window.storage?.set) {
      window.storage.set(STORE_KEY, JSON.stringify(obj));
      return;
    }
  } catch (e) {}
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORE_KEY, JSON.stringify(obj));
    }
  } catch (e) {}
}

async function localGetAsync() {
  try {
    if (typeof window !== "undefined" && window.storage?.get) {
      const r = await window.storage.get(STORE_KEY);
      if (r?.value) return JSON.parse(r.value);
    }
  } catch (e) {}
  return localGet() ?? memoryStore;
}

/* Returns { state, source } so the UI can show where the data came from */
async function loadState() {
  const c = await getCloud();
  if (c) {
    try {
      const remote = await c.cloudLoad();
      if (remote) return { state: remote, source: "cloud" };
      const local = await localGetAsync();
      if (local) {
        await c.cloudSave(local);       // first run after adding Firebase
        return { state: local, source: "cloud" };
      }
      return { state: null, source: "cloud" };
    } catch (e) {
      return { state: await localGetAsync(), source: "local" };
    }
  }
  return { state: await localGetAsync(), source: "local" };
}

/* Local write is immediate; the Firestore write is debounced so that
   dragging a slider does not fire a request per frame. */
let pendingSave = null;   // { obj, onStatus } waiting on the debounce

function saveState(obj, onStatus) {
  localSet(obj);
  clearTimeout(saveTimer);
  pendingSave = { obj, onStatus };
  saveTimer = setTimeout(flushSave, 900);
}

/* Sends the queued Firestore write now. Also runs when the page is hidden,
   because loadState prefers the cloud copy: an edit still sitting in the
   debounce when the app closes would otherwise be overwritten next launch. */
async function flushSave() {
  clearTimeout(saveTimer);
  const p = pendingSave;
  pendingSave = null;
  if (!p) return;
  const c = await getCloud();
  if (!c) return;
  try {
    p.onStatus?.("saving");
    await c.cloudSave(p.obj);
    p.onStatus?.("cloud");
  } catch (e) {
    p.onStatus?.("offline");
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flushSave);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushSave();
  });
}

/* Used when the account changes. Whatever was queued for the old account
   must never be written into the new one, and a signed-out device must not
   keep the previous account's plan lying around. */
function cancelPendingSave() { clearTimeout(saveTimer); pendingSave = null; }

/* "Continue without an account" lasts for this browser session only, so the
   login screen is the first thing every new launch shows unless someone is
   signed in. (sessionStorage survives a reload but not closing the tab.) */
const GUEST_KEY = "feasible-guest-v1";
try { localStorage.removeItem(GUEST_KEY); } catch { /* storage blocked */ }  // older builds kept it forever
function isGuest() {
  try { return sessionStorage.getItem(GUEST_KEY) === "1"; } catch (e) { return false; }
}
function setGuest(on) {
  try {
    if (on) sessionStorage.setItem(GUEST_KEY, "1");
    else sessionStorage.removeItem(GUEST_KEY);
  } catch (e) {}
}
function clearLocalCopy() { localSet(null); }

/* ---------------------------- seed ----------------------------- */
function sampleSubjects() {
  const t = new Date();
  const mk = (name, days, chapters, type, confidence, lastScore, pace, chapterNames) => ({
    id: name.toLowerCase(),
    name,
    date: key(addDays(t, days)),
    createdAt: key(addDays(t, -6)),
    chapters,
    type,
    confidence,
    lastScore,
    pace: pace ?? "steady",
    log: [],
    names: chapterNames ?? Array(chapters).fill(""),
    diff: Array(chapters).fill(2),
    done: Array(chapters).fill(false),
  });
  const chem = mk("Chemistry", 9, 14, "memory", 2, 54, "thorough", [
    "Solid State", "Solutions", "Electrochemistry", "Chemical Kinetics",
    "Surface Chemistry", "p-Block Elements", "d & f Block", "Coordination Compounds",
    "Haloalkanes", "Alcohols & Ethers", "Aldehydes & Ketones", "Carboxylic Acids",
    "Amines", "Biomolecules",
  ]);
  chem.done = chem.done.map((_, i) => i < 2);
  return [
    chem,
    mk("Physics", 15, 12, "problem", 4, 48, "steady"),
    mk("Mathematics", 22, 13, "problem", 3, 71, "quick"),
  ];
}

function useCountUp(target, ms = 700) {
  const [v, setV] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current;
    const t0 = performance.now();
    let raf;
    const tick = (t) => {
      const p = Math.min(1, (t - t0) / ms);
      const e = 1 - Math.pow(1 - p, 3);
      setV(from + (target - from) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
      else prev.current = target;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

const roundBtn = {
  width: 34, height: 34, borderRadius: 11, background: C.cardHi,
  color: C.text, fontSize: 18, fontWeight: 500, lineHeight: 1, flexShrink: 0,
};
const smallBtn = { ...roundBtn, width: 30, height: 30, fontSize: 16 };

/* hours-studied slider with an explicit confirm */
function HoursSlider({ s, onCommit }) {
  const [v, setV] = useState(s.logged);
  useEffect(() => { setV(s.logged); }, [s.logged]);
  const dirty = v !== s.logged;
  const max = Math.max(1, Math.ceil(s.raw));
  return (
    <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 6, paddingTop: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 550 }}>Hours studied</div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>Comes off what you still need</div>
        </div>
        <div style={{ fontSize: 22, fontWeight: 700, color: dirty ? C.accentText : C.text, fontVariantNumeric: "tabular-nums", letterSpacing: -0.6 }}>
          {fmtH(v)}
        </div>
      </div>
      <input type="range" min="0" max={max} step="0.5" value={v} onChange={(e) => setV(+e.target.value)} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.dim, marginTop: 5 }}>
        <span>0h</span>
        <span>{max}h</span>
      </div>
      {dirty && (
        <div style={{ display: "flex", gap: 8, marginTop: 14, animation: "rise .3s cubic-bezier(.32,.72,0,1) both" }}>
          <Tap onClick={() => setV(s.logged)} style={{ flex: 1, background: "transparent", border: `1px solid ${C.line}`, color: C.dim, padding: "11px 0", borderRadius: 12, fontSize: 14, fontWeight: 600 }}>
            Cancel
          </Tap>
          <Tap onClick={() => onCommit(s.id, v)} style={{ flex: 2, background: C.amber, color: C.onAccent, padding: "11px 0", borderRadius: 12, fontSize: 14, fontWeight: 650 }}>
            Confirm {fmtH(v)}
          </Tap>
        </div>
      )}
    </div>
  );
}

/* one-day editor sheet */
function DaySheet({ day, value, isCustom, onClose, onConfirm, onReset }) {
  const [v, setV] = useState(value);
  const desktop = useIsDesktop();
  return (
    <div style={sheetOverlay(desktop, 85)} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ ...sheetPanel(desktop), padding: desktop ? "16px 28px 28px" : "10px 24px 32px" }}
      >
        <SheetHandle desktop={desktop} />
        <div style={{ fontSize: 13, color: C.accentText, fontWeight: 600 }}>
          {fmtDay(day)} {fmtDate(day)}
        </div>
        <div style={{ fontSize: 46, fontWeight: 700, letterSpacing: -1.8, margin: "8px 0 4px", fontVariantNumeric: "tabular-nums" }}>
          {fmtH(v)}
        </div>
        <div style={{ fontSize: 14, color: C.dim, marginBottom: 22 }}>
          How much can you study this day?
        </div>

        <input type="range" min="0" max="14" step="0.5" value={v} onChange={(e) => setV(+e.target.value)} />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.dim, marginTop: 5, marginBottom: 20 }}>
          <span>0h</span>
          <span>14h</span>
        </div>

        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          {[0, 2, 4, 6, 8].map((q) => (
            <Tap key={q} onClick={() => setV(q)} style={{ flex: 1, background: v === q ? C.amber : C.cardHi, color: v === q ? C.onAccent : C.dim, border: `1px solid ${v === q ? C.amber : C.line}`, borderRadius: 12, padding: "11px 0", fontSize: 14, fontWeight: 600 }}>
              {q}h
            </Tap>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <Tap onClick={onClose} style={{ flex: 1, background: "transparent", border: `1px solid ${C.line}`, color: C.dim, padding: "16px 0", borderRadius: 16, fontSize: 15, fontWeight: 600 }}>
            Cancel
          </Tap>
          <Tap onClick={() => onConfirm(v)} style={{ flex: 2, background: C.amber, color: C.onAccent, padding: "16px 0", borderRadius: 16, fontSize: 16, fontWeight: 650 }}>
            Confirm
          </Tap>
        </div>
        {isCustom && (
          <Tap onClick={onReset} style={{ width: "100%", marginTop: 12, background: "transparent", color: C.dim, padding: "10px 0", fontSize: 14, fontWeight: 500 }}>
            Reset to default
          </Tap>
        )}
      </div>
    </div>
  );
}

/* ============================== APP =============================== */
export default function App() {
  const desktop = useIsDesktop();
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState("onboard");
  const [dir, setDir] = useState("fwd");
  const [wd, setWd] = useState(2.5);
  const [we, setWe] = useState(5);
  const [ov, setOv] = useState({});
  const [pace, setPace] = useState("steady");
  const [theme, setTheme] = useState("system");   // "light" | "dark" | "system"
  const [palette, setPalette] = useState(DEFAULT_PALETTE);
  const [back, setBack] = useState(null);         // where Plan or Time returns to on a phone (they aren't tabs there)
  const [subjects, setSubjects] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [sheet, setSheet] = useState(null); // null | {mode:'add'} | {mode:'edit', subject}
  const [toast, setToast] = useState(null);
  const [, setOverlay] = useState(false);   // screens still report sheets they open
  const [onboarded, setOnboarded] = useState(false);
  const [sync, setSync] = useState("local");
  const [cloudApi, setCloudApi] = useState(null);   // firebase module, once it loads
  const [account, setAccount] = useState(null);     // { uid, email, isAnonymous } | null
  const [paused, setPaused] = useState(false);      // holds autosave while the account switches
  const [loginFrom, setLoginFrom] = useState("onboard");
  const [loginFirst, setLoginFirst] = useState(false);  // login is the launch screen, not a detour
  // a study session; kept on this device so a reload or a closed tab doesn't lose a running timer
  const [session, setSession] = useState(readSession);
  useEffect(() => { writeSession(session); }, [session]);

  /* put a saved plan into the screen's state */
  const applyState = (s) => {
    setWd(typeof s?.wd === "number" ? s.wd : 2.5);
    setWe(typeof s?.we === "number" ? s.we : 5);
    setOv(s?.ov ?? {});
    setPace(s?.pace ?? "steady");
    setTheme(THEMES.some((t) => t.id === s?.theme) ? s.theme : "system");
    setPalette(paletteById(s?.palette).id);
    // hours studied used to be one total; they're dated entries now
    setSubjects(Array.isArray(s?.subjects) ? s.subjects.map((x) => migrateLog(x, key(new Date()))) : []);
    setOnboarded(!!s?.onboarded);
  };

  /* restore */
  useEffect(() => {
    let alive = true;
    loadState().then(async ({ state: s, source }) => {
      if (!alive) return;
      setSync(source === "cloud" ? "cloud" : "local");
      if (s) applyState(s);
      const home = s?.onboarded ? "today" : "onboard";

      // Login comes first, unless this device is already signed in to an
      // account, or the person already chose to continue without one.
      const c = await getCloud();
      let signedIn = false;
      if (c?.signInWithEmail) {
        try {
          const acct = await c.currentAccount();
          signedIn = !!(acct && !acct.isAnonymous);
        } catch (e) { /* can't tell: treat as signed out */ }
      }
      if (!alive) return;
      if (c?.signInWithEmail && !signedIn && !isGuest()) {
        setLoginFrom(home);
        setLoginFirst(true);
        setScreen("login");
      } else if (home === "today") {
        setScreen("today");
      }
      setReady(true);
    });
    return () => { alive = false; };
  }, []);

  /* accounts: only offered when the Firebase module loaded */
  useEffect(() => {
    let alive = true;
    let unwatch;
    getCloud().then((c) => {
      if (!alive || !c?.signInWithEmail) return;
      setCloudApi(c);
      unwatch = c.watchAccount?.(setAccount);
    });
    return () => { alive = false; unwatch?.(); };
  }, []);

  /* autosave */
  useEffect(() => {
    if (!ready || paused) return;
    saveState({ wd, we, ov, pace, theme, palette, subjects, onboarded }, setSync);
  }, [ready, paused, wd, we, ov, pace, theme, palette, subjects, onboarded]);

  useTheme(theme, palette);

  const go = (s, d = "fwd") => { setDir(d); setScreen(s); };
  /* Plan and Time aren't phone tabs: opened from Today or Settings, they come back there */
  const openFrom = (s, from) => { setBack(from); go(s); };

  /* Android hardware back: close what's open instead of quitting the app */
  useEffect(() => {
    const handleBack = (e) => {
      if (sheet) { e?.preventDefault?.(); setSheet(null); return true; }
      if (screen === "login") { e?.preventDefault?.(); leaveLogin(); return true; }
      if (screen === "timer" && session && session.from !== "timer") { e?.preventDefault?.(); closeTimer(); return true; }
      if ((screen === "plan" || screen === "time") && back && !desktop) { e?.preventDefault?.(); go(back, "back"); return true; }
      if (screen === "detail" || screen === "import") { e?.preventDefault?.(); go("subjects", "back"); return true; }
      if (screen !== "today" && screen !== "onboard") {
        e?.preventDefault?.(); go("today", "back"); return true;
      }
      return false;
    };
    document.addEventListener("backbutton", handleBack);
    window.addEventListener("popstate", handleBack);
    return () => {
      document.removeEventListener("backbutton", handleBack);
      window.removeEventListener("popstate", handleBack);
    };
  }, [sheet, screen, loginFrom, loginFirst, session, back, desktop]);
  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 2200); };

  /* ---- accounts ----
     Signing in switches this device to a different Firebase user, so the
     plan on screen has to be swapped for that account's plan. Autosave is
     held (paused) from just before the switch until the new plan is loaded,
     so nothing from the old user is ever written into the new account. */
  const openLogin = (from) => { setLoginFrom(from); setLoginFirst(false); go("login"); };

  /* "Not now" / "Continue without an account" / hardware back */
  const leaveLogin = () => {
    setGuest(true);                    // remembered, so login isn't forced on every launch
    setLoginFirst(false);
    go(loginFrom, loginFirst ? "fwd" : "back");
  };

  const authApi = cloudApi && {
    signIn: async (email, password) => {
      cancelPendingSave();
      setPaused(true);
      try { return await cloudApi.signInWithEmail(email, password); }
      catch (e) { setPaused(false); throw e; }
    },
    register: (email, password) => cloudApi.registerWithEmail(email, password),
    resetPassword: (email) => cloudApi.sendReset(email),
  };

  const finishLogin = async (user, kind) => {
    if (kind === "register") {
      // the email was attached to the same user, so the saved plan is already theirs
      setAccount(user);
      flash("Account created");
      setLoginFirst(false);
      go(loginFrom, loginFirst ? "fwd" : "back");
      return;
    }
    let remote;
    try {
      remote = await cloudApi.cloudLoad();
    } catch (e) {
      // couldn't read their plan: undo the sign-in rather than risk overwriting it
      try { await cloudApi.signOutAccount(); } catch (_) {}
      setPaused(false);
      const err = new Error("load failed");
      err.code = "app/load-failed";
      throw err;
    }
    setAccount(user);
    if (remote) applyState(remote);
    setSync("cloud");
    setPaused(false);
    flash("Signed in");
    setLoginFirst(false);
    // land on Today if the plan they now have has any set-up in it
    const plan = remote ?? { onboarded, subjects };
    go(plan.onboarded || plan.subjects?.length ? "today" : "onboard");
  };

  const signOutNow = async () => {
    cancelPendingSave();
    setPaused(true);
    try { await cloudApi.signOutAccount(); }
    catch (e) { setPaused(false); flash("Couldn't sign out. Try again."); return; }
    clearLocalCopy();
    applyState(null);
    setAccount(null);
    setSync("local");
    setPaused(false);
    setGuest(false);                   // signed out: login comes first again
    setLoginFrom("onboard");
    setLoginFirst(true);
    go("login", "back");
    flash("Signed out");
  };

  const plan = useMemo(() => analysePlan(subjects, { wd, we, ov, pace }), [subjects, wd, we, ov, pace]);
  const analysis = plan.subjects;
  const passed = plan.passed;

  const day = useMemo(() => todayPlan(subjects, { wd, we, ov, pace }), [subjects, wd, we, ov, pace]);
  const upcoming = useMemo(() => upcomingDays(analysis, { wd, we, ov }), [analysis, wd, we, ov]);
  const emptyActions = { onAdd: () => setSheet({ mode: "add" }), onImport: () => go("import") };

  const worst = analysis.reduce((a, b) => (b.gap < (a?.gap ?? Infinity) ? b : a), null);
  const totalShort = analysis.reduce((t, s) => t + Math.min(0, s.gap), 0);
  const totalSpare = plan.spare;
  const lastExam = subjects.length
    ? subjects.reduce((a, b) => (toDate(b.date) > toDate(a) ? b.date : a), subjects[0].date)
    : key(addDays(new Date(), 14));

  const patch = (id, changes) =>
    setSubjects((p) => p.map((s) => (s.id === id ? { ...s, ...changes } : s)));

  const toggleChapter = (id, i) =>
    setSubjects((p) =>
      // built to the chapter count, so a short saved list never swallows a tick
      p.map((s) => (s.id === id ? { ...s, done: Array.from({ length: s.chapters }, (_, j) => (j === i ? !s.done?.[j] : !!s.done?.[j])) } : s))
    );

  /* ---- study timer ----
     A session with time on the clock, or one waiting for "Add 25 minutes?",
     survives leaving the screen; anything else is cleared on the way out. */
  const openTimer = (id, from) => {
    if (!sessionActive(session)) setSession(newSession(id, from));
    go("timer");
  };
  /* the Timer tab with nothing running: a blank session, subject not chosen yet */
  useEffect(() => {
    if (screen === "timer" && !session && analysis.length) setSession(newSession(null, "timer"));
  }, [screen, session, analysis.length]);
  function closeTimer() {
    if (!sessionActive(session)) setSession(null);
    go(session?.from ?? "today", "back");
  }
  /* a finished session, once the student has said yes: a dated entry, and the chapter if they ticked it */
  const logSession = (id, minutes, chapter) => {
    const today = key(new Date());
    setSubjects((p) => p.map((x) => {
      if (x.id !== id) return x;
      const y = addLog(x, minutes / 60, today, "timer");
      if (chapter == null) return y;
      return { ...y, done: Array.from({ length: y.chapters }, (_, j) => (j === chapter ? true : !!y.done?.[j])) };
    }));
  };

  const passedActions = {
    onUpdate: (s) => setSheet({ mode: "edit", subject: s }),
    onRemove: (s) => { setSubjects((p) => p.filter((x) => x.id !== s.id)); flash(`${s.name} removed`); },
  };

  const removeSubject = (id) => {
    const name = subjects.find((s) => s.id === id)?.name;
    setSubjects((p) => p.filter((s) => s.id !== id));
    go("subjects", "back");
    flash(`${name} removed`);
  };

  const styles = `
    @keyframes fwdIn { from { opacity:0; transform: translateX(28px) scale(.99) } to { opacity:1; transform:none } }
    @keyframes backIn { from { opacity:0; transform: translateX(-28px) scale(.99) } to { opacity:1; transform:none } }
    @keyframes sheetUp { from { transform: translateY(100%) } to { transform: translateY(0) } }
    @keyframes dialogIn { from { opacity:0; transform: translateY(12px) scale(.97) } to { opacity:1; transform:none } }
    @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
    @keyframes toastIn { from { opacity:0; transform: translate(-50%, 14px) } to { opacity:1; transform: translate(-50%,0) } }
    @keyframes rise { from { opacity:0; transform: translateY(14px) } to { opacity:1; transform:none } }
    @keyframes barUp { from { opacity:0; transform: translateY(70px) } to { opacity:1; transform:none } }
    @keyframes barUpCentered { from { opacity:0; transform: translate(-50%, 70px) } to { opacity:1; transform: translate(-50%, 0) } }
    .rise { animation: rise .5s cubic-bezier(.32,.72,0,1) both }
    @keyframes skel { from { background-position: 100% 50% } to { background-position: 0 50% } }
    .skel { background: linear-gradient(90deg, var(--raised) 30%, var(--hover) 50%, var(--raised) 70%); background-size: 300% 100%; animation: skel 1.4s ease-in-out infinite }
    @keyframes pdfspin { to { transform: rotate(360deg) } }
    .pdf-spin { display: inline-block; animation: pdfspin .8s linear infinite }
    .focus-ring:focus-visible { outline: 2px solid ${C.accent}; outline-offset: 3px }
    ::-webkit-scrollbar { width:0; height:0 }
    .appmin { min-height: 100vh; min-height: 100dvh }
    .sheetbox { max-height: 88vh; max-height: 85dvh }
    @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
      .glass { background: var(--surface) !important }
    }
    input[type=range]{ -webkit-appearance:none; appearance:none; background:transparent; width:100%; margin:0 }
    input[type=range]::-webkit-slider-runnable-track{ height:6px; border-radius:99px; background:var(--raised); border:1px solid ${C.line} }
    input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; width:26px; height:26px; border-radius:99px; background:${C.amber}; margin-top:-11px; box-shadow:0 2px 8px rgba(31,26,22,.28); cursor:pointer }
    input[type=range]::-moz-range-track{ height:6px; border-radius:99px; background:var(--raised); border:1px solid ${C.line} }
    input[type=range]::-moz-range-thumb{ width:26px; height:26px; border:none; border-radius:99px; background:${C.amber}; cursor:pointer }
    input[type=date]::-webkit-calendar-picker-indicator { filter: var(--picker-filter); opacity:.5 }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important }
    }
  `;

  // Plan and Time open from Today and Settings as full screens with a way back on a phone
  const subBack = !desktop && back ? () => go(back, "back") : null;
  /* Navigation stays on every screen after onboarding and login: a labelled
     sidebar on desktop, a slim rail down the left on a phone. */
  const navOn = ready && screen !== "onboard" && screen !== "login";
  const withNav = desktop && navOn;
  const withRail = !desktop && navOn;

  return (
    <div
      className="appmin"
      style={{
        fontFamily: FONT, background: "transparent", color: C.text,
        position: "relative", WebkitFontSmoothing: "antialiased",
        // each layout's page padding (PAGE_PAD reads these)
        "--gutter": desktop ? "32px" : withRail ? "16px" : "24px",
        "--page-top": desktop ? "48px" : "28px",
        ...(desktop ? {} : { maxWidth: MOBILE_MAX, margin: "0 auto", overflowX: "hidden" }),
      }}
    >
      <style>{styles}</style>
      <Backdrop left={withNav ? SIDEBAR_W : withRail ? RAIL_W : 0} />

      {withNav && <Sidebar screen={screen} go={go} onAdd={() => setSheet({ mode: "add" })} onImport={() => go("import")} />}
      {withRail && <PhoneRail screen={screen} go={go} onAdd={() => setSheet({ mode: "add" })} />}

      <div style={{ position: "relative", zIndex: 1, ...(desktop ? { marginLeft: withNav ? SIDEBAR_W : 0, overflowX: "hidden" } : { marginLeft: withRail ? RAIL_W : 0 }) }}>
      <div style={desktop ? { maxWidth: withNav ? CONTENT_MAX : MOBILE_MAX, margin: "0 auto", padding: withNav ? "0 8px" : 0 } : undefined}>
      {!ready && <div className="appmin"><Skeleton /></div>}
      {ready && (
      <div
        key={screen + openId}
        style={{
          animation: `${dir === "fwd" ? "fwdIn" : "backIn"} .4s cubic-bezier(.32,.72,0,1) both`,
          paddingBottom: 48,
        }}
        className="appmin"
      >
        {screen === "onboard" && (
          <Onboard wd={wd} we={we} setWd={setWd} setWe={setWe}
            onDone={() => { setOnboarded(true); go("today"); flash("Saved"); }}
            onSignIn={cloudApi ? () => openLogin("onboard") : null} />
        )}
        {screen === "login" && (
          <Login
            api={authApi}
            hasPlan={subjects.length > 0}
            firstRun={loginFirst}
            onDone={finishLogin}
            onClose={leaveLogin}
          />
        )}
        {screen === "today" && (
          <Today
            day={day} upcoming={upcoming} data={analysis} passed={passed}
            session={sessionActive(session) ? session : null}
            onStart={(id) => openTimer(id, "today")}
            onResume={() => go("timer")}
            onOpen={(id) => { setOpenId(id); go("detail"); }}
            onTime={() => openFrom("time", "today")}
            onPlan={() => openFrom("plan", "today")}
            onReality={() => go("reality")}
            shortH={-totalShort} spareH={totalSpare}
            {...emptyActions}
          />
        )}
        {screen === "subjects" && (
          <Subjects sync={sync} data={analysis} passed={passed} passedActions={passedActions} onOpen={(id) => { setOpenId(id); go("detail"); }}
            onAdd={() => setSheet({ mode: "add" })}
            onImport={() => go("import")}
            onSample={() => { setSubjects(sampleSubjects()); flash("Sample subjects loaded"); }} />
        )}
        {screen === "import" && (
          <ImportPdf
            defaultPace={pace}
            onCancel={() => go("subjects", "back")}
            onManual={() => { go("subjects", "back"); setSheet({ mode: "add" }); }}
            onSave={(list) => {
              setSubjects((p) => [...p, ...list]);
              flash(`${list.length} subject${list.length === 1 ? "" : "s"} added`);
              go("subjects", "back");
            }}
          />
        )}
        {screen === "reality" && (
          <Reality data={analysis} passed={passed} passedActions={passedActions} totalShort={totalShort} totalSpare={totalSpare} today={day} {...emptyActions}
            onOpen={(id) => { setOpenId(id); go("detail"); }}
            onTime={() => openFrom("time", "reality")}
            onSetLog={(id, v) => {
              setSubjects((p) => p.map((x) => (x.id === id ? setLoggedTotal(x, v, key(new Date())) : x)));
              flash("Changes confirmed");
            }} />
        )}
        {screen === "plan" && <Plan data={analysis} onBack={subBack} backLabel={back === "settings" ? "Settings" : "Today"} {...emptyActions} />}
        {screen === "time" && (
          <TimeScreen
            wd={wd} we={we} ov={ov} lastExam={lastExam}
            onBack={subBack} backLabel={back === "today" ? "Today" : back === "reality" ? "Reality check" : "Settings"}
            onSaveWd={(v) => { setWd(v); flash("Changes confirmed"); }}
            onSaveWe={(v) => { setWe(v); flash("Changes confirmed"); }}
            onSetDay={(k, v, d) => { setOv((p) => ({ ...p, [k]: v })); flash("Changes confirmed"); }}
            onResetDay={(k, d) => { setOv((p) => { const n = { ...p }; delete n[k]; return n; }); flash("Reset to default"); }}
            setOverlay={setOverlay}
          />
        )}
        {screen === "settings" && (
          <Settings
            theme={theme} onTheme={setTheme}
            palette={palette} onPalette={setPalette}
            pace={pace} onSavePace={(v) => { setPace(v); flash("Changes confirmed"); }}
            wd={wd} we={we} onOpenTime={() => openFrom("time", "settings")}
            account={cloudApi ? account : undefined}
            onSignIn={() => openLogin("settings")}
            onSignOut={signOutNow}
            onReset={() => {
              setSubjects([]);
              setOv({}); setWd(2.5); setWe(5); setPace("steady");
              setOnboarded(false); go("onboard", "back");
            }}
          />
        )}
        {screen === "timer" && (session ? (
          <Timer
            subjects={analysis}
            session={session}
            setSession={setSession}
            onLog={(minutes, chapter) => logSession(session.subjectId, minutes, chapter)}
            onClose={closeTimer}
          />
        ) : (
          <TimerPicker {...emptyActions} />
        ))}
        {screen === "detail" && (
          <Detail
            s={analysis.find((x) => x.id === openId)}
            onBack={() => go("subjects", "back")}
            onToggle={toggleChapter}
            onRemove={removeSubject}
            onPatch={patch}
            onEdit={(subj) => setSheet({ mode: "edit", subject: subj })}
            onStudy={(id) => openTimer(id, "detail")}
            studying={sessionActive(session)}
            flash={flash}
            setOverlay={setOverlay}
          />
        )}
      </div>
      )}
      </div>
      </div>


      {sheet && (
        <SubjectSheet
          mode={sheet.mode}
          initial={sheet.subject}
          defaultPace={pace}
          onClose={() => setSheet(null)}
          onSave={(s) => {
            if (sheet.mode === "edit") { patch(s.id, s); flash("Changes confirmed"); }
            else { setSubjects((p) => [...p, s]); flash(`${s.name} added`); }
            setSheet(null);
          }}
        />
      )}

      {toast && (
        <div
          style={{
            position: "fixed", bottom: 32,
            left: withNav ? `calc(50% + ${SIDEBAR_W / 2}px)` : withRail ? `calc(50% + ${RAIL_W / 2}px)` : "50%",
            background: C.cardHi, border: `1px solid ${C.line}`, padding: "12px 20px",
            borderRadius: 999, fontSize: 14, fontWeight: 500,
            animation: "toastIn .35s cubic-bezier(.32,.72,0,1) both",
            zIndex: 90, boxShadow: "var(--shadow-pop)",
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}

/* --------------------------- SAVE BAR --------------------------- */
function SaveBar({ onSave, onCancel, label = "Save changes", bottom = 0 }) {
  const desktop = useIsDesktop();
  return (
    <div
      style={{
        position: "fixed", transform: "translateX(-50%)",
        background: C.glass, backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        ...(desktop
          ? {
              // floats over the content column, clear of the sidebar
              bottom: bottom + 24, left: `calc(50% + ${SIDEBAR_W / 2}px)`,
              width: `min(${CONTENT_MAX - 48}px, calc(100vw - ${SIDEBAR_W + 48}px))`,
              padding: 12, border: `1px solid ${C.line}`, borderRadius: 20,
              boxShadow: "var(--shadow-pop)",
            }
          : {
              bottom, left: "50%", width: "100%", maxWidth: MOBILE_MAX,
              padding: "12px 24px 14px", borderTop: `1px solid ${C.line}`,
            }),
        display: "flex", gap: 10, zIndex: 70,
        animation: "barUpCentered .35s cubic-bezier(.32,.72,0,1) both", boxSizing: "border-box",
      }}
    >
      <Tap
        onClick={onCancel}
        style={{
          flex: 1, background: "transparent", border: `1px solid ${C.line}`,
          color: C.dim, padding: "15px 0", borderRadius: 14, fontSize: 15, fontWeight: 600,
        }}
      >
        Cancel
      </Tap>
      <Tap
        onClick={onSave}
        style={{
          flex: 2, background: C.amber, color: C.onAccent, padding: "15px 0",
          borderRadius: 14, fontSize: 16, fontWeight: 650,
        }}
      >
        {label}
      </Tap>
    </div>
  );
}

/* ------------------ inline confirm controls ------------------ */
function ConfirmRow({ onCancel, onConfirm }) {
  return (
    <div style={{ display: "flex", gap: 8, marginTop: 12, animation: "rise .28s cubic-bezier(.32,.72,0,1) both" }}>
      <Tap onClick={onCancel} style={{ flex: 1, background: "transparent", border: `1px solid ${C.line}`, color: C.dim, padding: "11px 0", borderRadius: 12, fontSize: 14, fontWeight: 600 }}>
        Cancel
      </Tap>
      <Tap onClick={onConfirm} style={{ flex: 2, background: C.amber, color: C.onAccent, padding: "11px 0", borderRadius: 12, fontSize: 14, fontWeight: 650 }}>
        Confirm
      </Tap>
    </div>
  );
}

function ConfirmStepper({ label, sub, value, onCommit, delay }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const dirty = v !== value;
  return (
    <div className="rise card" style={{ background: C.card, border: `1px solid ${dirty ? C.amber : C.line}`, borderRadius: 18, padding: 20, marginBottom: 16, animationDelay: delay, transition: "border-color .3s cubic-bezier(.32,.72,0,1)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ paddingRight: 12 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{label}</div>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>{sub}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Tap onClick={() => setV(Math.max(0, +(v - 0.5).toFixed(1)))} style={roundBtn}>−</Tap>
          <div style={{ fontSize: 23, fontWeight: 700, width: 44, textAlign: "center", fontVariantNumeric: "tabular-nums", letterSpacing: -0.5, color: dirty ? C.accentText : C.text }}>{v}</div>
          <Tap onClick={() => setV(Math.min(16, +(v + 0.5).toFixed(1)))} style={roundBtn}>+</Tap>
        </div>
      </div>
      {dirty && <ConfirmRow onCancel={() => setV(value)} onConfirm={() => onCommit(v)} />}
    </div>
  );
}

function PaceCard({ value, onCommit }) {
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  const dirty = v !== value;
  return (
    <div className="rise card" style={{ background: C.card, border: `1px solid ${dirty ? C.amber : C.line}`, borderRadius: 18, padding: 20, marginBottom: 16, animationDelay: ".1s", transition: "border-color .3s cubic-bezier(.32,.72,0,1)" }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>Default pace</div>
      <div style={{ fontSize: 13, color: C.dim, marginTop: 3, lineHeight: 1.5 }}>
        Pre-fills new subjects. Each subject keeps its own pace, set when you add it.
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        {PACE.map((p) => (
          <Tap
            key={p.id}
            onClick={() => setV(p.id)}
            style={{
              flex: 1, background: v === p.id ? C.amber : C.cardHi,
              color: v === p.id ? C.onAccent : C.dim,
              border: `1px solid ${v === p.id ? C.amber : C.line}`,
              borderRadius: 12, padding: "12px 4px", fontSize: 13.5, fontWeight: 650,
            }}
          >
            {p.label}
          </Tap>
        ))}
      </div>
      <div style={{ fontSize: 12.5, color: C.dim, marginTop: 10 }}>
        {PACE.find((p) => p.id === v)?.sub}
      </div>
      {dirty && <ConfirmRow onCancel={() => setV(value)} onConfirm={() => onCommit(v)} />}
    </div>
  );
}

/* ---------------------------- ONBOARD ---------------------------- */
function Onboard({ wd, we, setWd, setWe, onDone, onSignIn }) {
  return (
    <div style={{ padding: "72px 24px 0" }}>
      <div className="rise" style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Mark size={32} />
        <span style={{ fontSize: 13, color: C.accentText, fontWeight: 600 }}>Feasible</span>
      </div>
      <h1 className="rise" style={{ fontSize: 36, lineHeight: 1.12, fontWeight: 700, letterSpacing: -1.1, margin: "14px 0 12px", animationDelay: ".05s" }}>
        Let's see if your<br />plan is possible.
      </h1>
      <p className="rise" style={{ color: C.dim, fontSize: 16, lineHeight: 1.55, margin: 0, maxWidth: 330, animationDelay: ".1s" }}>
        Most study plans fail because they never fit in the first place. Start with how much time you actually have.
      </p>
      <div style={{ marginTop: 44 }}>
        <Stepper label="On a school day" sub="Hours you can really study" value={wd} set={setWd} delay=".18s" />
        <Stepper label="On a weekend day" sub="Be honest, not aspirational" value={we} set={setWe} delay=".24s" />
      </div>
      <Tap onClick={onDone} style={{ marginTop: 36, width: "100%", background: C.amber, color: C.onAccent, padding: "17px 0", borderRadius: 16, fontSize: 17, fontWeight: 650 }}>
        Save and continue
      </Tap>
      <div style={{ fontSize: 13, color: C.dim, textAlign: "center", marginTop: 14 }}>
        Everything is kept. You can change it later under Time.
      </div>
      {onSignIn && (
        <div className="rise" style={{ fontSize: 14, color: C.dim, textAlign: "center", marginTop: 22, animationDelay: ".3s" }}>
          Already have an account?{" "}
          <Tap className="focus-ring" onClick={onSignIn} style={{ background: "none", color: C.accentText, fontSize: 14, fontWeight: 600, padding: "4px 2px", borderRadius: 6 }}>
            Sign in
          </Tap>
        </div>
      )}
    </div>
  );
}

function Stepper({ label, sub, value, set, delay }) {
  return (
    <div className="rise card" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, padding: 20, marginBottom: 16, display: "flex", alignItems: "center", justifyContent: "space-between", animationDelay: delay }}>
      <div style={{ paddingRight: 12 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>{sub}</div>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <Tap onClick={() => set(Math.max(0, +(value - 0.5).toFixed(1)))} style={roundBtn}>−</Tap>
        <div style={{ fontSize: 23, fontWeight: 700, width: 44, textAlign: "center", fontVariantNumeric: "tabular-nums", letterSpacing: -0.5 }}>{value}</div>
        <Tap onClick={() => set(Math.min(16, +(value + 0.5).toFixed(1)))} style={roundBtn}>+</Tap>
      </div>
    </div>
  );
}

/* ----------------------------- TIME ------------------------------ */
function TimeScreen({ wd, we, ov, lastExam, onSaveWd, onSaveWe, onSetDay, onResetDay, setOverlay, onBack, backLabel }) {
  const [pick, setPick] = useState(null);
  useEffect(() => { setOverlay(!!pick); return () => setOverlay(false); }, [pick]);
  const total = Math.max(14, daysUntil(lastExam) + 1);
  const days = Array.from({ length: total }, (_, i) => addDays(new Date(), i));

  const totalHours = hoursBetween(new Date(), lastExam, wd, we, ov);
  const customCount = Object.keys(ov).length;
  const split = useSplit();

  /* the pieces of the screen; side by side on a wide screen */
  const totalCard = (
    <>
      <div className="rise card" style={{ ...hero("accent"), marginBottom: SP.group }}>
        <div style={{ fontSize: 64, fontWeight: 700, letterSpacing: -3, color: C.accent, lineHeight: 1 }}>
          {fmtH(totalHours)}
        </div>
        <div style={{ fontSize: 14, color: C.dim, marginTop: 14, lineHeight: 1.5 }}>
          total study time between now and your last exam. Every change below moves this
          number and the Check tab straight away.
        </div>
      </div>
    </>
  );

  const defaults = (
    <>
      <ConfirmStepper label="On a school day" sub="Default for Mon–Fri" value={wd} onCommit={onSaveWd} delay="0s" />
      <ConfirmStepper label="On a weekend day" sub="Default for Sat–Sun" value={we} onCommit={onSaveWe} delay=".05s" />
    </>
  );

  const specificDays = (
    <>
      <div style={{ marginTop: split ? SP.section - SP.group : SP.section, marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: -0.3 }}>Specific days</div>
        <div style={{ fontSize: 13, color: C.dim, marginTop: 5, lineHeight: 1.5 }}>
          Tap any day to change just that one. Function on Saturday? Set it to zero.
          {customCount > 0 && ` A dot marks the ${customCount} day${customCount === 1 ? "" : "s"} you've changed.`}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: `repeat(${split ? 7 : 4}, minmax(0, 1fr))`, gap: 8 }}>
        {days.map((d, i) => {
          const k = key(d);
          const custom = k in ov;
          const val = custom ? ov[k] : defaultHours(d, wd, we);
          const weekend = [0, 6].includes(d.getDay());
          return (
            <Tap
              key={k}
              className="card"
              onClick={() => setPick({ day: d, val, custom })}
              style={{
                background: C.surface,
                border: `1px solid ${C.line}`,
                borderRadius: 14, padding: "12px 4px", color: C.text,
                position: "relative",
                animation: `rise .45s cubic-bezier(.32,.72,0,1) ${Math.min(0.4, 0.015 * i)}s both`,
              }}
            >
              {custom && (
                <div style={{ position: "absolute", top: 8, right: 8, width: 5, height: 5, borderRadius: 99, background: C.amber }} />
              )}
              <div style={{ fontSize: 11, color: weekend ? C.info : C.dim, fontWeight: 600 }}>
                {i === 0 ? "TODAY" : fmtDay(d).toUpperCase()}
              </div>
              <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>
                {new Date(d).getDate()}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 5, color: C.text, fontVariantNumeric: "tabular-nums" }}>
                {fmtH(val)}
              </div>
            </Tap>
          );
        })}
      </div>
    </>
  );

  return (
    <div style={{ padding: PAGE_PAD }}>
      {onBack && <BackLink label={backLabel} onClick={onBack} />}
      <Header title="Time" sub="What you actually have, not what you wish you had" />

      {split ? (
        <Split
          main={<>{totalCard}{specificDays}</>}
          side={<><SectionLabel>Defaults</SectionLabel>{defaults}</>}
        />
      ) : (
        <>
          {totalCard}
          {defaults}
          {specificDays}
        </>
      )}

      <div style={{ height: 10 }} />

      {pick && (
        <DaySheet
          day={pick.day}
          value={pick.val}
          isCustom={pick.custom}
          onClose={() => setPick(null)}
          onConfirm={(v) => { onSetDay(key(pick.day), v, pick.day); setPick(null); }}
          onReset={() => { onResetDay(key(pick.day), pick.day); setPick(null); }}
        />
      )}
    </div>
  );
}

/* ---------------------------- SETTINGS ---------------------------- */
function BackLink({ label, onClick }) {
  return (
    <Tap className="focus-ring" onClick={onClick} style={{ background: "transparent", color: C.accentText, padding: 0, fontSize: 16, marginBottom: 22, fontWeight: 500 }}>
      ‹ {label}
    </Tap>
  );
}

/* Mode (Light, Dark or follow the device) and palette, independent of each
   other. Each swatch previews its palette in the mode in use. */
function ThemeCard({ value, onChange, palette, onPalette }) {
  const deviceDark = useMedia("(prefers-color-scheme: dark)");
  const mode = value === "dark" || (value === "system" && deviceDark) ? "dark" : "light";
  return (
    <div className="rise card" style={{ ...card, marginBottom: SP.group }}>
      <div style={{ fontSize: 15, fontWeight: 600 }}>Mode</div>
      <div role="radiogroup" aria-label="Mode" style={{ display: "flex", gap: 4, marginTop: 12, padding: 4, background: C.raised, borderRadius: 12 }}>
        {THEMES.map((t) => {
          const on = value === t.id;
          return (
            <Tap
              key={t.id}
              role="radio"
              aria-checked={on}
              className="focus-ring"
              onClick={() => onChange(t.id)}
              style={{
                flex: 1, padding: "9px 0", borderRadius: 9, fontSize: 13.5, fontWeight: 600,
                background: on ? C.surface : "transparent", color: on ? C.text : C.dim,
                boxShadow: on ? "var(--shadow)" : "none",
                transition: `background .2s ${EASE}, color .2s ${EASE}`,
              }}
            >
              {t.label}
            </Tap>
          );
        })}
      </div>

      <div style={{ fontSize: 15, fontWeight: 600, marginTop: 22 }}>Colour scheme</div>
      <div style={{ fontSize: 12.5, color: C.dim, marginTop: 3 }}>{PALETTES.length} schemes, previewed in {mode} mode</div>
      <div role="radiogroup" aria-label="Colour scheme" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 14, marginTop: 14 }}>
        {PALETTES.map((p) => {
          const on = palette === p.id;
          const t = paletteTokens(p, mode);
          return (
            <Tap
              key={p.id}
              role="radio"
              aria-checked={on}
              aria-label={p.name}
              className="focus-ring"
              onClick={() => onPalette(p.id)}
              style={{ background: "transparent", padding: 0, color: C.text, display: "flex", flexDirection: "column", alignItems: "stretch", gap: 8, textAlign: "left" }}
            >
              <span
                aria-hidden="true"
                style={{
                  position: "relative", display: "block", boxSizing: "border-box", padding: 10, borderRadius: 16,
                  background: t.bg, border: `1px solid ${t.line}`,
                  outline: on ? `2.5px solid ${C.accent}` : "2.5px solid transparent", outlineOffset: 3,
                  transition: `outline-color .2s ${EASE}`,
                }}
              >
                <span style={{ display: "block", padding: 8, borderRadius: 10, background: t.surface, border: `1px solid ${t.line}` }}>
                  <span style={{ display: "block", width: "48%", height: 10, borderRadius: 4, background: t.text }} />
                  <span style={{ display: "flex", gap: 3, marginTop: 8 }}>
                    <span style={{ flex: 1.3, height: 5, borderRadius: 3, background: t.accent }} />
                    <span style={{ flex: 1, height: 5, borderRadius: 3, background: t.accentLine }} />
                    <span style={{ flex: 0.8, height: 5, borderRadius: 3, background: t.raised }} />
                  </span>
                  <span style={{ display: "flex", gap: 3, marginTop: 6 }}>
                    <span style={{ height: 6, width: 22, borderRadius: 99, background: t.shortfall, opacity: 0.85 }} />
                    <span style={{ height: 6, width: 18, borderRadius: 99, background: t.fits, opacity: 0.85 }} />
                  </span>
                </span>
                <span style={{ display: "block", marginTop: 8, height: 16, borderRadius: 7, background: t.accent }} />
                {on && (
                  <span style={{ position: "absolute", top: -7, right: -7, width: 22, height: 22, borderRadius: 99, background: C.accent, color: C.onAccent, display: "grid", placeItems: "center", fontSize: 12, fontWeight: 800, boxShadow: "var(--shadow)" }}>✓</span>
                )}
              </span>
              <span style={{ fontSize: 12.5, fontWeight: on ? 650 : 550, color: on ? C.text : C.dim, lineHeight: 1.3, paddingLeft: 2 }}>{p.name}</span>
            </Tap>
          );
        })}
      </div>
    </div>
  );
}

function Settings({ theme, onTheme, palette, onPalette, pace, onSavePace, wd, we, onOpenTime, account, onSignIn, onSignOut, onReset }) {
  const [reset, setReset] = useState(false);
  const [outArm, setOutArm] = useState(false);
  const signedIn = !!(account && !account.isAnonymous && account.email);
  const label = { marginTop: SP.section };
  return (
    <div style={{ padding: PAGE_PAD, maxWidth: 720 }}>
      <Header title="Settings" sub="How the app looks, and what new subjects start with" />

      <SectionLabel>Appearance</SectionLabel>
      <ThemeCard value={theme} onChange={onTheme} palette={palette} onPalette={onPalette} />

      <SectionLabel style={label}>Study defaults</SectionLabel>
      <PaceCard value={pace} onCommit={onSavePace} />
      <Tap
        className="focus-ring card"
        onClick={onOpenTime}
        style={{ width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 18, padding: "16px 20px", color: C.text }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 600 }}>Study time</span>
          <span style={{ display: "block", fontSize: 13, color: C.dim, marginTop: 3 }}>
            {fmtH(wd)} on school days · {fmtH(we)} on weekend days · specific days
          </span>
        </span>
        <span aria-hidden="true" style={{ color: C.dim, fontSize: 18 }}>›</span>
      </Tap>

      {account !== undefined && (
        <>
          <SectionLabel style={label}>Account</SectionLabel>
          <div className="rise card" style={{ ...card }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{signedIn ? "Signed in" : "Not signed in"}</div>
            <div style={{ fontSize: 13, color: C.dim, marginTop: 3, lineHeight: 1.5, overflowWrap: "anywhere" }}>
              {signedIn
                ? <>As <span style={{ color: C.text }}>{account.email}</span>. Your plan syncs to every device you sign in on.</>
                : "Your plan is tied to this device. Make an account to keep it if you switch phones or clear your browser."}
            </div>
            {signedIn ? (
              <Tap
                className="focus-ring"
                onClick={() => (outArm ? onSignOut() : setOutArm(true))}
                onPointerLeave={() => setOutArm(false)}
                style={{
                  marginTop: 14, width: "100%",
                  background: outArm ? C.amber : C.cardHi, color: outArm ? C.onAccent : C.text,
                  border: `1px solid ${outArm ? C.amber : C.line}`, padding: "13px 0", borderRadius: 14,
                  fontSize: 14.5, fontWeight: 600, transition: "background .25s cubic-bezier(.32,.72,0,1), color .25s cubic-bezier(.32,.72,0,1)",
                }}
              >
                {outArm ? "Tap again to sign out" : "Sign out"}
              </Tap>
            ) : (
              <Tap
                className="focus-ring"
                onClick={onSignIn}
                style={{ marginTop: 14, width: "100%", background: C.cardHi, color: C.text, border: `1px solid ${C.line}`, padding: "13px 0", borderRadius: 14, fontSize: 14.5, fontWeight: 600 }}
              >
                Sign in or create account
              </Tap>
            )}
          </div>
        </>
      )}

      <SectionLabel style={label}>Data</SectionLabel>
      <Tap
        onClick={() => (reset ? onReset() : setReset(true))}
        onPointerLeave={() => setReset(false)}
        style={{
          width: "100%", background: reset ? C.accent : "transparent",
          border: `1px solid ${reset ? C.accent : C.line}`,
          color: reset ? C.onAccent : C.dim, padding: "14px 0", borderRadius: 16,
          fontSize: 14.5, fontWeight: 600, transition: "background .25s cubic-bezier(.32,.72,0,1), color .25s cubic-bezier(.32,.72,0,1)",
        }}
      >
        {reset ? "Tap again to erase everything" : "Start over"}
      </Tap>
      <div style={{ fontSize: 12.5, color: C.dim, textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>
        Clears every subject and your study time, and returns to the welcome screen.
      </div>
    </div>
  );
}

/* ----------------------------- TIMER TAB ----------------------------- */
/* The Timer tab with no session yet: choose what to study, most urgent first */
/* The Timer tab before there's anything to time: subjects are chosen on the timer itself */
function TimerPicker({ onAdd, onImport }) {
  return (
    <div style={{ padding: PAGE_PAD }}>
      <Header title="Timer" sub="Time a study session; it's added to your hours when you say so" />
      <EmptyState title="No subjects to study yet" text="Add your exams, then pick one on the timer to time a session against it." onAdd={onAdd} onImport={onImport} />
    </div>
  );
}

/* --------------------------- SUBJECTS --------------------------- */
const dateChip = {
  display: "inline-block", fontSize: 12.5, fontWeight: 650, color: C.text, lineHeight: 1.3,
  background: C.raised, border: `1px solid ${C.lineHi}`, borderRadius: 99, padding: "2px 9px",
};

/* A subject's name; when another subject has the same name, its exam
   date sits right beside it so the two can be told apart. */
function SubjectName({ s }) {
  return (
    <span style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, fontSize: 15, fontWeight: 600 }}>
      {s.name}
      {s.sameName && <span style={dateChip}>{fmtDate(s.date)}</span>}
    </span>
  );
}

/* Subjects whose exam is over: kept out of every calculation, shown dim,
   with a way to clear them out or move the date. */
function PassedList({ passed, onUpdate, onRemove }) {
  const [arm, setArm] = useState(null);
  if (!passed.length) return null;
  return (
    <div style={{ marginTop: SP.section }}>
      <SectionLabel>Exam passed</SectionLabel>
      <CardGrid>
        {passed.map((s) => (
          <div key={s.id} className="rise" style={{ ...card, background: "transparent", borderStyle: "dashed", borderColor: C.lineHi }}>
            <div style={{ color: C.dim }}>
              <SubjectName s={s} />
              <div style={{ fontSize: 13, marginTop: 4 }}>Exam passed — {fmtDate(s.date)}</div>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <Tap className="focus-ring" onClick={() => onUpdate(s)} style={{ flex: 1, background: C.raised, color: C.text, border: `1px solid ${C.line}`, padding: "10px 0", borderRadius: 12, fontSize: 13.5, fontWeight: 600 }}>
                Update date
              </Tap>
              <Tap
                className="focus-ring"
                onClick={() => (arm === s.id ? onRemove(s) : setArm(s.id))}
                onPointerLeave={() => setArm(null)}
                style={{ flex: 1, background: arm === s.id ? C.accent : "transparent", color: arm === s.id ? C.onAccent : C.dim, border: `1px solid ${arm === s.id ? C.accent : C.line}`, padding: "10px 0", borderRadius: 12, fontSize: 13.5, fontWeight: 600 }}
              >
                {arm === s.id ? "Tap again to remove" : "Remove"}
              </Tap>
            </div>
          </div>
        ))}
      </CardGrid>
    </div>
  );
}

function SyncChip({ sync }) {
  const map = {
    cloud:   { dot: C.info, text: "Synced to cloud" },
    saving:  { dot: C.amber, text: "Saving\u2026" },
    offline: { dot: C.amber, text: "Offline \u2014 will sync later" },
    local:   { dot: C.dim,   text: "Saved on this device" },
  };
  const m = map[sync] ?? map.local;
  return (
    <div
      className="rise"
      style={{
        display: "inline-flex", alignItems: "center", gap: 7,
        background: C.card, border: `1px solid ${C.line}`,
        borderRadius: 99, padding: "6px 12px", marginBottom: 18,
      }}
    >
      <div style={{ width: 6, height: 6, borderRadius: 99, background: m.dot, transition: "background .3s cubic-bezier(.32,.72,0,1)" }} />
      <span style={{ fontSize: 12, color: C.dim, fontWeight: 550 }}>{m.text}</span>
    </div>
  );
}

function Subjects({ data, passed, passedActions, onOpen, onAdd, onImport, onSample, sync }) {
  const desktop = useIsDesktop();
  return (
    <div style={{ padding: PAGE_PAD }}>
      <Header title="Subjects" sub={`${data.length} exam${data.length === 1 ? "" : "s"} ahead`} />
      <SyncChip sync={sync} />
      {data.length === 0 && passed.length === 0 && (
        <div className="rise card" style={hero("accent")}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.5 }}>Get started</div>
          <div style={{ color: C.dim, fontSize: 14.5, lineHeight: 1.6, marginTop: 10 }}>
            Add your first exam and the app works out whether you actually have the hours for it.
            You'll need the exam date, how many chapters are left, and how well you know it.
          </div>
          <Tap
            onClick={onAdd}
            style={{ width: "100%", marginTop: 20, background: C.accent, color: C.onAccent, padding: "16px 0", borderRadius: 14, fontSize: 16, fontWeight: 650 }}
          >
            Add your first subject
          </Tap>
          <Tap
            onClick={onImport}
            style={{ width: "100%", marginTop: 10, background: C.surface, border: `1px solid ${C.line}`, color: C.text, padding: "14px 0", borderRadius: 14, fontSize: 14.5, fontWeight: 600 }}
          >
            Import portions
          </Tap>
          <Tap
            onClick={onSample}
            style={{ width: "100%", marginTop: 10, background: "transparent", border: `1px solid ${C.line}`, color: C.dim, padding: "14px 0", borderRadius: 14, fontSize: 14, fontWeight: 600 }}
          >
            Load sample subjects instead
          </Tap>
        </div>
      )}
      {data.length > 0 && <SectionLabel>Exams</SectionLabel>}
      <CardGrid>
        {data.map((s, i) => {
          const isShort = s.gap < -0.5;
          const chPct = s.chapters ? (s.doneCount / s.chapters) * 100 : 0;
          const needs = s.perDay != null && s.needed > 0;
          return (
            <Tap
              key={s.id}
              className="card focus-ring"
              onClick={() => onOpen(s.id)}
              style={{ ...tile(desktop), width: "100%", textAlign: "left", color: C.text, display: "flex", flexDirection: "column", animation: `rise .5s ${EASE} ${0.05 * i}s both` }}
            >
              <span style={{ display: "flex", flexDirection: desktop ? "column" : "row", justifyContent: "space-between", alignItems: desktop ? "stretch" : "flex-start", gap: desktop ? 0 : 12 }}>
                <span style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
                  <span style={{ fontSize: 16, fontWeight: 650, lineHeight: 1.25, overflowWrap: "break-word" }}>{s.name}</span>
                  <span style={{ fontSize: 12.5, color: C.dim, marginTop: 3 }}>exam {fmtDate(s.date)} · {s.windowDays} study day{s.windowDays === 1 ? "" : "s"}</span>
                </span>
                <span style={{ display: "flex", flexDirection: desktop ? "row" : "column", alignItems: desktop ? "baseline" : "flex-end", gap: desktop ? 6 : 2, marginTop: desktop ? 12 : 0, flexShrink: 0 }}>
                  <span style={{ ...bigNum(desktop ? 34 : 30), color: needs && s.perDay > s.havePerDay ? C.shortfall : C.text }}>{needs ? fmtH(s.perDay) : "0h"}</span>
                  <span style={{ fontSize: 12.5, color: C.dim }}>a day</span>
                </span>
              </span>
              <span style={{ alignSelf: "flex-start", marginTop: 10, fontSize: 12, fontWeight: 650, color: isShort ? C.shortfall : C.fits, background: isShort ? "var(--wash-shortfall)" : "var(--wash-fits)", border: `1px solid ${C.line}`, borderRadius: 99, padding: "3px 9px" }}>
                {isShort ? `${fmtH(-s.gap)} short` : `${fmtH(Math.max(0, s.gap))} spare`}
              </span>
              <span style={{ flex: 1, minHeight: 14 }} />
              {miniBar(chPct)}
              <span style={{ fontSize: 11.5, color: C.dim, marginTop: 7, lineHeight: 1.4 }}>
                {s.doneCount}/{s.chapters} chapters{s.syl ? ` · ~${fmtMarks(s.marksLeft)} marks left` : ""}
              </span>
            </Tap>
          );
        })}
      </CardGrid>
      <PassedList passed={passed} {...passedActions} />
      {(data.length > 0 || passed.length > 0) && (
        <>
          <div style={{ display: "flex", gap: 10, marginTop: SP.group }}>
            <Tap className="focus-ring" onClick={onAdd} style={{ flex: 1, background: C.surface, border: `1.5px dashed ${C.lineHi}`, color: C.text, padding: "16px 0", borderRadius: 18, fontSize: 15, fontWeight: 600 }}>
              + Add a subject
            </Tap>
            <Tap className="focus-ring" onClick={onImport} style={{ flex: 1, background: C.surface, border: `1.5px dashed ${C.lineHi}`, color: C.text, padding: "16px 0", borderRadius: 18, fontSize: 15, fontWeight: 600 }}>
              Import portions
            </Tap>
          </div>
          <div style={{ fontSize: 13, color: C.dim, textAlign: "center", marginTop: 12 }}>
            {desktop ? "Click" : "Tap"} a subject to set chapter difficulty, rename chapters, or remove it.
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------- EMPTY AND LOADING ------------------------- */
function EmptyState({ title, text, onAdd, onImport }) {
  return (
    <div className="rise card" style={{ ...hero("accent"), marginBottom: SP.section }}>
      <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.5 }}>{title}</div>
      <div style={{ color: C.dim, fontSize: 14.5, lineHeight: 1.6, marginTop: 10 }}>{text}</div>
      {onAdd && (
        <Tap onClick={onAdd} style={{ width: "100%", marginTop: 20, background: C.accent, color: C.onAccent, padding: "15px 0", borderRadius: 14, fontSize: 15.5, fontWeight: 650 }}>
          Add a subject
        </Tap>
      )}
      {onImport && (
        <Tap onClick={onImport} style={{ width: "100%", marginTop: 10, background: C.surface, border: `1px solid ${C.line}`, color: C.text, padding: "13px 0", borderRadius: 14, fontSize: 14.5, fontWeight: 600 }}>
          Import portions
        </Tap>
      )}
    </div>
  );
}

/* the shape of a screen, while the saved plan loads */
function Skeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Loading your plan" style={{ padding: PAGE_PAD }}>
      <div className="skel" style={{ width: 150, height: 34, borderRadius: 10 }} />
      <div className="skel" style={{ width: 210, height: 15, borderRadius: 8, marginTop: 12 }} />
      <div className="skel" style={{ height: 168, borderRadius: 22, marginTop: SP.section }} />
      {[0, 1, 2].map((i) => (
        <div key={i} className="skel" style={{ height: 84, borderRadius: 18, marginTop: SP.group, opacity: 1 - i * 0.22 }} />
      ))}
    </div>
  );
}

/* ------------------------------ TODAY ------------------------------ */

/* A progress ring: the app's widgets use it for "how much of it is done/covered" */
function Ring({ pct, size = 76, stroke = 7, color = C.accent, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, pct || 0));
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ display: "block", transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} style={{ stroke: C.raised }} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - p / 100)}
          style={{ stroke: color, transition: `stroke-dashoffset .9s ${EASE}` }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", fontFamily: DISPLAY, fontWeight: 650, fontSize: size * 0.2, color: C.text, letterSpacing: "-0.02em" }}>
        {children}
      </div>
    </div>
  );
}

/* the widget tile every dashboard is built from */
const tile = (desktop) => ({ ...card, borderRadius: 22, padding: desktop ? 20 : 16, boxSizing: "border-box", minWidth: 0 });
const tileLabel = { fontSize: 12.5, fontWeight: 550, color: C.dim, lineHeight: 1.3 };
const bigNum = (size) => ({ fontFamily: DISPLAY, fontSize: size, fontWeight: 650, letterSpacing: "-0.04em", lineHeight: 1, fontVariantNumeric: "tabular-nums" });
const miniBar = (pct, color = C.accent) => (
  <div style={{ height: 5, borderRadius: 99, background: C.raised, overflow: "hidden" }}>
    <div style={{ width: `${Math.max(0, Math.min(100, pct))}%`, height: "100%", borderRadius: 99, background: color, transition: `width .8s ${EASE}` }} />
  </div>
);

function Today({ day, upcoming, data, passed, session, onStart, onResume, onOpen, onTime, onPlan, onReality, shortH, spareH, onAdd, onImport }) {
  const desktop = useIsDesktop();
  const next = day.rows.find((r) => r.left > 1e-6);
  const listed = day.rows.filter((r) => r.planned > 1e-6 || r.done > 1e-6);
  const resting = day.rows.filter((r) => r.planned <= 1e-6 && r.done <= 1e-6);
  const count = day.rows.filter((r) => r.left > 1e-6).length;
  const n = useCountUp(day.left);
  // done for today: the plan is covered, or nothing was needed and time was logged anyway
  const complete = day.met || (day.planned <= 1e-6 && day.done > 1e-6);
  const now = new Date();
  const byId = Object.fromEntries(data.map((x) => [x.id, x]));
  const soonest = data.reduce((a, b) => (!a || toDate(b.date) < toDate(a.date) ? b : a), null);
  const soonDays = soonest ? daysUntil(soonest.date) : null;
  const donePct = day.progress * 100;
  const isShort = shortH > 0.5;

  const line = { fontSize: 15, fontWeight: 500, marginTop: 10, lineHeight: 1.45 };
  const sub = { fontSize: 13.5, color: C.dim, marginTop: 6, lineHeight: 1.5 };
  const startBtn = { width: "100%", marginTop: 18, background: C.accent, color: C.onAccent, padding: "15px 12px", borderRadius: 15, fontSize: 15.5, fontWeight: 650 };
  const grid = { display: "grid", gridTemplateColumns: desktop ? "repeat(4, minmax(0, 1fr))" : "repeat(2, minmax(0, 1fr))", gap: desktop ? 16 : 10, alignItems: "stretch" };
  /* the small tiles fill the space beside the big one; the Reality tile then
     takes whatever is left of its row, so the grid never has a hole */
  const smallTiles = listed.length + (soonest ? 1 : 0);
  const left = smallTiles <= 4 ? 4 - smallTiles : (4 - ((smallTiles - 4) % 4)) % 4;
  const realitySpan = desktop ? (left === 0 ? "1 / -1" : `span ${smallTiles <= 4 ? Math.min(2, left) : left}`) : "1 / -1";
  const nextSpan = !desktop && smallTiles % 2 === 1 ? "1 / -1" : undefined;

  return (
    <div style={{ padding: PAGE_PAD }}>
      <Header kicker={now.toLocaleDateString("en-IN", { weekday: "long" })} title={now.toLocaleDateString("en-IN", { day: "numeric", month: "long" })} />

      {data.length === 0 ? (
        <EmptyState
          title={passed.length ? "No exams ahead" : "Nothing planned yet"}
          text="Add your exams and this shows how many hours to study today, and which subject to start with."
          onAdd={onAdd} onImport={onImport}
        />
      ) : (
        <>
          <div style={grid}>
            {/* today: the one number, its progress, and the way in */}
            <div className="rise card" style={{ ...tile(desktop), gridColumn: desktop ? "span 2" : "1 / -1", gridRow: desktop ? "span 2" : undefined, display: "flex", flexDirection: "column", padding: desktop ? 26 : 18 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={tileLabel}>Today</div>
                  {complete ? (
                    <div style={{ ...bigNum(desktop ? 64 : 50), marginTop: 6, color: C.fits }}>Done</div>
                  ) : (
                    <div style={{ ...bigNum(desktop ? 64 : 50), marginTop: 6 }} aria-label={`${fmtH(day.left)} to study today`}>{fmtH(n)}</div>
                  )}
                </div>
                <Ring pct={donePct} size={desktop ? 96 : 74} stroke={desktop ? 8 : 7} color={complete || day.left <= 1e-6 ? C.fits : C.accent}>
                  {complete ? (
                    <span style={{ display: "block", fontSize: desktop ? 17 : 15 }}>Done</span>
                  ) : (
                    <span style={{ display: "block" }}>{Math.round(donePct)}%<span style={{ display: "block", fontFamily: FONT, fontSize: desktop ? 10.5 : 9.5, fontWeight: 550, color: C.dim, letterSpacing: 0, marginTop: 2 }}>done</span></span>
                  )}
                </Ring>
              </div>
              {day.capacity <= 0 ? (
                <>
                  <div style={line}>No study time set for today.</div>
                  <div style={sub}>
                    Today has 0 hours on the{" "}
                    <Tap className="focus-ring" onClick={onTime} style={{ background: "none", padding: 0, color: C.accentText, fontWeight: 600, fontSize: "inherit" }}>Time</Tap>
                    {" "}tab. Change it there if you're studying today.
                  </div>
                </>
              ) : day.planned <= 1e-6 ? (
                <>
                  <div style={line}>{day.done > 1e-6 ? `${fmtH(day.done)} logged today.` : "Nothing needed today."}</div>
                  <div style={sub}>Every subject is covered by the hours you've already put in.</div>
                </>
              ) : complete ? (
                <>
                  <div style={line}>{fmtH(day.done)} logged today.</div>
                  <div style={sub}>Today's plan was {fmtH(day.planned)}, so it's covered.</div>
                </>
              ) : (
                <>
                  <div style={line}>left to study today{count > 1 ? `, across ${count} subjects` : ""}, of {fmtH(day.planned)} planned.</div>
                  {day.done > 1e-6 && (
                    <div style={sub}>
                      {fmtH(day.done)} logged so far.
                      {day.done > day.planned - day.left + 0.05 && " Time past one subject's share doesn't count towards another's."}
                    </div>
                  )}
                </>
              )}
              <div style={{ flex: 1 }} />
              {session ? (
                <Tap className="focus-ring" onClick={onResume} style={startBtn}>Back to the timer</Tap>
              ) : next ? (
                <Tap className="focus-ring" onClick={() => onStart(next.id)} style={startBtn}>Start with {next.name}</Tap>
              ) : null}
            </div>

            {/* each subject today, in order of priority */}
            {listed.map((r, i) => {
              const s = byId[r.id];
              const chPct = s?.chapters ? (s.doneCount / s.chapters) * 100 : 0;
              const finished = r.left <= 1e-6;
              return (
                <Tap
                  key={r.id}
                  className="card focus-ring"
                  aria-label={`${r.name}: ${finished ? "done for today" : `${fmtH(r.left)} today`}, priority ${i + 1}`}
                  onClick={() => onOpen(r.id)}
                  style={{ ...tile(desktop), width: "100%", textAlign: "left", color: C.text, display: "flex", flexDirection: "column", animation: `rise .5s ${EASE} ${0.05 * (i + 1)}s both` }}
                >
                  <span style={{ ...tileLabel, overflowWrap: "break-word", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{r.name}</span>
                  {finished ? (
                    <span style={{ ...bigNum(desktop ? 30 : 26), marginTop: 8, color: C.fits }}>Done</span>
                  ) : (
                    <span style={{ ...bigNum(desktop ? 34 : 30), marginTop: 8 }}>{fmtH(r.left)}</span>
                  )}
                  <span style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>
                    <b style={{ fontWeight: 700, color: C.text }}>#{i + 1}</b> · {finished ? "for today" : "today"}{r.done > 1e-6 && !finished ? ` · ${fmtH(r.done)} logged` : ""}
                  </span>
                  <span style={{ flex: 1, minHeight: 12 }} />
                  {miniBar(chPct)}
                  <span style={{ fontSize: 11.5, color: C.dim, marginTop: 7 }}>
                    {s ? `${s.doneCount}/${s.chapters} chapters` : ""}{s?.sameName ? ` · ${fmtDate(r.date)}` : ` · exam ${fmtDate(r.date)}`}
                  </span>
                </Tap>
              );
            })}

            {/* the nearest exam */}
            {soonest && (
              <Tap
                className="card focus-ring"
                onClick={() => onOpen(soonest.id)}
                style={{ ...tile(desktop), width: "100%", textAlign: "left", color: C.text, display: "flex", flexDirection: "column", gridColumn: nextSpan, animation: `rise .5s ${EASE} .2s both` }}
              >
                <span style={tileLabel}>Next exam</span>
                <span style={{ ...bigNum(desktop ? 34 : 30), marginTop: 8 }}>{soonDays === 0 ? "Today" : soonDays}</span>
                <span style={{ fontSize: 12, color: C.dim, marginTop: 4, lineHeight: 1.4 }}>
                  {soonDays === 0 ? "" : `day${soonDays === 1 ? "" : "s"} · `}{soonest.name}
                </span>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11.5, color: C.dim, marginTop: 10 }}>{fmtDate(soonest.date)}</span>
              </Tap>
            )}

            {/* where it all lands */}
            <Tap
              className="card focus-ring"
              onClick={onReality}
              style={{ ...tile(desktop), width: "100%", textAlign: "left", color: C.text, gridColumn: realitySpan, display: "flex", alignItems: "center", gap: 14, animation: `rise .5s ${EASE} .25s both` }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ ...tileLabel, display: "block" }}>Reality check</span>
                <span style={{ ...bigNum(desktop ? 30 : 26), display: "block", marginTop: 8, color: isShort ? C.shortfall : C.fits }}>
                  {isShort ? `${fmtH(shortH)} short` : "It all fits"}
                </span>
                <span style={{ display: "block", fontSize: 12.5, color: C.dim, marginTop: 5 }}>
                  {isShort ? `across ${data.length} exam${data.length === 1 ? "" : "s"}` : `${fmtH(spareH)} to spare across ${data.length} exam${data.length === 1 ? "" : "s"}`}
                </span>
              </span>
              <span aria-hidden="true" style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 44, flexShrink: 0 }}>
                {riskOrder(data).slice(0, 5).map((x) => {
                  const m = Math.max(...data.map((y) => Math.abs(y.gap)), 1);
                  return <span key={x.id} title={x.name} style={{ width: 8, borderRadius: 4, height: `${Math.max(14, (Math.abs(x.gap) / m) * 100)}%`, background: x.gap < -0.5 ? C.shortfall : C.fits, opacity: 0.85 }} />;
                })}
              </span>
              <span aria-hidden="true" style={{ color: C.dim, fontSize: 20, flexShrink: 0 }}>›</span>
            </Tap>
          </div>

          {resting.length > 0 && (
            <div style={{ fontSize: 13, color: C.dim, marginTop: 14, lineHeight: 1.5 }}>
              Nothing needed today for {resting.map((r) => r.name).join(", ")}.
            </div>
          )}
          <NextDays days={upcoming} desktop={desktop} onOpen={onOpen} />

          {day.capacity > 0 && (
            <div style={{ fontSize: 12.5, color: C.dim, marginTop: 14, lineHeight: 1.55 }}>
              From the day-by-day plan: {day.planned < day.capacity - 0.05
                ? <>you have {fmtH(day.capacity)} of study time today and your subjects need {fmtH(day.planned)} of it, shared by how much each needs per day before its exam.</>
                : <>today's {fmtH(day.capacity)} are shared between your subjects by how much each needs per day before its exam.</>}
            </div>
          )}
          <Tap
            className="focus-ring"
            onClick={onPlan}
            style={{ width: "100%", marginTop: SP.group, background: C.surface, border: `1px solid ${C.line}`, color: C.text, padding: "14px 0", borderRadius: 16, fontSize: 15, fontWeight: 600 }}
          >
            See the full plan ›
          </Tap>
        </>
      )}
    </div>
  );
}

/* The next three days at a glance, from the same day-by-day plan */
function NextDays({ days, desktop, onOpen }) {
  if (!days?.length) return null;
  return (
    <>
      <SectionLabel style={{ marginTop: SP.section }}>Next 3 days</SectionLabel>
      <CardGrid>
        {days.map((d, i) => {
          const max = Math.max(...d.rows.map((r) => r.h), 1e-6);
          return (
            <div key={key(d.date)} className="card" data-day={key(d.date)} style={{ ...tile(desktop), display: "flex", flexDirection: "column", animation: `rise .5s ${EASE} ${0.3 + 0.05 * i}s both` }}>
              <span style={tileLabel}>{i === 0 ? "Tomorrow" : d.date.toLocaleDateString("en-IN", { weekday: "long" })} · {fmtDate(d.date)}</span>
              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 8 }}>
                <span style={bigNum(desktop ? 30 : 26)}>{fmtH(d.planned)}</span>
                <span style={{ fontSize: 12.5, color: C.dim }}>{d.capacity > 0 ? `of ${fmtH(d.capacity)} free` : "no study time set"}</span>
              </div>
              {d.exams.length > 0 && (
                <div style={{ fontSize: 12.5, fontWeight: 650, color: C.accentText, marginTop: 6 }}>Exam: {d.exams.join(", ")}</div>
              )}
              <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 9 }}>
                {d.rows.length === 0 && <div style={{ fontSize: 13, color: C.dim }}>{d.capacity > 0 ? "Nothing needed." : "A day off."}</div>}
                {d.rows.map((r) => (
                  <Tap key={r.id} className="focus-ring" onClick={() => onOpen(r.id)} aria-label={`${r.name}: ${fmtH(r.h)}`}
                    style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", color: C.text, padding: 0 }}>
                    <span style={{ display: "flex", justifyContent: "space-between", gap: 10, fontSize: 13.5 }}>
                      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</span>
                      <span style={{ flexShrink: 0, color: C.dim, fontVariantNumeric: "tabular-nums" }}>{fmtH(r.h)}</span>
                    </span>
                    <span aria-hidden="true" style={{ display: "block", height: 5, marginTop: 5, borderRadius: 99, background: C.raised }}>
                      <span style={{ display: "block", height: "100%", width: `${(r.h / max) * 100}%`, borderRadius: 99, background: C.accent, opacity: 0.8 }} />
                    </span>
                  </Tap>
                ))}
              </div>
            </div>
          );
        })}
      </CardGrid>
    </>
  );
}

/* ---------------------------- REALITY ---------------------------- */
/* A subject's verdict in words: what the eye should land on */
const VERDICT_COLOR = { short: C.shortfall, tight: C.accentText, fits: C.fits };
function verdictText(s, v) {
  if (v.kind === "short") return `Short by ${fmtH(v.hours)} — you can't finish this at your current pace`;
  if (v.kind === "tight") return `Tight — only ${fmtH(v.hours)} spare`;
  if (s.needed <= 1e-6) return `Comfortable — nothing left to study, ${fmtH(v.hours)} spare`;
  return `Comfortable — ${fmtH(v.hours)} spare after you finish this subject`;
}

/* The arithmetic behind one subject's two bars, with its own numbers */
function HowWorkedOut({ s, today }) {
  const [open, setOpen] = useState(false);
  const f = s.factor.factor;
  const base = s.remaining ? s.raw / (f * s.pm) : 0;
  const each = s.remaining ? base / s.remaining : 0;
  const pace = PACE.find((p) => Math.abs(p.mult - s.pm) < 1e-9)?.label ?? "Steady";
  // the same figure the Today screen shows: today's share, fixed for the day
  const todayShare = today?.rows.find((r) => r.id === s.id)?.planned ?? 0;
  const todayHours = today?.capacity ?? 0;
  const row = (label, value, opts = {}) => (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "5px 0", fontWeight: opts.bold ? 650 : 400, color: opts.bold ? C.text : undefined, borderTop: opts.bold ? `1px solid ${C.line}` : "none", marginTop: opts.bold ? 4 : 0, paddingTop: opts.bold ? 8 : 5 }}>
      <span style={{ minWidth: 0 }}>{label}</span>
      {value != null && <span style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums", color: C.text }}>{value}</span>}
    </div>
  );
  const note = (text) => <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.5, margin: "0 0 4px" }}>{text}</div>;
  const head = (text) => <div style={{ fontSize: 11, fontWeight: 650, letterSpacing: ".08em", textTransform: "uppercase", color: C.dim, margin: "14px 0 4px" }}>{text}</div>;

  return (
    <div style={{ borderTop: `1px solid ${C.line}`, marginTop: 14 }}>
      <Tap
        className="focus-ring"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        style={{ width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center", background: "transparent", color: C.text, padding: "12px 0 2px", fontSize: 14, fontWeight: 600, textAlign: "left" }}
      >
        How is this worked out?
        <span aria-hidden="true" style={{ color: C.dim, fontSize: 18, transform: open ? "rotate(90deg)" : "none", transition: `transform .25s ${EASE}` }}>›</span>
      </Tap>
      {open && (
        <div className="rise" style={{ fontSize: 13.5, color: C.dim, lineHeight: 1.45, paddingBottom: 4 }}>
          {head("Hours this subject needs")}
          {s.remaining === 0 ? row("Every chapter is done", fmtH(0), { bold: true }) : (
            <>
              {row(`${s.remaining} chapter${s.remaining === 1 ? "" : "s"} left × about ${fmtH(each)} each`, fmtH(base))}
              {note(s.syl
                ? "Each chapter starts from its own estimate, from its NCERT questions and examples, adjusted for the difficulty you set."
                : `A ${s.meta.label.toLowerCase()} chapter is ${fmtH(s.meta.base)} at medium difficulty; harder ones count for more, easier ones for less.`)}
              {row(`× ${f.toFixed(2)} for how ready you are`)}
              {note(s.factor.overconfident
                ? `Your last score of ${s.lastScore}% decides this on its own (×${s.factor.fromScore.toFixed(2)}), because it disagrees with a confidence of ${s.confidence}/5.`
                : `Confidence ${s.confidence}/5 gives ×${s.factor.fromConfidence.toFixed(2)} and your last score of ${s.lastScore}% gives ×${s.factor.fromScore.toFixed(2)}; the score counts for 60%.`)}
              {row(`× ${s.pm.toFixed(2)} for your pace (${pace})`)}
              {row("= work in this subject", fmtH(s.raw))}
              {s.logged > 0 && row("− hours you've already logged", `−${fmtH(s.logged)}`)}
              {row("Hours this subject needs", fmtH(s.needed), { bold: true })}
            </>
          )}

          {head("Hours you'll have before this exam")}
          {note(`${s.studyDays} study day${s.studyDays === 1 ? "" : "s"} from today to the exam on ${fmtDate(s.date)}, holding ${fmtH(s.windowHours)} in all.`)}
          {note("Every day's hours are shared between the subjects whose exams are still ahead, each in proportion to its work per day, before any hours you've logged come off. A nearer exam, or more work, pulls harder. So logging hours lowers what a subject needs, not what it has.")}
          {row("Its share of those days", fmtH(s.allocated))}
          {todayShare > 1e-6 && note(`Today's plan gives it ${fmtH(todayShare)} of your ${fmtH(todayHours)}.`)}
          {s.recovered > 0.05 && row("+ hours its days have left that it can still use", `+${fmtH(s.recovered)}`)}
          {s.spareShare > 0.05 && row("+ its share of hours no subject needed", `+${fmtH(s.spareShare)}`)}
          {row("Hours you'll have before this exam", fmtH(s.available), { bold: true })}

          {head("So")}
          {row(`${fmtH(s.available)} − ${fmtH(s.needed)}`, `${s.gap >= 0 ? "+" : "−"}${fmtH(Math.abs(s.gap))}`)}
        </div>
      )}
    </div>
  );
}

function Reality({ data, passed, passedActions, totalShort, totalSpare, today, onSetLog, onAdd, onImport, onOpen, onTime }) {
  const desktop = useIsDesktop();
  const short = -totalShort;
  const isShort = short > 0.5;
  const [go, setGo] = useState(false);
  useEffect(() => { const t = setTimeout(() => setGo(true), 120); return () => clearTimeout(t); }, []);
  const flagged = data.filter((s) => s.overconfident);
  const ranked = riskOrder(data);
  const action = isShort ? shortfallAction(data) : null;
  const first = action?.subject;
  const actionBtn = { marginTop: 14, background: C.surface, border: `1px solid ${C.line}`, color: C.text, padding: "12px 18px", borderRadius: 12, fontSize: 14, fontWeight: 600 };

  return (
    <div style={{ padding: PAGE_PAD }}>
      <Header title="Reality check" sub="Where the numbers actually land" />

      {data.length === 0 && (
        <EmptyState
          title={passed.length ? "No exams ahead" : "Nothing to check yet"}
          text="Add your exams and this shows whether the hours you have cover the work each one needs."
          onAdd={onAdd} onImport={onImport}
        />
      )}

      {data.length > 0 && (
        <div className="rise card" style={{ ...hero(isShort ? "shortfall" : "fits"), marginBottom: SP.section }}>
          {isShort ? (
            <>
              <div role="status">
                <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "0 10px" }}>
                  <span style={{ ...bigNum(desktop ? 68 : 56), color: C.shortfall }}>{fmtH(short)}</span>
                  <span style={{ fontFamily: DISPLAY, fontSize: desktop ? 24 : 21, fontWeight: 600, color: C.dim, letterSpacing: "-0.02em" }}>short overall</span>
                </div>
                <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: "-0.015em", lineHeight: 1.35, marginTop: 12 }}>
                  {first.name} is the one that breaks first.
                </div>
              </div>
              <div style={{ fontSize: 15, marginTop: 14, lineHeight: 1.55 }}>
                {action.kind === "hours" && <>Add about <b style={{ fontWeight: 650 }}>{fmtH(action.perDay)} a day</b> until its exam on {fmtDate(first.date)} and it fits.</>}
                {action.kind === "target" && <>Lower your target for {first.name}: its page shows the fastest way to the marks you need, and what that leaves out.</>}
                {action.kind === "cut" && <>Cut about <b style={{ fontWeight: 650 }}>{action.chapters} chapter{action.chapters === 1 ? "" : "s"}</b> from {first.name}, the ones least likely to come up, or it won't be finished by {fmtDate(first.date)}.</>}
              </div>
              {action.kind === "hours"
                ? <Tap className="focus-ring" onClick={onTime} style={actionBtn}>Change study time</Tap>
                : <Tap className="focus-ring" onClick={() => onOpen(first.id)} style={actionBtn}>Open {first.name}</Tap>}
            </>
          ) : (
            <>
              <div role="status">
                <div style={{ ...bigNum(desktop ? 56 : 46), color: C.fits }}>It all fits</div>
                <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: "-0.015em", lineHeight: 1.35, marginTop: 12 }}>
                  Everything fits, with <span style={{ color: C.fits }}>{fmtH(totalSpare)} to spare</span>.
                </div>
              </div>
              <div style={{ fontSize: 15, marginTop: 12, lineHeight: 1.55 }}>Spare hours are what absorbs a bad week.</div>
            </>
          )}
          <div style={{ fontSize: 12.5, color: C.dim, marginTop: 16, lineHeight: 1.5, paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
            Every day's hours are shared between the subjects whose exams are still ahead,
            weighted by each one's work. Logging hours lowers what a subject needs, not what it has. No hour is counted twice.
          </div>
        </div>
      )}

      {data.length > 1 && (
        <div className="rise card" style={{ ...card, borderRadius: 22, marginBottom: SP.section, animationDelay: ".08s" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, fontWeight: 650, letterSpacing: ".1em", textTransform: "uppercase", color: C.dim, marginBottom: 6 }}>
            <span>◂ Short</span><span>At a glance</span><span>Spare ▸</span>
          </div>
          {ranked.map((s) => {
            const m = Math.max(...ranked.map((x) => Math.abs(x.gap)), 1);
            const w = (Math.abs(s.gap) / m) * 50;
            const sh = s.gap < -0.5;
            return (
              <Tap key={s.id} className="focus-ring" onClick={() => onOpen(s.id)} aria-label={`${s.name}: ${sh ? `${fmtH(-s.gap)} short` : `${fmtH(Math.max(0, s.gap))} spare`}`}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", color: C.text, padding: "10px 0", borderTop: `1px solid ${C.line}` }}>
                <span style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, fontSize: 14, fontWeight: 600 }}>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
                  <span style={{ flexShrink: 0, fontVariantNumeric: "tabular-nums", color: sh ? C.shortfall : C.fits }}>{s.gap >= 0 ? "+" : "−"}{fmtH(Math.abs(s.gap))}</span>
                </span>
                <span aria-hidden="true" style={{ position: "relative", display: "block", height: 10, marginTop: 8, borderRadius: 99, background: C.raised }}>
                  <span style={{ position: "absolute", top: 0, bottom: 0, borderRadius: 99, background: sh ? C.shortfall : C.fits, ...(sh ? { right: "50%" } : { left: "50%" }), width: go ? `${Math.max(1.5, w)}%` : 0, transition: `width .9s ${EASE}` }} />
                  <span style={{ position: "absolute", left: "50%", top: -4, bottom: -4, width: 2, marginLeft: -1, borderRadius: 2, background: C.text, opacity: 0.45 }} />
                </span>
              </Tap>
            );
          })}
        </div>
      )}

      {data.length > 0 && <SectionLabel>By subject, most at risk first</SectionLabel>}
      <CardGrid align="start">
        {ranked.map((s, i) => {
          const max = Math.max(s.needed, s.available) || 1;
          const v = verdictOf(s);
          const col = VERDICT_COLOR[v.kind];
          return (
            <div className="card" key={s.id} data-subject={s.name} style={{ ...card, animation: `rise .5s ${EASE} ${0.08 * i + 0.1}s both` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 16 }}>
                <div style={{ minWidth: 0 }}>
                  <SubjectName s={s} />
                  <div style={{ fontSize: 12.5, color: C.dim, marginTop: 4 }}>
                    {key(s.windowStart) === key(new Date()) ? "Today" : fmtDate(s.windowStart)} – {fmtDate(s.date)} · {s.windowDays} study day{s.windowDays === 1 ? "" : "s"}
                  </div>
                </div>
                <span style={{ flexShrink: 0, fontSize: 12.5, fontWeight: 650, color: v.kind === "short" ? C.shortfall : C.dim, background: C.raised, border: `1px solid ${C.line}`, borderRadius: 99, padding: "3px 9px", fontVariantNumeric: "tabular-nums" }}>
                  {s.gap >= 0 ? "+" : "−"}{fmtH(Math.abs(s.gap))}
                </span>
              </div>
              <Bar label="Hours you'll have before this exam" hours={s.available} pct={go ? (s.available / max) * 100 : 0} color={C.lineHi} delay={0.1 * i} />
              <Bar label="Hours this subject needs" hours={s.needed} pct={go ? (s.needed / max) * 100 : 0} color={v.kind === "short" ? C.shortfall : C.fits} delay={0.1 * i + 0.08} />
              <div data-verdict={v.kind} style={{ fontSize: 16, fontWeight: 650, lineHeight: 1.4, color: col, marginTop: 4 }}>
                {verdictText(s, v)}
              </div>
              <HowWorkedOut s={s} today={today} />
              <HoursSlider s={s} onCommit={onSetLog} />
            </div>
          );
        })}
      </CardGrid>

      {flagged.length > 0 && <div style={{ height: SP.group }} />}
      {flagged.map((s) => (
        <div key={s.id} className="rise" style={{ ...notice, marginBottom: SP.group, fontSize: 14, lineHeight: 1.55, animationDelay: ".35s" }}>
          You rated <b style={{ color: C.accentText }}>{s.name}</b> easy, but your last score was {s.lastScore}%. Confidence and marks disagree — that gap is usually where results get lost.
        </div>
      ))}

      <PassedList passed={passed} {...passedActions} />
    </div>
  );
}

function Bar({ label, hours, pct, color, delay }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.dim, marginBottom: 7 }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: "tabular-nums", color: C.text }}>{fmtH(hours)}</span>
      </div>
      <div style={{ height: 8, background: C.raised, borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 99, transition: `width 1s cubic-bezier(.32,.72,0,1) ${delay}s` }} />
      </div>
    </div>
  );
}

/* ------------------------------ PLAN ------------------------------ */
function urgencyTag(s) {
  const u = urgencyOf(s);
  if (s.havePerDay == null) return s.needed > 0 ? { label: "At risk", color: C.red } : { label: "Comfortable", color: C.green };
  if (u > s.havePerDay) return { label: "At risk", color: C.red };
  if (u > s.havePerDay * 0.6) return { label: "Tight", color: C.accentText };
  return { label: "Comfortable", color: C.green };
}

/* Which subject first (rankByUrgency, plan.js), with whether you're on pace as its first line */
function SubjectOrder({ data }) {
  const ranked = rankByUrgency(data);
  const behind = data.filter((s) => s.behind > 0);
  return (
    <div className="rise card" style={{ ...card, marginBottom: SP.group }}>
      <div role="status" style={{ fontSize: 13.5, lineHeight: 1.5, paddingBottom: 12, marginBottom: 12, borderBottom: `1px solid ${C.line}` }}>
        {behind.length ? (
          <>
            <b style={{ color: C.accentText, fontWeight: 650 }}>Behind pace:</b>{" "}
            {behind.map((s) => `${s.name} by ${s.behind} chapter${s.behind === 1 ? "" : "s"}`).join(", ")}.
          </>
        ) : (
          <><b style={{ color: C.fits, fontWeight: 650 }}>On pace.</b> Every subject is where it should be for today.</>
        )}
      </div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>Do these in this order</div>
      <ol style={{ listStyle: "none", margin: "10px 0 0", padding: 0 }}>
        {ranked.map((s, k) => {
          const tag = urgencyTag(s);
          return (
            <li key={s.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: k ? `1px solid ${C.line}` : "none" }}>
              <span style={{ width: 18, flexShrink: 0, color: C.dim, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{k + 1}</span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <SubjectName s={s} />
                <span style={{ display: "block", fontSize: 12.5, color: C.dim, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                  {s.perDay != null ? `${fmtH(s.perDay)} a day` : "no study days left"} · exam {fmtDate(s.date)}
                </span>
              </span>
              <span style={{ flexShrink: 0, fontSize: 12, fontWeight: 650, color: tag.color, background: C.raised, border: `1px solid ${C.line}`, borderRadius: 99, padding: "4px 10px" }}>
                {tag.label}
              </span>
            </li>
          );
        })}
      </ol>
      <div style={{ fontSize: 12.5, color: C.dim, marginTop: 10, paddingTop: 12, borderTop: `1px solid ${C.line}`, lineHeight: 1.5 }}>
        Ordered by how much each subject needs per day against the days it has left. The ones at the top will slip first if you fall behind.
        Pace compares the chapters you've ticked with an even spread from the day you added each subject to its exam.
      </div>
    </div>
  );
}

function Plan({ data, onAdd, onImport, onBack, backLabel }) {
  const [open, setOpen] = useState(data[0]?.id ?? null);
  const split = useSplit();

  const phases = (
    <>
      {data.length > 0 && <SectionLabel>Phases</SectionLabel>}
      {data.map((s, i) => {
        const isOpen = open === s.id;
        const days = s.windowDays;
        const segs = s.phases;

        return (
          <div className="card" key={s.id} style={{ ...card, padding: 0, marginBottom: SP.group, overflow: "hidden", animation: `rise .5s cubic-bezier(.32,.72,0,1) ${0.06 * i}s both` }}>
            <Tap onClick={() => setOpen(isOpen ? null : s.id)} style={{ width: "100%", background: "transparent", color: C.text, padding: SP.card, textAlign: "left" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <SubjectName s={s} />
                  <div style={{ fontSize: 13, color: s.behind > 0 ? C.accentText : C.dim, marginTop: 4 }}>
                    {s.behind > 0 ? `${s.behind} chapter${s.behind === 1 ? "" : "s"} behind pace` : "On pace"}
                    <span style={{ color: C.dim }}> · {fmtDate(s.windowStart)}–{fmtDate(s.date)} · {fmtH(s.available)}</span>
                  </div>
                </div>
                <div style={{ color: C.dim, fontSize: 18, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .3s cubic-bezier(.32,.72,0,1)" }}>›</div>
              </div>
              <div style={{ display: "flex", gap: 3, marginTop: 16 }}>
                {segs.map((g, k) => (
                  <div key={k} style={{ flex: g.pct, height: 6, borderRadius: 99, background: PHASE_COLORS[k] }} />
                ))}
              </div>
            </Tap>
            <div style={{ maxHeight: isOpen ? 430 : 0, opacity: isOpen ? 1 : 0, transition: "max-height .42s cubic-bezier(.32,.72,0,1), opacity .3s cubic-bezier(.32,.72,0,1)", overflow: "hidden" }}>
              <div style={{ padding: "4px 20px 20px" }}>
                {segs.map((g, k) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: `1px solid ${C.line}` }}>
                    <div style={{ width: 8, height: 8, borderRadius: 99, background: PHASE_COLORS[k] }} />
                    <div style={{ flex: 1, fontSize: 15, fontWeight: 550, color: g.days === 0 ? C.dim : C.text }}>{g.name}</div>
                    {g.days === 0 ? (
                      <div style={{ fontSize: 13, color: C.dim, fontStyle: "italic" }}>No room</div>
                    ) : (
                      <div style={{ fontSize: 13, color: C.dim, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                        {fmtDate(g.from)}{g.days > 1 ? ` – ${fmtDate(g.to)}` : ""}
                        <div style={{ fontSize: 11.5 }}>{fmtH(g.hours)} · {g.days}d</div>
                      </div>
                    )}
                  </div>
                ))}
                {s.squeezed > 0 && (
                  <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12, marginTop: 4, marginBottom: 4, fontSize: 13, color: C.accentText, lineHeight: 1.5 }}>
                    Only {s.windowDays} study day{s.windowDays === 1 ? "" : "s"} before this exam, so there
                    isn't room for every phase. The time goes to the phases closest to the exam.
                  </div>
                )}
                {s.priority.filter((c) => c.d === 3).length > 0 && (
                  <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12, marginTop: 4 }}>
                    <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 8 }}>Hardest chapters left — start here</div>
                    {s.priority.filter((c) => c.d === 3).map((c) => (
                      <div key={c.i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0" }}>
                        <div style={{ width: 6, height: 6, borderRadius: 99, background: C.accent }} />
                        <div style={{ flex: 1, fontSize: 14 }}>{c.name}</div>
                        <div style={{ fontSize: 12.5, color: C.dim, fontVariantNumeric: "tabular-nums" }}>{fmtH(c.cost)}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </>
  );

  return (
    <div style={{ padding: PAGE_PAD }}>
      {onBack && <BackLink label={backLabel} onClick={onBack} />}
      <Header title="Plan" sub="Phases sized to how each subject behaves" />
      {data.length === 0 ? (
        <EmptyState
          title="Nothing to plan yet"
          text="Add your exams and this lays out what to do first, and when to learn, practise and revise each subject."
          onAdd={onAdd} onImport={onImport}
        />
      ) : split ? (
        <Split main={phases} side={<SubjectOrder data={data} />} />
      ) : (
        <>
          <SubjectOrder data={data} />
          <div style={{ height: SP.section - SP.group }} />
          {phases}
        </>
      )}
    </div>
  );
}

/* ----------------------------- DETAIL ----------------------------- */
function Detail({ s, onBack, onToggle, onRemove, onPatch, onEdit, onStudy, studying, flash, setOverlay }) {
  const [editing, setEditing] = useState(false);
  // the editor's chapters; each row remembers its saved chapter (chapters.js)
  const [rows, setRows] = useState([]);
  const [confirm, setConfirm] = useState(false);
  const [orderFor, setOrderFor] = useState(null);   // chapter index whose exercise order is open
  const split = useSplit();

  useEffect(() => {
    if (s) setRows(rowsFromSubject(s));
  }, [s?.id, s?.chapters]);

  useEffect(() => { setOverlay(editing || orderFor != null); return () => setOverlay(false); }, [editing, orderFor]);

  if (!s) {
    return (
      <div style={{ padding: PAGE_PAD }}>
        <Tap onClick={onBack} style={{ background: "transparent", color: C.accentText, padding: 0, fontSize: 16, marginBottom: 22, fontWeight: 500 }}>
          ‹ Subjects
        </Tap>
        <EmptyState title="This subject isn't here any more" text="It may have been removed, or its exam has passed. Your other subjects are on the Subjects tab." />
      </div>
    );
  }
  const pct = s.chapters ? (s.doneCount / s.chapters) * 100 : 0;
  const maxCost = Math.max(0, ...(s.costs ?? []).filter((c, j) => !s.done?.[j] && Number.isFinite(c)));

  /* Fastest way to the target score. Chapters left off this subject when it
     was added count as covered (the picker asks for what's still to do). */
  const target = s.target ?? 75;
  const plan = s.syl
    ? planForTarget(
        s.syl.chapters.map((c) => {
          const i = s.refs?.indexOf(c.id) ?? -1;
          return { id: c.id, marks: c.marksEst, hours: i >= 0 ? s.costs[i] : 0, needs: c.needs, secured: i < 0 || !!s.done[i] };
        }),
        (s.syl.totalMarks * target) / 100,
      )
    : s.chapterMarks
      ? planForTarget(
          // ids are chapter positions; marks are each chapter's weighted share of 100
          s.chapterMarks.map((m, i) => ({ id: i, marks: m, hours: s.costs[i], needs: [], secured: !!s.done[i] })),
          target,
        )
      : null;
  /* What PlanCard needs to name and price a chapter, whichever kind of plan it is */
  const planSrc = s.syl
    ? {
        total: s.syl.totalMarks,
        nameOf: (id) => s.syl.byId[id].name,
        marksOf: (id) => s.syl.byId[id].marksEst,
        hoursOf: (id) => { const i = s.refs?.indexOf(id) ?? -1; return i >= 0 ? s.costs[i] : 0; },
        note: "Chapter marks come from CBSE's last two sample papers, so treat this as a guide.",
      }
    : {
        total: 100,
        nameOf: (i) => s.names?.[i] || `Chapter ${i + 1}`,
        marksOf: (i) => s.chapterMarks[i],
        hoursOf: (i) => s.costs[i],
        note: "Chapter marks are a 100-mark paper split by the weightage you set, so treat this as a guide.",
      };
  const leftOut = s.syl ? s.syl.chapters.filter((c) => !(s.refs ?? []).includes(c.id)).length : 0;
  const planPerDay = plan ? dailyNeed(plan.hours - (s.logged ?? 0), s.studyDays) : null;
  const orderCh = orderFor != null ? s.syl?.byId[s.refs?.[orderFor]] : null;

  const resize = (n) => setRows((r) => resizeRows(r, n));
  const editRow = (k, changes) => setRows((r) => r.map((x) => (x.key === k ? { ...x, ...changes } : x)));
  // syllabus chapters get their marks from sample papers; everything else is weighted by hand
  const weighable = !s.syl;

  const commit = () => {
    // ticks, syllabus links and weightage follow each chapter, wherever rows were removed
    onPatch(s.id, applyRows(s, rows, { weighable }));
    setEditing(false);
    flash("Changes confirmed");
  };

  /* the numbers about this subject, and its chapters; side by side on a wide screen */
  const numbers = (
    <>
      <div className="rise card" style={{ ...card, borderRadius: 22, marginBottom: SP.group }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: 14, marginBottom: 10 }}>
          <span style={{ color: C.dim }}>Chapters done</span>
          <span style={{ fontFamily: DISPLAY, fontSize: 20, fontWeight: 650, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{s.doneCount} / {s.chapters}</span>
        </div>
        {miniBar(pct)}
        {[
          ["Hours left", fmtH(s.needed)],
          ["An average chapter", `~${fmtH(s.perChapter)}`],
          ...(s.logged > 0 ? [["Logged so far", fmtH(s.logged)]] : []),
        ].map(([k, v]) => (
          <div key={k} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, padding: "11px 0 0", marginTop: 11, borderTop: `1px solid ${C.line}`, fontSize: 14 }}>
            <span style={{ color: C.dim }}>{k}</span>
            <span style={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{v}</span>
          </div>
        ))}
        <div style={{ fontSize: 12.5, color: C.dim, marginTop: 12, lineHeight: 1.5 }}>
          At your pace, an average remaining chapter here is worth about {fmtH(s.perChapter)} — hard ones cost more, easy ones less.
          {s.logged > 0 && ` You've also logged ${fmtH(s.logged)} here.`}
        </div>
      </div>

      {s.chapters === 0 && (
        <div className="rise card" style={{ ...card, marginBottom: SP.group, animationDelay: ".05s" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>No chapters yet</div>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 6, lineHeight: 1.5 }}>
            Add them with Edit chapters to see how many hours this subject needs.
          </div>
        </div>
      )}

      {s.chapters > 0 && s.perDay != null && s.needed <= 0 && (
        <div className="rise card" style={{ ...hero("fits"), marginBottom: SP.group, animationDelay: ".05s" }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.5, color: C.fits }}>
            {s.remaining === 0 ? "Nothing left — all chapters done" : "Nothing left — your logged hours cover the rest"}
          </div>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 8, lineHeight: 1.5 }}>
            Keep it fresh with revision until {fmtDate(s.date)}.
          </div>
        </div>
      )}

      {s.perDay != null && s.needed > 0 && (
        <div className="rise card" style={{ ...hero(s.perDay > s.havePerDay ? "shortfall" : "accent"), marginBottom: SP.group, animationDelay: ".05s" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 14 }}>
            <div style={{ minWidth: 0 }}>
              <div style={tileLabel}>Each day</div>
              <div style={{ ...bigNum(56), marginTop: 6, color: s.perDay > s.havePerDay ? C.shortfall : C.text }}>
                {fmtH(s.perDay)}
              </div>
              <div style={{ fontSize: 14, color: C.dim, marginTop: 8, lineHeight: 1.45 }}>
                to finish what's left by {fmtDate(s.date)}
              </div>
            </div>
            <Ring pct={s.needed > 0 ? (s.available / s.needed) * 100 : 100} size={82} stroke={7} color={s.available >= s.needed ? C.fits : C.accent}>
              <span style={{ display: "block" }}>{Math.min(999, Math.round(s.needed > 0 ? (s.available / s.needed) * 100 : 100))}%<span style={{ display: "block", fontFamily: FONT, fontSize: 9.5, fontWeight: 550, color: C.dim, letterSpacing: 0, marginTop: 2 }}>covered</span></span>
            </Ring>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginTop: 16, fontSize: 14 }}>
            <span style={{ color: C.dim }}>Your study day, all subjects</span>
            <span style={{ fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{fmtH(s.havePerDay)}</span>
          </div>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.line}`, lineHeight: 1.55 }}>
            {fmtH(s.needed)} left over {s.studyDays} study day{s.studyDays === 1 ? "" : "s"}.{" "}
            <span style={{ color: C.text, fontWeight: 600 }}>Hours multiplier ×{s.factor.factor.toFixed(2)}</span>
            {s.factor.overconfident
              ? <> — your {s.lastScore}% score decides it on its own (×{s.factor.fromScore.toFixed(2)}), because it disagrees with a confidence of {s.confidence}/5.</>
              : <> — from confidence {s.confidence}/5 (×{s.factor.fromConfidence.toFixed(2)}) and last score {s.lastScore}% (×{s.factor.fromScore.toFixed(2)}), with the score counting 60%.</>}
          </div>
        </div>
      )}

      {s.syl && (
        <div className="rise card" style={{ ...card, marginBottom: SP.group, animationDelay: ".1s" }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{s.syl.title}</div>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>{s.syl.board} {s.syl.session} · {s.syl.totalMarks}-mark paper</div>
          <div style={{ fontSize: 14, marginTop: 12, lineHeight: 1.5 }}>
            These chapters are worth about <b style={{ fontWeight: 650 }}>{fmtMarks(s.marks)}</b> of {s.syl.totalMarks} marks
            {s.marksLeft < s.marks - 0.01 && <>, and <b style={{ fontWeight: 650, color: C.accentText }}>{fmtMarks(s.marksLeft)}</b> of that is still to do</>}.
          </div>
          <div style={{ fontSize: 12, color: C.dim, marginTop: 10, lineHeight: 1.5 }}>
            Unit marks are official. CBSE doesn't set marks per chapter, so each chapter's share comes from
            CBSE's 2025-26 and 2026-27 sample papers. Question counts are every numbered NCERT exercise question.
          </div>
        </div>
      )}

      {plan && (
        <PlanCard
          s={s}
          plan={plan}
          src={planSrc}
          target={target}
          perDay={planPerDay}
          leftOut={leftOut}
          onTarget={(v) => onPatch(s.id, { target: v })}
        />
      )}
    </>
  );

  const chapterList = (
    <>
      <SectionLabel>Chapters</SectionLabel>
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <Tap onClick={() => onEdit(s)} style={{ flex: 1, background: C.surface, border: `1px solid ${C.line}`, color: C.text, padding: "14px 0", borderRadius: 14, fontSize: 14, fontWeight: 600 }}>
          Edit details
        </Tap>
        <Tap onClick={() => setEditing(!editing)} style={{ flex: 1, background: editing ? C.accent : C.surface, border: `1px solid ${editing ? C.amber : C.line}`, color: editing ? C.onAccent : C.text, padding: "14px 0", borderRadius: 14, fontSize: 14, fontWeight: 600 }}>
          {editing ? "Editing chapters" : "Edit chapters"}
        </Tap>
      </div>

      {editing && (
        <div className="rise" style={{ background: C.surface, border: `1px solid ${C.accent}`, borderRadius: 18, padding: "14px 18px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Number of chapters</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>
              Mark how hard each one is{weighable && ", and how many marks it carries"}
            </div>
            {weighable && <div style={{ fontSize: 12, color: C.dim, marginTop: 6, lineHeight: 1.45 }}>{WEIGHT_EXPLAINER}</div>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Tap onClick={() => resize(rows.length - 1)} style={smallBtn}>−</Tap>
            <div style={{ fontSize: 18, fontWeight: 700, width: 34, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{rows.length}</div>
            <Tap onClick={() => resize(rows.length + 1)} style={smallBtn}>+</Tap>
          </div>
        </div>
      )}

      {editing && rows.map((r, i) => (
          <div key={r.key} data-row={i} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 22, textAlign: "center", color: C.dim, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{i + 1}</div>
              <input
                value={r.name}
                placeholder={`Chapter ${i + 1}`}
                aria-label={`Chapter ${i + 1} name`}
                onChange={(e) => editRow(r.key, { name: e.target.value })}
                style={{ ...inputStyle, padding: "10px 12px", fontSize: 15 }}
              />
              <Tap
                className="focus-ring"
                disabled={rows.length === 1}
                aria-label={`Remove ${r.name || `chapter ${i + 1}`}`}
                onClick={() => setRows((x) => removeRow(x, r.key))}
                style={{ width: 30, height: 30, flexShrink: 0, borderRadius: 9, background: "transparent", color: C.dim, fontSize: 18, lineHeight: 1, padding: 0 }}
              >
                ×
              </Tap>
            </div>
            <span style={{ ...tinyLabel, marginTop: 8, paddingLeft: 32 }}>{DIFF_QUESTION}</span>
            <div style={{ display: "flex", gap: 6, paddingLeft: 32 }}>
              {DIFF.map((dd) => {
                const on = r.diff === dd.v;
                return (
                  <Tap
                    key={dd.v}
                    onClick={() => editRow(r.key, { diff: dd.v })}
                    style={{
                      flex: 1, ...choice(on),
                      borderRadius: 9, padding: "7px 0", fontSize: 12, fontWeight: 650,
                    }}
                  >
                    {dd.label}
                  </Tap>
                );
              })}
            </div>
            {weighable && (
              <div style={{ marginTop: 8, paddingLeft: 32 }}>
                <span style={tinyLabel}>{WEIGHT_QUESTION}</span>
                <div style={{ display: "flex" }}>
                <WeightPicker
                  value={r.weight ?? DEFAULT_WEIGHT}
                  onChange={(v) => editRow(r.key, { weight: v })}
                />
                </div>
              </div>
            )}
          </div>
      ))}

      {!editing && (s.names ?? []).map((nm, i) => (() => {
          const ch = s.syl?.byId[s.refs?.[i]];
          const wm = !ch ? s.chapterMarks?.[i] : null;
          return (
            <div key={i} style={{ position: "relative", marginBottom: 8 }}>
              <Tap
                onClick={() => onToggle(s.id, i)}
                style={{ width: "100%", textAlign: "left", background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: ch ? "14px 16px 18px" : "14px 16px", display: "flex", alignItems: ch ? "flex-start" : "center", gap: 13, color: C.text }}
              >
                <div style={{ width: 22, height: 22, borderRadius: 99, border: `1.5px solid ${s.done[i] ? C.accent : C.lineHi}`, background: s.done[i] ? C.accent : "transparent", color: C.onAccent, fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .25s cubic-bezier(.32,.72,0,1)", flexShrink: 0 }}>
                  {s.done[i] ? "✓" : ""}
                </div>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 15, color: s.done[i] ? C.dim : C.text, textDecoration: s.done[i] ? "line-through" : "none" }}>
                    {nm || `Chapter ${i + 1}`}
                  </span>
                  {ch && (
                    <span style={{ display: "block", fontSize: 12, color: C.dim, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                      Ch {ch.no} · {ch.questions} questions · ~{fmtMarks(ch.marksEst)} marks
                    </span>
                  )}
                  {!s.done[i] && maxCost > 0 && (
                    <span aria-hidden="true" style={{ display: "block", height: 4, marginTop: 8, borderRadius: 99, background: C.raised, overflow: "hidden" }}>
                      <span style={{ display: "block", height: "100%", borderRadius: 99, width: `${Math.max(3, ((s.costs?.[i] ?? 0) / maxCost) * 100)}%`, background: diffMeta(s.diffs?.[i] ?? 2).v === 3 ? C.accent : C.lineHi }} />
                    </span>
                  )}
                  {wm != null && (
                    <span style={{ display: "block", marginTop: 6 }}>
                      {!s.done[i] && (
                        <span title="Difficulty" style={chip(diffMeta(s.diffs?.[i] ?? 2).color)}>{diffMeta(s.diffs?.[i] ?? 2).label}</span>
                      )}
                      <span title="Weightage" style={chip(C.text)}>~{fmtMarks(wm)} marks</span>
                    </span>
                  )}
                </span>
                {/* the right column keeps its width even when done, so the order button never covers text */}
                <span style={{ flexShrink: 0, minWidth: ch ? 74 : 0, textAlign: "right" }}>
                  {!s.done[i] && (wm != null ? (
                    // difficulty is already a chip under the name
                    <span style={{ fontSize: 12, color: C.dim, fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>
                      {fmtH(s.costs?.[i] ?? s.baseChapter * diffMult(s.diffs?.[i] ?? 2))}
                    </span>
                  ) : (
                    <span style={{ fontSize: 12, color: diffMeta(s.diffs?.[i] ?? 2).color, fontWeight: 600 }}>
                      {diffMeta(s.diffs?.[i] ?? 2).label} · {fmtH(s.costs?.[i] ?? s.baseChapter * diffMult(s.diffs?.[i] ?? 2))}
                    </span>
                  ))}
                </span>
              </Tap>
              {ch && (
                <Tap
                  className="focus-ring"
                  aria-label={`Exercise order for ${ch.name}`}
                  title="Which exercise to do first"
                  onClick={() => setOrderFor(i)}
                  style={{ position: "absolute", right: 10, bottom: 9, width: 28, height: 28, borderRadius: 9, background: C.cardHi, border: `1px solid ${C.line}`, color: C.dim, display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}
                >
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M10 6h10M10 12h10M10 18h10" />
                    <path d="M4 6h1M4 12h1M4 18h1" strokeWidth="2.6" />
                  </svg>
                </Tap>
              )}
            </div>
          );
        })())
      }

      {orderCh && (
        <ExerciseSheet
          ch={orderCh}
          scale={s.costs[orderFor] / orderCh.hours.total}
          multiplier={s.factor.factor}
          onClose={() => setOrderFor(null)}
        />
      )}

      {!editing && (
        <Tap
          onClick={() => (confirm ? onRemove(s.id) : setConfirm(true))}
          onPointerLeave={() => setConfirm(false)}
          style={{ width: "100%", marginTop: 22, background: confirm ? C.accent : "transparent", border: `1px solid ${C.accent}`, color: confirm ? C.onAccent : C.accentText, padding: "15px 0", borderRadius: 16, fontSize: 15, fontWeight: 600, transition: "background .25s cubic-bezier(.32,.72,0,1), color .25s cubic-bezier(.32,.72,0,1)" }}
        >
          {confirm ? "Tap again to remove" : "Remove subject"}
        </Tap>
      )}
    </>
  );

  return (
    <div style={{ padding: PAGE_PAD }}>
      <Tap onClick={onBack} style={{ background: "transparent", color: C.accentText, padding: 0, fontSize: 16, marginBottom: 22, fontWeight: 500 }}>
        ‹ Subjects
      </Tap>

      <div style={{ color: C.dim, fontSize: 14, fontWeight: 500, marginBottom: 2 }}>
        Exam {fmtDate(s.date)} · {s.windowDays} study day{s.windowDays === 1 ? "" : "s"} · {s.meta.label}-heavy
      </div>
      <h1 style={{ fontFamily: DISPLAY, fontSize: 34, fontWeight: 650, letterSpacing: "-0.035em", lineHeight: 1.1, margin: 0 }}>
        {s.name}
        {s.sameName && <span style={{ ...dateChip, fontSize: 15, verticalAlign: "middle", marginLeft: 10 }}>{fmtDate(s.date)}</span>}
      </h1>
      <Tap
        className="focus-ring"
        onClick={() => onStudy(s.id)}
        style={{ marginTop: 18, background: C.accent, color: C.onAccent, padding: "13px 22px", borderRadius: 14, fontSize: 15, fontWeight: 650 }}
      >
        {studying ? "Back to the timer" : "Start a study session"}
      </Tap>

      <div style={{ height: 24 }} />
      {split ? (
        <Split main={chapterList} side={numbers} />
      ) : (
        <>
          {numbers}
          <div style={{ height: SP.section - SP.group }} />
          {chapterList}
        </>
      )}

      <div style={{ height: editing ? 104 : 0 }} />
      {editing && (
        <SaveBar
          label="Save chapters"
          onSave={commit}
          onCancel={() => { setRows(rowsFromSubject(s)); setEditing(false); }}
        />
      )}
    </div>
  );
}

/* ---------------------------- FASTEST PLAN ---------------------------- */
function PlanCard({ s, plan, src, target, perDay, leftOut, onTarget }) {
  const { total, nameOf, marksOf, hoursOf, note } = src;
  const goal = (total * target) / 100;
  const saved = plan.skipped.reduce((t, id) => t + hoursOf(id), 0);
  const skippedMarks = plan.skipped.reduce((t, id) => t + marksOf(id), 0);
  const accuracy = Math.round(plan.secureRate * 100);
  // hours already logged on this subject come off, as they do in the per-day figure
  const logged = s.logged ?? 0;
  const hoursLeft = Math.max(0, plan.hours - logged);
  const hoursAll = Math.max(0, plan.hours + saved - logged);
  const expectPct = Math.round((plan.expectedMarks / total) * 100);

  return (
    <div className="rise card" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 18, padding: 20, marginBottom: 16, animationDelay: ".15s" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div>
          <div style={{ fontSize: 15, fontWeight: 600 }}>Fastest way to {target}%</div>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>{fmtMarks(goal)} of {total} marks</div>
        </div>
        <div role="group" aria-label="Target score" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Tap className="focus-ring" aria-label="Lower the target" disabled={target <= 50} onClick={() => onTarget(target - 5)} style={smallBtn}>−</Tap>
          <div aria-live="polite" style={{ fontSize: 16, fontWeight: 700, width: 42, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{target}%</div>
          <Tap className="focus-ring" aria-label="Raise the target" disabled={target >= 95} onClick={() => onTarget(target + 5)} style={smallBtn}>+</Tap>
        </div>
      </div>

      {plan.order.length === 0 ? (
        <div style={{ fontSize: 14, marginTop: 14, lineHeight: 1.5 }}>
          What you've covered is already enough for {target}%. Keep it fresh with revision.
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 10, marginTop: 16 }}>
            <div style={{ flex: 1, background: C.cardHi, borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.8, color: C.accentText, fontVariantNumeric: "tabular-nums" }}>{fmtH(hoursLeft)}</div>
              <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>
                {plan.skipped.length ? `instead of ${fmtH(hoursAll)}` : "every chapter left"}
                {logged > 0 && `, after ${fmtH(logged)} already logged`}
              </div>
            </div>
            <div style={{ flex: 1, background: C.cardHi, borderRadius: 14, padding: "12px 14px" }}>
              <div style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.8, color: perDay != null && perDay > s.havePerDay ? C.red : C.text, fontVariantNumeric: "tabular-nums" }}>
                {perDay != null ? fmtH(perDay) : "—"}
              </div>
              <div style={{ fontSize: 12, color: C.dim, marginTop: 4 }}>a day until {fmtDate(s.date)}</div>
            </div>
          </div>

          <div style={{ fontSize: 12.5, color: C.dim, margin: "16px 0 4px" }}>Study in this order</div>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {plan.order.map((id, k) => (
              <li key={id} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "8px 0", borderTop: k ? `1px solid ${C.line}` : "none" }}>
                <span style={{ width: 18, flexShrink: 0, color: C.dim, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{k + 1}</span>
                <span style={{ flex: 1, minWidth: 0, fontSize: 14, lineHeight: 1.4 }}>
                  {nameOf(id)}
                  {plan.extras.includes(id) && <span style={{ display: "block", color: C.info, fontSize: 12, marginTop: 2 }}>Cheap extra marks: added as safety margin</span>}
                </span>
                <span style={{ flexShrink: 0, fontSize: 12.5, color: C.dim, fontVariantNumeric: "tabular-nums" }}>
                  ~{fmtMarks(marksOf(id))} · {fmtH(hoursOf(id))}
                </span>
              </li>
            ))}
          </ol>

          {plan.skipped.length > 0 && (
            <div style={{ marginTop: 10, background: C.cardHi, borderRadius: 12, padding: "12px 14px", fontSize: 13.5, lineHeight: 1.5 }}>
              <b style={{ fontWeight: 650 }}>Leave for later:</b>{" "}
              {plan.skipped.map(nameOf).join(", ")}. That saves {fmtH(saved)} for about {fmtMarks(skippedMarks)} marks.
            </div>
          )}
        </>
      )}

      {plan.feasible ? (
        <div style={{ fontSize: 12, color: C.dim, marginTop: 12, lineHeight: 1.5 }}>
          Covers about {fmtMarks(plan.coveredMarks)} of {total} marks
          {leftOut > 0 && <>, counting the {leftOut} chapter{leftOut === 1 ? "" : "s"} you left off this subject as done</>}.
          Getting about {accuracy}% of what you prepare right, that's ~{Math.round(plan.expectedMarks)} ({expectPct}%).
          {" "}{note}
        </div>
      ) : (
        <div role="status" style={{ ...notice, marginTop: 12, borderRadius: 12, padding: "12px 14px", fontSize: 13.5, lineHeight: 1.5 }}>
          Even every chapter gets you about {Math.round(plan.expectedMarks)} ({expectPct}%) at {accuracy}% accuracy.
          {" "}{target}% needs better accuracy, not more chapters: more practice questions and full sample papers.
        </div>
      )}
    </div>
  );
}

/* --------------------------- EXERCISE ORDER --------------------------- */
function ExerciseSheet({ ch, scale, multiplier, onClose }) {
  const desktop = useIsDesktop();
  const box = useRef(null);
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });   // always the latest, without re-running the setup below
  useEffect(() => {
    box.current?.focus();   // once, on open — screen readers start at the dialog
    const onKey = (e) => { if (e.key === "Escape") close.current(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const items = ch.exerciseOrder;
  const firstLater = items.findIndex((e) => e.priority === 1);
  const groundworkFor = (e) =>
    items.filter((d) => d.ex !== "Misc" && d.builds.includes(e.ex) && d.priority === e.priority).map((d) => d.ex);
  const tag = (text, color) => (
    <span style={{ display: "inline-block", fontSize: 11.5, fontWeight: 600, color, background: C.raised, border: `1px solid ${C.line}`, borderRadius: 99, padding: "2px 8px", marginRight: 6, marginTop: 6 }}>
      {text}
    </span>
  );

  return (
    <div style={sheetOverlay(desktop, 86)} onClick={onClose}>
      <div
        ref={box}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="exercise-order-title"
        className="sheetbox"
        onClick={(e) => e.stopPropagation()}
        style={{ ...sheetPanel(desktop), padding: desktop ? "16px 28px 28px" : "10px 24px 28px", overflowY: "auto", outline: "none" }}
      >
        <SheetHandle desktop={desktop} />
        <div style={{ fontSize: 13, color: C.accentText, fontWeight: 600 }}>Ch {ch.no} · {ch.name}</div>
        <h2 id="exercise-order-title" style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.6, margin: "8px 0 6px" }}>
          Which exercise first
        </h2>
        <div style={{ fontSize: 14, color: C.dim, lineHeight: 1.5, marginBottom: 18 }}>
          Groundwork first, then the question types CBSE asks most. The Miscellaneous Exercise mixes
          everything, so it goes last.
        </div>

        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((e, k) => {
            const later = firstLater >= 0 && k >= firstLater;
            const feeds = groundworkFor(e);
            return (
              <li key={e.ex}>
                {k === firstLater && k > 0 && (
                  <div style={{ fontSize: 12.5, color: C.dim, margin: "16px 0 8px", paddingTop: 14, borderTop: `1px solid ${C.line}` }}>
                    Short on time? These can wait.
                  </div>
                )}
                <div style={{ display: "flex", gap: 12, background: C.card, border: `1px solid ${k === 0 ? C.accent : C.line}`, borderRadius: 14, padding: "12px 14px", marginBottom: 8, opacity: later ? 0.78 : 1 }}>
                  <div aria-hidden="true" style={{ width: 24, height: 24, borderRadius: 99, flexShrink: 0, background: k === 0 ? C.amber : C.cardHi, color: k === 0 ? C.onAccent : C.dim, fontSize: 12.5, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontVariantNumeric: "tabular-nums" }}>
                    {k + 1}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35 }}>
                      {e.ex === "Misc" ? "Miscellaneous Exercise" : `Exercise ${e.ex}`}
                      <span style={{ color: C.dim, fontWeight: 500 }}> · {e.topic}</span>
                    </div>
                    <div style={{ fontSize: 12, color: C.dim, marginTop: 4, fontVariantNumeric: "tabular-nums" }}>
                      {e.q} question{e.q === 1 ? "" : "s"} · ~{fmtH(exerciseMinutes(ch, e, scale) / 60)} practice
                    </div>
                    <div>
                      {k === 0 && tag("Start here", C.accentText)}
                      {e.scope && tag("Not in CBSE 2026-27 syllabus", C.accentText)}
                      {e.ex !== "Misc" && e.yield === 3 && tag("High yield", C.info)}
                      {e.ex !== "Misc" && e.yield < e.priority && feeds.length > 0 && tag(`Groundwork for ${feeds.join(", ")}`, C.dim)}
                      {e.ex !== "Misc" && e.priority === 1 && !e.scope && tag("Lower yield", C.dim)}
                      {e.ex === "Misc" && tag("Mixed revision", C.dim)}
                    </div>
                  </div>
                </div>
              </li>
            );
          })}
        </ol>

        <div style={{ fontSize: 12, color: C.dim, lineHeight: 1.5, margin: "10px 0 18px" }}>
          High yield: this exercise's question type carried {MODEL.highYieldMarks}+ marks a paper on average in
          CBSE's 2025-26 and 2026-27 sample papers. Times are practice only, at your ×{multiplier.toFixed(2)} multiplier.
        </div>
        <Tap className="focus-ring" onClick={onClose} style={{ width: "100%", background: "transparent", border: `1px solid ${C.line}`, color: C.text, padding: "15px 0", borderRadius: 16, fontSize: 15, fontWeight: 600 }}>
          Got it
        </Tap>
      </div>
    </div>
  );
}

/* ------------------------------ WEIGHTAGE ------------------------------ */
const DIFF_QUESTION = "How hard is this chapter?";
const WEIGHT_QUESTION = "How many marks does this usually carry?";
const WEIGHT_EXPLAINER = "Difficulty is how hard it is for you. Weightage is how much it's worth in the exam. A chapter can be easy and still carry a lot of marks.";
const tinyLabel = { display: "block", fontSize: 11.5, color: C.dim, marginBottom: 5 };
const chip = (color) => ({
  display: "inline-block", fontSize: 11.5, fontWeight: 650, color, lineHeight: 1.3,
  background: C.raised, border: `1px solid ${C.line}`, borderRadius: 99,
  padding: "2px 8px", marginRight: 6, fontVariantNumeric: "tabular-nums",
});

/* High / Medium / Low for one chapter */
function WeightPicker({ value, onChange }) {
  return (
    <div role="group" aria-label={WEIGHT_QUESTION} style={{ display: "flex", gap: 5, flex: 1 }}>
      {WEIGHTS.map((w) => {
        const on = value === w.v;
        return (
          <Tap
            key={w.v}
            className="focus-ring"
            aria-pressed={on}
            onClick={() => onChange(w.v)}
            style={{
              flex: 1, ...choice(on), borderRadius: 8, padding: "5px 0", fontSize: 11.5, fontWeight: 650,
            }}
          >
            {w.label}
          </Tap>
        );
      })}
    </div>
  );
}

/* --------------------------- SUBJECT SHEET --------------------------- */
/* What a subject stores. Everything else on an analysed subject is computed. */
const SUBJECT_KEYS = [
  "id", "name", "date", "createdAt", "chapters", "type", "confidence", "lastScore",
  "pace", "log", "names", "diff", "done", "weight", "syllabus", "refs", "target",
];
const toStored = (o) => Object.fromEntries(SUBJECT_KEYS.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));

const fmtMarks = (m) => (Math.round(m * 2) / 2).toString();
const PASTE = "paste";          // "Chapters from" option: a pasted portions list
const MAX_CHAPTERS = 60;
/* How a subject can be added: step one of the add sheet. null is your own chapters. */
const METHODS = [
  { id: null, title: "Enter manually", sub: "Type the subject, its exam date and how many chapters it has." },
  { id: PASTE, title: "Paste portions text", sub: "Paste a chapter list. Numbering and headings are tidied for you." },
];

const PORTIONS_EXAMPLE = "UNIT I: PHYSICAL CHEMISTRY\n1. Solutions\n2. Electrochemistry\nCh 3 - Chemical Kinetics\n• d and f Block Elements";
const newSubjectId = (name) => name.toLowerCase().replace(/\s+/g, "") + Date.now();

function SubjectSheet({ mode, initial, defaultPace, onClose, onSave }) {
  const desktop = useIsDesktop();
  const blank = () => ({
    name: "", date: key(addDays(new Date(), 14)), chapters: 10,
    type: "theory", confidence: 3, lastScore: 60, pace: defaultPace ?? "steady",
  });
  const [f, setF] = useState(initial ?? blank);
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const lbl = { fontSize: 13, color: C.dim, marginBottom: 8, display: "block" };

  /* source: your own chapters, a pasted portions list, or a syllabus from the engine.
     Adding starts by choosing one (step one); editing goes straight to the form. */
  const [started, setStarted] = useState(mode === "edit");
  const [srcId, setSrcId] = useState(initial?.syllabus ?? null);
  const pasting = srcId === PASTE;
  const syl = srcId && !pasting ? getSyllabus(srcId) : null;

  /* each step starts at the top of the sheet */
  const boxRef = useRef(null);
  useEffect(() => { boxRef.current?.scrollTo?.(0, 0); }, [started, srcId]);

  /* pasted portions: parsed live; × deletes that line from the text itself,
     so the text and the list never disagree */
  const [pasteText, setPasteText] = useState("");
  const [pasteWeight, setPasteWeight] = useState({});   // chapter name (lower case) -> weight
  const parsedAll = pasting ? parsePortions(pasteText) : [];
  const parsed = parsedAll.slice(0, MAX_CHAPTERS);
  const weightOf = (name) => pasteWeight[name.toLowerCase()] ?? DEFAULT_WEIGHT;
  const removeLine = (line) =>
    setPasteText((t) => t.split(/\r?\n/).filter((_, j) => j !== line).join("\n"));
  const [picked, setPicked] = useState(() => {
    if (initial?.syllabus) return new Set((initial.refs ?? []).filter(Boolean));
    return new Set();
  });
  const chooseSource = (id) => {
    setStarted(true);
    setSrcId(id);
    if (!id || id === PASTE) return;
    const s = getSyllabus(id);
    setPicked(new Set(s.chapters.map((c) => c.id)));   // start with everything; untick what's done
    setF((p) => ({ ...p, name: p.name.trim() ? p.name : s.subject, type: "problem" }));
  };
  const toggle = (id) =>
    setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const factor = readinessFactor(f.confidence, f.lastScore);
  const pm = paceMult(f.pace);
  const chosen = syl ? syl.chapters.filter((c) => picked.has(c.id)) : [];
  const chosenHours = chosen.reduce((t, c) => t + c.hours.total, 0) * factor.factor * pm;
  const chosenMarks = chosen.reduce((t, c) => t + c.marksEst, 0);

  const valid = f.name.trim().length > 0 && (!syl || chosen.length > 0) && (!pasting || parsed.length > 0);

  const submitSyllabus = () => {
    const prevRefs = initial?.refs ?? [];
    const prevDiff = initial?.diffs ?? initial?.diff ?? [];
    const rows = chosen.map((c) => {
      const j = prevRefs.indexOf(c.id);   // keep ticks and edits for chapters that stay
      return j >= 0
        ? { ref: c.id, name: initial.names?.[j] || c.name, diff: prevDiff[j] ?? c.diff, done: initial.done?.[j] ?? false }
        : { ref: c.id, name: c.name, diff: c.diff, done: false };
    });
    // chapters you added by hand to a syllabus subject are kept as they are
    (initial?.names ?? []).forEach((nm, j) => {
      if (!prevRefs[j]) rows.push({ ref: null, name: nm, diff: prevDiff[j] ?? 2, done: initial.done?.[j] ?? false });
    });
    const base = mode === "edit"
      ? { ...initial, ...f }
      : { ...f, id: newSubjectId(f.name), createdAt: key(new Date()), log: [] };
    onSave(toStored({
      ...base, type: "problem", syllabus: syl.id, chapters: rows.length,
      refs: rows.map((r) => r.ref), names: rows.map((r) => r.name),
      diff: rows.map((r) => r.diff), done: rows.map((r) => r.done),
    }));
  };

  const submitPaste = () => {
    const n = parsed.length;
    onSave(toStored({
      ...f, chapters: n,
      id: newSubjectId(f.name),
      createdAt: key(new Date()), log: [],
      names: parsed.map((c) => c.name),
      diff: Array(n).fill(2),
      done: Array(n).fill(false),
      weight: parsed.map((c) => weightOf(c.name)),
    }));
  };

  const submit = () => {
    if (syl) { submitSyllabus(); return; }
    if (pasting) { submitPaste(); return; }
    const n = Math.max(1, f.chapters);
    if (mode === "edit") {
      onSave(toStored({
        ...initial, ...f, chapters: n,
        names: Array.from({ length: n }, (_, i) => initial.names?.[i] ?? ""),
        diff: Array.from({ length: n }, (_, i) => initial.diffs?.[i] ?? initial.diff?.[i] ?? 2),
        done: Array.from({ length: n }, (_, i) => initial.done?.[i] ?? false),
        // subjects saved before weightage existed stay without it
        ...(initial.weight ? { weight: Array.from({ length: n }, (_, i) => initial.weight[i] ?? DEFAULT_WEIGHT) } : {}),
      }));
    } else {
      onSave(toStored({
        ...f, chapters: n,
        id: newSubjectId(f.name),
        createdAt: key(new Date()), log: [],
        names: Array(n).fill(""),
        diff: Array(n).fill(2),
        done: Array(n).fill(false),
        weight: Array(n).fill(DEFAULT_WEIGHT),
      }));
    }
  };

  const optionRow = { width: "100%", textAlign: "left", display: "flex", alignItems: "center", gap: 12, background: C.surface, border: `1px solid ${C.line}`, borderRadius: 14, padding: "13px 14px", marginBottom: 8, color: C.text };
  const textLink = { background: "none", color: C.accentText, fontSize: 13, fontWeight: 600, padding: "2px 0", marginBottom: 14, borderRadius: 6 };
  const cancelBtn = { flex: 1, background: "transparent", border: `1px solid ${C.line}`, color: C.dim, padding: "17px 0", borderRadius: 16, fontSize: 15, fontWeight: 600 };
  const chevron = <span aria-hidden="true" style={{ color: C.dim, fontSize: 18 }}>›</span>;
  const changeMethod = (
    <Tap className="focus-ring" onClick={() => setStarted(false)} style={textLink}>
      ‹ Change how you add this
    </Tap>
  );

  return (
    <div style={sheetOverlay(desktop, 80)} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheetbox"
        ref={boxRef}
        style={{ ...sheetPanel(desktop), padding: desktop ? "16px 28px 28px" : "10px 24px 30px", overflowY: "auto" }}
      >
        <SheetHandle desktop={desktop} />
        <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.6, margin: "0 0 22px" }}>
          {mode === "edit" ? "Edit subject" : "Add a subject"}
        </h2>

        {!started ? (
          <>
            <div style={{ fontSize: 16, fontWeight: 650, marginBottom: 12 }}>How do you want to add this?</div>
            {METHODS.map((m) => (
              <Tap key={m.title} className="focus-ring card" onClick={() => chooseSource(m.id)} style={{ ...optionRow, padding: "16px 16px", marginBottom: 10 }}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 16, fontWeight: 650 }}>{m.title}</span>
                  <span style={{ display: "block", fontSize: 13, color: C.dim, marginTop: 3, lineHeight: 1.45 }}>{m.sub}</span>
                </span>
                {chevron}
              </Tap>
            ))}
            <span style={{ ...lbl, marginTop: 18 }}>Pre-loaded syllabus</span>
            {SYLLABI.map((s) => (
              <Tap key={s.id} className="focus-ring card" onClick={() => chooseSource(s.id)} style={optionRow}>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 15, fontWeight: 600 }}>NCERT Class 12 Maths</span>
                  <span style={{ display: "block", fontSize: 12.5, color: C.dim, marginTop: 2 }}>Every chapter, with its questions, marks and difficulty.</span>
                </span>
                {chevron}
              </Tap>
            ))}
            <div style={{ display: "flex", marginTop: 16 }}>
              <Tap onClick={onClose} style={cancelBtn}>Cancel</Tap>
            </div>
          </>
        ) : (
        <>
        {mode !== "edit" && changeMethod}

        <label style={lbl}>Subject</label>
        <input style={{ ...inputStyle, marginBottom: 18 }} placeholder="Biology" value={f.name} onChange={(e) => set("name", e.target.value)} />

        <label style={lbl} htmlFor="exam-date">Exam date</label>
        <input id="exam-date" type="date" style={{ ...inputStyle, marginBottom: 18 }} value={f.date} onChange={(e) => set("date", e.target.value)} />

        {syl ? (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 8 }}>
              <span style={{ ...lbl, marginBottom: 0 }}>Chapters you still need to cover</span>
              <Tap
                className="focus-ring"
                onClick={() => setPicked(chosen.length === syl.chapters.length ? new Set() : new Set(syl.chapters.map((c) => c.id)))}
                style={{ background: "none", color: C.accentText, fontSize: 13, fontWeight: 600, padding: "4px 2px", borderRadius: 6 }}
              >
                {chosen.length === syl.chapters.length ? "Clear all" : "Select all"}
              </Tap>
            </div>
            {syl.chapters.map((c) => {
              const on = picked.has(c.id);
              const dm = diffMeta(c.diff);
              return (
                <Tap
                  key={c.id}
                  className="focus-ring"
                  aria-pressed={on}
                  aria-label={`Chapter ${c.no}, ${c.name}. ${dm.label}, ${c.questions} questions, about ${fmtMarks(c.marksEst)} marks`}
                  onClick={() => toggle(c.id)}
                  style={{ width: "100%", textAlign: "left", background: C.card, border: `1px solid ${on ? C.accent : C.line}`, borderRadius: 14, padding: "12px 14px", marginBottom: 8, display: "flex", alignItems: "center", gap: 12, color: C.text }}
                >
                  <div aria-hidden="true" style={{ width: 22, height: 22, borderRadius: 7, border: `1.5px solid ${on ? C.amber : C.line}`, background: on ? C.amber : "transparent", color: C.onAccent, fontSize: 13, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, transition: "all .2s cubic-bezier(.32,.72,0,1)" }}>
                    {on ? "✓" : ""}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, color: on ? C.text : C.dim }}>{c.no}. {c.name}</div>
                    <div style={{ fontSize: 12, color: C.dim, marginTop: 3, fontVariantNumeric: "tabular-nums" }}>
                      {c.questions} questions · ~{fmtMarks(c.marksEst)} marks · {fmtH(c.hours.total * factor.factor * pm)}
                    </div>
                  </div>
                  <span style={{ fontSize: 12, color: dm.color, fontWeight: 650, flexShrink: 0 }}>{dm.label}</span>
                </Tap>
              );
            })}
            <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "12px 14px", margin: "4px 0 10px", fontSize: 13.5, lineHeight: 1.5 }}>
              <b style={{ fontWeight: 650 }}>{chosen.length}</b> chapter{chosen.length === 1 ? "" : "s"} · about{" "}
              <b style={{ fontWeight: 650 }}>{fmtMarks(chosenMarks)}</b> of {syl.totalMarks} marks ·{" "}
              <b style={{ fontWeight: 650, color: C.accentText }}>{fmtH(chosenHours)}</b> of work for you
            </div>
            <div style={{ fontSize: 12, color: C.dim, marginBottom: 18, lineHeight: 1.5 }}>
              Questions are every numbered NCERT exercise question (2026-27 reprint). CBSE gives marks per
              unit only, so chapter marks are estimated from its 2025-26 and 2026-27 sample papers. Difficulty
              combines how many questions a chapter has with how hard its ideas are.
            </div>
          </>
        ) : (
          <>
            {pasting ? (
              <>
                <label style={lbl} htmlFor="portions">Paste your portions list</label>
                <textarea
                  id="portions"
                  rows={7}
                  value={pasteText}
                  placeholder={PORTIONS_EXAMPLE}
                  onChange={(e) => setPasteText(e.target.value)}
                  style={{ ...inputStyle, resize: "vertical", minHeight: 150, lineHeight: 1.5, fontSize: 15, marginBottom: 10 }}
                />
                <div aria-live="polite" style={{ fontSize: 13, color: parsed.length ? C.accentText : C.dim, fontWeight: 600, marginBottom: 8 }}>
                  {parsed.length} chapter{parsed.length === 1 ? "" : "s"} found
                  {parsedAll.length > MAX_CHAPTERS && <span style={{ color: C.dim, fontWeight: 400 }}> · only the first {MAX_CHAPTERS} are kept</span>}
                </div>
                {parsed.length === 0 && (
                  <div style={{ fontSize: 12, color: C.dim, marginBottom: 18, lineHeight: 1.5 }}>
                    One chapter per line. Numbers, bullets and headings like "UNIT II" are left out for you.
                  </div>
                )}
                {parsed.length > 0 && (
                  <div style={{ fontSize: 12, color: C.dim, marginBottom: 10, lineHeight: 1.5 }}>
                    <b style={{ color: C.text, fontWeight: 600 }}>{WEIGHT_QUESTION}</b> {WEIGHT_EXPLAINER}
                  </div>
                )}
                {parsed.length > 0 && (
                  <ol style={{ listStyle: "none", margin: "0 0 18px", padding: 0 }}>
                    {parsed.map((c, k) => (
                      <li key={c.line} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "8px 10px 10px", marginBottom: 6 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <span style={{ width: 20, textAlign: "right", flexShrink: 0, color: C.dim, fontSize: 12.5, fontVariantNumeric: "tabular-nums" }}>{k + 1}</span>
                          <span style={{ flex: 1, minWidth: 0, fontSize: 14, overflowWrap: "anywhere" }}>{c.name}</span>
                          <Tap
                            className="focus-ring"
                            aria-label={`Remove ${c.name}`}
                            onClick={() => removeLine(c.line)}
                            style={{ width: 26, height: 26, flexShrink: 0, borderRadius: 8, background: "transparent", color: C.dim, fontSize: 17, lineHeight: 1, padding: 0 }}
                          >
                            ×
                          </Tap>
                        </div>
                        <div style={{ display: "flex", marginTop: 6, paddingLeft: 30 }}>
                          <WeightPicker
                            value={weightOf(c.name)}
                            onChange={(v) => setPasteWeight((p) => ({ ...p, [c.name.toLowerCase()]: v }))}
                          />
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </>
            ) : (
              <>
                <label style={lbl}>Total chapters</label>
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
                  <Tap onClick={() => set("chapters", Math.max(1, f.chapters - 1))} style={roundBtn}>−</Tap>
                  <NumField
                    value={f.chapters} min={1} max={MAX_CHAPTERS}
                    onChange={(v) => set("chapters", Math.round(v))}
                    style={{ ...inputStyle, textAlign: "center", flex: 1 }}
                  />
                  <Tap onClick={() => set("chapters", f.chapters + 1)} style={roundBtn}>+</Tap>
                </div>
              </>
            )}

            <label style={lbl}>How does this subject behave?</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
              {Object.entries(TYPE_META).map(([k, v]) => (
                <Tap key={k} onClick={() => set("type", k)} style={{ flex: 1, background: f.type === k ? C.amber : C.cardHi, color: f.type === k ? C.onAccent : C.dim, border: `1px solid ${f.type === k ? C.amber : C.line}`, borderRadius: 12, padding: "12px 4px", fontSize: 13, fontWeight: 600 }}>
                  {v.label}
                </Tap>
              ))}
            </div>
          </>
        )}

        <label style={lbl}>How fast do you get through a chapter here?</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {PACE.map((p) => (
            <Tap key={p.id} onClick={() => set("pace", p.id)} style={{ flex: 1, background: f.pace === p.id ? C.amber : C.cardHi, color: f.pace === p.id ? C.onAccent : C.dim, border: `1px solid ${f.pace === p.id ? C.amber : C.line}`, borderRadius: 12, padding: "12px 4px", fontSize: 13, fontWeight: 650 }}>
              {p.label}
            </Tap>
          ))}
        </div>
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 18, lineHeight: 1.5 }}>
          {PACE.find((p) => p.id === f.pace)?.sub}. Pace is your speed; confidence below is how
          well you know it — they're different things.
        </div>

        <label style={lbl}>How confident are you? ({f.confidence}/5)</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {[1, 2, 3, 4, 5].map((n) => (
            <Tap key={n} onClick={() => set("confidence", n)} style={{ flex: 1, background: f.confidence === n ? C.amber : C.cardHi, color: f.confidence === n ? C.onAccent : C.dim, border: `1px solid ${f.confidence === n ? C.amber : C.line}`, borderRadius: 12, padding: "13px 0", fontSize: 15, fontWeight: 650 }}>
              {n}
            </Tap>
          ))}
        </div>

        <label style={lbl}>Last test score (%)</label>
        <NumField
          value={f.lastScore} min={0} max={100}
          onChange={(v) => set("lastScore", Math.round(v))}
          style={{ ...inputStyle, marginBottom: 8 }}
        />
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 12, lineHeight: 1.5 }}>
          Used to catch the gap between how a subject feels and how it's actually going.
        </div>
        <div role="status" style={{ background: C.card, border: `1px solid ${factor.overconfident ? C.accentLine : C.line}`, borderRadius: 14, padding: "12px 14px", marginBottom: 24, fontSize: 13, lineHeight: 1.5, color: C.dim }}>
          <span style={{ color: C.text, fontWeight: 650 }}>Hours multiplier ×{factor.factor.toFixed(2)}</span>
          {factor.overconfident
            ? <> — your score decides this on its own, because it disagrees with a confidence of {f.confidence}/5.</>
            : <> — confidence counts 40%, your last score 60%. Lower either and the hours go up.</>}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <Tap onClick={onClose} style={{ flex: 1, background: "transparent", border: `1px solid ${C.line}`, color: C.dim, padding: "17px 0", borderRadius: 16, fontSize: 15, fontWeight: 600 }}>
            Cancel
          </Tap>
          <Tap disabled={!valid} onClick={submit} style={{ flex: 2, background: C.amber, color: C.onAccent, padding: "17px 0", borderRadius: 16, fontSize: 17, fontWeight: 650 }}>
            {mode === "edit" ? "Save changes" : "Save subject"}
          </Tap>
        </div>
        </>
        )}
      </div>
    </div>
  );
}

/* ----------------------------- CHROME ----------------------------- */
function Header({ title, sub, kicker }) {
  return (
    <div style={{ marginBottom: 26 }}>
      {kicker && <div className="rise" style={{ color: C.dim, fontSize: 14, fontWeight: 500, marginBottom: 2 }}>{kicker}</div>}
      <h1 className="rise" style={{ fontFamily: DISPLAY, fontSize: 34, fontWeight: 650, letterSpacing: "-0.035em", lineHeight: 1.1, margin: 0, animationDelay: ".03s" }}>{title}</h1>
      {sub && <div className="rise" style={{ color: C.dim, fontSize: 14.5, marginTop: 6, lineHeight: 1.45, animationDelay: ".06s" }}>{sub}</div>}
    </div>
  );
}

const Icon = {
  today: (c) => (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ stroke: c }} strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </svg>
  ),
  subjects: (c) => (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ stroke: c }} strokeWidth="2" strokeLinecap="round">
      <path d="M4 5h16M4 12h16M4 19h10" />
    </svg>
  ),
  reality: (c) => (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ stroke: c }} strokeWidth="2" strokeLinecap="round">
      <path d="M5 20V11M12 20V4M19 20v-6" />
    </svg>
  ),
  plan: (c) => (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ stroke: c }} strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </svg>
  ),
  timer: (c) => (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ stroke: c }} strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 13.5V10M10 2.5h4M18.5 6.5l-1.3 1.3" />
    </svg>
  ),
  settings: (c) => (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ stroke: c }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  ),
  time: (c) => (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" style={{ stroke: c }} strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 2" />
    </svg>
  ),
};

/* The screens in the navigation; the subject page and import count as
   Subjects, and Plan and Time (opened from Today and Settings on a phone)
   light up the screen they came from there. */
const NAV_TABS = [
  { id: "today", label: "Today", short: "Today", icon: Icon.today },
  { id: "subjects", label: "Subjects", short: "Subjects", icon: Icon.subjects },
  { id: "reality", label: "Reality check", short: "Check", icon: Icon.reality },
  { id: "plan", label: "Plan", short: "Plan", icon: Icon.plan },
  { id: "timer", label: "Timer", short: "Timer", icon: Icon.timer },
  { id: "time", label: "Time", short: "Time", icon: Icon.time },
  { id: "settings", label: "Settings", short: "Settings", icon: Icon.settings },
];
const navCurrent = (screen) => (screen === "detail" || screen === "import" ? "subjects" : screen);

/* The navigation's own background: a shade lighter than the page, warming to
   a soft accent glow at the bottom (the page washes in from the top-left,
   cards from the bottom-right), so it stands apart from the content. */
const NAV_BG = `radial-gradient(140% 50% at 0% 100%, ${C.accentSoft}, transparent 80%), linear-gradient(180deg, ${C.surface}, ${C.raised})`;

function LogoTile({ size = 44 }) {
  return (
    <span aria-hidden="true" style={{ width: size, height: size, borderRadius: size * 0.32, background: C.raised, border: `1px solid ${C.line}`, display: "grid", placeItems: "center", flexShrink: 0 }}>
      <Mark size={size * 0.5} />
    </span>
  );
}

/* Desktop: a labelled sidebar down the left edge, on every screen */
function Sidebar({ screen, go, onAdd, onImport }) {
  const [hover, setHover] = useState(null);
  const current = navCurrent(screen);
  const idx = NAV_TABS.findIndex((t) => t.id === current);

  return (
    <nav
      aria-label="Main"
      style={{
        position: "fixed", top: 0, bottom: 0, left: 0, width: SIDEBAR_W, zIndex: 40,
        borderRight: `1px solid ${C.line}`, background: NAV_BG,
        padding: "26px 18px 22px", boxSizing: "border-box",
        display: "flex", flexDirection: "column", gap: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "0 6px 26px" }}>
        <LogoTile />
        <span style={{ display: "flex", flexDirection: "column", lineHeight: 1.15 }}>
          <span style={{ fontFamily: DISPLAY, fontSize: 21, fontWeight: 650, letterSpacing: "-0.03em", color: C.text }}>Feasible</span>
          <span style={{ fontSize: 12, color: C.dim, marginTop: 2 }}>Study planner</span>
        </span>
      </div>
      <div style={{ fontSize: 11, fontWeight: 650, letterSpacing: ".1em", textTransform: "uppercase", color: C.dim, padding: "0 10px 8px" }}>Menu</div>
      {NAV_TABS.map((t, i) => {
        const active = t.id === current;
        const col = active ? C.onAccent : hover === t.id ? C.text : C.dim;
        return (
          <Tap
            key={t.id}
            className="focus-ring"
            aria-current={active ? "page" : undefined}
            onClick={() => { if (screen !== t.id) go(t.id, i >= idx ? "fwd" : "back"); }}
            onMouseEnter={() => setHover(t.id)}
            onMouseLeave={() => setHover(null)}
            style={{
              display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
              background: active ? C.accentSoft : hover === t.id ? C.hover : "transparent",
              color: active ? C.accentText : hover === t.id ? C.text : C.text,
              borderRadius: 14, padding: "7px 10px", fontSize: 15, fontWeight: active ? 650 : 550,
              transition: `background .2s ${EASE}, color .2s ${EASE}`,
            }}
          >
            <span aria-hidden="true" style={{ width: 34, height: 34, borderRadius: 11, display: "grid", placeItems: "center", background: active ? C.accent : "transparent", flexShrink: 0, transition: `background .2s ${EASE}` }}>
              {t.icon(col)}
            </span>
            {t.label}
          </Tap>
        );
      })}
      <div style={{ flex: 1 }} />
      <Tap
        className="focus-ring"
        onClick={onAdd}
        style={{ width: "100%", background: C.accent, color: C.onAccent, padding: "13px 0", borderRadius: 14, fontSize: 15, fontWeight: 650 }}
      >
        Add a subject
      </Tap>
      <Tap
        className="focus-ring"
        onClick={onImport}
        style={{ width: "100%", marginTop: 8, background: "transparent", border: `1px solid ${C.lineHi}`, color: C.text, padding: "12px 0", borderRadius: 14, fontSize: 14.5, fontWeight: 600 }}
      >
        Import portions
      </Tap>
    </nav>
  );
}

/* Phone: a slim rail down the left, icon over label, the current screen as a
   filled tile; adding a subject sits at the bottom, under the thumb. */
function PhoneRail({ screen, go, onAdd }) {
  const tabs = NAV_TABS.filter((t) => ["today", "subjects", "reality", "timer", "settings"].includes(t.id));
  const current = { plan: "today", time: "settings" }[screen] ?? navCurrent(screen);
  const idx = tabs.findIndex((t) => t.id === current);
  return (
    <nav
      aria-label="Main"
      style={{
        position: "fixed", top: 0, bottom: 0, left: `max(0px, calc(50% - ${MOBILE_MAX / 2}px))`, width: RAIL_W, zIndex: 40,
        borderRight: `1px solid ${C.line}`, background: NAV_BG,
        padding: "22px 0 22px", boxSizing: "border-box",
        display: "flex", flexDirection: "column", alignItems: "center", gap: 6,
      }}
    >
      <div style={{ marginBottom: 16 }}><LogoTile size={44} /></div>
      {tabs.map((t, i) => {
        const active = t.id === current;
        return (
          <Tap
            key={t.id}
            className="focus-ring"
            aria-label={t.label}
            aria-current={active ? "page" : undefined}
            onClick={() => { if (screen !== t.id) go(t.id, i >= idx ? "fwd" : "back"); }}
            style={{ width: 66, background: "transparent", padding: "5px 0 6px", borderRadius: 14, display: "flex", flexDirection: "column", alignItems: "center", gap: 5, color: active ? C.accentText : C.dim }}
          >
            <span aria-hidden="true" style={{ width: 44, height: 36, borderRadius: 13, display: "grid", placeItems: "center", background: active ? C.accent : "transparent", boxShadow: active ? "var(--shadow)" : "none", transition: `background .2s ${EASE}` }}>
              {t.icon(active ? C.onAccent : C.dim)}
            </span>
            <span style={{ fontSize: 11, fontWeight: active ? 700 : 550, letterSpacing: "-0.005em", lineHeight: 1 }}>{t.short}</span>
          </Tap>
        );
      })}
      <div style={{ flex: 1 }} />
      <Tap
        className="focus-ring"
        aria-label="Add a subject"
        onClick={onAdd}
        style={{ width: 66, background: "transparent", padding: "4px 0", display: "flex", flexDirection: "column", alignItems: "center", gap: 5, color: C.dim }}
      >
        <span aria-hidden="true" style={{ width: 44, height: 44, borderRadius: 14, border: `1.5px dashed ${C.lineHi}`, display: "grid", placeItems: "center", color: C.text, fontSize: 22, fontWeight: 400, lineHeight: 1 }}>+</span>
        <span style={{ fontSize: 11, fontWeight: 550, lineHeight: 1 }}>Add</span>
      </Tap>
    </nav>
  );
}
