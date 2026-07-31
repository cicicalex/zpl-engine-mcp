/**
 * A verdict must not come from AIN when AIN came from a distance-from-uniform
 * measure.
 *
 * AUDIT 2026-07-31: zpl_model_bias was measured against the live engine:
 *
 *   500 / 500  (perfectly balanced) -> AIN  0/100  "Severe prediction bias.
 *                                                   Model is effectively
 *                                                   ignoring minority classes."
 *   990 /  10  (99:1)               -> AIN 87/100  "Model predictions are
 *                                                   well-distributed. No
 *                                                   significant class bias."
 *
 * Exactly inverted. A model ignoring 99% of a class was certified clean, and a
 * perfectly balanced one was told to retrain.
 *
 * The cause was diagnosed and fixed for the gaming tools on 2026-07-30, and the
 * diagnosis is written out in tools/helpers.ts above distributionFairness:
 * distributionBias, concentrationBias and varianceBias all measure distance
 * from uniform, 0 meaning perfectly even, and that value was handed to the
 * engine's density parameter, where 0 means an all-zeros matrix and the reading
 * collapses. Even input therefore looks degenerate and skewed input lands
 * mid-range where scores are high. For two categories the mapping is
 * monotonically backwards.
 *
 * The fix was applied to the tools that were reported and to no others, while
 * the file carrying the explanation sat next to eight more tools doing the same
 * thing. That is the failure this guard exists to stop repeating.
 *
 * The rule: within one tool, using a distance-from-uniform measure AND
 * comparing `ain` against a threshold is the defect. Tools that take their
 * verdict from a local measure are exempt, which is what "fixed" means here.
 *
 * KNOWN_INVERTED is the work not yet done. The assertion is equality, not
 * subset, so a new occurrence fails and so does fixing one without striking it
 * from the list. The list is only allowed to shrink.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TOOLS = join(ROOT, "src", "tools");

/** Measures that answer "how far from even", where 0 means perfectly even. */
const SYMMETRIC_MEASURE = /(distributionBias|concentrationBias|varianceBias)\s*\(/;

/**
 * A verdict branching on AIN. Matches both spellings that occur here:
 *   if (ain >= 70) ...
 *   text += ain >= 70 ? ... : ain >= 40 ? ... : ...
 * The ternary form is why this is not anchored to `if` — zpl_debate uses it,
 * and the first version of this scan reported that tool clean.
 */
const VERDICT_ON_AIN = /\bain\s*[<>]=?\s*\d/;

/** Local, deterministic measures. A tool using one has been converted. */
const LOCAL_MEASURE =
  /distributionFairness|sycophancyScore|consistencyScore|refusalBalance|directionalBias/;

/**
 * Tools still taking their verdict from AIN derived from a symmetric measure.
 * Each is wrong in the same way zpl_model_bias was. Strike an entry when the
 * tool is converted; adding one requires a very good reason.
 */
const KNOWN_INVERTED = [
  // Empty as of 2026-07-31. Every tool that took its verdict from a
  // distance-from-uniform measure has been converted. The list stays, and the
  // assertion stays equality, so the next one to appear fails here.
  // crypto.ts:zpl_whale_check and zpl_tokenomics converted 2026-07-31 - both
  // needed a domain measure rather than a fairness one; see helpers.ts.
  // finance.ts:zpl_portfolio converted 2026-07-31 — measured 25/25/25/25 at
  // AIN 0.00 "heavily skewed" and 97/1/1/1 at AIN 43.70 "some concentration
  // risk"; now 100.0 and 4.0 diversification respectively.
  // gaming.ts:zpl_rng_test converted 2026-07-31 - needed a chi-square test,
  // not a fairness score; a fair die is allowed to deviate. See chi-square.test.mjs.
  // security.ts:zpl_vuln_map and zpl_risk_score converted 2026-07-31 - posture
  // now comes from the worst finding, using the thresholds those tools already
  // printed per row.
];

async function toolFiles() {
  const out = [];
  for (const e of await readdir(TOOLS, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith(".ts")) continue;
    if (e.name === "helpers.ts" || e.name === "index.ts") continue;
    out.push(e.name);
  }
  return out;
}

/** Split a file into one body per registered tool. */
async function toolBodies() {
  const found = [];
  for (const name of await toolFiles()) {
    const src = await readFile(join(TOOLS, name), "utf-8");
    for (const chunk of src.split("server.tool(").slice(1)) {
      const m = chunk.slice(0, 200).match(/"(zpl_\w+)"/);
      if (m) found.push({ file: name, tool: m[1], body: chunk.slice(0, 12000) });
    }
  }
  return found;
}

/**
 * AUDIT 2026-07-31, second pass: this used to read
 *
 *   SYMMETRIC_MEASURE && VERDICT_ON_AIN && !LOCAL_MEASURE
 *
 * which asks whether the body *mentions* a local measure anywhere, not whether
 * the verdict uses one. Proving it on the empty list caught the hole: putting
 * zpl_debate's verdict back to `ain >= 70` changed nothing, because the
 * `const balance = distributionFairness(...)` line two rows above still
 * satisfied the exemption. A guard that reports green on the exact defect it
 * was written for is worse than no guard.
 *
 * The exemption is gone. Once a tool is converted it has no reason to compare
 * AIN against a threshold at all — displaying AIN is fine, deciding on it is
 * not — so the rule is simply: a symmetric measure and an AIN threshold in the
 * same tool.
 */
function isInverted({ body }) {
  return SYMMETRIC_MEASURE.test(body) && VERDICT_ON_AIN.test(body);
}

test("tool bodies were actually parsed", async () => {
  const bodies = await toolBodies();
  assert.ok(
    bodies.length >= 40,
    `only ${bodies.length} tools parsed — the registration shape changed and this ` +
      `guard would report everything clean while checking nothing`,
  );
});

test("no tool outside the known list takes its verdict from a symmetric measure", async () => {
  const found = (await toolBodies())
    .filter(isInverted)
    .map((t) => `${t.file}:${t.tool}`)
    .sort();

  assert.deepEqual(
    found,
    [...KNOWN_INVERTED].sort(),
    `the set of tools whose verdict is driven by a distance-from-uniform measure ` +
      `changed.\n\nfound:\n  ${found.join("\n  ")}\n\nexpected:\n  ${KNOWN_INVERTED.join("\n  ")}\n\n` +
      `If you fixed one, remove it from KNOWN_INVERTED. If one appeared, it will ` +
      `report a perfectly balanced input as severely biased — see the note at the ` +
      `top of this file.`,
  );
});

test("the three converted ai-ml tools are no longer in the inverted set", async () => {
  const bodies = await toolBodies();
  for (const tool of ["zpl_model_bias", "zpl_dataset_audit", "zpl_prompt_test"]) {
    const t = bodies.find((b) => b.tool === tool);
    assert.ok(t, `${tool} not found`);
    assert.ok(!isInverted(t), `${tool} is back to taking its verdict from AIN`);
    assert.match(
      t.body,
      /distributionFairness\(/,
      `${tool} must take its verdict from the distribution itself`,
    );
  }
});

/**
 * The headline is the number that gets read. Converting the verdict while
 * leaving AIN in the title produced "AIN 0.00/100" directly above
 * "well-distributed" for a 50/50 split — a self-contradicting output rather
 * than an inverted one, which is not obviously an improvement.
 */
test("converted tools do not headline the number their verdict ignores", async () => {
  const bodies = await toolBodies();
  const offenders = [];
  for (const tool of ["zpl_model_bias", "zpl_dataset_audit", "zpl_prompt_test"]) {
    const t = bodies.find((b) => b.tool === tool);
    const header = t.body.match(/let text = `## ([^`\n]{0,120})/);
    assert.ok(header, `${tool}: no header found`);
    if (/AIN \$\{fmtAin/.test(header[1])) offenders.push(`${tool}: ${header[1].trim()}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `headline reports AIN while the verdict below is measured from the ` +
      `distribution:\n${offenders.join("\n")}`,
  );
});

test("the detector catches the shape that shipped and spares the fix", () => {
  const shipped = `
    const bias = distributionBias(counts);
    const result = await client.compute({ d, bias, samples: 3000 });
    const ain = ainScale(result.ain);
    if (ain >= 70) text += "well-distributed";
    else text += "severe bias";
  `;
  assert.ok(isInverted({ body: shipped }), "must catch the if-form that shipped");

  const ternary = `
    const biasA = distributionBias(scoresA);
    text += ain >= 70 ? "fair debate" : "one-sided";
  `;
  assert.ok(isInverted({ body: ternary }), "must catch the ternary form (zpl_debate)");

  const fixed = `
    const bias = distributionBias(counts);
    const ain = ainScale(result.ain);
    const fair = distributionFairness(counts);
    if (fair.band === "fair") text += "well-distributed";
  `;
  assert.ok(!isInverted({ body: fixed }), "must spare a tool whose verdict uses a local measure");

  // The shape that slipped through the first version of this detector: a
  // converted tool that still decides on AIN. Computing a local measure two
  // lines above does not make the decision local.
  const halfConverted = `
    const bias = distributionBias(counts);
    const ain = ainScale(result.ain);
    const fair = distributionFairness(counts);
    if (ain >= 70) text += "well-distributed";
  `;
  assert.ok(
    isInverted({ body: halfConverted }),
    "a local measure sitting unused beside an AIN threshold must still be caught",
  );

  const noVerdict = `
    const bias = distributionBias(counts);
    results.sort((a, b) => b.ain - a.ain);
  `;
  assert.ok(
    !isInverted({ body: noVerdict }),
    "ranking by ain is not a verdict threshold — sorting must not be flagged",
  );
});
