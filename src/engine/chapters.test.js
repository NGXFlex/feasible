import { test } from "node:test";
import assert from "node:assert/strict";
import { rowsFromSubject, removeRow, resizeRows, applyRows } from "./chapters.js";

const subject = {
  chapters: 5,
  names: ["A", "B", "C", "D", "E"],
  diff: [1, 2, 3, 2, 1],
  done: [true, false, true, true, false],
  weight: [3, 2, 1, 2, 3],
};
const names = (rows) => rows.map((r) => r.name);

test("chapter editor: removing a middle chapter keeps every other chapter's tick", () => {
  const rows = rowsFromSubject(subject);
  const out = applyRows(subject, removeRow(rows, rows[1].key));   // drop B (not done)
  assert.deepEqual(out.names, ["A", "C", "D", "E"]);
  assert.deepEqual(out.done, [true, true, true, false]);
  assert.deepEqual(out.diff, [1, 3, 2, 1]);
  assert.deepEqual(out.weight, [3, 1, 2, 3]);
  assert.equal(out.chapters, 4);
});

test("chapter editor: removing a ticked chapter doesn't pass its tick on", () => {
  const rows = rowsFromSubject(subject);
  const out = applyRows(subject, removeRow(rows, rows[2].key));   // drop C (done)
  assert.deepEqual(out.names, ["A", "B", "D", "E"]);
  assert.deepEqual(out.done, [true, false, true, false]);
});

test("chapter editor: several removals, a rename and new chapters all line up", () => {
  let rows = rowsFromSubject(subject);
  rows = removeRow(rows, rows[0].key);                 // A
  rows = removeRow(rows, rows[2].key);                 // D (now third)
  rows = rows.map((r) => (r.name === "C" ? { ...r, name: "C renamed" } : r));
  rows = resizeRows(rows, 5);                          // two new at the end
  const out = applyRows(subject, rows);
  assert.deepEqual(out.names, ["B", "C renamed", "E", "", ""]);
  assert.deepEqual(out.done, [false, true, false, false, false]);
  assert.deepEqual(out.weight, [2, 1, 3, 2, 2]);
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, "row keys stay unique");
});

test("chapter editor: syllabus links follow their chapter; new chapters have none", () => {
  const syl = { ...subject, refs: ["r1", "r2", "r3", "r4", "r5"] };
  let rows = rowsFromSubject(syl);
  rows = resizeRows(removeRow(rows, rows[3].key), 5);   // drop D, add one
  const out = applyRows(syl, rows, { weighable: false });
  assert.deepEqual(out.refs, ["r1", "r2", "r3", "r5", null]);
  assert.deepEqual(out.done, [true, false, true, false, false]);
  assert.equal("weight" in out, false);
});

test("chapter editor: never fewer than one chapter or more than 60", () => {
  let rows = rowsFromSubject({ ...subject, chapters: 1, names: ["Only"] });
  assert.equal(removeRow(rows, rows[0].key).length, 1);
  assert.equal(resizeRows(rows, 0).length, 1);
  assert.equal(resizeRows(rows, 99).length, 60);
  assert.deepEqual(names(resizeRows(rowsFromSubject(subject), 3)), ["A", "B", "C"]);
});

test("chapter editor: short saved lists (older saves) are padded, not misread", () => {
  const old = { chapters: 3, names: ["X"], done: [true], diff: [] };
  const out = applyRows(old, rowsFromSubject(old));
  assert.deepEqual(out.names, ["X", "", ""]);
  assert.deepEqual(out.done, [true, false, false]);
  assert.deepEqual(out.diff, [2, 2, 2]);
});
