/**
 * AIN precision — the engine returns `ain` on the 0.0-1.0 scale with 6 decimals.
 * Rounding it to an integer percentage throws away 4 of those decimals and
 * contradicts the determinism claim, so it must not come back.
 *
 * Run after `npm run build`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");

async function tsFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await tsFiles(p)));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

test("ainScale keeps the decimals, fmtAin renders two of them", async () => {
  const { ainScale, fmtAin, ainPct } = await import(
    new URL("../dist/ain-format.js", import.meta.url).href
  );
  assert.equal(ainScale(0.932415), 93.2415);
  assert.equal(fmtAin(93.2415), "93.24");
  assert.equal(ainPct(0.932415), "93.24");
  // The exact case the contract calls out: a value that integer rounding
  // would flatten to "93".
  assert.notEqual(ainPct(0.932415), "93");
});

test("no source file rounds an AIN value to whole percent", async () => {
  const offenders = [];
  for (const file of await tsFiles(SRC)) {
    const src = await readFile(file, "utf-8");
    const lines = src.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/Math\.round\([^)]*\.ain\s*\*\s*100\)/.test(line)) {
        offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    `AIN precision lost by integer rounding:\n${offenders.join("\n")}`,
  );
});

// AUDIT 2026-07-30: this guard used to require the two numbers to be
// separated by nothing but whitespace and a dash or the word "to":
//   /0\.1\s*(?:-|–|—|to)\s*99\.9/i
// The claim that actually shipped read
//   Score: **0.1** (extreme bias) to **99.9** (perfect neutrality)
// and the markdown emphasis plus the parenthetical between the numbers
// meant the pattern never matched. The test stayed green for weeks while
// the false range sat in src/tools/advanced.ts, and a later sweep reported
// the line fixed on the strength of that green — the test was confirming
// the mistake rather than catching it.
//
// Now: the two numbers anywhere on the same line, with a bounded gap so a
// coincidental pairing further down a long line still does not trip it.
// The gap in the wording that shipped ("** (extreme bias) to **") is 23
// characters; 30 leaves room for similar markup and parentheticals without
// reaching across to unrelated numbers.
const FALSE_RANGE = /0\.1\b[^\n]{0,30}?\b99\.9/;

test("no source file advertises the fictional 0.1-99.9 AIN range", async () => {
  const offenders = [];
  for (const file of await tsFiles(SRC)) {
    const src = await readFile(file, "utf-8");
    const lines = src.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (FALSE_RANGE.test(line)) {
        offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `false AIN range claim:\n${offenders.join("\n")}`);
});

test("the range guard catches the wording that actually shipped", () => {
  // Regression for the miss above — if this ever stops matching, the guard
  // has been narrowed back to something that lets the real case through.
  assert.ok(
    FALSE_RANGE.test("- Score: **0.1** (extreme bias) to **99.9** (perfect neutrality)"),
    "guard must match the markdown-emphasised wording",
  );
  assert.ok(FALSE_RANGE.test("range 0.1 - 99.9"), "guard must match the plain wording");
  assert.ok(FALSE_RANGE.test("from 0.1 to 99.9"), "guard must match the prose wording");
  // And must not fire on unrelated numbers that merely appear together.
  assert.ok(
    !FALSE_RANGE.test("bias 0.1 is fine; a separate note about 12.5 and later 99.9 percent uptime figures appear far away"),
    "guard must not fire across an unbounded gap",
  );
});
