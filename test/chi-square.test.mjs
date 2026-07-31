/**
 * The RNG fairness test must be a fairness test.
 *
 * AUDIT 2026-07-31: zpl_rng_test decided whether a random source was fair from
 * AIN derived from distributionBias — the same inversion as the other tools
 * converted today, so a uniform sequence collapsed the engine reading and was
 * reported as biased.
 *
 * It is the one that could not be fixed the same way. Everywhere else an even
 * distribution is the good answer, so swapping in the fairness helper was
 * enough. A fair die is different: it *will* deviate from a flat histogram, and
 * how much it may deviate depends entirely on how many times it was rolled.
 * Scoring raw evenness would have called a fair die biased on any short sample
 * — a new wrong answer wearing the shape of a fix.
 *
 * The tool was already reasoning about the right test without running it: it
 * computes possible_values * 30 and warns about under-sampling "because
 * chi-square needs ~30 samples per cell", then took the verdict from elsewhere.
 *
 * These tests check the statistic against published critical values rather than
 * against itself. A p-value implementation that agrees only with its own output
 * is not verified, it is just consistent.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { chiSquareUniform } from "../dist/tools/helpers.js";

/**
 * Build counts over k = df+1 cells whose chi-square statistic is exactly `x`.
 * One cell carries +delta, the rest share -delta between them:
 *   delta^2/e + df * (delta/df)^2/e = x   =>   delta = sqrt(x*e / (1 + 1/df))
 */
function countsWithStatistic(df, x, perCell = 1000) {
  const k = df + 1;
  const e = perCell;
  const delta = Math.sqrt((x * e) / (1 + 1 / df));
  return [e + delta, ...Array(df).fill(e - delta / df)];
}

/** Upper-tail critical values, from published chi-square tables. */
const CRITICAL = [
  [1, 3.841, 0.05], [1, 6.635, 0.01],
  [3, 7.815, 0.05], [3, 11.345, 0.01],
  [5, 11.070, 0.05], [5, 15.086, 0.01],
  [10, 18.307, 0.05], [10, 23.209, 0.01],
  [20, 31.410, 0.05], [20, 37.566, 0.01],
];

test("the statistic is built correctly by the fixture itself", () => {
  for (const [df, x] of CRITICAL) {
    const r = chiSquareUniform(countsWithStatistic(df, x));
    assert.equal(r.df, df, "degrees of freedom");
    assert.ok(
      Math.abs(r.statistic - x) < 1e-6,
      `fixture produced ${r.statistic} where ${x} was intended — the tests below ` +
        `would be checking the wrong point of the curve`,
    );
  }
});

test("p-values match published chi-square tables", () => {
  const worst = [];
  for (const [df, x, want] of CRITICAL) {
    const { p } = chiSquareUniform(countsWithStatistic(df, x));
    const err = Math.abs(p - want);
    worst.push({ df, x, want, p, err });
    // Wilson-Hilferty is weakest at df=1 and tightens quickly.
    const tol = df === 1 ? 0.004 : 0.0015;
    assert.ok(
      err < tol,
      `df=${df} chi2=${x}: p=${p.toFixed(5)}, table says ${want} (off by ${err.toFixed(5)}, tol ${tol})`,
    );
  }
  assert.ok(worst.length === CRITICAL.length);
});

test("p decreases as the deviation grows", () => {
  let prev = Infinity;
  for (let x = 0; x <= 60; x += 0.5) {
    const { p } = chiSquareUniform(countsWithStatistic(5, Math.max(x, 1e-9)));
    assert.ok(p <= prev + 1e-12, `p went up at chi2=${x}`);
    prev = p;
  }
});

test("p stays inside [0, 1] across the range", () => {
  for (const df of [1, 2, 5, 10, 29]) {
    for (const x of [0, 0.001, 1, 10, 100, 1000, 10000]) {
      const { p } = chiSquareUniform(countsWithStatistic(df, Math.max(x, 1e-9)));
      assert.ok(p >= 0 && p <= 1, `p=${p} out of range at df=${df} chi2=${x}`);
    }
  }
});

/** The two cases measured through the live tool. */
test("a fair die passes and a loaded die does not", () => {
  const fair = chiSquareUniform([95, 105, 98, 102, 101, 99]);
  assert.ok(
    fair.p >= 0.05,
    `a realistic fair die over 600 rolls must not be flagged (p=${fair.p.toFixed(4)})`,
  );

  const loaded = chiSquareUniform([70, 70, 70, 70, 70, 250]);
  assert.ok(
    loaded.p < 0.01,
    `a die showing 6 on 250 of 600 rolls must be flagged (p=${loaded.p.toFixed(6)})`,
  );

  const flat = chiSquareUniform([100, 100, 100, 100, 100, 100]);
  assert.equal(flat.statistic, 0, "a perfectly flat sample has no deviation");
  assert.equal(flat.p, 1, "and cannot be evidence of bias");
});

test("degenerate input is refused rather than answered", () => {
  assert.throws(() => chiSquareUniform([5]), /at least 2/, "one cell is not a distribution");
  assert.throws(() => chiSquareUniform([0, 0, 0]), /nothing to test/, "no outcomes recorded");
});
