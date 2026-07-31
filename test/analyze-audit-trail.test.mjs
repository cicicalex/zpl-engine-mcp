/**
 * A tool that sends the caller's own data to the engine must record that it
 * ran — and must not record the data itself.
 *
 * AUDIT 2026-07-31: zpl_matrix reached POST /analyze and called addHistory zero
 * times. Around 45 tools across every domain module record, so this was not a
 * house style; it was an omission in the one tool that carries a customer's
 * data off their machine. Determinism is the product's stated moat, and the
 * only tool touching real inputs was the only analytical tool leaving no trace
 * that it had run.
 *
 * The rule is deliberately scoped to /analyze rather than to the engine in
 * general, because a scan of all 69 registered tools found seven more that
 * reach the engine and record nothing:
 *
 *   zpl_compute, zpl_sweep, zpl_analyze, zpl_watchlist,
 *   zpl_score_only, zpl_diagnose, zpl_account
 *
 * Those are not defects and this guard must not grow to cover them. Every one
 * sends only derived scalars — a dimension, a density, a sample count. The
 * engine generates its own random matrices and never sees the caller's data,
 * so there is no input to be accountable for. `client.analyze` is the only call
 * in the package that puts a customer's actual cells on the wire, which is
 * exactly why a record of it is worth requiring.
 *
 * Second half of the rule, and the reason this is one test and not two: the
 * record must not contain the matrix. A 100x100 input is 10,000 cells, history
 * holds 500 entries, and history.json is a plain file on disk — storing inputs
 * would make the audit trail the largest and most sensitive thing this package
 * keeps. A digest is enough to prove later that a given input produced a given
 * verdict, which is the entire claim a deterministic engine makes. Requiring
 * the record without forbidding the input would trade a missing trail for a
 * data-at-rest problem, so both halves are asserted together.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");

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
 * Split a source file into one chunk per registered tool. A chunk runs from its
 * own `.tool("name"` to the start of the next one, which is the whole handler.
 */
function splitTools(src) {
  const marks = [];
  const re = /\.tool\(\s*\n?\s*"([a-z_0-9]+)"/g;
  let m;
  while ((m = re.exec(src))) marks.push({ name: m[1], at: m.index });
  return marks.map((mk, i) => ({
    name: mk.name,
    body: src.slice(mk.at, i + 1 < marks.length ? marks[i + 1].at : src.length),
  }));
}

/**
 * Strip comments before any of this is scanned.
 *
 * The first version of this guard did not, and it passed a break test it should
 * have failed: the digest check searched a window that began at the first
 * literal "addHistory" in the handler, which is in the audit comment above the
 * call, and that comment contains the words "a digest of the matrix". Deleting
 * the real digest left the guard reading its own documentation and reporting
 * the tool clean.
 *
 * The distinction that decides this, and it has now cost five separate guards:
 * a rule about a WORD appearing in shipped text must skip comments, because
 * quoting one ships nothing. A rule about what the CODE DOES must skip comments
 * too, for the opposite reason — prose describing correct behaviour is not
 * evidence of it. Only a rule about what leaves the package, like the one
 * keeping the method out of published source, reads comments as real.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** The only call that transmits caller-supplied cells. */
const SENDS_CALLER_DATA = /\bclient\.analyze\s*\(/;
const RECORDS = /addHistory\s*\(/;

/**
 * Return the text of the addHistory(...) call, bounded by matching parens.
 * A fixed-size window was the other half of the bug above: it ran past the end
 * of the entry into unrelated code.
 */
function recordedEntry(code) {
  const m = /addHistory\s*\(/.exec(code);
  if (!m) return null;
  let i = m.index + m[0].length - 1;
  let depth = 0;
  for (let j = i; j < code.length; j++) {
    if (code[j] === "(") depth++;
    else if (code[j] === ")") {
      depth--;
      if (depth === 0) return code.slice(i, j + 1);
    }
  }
  return code.slice(i);
}

async function analyzeTools() {
  const found = [];
  for (const f of await sourceFiles(SRC)) {
    const src = await readFile(f, "utf-8");
    for (const t of splitTools(src)) {
      const code = stripComments(t.body);
      if (SENDS_CALLER_DATA.test(code)) found.push({ ...t, code, file: f });
    }
  }
  return found;
}

test("every tool that sends the caller's matrix records the run, without the matrix", async () => {
  const tools = await analyzeTools();

  // If this drops to zero the guard has stopped guarding anything — most
  // likely because the call was renamed, not because the rule stopped mattering.
  assert.ok(
    tools.length > 0,
    "no tool calls client.analyze — either the route was dropped or this guard's " +
      "pattern is stale and it is now silently checking nothing",
  );

  for (const t of tools) {
    assert.ok(
      RECORDS.test(t.code),
      `${t.name} sends the caller's matrix to the engine and never calls addHistory. ` +
        `It is the only kind of call that carries customer data off their machine, ` +
        `and it leaves no record that it happened.`,
    );

    // Exactly the recorded entry, so a `matrix` referenced elsewhere in the
    // handler — the parameter itself, the digest input — is not mistaken for a
    // stored one, and nothing after the call is mistaken for part of it.
    const entry = recordedEntry(t.code);
    assert.ok(entry, `${t.name}: could not isolate the addHistory call`);

    assert.ok(
      !/\bmatrix\s*[,:}]/.test(entry),
      `${t.name} appears to put the caller's matrix into the history entry. ` +
        `Record a digest of it, not the cells: history holds 500 entries in a ` +
        `plain file, and a 100x100 input is 10,000 cells of somebody's data.`,
    );

    assert.ok(
      /sha256|digest|hash/i.test(entry),
      `${t.name} records the run but nothing identifying the input. Without a ` +
        `digest the entry cannot show that a specific matrix produced a specific ` +
        `verdict, which is the only thing a deterministic engine can be audited on.`,
    );
  }
});

test("the seven parametric tools are deliberately out of scope, and still are", async () => {
  // Guards the reasoning above, not the code: if one of these ever starts
  // sending caller data, it must come under the rule rather than stay exempt
  // because a comment written today said it was parametric.
  const EXEMPT = new Set([
    "zpl_compute", "zpl_sweep", "zpl_analyze", "zpl_watchlist",
    "zpl_score_only", "zpl_diagnose", "zpl_account",
  ]);

  const sending = new Set((await analyzeTools()).map((t) => t.name));
  const crossed = [...EXEMPT].filter((n) => sending.has(n));

  assert.deepEqual(
    crossed,
    [],
    `${crossed.join(", ")} now sends the caller's matrix to /analyze but is on the ` +
      `exempt list, which exists only for tools that send derived scalars. Remove ` +
      `it from the list so the rule above applies to it.`,
  );
});
