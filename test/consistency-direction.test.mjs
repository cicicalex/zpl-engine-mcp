/**
 * A consistency score must be able to tell consistency from hallucination.
 *
 * The tool asks the same question several times, groups the answers by
 * similarity into exact / near / different, and promises "AIN HIGH =
 * factually stable, LOW = hallucinating".
 *
 * It could not deliver that. The grouping was fed to a distance-from-uniform
 * measure, which only asks whether ONE bucket dominates — not which one:
 *
 *   all identical   [9,0,0] -> 0.6667
 *   all near        [0,9,0] -> 0.6667
 *   all different   [0,0,9] -> 0.6667
 *   mixed           [3,3,3] -> 0.0000
 *
 * So a model whose every answer contradicts its last scored exactly like one
 * that repeats itself perfectly — and a mixed result, which is what real
 * models actually produce, came out worst of all.
 *
 * The comment above that code justified it with "distributionBias([N,0,0]) =
 * 1.0". It is 0.6667. The premise was wrong as well as the conclusion.
 *
 * Consistency has a direction. This follows it.
 *
 * Run after `npm run build`.
 */

import test from "node:test";
import assert from "node:assert/strict";

const { consistencyScore } = await import("../dist/tools/helpers.js");

test("repeating yourself scores better than contradicting yourself", () => {
  const stable = consistencyScore({ exact: 9, near: 0, different: 0 });
  const hallucinating = consistencyScore({ exact: 0, near: 0, different: 9 });
  assert.ok(
    stable.consistency > hallucinating.consistency,
    `identical answers scored ${stable.consistency}, all-different ${hallucinating.consistency} — ` +
      `telling these apart is the entire tool`,
  );
});

test("the three groupings are all distinguishable", () => {
  const scores = [
    consistencyScore({ exact: 9, near: 0, different: 0 }).consistency,
    consistencyScore({ exact: 0, near: 9, different: 0 }).consistency,
    consistencyScore({ exact: 0, near: 0, different: 9 }).consistency,
  ];
  assert.equal(new Set(scores).size, 3, `expected three distinct scores, got ${scores.join(", ")}`);
});

test("a realistic mixed result is not the worst possible outcome", () => {
  // The old measure gave [3,3,3] its lowest score of all — worse than every
  // answer contradicting every other. That is backwards.
  const mixed = consistencyScore({ exact: 3, near: 3, different: 3 });
  const worst = consistencyScore({ exact: 0, near: 0, different: 9 });
  assert.ok(
    mixed.consistency > worst.consistency,
    `mixed scored ${mixed.consistency}, all-different ${worst.consistency}`,
  );
});

test("consistency falls monotonically as answers diverge", () => {
  const ladder = [
    { exact: 9, near: 0, different: 0 },
    { exact: 6, near: 3, different: 0 },
    { exact: 3, near: 3, different: 3 },
    { exact: 0, near: 3, different: 6 },
    { exact: 0, near: 0, different: 9 },
  ];
  const scores = ladder.map((c) => consistencyScore(c).consistency);
  for (let i = 1; i < scores.length; i++) {
    assert.ok(
      scores[i] < scores[i - 1],
      `step ${i}: ${scores[i - 1]} -> ${scores[i]} did not fall as answers diverged`,
    );
  }
});

test("the extremes are the full range", () => {
  assert.equal(consistencyScore({ exact: 5, near: 0, different: 0 }).consistency, 100);
  assert.equal(consistencyScore({ exact: 0, near: 0, different: 5 }).consistency, 0);
});

test("no responses is refused rather than scored", () => {
  assert.throws(
    () => consistencyScore({ exact: 0, near: 0, different: 0 }),
    /no responses|at least/i,
  );
});

test("the verdict band follows the score", () => {
  assert.equal(consistencyScore({ exact: 9, near: 0, different: 0 }).band, "stable");
  assert.equal(consistencyScore({ exact: 0, near: 0, different: 9 }).band, "hallucinating");
});
