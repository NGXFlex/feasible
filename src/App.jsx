import React, { useState, useMemo, useEffect, useRef } from "react";
import { C, FONT, Tap, inputStyle } from "./ui.jsx";
import Login from "./Login.jsx";


/* ------------------------------------------------------------------ */

const TYPE_META = {
  theory: { label: "Theory", base: 2.0, phases: [0.5, 0.2, 0.3] },
  problem: { label: "Problem", base: 2.5, phases: [0.3, 0.5, 0.2] },
  memory: { label: "Memory", base: 1.5, phases: [0.35, 0.15, 0.5] },
};
const PHASE_NAMES = ["Learn", "Practice", "Revise"];

const PACE = [
  { id: "quick", label: "Quick", sub: "I get through a chapter fast", mult: 0.78 },
  { id: "steady", label: "Steady", sub: "About average for my class", mult: 1.0 },
  { id: "thorough", label: "Thorough", sub: "I need longer per chapter", mult: 1.32 },
];
const paceMult = (id) => (PACE.find((p) => p.id === id) ?? PACE[1]).mult;

const DIFF = [
  { v: 1, label: "Easy", mult: 0.78, color: "#43D6A0" },
  { v: 2, label: "Medium", mult: 1.0, color: "#7B8798" },
  { v: 3, label: "Hard", mult: 1.4, color: "#FF6B6B" },
];
const diffMult = (v) => (DIFF.find((d) => d.v === v) ?? DIFF[1]).mult;
const diffMeta = (v) => DIFF.find((d) => d.v === v) ?? DIFF[1];
const dayMs = 86400000;
const STORE_KEY = "feasible-state-v1";

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const addDays = (d, n) => new Date(startOfDay(d).getTime() + n * dayMs);
const key = (d) => {
  const x = startOfDay(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
const fmtDate = (d) => new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const fmtDay = (d) => new Date(d).toLocaleDateString("en-IN", { weekday: "short" });
const daysUntil = (d) => Math.max(0, Math.round((startOfDay(d) - startOfDay(new Date())) / dayMs));

const defaultHours = (d, wd, we) => {
  const g = new Date(d).getDay();
  return g === 0 || g === 6 ? we : wd;
};

function hoursBetween(from, to, wd, we, ov) {
  let total = 0;
  let cur = startOfDay(from);
  const end = startOfDay(to);
  let guard = 0;
  while (cur < end && guard++ < 800) {
    const k = key(cur);
    total += k in ov ? ov[k] : defaultHours(cur, wd, we);
    cur = addDays(cur, 1);
  }
  return total;
}

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
function saveState(obj, onStatus) {
  localSet(obj);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    const c = await getCloud();
    if (!c) return;
    try {
      onStatus?.("saving");
      await c.cloudSave(obj);
      onStatus?.("cloud");
    } catch (e) {
      onStatus?.("offline");
    }
  }, 900);
}

/* Used when the account changes. Whatever was queued for the old account
   must never be written into the new one, and a signed-out device must not
   keep the previous account's plan lying around. */
function cancelPendingSave() { clearTimeout(saveTimer); }

/* "Continue without an account" is remembered on this device, so the login
   screen comes first until someone signs in or chooses that once. */
const GUEST_KEY = "feasible-guest-v1";
function isGuest() {
  try { return localStorage.getItem(GUEST_KEY) === "1"; } catch (e) { return false; }
}
function setGuest(on) {
  try {
    if (on) localStorage.setItem(GUEST_KEY, "1");
    else localStorage.removeItem(GUEST_KEY);
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
    logged: 0,
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

/* number field you can actually clear while typing */
function NumField({ value, onChange, min = 0, max = 9999, style, placeholder }) {
  const [t, setT] = useState(String(value));
  useEffect(() => { setT(String(value)); }, [value]);
  const clamp = (n) => Math.min(max, Math.max(min, n));
  return (
    <input
      inputMode="decimal"
      value={t}
      placeholder={placeholder}
      onFocus={(e) => e.target.select()}
      onChange={(e) => {
        const raw = e.target.value.replace(/[^0-9.]/g, "");
        setT(raw);
        const n = parseFloat(raw);
        if (!isNaN(n)) onChange(clamp(n));
      }}
      onBlur={() => {
        const n = parseFloat(t);
        const v = isNaN(n) ? min : clamp(n);
        onChange(v);
        setT(String(v));
      }}
      style={style}
    />
  );
}

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
        <div style={{ fontSize: 22, fontWeight: 700, color: dirty ? C.amber : C.text, fontVariantNumeric: "tabular-nums", letterSpacing: -0.6 }}>
          {v}h
        </div>
      </div>
      <input type="range" min="0" max={max} step="0.5" value={v} onChange={(e) => setV(+e.target.value)} />
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: C.dim, marginTop: 5 }}>
        <span>0h</span>
        <span>{max}h</span>
      </div>
      {dirty && (
        <div style={{ display: "flex", gap: 8, marginTop: 14, animation: "rise .3s cubic-bezier(.22,1,.36,1) both" }}>
          <Tap onClick={() => setV(s.logged)} style={{ flex: 1, background: "transparent", border: `1px solid ${C.line}`, color: C.dim, padding: "11px 0", borderRadius: 12, fontSize: 14, fontWeight: 600 }}>
            Cancel
          </Tap>
          <Tap onClick={() => onCommit(s.id, v)} style={{ flex: 2, background: C.amber, color: "#181203", padding: "11px 0", borderRadius: 12, fontSize: 14, fontWeight: 650 }}>
            Confirm {v}h
          </Tap>
        </div>
      )}
    </div>
  );
}

/* one-day editor sheet */
function DaySheet({ day, value, isCustom, onClose, onConfirm, onReset }) {
  const [v, setV] = useState(value);
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 85, display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "fadeIn .25s ease both" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: C.bg, borderTop: `1px solid ${C.line}`, borderRadius: "26px 26px 0 0", width: "100%", maxWidth: 430, padding: "10px 24px 32px", animation: "sheetUp .42s cubic-bezier(.32,.72,0,1) both", boxSizing: "border-box" }}
      >
        <div style={{ width: 38, height: 4, background: C.line, borderRadius: 99, margin: "0 auto 20px" }} />
        <div style={{ fontSize: 13, color: C.amber, fontWeight: 600 }}>
          {fmtDay(day)} {fmtDate(day)}
        </div>
        <div style={{ fontSize: 46, fontWeight: 700, letterSpacing: -1.8, margin: "8px 0 4px", fontVariantNumeric: "tabular-nums" }}>
          {v}h
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
            <Tap key={q} onClick={() => setV(q)} style={{ flex: 1, background: v === q ? C.amber : C.cardHi, color: v === q ? "#181203" : C.dim, border: `1px solid ${v === q ? C.amber : C.line}`, borderRadius: 12, padding: "11px 0", fontSize: 14, fontWeight: 600 }}>
              {q}h
            </Tap>
          ))}
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <Tap onClick={onClose} style={{ flex: 1, background: "transparent", border: `1px solid ${C.line}`, color: C.dim, padding: "16px 0", borderRadius: 16, fontSize: 15, fontWeight: 600 }}>
            Cancel
          </Tap>
          <Tap onClick={() => onConfirm(v)} style={{ flex: 2, background: C.amber, color: "#181203", padding: "16px 0", borderRadius: 16, fontSize: 16, fontWeight: 650 }}>
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
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState("onboard");
  const [dir, setDir] = useState("fwd");
  const [wd, setWd] = useState(2.5);
  const [we, setWe] = useState(5);
  const [ov, setOv] = useState({});
  const [pace, setPace] = useState("steady");
  const [subjects, setSubjects] = useState([]);
  const [openId, setOpenId] = useState(null);
  const [sheet, setSheet] = useState(null); // null | {mode:'add'} | {mode:'edit', subject}
  const [toast, setToast] = useState(null);
  const [overlay, setOverlay] = useState(false);
  const [onboarded, setOnboarded] = useState(false);
  const [sync, setSync] = useState("local");
  const [cloudApi, setCloudApi] = useState(null);   // firebase module, once it loads
  const [account, setAccount] = useState(null);     // { uid, email, isAnonymous } | null
  const [paused, setPaused] = useState(false);      // holds autosave while the account switches
  const [loginFrom, setLoginFrom] = useState("onboard");
  const [loginFirst, setLoginFirst] = useState(false);  // login is the launch screen, not a detour

  /* put a saved plan into the screen's state */
  const applyState = (s) => {
    setWd(typeof s?.wd === "number" ? s.wd : 2.5);
    setWe(typeof s?.we === "number" ? s.we : 5);
    setOv(s?.ov ?? {});
    setPace(s?.pace ?? "steady");
    setSubjects(Array.isArray(s?.subjects) ? s.subjects : []);
    setOnboarded(!!s?.onboarded);
  };

  /* restore */
  useEffect(() => {
    let alive = true;
    loadState().then(async ({ state: s, source }) => {
      if (!alive) return;
      setSync(source === "cloud" ? "cloud" : "local");
      if (s) applyState(s);
      const home = s?.onboarded ? "subjects" : "onboard";

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
      } else if (home === "subjects") {
        setScreen("subjects");
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
    saveState({ wd, we, ov, pace, subjects, onboarded }, setSync);
  }, [ready, paused, wd, we, ov, pace, subjects, onboarded]);

  const go = (s, d = "fwd") => { setDir(d); setScreen(s); };

  /* Android hardware back: close what's open instead of quitting the app */
  useEffect(() => {
    const handleBack = (e) => {
      if (sheet) { e?.preventDefault?.(); setSheet(null); return true; }
      if (screen === "login") { e?.preventDefault?.(); leaveLogin(); return true; }
      if (screen === "detail") { e?.preventDefault?.(); go("subjects", "back"); return true; }
      if (screen !== "subjects" && screen !== "onboard") {
        e?.preventDefault?.(); go("subjects", "back"); return true;
      }
      return false;
    };
    document.addEventListener("backbutton", handleBack);
    window.addEventListener("popstate", handleBack);
    return () => {
      document.removeEventListener("backbutton", handleBack);
      window.removeEventListener("popstate", handleBack);
    };
  }, [sheet, screen, loginFrom, loginFirst]);
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
    // land on Subjects if the plan they now have has any set-up in it
    const plan = remote ?? { onboarded, subjects };
    go(plan.onboarded || plan.subjects?.length ? "subjects" : "onboard");
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

  const analysis = useMemo(() => {
    const sorted = [...subjects].sort((a, b) => new Date(a.date) - new Date(b.date));
    if (!sorted.length) return [];

    /* ---- 1. what each subject costs ---- */
    const base = sorted.map((s) => {
      const meta = TYPE_META[s.type] ?? TYPE_META.theory;
      const diffs = s.diff ?? Array(s.chapters).fill(2);
      const doneCount = s.done.filter(Boolean).length;
      const remaining = s.chapters - doneCount;
      const baseChapter = meta.base * (1.6 - 0.16 * s.confidence) * paceMult(s.pace ?? pace);
      let raw = 0;
      const outstanding = [];
      for (let i = 0; i < s.chapters; i++) {
        if (s.done[i]) continue;
        const d = diffs[i] ?? 2;
        const cost = baseChapter * diffMult(d);
        raw += cost;
        outstanding.push({ i, d, cost, name: s.names?.[i] || `Chapter ${i + 1}` });
      }
      return {
        s, meta, diffs, doneCount, remaining, baseChapter, raw,
        need: Math.max(0, raw - s.logged), outstanding,
      };
    });

    /* ---- 2. day-by-day simulation ----
       Every day, the hours available are shared between all subjects whose
       exam is still ahead. Each subject's claim is its remaining workload
       divided by the days it has left, so a nearer exam pulls harder.
       If the day cannot cover every claim, each gets a proportional share
       and the deficit shows up as a shortfall. No hour is spent twice.    */
    const lastDate = base.reduce((a, b) => (new Date(b.s.date) > new Date(a) ? b.s.date : a), base[0].s.date);
    const alloc = base.map(() => []);
    const left = base.map((b) => b.need);
    let spare = 0;

    let cur = startOfDay(new Date());
    const stop = startOfDay(lastDate);
    let guard = 0;
    while (cur < stop && guard++ < 800) {
      const k = key(cur);
      const hours = k in ov ? ov[k] : defaultHours(cur, wd, we);
      if (hours <= 0) { cur = addDays(cur, 1); continue; }

      const active = [];
      base.forEach((b, i) => {
        if (left[i] <= 1e-9) return;
        const daysLeft = Math.round((startOfDay(b.s.date) - startOfDay(cur)) / dayMs);
        if (daysLeft <= 0) return;
        active.push({ i, rate: left[i] / daysLeft });
      });

      if (!active.length) { spare += hours; cur = addDays(cur, 1); continue; }

      const totalRate = active.reduce((t, a) => t + a.rate, 0);
      let used = 0;
      active.forEach((a) => {
        const share = totalRate <= hours ? a.rate : hours * (a.rate / totalRate);
        const give = Math.min(share, left[a.i]);
        if (give > 1e-9) {
          alloc[a.i].push({ d: new Date(cur), h: give });
          left[a.i] -= give;
          used += give;
        }
      });
      spare += Math.max(0, hours - used);
      cur = addDays(cur, 1);
    }

    /* ---- 3. per-subject results ---- */
    return base.map((b, i) => {
      const days = alloc[i];
      const available = days.reduce((t, x) => t + x.h, 0);
      const windowStart = days[0]?.d ?? startOfDay(new Date());
      const windowEnd = days[days.length - 1]?.d ?? startOfDay(b.s.date);
      const windowDays = days.length;

      /* phases split by hours across the days this subject actually gets */
      const phases = [];
      let idx = 0, acc = 0, mark = 0;
      b.meta.phases.forEach((p, pi) => {
        const last = pi === b.meta.phases.length - 1;
        const reserve = b.meta.phases.length - pi - 1;
        const target = mark + available * p;
        const startIdx = idx;
        if (last) {
          idx = days.length;
        } else {
          while (
            idx < days.length - reserve &&
            (idx === startIdx || acc + days[idx].h / 2 <= target + 1e-9)
          ) { acc += days[idx].h; idx++; }
        }
        const slice = days.slice(startIdx, idx);
        const hrs = slice.reduce((t, x) => t + x.h, 0);
        phases.push({
          name: PHASE_NAMES[pi],
          from: slice[0]?.d ?? null,
          to: slice[slice.length - 1]?.d ?? null,
          days: slice.length,
          hours: hrs,
          pct: available ? (hrs / available) * 100 : 0,
        });
        mark = target;
      });

      const priority = [...b.outstanding].sort((x, y) => y.d - x.d || x.i - y.i).slice(0, 3);

      const startAnchor = startOfDay(b.s.createdAt ?? new Date());
      const span = Math.max(1, (startOfDay(b.s.date) - startAnchor) / dayMs);
      const elapsed = Math.min(span, Math.max(0, (startOfDay(new Date()) - startAnchor) / dayMs));
      const expected = Math.round(b.s.chapters * (elapsed / span));

      return {
        ...b.s, meta: b.meta, diffs: b.diffs, doneCount: b.doneCount,
        remaining: b.remaining, baseChapter: b.baseChapter,
        perChapter: b.remaining ? b.raw / b.remaining : b.baseChapter,
        raw: b.raw, needed: b.need, available,
        windowStart, windowEnd, windowDays, phases, priority,
        squeezed: phases.filter((x) => x.days === 0).length,
        gap: available - b.need,
        totalSpare: spare,
        expected, behind: expected - b.doneCount,
        overconfident: b.s.confidence >= 4 && b.s.lastScore < 60,
      };
    });
  }, [subjects, wd, we, ov, pace]);

  const worst = analysis.reduce((a, b) => (b.gap < (a?.gap ?? Infinity) ? b : a), null);
  const totalShort = analysis.reduce((t, s) => t + Math.min(0, s.gap), 0);
  const totalSpare = analysis[0]?.totalSpare ?? 0;
  const lastExam = subjects.length
    ? subjects.reduce((a, b) => (new Date(b.date) > new Date(a) ? b.date : a), subjects[0].date)
    : key(addDays(new Date(), 14));

  const patch = (id, changes) =>
    setSubjects((p) => p.map((s) => (s.id === id ? { ...s, ...changes } : s)));

  const toggleChapter = (id, i) =>
    setSubjects((p) =>
      p.map((s) => (s.id === id ? { ...s, done: s.done.map((d, j) => (j === i ? !d : d)) } : s))
    );

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
    @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
    @keyframes toastIn { from { opacity:0; transform: translate(-50%, 14px) } to { opacity:1; transform: translate(-50%,0) } }
    @keyframes rise { from { opacity:0; transform: translateY(14px) } to { opacity:1; transform:none } }
    @keyframes barUp { from { opacity:0; transform: translateY(70px) } to { opacity:1; transform:none } }
    @keyframes barUpCentered { from { opacity:0; transform: translate(-50%, 70px) } to { opacity:1; transform: translate(-50%, 0) } }
    .rise { animation: rise .5s cubic-bezier(.22,1,.36,1) both }
    .focus-ring:focus-visible { outline: 2px solid ${C.amber}; outline-offset: 3px }
    ::-webkit-scrollbar { width:0; height:0 }
    .appmin { min-height: 100vh; min-height: 100dvh }
    .sheetbox { max-height: 88vh; max-height: 85dvh }
    @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
      .glass { background: #12171E !important }
    }
    input[type=range]{ -webkit-appearance:none; appearance:none; background:transparent; width:100%; margin:0 }
    input[type=range]::-webkit-slider-runnable-track{ height:6px; border-radius:99px; background:#0E141B; border:1px solid ${C.line} }
    input[type=range]::-webkit-slider-thumb{ -webkit-appearance:none; width:26px; height:26px; border-radius:99px; background:${C.amber}; margin-top:-11px; box-shadow:0 3px 10px rgba(0,0,0,.55); cursor:pointer }
    input[type=range]::-moz-range-track{ height:6px; border-radius:99px; background:#0E141B; border:1px solid ${C.line} }
    input[type=range]::-moz-range-thumb{ width:26px; height:26px; border:none; border-radius:99px; background:${C.amber}; cursor:pointer }
    input[type=date]::-webkit-calendar-picker-indicator { filter: invert(1); opacity:.5 }
    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation: none !important; transition: none !important }
    }
  `;

  const tabbed = ["subjects", "reality", "plan", "time"].includes(screen);
  const showBar = tabbed && !overlay && !sheet;

  return (
    <div
      className="appmin"
      style={{
        fontFamily: FONT, background: C.bg, color: C.text,
        maxWidth: 430, margin: "0 auto", position: "relative", overflow: "hidden",
        WebkitFontSmoothing: "antialiased",
      }}
    >
      <style>{styles}</style>

      {!ready && <div className="appmin" />}
      {ready && (
      <div
        key={screen + openId}
        style={{
          animation: `${dir === "fwd" ? "fwdIn" : "backIn"} .4s cubic-bezier(.32,.72,0,1) both`,
          paddingBottom: tabbed ? 104 : 32,
        }}
        className="appmin"
      >
        {screen === "onboard" && (
          <Onboard wd={wd} we={we} setWd={setWd} setWe={setWe}
            onDone={() => { setOnboarded(true); go("subjects"); flash("Saved"); }}
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
        {screen === "subjects" && (
          <Subjects sync={sync} data={analysis} onOpen={(id) => { setOpenId(id); go("detail"); }}
            onAdd={() => setSheet({ mode: "add" })}
            onSample={() => { setSubjects(sampleSubjects()); flash("Sample subjects loaded"); }} />
        )}
        {screen === "reality" && (
          <Reality data={analysis} worst={worst} totalShort={totalShort} totalSpare={totalSpare}
            onSetLog={(id, v) => {
              patch(id, { logged: Math.max(0, v) });
              flash("Changes confirmed");
            }} />
        )}
        {screen === "plan" && <Plan data={analysis} />}
        {screen === "time" && (
          <TimeScreen
            wd={wd} we={we} ov={ov} pace={pace} lastExam={lastExam}
            account={cloudApi ? account : undefined}
            onSignIn={() => openLogin("time")}
            onSignOut={signOutNow}
            onSaveWd={(v) => { setWd(v); flash("Changes confirmed"); }}
            onSaveWe={(v) => { setWe(v); flash("Changes confirmed"); }}
            onSavePace={(v) => { setPace(v); flash("Changes confirmed"); }}
            onReset={() => {
              setSubjects([]);
              setOv({}); setWd(2.5); setWe(5); setPace("steady");
              setOnboarded(false); go("onboard", "back");
            }}
            onSetDay={(k, v, d) => { setOv((p) => ({ ...p, [k]: v })); flash("Changes confirmed"); }}
            onResetDay={(k, d) => { setOv((p) => { const n = { ...p }; delete n[k]; return n; }); flash("Reset to default"); }}
            setOverlay={setOverlay}
          />
        )}
        {screen === "detail" && (
          <Detail
            s={analysis.find((x) => x.id === openId)}
            onBack={() => go("subjects", "back")}
            onToggle={toggleChapter}
            onRemove={removeSubject}
            onPatch={patch}
            onEdit={(subj) => setSheet({ mode: "edit", subject: subj })}
            flash={flash}
            setOverlay={setOverlay}
          />
        )}
      </div>
      )}

      {ready && showBar && <TabBar screen={screen} go={go} />}

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
            position: "fixed", bottom: showBar ? 100 : 32, left: "50%",
            background: C.cardHi, border: `1px solid ${C.line}`, padding: "12px 20px",
            borderRadius: 999, fontSize: 14, fontWeight: 500,
            animation: "toastIn .35s cubic-bezier(.32,.72,0,1) both",
            zIndex: 90, boxShadow: "0 12px 32px rgba(0,0,0,.5)",
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
  return (
    <div
      style={{
        position: "fixed", bottom, left: "50%", transform: "translateX(-50%)",
        width: "100%", maxWidth: 430, padding: "12px 24px 14px",
        background: "rgba(11,14,19,.9)", backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)", borderTop: `1px solid ${C.line}`,
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
          flex: 2, background: C.amber, color: "#181203", padding: "15px 0",
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
    <div style={{ display: "flex", gap: 8, marginTop: 12, animation: "rise .28s cubic-bezier(.22,1,.36,1) both" }}>
      <Tap onClick={onCancel} style={{ flex: 1, background: "transparent", border: `1px solid ${C.line}`, color: C.dim, padding: "11px 0", borderRadius: 12, fontSize: 14, fontWeight: 600 }}>
        Cancel
      </Tap>
      <Tap onClick={onConfirm} style={{ flex: 2, background: C.amber, color: "#181203", padding: "11px 0", borderRadius: 12, fontSize: 14, fontWeight: 650 }}>
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
    <div className="rise" style={{ background: C.card, border: `1px solid ${dirty ? C.amber : C.line}`, borderRadius: 20, padding: 20, marginBottom: 14, animationDelay: delay, transition: "border-color .3s ease" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ paddingRight: 12 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{label}</div>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>{sub}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Tap onClick={() => setV(Math.max(0, +(v - 0.5).toFixed(1)))} style={roundBtn}>−</Tap>
          <div style={{ fontSize: 23, fontWeight: 700, width: 44, textAlign: "center", fontVariantNumeric: "tabular-nums", letterSpacing: -0.5, color: dirty ? C.amber : C.text }}>{v}</div>
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
    <div className="rise" style={{ background: C.card, border: `1px solid ${dirty ? C.amber : C.line}`, borderRadius: 20, padding: 20, marginBottom: 14, animationDelay: ".1s", transition: "border-color .3s ease" }}>
      <div style={{ fontSize: 16, fontWeight: 600 }}>Default pace</div>
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
              color: v === p.id ? "#181203" : C.dim,
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
      <div className="rise" style={{ fontSize: 13, color: C.amber, fontWeight: 600 }}>Feasible</div>
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
      <Tap onClick={onDone} style={{ marginTop: 36, width: "100%", background: C.amber, color: "#181203", padding: "17px 0", borderRadius: 16, fontSize: 17, fontWeight: 650 }}>
        Save and continue
      </Tap>
      <div style={{ fontSize: 13, color: C.dim, textAlign: "center", marginTop: 14 }}>
        Everything is kept. You can change it later under Time.
      </div>
      {onSignIn && (
        <div className="rise" style={{ fontSize: 14, color: C.dim, textAlign: "center", marginTop: 22, animationDelay: ".3s" }}>
          Already have an account?{" "}
          <Tap className="focus-ring" onClick={onSignIn} style={{ background: "none", color: C.amber, fontSize: 14, fontWeight: 600, padding: "4px 2px", borderRadius: 6 }}>
            Sign in
          </Tap>
        </div>
      )}
    </div>
  );
}

function Stepper({ label, sub, value, set, delay }) {
  return (
    <div className="rise" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 20, marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between", animationDelay: delay }}>
      <div style={{ paddingRight: 12 }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{label}</div>
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
function TimeScreen({ wd, we, ov, pace, lastExam, account, onSignIn, onSignOut, onSaveWd, onSaveWe, onSavePace, onSetDay, onResetDay, onReset, setOverlay }) {
  const [pick, setPick] = useState(null);
  const [reset, setReset] = useState(false);
  const [outArm, setOutArm] = useState(false);
  const signedIn = !!(account && !account.isAnonymous && account.email);
  useEffect(() => { setOverlay(!!pick); return () => setOverlay(false); }, [pick]);
  const total = Math.max(14, daysUntil(lastExam) + 1);
  const days = Array.from({ length: total }, (_, i) => addDays(new Date(), i));

  const totalHours = hoursBetween(new Date(), lastExam, wd, we, ov);
  const customCount = Object.keys(ov).length;

  return (
    <div style={{ padding: "60px 24px 0" }}>
      <Header title="Time" sub="What you actually have, not what you wish you had" />

      <div className="rise" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 20, marginBottom: 16 }}>
        <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1.6, color: C.amber, fontVariantNumeric: "tabular-nums", lineHeight: 1 }}>
          {Math.round(totalHours)}h
        </div>
        <div style={{ fontSize: 14, color: C.dim, marginTop: 10, lineHeight: 1.5 }}>
          total study time between now and your last exam. Every change below moves this
          number and the Check tab straight away.
        </div>
      </div>

      <ConfirmStepper label="On a school day" sub="Default for Mon–Fri" value={wd} onCommit={onSaveWd} delay="0s" />
      <ConfirmStepper label="On a weekend day" sub="Default for Sat–Sun" value={we} onCommit={onSaveWe} delay=".05s" />
      <PaceCard value={pace} onCommit={onSavePace} />

      <div style={{ marginTop: 28, marginBottom: 14 }}>
        <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: -0.3 }}>Specific days</div>
        <div style={{ fontSize: 13, color: C.dim, marginTop: 5, lineHeight: 1.5 }}>
          Tap any day to change just that one. Function on Saturday? Set it to zero.
          {customCount > 0 && ` A dot marks the ${customCount} day${customCount === 1 ? "" : "s"} you've changed.`}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8 }}>
        {days.map((d, i) => {
          const k = key(d);
          const custom = k in ov;
          const val = custom ? ov[k] : defaultHours(d, wd, we);
          const weekend = [0, 6].includes(d.getDay());
          return (
            <Tap
              key={k}
              onClick={() => setPick({ day: d, val, custom })}
              style={{
                background: C.card,
                border: `1px solid ${C.line}`,
                borderRadius: 14, padding: "12px 4px", color: C.text,
                position: "relative",
                animation: `rise .45s cubic-bezier(.22,1,.36,1) ${Math.min(0.4, 0.015 * i)}s both`,
              }}
            >
              {custom && (
                <div style={{ position: "absolute", top: 8, right: 8, width: 5, height: 5, borderRadius: 99, background: C.amber }} />
              )}
              <div style={{ fontSize: 11, color: weekend ? C.blue : C.dim, fontWeight: 600 }}>
                {i === 0 ? "TODAY" : fmtDay(d).toUpperCase()}
              </div>
              <div style={{ fontSize: 13, color: C.dim, marginTop: 3 }}>
                {new Date(d).getDate()}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, marginTop: 5, color: C.text, fontVariantNumeric: "tabular-nums" }}>
                {val}h
              </div>
            </Tap>
          );
        })}
      </div>

      {account !== undefined && (
        <div className="rise" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 20, marginTop: 28 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>Account</div>
          <div style={{ fontSize: 13, color: C.dim, marginTop: 3, lineHeight: 1.5, overflowWrap: "anywhere" }}>
            {signedIn
              ? <>Signed in as <span style={{ color: C.text }}>{account.email}</span>. Your plan syncs to every device you sign in on.</>
              : "Your plan is tied to this device. Make an account to keep it if you switch phones or clear your browser."}
          </div>
          {signedIn ? (
            <Tap
              className="focus-ring"
              onClick={() => (outArm ? onSignOut() : setOutArm(true))}
              onPointerLeave={() => setOutArm(false)}
              style={{
                marginTop: 14, width: "100%",
                background: outArm ? C.amber : C.cardHi, color: outArm ? "#181203" : C.text,
                border: `1px solid ${outArm ? C.amber : C.line}`, padding: "13px 0", borderRadius: 14,
                fontSize: 14.5, fontWeight: 600, transition: "background .25s ease, color .25s ease",
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
      )}

      <div style={{ marginTop: 30, paddingTop: 20, borderTop: `1px solid ${C.line}` }}>
        <Tap
          onClick={() => (reset ? onReset() : setReset(true))}
          onPointerLeave={() => setReset(false)}
          style={{
            width: "100%", background: reset ? C.red : "transparent",
            border: `1px solid ${reset ? C.red : C.line}`,
            color: reset ? "#1A0A0A" : C.dim, padding: "14px 0", borderRadius: 16,
            fontSize: 14.5, fontWeight: 600, transition: "background .25s ease, color .25s ease",
          }}
        >
          {reset ? "Tap again to erase everything" : "Start over"}
        </Tap>
        <div style={{ fontSize: 12.5, color: C.dim, textAlign: "center", marginTop: 10, lineHeight: 1.5 }}>
          Clears every subject and returns to the welcome screen.
        </div>
      </div>

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

/* --------------------------- SUBJECTS --------------------------- */
function SyncChip({ sync }) {
  const map = {
    cloud:   { dot: C.green, text: "Synced to cloud" },
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
      <div style={{ width: 6, height: 6, borderRadius: 99, background: m.dot, transition: "background .3s ease" }} />
      <span style={{ fontSize: 12, color: C.dim, fontWeight: 550 }}>{m.text}</span>
    </div>
  );
}

function Subjects({ data, onOpen, onAdd, onSample, sync }) {
  return (
    <div style={{ padding: "60px 24px 0" }}>
      <Header title="Subjects" sub={`${data.length} exam${data.length === 1 ? "" : "s"} ahead`} />
      <SyncChip sync={sync} />
      {data.length === 0 && (
        <div className="rise" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 22, padding: 26, marginBottom: 14 }}>
          <div style={{ fontSize: 20, fontWeight: 700, letterSpacing: -0.5 }}>Get started</div>
          <div style={{ color: C.dim, fontSize: 14.5, lineHeight: 1.6, marginTop: 10 }}>
            Add your first exam and the app works out whether you actually have the hours for it.
            You'll need the exam date, how many chapters are left, and how well you know it.
          </div>
          <Tap
            onClick={onAdd}
            style={{ width: "100%", marginTop: 20, background: C.amber, color: "#181203", padding: "16px 0", borderRadius: 14, fontSize: 16, fontWeight: 650 }}
          >
            Add your first subject
          </Tap>
          <Tap
            onClick={onSample}
            style={{ width: "100%", marginTop: 10, background: "transparent", border: `1px solid ${C.line}`, color: C.dim, padding: "14px 0", borderRadius: 14, fontSize: 14, fontWeight: 600 }}
          >
            Load sample subjects instead
          </Tap>
        </div>
      )}
      {data.map((s, i) => (
        <Tap
          key={s.id}
          onClick={() => onOpen(s.id)}
          style={{
            display: "block", width: "100%", textAlign: "left", background: C.card,
            border: `1px solid ${C.line}`, borderRadius: 20, padding: 0, marginBottom: 12,
            overflow: "hidden", color: C.text,
            animation: `rise .5s cubic-bezier(.22,1,.36,1) ${0.05 * i}s both`,
          }}
        >
          <div style={{ display: "flex" }}>
            <div style={{ width: 4, background: s.gap < 0 ? C.red : C.green, flexShrink: 0 }} />
            <div style={{ padding: "18px 20px", flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div style={{ fontSize: 18, fontWeight: 650, letterSpacing: -0.3 }}>{s.name}</div>
                <div style={{ fontSize: 13, color: C.dim, fontVariantNumeric: "tabular-nums" }}>{fmtDate(s.date)}</div>
              </div>
              <div style={{ marginTop: 8, fontSize: 14, color: s.gap < 0 ? C.red : C.green, fontWeight: 500 }}>
                {s.gap < 0 ? `${Math.round(-s.gap)}h short` : `${Math.round(s.gap)}h spare`}
                <span style={{ color: C.dim, fontWeight: 400 }}>
                  {"  ·  "}{s.windowDays} study day{s.windowDays === 1 ? "" : "s"} · {s.doneCount}/{s.chapters} chapters
                </span>
              </div>
            </div>
          </div>
        </Tap>
      ))}
      {data.length > 0 && (
        <>
          <Tap onClick={onAdd} style={{ width: "100%", marginTop: 8, background: "transparent", border: `1px dashed ${C.line}`, color: C.dim, padding: "16px 0", borderRadius: 18, fontSize: 15, fontWeight: 500 }}>
            Add a subject
          </Tap>
          <div style={{ fontSize: 13, color: C.dim, textAlign: "center", marginTop: 12 }}>
            Tap a subject to set chapter difficulty, rename chapters, or remove it.
          </div>
        </>
      )}
    </div>
  );
}

/* ---------------------------- REALITY ---------------------------- */
function Reality({ data, worst, totalShort, totalSpare, onSetLog }) {
  const short = Math.round(-totalShort);
  const spare = Math.round(totalSpare);
  const n = useCountUp(short > 0 ? short : spare);
  const [go, setGo] = useState(false);
  useEffect(() => { const t = setTimeout(() => setGo(true), 120); return () => clearTimeout(t); }, []);
  const flagged = data.filter((s) => s.overconfident);

  return (
    <div style={{ padding: "60px 24px 0" }}>
      <Header title="Reality check" sub="Where the numbers actually land" />

      <div className="rise" style={{ background: short > 0 ? "#1D1215" : "#101C18", border: `1px solid ${short > 0 ? "#3A1F24" : "#17342B"}`, borderRadius: 24, padding: 24, marginBottom: 20 }}>
        <div style={{ fontSize: 56, fontWeight: 700, letterSpacing: -2.4, lineHeight: 1, color: short > 0 ? C.red : C.green, fontVariantNumeric: "tabular-nums" }}>
          {Math.round(n)}h
        </div>
        <div style={{ fontSize: 17, marginTop: 12, lineHeight: 1.5, fontWeight: 500 }}>
          {short > 0 ? (<>short overall. The tightest is <span style={{ color: C.red }}>{worst?.name}</span>.</>) : (<>spare across every subject. Your plan fits.</>)}
        </div>
        <div style={{ fontSize: 14, color: C.dim, marginTop: 10, lineHeight: 1.5 }}>
          {short > 0
            ? "Cut chapters, add hours, or accept the gap. Doing nothing is also a choice."
            : "Keep the pace and don't add anything new."}
        </div>
        <div style={{ fontSize: 12.5, color: C.dim, marginTop: 12, lineHeight: 1.5, paddingTop: 12, borderTop: `1px solid rgba(255,255,255,.07)` }}>
          Time is split in exam order — each subject only gets the days left after the
          one before it, so the hours never get counted twice.
        </div>
      </div>

      {data.map((s, i) => {
        const max = Math.max(s.needed, s.available) || 1;
        const fits = s.gap >= 0;
        return (
          <div key={s.id} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 20, marginBottom: 12, animation: `rise .5s cubic-bezier(.22,1,.36,1) ${0.08 * i + 0.1}s both` }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 16 }}>
              <div>
                <div style={{ fontSize: 17, fontWeight: 650, letterSpacing: -0.3 }}>{s.name}</div>
                <div style={{ fontSize: 12.5, color: C.dim, marginTop: 4 }}>
                  {i === 0 ? "Today" : fmtDate(s.windowStart)} – {fmtDate(s.date)} · {s.windowDays} study day{s.windowDays === 1 ? "" : "s"}
                </div>
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: fits ? C.green : C.red, fontVariantNumeric: "tabular-nums" }}>
                {fits ? "+" : "−"}{Math.abs(Math.round(s.gap))}h
              </div>
            </div>
            <Bar label="You have" hours={s.available} pct={go ? (s.available / max) * 100 : 0} color={C.dim} delay={0.1 * i} />
            <Bar label="Still need" hours={s.needed} pct={go ? (s.needed / max) * 100 : 0} color={fits ? C.green : C.red} delay={0.1 * i + 0.08} />
            <HoursSlider s={s} onCommit={onSetLog} />
          </div>
        );
      })}

      {flagged.map((s) => (
        <div key={s.id} className="rise" style={{ background: "#1C1710", border: "1px solid #3A2E17", borderRadius: 18, padding: "16px 20px", marginBottom: 12, fontSize: 14, lineHeight: 1.55, color: "#E9D3A6", animationDelay: ".35s" }}>
          You rated <b style={{ color: C.amber }}>{s.name}</b> easy, but your last score was {s.lastScore}%. Confidence and marks disagree — that gap is usually where results get lost.
        </div>
      ))}
    </div>
  );
}

function Bar({ label, hours, pct, color, delay }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: C.dim, marginBottom: 7 }}>
        <span>{label}</span>
        <span style={{ fontVariantNumeric: "tabular-nums", color: C.text }}>{Math.round(hours)}h</span>
      </div>
      <div style={{ height: 8, background: "#0E141B", borderRadius: 99, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 99, transition: `width 1s cubic-bezier(.22,1,.36,1) ${delay}s` }} />
      </div>
    </div>
  );
}

/* ------------------------------ PLAN ------------------------------ */
function Plan({ data }) {
  const [open, setOpen] = useState(data[0]?.id ?? null);
  const behindList = data.filter((s) => s.behind > 0);

  return (
    <div style={{ padding: "60px 24px 0" }}>
      <Header title="Plan" sub="Phases sized to how each subject behaves" />

      <div
        className="rise"
        style={{
          background: behindList.length ? "#1C1710" : "#101C18",
          border: `1px solid ${behindList.length ? "#3A2E17" : "#17342B"}`,
          borderRadius: 20, padding: "18px 20px", marginBottom: 18,
          fontSize: 15, lineHeight: 1.55,
        }}
      >
        {behindList.length ? (
          <>
            <b style={{ color: C.amber }}>Behind pace.</b>{" "}
            {behindList.map((s, i) => (
              <span key={s.id}>
                {i > 0 && ", "}
                {s.name} by {s.behind} chapter{s.behind === 1 ? "" : "s"}
              </span>
            ))}
            .
            <div style={{ color: C.dim, fontSize: 13, marginTop: 8 }}>
              Pace = chapters you'd have finished by today if you'd spread them evenly from
              when you added the subject to exam day. Tick chapters and this updates itself.
            </div>
          </>
        ) : (
          <>
            <b style={{ color: C.green }}>On pace.</b> Every subject is where it should be for today.
            <div style={{ color: C.dim, fontSize: 13, marginTop: 8 }}>
              Measured against an even spread of chapters from the day you added each subject to exam day.
            </div>
          </>
        )}
      </div>

      {data.map((s, i) => {
        const isOpen = open === s.id;
        const days = s.windowDays;
        const segs = s.phases;

        return (
          <div key={s.id} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, marginBottom: 12, overflow: "hidden", animation: `rise .5s cubic-bezier(.22,1,.36,1) ${0.06 * i}s both` }}>
            <Tap onClick={() => setOpen(isOpen ? null : s.id)} style={{ width: "100%", background: "transparent", color: C.text, padding: "18px 20px", textAlign: "left" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 17, fontWeight: 650, letterSpacing: -0.3 }}>{s.name}</div>
                  <div style={{ fontSize: 13, color: s.behind > 0 ? C.amber : C.dim, marginTop: 4 }}>
                    {s.behind > 0 ? `${s.behind} chapter${s.behind === 1 ? "" : "s"} behind pace` : "On pace"}
                    <span style={{ color: C.dim }}> · {fmtDate(s.windowStart)}–{fmtDate(s.date)} · {Math.round(s.available)}h</span>
                  </div>
                </div>
                <div style={{ color: C.dim, fontSize: 18, transform: isOpen ? "rotate(90deg)" : "none", transition: "transform .3s cubic-bezier(.32,.72,0,1)" }}>›</div>
              </div>
              <div style={{ display: "flex", gap: 3, marginTop: 16 }}>
                {segs.map((g, k) => (
                  <div key={k} style={{ flex: g.pct, height: 6, borderRadius: 99, background: [C.amber, C.blue, C.green][k], opacity: 0.9 }} />
                ))}
              </div>
            </Tap>
            <div style={{ maxHeight: isOpen ? 430 : 0, opacity: isOpen ? 1 : 0, transition: "max-height .42s cubic-bezier(.32,.72,0,1), opacity .3s ease", overflow: "hidden" }}>
              <div style={{ padding: "4px 20px 20px" }}>
                {segs.map((g, k) => (
                  <div key={k} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderTop: `1px solid ${C.line}` }}>
                    <div style={{ width: 8, height: 8, borderRadius: 99, background: [C.amber, C.blue, C.green][k] }} />
                    <div style={{ flex: 1, fontSize: 15, fontWeight: 550, color: g.days === 0 ? C.dim : C.text }}>{g.name}</div>
                    {g.days === 0 ? (
                      <div style={{ fontSize: 13, color: C.dim, fontStyle: "italic" }}>No room</div>
                    ) : (
                      <div style={{ fontSize: 13, color: C.dim, fontVariantNumeric: "tabular-nums", textAlign: "right" }}>
                        {fmtDate(g.from)}{g.days > 1 ? ` – ${fmtDate(g.to)}` : ""}
                        <div style={{ fontSize: 11.5 }}>{Math.round(g.hours)}h · {g.days}d</div>
                      </div>
                    )}
                  </div>
                ))}
                {s.squeezed > 0 && (
                  <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12, marginTop: 4, marginBottom: 4, fontSize: 13, color: C.amber, lineHeight: 1.5 }}>
                    Only {s.windowDays} study day{s.windowDays === 1 ? "" : "s"} before this exam, so there
                    isn't room for every phase. The time goes to the phases closest to the exam.
                  </div>
                )}
                {s.priority.filter((c) => c.d === 3).length > 0 && (
                  <div style={{ borderTop: `1px solid ${C.line}`, paddingTop: 12, marginTop: 4 }}>
                    <div style={{ fontSize: 12.5, color: C.dim, marginBottom: 8 }}>Hardest chapters left — start here</div>
                    {s.priority.filter((c) => c.d === 3).map((c) => (
                      <div key={c.i} style={{ display: "flex", alignItems: "center", gap: 9, padding: "5px 0" }}>
                        <div style={{ width: 6, height: 6, borderRadius: 99, background: C.red }} />
                        <div style={{ flex: 1, fontSize: 14 }}>{c.name}</div>
                        <div style={{ fontSize: 12.5, color: C.dim, fontVariantNumeric: "tabular-nums" }}>{c.cost.toFixed(1)}h</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ----------------------------- DETAIL ----------------------------- */
function Detail({ s, onBack, onToggle, onRemove, onPatch, onEdit, flash, setOverlay }) {
  const [editing, setEditing] = useState(false);
  const [draftNames, setDraftNames] = useState([]);
  const [draftDiff, setDraftDiff] = useState([]);
  const [draftCount, setDraftCount] = useState(0);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    if (s) { setDraftNames(s.names ?? []); setDraftDiff(s.diffs ?? []); setDraftCount(s.chapters); }
  }, [s?.id, s?.chapters]);

  useEffect(() => { setOverlay(editing); return () => setOverlay(false); }, [editing]);

  if (!s) return null;
  const pct = (s.doneCount / s.chapters) * 100;

  const resize = (n) => {
    n = Math.max(1, Math.min(60, n));
    setDraftCount(n);
    setDraftNames((p) => Array.from({ length: n }, (_, i) => p[i] ?? ""));
    setDraftDiff((p) => Array.from({ length: n }, (_, i) => p[i] ?? 2));
  };

  const commit = () => {
    onPatch(s.id, {
      chapters: draftCount,
      names: draftNames,
      diff: draftDiff,
      done: Array.from({ length: draftCount }, (_, i) => s.done[i] ?? false),
    });
    setEditing(false);
    flash("Changes confirmed");
  };

  return (
    <div style={{ padding: "60px 24px 0" }}>
      <Tap onClick={onBack} style={{ background: "transparent", color: C.amber, padding: 0, fontSize: 16, marginBottom: 22, fontWeight: 500 }}>
        ‹ Subjects
      </Tap>

      <h1 style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1, margin: "0 0 6px" }}>{s.name}</h1>
      <div style={{ color: C.dim, fontSize: 15 }}>
        {s.windowDays} study day{s.windowDays === 1 ? "" : "s"} · exam {fmtDate(s.date)} · {s.meta.label}-heavy
      </div>

      <div className="rise" style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 20, padding: 20, margin: "24px 0 16px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 12 }}>
          <span style={{ color: C.dim }}>Chapters done</span>
          <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{s.doneCount} / {s.chapters}</span>
        </div>
        <div style={{ height: 8, background: "#0E141B", borderRadius: 99, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: C.amber, borderRadius: 99, transition: "width .6s cubic-bezier(.22,1,.36,1)" }} />
        </div>
        <div style={{ fontSize: 13, color: C.dim, marginTop: 14, lineHeight: 1.5 }}>
          At your pace, an average remaining chapter here is worth about {s.perChapter.toFixed(1)}h — hard ones cost more, easy ones less.
          {s.logged > 0 && ` You've also logged ${s.logged}h here.`}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <Tap onClick={() => onEdit(s)} style={{ flex: 1, background: C.card, border: `1px solid ${C.line}`, color: C.text, padding: "14px 0", borderRadius: 14, fontSize: 14, fontWeight: 600 }}>
          Edit details
        </Tap>
        <Tap onClick={() => setEditing(!editing)} style={{ flex: 1, background: editing ? C.amber : C.card, border: `1px solid ${editing ? C.amber : C.line}`, color: editing ? "#181203" : C.text, padding: "14px 0", borderRadius: 14, fontSize: 14, fontWeight: 600 }}>
          {editing ? "Editing chapters" : "Edit chapters"}
        </Tap>
      </div>

      {editing && (
        <div className="rise" style={{ background: C.card, border: `1px solid ${C.amber}`, borderRadius: 18, padding: "14px 18px", marginBottom: 14, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Number of chapters</div>
            <div style={{ fontSize: 12, color: C.dim, marginTop: 3 }}>Mark each one Easy, Medium or Hard</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <Tap onClick={() => resize(draftCount - 1)} style={smallBtn}>−</Tap>
            <div style={{ fontSize: 18, fontWeight: 700, width: 34, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>{draftCount}</div>
            <Tap onClick={() => resize(draftCount + 1)} style={smallBtn}>+</Tap>
          </div>
        </div>
      )}

      {(editing ? draftNames : s.names ?? []).map((nm, i) =>
        editing ? (
          <div key={i} style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "10px 12px", marginBottom: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 22, textAlign: "center", color: C.dim, fontSize: 13, fontVariantNumeric: "tabular-nums" }}>{i + 1}</div>
              <input
                value={nm}
                placeholder={`Chapter ${i + 1}`}
                onChange={(e) => setDraftNames((p) => p.map((x, j) => (j === i ? e.target.value : x)))}
                style={{ ...inputStyle, padding: "10px 12px", fontSize: 15 }}
              />
            </div>
            <div style={{ display: "flex", gap: 6, marginTop: 8, paddingLeft: 32 }}>
              {DIFF.map((dd) => {
                const on = (draftDiff[i] ?? 2) === dd.v;
                return (
                  <Tap
                    key={dd.v}
                    onClick={() => setDraftDiff((p) => p.map((x, j) => (j === i ? dd.v : x)))}
                    style={{
                      flex: 1, background: on ? dd.color : C.cardHi,
                      color: on ? "#0B0E13" : C.dim,
                      border: `1px solid ${on ? dd.color : C.line}`,
                      borderRadius: 9, padding: "7px 0", fontSize: 12, fontWeight: 650,
                    }}
                  >
                    {dd.label}
                  </Tap>
                );
              })}
            </div>
          </div>
        ) : (
          <Tap
            key={i}
            onClick={() => onToggle(s.id, i)}
            style={{ width: "100%", textAlign: "left", background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "14px 16px", marginBottom: 8, display: "flex", alignItems: "center", gap: 13, color: C.text }}
          >
            <div style={{ width: 22, height: 22, borderRadius: 99, border: `1.5px solid ${s.done[i] ? C.green : C.line}`, background: s.done[i] ? C.green : "transparent", color: "#08120E", fontSize: 13, display: "flex", alignItems: "center", justifyContent: "center", transition: "all .25s cubic-bezier(.34,1.56,.64,1)", flexShrink: 0 }}>
              {s.done[i] ? "✓" : ""}
            </div>
            <span style={{ flex: 1, fontSize: 15, color: s.done[i] ? C.dim : C.text, textDecoration: s.done[i] ? "line-through" : "none" }}>
              {nm || `Chapter ${i + 1}`}
            </span>
            {!s.done[i] && (
              <span style={{ fontSize: 12, color: diffMeta(s.diffs?.[i] ?? 2).color, fontWeight: 600 }}>
                {diffMeta(s.diffs?.[i] ?? 2).label} · {(s.baseChapter * diffMult(s.diffs?.[i] ?? 2)).toFixed(1)}h
              </span>
            )}
          </Tap>
        )
      )}

      {!editing && (
        <Tap
          onClick={() => (confirm ? onRemove(s.id) : setConfirm(true))}
          onPointerLeave={() => setConfirm(false)}
          style={{ width: "100%", marginTop: 22, background: confirm ? C.red : "transparent", border: `1px solid ${C.red}`, color: confirm ? "#1A0A0A" : C.red, padding: "15px 0", borderRadius: 16, fontSize: 15, fontWeight: 600, transition: "background .25s ease, color .25s ease" }}
        >
          {confirm ? "Tap again to remove" : "Remove subject"}
        </Tap>
      )}

      <div style={{ height: editing ? 104 : 0 }} />
      {editing && (
        <SaveBar
          label="Save chapters"
          onSave={commit}
          onCancel={() => { setDraftNames(s.names ?? []); setDraftCount(s.chapters); setEditing(false); }}
        />
      )}
    </div>
  );
}

/* --------------------------- SUBJECT SHEET --------------------------- */
function SubjectSheet({ mode, initial, defaultPace, onClose, onSave }) {
  const [f, setF] = useState(
    initial ?? {
      name: "", date: key(addDays(new Date(), 14)), chapters: 10,
      type: "theory", confidence: 3, lastScore: 60, pace: defaultPace ?? "steady",
    }
  );
  const set = (k, v) => setF((p) => ({ ...p, [k]: v }));
  const valid = f.name.trim().length > 0;
  const lbl = { fontSize: 13, color: C.dim, marginBottom: 8, display: "block" };

  const submit = () => {
    const n = Math.max(1, f.chapters);
    if (mode === "edit") {
      onSave({
        ...initial, ...f, chapters: n,
        names: Array.from({ length: n }, (_, i) => initial.names?.[i] ?? ""),
        diff: Array.from({ length: n }, (_, i) => initial.diffs?.[i] ?? initial.diff?.[i] ?? 2),
        done: Array.from({ length: n }, (_, i) => initial.done?.[i] ?? false),
      });
    } else {
      onSave({
        ...f, chapters: n,
        id: f.name.toLowerCase().replace(/\s+/g, "") + Date.now(),
        createdAt: key(new Date()), logged: 0,
        names: Array(n).fill(""),
        diff: Array(n).fill(2),
        done: Array(n).fill(false),
      });
    }
  };

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.6)", zIndex: 80, display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "fadeIn .25s ease both" }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="sheetbox"
        style={{ background: C.bg, borderTop: `1px solid ${C.line}`, borderRadius: "26px 26px 0 0", width: "100%", maxWidth: 430, padding: "10px 24px 30px", overflowY: "auto", animation: "sheetUp .42s cubic-bezier(.32,.72,0,1) both" }}
      >
        <div style={{ width: 38, height: 4, background: C.line, borderRadius: 99, margin: "0 auto 20px" }} />
        <h2 style={{ fontSize: 24, fontWeight: 700, letterSpacing: -0.6, margin: "0 0 22px" }}>
          {mode === "edit" ? "Edit subject" : "Add a subject"}
        </h2>

        <label style={lbl}>Subject</label>
        <input style={{ ...inputStyle, marginBottom: 18 }} placeholder="Biology" value={f.name} onChange={(e) => set("name", e.target.value)} />

        <label style={lbl}>Exam date</label>
        <input type="date" style={{ ...inputStyle, marginBottom: 18 }} value={f.date} onChange={(e) => set("date", e.target.value)} />

        <label style={lbl}>Total chapters</label>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18 }}>
          <Tap onClick={() => set("chapters", Math.max(1, f.chapters - 1))} style={roundBtn}>−</Tap>
          <NumField
            value={f.chapters} min={1} max={60}
            onChange={(v) => set("chapters", Math.round(v))}
            style={{ ...inputStyle, textAlign: "center", flex: 1 }}
          />
          <Tap onClick={() => set("chapters", f.chapters + 1)} style={roundBtn}>+</Tap>
        </div>

        <label style={lbl}>How does this subject behave?</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          {Object.entries(TYPE_META).map(([k, v]) => (
            <Tap key={k} onClick={() => set("type", k)} style={{ flex: 1, background: f.type === k ? C.amber : C.cardHi, color: f.type === k ? "#181203" : C.dim, border: `1px solid ${f.type === k ? C.amber : C.line}`, borderRadius: 12, padding: "12px 4px", fontSize: 13, fontWeight: 600 }}>
              {v.label}
            </Tap>
          ))}
        </div>

        <label style={lbl}>How fast do you get through a chapter here?</label>
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          {PACE.map((p) => (
            <Tap key={p.id} onClick={() => set("pace", p.id)} style={{ flex: 1, background: f.pace === p.id ? C.amber : C.cardHi, color: f.pace === p.id ? "#181203" : C.dim, border: `1px solid ${f.pace === p.id ? C.amber : C.line}`, borderRadius: 12, padding: "12px 4px", fontSize: 13, fontWeight: 650 }}>
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
            <Tap key={n} onClick={() => set("confidence", n)} style={{ flex: 1, background: f.confidence === n ? C.amber : C.cardHi, color: f.confidence === n ? "#181203" : C.dim, border: `1px solid ${f.confidence === n ? C.amber : C.line}`, borderRadius: 12, padding: "13px 0", fontSize: 15, fontWeight: 650 }}>
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
        <div style={{ fontSize: 12, color: C.dim, marginBottom: 24, lineHeight: 1.5 }}>
          Used to catch the gap between how a subject feels and how it's actually going.
        </div>

        <div style={{ display: "flex", gap: 10 }}>
          <Tap onClick={onClose} style={{ flex: 1, background: "transparent", border: `1px solid ${C.line}`, color: C.dim, padding: "17px 0", borderRadius: 16, fontSize: 15, fontWeight: 600 }}>
            Cancel
          </Tap>
          <Tap disabled={!valid} onClick={submit} style={{ flex: 2, background: C.amber, color: "#181203", padding: "17px 0", borderRadius: 16, fontSize: 17, fontWeight: 650 }}>
            {mode === "edit" ? "Save changes" : "Save subject"}
          </Tap>
        </div>
      </div>
    </div>
  );
}

/* ----------------------------- CHROME ----------------------------- */
function Header({ title, sub }) {
  return (
    <div style={{ marginBottom: 26 }}>
      <h1 className="rise" style={{ fontSize: 34, fontWeight: 700, letterSpacing: -1, margin: 0 }}>{title}</h1>
      <div className="rise" style={{ color: C.dim, fontSize: 15, marginTop: 6, animationDelay: ".05s" }}>{sub}</div>
    </div>
  );
}

const Icon = {
  subjects: (c) => (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
      <path d="M4 5h16M4 12h16M4 19h10" />
    </svg>
  ),
  reality: (c) => (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
      <path d="M5 20V11M12 20V4M19 20v-6" />
    </svg>
  ),
  plan: (c) => (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
      <rect x="3" y="5" width="18" height="16" rx="3" />
      <path d="M8 3v4M16 3v4M3 11h18" />
    </svg>
  ),
  time: (c) => (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 2" />
    </svg>
  ),
};

function TabBar({ screen, go }) {
  const [open, setOpen] = useState(false);
  const timer = useRef(null);

  const expand = () => {
    setOpen(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(false), 2800);
  };
  useEffect(() => () => clearTimeout(timer.current), []);

  const tabs = [
    { id: "subjects", label: "Subjects", icon: Icon.subjects },
    { id: "reality", label: "Check", icon: Icon.reality },
    { id: "plan", label: "Plan", icon: Icon.plan },
    { id: "time", label: "Time", icon: Icon.time },
  ];
  const idx = tabs.findIndex((t) => t.id === screen);

  return (
    <div
      style={{
        position: "fixed", bottom: 24, left: 0, right: 0,
        display: "flex", justifyContent: "center", pointerEvents: "none",
        zIndex: 50, animation: "barUp .4s cubic-bezier(.32,.72,0,1) both",
      }}
    >
      <div
        className="glass"
        onPointerDown={expand}
        style={{
          pointerEvents: "auto",
          display: "flex", gap: 3, alignItems: "center",
          width: open ? "min(398px, calc(100vw - 28px))" : "auto",
          maxWidth: "calc(100vw - 28px)",
          background: "rgba(18,23,30,.88)",
          backdropFilter: "blur(26px)", WebkitBackdropFilter: "blur(26px)",
          border: `1px solid ${C.line}`, borderRadius: 99, padding: 6,
          boxShadow: "0 12px 34px rgba(0,0,0,.55)",
          boxSizing: "border-box", overflow: "hidden",
          transition: "width .4s cubic-bezier(.32,.72,0,1)",
        }}
      >
        {tabs.map((t, i) => {
          const active = t.id === screen;
          const col = active ? C.amber : C.dim;
          return (
            <Tap
              key={t.id}
              onClick={() => { expand(); go(t.id, i > idx ? "fwd" : "back"); }}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
                flex: open ? "1 1 0" : "0 0 auto", minWidth: 0,
                background: active ? C.cardHi : "transparent",
                borderRadius: 99, padding: open ? "11px 6px" : "11px 13px", color: col,
                transition: "background .3s ease, padding .4s cubic-bezier(.32,.72,0,1)",
              }}
            >
              {t.icon(col)}
              <span
                style={{
                  fontSize: 12.5, fontWeight: 650, color: col,
                  maxWidth: open ? 72 : 0, opacity: open ? 1 : 0,
                  overflow: "hidden", whiteSpace: "nowrap", textOverflow: "clip",
                  transition: "max-width .4s cubic-bezier(.32,.72,0,1), opacity .3s ease",
                }}
              >
                {t.label}
              </span>
            </Tap>
          );
        })}
      </div>
    </div>
  );
}
