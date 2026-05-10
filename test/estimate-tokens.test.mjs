/**
 * Regression tests for the estimateOpTokens helper added in v3.7.2.
 *
 * Pre-v3.7.2 zpl_quota and zpl_alert hardcoded `+= 5` per call, causing
 * 3-100x undercount. The new helper prefers persisted `tokens_used` and
 * falls back to a tool-shape heuristic only when the tool didn't save it.
 *
 * Run after `npm run build` — imports compiled JS from ../dist.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { estimateOpTokens } from "../dist/store.js";

function entry(tool, results) {
  return {
    id: "test-id",
    timestamp: "2026-05-10T00:00:00Z",
    tool,
    results,
    ain_scores: {},
  };
}

test("uses results.tokens_used when present (engine-truth)", () => {
  assert.equal(estimateOpTokens(entry("zpl_compute", { tokens_used: 17 })), 17);
});

test("uses results.totalTokens when present (multi-call tools)", () => {
  assert.equal(estimateOpTokens(entry("zpl_simulate", { totalTokens: 42 })), 42);
});

test("uses results.tokens when present", () => {
  assert.equal(estimateOpTokens(entry("zpl_check_response", { tokens: 9 })), 9);
});

test("falls back to 30 for known multi-compute tools", () => {
  for (const tool of ["zpl_simulate", "zpl_versus", "zpl_compare", "zpl_sweep", "zpl_market_scan"]) {
    assert.equal(estimateOpTokens(entry(tool, {})), 30, `tool=${tool}`);
  }
});

test("falls back to 15 for known heavy single-call tools", () => {
  for (const tool of ["zpl_portfolio", "zpl_loot_table", "zpl_pvp_balance"]) {
    assert.equal(estimateOpTokens(entry(tool, {})), 15, `tool=${tool}`);
  }
});

test("falls back to 5 for unknown / generic tools", () => {
  assert.equal(estimateOpTokens(entry("zpl_decide", {})), 5);
  assert.equal(estimateOpTokens(entry("zpl_unknown_tool", {})), 5);
});

test("explicit tokens_used wins over heuristic for multi-tools", () => {
  // Even if tool name says "multi", trust the persisted number.
  assert.equal(estimateOpTokens(entry("zpl_simulate", { tokens_used: 12 })), 12);
});

test("non-number tokens_used is ignored (falls back to heuristic)", () => {
  assert.equal(estimateOpTokens(entry("zpl_compute", { tokens_used: "wrong-type" })), 5);
});
