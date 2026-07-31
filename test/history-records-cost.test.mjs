/**
 * A tool that spends engine tokens must record how many.
 *
 * AUDIT 2026-07-31: the eight AI-eval tools each call `client.compute` and none
 * of them passed a token figure to addHistory. `estimateOpTokens` falls back to
 * a flat 5 for anything it cannot read a real number from, and that fallback
 * feeds `zpl_usage`, `zpl_quota` and `zpl_alert` — the local budget dashboard.
 *
 * The size of the error is set by the caller's own input:
 *
 *   zpl_refusal_balance accepts up to 50 prompts -> d=50 -> 500 tokens, recorded as 5.
 *
 * A hundredfold under-count, on the number a user consults precisely to find out
 * whether they are about to run out. Every one of the eight already had
 * `result.tokens_used` in scope; several were adding it into a total they
 * printed on screen. The figure was measured, displayed, and then dropped.
 *
 * What is recorded is the engine's `tokens_used`, deliberately, and not the
 * printed total. That total also counts Claude tokens, which the ZPL plan quota
 * does not cover — recording it would swap an under-count for an over-count.
 *
 * COMMENTS ARE STRIPPED FIRST. The audit note added above the fixed call
 * contains the words "tokens_used was missing here", and a guard that scanned
 * raw text would read that as evidence the figure is present. This has cost
 * seven guards in two days; a rule about what the code does never reads prose.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { estimateOpTokens } from "../dist/store.js";

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

/** Each registered tool's handler body, comments removed. */
async function tools() {
  const out = [];
  for (const f of await sourceFiles(SRC)) {
    const src = stripComments(await readFile(f, "utf8"));
    const marks = [...src.matchAll(/\.tool\(\s*\n?\s*"([a-z_0-9]+)"/g)];
    marks.forEach((mk, i) => {
      out.push({
        name: mk[1],
        body: src.slice(mk.index, i + 1 < marks.length ? marks[i + 1].index : src.length),
        file: f,
      });
    });
  }
  return out;
}

/** The addHistory(...) call in a body, bounded by matching parens. */
function recordedEntry(body) {
  const m = /addHistory\s*\(/.exec(body);
  if (!m) return null;
  const start = m.index + m[0].length - 1;
  let depth = 0;
  for (let j = start; j < body.length; j++) {
    if (body[j] === "(") depth++;
    else if (body[j] === ")") {
      depth--;
      if (depth === 0) return body.slice(start, j + 1);
    }
  }
  return body.slice(start);
}

const SPENDS_TOKENS = /\bclient\.(compute|sweep|analyze)\s*\(/;
/** Shorthand counts: `{ title, totalTokens }` sets the property too. */
const RECORDS_COST = /\b(tokens_used|totalTokens|tokens)\s*[:,}]/;

test("every tool that spends engine tokens records the amount in history", async () => {
  const all = await tools();
  assert.ok(all.length > 50, `only ${all.length} tools parsed — the parser is stale`);

  const silent = all
    .filter((t) => SPENDS_TOKENS.test(t.body))
    .filter((t) => {
      const entry = recordedEntry(t.body);
      return entry !== null && !RECORDS_COST.test(entry);
    })
    .map((t) => t.name);

  assert.deepEqual(
    silent,
    [],
    `${silent.join(", ")} call the engine and write a history entry with no token ` +
      `figure. estimateOpTokens then guesses a flat 5, and that guess is what the ` +
      `budget dashboard adds up — so the number a user checks to see whether they ` +
      `are running out is wrong by however much the real call cost.`,
  );
});

test("the fallback really is a flat guess, so the rule above is worth enforcing", () => {
  // If estimateOpTokens ever became clever, the guard above would be pedantry.
  // Pin the thing that makes it matter.
  const withFigure = estimateOpTokens({
    tool: "zpl_refusal_balance",
    results: { total: 50, tokens_used: 500 },
    ain_scores: {},
  });
  const without = estimateOpTokens({
    tool: "zpl_refusal_balance",
    results: { total: 50 },
    ain_scores: {},
  });

  assert.equal(withFigure, 500, "a recorded tokens_used is no longer read back");
  assert.equal(
    without,
    5,
    `an unrecorded entry now estimates ${without} rather than 5. If the fallback got ` +
      `smarter this test should say so; if it got worse, the under-count above is worse too.`,
  );
});

test("zpl_matrix records its cost, which reaches 2000 at the top dimension", async () => {
  // Added 2026-07-31 with the audit trail. It is the most expensive single call
  // in the package, so it is the worst one to have guessed at.
  const matrix = (await tools()).find((t) => t.name === "zpl_matrix");
  assert.ok(matrix, "zpl_matrix is gone — drop this test with it");

  const entry = recordedEntry(matrix.body);
  assert.ok(entry, "zpl_matrix no longer writes a history entry at all");
  assert.match(
    entry,
    /tokens_used/,
    "zpl_matrix records its run without the cost. At n=100 that is 2000 tokens " +
      "counted as 5.",
  );
});
