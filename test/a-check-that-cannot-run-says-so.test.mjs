/**
 * A check that could not run must not report that it passed.
 *
 * AUDIT 2026-08-02. Three test files here compared this package against the
 * engine and the website by reading their source through an absolute path on
 * one developer's machine, and each swallowed the failure to open it:
 *
 *     try { rust = await readFile(ENGINE_AIN_RS, "utf-8"); } catch { return; }
 *
 * Measured: the engine's `ain.rs` was moved aside and the suite reported
 *
 *     tests 6   pass 6   fail 0   skipped 0   exit 0
 *
 * On any machine that is not that one — a contributor's, a build server's, a
 * fresh clone — the check that this package's bands match the engine's did not
 * run and said it passed. The bands could drift and nothing would notice. The
 * sibling repos had the same shape: six files across three repos, none of them
 * checking whether the file was there.
 *
 * The absolute paths were a second problem on their own. This is a public repo,
 * and they published the private repos' names and layout.
 *
 * ## What is asserted
 *
 * No test file names an absolute path. Any test file that reads a sibling repo
 * goes through the resolver and reports absence as a skip.
 *
 * Comments are stripped first — this file, the resolver and every file it
 * governs all discuss the paths and the skip at length, and a scan that read
 * the prose would pass with the code gone.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));

const strip = (s) => s.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, (_m, b) => b ?? "");

async function testFiles() {
  const names = await readdir(HERE);
  return names.filter((n) => n.endsWith(".test.mjs"));
}

/** An absolute Windows or POSIX path pointing outside this repo. */
const ABSOLUTE = /["'`](?:[A-Za-z]:[\\/]|\/(?:home|Users|mnt)\/)/;

test("the scan sees the test files", async () => {
  const files = await testFiles();
  assert.ok(
    files.length > 20,
    `only ${files.length} test files found in ${HERE} — the assertions below would ` +
      `pass over almost nothing`,
  );
  assert.ok(
    files.includes("ain-bands.test.mjs"),
    "ain-bands.test.mjs is not among them, and it is one of the three this file exists for",
  );
});

test("no test names a path on somebody's machine", async () => {
  const offenders = [];
  for (const name of await testFiles()) {
    const code = strip(await readFile(join(HERE, name), "utf-8"));
    if (ABSOLUTE.test(code)) offenders.push(name);
  }
  assert.deepEqual(
    offenders,
    [],
    "these hardcode an absolute path. It only exists on one machine, so the check " +
      "silently does nothing everywhere else — and in a public repo it also " +
      "publishes the private repos' names. Use test/sibling-repo.mjs.",
  );
});

test("the resolver itself names no machine", async () => {
  const code = strip(await readFile(join(HERE, "sibling-repo.mjs"), "utf-8"));
  assert.ok(
    !ABSOLUTE.test(code),
    "the resolver hardcodes an absolute path, which defeats the point of having it",
  );
  // And it must actually offer an override, or a build server has no way in.
  assert.match(
    code,
    /process\.env\.ZPL_ENGINE_SOURCE/,
    "the engine root can no longer be pointed anywhere by environment",
  );
});

test("every cross-repo check reports absence as a skip", async () => {
  const quiet = [];
  for (const name of await testFiles()) {
    const code = strip(await readFile(join(HERE, name), "utf-8"));
    // Only files that actually read a sibling repo are governed by this.
    if (!/\breadSibling\s*\(/.test(code)) continue;
    // Anchored on the use, not on the import: the import line names `t.skip`
    // nowhere, and a file that imported the helper and never called it would
    // otherwise pass.
    if (!/\bt\.skip\s*\(/.test(code)) quiet.push(`${name} (reads a sibling, never skips)`);
    if (!/\bwhySkipped\s*\(/.test(code)) quiet.push(`${name} (skips with no reason)`);
  }
  assert.deepEqual(
    quiet,
    [],
    "these read another repo and do not report it as skipped when it is absent. " +
      "A bare `return` counts as a pass, which is how a check that read nothing " +
      "reported success on every machine but one.",
  );
});

test("at least one cross-repo check exists to be governed", async () => {
  // Without this, deleting every sibling read would make the rule above vacuous
  // and the suite would go green on the way to checking nothing at all.
  let readers = 0;
  for (const name of await testFiles()) {
    const code = strip(await readFile(join(HERE, name), "utf-8"));
    if (/\breadSibling\s*\(/.test(code)) readers += 1;
  }
  assert.ok(
    readers >= 3,
    `only ${readers} test files still compare this package against another repo. ` +
      `There were three; if that is deliberate, lower this number and say why.`,
  );
});
