/**
 * The MCP's plan table must match the one the website enforces.
 *
 * AUDIT 2026-07-30: PLAN_INFO in src/tools/meta.ts is a hand-maintained copy
 * of PLAN_TIERS in the website repo, carrying a comment that says it MUST
 * match. It had drifted: Agent showed 15 API keys where the site grants 50.
 * The site had corrected that value — its own note calls the mismatch a refund
 * magnet, since /pricing advertises 50 for Agent at $199/mo — and this copy
 * was never updated. An Agent customer asking zpl_quota was told they get a
 * third of what they pay for.
 *
 * Two copies of the same numbers in two repositories will drift again. Until
 * the plan table is served from one place, these values are pinned here so a
 * change has to be deliberate: editing the table alone fails the suite.
 *
 * Source of truth: zpl-nodeweb/src/lib/constants.ts, PLAN_TIERS.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** tokens, maxD, keys — as granted by the website. */
const EXPECTED = {
  free: { tokens: 5_000, maxD: 9, keys: 1 },
  basic: { tokens: 10_000, maxD: 16, keys: 1 },
  pro: { tokens: 50_000, maxD: 25, keys: 3 },
  gamepro: { tokens: 150_000, maxD: 32, keys: 5 },
  studio: { tokens: 500_000, maxD: 48, keys: 10 },
  agent: { tokens: 2_000_000, maxD: 48, keys: 50 },
  enterprise: { tokens: 10_000_000, maxD: 64, keys: 25 },
  enterprise_xl: { tokens: 50_000_000, maxD: 100, keys: 50 },
};

async function planTable() {
  const src = await readFile(join(ROOT, "src", "tools", "meta.ts"), "utf-8");
  const re =
    /^\s*(\w+):\s*\{\s*price:[^}]*maxD:\s*(\d+),\s*tokens:\s*"([\d,]+)"[^}]*keys:\s*(\d+)/gm;
  const found = {};
  for (const m of src.matchAll(re)) {
    found[m[1]] = {
      maxD: Number(m[2]),
      tokens: Number(m[3].replace(/,/g, "")),
      keys: Number(m[4]),
    };
  }
  return found;
}

test("every plan in the table was parsed", async () => {
  const found = await planTable();
  assert.equal(
    Object.keys(found).length,
    Object.keys(EXPECTED).length,
    `parsed ${Object.keys(found).length} plans, expected ${Object.keys(EXPECTED).length} — ` +
      `the table's shape changed and the comparison below would check the wrong thing`,
  );
});

test("the plan table matches what the website grants", async () => {
  const found = await planTable();
  const drift = [];

  for (const [plan, want] of Object.entries(EXPECTED)) {
    const got = found[plan];
    if (!got) {
      drift.push(`${plan}: missing from PLAN_INFO`);
      continue;
    }
    for (const field of ["tokens", "maxD", "keys"]) {
      if (got[field] !== want[field]) {
        drift.push(`${plan}.${field}: MCP says ${got[field]}, website grants ${want[field]}`);
      }
    }
  }

  assert.deepEqual(
    drift,
    [],
    `the MCP would tell users something different from what they actually get:\n${drift.join("\n")}`,
  );
});
