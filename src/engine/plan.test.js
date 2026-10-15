import { test } from "node:test";
import assert from "node:assert/strict";
import { analysePlan, key, addDays, startOfDay, toDate, hoursBetween, studyDaysBetween, hoursOnDay } from "./plan.js";
import { getSyllabus } from "./syllabusEngine.js";

const today = new Date(2026, 9, 15);   // Thu 15 Oct 2026
const on = (n) => key(addDays(today, n));
const EPS = 1e-6;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

let seq = 0;
const subject = (o = {}) => {
  const chapters = o.chapters ?? 8;
  return {
    id: `s${++seq}`, name: `Subject ${seq}`, date: on(10), createdAt: on(-5), chapters,
    type: "theory", confidence: 3, lastScore: 60, pace: "steady", logged: 0,
    names: Array(chapters).fill(""), diff: Array(chapters).fill(2), done: Array(chapters).fill(false),
    ...o,
  };
};
const ncert = getSyllabus("ncert-12-maths");
const syllabusSubject = (o = {}) => {
  const refs = ncert.chapters.map((c) => c.id);
  return subject({
    type: "problem", syllabus: ncert.id, refs, chapters: refs.length,
    names: ncert.chapters.map((c) => c.name), diff: ncert.chapters.map((c) => c.diff),
    done: Array(refs.length).fill(false), ...o,
  });
};

const TIME = { wd: 3, we: 5, ov: {}, pace: "steady" };

/* The four invariants, plus "no NaN anywhere a number is shown" */
function check(name, subjects, time = TIME) {
  const plan = analysePlan(subjects, time, today);
  const msg = (m) => `${name}: ${m}`;
  const list = plan.subjects;

  // capacity: every study hour from today to the last upcoming exam
  const last = list.reduce((a, s) => (startOfDay(s.date) > a ? startOfDay(s.date) : a), startOfDay(today));
  const capacity = hoursBetween(today, last, time.wd, time.we, time.ov);
  assert.ok(Math.abs(plan.capacity - capacity) < EPS, msg(`capacity ${plan.capacity} vs ${capacity}`));

  // 1. "You have" never adds up to more than exists
  const have = sum(list.map((s) => s.available));
  assert.ok(have <= capacity + EPS, msg(`you have ${have} > capacity ${capacity}`));

  // 2. positive gaps are exactly the spare
  const positive = sum(list.map((s) => Math.max(0, s.gap)));
  assert.ok(Math.abs(positive - plan.spare) < 1e-6, msg(`positive gaps ${positive} vs spare ${plan.spare}`));

  for (const s of list) {
    // 3. phase hours add up to the hours given
    const ph = sum(s.phases.map((p) => p.hours));
    assert.ok(Math.abs(ph - s.allocated) < EPS, msg(`${s.name} phases ${ph} vs allocated ${s.allocated}`));
    assert.ok(s.allocated <= s.needed + EPS, msg(`${s.name} given more than it needs`));
    // every hour given lands before its exam
    for (const d of s.days) assert.ok(startOfDay(d.d) < startOfDay(s.date), msg(`${s.name} studied on/after exam day`));
    // nothing shown is NaN or infinite
    for (const k of ["available", "needed", "gap", "raw", "perChapter", "windowDays", "studyDays", "expected", "behind"]) {
      assert.ok(Number.isFinite(s[k]), msg(`${s.name}.${k} = ${s[k]}`));
    }
    if (s.perDay != null) assert.ok(Number.isFinite(s.perDay), msg(`${s.name}.perDay = ${s.perDay}`));
    if (s.havePerDay != null) assert.ok(Number.isFinite(s.havePerDay), msg(`${s.name}.havePerDay`));
    assert.ok(s.windowDays === studyDaysBetween(today, s.date, time.wd, time.we, time.ov), msg(`${s.name} window days`));
  }

  // 4. no hour given out twice: per day, everything given fits in that day
  const byDay = {};
  for (const s of list) for (const d of s.days) byDay[key(d.d)] = (byDay[key(d.d)] ?? 0) + d.h;
  for (const [k, h] of Object.entries(byDay)) {
    const cap = hoursOnDay(k, time.wd, time.we, time.ov);
    assert.ok(h <= cap + EPS, msg(`${k}: gave ${h}h of ${cap}h`));
  }
  return plan;
}

test("sweep: past exams are left out of everything", () => {
  const plan = check("past", [subject({ date: on(-21), name: "123" }), subject({ name: "Wakre" })]);
  assert.equal(plan.subjects.length, 1);
  assert.equal(plan.passed.length, 1);
  assert.equal(plan.passed[0].name, "123");
});

test("sweep: only past exams", () => {
  const plan = check("only past", [subject({ date: on(-3) }), subject({ date: on(-1) })]);
  assert.equal(plan.subjects.length, 0);
  assert.equal(plan.spare, 0);
});

test("sweep: several subjects on the same exam date", () => {
  check("same date", [subject({ date: on(9) }), subject({ date: on(9), chapters: 14 }), subject({ date: on(9), chapters: 3 })]);
});

test("sweep: a single subject, light and heavy", () => {
  check("single light", [subject({ chapters: 2 })]);
  check("single heavy", [subject({ chapters: 40 })]);
});

test("sweep: ten subjects across a month", () => {
  check("ten", Array.from({ length: 10 }, (_, i) => subject({ date: on(3 + i * 3), chapters: 4 + i, type: ["theory", "problem", "memory"][i % 3] })));
});

test("sweep: zero chapters, and sixty", () => {
  const plan = check("zero", [subject({ chapters: 0 }), subject({ chapters: 60 })]);
  const zero = plan.subjects.find((s) => s.chapters === 0);
  assert.equal(zero.needed, 0);
  assert.equal(zero.remaining, 0);
});

test("sweep: every chapter ticked done", () => {
  const plan = check("all done", [subject({ done: Array(8).fill(true) }), subject({ date: on(12) })]);
  assert.equal(plan.subjects[0].needed, 0);
});

test("sweep: logged hours beyond what's needed", () => {
  const plan = check("over-logged", [subject({ logged: 500 })]);
  assert.equal(plan.subjects[0].needed, 0);
});

test("sweep: every day set to zero hours", () => {
  const plan = check("no time", [subject(), subject({ date: on(20) })], { wd: 0, we: 0, ov: {}, pace: "steady" });
  assert.equal(plan.capacity, 0);
  for (const s of plan.subjects) {
    assert.equal(s.windowDays, 0);
    assert.equal(s.perDay, null);
    assert.ok(s.gap < 0);
  }
});

test("sweep: exam today and exam tomorrow", () => {
  const plan = check("today/tomorrow", [subject({ date: on(0), name: "Today" }), subject({ date: on(1), name: "Tomorrow" })]);
  const t = plan.subjects.find((s) => s.name === "Today");
  assert.equal(t.windowDays, 0);
  assert.equal(t.available, 0);
  const m = plan.subjects.find((s) => s.name === "Tomorrow");
  assert.equal(m.windowDays, 1);
});

test("sweep: duplicate names are flagged, with dates told apart", () => {
  const plan = check("duplicates", [subject({ name: "123", date: on(5) }), subject({ name: " 123 ", date: on(9) }), subject({ name: "Other" })]);
  assert.deepEqual(plan.subjects.map((s) => s.sameName), [true, true, false]);
});

test("sweep: a syllabus subject and a weighted one together", () => {
  const plan = check("syllabus + weights", [
    syllabusSubject({ date: on(20) }),
    subject({ weight: [3, 2, 1, 2, 2, 3, 1, 2], date: on(14) }),
  ]);
  assert.ok(plan.subjects.every((s) => s.marks > 0));
});

test("sweep: per-day overrides, including zero days mid-window", () => {
  const ov = { [on(1)]: 0, [on(2)]: 0, [on(3)]: 12, [on(6)]: 0.5 };
  check("overrides", [subject({ date: on(4) }), subject({ date: on(8), chapters: 20 }), subject({ date: on(15) })], { wd: 2, we: 6, ov, pace: "quick" });
});

test("sweep: messy saved data doesn't break the numbers", () => {
  check("malformed", [
    subject({ chapters: 5, done: [true], diff: undefined, names: undefined, logged: "3" }),
    subject({ chapters: 3, done: [false, false, false, true, true], logged: -4 }),
  ]);
});

test("sweep: short or missing saved lists are sized to the chapters", () => {
  const plan = analysePlan([subject({ chapters: 5, names: ["A"], done: [true], diff: undefined })], TIME, today);
  const s = plan.subjects[0];
  assert.equal(s.names.length, 5);
  assert.equal(s.done.length, 5);
  assert.equal(s.diffs.length, 5);
  assert.equal(s.doneCount, 1);
});

test("sweep: invariants hold for many random plans", () => {
  let x = 7;
  const rnd = (n) => { x = (x * 1103515245 + 12345) % 2147483648; return x % n; };
  for (let run = 0; run < 300; run++) {
    const n = 1 + rnd(8);
    const subs = Array.from({ length: n }, () => {
      const chapters = rnd(25);
      return subject({
        date: on(rnd(40) - 5), chapters,
        done: Array.from({ length: chapters }, () => rnd(4) === 0),
        diff: Array.from({ length: chapters }, () => 1 + rnd(3)),
        logged: rnd(3) === 0 ? rnd(60) : 0,
        type: ["theory", "problem", "memory"][rnd(3)],
        confidence: 1 + rnd(5), lastScore: rnd(101),
      });
    });
    const ov = {};
    for (let k = 0; k < rnd(6); k++) ov[on(rnd(30))] = rnd(4) === 0 ? 0 : rnd(10);
    check(`random ${run}`, subs, { wd: rnd(6), we: rnd(9), ov, pace: ["quick", "steady", "thorough"][rnd(3)] });
  }
});

test("dates: a saved exam date means that calendar day, wherever you are", () => {
  const d = toDate("2026-10-24");
  assert.equal(d.getDate(), 24);
  assert.equal(d.getMonth(), 9);
  assert.equal(key("2026-10-24"), "2026-10-24");
});

test("dates: stepping over a daylight-saving change never repeats a day", () => {
  // walk a whole year by calendar day: every key is new, and there are 365
  const seen = new Set();
  let d = new Date(2026, 0, 1);
  for (let i = 0; i < 365; i++) { seen.add(key(d)); d = addDays(d, 1); }
  assert.equal(seen.size, 365);
  assert.equal(key(d), "2027-01-01");
});
