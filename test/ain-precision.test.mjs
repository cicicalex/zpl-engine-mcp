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

test("no source file advertises the fictional 0.1-99.9 AIN range", async () => {
  const offenders = [];
  for (const file of await tsFiles(SRC)) {
    const src = await readFile(file, "utf-8");
    const lines = src.split(/\r?\n/);
    lines.forEach((line, i) => {
      if (/0\.1\s*(?:-|–|—|to)\s*99\.9/i.test(line)) {
        offenders.push(`${file.slice(ROOT.length + 1)}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  assert.deepEqual(offenders, [], `false AIN range claim:\n${offenders.join("\n")}`);
});
