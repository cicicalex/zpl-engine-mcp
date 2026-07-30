/**
 * A printed price must be the price that is charged.
 *
 * AUDIT 2026-07-31: zpl_plans — the tool whose entire job is to tell a caller
 * what things cost — ended its table with
 *
 *   Token cost per compute: **d² + d** (e.g., d=9 costs 90 tokens)
 *
 * Nothing charges d²+d. Not the engine (zpl-core `token_cost`, a match on step
 * bands, with a passing test asserting d=9 → 2), not the website
 * (`getTokenCost` in lib/constants.ts, the same bands), and not this package,
 * which carried a correct copy of those bands in tools/meta.ts at the same
 * time. Three agreeing implementations and one sentence that disagreed with
 * all of them, in the only place a user looks up a price.
 *
 * The error is 45-fold at d=9 (90 claimed, 2 charged) and 12-fold at d=3. It
 * overstates, which sounds harmless until you read it as a Free user: 5,000
 * tokens at 90 a call is 55 calls a month, and the real figure is 2,500. The
 * tool was talking people out of using the product.
 *
 * Two rules below. The first is general — any worked example pairing a
 * dimension with a token count must agree with getTokenCost, which is what
 * would have caught this line on the day it was written. The second names the
 * specific invented formula, because a rule that has already been broken once
 * is worth stating twice.
 *
 * Comment lines are skipped. This file's own docstring quotes the offending
 * text, and so do the fix comments in src/ — a guard that flags the
 * description of the bug it prevents is a guard that gets deleted.
 *
 * Run after `npm run build`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { getTokenCost, tokenCostTable, TOKEN_COST_BANDS } from "../dist/tools/helpers.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");

/** A worked example: "d=9 costs 90 tokens", "at d=16 you pay 5 tokens". */
const WORKED_EXAMPLE = /\bd\s*=\s*(\d{1,3})\b[^\n]{0,60}?\b(\d{1,6})\s*tokens?\b/gi;

/** The invented formula, in the spellings someone would plausibly write. */
const SQUARED_FORMULA = /\bd\s*(?:²|\^\s*2|\*\s*d)\s*\+\s*d\b/i;

function isComment(line) {
  const t = line.trim();
  return t.startsWith("*") || t.startsWith("//") || t.startsWith("/*");
}

/**
 * Resolve \uXXXX and \xXX escapes to the characters they denote.
 *
 * Not decoration. This package writes non-ASCII as escapes, so the line that
 * shipped is six characters of `²` on disk where it is one `²` at
 * runtime. The first version of the formula rule below matched the character
 * and was therefore blind to the exact text it was written for — green while
 * the defect sat in the file, which is the worst state a guard can be in.
 * Found by reintroducing the bug and watching nothing happen.
 */
function decodeEscapes(s) {
  return s
    .replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
}

async function tsFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await tsFiles(p)));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

async function sourceLines() {
  const out = [];
  for (const file of await tsFiles(SRC)) {
    const lines = (await readFile(file, "utf-8")).split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!isComment(line)) {
        out.push({ file: file.slice(ROOT.length + 1), n: i + 1, line: decodeEscapes(line) });
      }
    });
  }
  return out;
}

test("the source tree is actually being read", async () => {
  const lines = await sourceLines();
  assert.ok(
    lines.length > 500,
    `only ${lines.length} non-comment source lines found — the guards below would ` +
      `pass without checking anything`,
  );
});

test("every worked cost example quotes the price actually charged", async () => {
  const wrong = [];
  for (const { file, n, line } of await sourceLines()) {
    for (const m of line.matchAll(WORKED_EXAMPLE)) {
      const d = Number(m[1]);
      const claimed = Number(m[2]);
      if (d < 3 || d > 100) continue; // not a dimension
      const real = getTokenCost(d);
      if (claimed !== real) {
        wrong.push(`${file}:${n}: claims d=${d} costs ${claimed} tokens; charged is ${real}`);
      }
    }
  }
  assert.deepEqual(
    wrong,
    [],
    `a published example quotes a price nobody is charged:\n${wrong.join("\n")}`,
  );
});

test("no source states a cost formula the engine does not use", async () => {
  const offenders = [];
  for (const { file, n, line } of await sourceLines()) {
    if (SQUARED_FORMULA.test(line)) offenders.push(`${file}:${n}: ${line.trim().slice(0, 120)}`);
  }
  assert.deepEqual(
    offenders,
    [],
    `token cost is a step band, not a formula:\n${offenders.join("\n")}`,
  );
});

test("the bands cover every dimension the engine accepts, with no gaps", () => {
  assert.equal(TOKEN_COST_BANDS[0].from, 3, "bands must start at the engine minimum");
  for (let i = 1; i < TOKEN_COST_BANDS.length; i++) {
    assert.equal(
      TOKEN_COST_BANDS[i].from,
      TOKEN_COST_BANDS[i - 1].to + 1,
      `gap or overlap between band ${i - 1} and ${i}`,
    );
  }
  assert.equal(TOKEN_COST_BANDS.at(-1).to, null, "the last band must be open-ended");

  // Every dimension in range falls in exactly one band, and the band's quoted
  // price is the one getTokenCost returns for it.
  for (let d = 3; d <= 100; d++) {
    const band = TOKEN_COST_BANDS.find((b) => d >= b.from && (b.to === null || d <= b.to));
    assert.ok(band, `d=${d} falls in no band`);
    assert.equal(
      getTokenCost(d),
      getTokenCost(band.to ?? band.from),
      `d=${d} is priced differently from the rest of its band`,
    );
  }
});

test("the printed table quotes the charged price for each band", () => {
  const table = tokenCostTable();
  const rows = table.split("\n");
  assert.equal(rows.length, TOKEN_COST_BANDS.length, "one row per band");
  for (const row of rows) {
    const m = row.match(/d=(\d+)(?:–(\d+))?\+?\s*→\s*(\d+) tokens/);
    assert.ok(m, `unparseable row: ${row}`);
    const probe = Number(m[2] ?? m[1]);
    assert.equal(Number(m[3]), getTokenCost(probe), `row disagrees with getTokenCost: ${row}`);
  }
  // The value the shipped line got wrong, pinned by name.
  assert.match(table, /d=6–9 → 2 tokens/, "d=6–9 must be quoted at 2 tokens");
});

test("each guard matches what it is meant to catch", () => {
  // The superscript is spelled out as its escape rather than typed, so this
  // fixture is the on-disk form of src/index.ts whatever encoding this test
  // file happens to be saved in. "\\u00B2" in a normal string is six
  // characters — backslash, u, 0, 0, B, 2 — which is exactly what readFile
  // hands the scanner.
  const ESC_SUP2 = "\\u00B2";
  const shipped =
    "text += `\\nToken cost per compute: **d" + ESC_SUP2 + " + d** (e.g., d=9 costs 90 tokens)\\n`;";

  assert.ok(
    shipped.includes("\\u00B2") && !shipped.includes("²"),
    "the fixture must hold the escaped spelling, otherwise this proves nothing",
  );
  assert.ok(
    !SQUARED_FORMULA.test(shipped),
    "raw escaped text is expected NOT to match — that is why decoding exists",
  );
  assert.ok(
    SQUARED_FORMULA.test(decodeEscapes(shipped)),
    "formula guard must catch the line that shipped, once decoded as the scan does",
  );
  assert.ok(
    [...shipped.matchAll(WORKED_EXAMPLE)].some(
      (m) => Number(m[1]) === 9 && Number(m[2]) === 90,
    ),
    "example guard must catch the line that shipped",
  );
  assert.ok(SQUARED_FORMULA.test("cost is d^2 + d per call"), "caret spelling");
  assert.ok(SQUARED_FORMULA.test("const c = d * d + d;"), "code spelling");
});

test("guards stay quiet on correct nearby text", () => {
  assert.ok(!SQUARED_FORMULA.test("const total = d * d;"), "a plain square is not the claim");
  assert.ok(
    ![..."a sweep at d=9 runs 19 steps".matchAll(WORKED_EXAMPLE)].length,
    "a dimension with no token count is not a price claim",
  );
  assert.ok(
    [..."d=9 costs 2 tokens".matchAll(WORKED_EXAMPLE)].every(
      (m) => Number(m[2]) === getTokenCost(Number(m[1])),
    ),
    "a correct example must not be flagged",
  );
});
