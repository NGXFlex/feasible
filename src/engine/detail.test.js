import { test } from "node:test";
import assert from "node:assert/strict";
import { analysePlan, hoursLeft, key, addDays } from "./plan.js";
import { planForTarget, dailyNeed } from "./syllabusEngine.js";
import { pctOf, coverage, roundHours } from "./format.js";

/* The subject detail screen: chapter hours, logged hours, hours left and
   coverage come from one base and reconcile exactly. */
const today = new Date(2026, 9, 16, 10, 0);
const on = (n) => key(addDays(today, n));
const TIME = { wd: 3, we: 5, ov: {}, pace: "steady" };
const subject = (o = {}) => {
  const chapters = o.chapters ?? 10;
  return {
    id: "d1", name: "123", date: on(13), createdAt: on(-5), chapters,
    type: "theory", confidence: 3, lastScore: 60, pace: "steady", log: [],
    names: Array(chapters).fill(""), diff: Array(chapters).fill(2), done: Array(chapters).fill(false),
    ...o,
  };
};
const one = (o) => analysePlan([subject(o)], TIME, today).subjects[0];
const tenths = (h) => Math.round(h * 10);   // compare sums without float noise

test("the reported subject: ten chapters shown at 2h, 10h logged, leaves 10h", () => {
  // a readiness multiplier just under 1 used to leave chapters at e.g. 1.95h, shown as "2h"
  const s = one({ log: [{ d: on(-1), h: 10 }] });
  assert.ok(s.costs.every((c) => c === roundHours(c)), "each chapter is held at the precision it's shown at");
  assert.equal(s.raw, s.costs.reduce((t, c) => t + tenths(c), 0) / 10);
  assert.equal(s.needed, s.raw - 10);
});

const cases = [
  {}, { log: [{ d: on(-1), h: 10 }] }, { log: [{ d: on(-2), h: 3.25 }, { d: on(0), h: 25 / 60 }] },
  { confidence: 1, lastScore: 30, pace: "thorough", diff: [1, 2, 3, 3, 2, 1, 2, 3, 1, 2] },
  { confidence: 5, lastScore: 95, log: [{ d: on(-1), h: 400 }] },
  { done: [true, true, false, false, false, false, false, false, false, false], log: [{ d: on(-1), h: 7 }] },
  { chapters: 3, done: [true, true, true] },
  { chapters: 0 },
  { type: "problem", weight: [3, 1, 2, 2, 1, 1, 3, 2, 1, 2], log: [{ d: on(-1), h: 6.6 }] },
];

test("unfinished chapter costs − logged hours = hours left, exactly", () => {
  for (const o of cases) {
    const s = one(o);
    const unfinished = s.costs.reduce((t, c, i) => (s.done[i] ? t : t + tenths(c)), 0) / 10;
    assert.equal(s.raw, unfinished, "the chapter list adds up to the pre-logged total");
    assert.equal(s.needed, Math.max(0, unfinished - s.logged), "hours left");
    assert.equal(s.needed, hoursLeft(s.raw, s.logged));
  }
});

test("no figure takes logged hours off more than once", () => {
  for (const o of cases) {
    const s = one(o);
    // hours left + logged is the pre-logged work again (unless logged covers it all)
    if (s.logged <= s.raw) assert.ok(Math.abs(s.needed + s.logged - s.raw) < 1e-9, "needed + logged = work");
    // the per-day figure divides hours left, not hours left − logged again
    if (s.perDay != null) assert.ok(Math.abs(s.perDay - dailyNeed(s.needed, s.studyDays)) < 1e-9);
    // the fastest plan, at a target needing every chapter, lands on the same hours left
    if (s.chapterMarks) {
      const all = planForTarget(s.chapterMarks.map((m, i) => ({ id: i, marks: m, hours: s.costs[i], needs: [], secured: !!s.done[i] })), 100);
      assert.ok(Math.abs(hoursLeft(all.hours, s.logged) - s.needed) < 1e-6, "target plan for everything = hours left");
    }
  }
});

test("hours left, logged hours and coverage reconcile", () => {
  for (const o of cases) {
    const s = one(o);
    const covered = s.work - s.needed;   // ticked chapters + logged hours that count
    assert.ok(s.coveredPct >= 0 && s.coveredPct <= 100, `coverage ${s.coveredPct}`);
    if (s.work > 0) assert.ok(Math.abs(s.coveredPct - (covered / s.work) * 100) < 1e-9);
    assert.equal(s.covered, s.needed <= 1e-9, "done exactly when nothing is left");
    if (s.covered) {
      assert.equal(s.coverLabel, "Done");
      assert.equal(s.needed, 0);
      assert.ok(s.perDay == null || s.perDay === 0, "nothing left means nothing a day");
    } else {
      assert.ok(parseInt(s.coverLabel) <= 99, "never shows 100% before it's done");
    }
  }
});

test("percentages never go below 0 or above 100", () => {
  assert.equal(pctOf(125, 100), 100);
  assert.equal(pctOf(8.5, 1.1), 100);
  assert.equal(pctOf(-3, 10), 0);
  assert.equal(pctOf(5, 0), 100, "nothing to do is fully covered");
  assert.equal(pctOf(NaN, 10), 0);
  assert.deepEqual([coverage(12.5, 10).label, coverage(9.99, 10).label, coverage(5, 10).label], ["Done", "99%", "50%"]);
});
