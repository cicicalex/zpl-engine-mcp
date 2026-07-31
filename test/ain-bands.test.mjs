/**
 * One reading, one verdict.
 *
 * AUDIT 2026-07-31: ainSignal was a second set of bands - 80/60/40/20 returning
 * EXCELLENT / GOOD / MODERATE / WEAK / CRITICAL - and its own comment called
 * them "Standard AIN interpretation bands". They were neither standard nor the
 * engine's. Measured against ain_status in zpl-core:
 *
 *   AIN 85  ->  "EXCELLENT"   engine: NEUTRAL
 *   AIN 75  ->  "GOOD"        engine: MODERATE_BIAS
 *   AIN 55  ->  "MODERATE"    engine: SIGNIFICANT_BIAS
 *   AIN 35  ->  "WEAK"        engine: HIGH_BIAS
 *
 * Softer than the engine at every step across the middle of the range, printed
 * beside the number it was softening, in eight places. formatResult put both in
 * one block: the header carried the signal and the table carried ain_status, so
 * a single reading came with two verdicts that disagreed.
 *
 * Measured after the fix, against the live engine: header "(HIGHLY_NEUTRAL)"
 * over a Status row reading HIGHLY_NEUTRAL.
 *
 * These thresholds belong to the engine. They are duplicated here only because
 * this package cannot import Rust; the test is what keeps the copy honest.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { ainSignal } from "../dist/tools/helpers.js";

/** The engine's own bands, from crates/zpl-core/src/ain.rs. */
const ENGINE_AIN_RS = "C:/Proiecte/zpl-engine-source/crates/zpl-core/src/ain.rs";

const ENGINE_BANDS = [
  [0.96, "CERTIFIED_NEUTRAL"],
  [0.9, "HIGHLY_NEUTRAL"],
  [0.8, "NEUTRAL"],
  [0.6, "MODERATE_BIAS"],
  [0.4, "SIGNIFICANT_BIAS"],
  [0, "HIGH_BIAS"],
];

const engineStatus = (ain01) => ENGINE_BANDS.find(([lo]) => ain01 >= lo)[1];

test("ainSignal agrees with the engine across the whole scale", () => {
  const mismatches = [];
  for (let tenths = 0; tenths <= 1000; tenths++) {
    const pct = tenths / 10;
    const mine = ainSignal(pct);
    const theirs = engineStatus(pct / 100);
    if (mine !== theirs) mismatches.push(`AIN ${pct}: ${mine} vs engine ${theirs}`);
  }
  assert.deepEqual(
    mismatches.slice(0, 6),
    [],
    `${mismatches.length} readings where this package's word differs from the ` +
      `engine's classification of the same number`,
  );
});

test("the boundaries land on the engine's side, not one step off", () => {
  // Every threshold is inclusive on the engine side. An off-by-one here is
  // exactly the kind of drift that stays invisible in ordinary use.
  assert.equal(ainSignal(96), "CERTIFIED_NEUTRAL");
  assert.equal(ainSignal(95.9), "HIGHLY_NEUTRAL");
  assert.equal(ainSignal(90), "HIGHLY_NEUTRAL");
  assert.equal(ainSignal(89.9), "NEUTRAL");
  assert.equal(ainSignal(80), "NEUTRAL");
  assert.equal(ainSignal(79.9), "MODERATE_BIAS");
  assert.equal(ainSignal(60), "MODERATE_BIAS");
  assert.equal(ainSignal(59.9), "SIGNIFICANT_BIAS");
  assert.equal(ainSignal(40), "SIGNIFICANT_BIAS");
  assert.equal(ainSignal(39.9), "HIGH_BIAS");
  assert.equal(ainSignal(0), "HIGH_BIAS");
});

test("no softer vocabulary survives anywhere in the package", async () => {
  const src = await readFile(new URL("../src/tools/helpers.ts", import.meta.url), "utf-8");
  const code = src
    .split(/\r?\n/)
    .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
    .join("\n");
  for (const word of ["EXCELLENT", "CRITICAL"]) {
    assert.ok(
      !code.includes(`"${word}"`),
      `${word} is not one of the engine's band names — a second vocabulary is how ` +
        `one reading came to carry two verdicts`,
    );
  }
});

/**
 * The copy above is only correct while the engine's is unchanged. Read the Rust
 * when it is checked out beside this repo; skip when it is not, so the suite
 * still runs for anyone with only the client packages.
 */
test("the pinned bands match the engine's source", async () => {
  let rust;
  try {
    rust = await readFile(ENGINE_AIN_RS, "utf-8");
  } catch {
    return;
  }
  const fn = rust.slice(rust.indexOf("pub fn ain_status"));
  const body = fn.slice(0, fn.indexOf("\n}"));

  const found = [...body.matchAll(/ain\s*>=\s*([\d.]+)\s*\{\s*"([A-Z_]+)"/g)].map((m) => [
    Number(m[1]),
    m[2],
  ]);
  assert.ok(found.length >= 5, `only ${found.length} bands parsed from the engine source`);

  const expected = ENGINE_BANDS.filter(([lo]) => lo > 0);
  assert.deepEqual(
    found,
    expected,
    "the engine's bands changed and this package's copy did not follow",
  );
});
