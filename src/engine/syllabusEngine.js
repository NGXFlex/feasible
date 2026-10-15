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
  marksEvenShare: 2 / 3,                   // unit marks split mostly evenly, the rest by question share
};

/* The app stores difficulty as 1 / 2 / 3 */
export const TIER_TO_DIFF = { easy: 1, medium: 2, hard: 3 };

export const questionCount = (ch) => ch.exercises.reduce((t, [, n]) => t + n, 0);

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

/* Adds questions, difficulty tier, estimated marks and hours to every chapter. */
export function analyseSyllabus(syl) {
  const counts = syl.chapters.map(questionCount);
  const vol = volumeScores(counts);
  const units = Object.fromEntries(syl.units.map((u) => [u.id, u]));

  const unitQuestions = {};
  const unitChapters = {};
  syl.chapters.forEach((ch, i) => {
    unitQuestions[ch.unit] = (unitQuestions[ch.unit] ?? 0) + counts[i];
    unitChapters[ch.unit] = (unitChapters[ch.unit] ?? 0) + 1;
  });

  const chapters = syl.chapters.map((ch, i) => {
    const unit = units[ch.unit];
    const conceptScore = (ch.concept - 1) / 4;
    const score = MODEL.volumeWeight * vol[i] + (1 - MODEL.volumeWeight) * conceptScore;
    const tier = tierFor(score);

    // CBSE publishes marks per unit only. Split them mostly evenly between the
    // unit's chapters, nudged by each chapter's share of the unit's questions.
    const even = 1 / unitChapters[ch.unit];
    const byQuestions = counts[i] / unitQuestions[ch.unit];
    const share = MODEL.marksEvenShare * even + (1 - MODEL.marksEvenShare) * byQuestions;

    return {
      ...ch,
      questions: counts[i],
      unitName: unit.name,
      unitMarks: unit.marks,
      volumeScore: vol[i],
      conceptScore,
      score,
      tier,
      diff: TIER_TO_DIFF[tier],
      marksEst: unit.marks * share,
      hours: chapterHours(ch),
    };
  });

  const totalHours = chapters.reduce((t, c) => t + c.hours.total, 0);
  chapters.forEach((c) => { c.workloadShare = c.hours.total / totalHours; });

  return {
    ...syl,
    chapters,
    byId: Object.fromEntries(chapters.map((c) => [c.id, c])),
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
