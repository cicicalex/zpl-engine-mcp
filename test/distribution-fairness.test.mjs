/**
 * A fairness verdict must track the distribution it describes.
 *
 * The gaming tools produced exactly inverted verdicts. Measured against the
 * live engine before the fix:
 *
 *   drop rates 0.0001 / 0.9999  ->  "Loot table is well-balanced.
 *                                    Players should feel drops are fair."
 *   drop rates 0.5    / 0.5     ->  "Heavy skew detected. Some items are
 *                                    almost impossible to get."
 *
 * The cause was a scale mismatch, not a threshold that needed nudging. The
 * tools measured how far the table sits from uniform — 0 meaning perfectly
 * uniform — and passed that straight into the engine's density parameter,
 * where 0 means an all-zeros matrix and collapses the reading. So a fair
 * table looked degenerate and an abusive one landed mid-range where scores
 * are high.
 *
 * Remapping the input would not have rescued it: measured on the engine, the
 * response across the whole usable range spans about two points at d=9 and
 * less above it. There is no mapping from a two-point range onto a verdict.
 *
 * So the verdict now comes from the distribution itself, computed locally and
 * deterministically. The engine's reading is still shown, labelled as what it
 * is, but it no longer decides whether a table is fair.
 *
 * Run after `npm run build`.
 */

import test from "node:test";
import assert from "node:assert/strict";

const { distributionFairness } = await import("../dist/tools/helpers.js");

test("a uniform table scores full marks", () => {
  for (const rates of [[0.5, 0.5], [1, 1, 1], [10, 10, 10, 10], [7, 7, 7, 7, 7, 7]]) {
    const f = distributionFairness(rates);
    assert.equal(
      Math.round(f.fairness),
      100,
      `${JSON.stringify(rates)} is perfectly uniform and must score 100, got ${f.fairness}`
    );
  }
});

test("the table that used to score 88 now scores near zero", () => {
  // The exact case that came back as "well-balanced" from the live engine.
  const f = distributionFairness([0.0001, 0.9999]);
  assert.ok(
    f.fairness < 5,
    `an 0.01/99.99 split is as skewed as two items can be; expected near 0, got ${f.fairness}`
  );
});

test("fairness falls as concentration rises, without exception", () => {
  // Same four items, progressively more concentrated.
  const ladder = [
    [25, 25, 25, 25],
    [40, 30, 20, 10],
    [70, 20, 5, 5],
    [90, 5, 3, 2],
    [97, 1, 1, 1],
  ];
  const scores = ladder.map((r) => distributionFairness(r).fairness);
  for (let i = 1; i < scores.length; i++) {
    assert.ok(
      scores[i] < scores[i - 1],
      `step ${i} did not fall: ${JSON.stringify(ladder[i - 1])} scored ${scores[i - 1]}, ` +
        `${JSON.stringify(ladder[i])} scored ${scores[i]} — a fairness measure must be monotonic`
    );
  }
});

test("the scale is normalised for the number of items", () => {
  // Two items cannot be as unevenly split as fifty can, in absolute terms.
  // Without normalising, a maximally unfair pair would outscore a mildly
  // uneven fifty-item table, which is backwards.
  const worstPair = distributionFairness([0, 100]).fairness;
  const worstFifty = distributionFairness([100, ...Array(49).fill(0)]).fairness;
  assert.ok(worstPair < 1, `a 0/100 pair is maximally unfair, got ${worstPair}`);
  assert.ok(worstFifty < 1, `one item taking everything is maximally unfair, got ${worstFifty}`);
});

test("verdict bands follow the score", () => {
  assert.equal(distributionFairness([1, 1, 1, 1]).band, "fair");
  assert.equal(distributionFairness([97, 1, 1, 1]).band, "severe");
  const bands = new Set(
    [[1, 1], [3, 1], [10, 1], [100, 1]].map((r) => distributionFairness(r).band)
  );
  assert.ok(bands.size > 1, "the bands must actually differentiate; every table got the same label");
});

test("degenerate input is refused rather than scored", () => {
  // All-zero rates carry no distribution at all. Returning a number would be
  // inventing one, which is the failure this whole change is about.
  assert.throws(() => distributionFairness([0, 0, 0]), /zero|no distribution/i);
  assert.throws(() => distributionFairness([]), /at least|empty/i);
  assert.throws(() => distributionFairness([5]), /at least/i);
});

test("it is deterministic", () => {
  const rates = [40, 30, 20, 10];
  const first = distributionFairness(rates);
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(distributionFairness(rates), first, "repeated calls disagreed");
  }
});
