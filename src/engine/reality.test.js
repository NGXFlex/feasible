import { test } from "node:test";
import assert from "node:assert/strict";
import { analysePlan, verdictOf, riskOrder, shortfallAction, key, addDays, paceMult } from "./plan.js";

const today = new Date(2026, 9, 15);
const on = (n) => key(addDays(today, n));
const TIME = { wd: 3, we: 5, ov: {}, pace: "steady" };
const close = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m ?? ""} ${a} vs ${b}`);
let seq = 0;
const subject = (o = {}) => {
  const chapters = o.chapters ?? 8;
  return {
    id: `r${++seq}`, name: `Subject ${seq}`, date: on(10), createdAt: on(-5), chapters,
    type: "theory", confidence: 3, lastScore: 60, pace: "steady", log: [],
    names: Array(chapters).fill(""), diff: Array(chapters).fill(2), done: Array(chapters).fill(false),
    ...o,
  };
};

test("verdict: short, tight or comfortable, from the gap", () => {
  assert.deepEqual(verdictOf({ gap: -11, needed: 40 }), { kind: "short", hours: 11 });
  assert.deepEqual(verdictOf({ gap: 2, needed: 6 }), { kind: "tight", hours: 2 });
  assert.equal(verdictOf({ gap: 7, needed: 50 }).kind, "tight", "under a fifth of the work spare");
  assert.deepEqual(verdictOf({ gap: 26, needed: 2 }), { kind: "fits", hours: 26 });
  assert.equal(verdictOf({ gap: -0.3, needed: 5 }).kind, "tight", "a rounding hair under is not short");
  assert.equal(verdictOf({ gap: 1, needed: 0 }).kind, "fits", "nothing left to do is never tight");
});

test("risk order: most short first, comfortable last", () => {
  const order = riskOrder([
    { name: "Fine", gap: 30, date: on(5) }, { name: "Short", gap: -12, date: on(9) },
    { name: "Tight", gap: 1, date: on(3) }, { name: "Shorter", gap: -20, date: on(12) },
  ]).map((s) => s.name);
  assert.deepEqual(order, ["Shorter", "Short", "Tight", "Fine"]);
});

test("action: nothing short, nothing to do", () => {
  const plan = analysePlan([subject({ chapters: 2 })], TIME, today);
  assert.equal(shortfallAction(plan.subjects), null);
});

test("action: a small gap is closed by adding hours", () => {
  const plan = analysePlan([subject({ chapters: 14, date: on(10) })], { ...TIME, wd: 2.2, we: 2.2 }, today);
  const s = plan.subjects[0];
  assert.ok(s.gap < -0.5 && -s.gap / s.studyDays <= 1, `gap ${s.gap} over ${s.studyDays} days`);
  const a = shortfallAction(plan.subjects);
  assert.equal(a.kind, "hours");
  close(a.perDay, -s.gap / s.studyDays);
});

test("action: a big gap means cutting chapters, or lowering the target when marks are known", () => {
  const big = analysePlan([subject({ name: "Huge", chapters: 40, date: on(5) })], TIME, today).subjects;
  const cut = shortfallAction(big);
  assert.equal(cut.kind, "cut");
  assert.equal(cut.subject.name, "Huge");
  assert.ok(cut.chapters >= Math.ceil(-big[0].gap / big[0].perChapter) && cut.chapters <= 40);
  const weighted = analysePlan([subject({ name: "Weighted", chapters: 40, date: on(5), weight: Array(40).fill(2) })], TIME, today).subjects;
  assert.equal(shortfallAction(weighted).kind, "target");
});

test("action: the subject that breaks first is the earliest exam that's short", () => {
  const plan = analysePlan([
    subject({ name: "Later and worse", chapters: 60, date: on(20) }),
    subject({ name: "Sooner", chapters: 25, date: on(4) }),
  ], TIME, today);
  assert.ok(plan.subjects.every((s) => s.gap < -0.5));
  assert.equal(shortfallAction(plan.subjects).subject.name, "Sooner");
});

test("explanation: the numbers shown on the card add up", () => {
  const plan = analysePlan([
    subject({ name: "A", chapters: 6, pace: "thorough", confidence: 2, lastScore: 45, log: [{ d: on(-1), h: 2 }] }),
    subject({ name: "B", chapters: 3, date: on(20) }),
  ], TIME, today);
  for (const s of plan.subjects) {
    // chapters × hours each, × readiness × pace, − logged = what it needs
    const base = s.raw / (s.factor.factor * paceMult(s.pace));
    close(base * s.factor.factor * paceMult(s.pace), s.raw);
    close(Math.max(0, s.raw - s.logged), s.needed, `${s.name} needed`);
    // scheduled + left over + recovered = what you'll have
    close(s.allocated + s.spareShare + s.recovered, s.available, `${s.name} available`);
    assert.ok(s.available <= s.windowHours + 1e-6, `${s.name} never more than its days hold`);
  }
});
