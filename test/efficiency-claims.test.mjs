/**
 * A tool may not advertise speed it does not deliver.
 *
 * AUDIT 2026-07-31: `zpl_batch` was described as "Run multiple ZPL Engine
 * computations in a single call ... Efficient for bulk analysis." The handler
 * is a sequential for-loop awaiting one /compute per job, so fifty jobs are
 * fifty round-trips one after another — the same requests the caller would have
 * made, in the same order, at the same total cost. No batching, no concurrency,
 * no token saving. "In a single call" was true only of the MCP call; the wire
 * traffic it implies never existed.
 *
 * The claim was corrected rather than made true. Firing fifty concurrent
 * requests changes the load the tool puts on the engine, and there is no
 * per-plan concurrency limit server-side to absorb it — that is a capacity
 * decision, not a wording fix.
 *
 * SCOPE. A scan of all registered tools found exactly two whose descriptions
 * contain a speed or efficiency word:
 *
 *   zpl_batch        — sequential engine calls. The defect.
 *   zpl_correlation  — "parallel time series of returns". This is the data
 *                      sense of the word, describing series that run alongside
 *                      each other, and says nothing about how requests are
 *                      issued. It is correct and must not be flagged.
 *
 * That second one is why this guard matches on a claim about the CALL and not
 * merely on a vocabulary list. A guard that fires on the word "parallel"
 * wherever it appears would have demanded a rewrite of an accurate sentence,
 * and the reasonable response to that is to delete the guard.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");

/**
 * Claims about how the REQUESTS are made — the thing a caller would be misled
 * about. Deliberately excludes bare "parallel", which has an accurate
 * non-request meaning in this codebase.
 */
const SPEED_CLAIM =
  /efficient|faster|\bfast\b|in a single call|saves? (?:time|tokens)|batched|concurrently|in parallel/i;

/** A for-loop whose body awaits an engine call: one request per item, serially. */
const SEQUENTIAL_ENGINE_LOOP = /for\s*\([^)]*\)\s*\{[\s\S]{0,600}?await\s+client\./;

async function sourceFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sourceFiles(p)));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Each registered tool with its description literal and its handler body. */
async function tools() {
  const out = [];
  for (const f of await sourceFiles(SRC)) {
    const src = await readFile(f, "utf8");
    const marks = [...src.matchAll(/\.tool\(\s*\n?\s*"([a-z_0-9]+)"/g)];
    marks.forEach((mk, i) => {
      const body = src.slice(mk.index, i + 1 < marks.length ? marks[i + 1].index : src.length);
      // The description is the string literal(s) immediately after the name.
      // Comments between the two are stripped so an audit note explaining a
      // corrected claim is not read back as the claim.
      const afterName = body.slice(body.indexOf(",") + 1).replace(/\/\/[^\n]*/g, "");
      const dm = afterName.match(/^\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)/);
      out.push({ name: mk[1], desc: dm ? dm[1] : "", body });
    });
  }
  return out;
}

test("no tool claims speed while issuing its engine calls one at a time", async () => {
  const all = await tools();
  assert.ok(all.length > 50, `only ${all.length} tools parsed — the parser is stale`);

  const lying = all
    .filter((t) => SPEED_CLAIM.test(t.desc) && SEQUENTIAL_ENGINE_LOOP.test(t.body))
    .map((t) => t.name);

  assert.deepEqual(
    lying,
    [],
    `${lying.join(", ")} promises speed or efficiency in its description while the ` +
      `handler awaits one engine request per item in a for-loop. Either make the ` +
      `requests concurrent — a capacity decision, since nothing limits per-plan ` +
      `concurrency server-side — or describe what the tool actually does.`,
  );
});

test("zpl_batch says what it actually gives the caller", async () => {
  const batch = (await tools()).find((t) => t.name === "zpl_batch");
  assert.ok(batch, "zpl_batch is gone — this guard checks nothing");

  assert.match(
    batch.desc,
    /in sequence|one (?:engine )?request per job/i,
    "zpl_batch no longer discloses that it issues one request per job in sequence. " +
      "That is the single fact a caller needs to predict what it costs and how long " +
      "it takes.",
  );

  assert.doesNotMatch(
    batch.desc,
    /Efficient for bulk/i,
    "the efficiency claim is back, and the handler below is still a sequential loop.",
  );
});

test("zpl_correlation's accurate use of the word is not collateral damage", async () => {
  // Guards the scope decision above: this description is correct and the guard
  // must keep tolerating it, or the next person will widen the pattern and
  // rewrite a true sentence.
  const corr = (await tools()).find((t) => t.name === "zpl_correlation");
  assert.ok(corr, "zpl_correlation is gone — drop this test with it");

  assert.ok(
    !(SPEED_CLAIM.test(corr.desc) && SEQUENTIAL_ENGINE_LOOP.test(corr.body)),
    "zpl_correlation is now flagged. If its description gained a real speed claim, " +
      "fix the description. If the guard's pattern was widened to catch 'parallel " +
      "time series', narrow it back — that phrase describes the data, not the calls.",
  );
});
