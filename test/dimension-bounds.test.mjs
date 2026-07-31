/**
 * Every surface must agree on which dimensions exist, and any surface that
 * changes the dimension must say so.
 *
 * AUDIT 2026-07-31: swept d over 1, 2, 3, 4, 9, 10, 16, 25, 32, 48, 64, 100,
 * 101 and 200 against four independent validators — the TypeScript SDK's
 * validateMatrix, this MCP's zpl_compute schema, the website's MIN_DIMENSION /
 * MAX_DIMENSION, and the engine's BinaryMatrix::MIN_N / MAX_N. All four agree
 * on 3..100, and all four reject outside it with a message naming the bound.
 *
 * clampD does not. It is used at 41 call sites where the dimension comes from
 * the size of the caller's own data, and it rewrites out-of-range values in
 * silence. So the one path that derives d from user input is the only one that
 * never mentions changing it.
 *
 * Checking each tool's schema showed the array bounds already keep the result
 * inside 3..100 nearly everywhere — pools capped at 20 doubled is 40, assets
 * capped at 20 tripled is 60. One input was genuinely unbounded:
 * zpl_rng_test's `possible_values` was `min(2)` with no maximum, so 500 became
 * 100 with nothing said, and 2 — a coin, the most ordinary thing anyone would
 * test — became 3.
 *
 * These tests pin the agreement, so a bound moving on one surface and not the
 * others fails here rather than in someone's output.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { clampD, dimensionNote, MIN_D, MAX_D } from "../dist/tools/helpers.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const SWEEP = [1, 2, 3, 4, 9, 10, 16, 25, 32, 48, 64, 100, 101, 200];

test("the MCP's own bounds are the engine's bounds", () => {
  assert.equal(MIN_D, 3);
  assert.equal(MAX_D, 100);
});

test("clampD never returns a dimension the engine would reject", () => {
  for (const d of SWEEP) {
    const c = clampD(d);
    assert.ok(
      c >= MIN_D && c <= MAX_D,
      `clampD(${d}) = ${c}, outside ${MIN_D}..${MAX_D}`,
    );
  }
  // Non-integers reach here too, from expressions like length/3.
  for (const d of [2.4, 3.5, 99.9, 100.4]) {
    const c = clampD(d);
    assert.ok(Number.isInteger(c), `clampD(${d}) = ${c} is not an integer`);
    assert.ok(c >= MIN_D && c <= MAX_D, `clampD(${d}) = ${c} out of range`);
  }
});

test("a changed dimension is disclosed, an unchanged one is not", () => {
  for (const d of SWEEP) {
    const note = dimensionNote(d);
    const changed = clampD(d) !== Math.round(d);
    if (changed) {
      assert.ok(note, `d=${d} was rewritten to ${clampD(d)} with no note`);
      assert.match(note, new RegExp(`d=${Math.round(d)}\\b`), "the note must quote what was asked");
      assert.match(note, new RegExp(`d=${clampD(d)}\\b`), "the note must quote what was used");
    } else {
      assert.equal(note, null, `d=${d} was not changed but produced a note`);
    }
  }
});

test("the website's bounds match", async () => {
  const src = await readFile(
    "C:/Dev/ZPL-Private/zpl-nodeweb/src/lib/constants.ts",
    "utf-8",
  ).catch(() => null);
  if (src === null) {
    // The website repo is not always checked out beside this one.
    return;
  }
  const min = Number(src.match(/MIN_DIMENSION\s*=\s*(\d+)/)[1]);
  const max = Math.max(...[...src.matchAll(/maxD:\s*(\d+)/g)].map((m) => Number(m[1])));
  assert.equal(min, MIN_D, "website MIN_DIMENSION vs engine minimum");
  assert.equal(max, MAX_D, "website's most generous plan vs engine maximum");
});

test("zpl_compute's schema states the same range", async () => {
  const src = await readFile(join(ROOT, "src", "index.ts"), "utf-8");
  const m = src.match(/d:\s*z\.number\(\)\.int\(\)\.min\((\d+)\)\.max\((\d+)\)/);
  assert.ok(m, "zpl_compute's d schema not found — it may have changed shape");
  assert.equal(Number(m[1]), MIN_D, "zpl_compute minimum");
  assert.equal(Number(m[2]), MAX_D, "zpl_compute maximum");
});

/**
 * The sweep found exactly one unbounded input. Bounding it means a caller
 * passing 500 is refused with a message, like every other surface, instead of
 * being quietly given a different analysis.
 */
test("no tool takes an unbounded number that becomes a dimension", async () => {
  const src = await readFile(join(ROOT, "src", "tools", "gaming.ts"), "utf-8");
  const m = src.match(/possible_values:\s*z\.number\(\)\.int\(\)\.min\((\d+)\)(\.max\((\d+)\))?/);
  assert.ok(m, "possible_values schema not found");
  assert.ok(m[2], "possible_values must have an upper bound — it becomes the dimension");
  assert.equal(
    Number(m[3]),
    MAX_D,
    "the bound has to be the engine's maximum, or the two disagree again",
  );
  assert.equal(
    Number(m[1]),
    2,
    "the minimum stays 2 on purpose: a coin is a legitimate thing to test, and " +
      "the difference from the engine's 3 is disclosed rather than removed",
  );
});
