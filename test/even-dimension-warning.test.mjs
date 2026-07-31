/**
 * A caller at an even dimension must be told the reading discriminates less.
 *
 * AUDIT 2026-07-31. `degenerate` fires only when every cell is identical, and
 * that is narrower than the reading needs. Measured directly against the
 * engine's fold across the sold range — n = 16, 32, 48, 64, 100, which is every
 * even ceiling any plan sells — five of eight distinct test shapes return ONE
 * identical set of family bits:
 *
 *   all_zeros = all_ones = checker = left_half = top_half
 *
 * Only two of those five are degenerate. A checkerboard and a half-filled
 * matrix are structured, mixed inputs; `degenerate` is correctly false for them
 * and was the only thing gating a warning. So a caller sending a checkerboard at
 * n=48 got a confident four-row verdict table with nothing telling them a blank
 * matrix produces the identical verdict.
 *
 * At odd dimensions the same sweep separates seven of the eight (9, 25, 33, 49,
 * 65) or six (3, 15, 99), and the uniform pair never collides.
 *
 * This is a property of the fold and is not changed here. What is fixed is that
 * the tool now says so, at exactly the dimensions customers pay most for: every
 * paid ceiling except Pro's 25 is even.
 *
 * The advice is guarded as tightly as the warning, because advice is where this
 * would have gone wrong quietly. The first draft told the caller to re-run at
 * n+1 and said it "costs the same". It does not. Every sold even ceiling sits at
 * the TOP of a token-cost band, so n+1 always crosses into the next one:
 *
 *   16 ->  5 tokens, 17 ->  15   (3.0x)
 *   32 -> 40 tokens, 33 -> 150   (3.75x)
 *   48 -> 150,       49 -> 500   (3.3x)
 *   64 -> 500,       65 -> 2000  (4.0x)
 *   100 -> no odd dimension exists; the engine rejects d > 100
 *
 * Telling someone to spend 4x more while calling it free is worse than saying
 * nothing, and the n=100 case is advice that cannot be followed at all.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getTokenCost } from "../dist/tools/helpers.js";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const INDEX = join(ROOT, "src", "index.ts");

/** Every even dimension a plan sells as its ceiling. */
const SOLD_EVEN = [16, 32, 48, 64, 100];

test("the even-dimension warning is not gated behind degenerate", async () => {
  const src = await readFile(INDEX, "utf-8");

  const at = src.indexOf('"zpl_matrix"');
  assert.notEqual(at, -1, "zpl_matrix is gone — this guard checks nothing");
  const handler = src.slice(at, src.indexOf(".tool(", at + 10));

  assert.match(
    handler,
    /result\.n\s*%\s*2\s*===\s*0/,
    "zpl_matrix no longer branches on even n. A caller at n=48 is told nothing " +
      "about a reading that cannot separate their matrix from a blank one.",
  );

  // The branch must be reachable for a NON-degenerate matrix. If it were nested
  // inside the degenerate check, it would only ever fire for uniform input —
  // which is the exact hole this exists to close, restored.
  const degenAt = handler.indexOf("if (result.degenerate)");
  const evenAt = handler.search(/result\.n\s*%\s*2\s*===\s*0/);
  assert.ok(degenAt !== -1 && evenAt > degenAt, "could not locate both branches");
  assert.match(
    handler.slice(degenAt, evenAt),
    /\}\s*else if\s*\(/,
    "the even-n warning must be an `else if` on the degenerate check, not nested " +
      "inside it. Nested, it fires only for uniform matrices — and a checkerboard " +
      "is not uniform, which is the whole point.",
  );
});

test("every sold even ceiling really does cost less than its odd successor", async () => {
  // The advice quotes a cost change. Pin it to the shared cost function so the
  // claim cannot rot if the bands are ever retuned.
  for (const n of SOLD_EVEN) {
    if (n >= 100) continue; // no odd successor exists; handled separately
    const here = getTokenCost(n);
    const next = getTokenCost(n + 1);
    assert.ok(
      next > here,
      `n=${n} costs ${here} and n=${n + 1} costs ${next}. The warning tells callers ` +
        `the odd re-run crosses a cost band. If that stopped being true the wording ` +
        `is now scaring people off a free improvement.`,
    );
  }
});

test("at n=100 the tool does not advise an odd dimension that does not exist", async () => {
  const src = await readFile(INDEX, "utf-8");
  const at = src.indexOf('"zpl_matrix"');
  const handler = src.slice(at, src.indexOf(".tool(", at + 10));

  assert.match(
    handler,
    /result\.n\s*<\s*100/,
    "the even-n advice no longer special-cases 100. The engine rejects d > 100, " +
      "so at n=100 there is no odd dimension above it and 'try n+1' is advice " +
      "that cannot be followed.",
  );
});
