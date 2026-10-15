import { test } from "node:test";
import assert from "node:assert/strict";
import { startTimer, elapsedMs, remainingMs, isFinished, pauseTimer, resumeTimer, minutesSpent, clock, breakMinutes } from "./timer.js";
import { fmtH, fmtHours } from "./format.js";

const MIN = 60000;

test("timer: counts from a timestamp, so time away still counts", () => {
  const t = startTimer(25, 1_000_000);
  assert.equal(remainingMs(t, 1_000_000), 25 * MIN);
  // the tab sat in the background for 10 minutes: nothing ticked, the answer is still right
  assert.equal(remainingMs(t, 1_000_000 + 10 * MIN), 15 * MIN);
  assert.equal(isFinished(t, 1_000_000 + 25 * MIN), true);
  assert.equal(elapsedMs(t, 1_000_000 + 90 * MIN), 25 * MIN, "never more than the session");
});

test("timer: pause holds the time; resume carries on from it", () => {
  let t = startTimer(25, 0);
  t = pauseTimer(t, 5 * MIN);
  assert.equal(remainingMs(t, 60 * MIN), 20 * MIN, "paused for 55 minutes: no change");
  t = resumeTimer(t, 60 * MIN);
  assert.equal(remainingMs(t, 62 * MIN), 18 * MIN);
  assert.equal(pauseTimer(pauseTimer(t, 63 * MIN), 70 * MIN).banked, 8 * MIN, "pausing twice is one pause");
  assert.equal(resumeTimer(t, 99 * MIN), t, "resuming a running timer changes nothing");
});

test("timer: minutes offered for logging are the minutes actually spent", () => {
  const t = startTimer(25, 0);
  assert.equal(minutesSpent(t, 12 * MIN + 20_000), 12);
  assert.equal(minutesSpent(t, 12 * MIN + 40_000), 13);
  assert.equal(minutesSpent(t, 20_000), 0);
  assert.equal(minutesSpent(t, 99 * MIN), 25);
});

test("timer: clock face and break length", () => {
  assert.equal(clock(25 * MIN), "25:00");
  assert.equal(clock(65_400), "1:06");
  assert.equal(clock(999), "0:01", "a part second still shows");
  assert.equal(clock(0), "0:00");
  assert.equal(clock(75 * MIN), "1:15:00");
  assert.equal(breakMinutes(15), 5);
  assert.equal(breakMinutes(25), 5);
  assert.equal(breakMinutes(50), 10);
});

test("hours: whole numbers without a decimal, fractions to one place", () => {
  assert.equal(fmtH(1), "1h");
  assert.equal(fmtH(1.0), "1h");
  assert.equal(fmtH(1.04), "1h");
  assert.equal(fmtH(1.5), "1.5h");
  assert.equal(fmtH(0.96), "1h");
  assert.equal(fmtH(25 / 60), "0.4h");
  assert.equal(fmtH(12), "12h");
  assert.equal(fmtH(0), "0h");
  assert.equal(fmtH(-0.01), "0h");
  assert.equal(fmtH(NaN), "0h");
  assert.equal(fmtHours(2.25), "2.3");
});
