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


/**
 * The README's plan table is a third copy of the same numbers.
 *
 * AUDIT 2026-07-31: the guard above was written on 2026-07-30 after finding
 * Agent listed at 15 API keys where the website grants 50. It fixed meta.ts.
 * The README said 15 too and was left alone, because this file read the code
 * and nothing read the prose - so the wrong number survived in the one place a
 * buyer actually looks, the npm landing page for a $199/mo tier.
 *
 * Checked here against the same EXPECTED table, so all three copies - website,
 * meta.ts, README - are pinned to one set of values. A sweep of all eight rows
 * found exactly one mismatch, so this was a single stale cell rather than a
 * table nobody maintained.
 *
 * Annual prices are not checked: they have no counterpart anywhere in code, so
 * there is nothing to compare them against and inventing one would be worse
 * than leaving them alone.
 */
async function readmePlanTable() {
  const md = await readFile(join(ROOT, "README.md"), "utf-8");
  const found = {};
  // | Free | $0 | — | d=9 | 5,000 | 1 |
  const re = /^\|\s*([\w ]+?)\s*\|\s*\$([\d,]+)[^|]*\|[^|]*\|\s*d=(\d+)\s*\|\s*([\d,]+)\s*\|\s*(\d+)\s*\|/gm;
  for (const m of md.matchAll(re)) {
    const key = m[1].toLowerCase().replace(/\s+/g, "_");
    found[key] = {
      maxD: Number(m[3]),
      tokens: Number(m[4].replace(/,/g, "")),
      keys: Number(m[5]),
    };
  }
  return found;
}

test("the README's plan table matches what the website grants", async () => {
  const found = await readmePlanTable();

  assert.equal(
    Object.keys(found).length,
    Object.keys(EXPECTED).length,
    `parsed ${Object.keys(found).length} plan rows from README.md, expected ` +
      `${Object.keys(EXPECTED).length}. If the table changed shape this guard is now ` +
      `checking a subset and would not say so.`,
  );

  const drift = [];
  for (const [plan, want] of Object.entries(EXPECTED)) {
    const got = found[plan];
    if (!got) {
      drift.push(`${plan}: granted by the website, absent from the README table`);
      continue;
    }
    for (const field of ["maxD", "tokens", "keys"]) {
      if (got[field] !== want[field]) {
        drift.push(`${plan}.${field}: README says ${got[field]}, the website grants ${want[field]}`);
      }
    }
  }

  assert.deepEqual(
    drift,
    [],
    "the README advertises something other than what customers get:\n" +
      drift.map((d) => `  ${d}`).join("\n") +
      "\n\nThis table is the npm landing page. It is the first number a buyer reads " +
      "and the last one anybody thinks to check.",
  );
});
