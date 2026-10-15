import { test } from "node:test";
import assert from "node:assert/strict";
import { analysePlan, todayPlan, upcomingDays, hoursBetween, key, addDays } from "./plan.js";

/* Five subjects with overlapping windows: two sharing an exam date, one far
   out, one with every chapter done, one with more logged than it needs. */
const today = new Date(2026, 9, 15, 10, 30);
const on = (n) => key(addDays(today, n));
const TIME = { wd: 3, we: 5, ov: {}, pace: "steady" };
const EPS = 1e-6;
let seq = 0;
const subject = (o = {}) => {
  const chapters = o.chapters ?? 8;
  return {
    id: `m${++seq}`, name: `Subject ${seq}`, date: on(10), createdAt: on(-5), chapters,
    type: "theory", confidence: 3, lastScore: 60, pace: "steady", log: [],
    names: Array(chapters).fill(""), diff: Array(chapters).fill(2), done: Array(chapters).fill(false),
    ...o,
  };
};
const five = () => [
  subject({ name: "Physics", date: on(9), chapters: 10 }),
  subject({ name: "Chemistry", date: on(9), chapters: 7 }),
  subject({ name: "English", date: on(60), chapters: 12 }),
  subject({ name: "Maths", date: on(14), chapters: 6, done: Array(6).fill(true) }),
  subject({ name: "Biology", date: on(12), chapters: 3, log: [{ d: on(-2), h: 40 }, { d: on(0), h: 8.5 }] }),
];

for (const [label, time] of [["normal hours", TIME], ["very little time", { ...TIME, wd: 1, we: 1 }]]) {
  test(`five subjects (${label}): available hours never exceed capacity, spare adds up`, () => {
    const plan = analysePlan(five(), time, today);
    const last = plan.subjects.reduce((a, s) => (s.date > a ? s.date : a), on(0));
    const capacity = hoursBetween(today, last, time.wd, time.we, time.ov);
    const avail = plan.subjects.reduce((t, s) => t + s.available, 0);
    assert.ok(avail <= capacity + EPS, `available ${avail} of ${capacity}`);
    for (const s of plan.subjects) assert.ok(s.available <= s.windowHours + EPS, `${s.name} within its window`);
    const positive = plan.subjects.reduce((t, s) => t + Math.max(0, s.gap), 0);
    assert.ok(Math.abs(positive - plan.spare) < 1e-6, `positive gaps ${positive} vs spare ${plan.spare}`);
    // nothing left to study: nothing needed, never short
    for (const name of ["Maths", "Biology"]) {
      const s = plan.subjects.find((x) => x.name === name);
      assert.equal(s.needed, 0, name);
      assert.ok(s.gap >= 0, name);
    }
  });
}

test("five subjects: today's figures reconcile, however much is logged", () => {
  const subjects = five();
  const d = todayPlan(subjects, TIME, today);
  assert.ok(d.planned <= d.capacity + EPS);
  assert.ok(Math.abs(d.left - d.rows.reduce((t, r) => t + r.left, 0)) < EPS);
  assert.ok(d.progress >= 0 && d.progress <= 1);
  // log far beyond the plan on every subject: done, never over 100%
  const over = subjects.map((s) => ({ ...s, log: [...s.log, { d: on(0), h: 20 }] }));
  const t = todayPlan(over, TIME, today);
  assert.equal(t.progress, 1);
  assert.equal(t.met, true);
  assert.equal(t.left, 0);
  assert.ok(Math.abs(t.planned - d.planned) < EPS, "today's plan is fixed for the day");
  // over-logging one subject doesn't cover another's share
  const one = subjects.map((s, i) => (i === 0 ? { ...s, log: [{ d: on(0), h: 50 }] } : s));
  const u = todayPlan(one, TIME, today);
  assert.equal(u.met, u.rows.slice(1).every((r) => r.planned <= EPS));
  assert.ok(u.progress < 1 || u.met);
});

test("five subjects: the next days share no more than each day holds", () => {
  const plan = analysePlan(five(), TIME, today);
  const days = upcomingDays(plan.subjects, TIME, today, 3);
  assert.equal(days.length, 3);
  days.forEach((d, i) => {
    assert.equal(key(d.date), on(i + 1));
    assert.ok(d.planned <= d.capacity + EPS);
    assert.ok(d.rows.every((r, j) => j === 0 || r.h <= d.rows[j - 1].h + EPS), "biggest share first");
    assert.ok(!d.rows.some((r) => r.name === "Maths"), "a finished subject gets no time");
  });
});

test("logging hours lowers what a subject needs, never what any subject has", () => {
  const two = [subject({ name: "A", date: on(8), chapters: 9 }), subject({ name: "B", date: on(15), chapters: 6 })];
  const before = analysePlan(two, TIME, today).subjects;
  const cases = [
    [{ d: on(0), h: 2 }], [], 
    [{ d: on(-3), h: 5 }, { d: on(0), h: 1.5 }],
    [{ d: on(-1), h: 500 }],   // far more than it needs
  ];
  for (const logA of cases) for (const logB of [[], [{ d: on(0), h: 3 }]]) {
    const after = analysePlan([{ ...two[0], log: logA }, { ...two[1], log: logB }], TIME, today).subjects;
    for (const s of before) {
      const t = after.find((x) => x.id === s.id);
      assert.ok(Math.abs(t.available - s.available) < 1e-9, `${s.name} available ${s.available} -> ${t.available}`);
      assert.ok(Math.abs(t.needed - Math.max(0, s.needed - t.logged)) < 1e-9, `${s.name} needed drops by what's logged`);
    }
  }
});
