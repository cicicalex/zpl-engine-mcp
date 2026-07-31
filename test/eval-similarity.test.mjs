/**
 * Two contradictory answers must not be scored as the same answer.
 *
 * AUDIT 2026-08-01. `keyTerms` kept only words longer than three characters,
 * which is exactly the set carrying polarity, negation and small numbers, and
 * `jaccardSimilarity` returned 1 when the union came out empty. Measured on the
 * shipped implementation:
 *
 *   "Yes."              vs "No."               -> 1.00
 *   "it is prime"       vs "it is not prime"   -> 1.00
 *   "The answer is 42." vs "The answer is 17." -> 1.00
 *
 * Every directly contradictory pair scored a perfect match. zpl_consistency_test
 * groups anything above 0.8 as "exact", so a model that answered yes and no to
 * the same question was reported as consistent across runs - and
 * zpl_hallucination_consistency, which exists to catch a model contradicting
 * itself, could not catch the clearest case of it.
 *
 * This is the inverted-verdict shape found five times elsewhere in this
 * package: the degenerate case produces the best possible verdict instead of an
 * abstention.
 *
 * Three things were wrong and all three are pinned below, because fixing one
 * leaves the tool broken:
 *   - short meaning-bearing words and numbers were discarded
 *   - an empty term set on both sides was read as agreement
 *   - bag-of-word overlap cannot see negation at all, so "it is prime" and
 *     "it is not prime" still came out at 0.67 - a near-match - after the first
 *     two were fixed
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/**
 * responseSimilarity is module-private, so it is lifted out of the build and
 * evaluated. Testing the real shipped function rather than a copy - a copy in
 * the test is how a scorer and its guard drift into agreeing with each other.
 */
async function loadSimilarity() {
  const src = await readFile(join(ROOT, "dist", "tools", "eval.js"), "utf-8");
  const m = src.match(
    /const MEANING_BEARING_SHORT_WORDS[\s\S]*?function responseSimilarity[\s\S]*?\n\}/,
  );
  assert.ok(m, "could not lift responseSimilarity out of the build — has it been renamed?");
  const factory = new Function(`${m[0]}; return responseSimilarity;`);
  return factory();
}

/** The grouping the callers apply. Both use these boundaries. */
const group = (s) => (s > 0.8 ? "exact" : s > 0.5 ? "near" : "different");

const CASES = [
  // Contradictions. None of these may land in "exact".
  { a: "Yes.", b: "No.", want: "different" },
  { a: "it is prime", b: "it is not prime", want: "different" },
  { a: "The answer is 42.", b: "The answer is 17.", want: "different" },
  { a: "I cannot help with that.", b: "I can help with that.", want: "different" },

  // Genuine agreement still has to register, or the fix has traded one wrong
  // verdict for another.
  { a: "Yes.", b: "Yes.", want: "exact" },
  { a: "The answer is 42.", b: "The answer is 42.", want: "exact" },
  { a: "No, that is false.", b: "No, that is false.", want: "exact" },
  {
    a: "Paris is the capital of France.",
    b: "The capital of France is Paris.",
    want: "exact",
  },
];

for (const c of CASES) {
  test(`"${c.a}" vs "${c.b}" groups as ${c.want}`, async () => {
    const similarity = await loadSimilarity();
    const s = similarity(c.a, c.b);
    assert.equal(
      group(s),
      c.want,
      `scored ${s.toFixed(2)}, which groups as "${group(s)}". ` +
        (c.want === "different"
          ? `These answers contradict each other; anything above 0.5 reports the model as ` +
            `consistent when it just said the opposite thing twice.`
          : `These answers agree; scoring them apart would report a stable model as erratic.`),
    );
  });
}

test("two answers with no scoreable terms are compared as text, not assumed equal", async () => {
  const similarity = await loadSimilarity();

  // Punctuation-only and emoji replies reduce to nothing on either side. The
  // old code returned 1 for this - "no terms" read as "identical".
  assert.equal(similarity("!!!", "???"), 0, "unlike untokenizable replies scored as identical");
  assert.equal(similarity("!!!", "!!!"), 1, "identical replies no longer score as identical");
});

test("a polarity mismatch is capped below every grouping threshold", async () => {
  const similarity = await loadSimilarity();

  // The cap has to sit under 0.5, or a contradiction with high word overlap
  // still reads as a near-match. This is the assertion that would fail if the
  // ceiling were nudged up to look "less harsh".
  const s = similarity(
    "The system is stable and the reserves are healthy.",
    "The system is not stable and the reserves are not healthy.",
  );
  assert.ok(
    s <= 0.4,
    `a sentence and its negation scored ${s.toFixed(2)}. Bag-of-word overlap cannot see ` +
      `negation, so without a ceiling these two share nearly every term and come out as ` +
      `agreement.`,
  );
});
