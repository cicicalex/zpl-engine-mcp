/**
 * A bias sent to the engine must be a real number.
 *
 * Why this file exists:
 *   Every bias helper ended in `Math.min(1, Math.max(0, x))`. That reads like
 *   a bound, but neither Math.min nor Math.max rejects NaN — both return it.
 *   `JSON.stringify({bias: NaN})` then yields `{"bias":null}`, so a
 *   computation that had failed arrived at the engine looking like a request,
 *   was accepted as one, and was billed as one.
 *
 *   The route in was zpl_analyze, whose `input` is declared
 *   `z.record(z.string(), z.unknown())` — the tool-level zod schemas that
 *   guard every other entry point do not apply there. Of the six domain
 *   lenses, five reject short input at their own boundary; `universal`, the
 *   flagship, did not.
 *
 *   The empty and non-numeric cases at least produced a visibly broken
 *   request. The `null` score was worse: it read as zero, and the user got a
 *   confident AIN back for an input they never supplied.
 *
 * Run after `npm run build`.
 */

import test from "node:test";
import assert from "node:assert/strict";

const helpers = await import("../dist/tools/helpers.js");
const { universalLens } = await import("../dist/domains/universal.js");

const BIAS_HELPERS = [
  "distributionBias",
  "directionalBias",
  "varianceBias",
  "concentrationBias",
];

test("the built helpers are actually loaded", () => {
  for (const name of BIAS_HELPERS) {
    assert.equal(
      typeof helpers[name],
      "function",
      `${name} missing from dist — the checks below would prove nothing`,
    );
  }
});

test("no bias helper returns a non-finite value for degenerate input", () => {
  const degenerate = [
    ["empty", []],
    ["single element", [5]],
    ["all zeros", [0, 0, 0]],
    ["a non-numeric entry", ["seven", 1, 2]],
    ["a null entry", [null, 1, 2]],
    ["infinity", [Infinity, 1, 2]],
  ];

  for (const name of BIAS_HELPERS) {
    for (const [label, input] of degenerate) {
      let result;
      try {
        result = helpers[name](input);
      } catch {
        continue; // refusing is the intended outcome
      }
      assert.ok(
        Number.isFinite(result),
        `${name}(${label}) returned ${result} instead of refusing — ` +
          `this serialises to null and reaches the engine as a real request`,
      );
      assert.ok(
        result >= 0 && result <= 1,
        `${name}(${label}) returned ${result}, outside the 0-1 contract`,
      );
    }
  }
});

test("clampBias refuses NaN rather than passing it on as null", () => {
  assert.throws(() => helpers.clampBias(NaN, "test"), /could not be computed/);
  assert.throws(() => helpers.clampBias(Infinity, "test"), /could not be computed/);
  // And still clamps ordinary values the way the old expression did.
  assert.equal(helpers.clampBias(0.42, "test"), 0.42);
  assert.equal(helpers.clampBias(-3, "test"), 0);
  assert.equal(helpers.clampBias(7, "test"), 1);
});

test("the universal lens rejects input it cannot score", () => {
  // An empty row passed the old `!scores?.[0]` guard because [] is truthy.
  assert.throws(
    () => universalLens.buildParams({ scores: [[]] }),
    /at least one factor score/,
  );
  assert.throws(
    () => universalLens.buildParams({ scores: [["seven"]] }),
    /not a finite number/,
  );
  // The quiet one: null read as a score of zero and produced a real answer.
  assert.throws(
    () => universalLens.buildParams({ scores: [[null]] }),
    /not a finite number/,
  );
  // Cases the original guard did already catch, kept so it is not weakened.
  assert.throws(() => universalLens.buildParams({ scores: [] }), /required/);
  assert.throws(() => universalLens.buildParams({}), /required/);
});

test("valid input is untouched by the new checks", () => {
  const params = universalLens.buildParams({ scores: [[7, 5, 9]] });
  assert.equal(params.d, 3);
  assert.equal(params.samples, 1000);
  // Pinned to the value this returned before the fix — the guards must not
  // have moved any number that was already being computed correctly.
  assert.equal(params.bias, 0.20430952132988162);
});
