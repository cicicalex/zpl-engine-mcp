/**
 * No tool may predict what the engine will return.
 *
 * AUDIT 2026-07-31: `zpl_validate_input` warned, for a perfectly even
 * distribution, that "AIN will be near maximum stability — possibly trivial
 * input". Measured end to end against the live engine at d=9, samples=50000,
 * taking each distribution through distributionBias, the conversion this
 * package documents:
 *
 *   0.25 / 0.25 / 0.25 / 0.25  -> bias 0.00 -> ain 0.000  HIGH_BIAS
 *   0.30 / 0.25 / 0.25 / 0.20  -> bias 0.05 -> ain 0.995  CERTIFIED_NEUTRAL
 *   0.55 / 0.20 / 0.15 / 0.10  -> bias 0.30 -> ain 0.887  NEUTRAL
 *   0.97 / 0.01 / 0.01 / 0.01  -> bias 0.72 -> ain 0.954  HIGHLY_NEUTRAL
 *
 * Exactly inverted. The one input called near-maximum is the only one that
 * reaches the floor, and the most lopsided distribution outscores the fair one.
 *
 * This is the same scale collision the verdict tools were purged of on
 * 2026-07-30 — distance from uniform handed to a density parameter, where 0
 * means an all-zeros matrix. It survived here for a specific reason worth
 * writing down: verdict-source.test.mjs looks for a verdict branching on `ain`,
 * and this tool never branches on anything. It states an expectation, in prose,
 * before any call is made. A guard shaped around verdicts cannot see that.
 *
 * Hence this guard is shaped around the claim instead: no shipped string may
 * assert what AIN, the status, or the score is going to be. The tool is free
 * and pre-flight — its entire purpose is telling someone what to expect before
 * they pay — so a confident wrong expectation is worse than none.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");

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
 * A future-tense claim about the engine's output. Deliberately about the verb,
 * not the noun: "AIN is a stability measurement" is a definition and must stay,
 * while "AIN will be high" is a forecast this package cannot make.
 */
const PREDICTION =
  /\b(AIN|score|status|reading)\s+(will|should|is going to)\s+be\b|\bexpect\s+(a\s+)?(high|low|near-?maximum|near-?minimum)\b/i;

test("nothing tells the caller what the engine is going to return", async () => {
  const offenders = [];

  for (const f of await sourceFiles(SRC)) {
    const code = stripComments(await readFile(f, "utf-8"));
    for (const line of code.split("\n")) {
      if (PREDICTION.test(line)) {
        offenders.push(`${f.replace(SRC, "src")}: ${line.trim().slice(0, 110)}`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    "these lines forecast the engine's own output:\n" +
      offenders.map((o) => `  ${o}`).join("\n") +
      "\n\nMeasured: an even distribution converts to bias 0 and scores AIN 0, while " +
      "a 97/1/1/1 split scores 0.954. Any forecast made from the shape of the input " +
      "is a guess dressed as guidance — and the package cannot know which conversion " +
      "the caller's tool will apply.",
  );
});

test("the even-distribution warning still warns, and says why", async () => {
  // Deleting the sentence would satisfy the guard above and lose the point:
  // an even distribution really is the degenerate case here, just not in the
  // direction the old text claimed.
  const meta = stripComments(await readFile(join(SRC, "tools", "meta.ts"), "utf-8"));

  const at = meta.indexOf("All values equal");
  assert.notEqual(at, -1, "the even-distribution warning is gone entirely");
  const warning = meta.slice(at, at + 700);

  assert.match(
    warning,
    /lowest input|distance from uniform/i,
    "the warning no longer explains that an even distribution converts to the " +
      "engine's lowest input, which is the fact that makes it worth warning about",
  );
  assert.doesNotMatch(
    warning,
    /near maximum/i,
    "the inverted claim is back",
  );
});
