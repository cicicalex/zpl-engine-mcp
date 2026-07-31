/**
 * The band edges are a judgement call. The ordering is not.
 *
 * AUDIT 2026-07-31: zpl_whale_check and zpl_tokenomics took their verdict from
 * AIN derived from concentrationBias, and both produced orderings that ran the
 * wrong way. Measured against the live engine:
 *
 *   whale_check   top 5 hold   5% -> "High whale risk! Rug pull risk elevated."
 *                 top 5 hold  51%,
 *                 one wallet at 40% -> "Well-distributed. Low whale risk.
 *                                       Healthy decentralization."
 *
 *   tokenomics    insiders 40% -> "Insider-heavy. High concentration risk."
 *                 insiders 85% -> "Fair distribution. Community has meaningful
 *                                  ownership."
 *
 * Fixing the source of the number is not enough on its own, because the
 * replacement thresholds are invented. Alex owns those numbers and may move
 * them. What must survive any move is the direction: more supply concentrated
 * in fewer hands can never read as calmer.
 *
 * So these tests do not assert that 60% is the "high" edge. They sweep the
 * whole range and assert the ordering never reverses, and they pin the three
 * measured cases above by the verdict they must now produce.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  whaleConcentrationBand,
  insiderShareBand,
  WHALE_BANDS,
  INSIDER_BANDS,
} from "../dist/tools/helpers.js";

const whaleRank = (b) => WHALE_BANDS.indexOf(b);
const insiderRank = (b) => INSIDER_BANDS.indexOf(b);

test("every band a tool can print is a known band", () => {
  for (let t = 0; t <= 100; t += 0.5) {
    for (const largest of [0, 5, 15, 25, 35, 100]) {
      const b = whaleConcentrationBand(t, Math.min(largest, t));
      assert.ok(whaleRank(b) >= 0, `unknown whale band ${b} at topTotal=${t}`);
    }
  }
  for (let i = 0; i <= 100; i += 0.5) {
    assert.ok(insiderRank(insiderShareBand(i)) >= 0, `unknown insider band at ${i}`);
  }
});

test("more supply in the top holders never reads as calmer", () => {
  for (const largest of [0, 5, 10, 20, 30]) {
    let prev = -1;
    for (let t = 0; t <= 100; t += 0.5) {
      // largest cannot exceed the total the listed holders hold
      const rank = whaleRank(whaleConcentrationBand(t, Math.min(largest, t)));
      assert.ok(
        rank >= prev,
        `whale band went down at topTotal=${t}, largest=${largest}: ` +
          `${WHALE_BANDS[prev]} -> ${WHALE_BANDS[rank]}`,
      );
      prev = rank;
    }
  }
});

test("a bigger single whale never reads as calmer", () => {
  for (const topTotal of [10, 30, 50, 70, 100]) {
    let prev = -1;
    for (let largest = 0; largest <= topTotal; largest += 0.5) {
      const rank = whaleRank(whaleConcentrationBand(topTotal, largest));
      assert.ok(
        rank >= prev,
        `whale band went down at largest=${largest}, topTotal=${topTotal}`,
      );
      prev = rank;
    }
  }
});

test("a larger insider share never reads as fairer", () => {
  let prev = -1;
  for (let i = 0; i <= 100; i += 0.5) {
    const rank = insiderRank(insiderShareBand(i));
    assert.ok(rank >= prev, `insider band went down at ${i}%`);
    prev = rank;
  }
});

/**
 * The three cases that were measured wrong. Pinned by the verdict they must
 * produce, not by the threshold that produces it — so moving an edge is
 * allowed, and moving it far enough to bring these back is not.
 */
test("the measured cases land on the right side now", () => {
  assert.equal(whaleConcentrationBand(5, 1), "low", "top 5 holding 5% is not whale risk");
  assert.equal(
    whaleConcentrationBand(51, 40),
    "high",
    "top 5 holding 51% with a 40% wallet was called healthy decentralization",
  );
  assert.equal(whaleConcentrationBand(100, 20), "high", "holders owning all supply");

  assert.equal(insiderShareBand(10), "fair");
  assert.equal(
    insiderShareBand(85),
    "majority",
    "85% insider allocation was called fair distribution",
  );
  assert.ok(
    insiderRank(insiderShareBand(85)) > insiderRank(insiderShareBand(40)),
    "85% insiders must never read better than 40% — it did, on the live engine",
  );
});

test("the extremes are the extremes", () => {
  assert.equal(whaleConcentrationBand(0, 0), "low");
  assert.equal(whaleConcentrationBand(100, 100), "high");
  assert.equal(insiderShareBand(0), "fair");
  assert.equal(insiderShareBand(100), "majority");
});
