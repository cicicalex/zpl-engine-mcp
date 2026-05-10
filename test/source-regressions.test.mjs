/**
 * Source-level regression tests for v3.7.2 fixes that don't have natural
 * unit-testable behaviour (string changes, dead-code removal, etc.).
 *
 * These read the compiled dist/ to catch accidental re-introduction of
 * bugs we already fixed. They're cheap and run in milliseconds.
 *
 * Run after `npm run build`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

async function readDist(rel) {
  return readFile(join(ROOT, "dist", rel), "utf-8");
}

// Bug #1: zpl_teach getting-started snippet must reference the published
// package name (`zpl-engine-mcp`), NOT the never-published placeholder
// (`@zeropointlogic/engine-mcp`). Users copy this snippet into their
// Claude Desktop config — wrong name = npm ERR! 404.
test("Bug #1: zpl_teach snippet uses correct npm package name", async () => {
  const advanced = await readDist("tools/advanced.js");
  // The Markdown getting-started block is in this file.
  assert.doesNotMatch(
    advanced,
    /@zeropointlogic\/engine-mcp/,
    "advanced.js still contains '@zeropointlogic/engine-mcp' — that package was never published; users get npm 404",
  );
  assert.match(
    advanced,
    /zpl-engine-mcp/,
    "expected canonical package name 'zpl-engine-mcp' to appear in advanced.js getting-started snippet",
  );
});

// Bug #10: ZPL_LANGUAGE constant was dead code (read into a `LANGUAGE`
// variable that nothing consumed). The constant was removed in v3.7.2;
// guard against accidental re-introduction.
test("Bug #10: LANGUAGE dead-code constant is removed from index.js", async () => {
  const indexJs = await readDist("index.js");
  // We allow comments to mention "LANGUAGE" for the removal note, but the
  // executable line `const LANGUAGE = process.env.ZPL_LANGUAGE` must be gone.
  assert.doesNotMatch(
    indexJs,
    /const\s+LANGUAGE\s*=\s*process\.env\.ZPL_LANGUAGE/,
    "LANGUAGE dead-code constant was reintroduced",
  );
});

// Bug #3: zpl_simulate must use distributionBias (uniformity) for what-if
// scenarios — directionalBias collapsed to 1.0 on positive-only inputs and
// produced the "0/0" bug. Verify the import is present in the built output.
test("Bug #3: zpl_simulate imports distributionBias (not relying solely on directionalBias)", async () => {
  const advanced = await readDist("tools/advanced.js");
  assert.match(
    advanced,
    /distributionBias/,
    "advanced.js does not import distributionBias — zpl_simulate may have regressed to directionalBias-only",
  );
});

// Bug #11+12: zpl_quota and zpl_alert must use estimateOpTokens, not the
// old hardcoded `+= 5` per-call estimate.
test("Bug #11+12: zpl_quota uses estimateOpTokens (not hardcoded += 5)", async () => {
  const meta = await readDist("tools/meta.js");
  assert.match(meta, /estimateOpTokens/, "meta.js (zpl_quota) doesn't use estimateOpTokens");
  // Make sure the old pattern is gone — match the old comment+statement
  // shape so we don't false-positive on legitimate "+= 5" elsewhere.
  assert.doesNotMatch(
    meta,
    /Estimate tokens by typical cost.*\n.*monthTokens \+= 5/s,
    "meta.js still has the old hardcoded '+= 5' fallback for monthTokens",
  );
});

test("Bug #11+12: zpl_alert uses estimateOpTokens (not hardcoded += 5)", async () => {
  const advanced = await readDist("tools/advanced.js");
  assert.match(advanced, /estimateOpTokens/, "advanced.js (zpl_alert) doesn't use estimateOpTokens");
});

// Bug #4: zpl_liquidity verdict must reference per-pool counts (BALANCED /
// SLIGHT / IMBALANCED), not just paraphrase aggregate AIN.
test("Bug #4: zpl_liquidity verdict references per-pool counts", async () => {
  const crypto = await readDist("tools/crypto.js");
  assert.match(crypto, /BALANCED/, "zpl_liquidity must categorize pools as BALANCED");
  assert.match(crypto, /IMBALANCED/, "zpl_liquidity must categorize pools as IMBALANCED");
  // Verdict must construct a "X of Y pools" summary so display & verdict agree.
  assert.match(
    crypto,
    /pools BALANCED/,
    "zpl_liquidity verdict text must cite per-pool counts (e.g. '3 of 5 pools BALANCED')",
  );
});

// Bug #6: setup.js must perform a smoke test against the engine after
// writing the config — catches cases where the wizard succeeded on the
// website but the engine doesn't accept the key yet.
test("Bug #6: setup.js exports & uses runSmokeTest after writing config", async () => {
  const setup = await readDist("setup.js");
  assert.match(setup, /Smoke test/i, "setup.js no longer mentions a smoke test");
  assert.match(setup, /runSmokeTest|smoketest/i, "setup.js does not call a smoke-test routine");
  // The smoke test must exercise both /health and /compute.
  assert.match(setup, /\.health\(\)/, "smoke test must call /health");
  assert.match(setup, /\.compute\(/, "smoke test must call /compute");
});

// Memory feature: setup.js must read existing config before forcing a
// new device-flow login.
test("Memory: setup.js calls readExistingConfig + offers options menu", async () => {
  const setup = await readDist("setup.js");
  assert.match(setup, /readExistingConfig/, "setup.js does not call readExistingConfig (memory feature missing)");
  assert.match(setup, /Already logged in/, "setup.js does not display 'Already logged in' message");
});

// repair + whoami: subcommands must be wired in the dispatcher.
test("repair + whoami subcommands are dispatched in index.js", async () => {
  const indexJs = await readDist("index.js");
  assert.match(indexJs, /cmd === "repair"|argv\[2\] === "repair"/, "index.js does not dispatch the 'repair' subcommand");
  assert.match(indexJs, /cmd === "whoami"|argv\[2\] === "whoami"/, "index.js does not dispatch the 'whoami' subcommand");
});

// zpl_diagnose: tool must be registered (and not collide with zpl_health).
test("zpl_diagnose tool is registered (renamed from initial zpl_health to avoid conflict)", async () => {
  const meta = await readDist("tools/meta.js");
  assert.match(meta, /"zpl_diagnose"/, "zpl_diagnose tool not registered in meta.js");
});
