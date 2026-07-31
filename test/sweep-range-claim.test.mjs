/**
 * The sweep must not claim a range it does not cover.
 *
 * AUDIT 2026-07-31, measured against the live engine rather than reasoned about.
 *
 * `zpl_sweep` said "tests all 19 bias levels (0.0 to 1.0)". The engine's 19
 * steps are 0.05, 0.10, ... 0.95 — confirmed by reading the bias values off a
 * real /sweep response. The endpoints are not a rounding detail. They are where
 * the entire dynamic range of the reading lives:
 *
 *   d=9, samples=50000
 *     bias 0      -> ain 0.000        bias 0.95 (last step)  -> high
 *     bias 0.001  -> ain 0.099        bias 0.99   -> ain 0.500
 *     bias 0.01   -> ain 0.657        bias 0.999  -> ain 0.065
 *     bias 0.05 (first step) -> ain 0.891        bias 1      -> ain 0.000
 *
 * Across the sweep's own 19 steps, at d=9, 25 and 48 with samples=50000, the
 * reading never left 0.891 .. 1.000. So the tool sold for "understanding
 * sensitivity and finding neutral points" samples the plateau, skips both
 * cliffs, and reported that it had covered 0.0 to 1.0. A customer paying 19x a
 * single compute to see how the reading responds was shown the one region where
 * it barely does.
 *
 * This is why the guard checks the claim and not the step count. Nineteen steps
 * was always true; what they span was not.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");

/** The actual span, read off a live /sweep response on 2026-07-31. */
const FIRST_STEP = 0.05;
const LAST_STEP = 0.95;

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

async function sourceFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sourceFiles(p)));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * Claims that the sweep spans the whole 0..1 interval. Comments are stripped
 * first — the audit note above each fix quotes the old sentence, and a raw scan
 * would read that as the claim still shipping.
 */
const OVERCLAIM = /(all bias levels|0\.0 to 1\.0|0 to 1\b|every bias level|full bias range)/i;

test("no shipped text claims the sweep covers 0.0 to 1.0", async () => {
  const offenders = [];

  for (const f of await sourceFiles(SRC)) {
    const code = stripComments(await readFile(f, "utf-8"));
    // Only where the sentence is about the sweep.
    for (const line of code.split("\n")) {
      if (!/sweep/i.test(line)) continue;
      if (OVERCLAIM.test(line)) {
        offenders.push(`${f.replace(SRC, "src")}: ${line.trim().slice(0, 100)}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "the sweep is described as covering the whole bias interval:\n" +
      offenders.map((o) => `  ${o}`).join("\n") +
      `\n\nIt runs ${FIRST_STEP} to ${LAST_STEP}. The excluded ends are where the ` +
      `reading actually moves — inside the sweep it stays above 0.89.`,
  );
});

test("the sweep's real span is stated where it is described", async () => {
  // Removing the false claim is not enough on its own: silence leaves the
  // customer with the same wrong assumption and no way to notice.
  const index = stripComments(await readFile(join(SRC, "index.ts"), "utf-8"));

  const at = index.indexOf('"zpl_sweep"');
  assert.notEqual(at, -1, "zpl_sweep is gone — this guard checks nothing");
  const description = index.slice(at, at + 1400);

  // Anchored to the sentence that declares what the sweep DOES, not to any
  // appearance of the two numbers. The looser form passed a break test it
  // should have failed: deleting the span from the opening sentence left the
  // later clause about what the sweep cannot reach — "below 0.05 and above
  // 0.95" — and the two numbers still sat within the window. A statement of
  // the exclusions is not a statement of the range.
  assert.match(
    description,
    new RegExp(`bias steps from ${FIRST_STEP} to ${LAST_STEP}`),
    `zpl_sweep no longer states that its steps run ${FIRST_STEP} to ${LAST_STEP}. ` +
      `Without the span the caller cannot tell that both ends are missing.`,
  );
  assert.match(
    description,
    /zpl_compute/,
    "zpl_sweep no longer points at the tool that can reach the excluded ends. " +
      "Naming the limitation without naming the way round it leaves the caller stuck.",
  );
});

test("the teaching text agrees with the tool description", async () => {
  // zpl_teach is where people go first, and it carried the same overclaim in
  // its own words — "tests all bias levels" — so fixing only the tool would
  // have left the friendlier surface wrong.
  const advanced = stripComments(await readFile(join(SRC, "tools", "advanced.ts"), "utf-8"));

  const at = advanced.indexOf("**Sweep:**");
  assert.notEqual(at, -1, "the sweep line in zpl_teach is gone");
  const line = advanced.slice(at, at + 400);

  assert.doesNotMatch(line, /all bias levels/i, "zpl_teach claims all bias levels again");
  assert.match(
    line,
    new RegExp(`${FIRST_STEP}[\\s\\S]{0,60}${LAST_STEP}`),
    "zpl_teach no longer states the real span of the sweep",
  );
});
