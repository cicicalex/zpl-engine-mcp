/**
 * Nothing this server sends may wait forever, and no wrapper may pretend to
 * stop it.
 *
 * AUDIT 2026-08-02, measured against a stub that accepts the connection and
 * then says nothing:
 *
 *   health() -> gave up after 5.0s
 *   plans()  -> still waiting at 45s
 *
 * Four of the five engine calls passed `signal: AbortSignal.timeout(...)`.
 * `plans()` did not. What hid it was the wrapper they all share:
 * `withRetry(fn, timeoutMs)` took a deadline and never read it. The body used
 * `fn`, the retry count and the backoff delay; `timeoutMs` appeared in the
 * signature and nowhere else. Every call site dutifully passed one — 15000,
 * 30000, 5000, 10000 — so beside `plans()` sat the number 10000, reading
 * exactly like the guarantee it was missing.
 *
 * An MCP tool call that never returns is worse than one that fails: the client
 * is left holding the conversation open with nothing to show the user.
 *
 * Fixed by giving `plans()` its own signal like its siblings, and by deleting
 * the parameter rather than implementing it. A second deadline mechanism would
 * mean two places to read and two to keep in step with the engine's ceilings.
 * Measured after: plans() gives up at 10.0s.
 *
 * Written over the shape rather than over the one call, so the next request
 * added without a deadline is caught on the way in.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");

/** One pass, alternating: a block-open inside a line comment must not open a
 *  block. Load-bearing — this fix's own note quotes `timeoutMs`,
 *  `AbortSignal.timeout` and the four numbers the call sites used to pass. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, (_m, before) => before ?? "");
}

/** Every `fetch(...)` call with its own argument list, by balancing parens. */
function fetchCalls(code) {
  const out = [];
  let from = 0;
  for (;;) {
    const at = code.indexOf("fetch(", from);
    if (at === -1) break;
    // `prefetch(` and `this.fetch(` are not the global we mean.
    const prev = at > 0 ? code[at - 1] : " ";
    if (/[\w.$]/.test(prev)) {
      from = at + 6;
      continue;
    }
    let i = code.indexOf("(", at);
    let depth = 0;
    for (; i < code.length; i += 1) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    out.push(code.slice(at, i + 1));
    from = i + 1;
  }
  return out;
}

async function sources() {
  const out = [];
  const walk = async (dir) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.name.endsWith(".ts")) out.push([e.name, stripComments(await readFile(p, "utf-8"))]);
    }
  };
  await walk(SRC);
  return out;
}

test("every outbound request carries a deadline", async () => {
  const files = await sources();
  const unbounded = [];
  let total = 0;

  for (const [name, code] of files) {
    for (const call of fetchCalls(code)) {
      total += 1;
      if (!/signal\s*:/.test(call)) {
        unbounded.push(`${name}: ${call.replace(/\s+/g, " ").slice(0, 72)}`);
      }
    }
  }

  assert.ok(total >= 5, `only ${total} fetch calls found across src — the scan is not finding them`);
  assert.deepEqual(
    unbounded,
    [],
    "these requests pass no abort signal. Measured against an engine that accepted the connection " +
      "and never answered, such a call was still waiting at 45 seconds — and an MCP tool that " +
      "never returns leaves the client holding the conversation open with nothing to show.",
  );
});

test("the retry wrapper does not advertise a deadline it ignores", async () => {
  const files = await sources();
  const client = files.find(([n]) => n === "engine-client.ts");
  assert.ok(client, "engine-client.ts is gone — this guard is checking nothing");
  const code = client[1];

  const declAt = code.search(/private\s+async\s+withRetry\b/);
  assert.notEqual(declAt, -1, "withRetry is gone or no longer declared the way this guard reads it");

  // Paren-balanced. The first version read /withRetry<T>\s*\(([^)]*)\)/, and
  // `[^)]*` stops at the first `)` — which is the one inside the parameter's
  // own type, `fn: () => Promise<T>`. The captured list was therefore just
  // "fn: (", so a second parameter could be reintroduced and never examined:
  // the mutation that put the dead deadline back did not fail this test.
  let p = code.indexOf("(", declAt);
  const paramsFrom = p + 1;
  let pdepth = 0;
  for (; p < code.length; p += 1) {
    if (code[p] === "(") pdepth += 1;
    else if (code[p] === ")") {
      pdepth -= 1;
      if (pdepth === 0) break;
    }
  }
  const paramList = code.slice(paramsFrom, p);

  // Split on top-level commas only, for the same reason.
  //
  // Angle brackets are counted, but the `>` of an arrow `=>` is not one: the
  // first version of this counted it as a close, drove the depth negative
  // through `fn: () => Promise<T>`, and never saw the comma after it as
  // top-level. The dead parameter went unexamined a second time.
  const parts = [];
  let depth2 = 0;
  let cur = "";
  let prev = "";
  for (const ch of paramList) {
    if (ch === "(" || ch === "{" || (ch === "<" && prev !== "=")) depth2 += 1;
    else if (ch === ")" || ch === "}" || (ch === ">" && prev !== "=")) depth2 -= 1;
    if (ch === "," && depth2 === 0) {
      parts.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
    prev = ch;
  }
  if (cur.trim()) parts.push(cur);

  const params = parts
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => p.split(":")[0].trim());

  // The body, bounded to the function, so a parameter used somewhere else in
  // the class does not count as used here.
  const at = declAt;
  let i = code.indexOf("{", p);
  let depth = 0;
  let end = code.length;
  for (; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  const body = code.slice(code.indexOf("{", p) + 1, end);

  const dead = params.filter((p) => !new RegExp(`\\b${p}\\b`).test(body));
  assert.deepEqual(
    dead,
    [],
    `withRetry declares ${dead.join(", ")} and never reads it. A parameter named like a deadline, ` +
      `sitting at every call site with a plausible number beside it, is what made a request with ` +
      `no deadline at all look accounted for.`,
  );
});
