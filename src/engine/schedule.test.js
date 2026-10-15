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

test("schedule: no hour is given out twice, and spare only counts before each exam", () => {
  const { subjects: [a, b], spare } = shareDays(
    [{ need: 6, date: day(4) }, { need: 10, date: day(10) }], () => 4, today,
  );
  assert.ok(a.allocated + b.allocated + spare <= 40 + 1e-6);
  assert.ok(near(a.allocated + b.allocated + spare, 40));
  assert.ok(a.spareBefore <= b.spareBefore);   // a's window is a slice of b's
  assert.ok(near(b.available, 10 + spare));
});

test("schedule: unused hours early in the window still count", () => {
  // a big first day, then thin days: the even-rate share leaves most of
  // day 1 unused, but those hours were there to use
  const hours = (d) => (d.getTime() === today.getTime() ? 10 : 0.5);
  const { subjects: [s] } = shareDays([{ need: 10, date: day(5) }], hours, today);
  assert.ok(near(s.available, 12));
  assert.ok(s.available >= 10);
});
