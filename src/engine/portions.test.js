import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePortions, marksFromWeights } from "./portions.js";

const names = (t) => parsePortions(t).map((c) => c.name);

test("portions: strips numbers, bullets and separators", () => {
  assert.deepEqual(
    names("1. Solutions\n2) Electrochemistry\nCh 3 - Chemical Kinetics\n• d and f Block\n- Haloalkanes\n* Amines\nChapter 7: Biomolecules"),
    ["Solutions", "Electrochemistry", "Chemical Kinetics", "d and f Block", "Haloalkanes", "Amines", "Biomolecules"],
  );
});

test("portions: skips blank lines and headings", () => {
  assert.deepEqual(
    names("UNIT I\n\nPHYSICAL CHEMISTRY\n1. Solutions\n   \nTerm 2\nunit iv\nSection\n2. Electrochemistry"),
    ["Solutions", "Electrochemistry"],
  );
});

test("portions: keeps names that start with a number or are long and capitalised", () => {
  assert.deepEqual(names("3D Geometry\nLINEAR PROGRAMMING AND ITS USES"), ["3D Geometry", "LINEAR PROGRAMMING AND ITS USES"]);
});

test("portions: remembers each chapter's source line", () => {
  assert.deepEqual(parsePortions("UNIT 1\n1. Solutions\n\n2. Amines").map((c) => c.line), [1, 3]);
});

test("weights: split 100 marks in proportion, missing weights count as Medium", () => {
  assert.deepEqual(marksFromWeights([3, 2, 1, 2]), [37.5, 25, 12.5, 25]);
  assert.deepEqual(marksFromWeights([3], 2), [60, 40]);
});

test("portions: drops trailing separators and handles messy pasted text", () => {
  assert.deepEqual(
    names("   \r\n7. Coordination Compounds;\r\n9.Alcohols, Phenols & Ethers,\r\n\t• Surface Chemistry.\r\n1.\r\n•\r\nCh. 12 Amines\r\n13 — Biomolecules"),
    ["Coordination Compounds", "Alcohols, Phenols & Ethers", "Surface Chemistry", "Amines", "Biomolecules"],
  );
});
