import { test } from "node:test";
import assert from "node:assert/strict";
import { NCERT12_MATHS } from "../syllabus/ncert12Maths.js";
import {
  analyseSyllabus, getSyllabus, questionCount, readinessFactor, dailyNeed, tierFor, MODEL,
} from "./syllabusEngine.js";

const syl = analyseSyllabus(NCERT12_MATHS);
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

test("chapter list matches the NCERT book: 13 chapters, numbered 1–13, unique ids", () => {
  assert.equal(syl.chapters.length, 13);
  assert.deepEqual(syl.chapters.map((c) => c.no), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
  assert.equal(new Set(syl.chapters.map((c) => c.id)).size, 13);
});

test("question counts are the ones counted from the 2026-27 NCERT reprint", () => {
  const expected = { 1: 35, 2: 43, 3: 56, 4: 61, 5: 137, 6: 82, 7: 261, 8: 9, 9: 98, 10: 73, 11: 25, 12: 10, 13: 62 };
  for (const c of syl.chapters) assert.equal(c.questions, expected[c.no], `chapter ${c.no}`);
  assert.equal(syl.totalQuestions, 952);
});

test("official CBSE unit marks total 80", () => {
  assert.equal(NCERT12_MATHS.units.reduce((t, u) => t + u.marks, 0), 80);
});

test("estimated chapter marks add back up to each official unit total, and to 80", () => {
  for (const u of NCERT12_MATHS.units) {
    const sum = syl.chapters.filter((c) => c.unit === u.id).reduce((t, c) => t + c.marksEst, 0);
    assert.ok(near(sum, u.marks), `${u.name}: ${sum} vs ${u.marks}`);
  }
  assert.ok(near(syl.chapters.reduce((t, c) => t + c.marksEst, 0), 80));
});

test("a single-chapter unit gets exactly the official unit marks", () => {
  assert.equal(syl.byId["m12-12"].marksEst, 5);   // Linear Programming
  assert.equal(syl.byId["m12-13"].marksEst, 8);   // Probability
});

test("workload shares sum to 100%", () => {
  assert.ok(near(syl.chapters.reduce((t, c) => t + c.workloadShare, 0), 1));
});

test("hours are positive, add up from their parts, and Integrals is the heaviest chapter", () => {
  for (const c of syl.chapters) {
    assert.ok(c.hours.total > 0);
    assert.ok(near(c.hours.total, c.hours.theory + c.hours.practice + c.hours.revision));
  }
  const heaviest = syl.chapters.reduce((a, b) => (b.hours.total > a.hours.total ? b : a));
  assert.equal(heaviest.name, "Integrals");
});

test("difficulty tiers come out as expected for this syllabus", () => {
  const by = (t) => syl.chapters.filter((c) => c.tier === t).map((c) => c.no);
  assert.deepEqual(by("easy"), [1, 8, 12]);
  assert.deepEqual(by("medium"), [2, 3, 4, 10, 11, 13]);
  assert.deepEqual(by("hard"), [5, 6, 7, 9]);
  assert.equal(tierFor(MODEL.tierCut.easy - 0.001), "easy");
  assert.equal(tierFor(MODEL.tierCut.hard), "hard");
});

test("prerequisites exist and always point to an earlier chapter", () => {
  for (const c of syl.chapters) {
    for (const id of c.needs) {
      assert.ok(syl.byId[id], `${c.name} needs unknown ${id}`);
      assert.ok(syl.byId[id].no < c.no, `${c.name} needs a later chapter`);
    }
  }
});

test("getSyllabus returns the analysed syllabus, or null for an unknown id", () => {
  assert.equal(getSyllabus("ncert-12-maths").totalQuestions, 952);
  assert.equal(getSyllabus("nope"), null);
  assert.equal(questionCount({ exercises: [["1", 3], ["Misc", 4]] }), 7);
});

test("readiness: confidence 3 with a 60% score gives 1.12, same as the app's old rule", () => {
  const r = readinessFactor(3, 60);
  assert.ok(near(r.factor, 1.12));
  assert.ok(near(r.factor, 1.6 - 0.16 * 3));
});

test("readiness: a better score or more confidence never needs more hours", () => {
  for (let conf = 1; conf <= 3; conf++) {
    let prev = Infinity;
    for (let score = 0; score <= 100; score += 5) {
      const f = readinessFactor(conf, score).factor;
      assert.ok(f <= prev + 1e-12, `conf ${conf} score ${score}`);
      prev = f;
    }
  }
  for (const score of [60, 75, 100]) {
    let prev = Infinity;
    for (let conf = 1; conf <= 5; conf++) {
      const f = readinessFactor(conf, score).factor;
      assert.ok(f <= prev + 1e-12, `score ${score} conf ${conf}`);
      prev = f;
    }
  }
});

test("readiness: overconfidence is caught and the score decides alone", () => {
  const r = readinessFactor(5, 40);
  assert.equal(r.overconfident, true);
  assert.ok(near(r.factor, r.fromScore));
  assert.ok(r.factor > 0.4 * r.fromConfidence + 0.6 * r.fromScore);   // no discount for the self-rating
  assert.equal(readinessFactor(4, 60).overconfident, false);
  assert.equal(readinessFactor(3, 20).overconfident, false);
});

test("readiness: stays within 0.8–1.6 and clamps bad input", () => {
  for (let conf = 1; conf <= 5; conf++) {
    for (let score = 0; score <= 100; score += 10) {
      const f = readinessFactor(conf, score).factor;
      assert.ok(f >= 0.8 - 1e-12 && f <= 1.6 + 1e-12, `${conf}/${score} → ${f}`);
    }
  }
  assert.ok(near(readinessFactor(9, 400).factor, readinessFactor(5, 100).factor));
  assert.ok(near(readinessFactor(undefined, undefined).factor, readinessFactor(3, 60).factor));
});

test("daily need: hours over study days, or null when no study days are left", () => {
  assert.equal(dailyNeed(30, 10), 3);
  assert.equal(dailyNeed(-5, 10), 0);
  assert.equal(dailyNeed(30, 0), null);
});
