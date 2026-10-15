import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PALETTES, SEMANTIC, DEFAULT_PALETTE, tokens, contrast, paletteCss, paletteById } from "./palettes.js";

test("palettes: palettes.css is up to date with palettes.js (npm run palettes)", () => {
  assert.equal(readFileSync(new URL("./palettes.css", import.meta.url), "utf8"), paletteCss());
});

test("palettes: five palettes, each with a light and a dark set", () => {
  assert.deepEqual(PALETTES.map((p) => p.id), ["sand", "cobalt", "coral", "lime", "lavender"]);
  for (const p of PALETTES) for (const m of ["light", "dark"]) {
    for (const k of ["bg", "surface", "raised", "line", "lineHi", "text", "dim", "accent", "accentSoft"]) {
      assert.match(p[m][k], /^#[0-9A-F]{6}$/, `${p.id} ${m} ${k}`);
    }
  }
  assert.equal(paletteById("nope").id, DEFAULT_PALETTE);
});

test("palettes: text, dim, accent text and the verdict colours read (AA) on every surface", () => {
  for (const p of PALETTES) for (const m of ["light", "dark"]) {
    const t = tokens(p, m);
    for (const bg of [t.bg, t.surface, t.raised]) {
      for (const fg of ["text", "dim", "accentText", "shortfall", "fits", "info"]) {
        assert.ok(contrast(t[fg], bg) >= 4.5, `${p.id} ${m}: ${fg} ${t[fg]} on ${bg} is ${contrast(t[fg], bg).toFixed(2)}`);
      }
    }
    assert.ok(contrast(t.accentText, t.accentSoft) >= 4.5, `${p.id} ${m}: accentText on accentSoft`);
    assert.ok(contrast(t.onAccent, t.accent) >= 4.5, `${p.id} ${m}: button text on the accent`);
  }
});

test("palettes: the verdict colours are the same in every palette, and the accent is never one of them", () => {
  for (const m of ["light", "dark"]) {
    const seen = new Set(PALETTES.map((p) => `${tokens(p, m).shortfall}|${tokens(p, m).fits}`));
    assert.equal(seen.size, 1);
    for (const p of PALETTES) {
      assert.notEqual(tokens(p, m).accent, SEMANTIC[m].shortfall);
      assert.notEqual(tokens(p, m).accent, SEMANTIC[m].fits);
    }
  }
});

test("palettes: the before-first-paint script in index.html knows every palette", () => {
  const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const listed = html.match(/\^\(([a-z|]+)\)\$/)[1].split("|");
  assert.deepEqual(listed.sort(), PALETTES.map((p) => p.id).sort());
  assert.match(html, new RegExp(`data-palette="${DEFAULT_PALETTE}"`));
});
