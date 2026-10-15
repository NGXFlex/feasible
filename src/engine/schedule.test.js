import { test } from "node:test";
import assert from "node:assert/strict";
import { shareDays } from "./schedule.js";

const today = new Date(2026, 9, 1);   // 1 Oct 2026
const day = (n) => { const x = new Date(today); x.setDate(x.getDate() + n); return x; };
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

test("schedule: 'you have' counts the spare capacity, not just what was allocated", () => {
  // 10 days of 3.8h = 38h; the subject needs 14h
  const { subjects: [s] } = shareDays([{ need: 14, date: day(10) }], () => 3.8, today);
  assert.ok(near(s.allocated, 14));
  assert.ok(near(s.available, 38));
  assert.ok(near(s.available - 14, 24));   // +24h spare
});

test("schedule: nothing left to do still has every hour available", () => {
  const { subjects: [s], spare } = shareDays([{ need: 0, date: day(5) }], () => 2, today);
  assert.equal(s.days.length, 0);
  assert.ok(near(s.available, 10));
  assert.ok(near(spare, 10));
});

test("schedule: logging hours lowers the need but not what you have", () => {
  const before = shareDays([{ need: 20, date: day(10) }], () => 3, today).subjects[0];
  const after = shareDays([{ need: 12, date: day(10) }], () => 3, today).subjects[0];
  assert.ok(near(before.available, 30));
  assert.ok(near(after.available, 30));
});

test("schedule: a short subject shows the gap", () => {
  const { subjects: [s] } = shareDays([{ need: 50, date: day(10) }], () => 3, today);
  assert.ok(near(s.available, 30));
  assert.ok(near(s.allocated, 30));
});

test("schedule: no hour is given out twice", () => {
  const { subjects: [a, b], spare, capacity } = shareDays(
    [{ need: 6, date: day(4) }, { need: 10, date: day(10) }], () => 4, today,
  );
  assert.ok(near(capacity, 40));
  assert.ok(near(a.allocated + b.allocated + spare, 40));
  assert.ok(near(a.available + b.available, 40));
});

const gaps = (subjects, needs) => subjects.map((s, i) => s.available - needs[i]);
const positive = (g) => g.filter((x) => x > 1e-9).reduce((t, x) => t + x, 0);

test("schedule: spare is shared, not credited to every subject", () => {
  // three light subjects on the same 52h of capacity: each used to show the
  // whole leftover as its own
  const needs = [8, 9, 9];
  const run = shareDays(needs.map((need, i) => ({ need, date: day(13 + i) })), () => 3.5, today);
  const g = gaps(run.subjects, needs);
  assert.ok(near(positive(g), run.spare));
  assert.ok(g.every((x) => x < run.spare - 1));   // nobody holds all of it
});

test("schedule: positive gaps add up to the total spare, with some subjects short", () => {
  const cases = [
    { needs: [30, 4, 12], dates: [3, 9, 20], hours: () => 3 },
    { needs: [0, 25, 6, 40], dates: [5, 6, 12, 15], hours: (d) => (d.getDay() % 6 === 0 ? 6 : 2) },
    { needs: [10, 10], dates: [5, 5], hours: (d) => (d.getTime() === today.getTime() ? 12 : 0.5) },
  ];
  for (const c of cases) {
    const run = shareDays(c.needs.map((need, i) => ({ need, date: day(c.dates[i]) })), c.hours, today);
    const g = gaps(run.subjects, c.needs);
    assert.ok(near(positive(g), run.spare), `${positive(g)} vs ${run.spare}`);
    // nothing is short while also holding spare
    run.subjects.forEach((s, i) => { if (g[i] < -1e-9) assert.ok(near(s.spare, 0)); });
  }
});

test("schedule: what each subject has adds up to the real capacity", () => {
  const needs = [8, 14, 30];
  const run = shareDays(needs.map((need) => ({ need, date: day(15) })), () => 3.5, today);
  const total = run.subjects.reduce((t, s) => t + s.available, 0);
  assert.ok(near(total, run.capacity));
  assert.ok(near(run.capacity, 52.5));
});

test("schedule: unused hours early in the window still count", () => {
  // a big first day, then thin days: the even-rate share leaves most of
  // day 1 unused, but those hours were there to use
  const hours = (d) => (d.getTime() === today.getTime() ? 10 : 0.5);
  const { subjects: [s] } = shareDays([{ need: 10, date: day(5) }], hours, today);
  assert.ok(near(s.available, 12));
  assert.ok(s.available >= 10);
});
