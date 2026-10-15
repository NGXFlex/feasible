import { getSyllabus, readinessFactor, dailyNeed } from "./syllabusEngine.js";
import { marksFromWeights } from "./portions.js";
import { shareDays } from "./schedule.js";
import { loggedTotal, loggedOn } from "./log.js";

/* ------------------------------------------------------------------ */
/*  The whole plan, from saved subjects and study time to everything    */
/*  the screens show. Plain arithmetic, no React.                       */
/* ------------------------------------------------------------------ */

export const TYPE_META = {
  theory: { label: "Theory", base: 2.0, phases: [0.5, 0.2, 0.3] },
  problem: { label: "Problem", base: 2.5, phases: [0.3, 0.5, 0.2] },
  memory: { label: "Memory", base: 1.5, phases: [0.35, 0.15, 0.5] },
};
export const PHASE_NAMES = ["Learn", "Practice", "Revise"];

export const PACE = [
  { id: "quick", label: "Quick", sub: "I get through a chapter fast", mult: 0.78 },
  { id: "steady", label: "Steady", sub: "About average for my class", mult: 1.0 },
  { id: "thorough", label: "Thorough", sub: "I need longer per chapter", mult: 1.32 },
];
export const paceMult = (id) => (PACE.find((p) => p.id === id) ?? PACE[1]).mult;

/* difficulty 1 / 2 / 3 */
export const DIFF_MULT = { 1: 0.78, 2: 1.0, 3: 1.4 };
export const diffMult = (v) => DIFF_MULT[v] ?? DIFF_MULT[2];

/* --------------------------------- dates ---------------------------------
   Exam dates are saved as "YYYY-MM-DD". They mean that calendar day where
   the student is, so they're read as local dates: new Date("2026-10-24")
   would be UTC midnight, the day before anywhere west of UTC.           */
export const dayMs = 86400000;
const DAY_KEY = /^(\d{4})-(\d{2})-(\d{2})$/;
export const toDate = (d) => {
  const m = typeof d === "string" && DAY_KEY.exec(d);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(d);
};
export const startOfDay = (d) => { const x = toDate(d); x.setHours(0, 0, 0, 0); return x; };
/* by calendar day, so a daylight-saving change never repeats or skips one */
export const addDays = (d, n) => { const x = startOfDay(d); x.setDate(x.getDate() + n); return x; };
export const key = (d) => {
  const x = startOfDay(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
};
export const daysBetween = (from, to) => Math.round((startOfDay(to) - startOfDay(from)) / dayMs);
export const daysUntil = (d, today = new Date()) => Math.max(0, daysBetween(today, d));

export const defaultHours = (d, wd, we) => {
  const g = toDate(d).getDay();
  return g === 0 || g === 6 ? we : wd;
};
export const hoursOnDay = (d, wd, we, ov) => { const k = key(d); return k in ov ? ov[k] : defaultHours(d, wd, we); };

/* Every day from `from` up to (not including) `to`, with its hours */
function eachDay(from, to, wd, we, ov, fn) {
  let cur = startOfDay(from);
  const end = startOfDay(to);
  let guard = 0;
  while (cur < end && guard++ < 800) {
    fn(cur, hoursOnDay(cur, wd, we, ov));
    cur = addDays(cur, 1);
  }
}

export function hoursBetween(from, to, wd, we, ov) {
  let total = 0;
  eachDay(from, to, wd, we, ov, (_, h) => { total += h; });
  return total;
}

/* days between from and to that have any study time in them */
export function studyDaysBetween(from, to, wd, we, ov) {
  let n = 0;
  eachDay(from, to, wd, we, ov, (_, h) => { if (h > 0) n++; });
  return n;
}

/* first and last day with study time in them; null when there are none */
export function studyWindow(from, to, wd, we, ov) {
  let first = null, last = null;
  eachDay(from, to, wd, we, ov, (d, h) => { if (h > 0) { first ??= d; last = d; } });
  return { first, last };
}

/* an exam before today is over: it gets no time and no place in the plan */
export const examPassed = (s, today = new Date()) => startOfDay(s.date) < startOfDay(today);

/* names used by more than one subject, so their cards can show the date */
export const nameKey = (name) => String(name ?? "").trim().toLowerCase();
export function sharedNames(subjects) {
  const seen = {};
  subjects.forEach((s) => { seen[nameKey(s.name)] = (seen[nameKey(s.name)] ?? 0) + 1; });
  return new Set(Object.keys(seen).filter((k) => seen[k] > 1));
}

/* --------------------------------- plan ---------------------------------
   subjects: what's saved. time: { wd, we, ov, pace }.
   Returns { subjects, passed, spare, capacity }:
     subjects  upcoming exams, soonest first, with everything worked out
     passed    exams already over, newest first; left out of every number
     spare     hours nobody needs, each counted once
     capacity  every study hour from today to the last exam               */
export function analysePlan(subjects, { wd, we, ov = {}, pace = "steady" }, today = new Date()) {
  const shared = sharedNames(subjects);
  const passed = subjects.filter((s) => examPassed(s, today))
    .sort((a, b) => startOfDay(b.date) - startOfDay(a.date))
    .map((s) => ({ ...s, sameName: shared.has(nameKey(s.name)) }));
  const sorted = subjects.filter((s) => !examPassed(s, today))
    .sort((a, b) => startOfDay(a.date) - startOfDay(b.date));
  if (!sorted.length) return { subjects: [], passed, spare: 0, capacity: 0 };

  /* ---- 1. what each subject costs ---- */
  const base = sorted.map((s) => {
    const chapters = Math.max(0, s.chapters | 0);
    // saved lists can be shorter or missing (older saves): size them to the chapters
    const done = Array.from({ length: chapters }, (_, i) => !!s.done?.[i]);
    const names = Array.from({ length: chapters }, (_, i) => s.names?.[i] ?? "");
    const meta = TYPE_META[s.type] ?? TYPE_META.theory;
    const diffs = Array.from({ length: chapters }, (_, i) => s.diff?.[i] ?? 2);
    const doneCount = done.filter(Boolean).length;
    const remaining = chapters - doneCount;
    // how many times the expected hours this student needs, from confidence + last score
    const factor = readinessFactor(s.confidence, s.lastScore);
    const pm = paceMult(s.pace ?? pace);
    const baseChapter = meta.base * factor.factor * pm;
    const syl = s.syllabus ? getSyllabus(s.syllabus) : null;
    // no syllabus but a weightage per chapter: split a 100-mark paper by weight
    const chapterMarks = !syl && Array.isArray(s.weight) && chapters > 0 ? marksFromWeights(s.weight, chapters) : null;
    let raw = 0;
    let marks = 0, marksLeft = 0;
    const costs = [];
    const outstanding = [];
    for (let i = 0; i < chapters; i++) {
      const d = diffs[i];
      const ch = syl?.byId[s.refs?.[i]];
      // a syllabus chapter starts from its own estimate (questions, examples,
      // concept); re-marking its difficulty scales it from there
      const cost = ch
        ? ch.hours.total * (diffMult(d) / diffMult(ch.diff)) * factor.factor * pm
        : baseChapter * diffMult(d);
      costs[i] = cost;
      const m = ch ? ch.marksEst : chapterMarks?.[i];
      if (m != null) { marks += m; if (!done[i]) marksLeft += m; }
      if (done[i]) continue;
      raw += cost;
      outstanding.push({ i, d, cost, name: names[i] || `Chapter ${i + 1}` });
    }
    const logged = loggedTotal(s);
    return {
      s: { ...s, chapters, done, names, logged }, meta, diffs, doneCount, remaining, baseChapter, raw, factor, costs, syl, pm, chapterMarks,
      marks: syl || chapterMarks ? marks : null, marksLeft: syl || chapterMarks ? marksLeft : null,
      need: Math.max(0, raw - logged), outstanding,
    };
  });

  /* ---- 2. day-by-day simulation (schedule.js) ---- */
  const hoursOn = (d) => hoursOnDay(d, wd, we, ov);
  const sim = shareDays(base.map((b) => ({ need: b.need, date: startOfDay(b.s.date) })), hoursOn, today);

  /* ---- 3. per-subject results ---- */
  const results = base.map((b, i) => {
    const { days, allocated, available } = sim.subjects[i];
    // the subject's window is every study day from today to its exam,
    // whether or not it still needs any of them
    const studyDays = studyDaysBetween(today, b.s.date, wd, we, ov);
    const { first, last } = studyWindow(today, b.s.date, wd, we, ov);
    const windowStart = first ?? startOfDay(today);
    const windowEnd = last ?? startOfDay(b.s.date);

    const phases = splitPhases(days, allocated, b.meta.phases);
    const priority = [...b.outstanding].sort((x, y) => y.d - x.d || x.i - y.i).slice(0, 3);

    const startAnchor = startOfDay(b.s.createdAt ?? today);
    const span = Math.max(1, (startOfDay(b.s.date) - startAnchor) / dayMs);
    const elapsed = Math.min(span, Math.max(0, (startOfDay(today) - startAnchor) / dayMs));
    const expected = Math.round(b.s.chapters * (elapsed / span));

    /* daily load: this subject's remaining hours over the study days left
       before its exam, next to what an average one of those days holds */
    const perDay = dailyNeed(b.need, studyDays);
    const havePerDay = studyDays ? hoursBetween(today, b.s.date, wd, we, ov) / studyDays : null;

    return {
      ...b.s, meta: b.meta, diffs: b.diffs, doneCount: b.doneCount,
      remaining: b.remaining, baseChapter: b.baseChapter,
      perChapter: b.remaining ? b.raw / b.remaining : b.baseChapter,
      raw: b.raw, needed: b.need, allocated, available, days,
      windowStart, windowEnd, windowDays: studyDays, phases, priority,
      // a phase with no days only matters while there's work left
      squeezed: b.need > 0 ? phases.filter((x) => x.days === 0).length : 0,
      gap: available - b.need,
      totalSpare: sim.spare,
      expected, behind: Math.max(0, expected - b.doneCount),
      factor: b.factor, costs: b.costs, syl: b.syl, marks: b.marks, marksLeft: b.marksLeft, pm: b.pm,
      chapterMarks: b.chapterMarks,
      sameName: shared.has(nameKey(b.s.name)),
      studyDays, perDay, havePerDay,
      overconfident: b.factor.overconfident,
    };
  });

  return { subjects: results, passed, spare: sim.spare, capacity: sim.capacity };
}

/* ------------------------------- priority -------------------------------
   Which subject first: urgency = hours still needed / study days left
   before that exam, i.e. what it needs from each of its days. The more it
   needs a day, the sooner it slips if you fall behind. An exam with no
   study days left and work still to do is the most urgent of all. */
export function urgencyOf(s) {
  if (s.perDay != null) return s.perDay;
  return s.needed > 0 ? Infinity : 0;
}
export const rankByUrgency = (subjects) =>
  [...subjects].sort((a, b) => urgencyOf(b) - urgencyOf(a) || startOfDay(a.date) - startOfDay(b.date));

/* --------------------------------- today ---------------------------------
   Today's hours from the day-by-day simulation. The day is planned as it
   stood this morning (hours logged today don't shrink today's share), and
   what has been logged today comes off each subject's share.
   Returns { planned, done, left, capacity, rows } with rows in priority
   order: { id, name, date, sameName, planned, done, left }. */
export function todayPlan(subjects, time, today = new Date()) {
  const day = key(today);
  const morning = subjects.map((s) => (Array.isArray(s.log) ? { ...s, log: s.log.filter((e) => e?.d !== day) } : s));
  const plan = analysePlan(morning, time, today);
  const t0 = startOfDay(today).getTime();
  const rows = rankByUrgency(plan.subjects).map((s) => {
    const planned = s.days.filter((x) => startOfDay(x.d).getTime() === t0).reduce((t, x) => t + x.h, 0);
    const done = loggedOn(subjects.find((o) => o.id === s.id), day);
    return { id: s.id, name: s.name, date: s.date, sameName: s.sameName, planned, done, left: Math.max(0, planned - done) };
  });
  const sum = (k) => rows.reduce((t, r) => t + r[k], 0);
  return {
    planned: sum("planned"), done: sum("done"), left: sum("left"),
    capacity: hoursOnDay(today, time.wd, time.we, time.ov ?? {}),
    rows,
  };
}

/* Learn / Practice / Revise: the hours a subject is given, split by its
   type's shares, over the days it gets them, in order. Every day goes to
   exactly one phase, so the phase hours add up to the allocated hours. */
export function splitPhases(days, allocated, shares) {
  const phases = [];
  let idx = 0, acc = 0, mark = 0;
  shares.forEach((p, pi) => {
    const last = pi === shares.length - 1;
    const reserve = shares.length - pi - 1;
    const target = mark + allocated * p;
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
      pct: allocated ? (hrs / allocated) * 100 : 0,
    });
    mark = target;
  });
  return phases;
}
