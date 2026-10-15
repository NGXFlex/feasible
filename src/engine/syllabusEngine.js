import { NCERT12_MATHS } from "../syllabus/ncert12Maths.js";

/* ------------------------------------------------------------------ */
/*  Syllabus engine — plain arithmetic, no React, no network.           */
/*                                                                      */
/*  Input is syllabus data in the shape of ncert12Maths.js. Today that  */
/*  data is hand-built; later an AI parser can produce the same shape   */
/*  and nothing here has to change.                                     */
/*                                                                      */
/*  Two things are kept apart on purpose:                               */
/*    marksEst      how much the chapter is worth in the exam           */
/*    hours         how much work the chapter is                        */
/* ------------------------------------------------------------------ */

export const SYLLABI = [NCERT12_MATHS];

/* Every tunable number lives here, so the model can be read in one place. */
export const MODEL = {
  chapterIntroMinutes: 30,                 // first read-through of the chapter's ideas
  minutesPerExample: 6,                    // working through one solved example
  minutesPerQuestion: (concept) => 3 + concept, // 4 min (concept 1) … 8 min (concept 5)
  revisionShare: 0.2,                      // revision reserved on top of learning + practice
  volumeWeight: 0.5,                       // difficulty = half volume, half concept
  tierCut: { easy: 0.35, hard: 0.6 },      // below easy → Easy, at/above hard → Hard
  marksEvenShare: 2 / 3,                   // fallback with no sample papers: unit marks split mostly evenly
  highYieldMarks: 2,                       // an exercise averaging this many marks a paper is high yield
  secureRate: 0.85,                        // share of a prepared chapter's marks you can count on scoring
};

/* The app stores difficulty as 1 / 2 / 3 */
export const TIER_TO_DIFF = { easy: 1, medium: 2, hard: 3 };

/* Questions in an exercise. Accepts { q } objects and [label, q] pairs. */
const exQuestions = (e) => (Array.isArray(e) ? e[1] : e.q);
export const questionCount = (ch) => ch.exercises.reduce((t, e) => t + exQuestions(e), 0);

/* "7.2", or "7.Misc" for a chapter's Miscellaneous Exercise */
export const exerciseKey = (chNo, ex) => (ex === "Misc" ? `${chNo}.Misc` : ex);
const chapterOfKey = (k) => Number(String(k).split(".")[0]);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/* Volume on a log scale, 0 for the lightest chapter and 1 for the heaviest.
   Log, because 261 questions is not ten times the work of 26 in practice:
   later questions in an exercise repeat techniques you already have. */
function volumeScores(counts) {
  const logs = counts.map((q) => Math.log(Math.max(1, q)));
  const lo = Math.min(...logs);
  const hi = Math.max(...logs);
  return logs.map((l) => (hi > lo ? (l - lo) / (hi - lo) : 0.5));
}

export function tierFor(score) {
  if (score < MODEL.tierCut.easy) return "easy";
  if (score >= MODEL.tierCut.hard) return "hard";
  return "medium";
}

/* Expected study hours for one chapter at average readiness and pace. */
export function chapterHours(ch) {
  const theory = MODEL.chapterIntroMinutes + ch.examples * MODEL.minutesPerExample;
  const practice = questionCount(ch) * MODEL.minutesPerQuestion(ch.concept);
  const revision = MODEL.revisionShare * (theory + practice);
  return {
    theory: theory / 60,
    practice: practice / 60,
    revision: revision / 60,
    total: (theory + practice + revision) / 60,
  };
}

/* ------------------------- sample papers -------------------------
   Each question row is [question, marks, alternative, ...]. The marks
   are shared equally between OR alternatives, then equally between the
   exercises an alternative uses. Returns marks per chapter number and
   per exercise key, for each paper and averaged over the papers.     */
export function paperEvidence(syl) {
  const papers = (syl.papers ?? []).map((p) => {
    const byChapter = {};
    const byExercise = {};
    for (const [, marks, ...alts] of p.questions) {
      for (const alt of alts) {
        const keys = alt.split("+");
        for (const k of keys) {
          const m = marks / alts.length / keys.length;
          byExercise[k] = (byExercise[k] ?? 0) + m;
          const no = chapterOfKey(k);
          byChapter[no] = (byChapter[no] ?? 0) + m;
        }
      }
    }
    const total = p.questions.reduce((t, q) => t + q[1], 0);
    return { id: p.id, title: p.title, url: p.url, questions: p.questions.length, total, byChapter, byExercise };
  });
  const avg = (field) => {
    const out = {};
    for (const p of papers) for (const [k, v] of Object.entries(p[field])) out[k] = (out[k] ?? 0) + v / papers.length;
    return out;
  };
  return { papers, byChapter: avg("byChapter"), byExercise: avg("byExercise") };
}

/* -------------------------- exercise order --------------------------
   Within a chapter: never before what it builds on; among what's ready,
   the most valuable first; the Miscellaneous Exercise always last.
   "Valuable" is an exercise's own yield, or the yield of anything that
   needs it — groundwork for a high-yield exercise is itself urgent.    */
function orderExercises(exercises) {
  const byKey = Object.fromEntries(exercises.map((e) => [e.ex, e]));
  const dependents = {};
  for (const e of exercises) for (const b of e.builds) (dependents[b] ??= []).push(e.ex);

  const priority = {};
  const prio = (k, seen = new Set()) => {
    if (priority[k] != null) return priority[k];
    if (seen.has(k)) return 0;
    seen.add(k);
    const own = byKey[k].yield;
    const fromDependents = (dependents[k] ?? [])
      .filter((d) => d !== "Misc")
      .map((d) => prio(d, seen));
    return (priority[k] = Math.max(own, ...fromDependents));
  };
  exercises.forEach((e) => prio(e.ex));

  const done = new Set();
  const order = [];
  const rest = exercises.filter((e) => e.ex !== "Misc");
  while (order.length < rest.length) {
    const ready = rest.filter((e) => !done.has(e.ex) && e.builds.every((b) => done.has(b) || !byKey[b]));
    // a broken builds list should never stall the order: fall back to book order
    const pool = ready.length ? ready : rest.filter((e) => !done.has(e.ex));
    pool.sort((a, b) => priority[b.ex] - priority[a.ex] || a.index - b.index);
    done.add(pool[0].ex);
    order.push(pool[0]);
  }
  const misc = exercises.find((e) => e.ex === "Misc");
  if (misc) order.push(misc);
  return order.map((e) => ({ ...e, priority: priority[e.ex] }));
}

/* Adds questions, difficulty tier, estimated marks, hours and exercise
   order to every chapter. */
export function analyseSyllabus(syl) {
  const counts = syl.chapters.map(questionCount);
  const vol = volumeScores(counts);
  const units = Object.fromEntries(syl.units.map((u) => [u.id, u]));
  const evidence = paperEvidence(syl);
  const fromPapers = evidence.papers.length > 0;

  const unitQuestions = {};
  const unitChapters = {};
  syl.chapters.forEach((ch, i) => {
    unitQuestions[ch.unit] = (unitQuestions[ch.unit] ?? 0) + counts[i];
    unitChapters[ch.unit] = (unitChapters[ch.unit] ?? 0) + 1;
  });

  /* Sample papers give each chapter a share of its unit. Those shares are
     applied to the official unit marks, so every unit still totals exactly
     what CBSE publishes. Without papers, split mostly evenly, nudged by
     each chapter's share of the unit's questions. */
  const unitPaperMarks = {};
  if (fromPapers) {
    syl.chapters.forEach((ch) => {
      unitPaperMarks[ch.unit] = (unitPaperMarks[ch.unit] ?? 0) + (evidence.byChapter[ch.no] ?? 0);
    });
  }

  const chapters = syl.chapters.map((ch, i) => {
    const unit = units[ch.unit];
    const conceptScore = (ch.concept - 1) / 4;
    const score = MODEL.volumeWeight * vol[i] + (1 - MODEL.volumeWeight) * conceptScore;
    const tier = tierFor(score);

    let share;
    if (fromPapers && unitPaperMarks[ch.unit] > 0) {
      share = (evidence.byChapter[ch.no] ?? 0) / unitPaperMarks[ch.unit];
    } else {
      const even = 1 / unitChapters[ch.unit];
      const byQuestions = counts[i] / unitQuestions[ch.unit];
      share = MODEL.marksEvenShare * even + (1 - MODEL.marksEvenShare) * byQuestions;
    }

    const exercises = ch.exercises.map((e, index) => {
      const ex = Array.isArray(e) ? { ex: e[0], q: e[1], builds: [] } : e;
      const seen = evidence.byExercise[exerciseKey(ch.no, ex.ex)] ?? 0;
      const yieldLevel = !fromPapers ? 2 : seen >= MODEL.highYieldMarks ? 3 : seen > 0 ? 2 : 1;
      return { ...ex, builds: ex.builds ?? [], index, seenMarks: seen, yield: yieldLevel };
    });

    return {
      ...ch,
      exercises,
      exerciseOrder: orderExercises(exercises),
      questions: counts[i],
      unitName: unit.name,
      unitMarks: unit.marks,
      volumeScore: vol[i],
      conceptScore,
      score,
      tier,
      diff: TIER_TO_DIFF[tier],
      marksEst: unit.marks * share,
      marksSource: fromPapers ? "papers" : "unit split",
      hours: chapterHours(ch),
    };
  });

  const totalHours = chapters.reduce((t, c) => t + c.hours.total, 0);
  chapters.forEach((c) => { c.workloadShare = c.hours.total / totalHours; });

  return {
    ...syl,
    chapters,
    byId: Object.fromEntries(chapters.map((c) => [c.id, c])),
    evidence,
    totalQuestions: counts.reduce((a, b) => a + b, 0),
    totalHours,
  };
}

const analysedCache = new Map();
/* Analysed syllabus by id, or null. Computed once per session. */
export function getSyllabus(id) {
  if (!analysedCache.has(id)) {
    const raw = SYLLABI.find((s) => s.id === id);
    analysedCache.set(id, raw ? analyseSyllabus(raw) : null);
  }
  return analysedCache.get(id);
}

/* Minutes of practice for one exercise, for this student. */
export function exerciseMinutes(ch, ex, factor = 1, paceMult = 1) {
  return ex.q * MODEL.minutesPerQuestion(ch.concept) * factor * paceMult;
}

/* ---------------------- readiness multiplier ----------------------
   How many times the expected hours this student needs.

   from confidence  = 1.6 − 0.16 × confidence (1–5)   → 1.44 … 0.80
                      (this is the app's original rule, unchanged)
   from last score  = 1.6 − 0.008 × score (0–100)     → 1.60 … 0.80
                      (60% gives 1.12, the same as confidence 3)

   multiplier = 0.4 × from confidence + 0.6 × from score
   The score is real evidence, so it counts for more.

   Overconfident (confidence 4+ but score under 60): the self-rating is
   ignored and the score alone decides, because the two disagree.     */
export function readinessFactor(confidence, lastScore) {
  const conf = clamp(Number.isFinite(confidence) ? confidence : 3, 1, 5);
  const score = clamp(Number.isFinite(lastScore) ? lastScore : 60, 0, 100);
  const fromConfidence = 1.6 - 0.16 * conf;
  const fromScore = 1.6 - 0.008 * score;
  const overconfident = conf >= 4 && score < 60;
  const weights = overconfident ? { confidence: 0, score: 1 } : { confidence: 0.4, score: 0.6 };
  const factor = weights.confidence * fromConfidence + weights.score * fromScore;
  return { factor, fromConfidence, fromScore, overconfident, weights, confidence: conf, score };
}

/* Hours a day needed to finish `needHours` in `studyDays` days that have
   study time in them. null when there are no study days left. */
export function dailyNeed(needHours, studyDays) {
  if (!(studyDays > 0)) return null;
  return Math.max(0, needHours) / studyDays;
}

/* ------------------------ fastest way to a target ------------------------
   chapters: [{ id, marks, hours, needs: [ids], secured }]
     secured = already done (or not on the to-do list); costs nothing.
   targetMarks: the score you want, out of the paper's total.

   You won't score every mark in a chapter you've prepared, so the plan
   has to cover targetMarks / secureRate worth of chapters.

   Picks the set of unsecured chapters with the fewest hours that gets
   there, never taking a chapter without what it needs. It tries every
   set (13 chapters is 8,192 sets), so the answer is the true minimum,
   not a rule of thumb. Ties go to more marks, then fewer chapters.
   Then cheap skipped chapters go back in as margin (see below).        */
export function planForTarget(chapters, targetMarks, secureRate = MODEL.secureRate) {
  const byId = Object.fromEntries(chapters.map((c) => [c.id, c]));
  const securedMarks = chapters.filter((c) => c.secured).reduce((t, c) => t + c.marks, 0);
  const cands = chapters.filter((c) => !c.secured);
  const needCover = targetMarks / secureRate;

  const ok = (set) =>
    [...set].every((id) => (byId[id].needs ?? []).every((n) => !byId[n] || byId[n].secured || set.has(n)));

  let best = null;
  if (cands.length <= 20) {
    const total = 1 << cands.length;
    for (let mask = 0; mask < total; mask++) {
      const set = new Set();
      let hours = 0, marks = securedMarks;
      for (let i = 0; i < cands.length; i++) {
        if (mask & (1 << i)) { set.add(cands[i].id); hours += cands[i].hours; marks += cands[i].marks; }
      }
      if (marks + 1e-9 < needCover || !ok(set)) continue;
      if (
        !best ||
        hours < best.hours - 1e-9 ||
        (Math.abs(hours - best.hours) < 1e-9 && (marks > best.marks + 1e-9 ||
          (Math.abs(marks - best.marks) < 1e-9 && set.size < best.set.size)))
      ) {
        best = { set, hours, marks };
      }
    }
  }

  /* Too many chapters to try every set (a long pasted list): take the most
     marks per hour first, each only once what it needs is in. Close to the
     minimum, not guaranteed to be it. */
  if (cands.length > 20) {
    const set = new Set();
    let hours = 0, marks = securedMarks;
    const rest = [...cands].sort((a, b) => b.marks / Math.max(b.hours, 1e-6) - a.marks / Math.max(a.hours, 1e-6));
    while (marks + 1e-9 < needCover) {
      const next = rest.find((c) => !set.has(c.id) && ok(new Set([...set, c.id])));
      if (!next) break;
      set.add(next.id); hours += next.hours; marks += next.marks;
    }
    if (marks + 1e-9 >= needCover) best = { set, hours, marks };
  }

  const feasible = !!best;
  if (!best) {
    // even everything isn't enough (or too many chapters to search): do it all
    const set = new Set(cands.map((c) => c.id));
    best = { set, hours: cands.reduce((t, c) => t + c.hours, 0), marks: securedMarks + cands.reduce((t, c) => t + c.marks, 0) };
  }

  /* The minimum sits right on the edge of the target. A skipped chapter
     that costs fewer hours per mark than the plan already pays is cheap
     safety margin, so it goes back in (cheapest first, one at a time,
     only once what it needs is in). */
  const extras = [];
  if (feasible) {
    for (;;) {
      const planMarks = best.marks - securedMarks;
      const rate = best.hours > 0 ? planMarks / best.hours : Infinity;
      const pick = cands
        .filter((c) => !best.set.has(c.id) && ok(new Set([...best.set, c.id])))
        .filter((c) => c.hours <= 0 || c.marks / c.hours > rate + 1e-9)
        .sort((a, b) => b.marks / Math.max(b.hours, 1e-6) - a.marks / Math.max(a.hours, 1e-6))[0];
      if (!pick) break;
      best.set.add(pick.id);
      best.hours += pick.hours;
      best.marks += pick.marks;
      extras.push(pick.id);
    }
  }

  /* Study order: what a chapter needs comes first; otherwise the most
     marks per hour first, so the early weeks bank the cheapest marks. */
  const done = new Set(chapters.filter((c) => c.secured).map((c) => c.id));
  const left = cands.filter((c) => best.set.has(c.id));
  const order = [];
  while (left.length) {
    const ready = left.filter((c) => (c.needs ?? []).every((n) => !byId[n] || done.has(n)));
    const pool = ready.length ? ready : left;
    pool.sort((a, b) => b.marks / Math.max(b.hours, 1e-6) - a.marks / Math.max(a.hours, 1e-6));
    const next = pool[0];
    order.push(next.id);
    done.add(next.id);
    left.splice(left.indexOf(next), 1);
  }

  return {
    feasible,
    order,
    extras,
    skipped: cands.filter((c) => !best.set.has(c.id)).map((c) => c.id),
    hours: best.hours,
    coveredMarks: best.marks,
    securedMarks,
    expectedMarks: best.marks * secureRate,
    needCover,
    secureRate,
  };
}
