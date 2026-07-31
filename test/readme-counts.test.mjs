/**
 * Numbers the README states about this package must be true of this package.
 *
 * AUDIT 2026-07-31: the README read "**146 tests** (98 unit + 48 live MCP
 * integration)". The suite had 221 (172 unit, 49 integration). The figure was
 * right when it was typed and went stale every time a test was added, which is
 * every working session.
 *
 * It is the same shape as the accuracy claim that was scrubbed from src/ and
 * left in package.json: the number nobody reads was kept correct by a guard,
 * and the number on the page everybody reads had none. A README is the first
 * thing a buyer sees on npm.
 *
 * The tool count already works this way — one constant, a test that recounts
 * the registrations. This does the same for the test count, and the counts are
 * measured from the files rather than trusted, so the guard cannot agree with a
 * stale README by sharing its mistake.
 *
 * The static count is used deliberately: `test(` at the start of a line in
 * test/*.test.mjs. Verified equal to what `node --test` reports (221 both
 * ways), and it does not require running the suite to check the suite's size.
 * If dynamically generated tests ever appear, the two diverge and the
 * cross-check below is what says so.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const TEST_DIR = join(ROOT, "test");
const INTEGRATION = "integration-smoke.test.mjs";

async function testFiles() {
  const names = await readdir(TEST_DIR);
  return names.filter((n) => n.endsWith(".test.mjs"));
}

/** Count top-level `test(` declarations in one file. */
async function countTests(name) {
  const src = await readFile(join(TEST_DIR, name), "utf-8");
  return src.split(/\r?\n/).filter((l) => /^test\(/.test(l)).length;
}

async function counts() {
  let unit = 0;
  let integration = 0;
  for (const name of await testFiles()) {
    const n = await countTests(name);
    if (name === INTEGRATION) integration += n;
    else unit += n;
  }
  return { unit, integration, total: unit + integration };
}

test("test files were actually found", async () => {
  const files = await testFiles();
  assert.ok(
    files.length >= 10,
    `only ${files.length} test files seen — the counts below would be meaningless`,
  );
  assert.ok(
    files.includes(INTEGRATION),
    `${INTEGRATION} not found — the unit/integration split would silently become ` +
      `"everything is a unit test"`,
  );
});

test("every test file contributes at least one test", async () => {
  for (const name of await testFiles()) {
    const n = await countTests(name);
    assert.ok(
      n > 0,
      `${name} declares no tests matching the counting pattern — either it is empty, ` +
        `or the pattern stopped matching and every count here is now too low`,
    );
  }
});

test("the README states the real test count", async () => {
  const { unit, integration, total } = await counts();
  const readme = await readFile(join(ROOT, "README.md"), "utf-8");

  const m = readme.match(/\*\*(\d+) tests\*\*\s*\((\d+) unit \+ (\d+) live MCP integration\)/);
  assert.ok(
    m,
    "the README no longer states a test count in the expected shape — if the wording " +
      "changed, update this guard; if the claim was removed, delete this test",
  );

  const [, claimedTotal, claimedUnit, claimedIntegration] = m.map(Number);
  assert.equal(claimedUnit, unit, `README says ${claimedUnit} unit tests, there are ${unit}`);
  assert.equal(
    claimedIntegration,
    integration,
    `README says ${claimedIntegration} integration tests, there are ${integration}`,
  );
  assert.equal(claimedTotal, total, `README says ${claimedTotal} tests, there are ${total}`);
});

test("the parts add up to the whole", async () => {
  const { unit, integration, total } = await counts();
  assert.equal(unit + integration, total);
});

/**
 * The tool count has its own constant and its own guard. This checks the README
 * agrees with that constant, because the README is a third copy of it.
 */
test("the README states the declared tool count", async () => {
  const { REGISTERED_TOOL_COUNT, UNIQUE_TOOL_COUNT, ALIAS_TOOL_COUNT } = await import(
    "../dist/tool-count.js"
  );
  const readme = await readFile(join(ROOT, "README.md"), "utf-8");

  const m = readme.match(/\*\*(\d+) tools\*\*\s*\((\d+) unique \+ (\d+) backwards-compat aliases\)/);
  assert.ok(m, "the README no longer states the tool count in the expected shape");

  const [, total, unique, aliases] = m.map(Number);
  assert.equal(total, REGISTERED_TOOL_COUNT, "README total vs REGISTERED_TOOL_COUNT");
  assert.equal(unique, UNIQUE_TOOL_COUNT, "README unique vs UNIQUE_TOOL_COUNT");
  assert.equal(aliases, ALIAS_TOOL_COUNT, "README aliases vs ALIAS_TOOL_COUNT");
});
