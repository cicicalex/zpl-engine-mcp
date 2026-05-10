/**
 * Regression tests for ~/.zpl/config.toml parsing helpers.
 *
 * v3.7.2 added:
 *   - parseTomlString — generic field reader (was inline in parseApiKeyFromToml)
 *   - loadPlan        — env > config.toml > "free" precedence
 *
 * Run after `npm run build` — imports compiled JS from ../dist.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseApiKeyFromToml,
  parseTomlString,
  loadPlan,
} from "../dist/config.js";

test("parseTomlString reads basic double-quoted value", () => {
  const raw = `api_key = "zpl_u_abc"\nuser_email = "alex@example.com"\n`;
  assert.equal(parseTomlString(raw, "api_key"), "zpl_u_abc");
  assert.equal(parseTomlString(raw, "user_email"), "alex@example.com");
});

test("parseTomlString reads single-quoted value", () => {
  const raw = `api_key = 'zpl_u_xyz'\n`;
  assert.equal(parseTomlString(raw, "api_key"), "zpl_u_xyz");
});

test("parseTomlString ignores comments and blank lines", () => {
  const raw = `# header\n\n# another\napi_key = "zpl_u_abc" # inline comment\n`;
  assert.equal(parseTomlString(raw, "api_key"), "zpl_u_abc");
});

test("parseTomlString returns undefined when field missing", () => {
  const raw = `user_email = "alex@example.com"\n`;
  assert.equal(parseTomlString(raw, "api_key"), undefined);
  assert.equal(parseTomlString(raw, "plan"), undefined);
});

test("parseTomlString returns undefined for empty value", () => {
  const raw = `api_key = ""\n`;
  assert.equal(parseTomlString(raw, "api_key"), undefined);
});

test("parseTomlString does NOT match field as substring (e.g. 'api_key_new')", () => {
  const raw = `api_key_new = "garbage"\nuser = "alex"\n`;
  assert.equal(parseTomlString(raw, "api_key"), undefined);
});

test("parseApiKeyFromToml is a thin wrapper that still works", () => {
  const raw = `api_key = "zpl_u_abc"\n`;
  assert.equal(parseApiKeyFromToml(raw), "zpl_u_abc");
});

test("loadPlan: ZPL_PLAN env wins over everything", async () => {
  process.env.ZPL_PLAN = "ENTERPRISE"; // also tests case-normalization
  const plan = await loadPlan();
  assert.equal(plan, "enterprise");
  delete process.env.ZPL_PLAN;
});

test("loadPlan: defaults to 'free' when nothing configured", async () => {
  delete process.env.ZPL_PLAN;
  // No env var; config.toml may or may not exist — either way the result
  // should be a known plan slug (engine validates against this list).
  const plan = await loadPlan();
  const knownPlans = new Set([
    "free", "basic", "pro", "gamepro", "studio", "agent", "enterprise", "enterprise_xl",
  ]);
  assert.ok(knownPlans.has(plan), `plan "${plan}" not in known plans set`);
});
