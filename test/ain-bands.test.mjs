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

/**
 * The scoring guide teaches the scale. It must teach the engine's.
 *
 * AUDIT 2026-07-31: zpl_teach's scoring-guide carried a third set of bands -
 * letter grades over 90/80/70/60/40/20 with wording to match. Measured against
 * the engine:
 *
 *   AIN 85 -> "A EXCELLENT, very well balanced"   engine: NEUTRAL
 *   AIN 75 -> "B+ GOOD, minor deviations"         engine: MODERATE_BIAS
 *   AIN 45 -> "C MODERATE, noticeable imbalance"  engine: SIGNIFICANT_BIAS
 *   AIN 30 -> "D WEAK"                            engine: HIGH_BIAS
 *
 * Softer than the engine at every step, in the one document whose job is
 * telling a reader - often an AI - what the numbers mean.
 *
 * The same block listed token costs and stopped at d=33-48, omitting d=49-64
 * and d=65+. Anyone on Enterprise or Enterprise XL found no line for their
 * range. It renders from tokenCostTable() now, so the bands cannot go stale.
 */
test("the scoring guide teaches the engine's bands", async () => {
  const { registerAdvancedTools } = await import("../dist/tools/advanced.js");
  const tools = new Map();
  registerAdvancedTools({ tool: (n, _d, _s, h) => tools.set(n, h) }, () => {
    throw new Error("the guide must not need the engine");
  });

  const text = (await tools.get("zpl_teach")({ topic: "scoring-guide" })).content[0].text;

  for (const [, name] of ENGINE_BANDS) {
    assert.ok(text.includes(name), `the guide does not mention ${name}`);
  }
  for (const invented of ["EXCEPTIONAL", "EXCELLENT", "ACCEPTABLE", "WEAK"]) {
    assert.ok(
      !text.includes(invented),
      `"${invented}" is not an engine band — the guide is teaching a second scale`,
    );
  }

  // The cost table was truncated; the top two bands are the ones paid for.
  assert.match(text, /d=49–64 → 500 tokens/, "the d=49-64 cost band must be listed");
  assert.match(text, /d=65\+ → 2000 tokens/, "the open-ended cost band must be listed");
});

test("the universal domain does not re-grade the engine", async () => {
  const { getDomain } = await import("../dist/domains/index.js");
  const universal = getDomain("universal");
  assert.ok(universal, "universal domain not found");

  const status = (a) => ENGINE_BANDS.find(([lo]) => a >= lo)[1];
  const disagreements = [];
  for (const pct of [98, 92, 85, 75, 65, 55, 45, 30, 10]) {
    const r = universal.interpret(
      {
        ain: pct / 100,
        ain_status: status(pct / 100),
        p_output: 0.5,
        deviation: 0,
        status: "STABLE",
        samples: 1,
        d: 3,
        bias: 0.5,
        tokens_used: 1,
        compute_ms: 1,
      },
      {},
    );
    if (r.signal !== r.status) disagreements.push(`AIN ${pct}: signal ${r.signal} vs ${r.status}`);
  }
  assert.deepEqual(
    disagreements,
    [],
    `the universal domain returns its signal and the engine's status in one object; ` +
      `they must not contradict:\n  ${disagreements.join("\n  ")}`,
  );
});
