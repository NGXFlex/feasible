import { test } from "node:test";
import assert from "node:assert/strict";
import { todayPlan, analysePlan, rankByUrgency, key, addDays } from "./plan.js";

const today = new Date(2026, 9, 15, 10, 30);   // Thu 15 Oct 2026, mid-morning
const on = (n) => key(addDays(today, n));
const TIME = { wd: 3, we: 5, ov: {}, pace: "steady" };
const close = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-6, `${m ?? ""} ${a} vs ${b}`);
let seq = 0;
const subject = (o = {}) => {
  const chapters = o.chapters ?? 8;
  return {
    id: `t${++seq}`, name: `Subject ${seq}`, date: on(10), createdAt: on(-5), chapters,
    type: "theory", confidence: 3, lastScore: 60, pace: "steady", log: [],
    names: Array(chapters).fill(""), diff: Array(chapters).fill(2), done: Array(chapters).fill(false),
    ...o,
  };
};

test("today: the hours are the simulation's shares for today", () => {
  const subjects = [subject({ date: on(5), chapters: 12 }), subject({ date: on(20), chapters: 6 })];
  const t = todayPlan(subjects, TIME, today);
  const plan = analysePlan(subjects, TIME, today);
  for (const s of plan.subjects) {
    const share = s.days.filter((x) => key(x.d) === key(today)).reduce((a, x) => a + x.h, 0);
    close(t.rows.find((r) => r.id === s.id).planned, share, s.name);
  }
  close(t.planned, t.rows.reduce((a, r) => a + r.planned, 0));
  assert.ok(t.planned <= t.capacity + 1e-9, "never more than today's hours");
  assert.equal(t.capacity, 3);
});

test("today: rows come in priority order (most needed per day first)", () => {
  const subjects = [subject({ name: "Light", date: on(25), chapters: 3 }), subject({ name: "Heavy", date: on(6), chapters: 14 })];
  const t = todayPlan(subjects, TIME, today);
  assert.deepEqual(t.rows.map((r) => r.name), rankByUrgency(analysePlan(subjects, TIME, today).subjects).map((s) => s.name));
  assert.equal(t.rows[0].name, "Heavy");
});

test("today: time logged today comes off today's share, and doesn't shrink the plan for today", () => {
  const s = subject({ date: on(8), chapters: 4 });   // a share well under the day's 3h, so it can move
  assert.ok(todayPlan([s], TIME, today).planned < 3);
  const before = todayPlan([s], TIME, today);
  const after = todayPlan([{ ...s, log: [{ d: on(0), h: 1 }] }], TIME, today);
  close(after.planned, before.planned, "planned stays");
  close(after.done, 1);
  close(after.left, Math.max(0, before.planned - 1));
  // hours logged before today do lower today's share
  const earlier = todayPlan([{ ...s, log: [{ d: on(-1), h: 4 }] }], TIME, today);
  assert.ok(earlier.planned < before.planned);
});

test("today: a day with no study time, and no subjects, are zero", () => {
  const off = todayPlan([subject()], { ...TIME, ov: { [on(0)]: 0 } }, today);
  assert.equal(off.planned, 0);
  assert.equal(off.capacity, 0);
  const none = todayPlan([], TIME, today);
  assert.deepEqual([none.planned, none.left, none.rows.length], [0, 0, 0]);
  const passed = todayPlan([subject({ date: on(-2) })], TIME, today);
  assert.equal(passed.rows.length, 0);
});
