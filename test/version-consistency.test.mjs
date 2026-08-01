/**
 * Every surface that states this package's version must state the same one.
 *
 * AUDIT 2026-08-01. Measured immediately before deploy:
 *
 *   package.json                      4.3.0   (npm publishes this; the runtime reports it)
 *   server.json version               4.2.1   (the MCP registry listing)
 *   server.json packages[0].version   4.2.1   (the npm version the registry installs)
 *   package-lock.json root            4.2.1   (twice)
 *
 * Commit 237f6c9 bumped package.json and left the rest behind. This is the
 * second occurrence, not the first: 31be14b is titled "chore(publish): bump
 * server.json to 4.2.1 to match package.json" — the same drift, corrected by
 * hand, with nothing left behind to catch it happening again. It happened again.
 *
 * What was at stake: 4.3.0's changelog is eleven tools whose verdicts were
 * inverted — a system with every component at CVSS 9.5 told it had no single
 * point of failure, a token with 85% insider holding called "fair
 * distribution". A registry entry pinned to 4.2.1 serves all eleven to whoever
 * installs from it, while npm serves the fixed build to everyone else. The two
 * install paths would disagree about what the product does.
 *
 * A guard already read server.json — tool-count.test.mjs checks the advertised
 * tool count across README, package.json and server.json, which is why that
 * field stayed consistent through four releases while the version beside it
 * drifted. Checking one field of a file is not checking the file.
 *
 * package.json is the source of truth here rather than an arbitrary pick:
 * package-meta.ts reads it at runtime for `--version` and the server handshake,
 * and npm publishes from it. Everything else is a copy, so everything else is
 * what can be wrong.
 *
 * Note on the lock file: measured, `npm ci --dry-run` exits 0 with the root
 * version stale, and package-lock is not in `files` so it never ships. It is
 * checked anyway — a guard that exempts the harmless surface is where the next
 * drift lands.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** Read and parse, failing loudly rather than skipping. A file this guard
 *  cannot read is a file this guard is not checking. */
async function readJson(name) {
  let raw;
  try {
    raw = await readFile(join(ROOT, name), "utf-8");
  } catch (err) {
    assert.fail(`${name} could not be read (${err.code}) — this guard would otherwise pass by checking nothing`);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    assert.fail(`${name} is not valid JSON: ${err.message}`);
  }
}

const pkg = await readJson("package.json");
const VERSION = pkg.version;
const NAME = pkg.name;

test("package.json carries a real semver version and a name", () => {
  assert.match(
    VERSION ?? "",
    /^\d+\.\d+\.\d+(?:-[\w.]+)?$/,
    `package.json version is ${JSON.stringify(VERSION)}. Every assertion below compares ` +
      `against it, so a missing or malformed value would make them all trivially true.`,
  );
  assert.ok(NAME, "package.json has no name");
});

/**
 * Version-shaped tokens in prose.
 *
 * Two forms count: three components (1.1.6), or a `v` prefix on two (v4.1).
 * Both are what actually went stale — this package's npm description ended with
 * "v4.1 adds HTTP_PROXY..." while publishing 4.3.0. A bare two-component number
 * is left alone so ordinary prose does not read as a release, and runs of four
 * or more components are addresses rather than versions.
 */
function versionTokens(text) {
  const out = [];
  for (const m of text.matchAll(/(v?)(\d+(?:\.\d+)+)/gi)) {
    const parts = m[2].split(".");
    if (parts.length > 3) continue;
    if (parts.length === 3 || (parts.length === 2 && m[1])) out.push(m[2]);
  }
  return out;
}

test("the npm description does not advertise a different version", () => {
  const desc = pkg.description ?? "";
  assert.ok(desc.length > 0, "package.json has no description — npm would show the package with none");

  const wrong = versionTokens(desc).filter((v) => v !== VERSION);
  assert.deepEqual(
    wrong,
    [],
    `the npm description names ${wrong.join(", ")} while this package publishes as ${VERSION}. ` +
      `npm renders this on the package page and in search results and it cannot be edited without ` +
      `publishing again. Keep the description evergreen and put release notes in CHANGELOG.md.`,
  );
});

test("the registry manifest advertises the version that is being published", async () => {
  const server = await readJson("server.json");

  assert.equal(
    server.version,
    VERSION,
    `server.json lists the server at ${server.version} while the package is ${VERSION}. ` +
      `This file is the MCP registry manifest — it is what the registry publishes and what ` +
      `clients resolve, so a stale value here means the registry and npm advertise different ` +
      `builds of the same release.`,
  );

  assert.ok(
    Array.isArray(server.packages) && server.packages.length > 0,
    "server.json declares no packages — the registry entry would install nothing, and the " +
      "per-package assertions below would pass over an empty list",
  );

  server.packages.forEach((p, i) => {
    assert.equal(
      p.version,
      VERSION,
      `server.json packages[${i}] pins ${p.identifier} at ${p.version}; the package is ` +
        `${VERSION}. This is the exact version the registry tells clients to install — the ` +
        `previous drift would have served 4.2.1, which reports eleven tool verdicts inverted.`,
    );
    assert.equal(
      p.identifier,
      NAME,
      `server.json packages[${i}] points at "${p.identifier}" but this package is published ` +
        `as "${NAME}". The registry would install a different package, or none.`,
    );
  });
});

test("the lock file's root version matches the manifest", async () => {
  const lock = await readJson("package-lock.json");

  assert.equal(lock.version, VERSION, `package-lock.json root version is ${lock.version}, package is ${VERSION}`);
  assert.equal(
    lock.packages?.[""]?.version,
    VERSION,
    `package-lock.json packages[""].version is ${lock.packages?.[""]?.version}, package is ${VERSION}`,
  );
});

test("the changelog documents the version about to ship", async () => {
  let changelog;
  try {
    changelog = await readFile(join(ROOT, "CHANGELOG.md"), "utf-8");
  } catch (err) {
    assert.fail(`CHANGELOG.md could not be read (${err.code})`);
  }

  // A heading, not a mention. The version appearing in prose somewhere ("fixed
  // since 4.3.0") is not a release entry, and matching loosely is how a release
  // ships with no notes while the guard reports green.
  const headings = [...changelog.matchAll(/^##\s*\[([^\]]+)\]/gm)].map((m) => m[1]);
  assert.ok(
    headings.includes(VERSION),
    `CHANGELOG.md has no "## [${VERSION}]" entry. Headings present: ${headings.slice(0, 6).join(", ")}. ` +
      `Publishing to npm is irreversible, so the release notes have to exist before the tag does.`,
  );
});
