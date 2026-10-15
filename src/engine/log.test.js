import { test } from "node:test";
import assert from "node:assert/strict";
import { loggedTotal, loggedOn, migrateLog, addLog, setLoggedTotal } from "./log.js";
import { analysePlan } from "./plan.js";

const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test("log: an old running total becomes one entry dated today", () => {
  const old = { id: "a", name: "Maths", logged: 4.5 };
  const m = migrateLog(old, "2026-10-15");
  assert.deepEqual(m.log, [{ d: "2026-10-15", h: 4.5, src: "manual" }]);
  assert.equal("logged" in m, false);
  assert.equal(loggedTotal(m), 4.5);
});

test("log: nothing logged migrates to an empty list; migrating twice changes nothing", () => {
  assert.deepEqual(migrateLog({ logged: 0 }, "2026-10-15").log, []);
  assert.deepEqual(migrateLog({}, "2026-10-15").log, []);
  const once = migrateLog({ logged: 2 }, "2026-10-15");
  assert.deepEqual(migrateLog(once, "2026-10-20"), once);
  // a stray total next to a log is dropped, the entries win
  assert.deepEqual(migrateLog({ log: [{ d: "2026-10-01", h: 1 }], logged: 9 }, "2026-10-15"), { log: [{ d: "2026-10-01", h: 1 }] });
});

test("log: the total is the sum of the entries; a day's hours are that day's entries", () => {
  let s = migrateLog({ logged: 1 }, "2026-10-14");
  s = addLog(s, 0.5, "2026-10-15", "timer");
  s = addLog(s, 25 / 60, "2026-10-15", "timer");
  s = addLog(s, 0, "2026-10-15");   // nothing to add
  s = addLog(s, -2, "2026-10-15");  // never negative
  assert.equal(s.log.length, 3);
  close(loggedTotal(s), 1 + 0.5 + 25 / 60);
  close(loggedOn(s, "2026-10-15"), 0.5 + 25 / 60);
  assert.equal(loggedOn(s, "2026-10-14"), 1);
  assert.equal(loggedOn(s, "2026-10-13"), 0);
});

test("log: setting a higher total logs the difference today", () => {
  const s = setLoggedTotal({ log: [{ d: "2026-10-10", h: 2 }] }, 3.5, "2026-10-15");
  assert.deepEqual(s.log, [{ d: "2026-10-10", h: 2 }, { d: "2026-10-15", h: 1.5, src: "manual" }]);
});

test("log: setting a lower total takes hours off the newest entries, never below zero", () => {
  const s = { log: [{ d: "2026-10-10", h: 2 }, { d: "2026-10-12", h: 1 }, { d: "2026-10-14", h: 0.5 }] };
  const lower = setLoggedTotal(s, 2.25, "2026-10-15");
  assert.deepEqual(lower.log, [{ d: "2026-10-10", h: 2 }, { d: "2026-10-12", h: 0.25 }]);
  assert.deepEqual(setLoggedTotal(s, -1, "2026-10-15").log, []);
  assert.equal(setLoggedTotal(s, 3.5, "2026-10-15"), s, "no change, same object");
});

test("log: the plan reads entries and old totals the same way", () => {
  const today = new Date(2026, 9, 15);
  const base = { id: "a", name: "Maths", date: "2026-10-30", createdAt: "2026-10-10", chapters: 6, type: "theory", confidence: 3, lastScore: 60, pace: "steady", names: [], diff: [], done: [] };
  const time = { wd: 3, we: 5, ov: {} };
  const old = analysePlan([{ ...base, logged: 3 }], time, today).subjects[0];
  const now = analysePlan([{ ...base, log: [{ d: "2026-10-12", h: 1 }, { d: "2026-10-14", h: 2 }] }], time, today).subjects[0];
  assert.equal(old.logged, 3);
  assert.equal(now.logged, 3);
  close(old.needed, now.needed);
});
