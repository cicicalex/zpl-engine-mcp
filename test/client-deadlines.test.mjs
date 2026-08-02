/**
 * No client may give up before the engine does, and an abort must not be retried.
 *
 * AUDIT 2026-08-01. Every client's deadline sat BELOW the engine's own ceiling
 * for the same route:
 *
 *   MCP compute  15s   engine 30s
 *   MCP sweep    30s   engine 60s
 *   CLI (all)    20s   engine 30s / 60s
 *   SDK default  30s   engine 30s / 60s
 *
 * That ordering is the expensive way round. The engine deducts in
 * validate_user_key BEFORE spawn_blocking, and refunds only inside its own
 * timeout and JoinError arms. A client that walks away first leaves the request
 * future to be dropped on disconnect - the deduction has committed and no
 * refund path is reached. Then withRetry classified the abort as transient and
 * re-sent it, so one user call billed two or three times and returned nothing.
 *
 * Measured before: a client call against an unresponsive server produced THREE
 * inbound requests. After: one. The audit measured the case that makes it
 * expensive - a sweep at d=48 with samples=50000 runs about 52s server-side,
 * past the old 30s abort and inside the engine's 60s ceiling, at 19 x 150 =
 * 2850 tokens per abandoned attempt.
 *
 * The fix has two halves and both are checked here, because either alone leaves
 * money on the floor: waiting past the engine converts an unrefunded disconnect
 * into a 504 the engine issues and refunds, and making the abort terminal stops
 * the amplification when the network genuinely stalls.
 *
 * Deadlines are asserted against the engine's ceilings read from its source
 * rather than against remembered numbers, so moving a ceiling fails this test
 * instead of silently re-opening the gap.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readSibling, whySkipped } from "./sibling-repo.mjs";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
// AUDIT 2026-08-02: these were absolute paths on one machine, and every read
// of them swallowed a missing file into a silent pass. Resolved relative to
// this repo now, overridable by environment, and absence is reported as a skip.
const ENGINE_MAIN = ["crates", "zpl-api", "src", "main.rs"];
const CLI_CLIENT = ["zpl-engine-cli", "src", "api-client.ts"];
const SDK_CLIENT = ["zpl-engine-sdk", "packages", "typescript", "src", "client.ts"];

/** One pass, alternating: a `/*` inside a line comment must not open a block. */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, (_m, before) => before ?? "");
}

/**
 * The engine's own ceilings, read from the handler that applies them.
 *
 * Anchored on the handler name rather than on a bare `Duration::from_secs`,
 * because the rate limiter uses one too and matching the first hit would have
 * pinned the clients to a 60-second window that has nothing to do with compute.
 */
async function engineCeilings() {
  const src = await readSibling("engine", ...ENGINE_MAIN);
  if (src === null) return null;
  const out = {};
  for (const [route, fn] of [["compute", "compute_handler"], ["sweep", "sweep_handler"]]) {
    const at = src.indexOf(`async fn ${fn}`);
    assert.notEqual(at, -1, `${fn} not found in the engine — this guard is checking nothing`);
    const body = src.slice(at, src.indexOf("\nasync fn ", at + 10));
    const m = body.match(/tokio::time::timeout\(\s*Duration::from_secs\((\d+)\)/);
    assert.ok(m, `${fn} no longer wraps its work in a timeout`);
    out[route] = Number(m[1]) * 1000;
  }
  return out;
}

test("the MCP waits longer than the engine on every billed route", async (t) => {
  const ceilings = await engineCeilings();
  if (ceilings === null) {
    t.skip(whySkipped("engine", ...ENGINE_MAIN));
    return;
  }

  const code = stripComments(await readFile(join(ROOT, "src", "engine-client.ts"), "utf-8"));

  const compute = Number(code.match(/DEADLINE_COMPUTE_MS\s*=\s*ENGINE_COMPUTE_CEILING_MS\s*\+\s*NETWORK_HEADROOM_MS/) ? code.match(/ENGINE_COMPUTE_CEILING_MS\s*=\s*([\d_]+)/)[1].replace(/_/g, "") : NaN);
  const sweep = Number(code.match(/ENGINE_SWEEP_CEILING_MS\s*=\s*([\d_]+)/)?.[1].replace(/_/g, "") ?? NaN);
  const headroom = Number(code.match(/NETWORK_HEADROOM_MS\s*=\s*([\d_]+)/)?.[1].replace(/_/g, "") ?? NaN);

  assert.equal(
    compute,
    ceilings.compute,
    `the MCP believes the engine's compute ceiling is ${compute}ms; the engine applies ` +
      `${ceilings.compute}ms. The deadline is derived from this number, so a stale copy ` +
      `puts the client back on the wrong side of the race.`,
  );
  assert.equal(
    sweep,
    ceilings.sweep,
    `the MCP believes the engine's sweep ceiling is ${sweep}ms; the engine applies ` +
      `${ceilings.sweep}ms.`,
  );
  assert.ok(
    headroom > 0,
    `network headroom is ${headroom}ms. A deadline equal to the engine's ceiling is a ` +
      `coin flip over which side fires first, and losing means an unrefunded charge.`,
  );

  // No BILLED route may still carry a hand-written deadline.
  //
  // The rule is about routes that cost tokens, not about every fetch in the
  // file. /health is free, returns immediately and is used as a liveness probe -
  // a 5-second deadline there is correct, and the first version of this check
  // flagged it, which would have pushed someone to make a health probe wait a
  // minute to satisfy a test. Scoped by method name, with the free ones named
  // so the exemption is a decision rather than a silent gap.
  // Each method is cut out first, then searched. A lookahead across an
  // unbounded span attached the next literal it could find to whichever method
  // it started from - once sweep's own deadline became a named constant, the
  // scan walked past it and blamed sweep for the health probe's 5000. Slicing
  // to the following `async` keeps each literal with the method that owns it.
  const FREE_ROUTES = ["health", "plans", "version"];
  const marks = [...code.matchAll(/\basync\s+(\w+)\s*\(/g)];
  const tooShort = [];

  marks.forEach((mk, i) => {
    const method = mk[1];
    if (FREE_ROUTES.includes(method)) return;
    const body = code.slice(mk.index, i + 1 < marks.length ? marks[i + 1].index : code.length);

    // Each route against ITS OWN ceiling. Comparing everything to compute's 30s
    // let a sweep deadline of exactly 30000 pass while the engine ran for 60 -
    // which is the shipped bug, so the first version of this check reported
    // green on the very thing it was written for.
    const ceiling = method === "sweep" ? ceilings.sweep : ceilings.compute;

    for (const t of body.matchAll(/AbortSignal\.timeout\((\d[\d_]*)\)/g)) {
      const ms = Number(t[1].replace(/_/g, ""));
      if (ms <= ceiling) tooShort.push(`${method}: ${ms}ms vs engine ${ceiling}ms`);
    }
  });

  assert.deepEqual(
    tooShort,
    [],
    `these billed routes give up before the engine does: ${tooShort.join(", ")}. ` +
      `A billed route must outlast the engine so the engine's own timeout - which ` +
      `refunds - fires first.`,
  );
});

test("an aborted request is terminal in every client", async (t) => {
  // The half that stops the amplification. Retrying a request the server may
  // still be computing bills again for the same work.
  //
  // This package's own client is read from this repo and is always there; the
  // sibling client may not be. Reading none of the siblings is reported as a
  // skip rather than counted as a pass — the shape that let this whole file
  // report success on a machine with nothing to compare against.
  const local = stripComments(
    await readFile(join(ROOT, "src", "engine-client.ts"), "utf-8"),
  );
  const sources = [["mcp", local]];

  const cli = await readSibling("clients", ...CLI_CLIENT);
  if (cli !== null) sources.push(["cli", stripComments(cli)]);

  for (const [name, code] of sources) {
    assert.match(
      code,
      /"TimeoutError"/,
      `${name} does not treat an aborted request as terminal. AbortSignal.timeout raises a ` +
        `DOMException named "TimeoutError" carrying no status code, so a retry classifier ` +
        `that only looks at 4xx lets it through and re-sends a call the engine has already ` +
        `charged for.`,
    );
    assert.match(code, /"AbortError"/, `${name} misses the manual-abort case`);
  }

  if (sources.length === 1) t.skip(whySkipped("clients", ...CLI_CLIENT));
});

test("the SDK's default timeout outlasts the engine's slowest route", async (t) => {
  const ceilings = await engineCeilings();
  const sdkRaw = await readSibling("clients", ...SDK_CLIENT);
  if (ceilings === null || sdkRaw === null) {
    t.skip(ceilings === null
      ? whySkipped("engine", ...ENGINE_MAIN)
      : whySkipped("clients", ...SDK_CLIENT));
    return;
  }
  const sdk = stripComments(sdkRaw);

  const m = sdk.match(/this\.timeout\s*=\s*config\.timeout\s*\|\|\s*([\d_]+)/);
  assert.ok(m, "the SDK no longer sets a default timeout");
  const dflt = Number(m[1].replace(/_/g, ""));

  assert.ok(
    dflt > ceilings.sweep,
    `the SDK's default timeout is ${dflt}ms and the engine's sweep ceiling is ` +
      `${ceilings.sweep}ms. At or below it, the SDK abandons a sweep the engine is still ` +
      `running and the caller pays for it - the previous default was exactly equal to the ` +
      `compute ceiling.`,
  );
});
