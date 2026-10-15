import { test } from "node:test";
import assert from "node:assert/strict";
import { NCERT12_MATHS } from "../syllabus/ncert12Maths.js";
import {
  analyseSyllabus, getSyllabus, questionCount, readinessFactor, dailyNeed, tierFor, MODEL,
  paperEvidence, planForTarget, exerciseKey,
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

/* ------------------------- sample papers ------------------------- */

test("each CBSE sample paper has 38 questions worth 80 marks, in the published sections", () => {
  const sections = [[1, 20, 1], [21, 25, 2], [26, 31, 3], [32, 35, 5], [36, 38, 4]];
  for (const p of NCERT12_MATHS.papers) {
    assert.equal(p.questions.length, 38, p.id);
    assert.equal(p.questions.reduce((t, q) => t + q[1], 0), 80, p.id);
    for (const [from, to, marks] of sections) {
      for (const q of p.questions.filter(([n]) => +n >= from && +n <= to)) {
        assert.equal(q[1], marks, `${p.id} Q${q[0]}`);
      }
    }
  }
});

test("every exercise a paper question is tagged with exists in the book", () => {
  const keys = new Set(NCERT12_MATHS.chapters.flatMap((c) => c.exercises.map((e) => exerciseKey(c.no, e.ex))));
  for (const p of NCERT12_MATHS.papers) {
    for (const [n, , ...alts] of p.questions) {
      assert.ok(alts.length >= 1, `${p.id} Q${n} has no tag`);
      for (const k of alts.flatMap((a) => a.split("+"))) assert.ok(keys.has(k), `${p.id} Q${n}: ${k}`);
    }
  }
});

test("each paper's marks per unit match the official CBSE unit marks", () => {
  const unitOfNo = Object.fromEntries(NCERT12_MATHS.chapters.map((c) => [c.no, c.unit]));
  for (const p of paperEvidence(NCERT12_MATHS).papers) {
    const perUnit = {};
    for (const [no, m] of Object.entries(p.byChapter)) perUnit[unitOfNo[no]] = (perUnit[unitOfNo[no]] ?? 0) + m;
    for (const u of NCERT12_MATHS.units) assert.ok(near(perUnit[u.id] ?? 0, u.marks), `${p.id} ${u.name}: ${perUnit[u.id]}`);
  }
});

test("chapter marks are the sample-paper average", () => {
  const expected = { 1: 4.5, 2: 3.5, 3: 3.25, 4: 6.75, 5: 8.5, 6: 8, 7: 9.25, 8: 3.75, 9: 5.5, 10: 6, 11: 8, 12: 5, 13: 8 };
  for (const c of syl.chapters) {
    assert.ok(near(c.marksEst, expected[c.no]), `chapter ${c.no}: ${c.marksEst}`);
    assert.equal(c.marksSource, "papers");
  }
});

test("without sample papers, chapter marks fall back to splitting each unit", () => {
  const bare = analyseSyllabus({ ...NCERT12_MATHS, papers: [] });
  for (const u of NCERT12_MATHS.units) {
    const sum = bare.chapters.filter((c) => c.unit === u.id).reduce((t, c) => t + c.marksEst, 0);
    assert.ok(near(sum, u.marks));
  }
  assert.equal(bare.chapters[0].marksSource, "unit split");
});

/* ------------------------- exercise order ------------------------- */

test("exercise lists: builds point to exercises in the same chapter, never themselves", () => {
  for (const c of syl.chapters) {
    const labels = new Set(c.exercises.map((e) => e.ex));
    for (const e of c.exercises) {
      for (const b of e.builds) {
        assert.ok(labels.has(b), `${c.name} ${e.ex} builds on unknown ${b}`);
        assert.notEqual(b, e.ex);
      }
    }
  }
});

test("exercise order: every exercise once, never before what it builds on, Miscellaneous last", () => {
  for (const c of syl.chapters) {
    const order = c.exerciseOrder.map((e) => e.ex);
    assert.equal(order.length, c.exercises.length, c.name);
    assert.equal(new Set(order).size, order.length, c.name);
    order.forEach((ex, i) => {
      for (const b of c.exercises.find((e) => e.ex === ex).builds) {
        assert.ok(order.indexOf(b) < i, `${c.name}: ${ex} comes before ${b}`);
      }
    });
    if (order.includes("Misc")) assert.equal(order.at(-1), "Misc", c.name);
  }
});

test("exercise order: high-yield groundwork comes before low-yield side topics", () => {
  const order = (no) => syl.chapters.find((c) => c.no === no).exerciseOrder.map((e) => e.ex);
  // Determinants: area of a triangle (never in either paper) waits until the inverse/systems path is done
  assert.deepEqual(order(4), ["4.1", "4.3", "4.4", "4.5", "4.2", "Misc"]);
  // Integrals: definite-integral properties (a 5-mark question in both papers) right after its groundwork
  assert.deepEqual(order(7).slice(0, 4), ["7.1", "7.2", "7.8", "7.10"]);
});

/* -------------------------- 75% planner -------------------------- */

const f112 = readinessFactor(3, 60).factor;
const planInput = (securedNos = []) =>
  syl.chapters.map((c) => ({ id: c.id, marks: c.marksEst, hours: c.hours.total * f112, needs: c.needs, secured: securedNos.includes(c.no) }));

/* independent brute force: the fewest hours that reach the cover, prerequisites respected */
function bruteMinHours(input, targetMarks, rate = MODEL.secureRate) {
  const byId = Object.fromEntries(input.map((c) => [c.id, c]));
  const cands = input.filter((c) => !c.secured);
  const secured = input.filter((c) => c.secured).reduce((t, c) => t + c.marks, 0);
  let best = Infinity;
  for (let mask = 0; mask < 1 << cands.length; mask++) {
    const chosen = cands.filter((_, i) => mask & (1 << i));
    const ids = new Set(chosen.map((c) => c.id));
    const okNeeds = chosen.every((c) => c.needs.every((n) => byId[n].secured || ids.has(n)));
    const marks = secured + chosen.reduce((t, c) => t + c.marks, 0);
    if (okNeeds && marks * rate + 1e-9 >= targetMarks) best = Math.min(best, chosen.reduce((t, c) => t + c.hours, 0));
  }
  return best;
}

test("75% plan reaches the target with margin, respects prerequisites, and is the true minimum before extras", () => {
  const input = planInput();
  const plan = planForTarget(input, 60);
  assert.equal(plan.feasible, true);
  assert.ok(plan.expectedMarks >= 60 - 1e-9);
  const byId = Object.fromEntries(input.map((c) => [c.id, c]));
  const extraHours = plan.extras.reduce((t, id) => t + byId[id].hours, 0);
  assert.ok(near(plan.hours - extraHours, bruteMinHours(input, 60), 1e-6));
  // prerequisites: every chosen chapter's needs come earlier in the study order
  plan.order.forEach((id, i) => {
    for (const n of byId[id].needs) assert.ok(plan.order.indexOf(n) > -1 && plan.order.indexOf(n) < i, `${id} needs ${n}`);
  });
  // for this syllabus the cheapest way to 75% leaves out Differential Equations
  assert.deepEqual(plan.skipped, ["m12-09"]);
});

test("planner: extras are only chapters cheaper per mark than the plan without them", () => {
  const input = planInput();
  const byId = Object.fromEntries(input.map((c) => [c.id, c]));
  for (const pct of [50, 60, 70, 75, 80]) {
    const plan = planForTarget(input, 80 * pct / 100);
    const extraHours = plan.extras.reduce((t, id) => t + byId[id].hours, 0);
    const extraMarks = plan.extras.reduce((t, id) => t + byId[id].marks, 0);
    const baseRate = (plan.coveredMarks - extraMarks - plan.securedMarks) / (plan.hours - extraHours);
    for (const id of plan.extras) assert.ok(byId[id].marks / byId[id].hours > baseRate, `${pct}%: ${id}`);
  }
});

test("planner: done chapters count as secured and cost nothing", () => {
  const fresh = planForTarget(planInput(), 60);
  const withDone = planForTarget(planInput([7, 12, 13]), 60);
  assert.ok(withDone.hours < fresh.hours);
  assert.ok(!withDone.order.includes("m12-07"));
  assert.ok(near(withDone.securedMarks, 9.25 + 5 + 8));
});

test("planner: an unreachable target says so and plans everything", () => {
  const plan = planForTarget(planInput(), 80 * 0.9);   // 90% needs more than 85% of the whole paper
  assert.equal(plan.feasible, false);
  assert.equal(plan.skipped.length, 0);
  assert.ok(near(plan.coveredMarks, 80));
});

test("planner: nothing to do when the target is already covered", () => {
  const plan = planForTarget(planInput([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]), 60);
  assert.equal(plan.feasible, true);
  assert.equal(plan.order.length, 0);
  assert.equal(plan.hours, 0);
});

test("planner: more than 20 chapters still finds a plan that reaches the target", () => {
  // 30 chapters worth 100 marks, a long pasted list: too many to try every set
  const input = Array.from({ length: 30 }, (_, i) => ({ id: i, marks: (i % 3 + 1) * 100 / 60, hours: 2 + (i % 5) }));
  const plan = planForTarget(input, 60);
  assert.equal(plan.feasible, true);
  assert.ok(plan.coveredMarks + 1e-9 >= 60 / MODEL.secureRate);
  assert.ok(plan.skipped.length > 0);
  assert.equal(plan.order.length + plan.skipped.length, 30);
});
