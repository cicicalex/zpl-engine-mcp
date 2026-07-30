/**
 * Tool count — the number must be declared once and measured, never typed twice.
 *
 * Three different figures used to circulate for this MCP. src/tool-count.ts is
 * now the single declaration; these tests re-count the actual registrations in
 * src/ and fail if the constant drifts, so nobody has to trust a comment.
 *
 * Run after `npm run build`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const SRC = join(ROOT, "src");

/** Tools registered under an alias name that reuses another tool's handler. */
const ALIASES = [
  "zpl_balance_compare", // alias of zpl_versus
  "zpl_balance_check",   // alias of zpl_decide
  "zpl_balance_pair",    // alias of zpl_compare
  "zpl_balance_rank",    // alias of zpl_rank
];

async function tsFiles(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await tsFiles(p)));
    else if (entry.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

async function registeredToolNames() {
  const names = [];
  for (const file of await tsFiles(SRC)) {
    const src = await readFile(file, "utf-8");
    for (const m of src.matchAll(/server\.tool\(\s*\r?\n?\s*["'`](zpl_[a-z0-9_]+)["'`]/g)) {
      names.push(m[1]);
    }
  }
  return names;
}

test("declared tool count matches the tools actually registered in src/", async () => {
  const { REGISTERED_TOOL_COUNT, UNIQUE_TOOL_COUNT, ALIAS_TOOL_COUNT } =
    await import(new URL("../dist/tool-count.js", import.meta.url).href);

  const names = await registeredToolNames();
  const registrations = (
    await Promise.all((await tsFiles(SRC)).map((f) => readFile(f, "utf-8")))
  ).reduce((sum, src) => sum + (src.match(/server\.tool\(/g)?.length ?? 0), 0);

  assert.equal(
    names.length,
    registrations,
    "every server.tool(...) call should have been matched with its literal name",
  );
  assert.equal(
    new Set(names).size,
    names.length,
    `duplicate tool names registered: ${names.filter((n, i) => names.indexOf(n) !== i).join(", ")}`,
  );
  assert.equal(
    names.length,
    REGISTERED_TOOL_COUNT,
    `src/tool-count.ts says ${REGISTERED_TOOL_COUNT} registered tools, src/ actually registers ${names.length}`,
  );
  assert.equal(ALIAS_TOOL_COUNT, ALIASES.length);
  for (const alias of ALIASES) {
    assert.ok(names.includes(alias), `expected alias ${alias} to be registered`);
  }
  assert.equal(UNIQUE_TOOL_COUNT, REGISTERED_TOOL_COUNT - ALIAS_TOOL_COUNT);
});

test("no hardcoded tool count in the server description or zpl_about", async () => {
  for (const rel of ["index.ts", join("tools", "meta.ts")]) {
    const src = await readFile(join(SRC, rel), "utf-8");
    assert.doesNotMatch(
      src,
      /\b(?:59|64|68) (?:tools|unique)\b/,
      `${rel} hardcodes a tool count — import it from src/tool-count.ts instead`,
    );
  }
});

/**
 * Every published surface must state the count the code actually registers.
 *
 * AUDIT 2026-07-30: the guard above compares src/tool-count.ts against the
 * real registrations, which is the important half — but nothing checked the
 * places a reader actually sees. Adding one tool left four different numbers
 * in circulation at once:
 *
 *   src/tool-count.ts   69   (correct, recounted by the test above)
 *   README.md           68 ... and 67, two sections apart in the same file
 *   package.json        68   (the npm listing)
 *   server.json         68   (the MCP registry listing)
 *
 * So the npm page advertised one number, the registry another, and the README
 * disagreed with itself. None of them was what the server registers.
 */
test("README, package.json and server.json state the registered count", async () => {
  const { REGISTERED_TOOL_COUNT, UNIQUE_TOOL_COUNT } = await import(
    new URL("../dist/tool-count.js", import.meta.url).href
  );

  // Only phrasings that state the TOTAL. The first version matched every
  // "<number> tools" and immediately flagged a changelog line reading
  // "22 tools now persist real tokens_used" — a true statement about how many
  // tools were changed in a release, not a claim about how many exist. A guard
  // that cries wolf on correct prose gets switched off, so it is narrowed to
  // the three shapes actually used to announce the total.
  const TOTAL_CLAIM = [
    /\*\*(\d{2,3})\s+tools\*\*/g, // README headline: **69 tools**
    /(\d{2,3})\s+tools\s+across/g, // package.json / server.json / README
    /Tool Categories\s*\((\d{2,3})\s+tools\)/g, // README section heading
    /all\s+(\d{2,3})\s+tools\b/g, // README prose: "all 69 tools keep..."
  ];

  const surfaces = ["README.md", "package.json", "server.json"];
  const wrong = [];

  for (const name of surfaces) {
    const text = await readFile(join(ROOT, name), "utf-8");
    for (const pattern of TOTAL_CLAIM) {
      for (const m of text.matchAll(pattern)) {
        if (Number(m[1]) !== REGISTERED_TOOL_COUNT) {
          wrong.push(`${name}: says "${m[1]} tools", code registers ${REGISTERED_TOOL_COUNT}`);
        }
      }
    }
    for (const m of text.matchAll(/(\d{2,3})\s+unique\b/g)) {
      if (Number(m[1]) !== UNIQUE_TOOL_COUNT) {
        wrong.push(`${name}: says "${m[1]} unique", code has ${UNIQUE_TOOL_COUNT}`);
      }
    }
  }

  assert.deepEqual(
    wrong,
    [],
    `published surfaces disagree with the code about how many tools exist:\n${wrong.join("\n")}`,
  );
});

test("the surfaces actually make a claim to check", async () => {
  // Without this, deleting every mention would leave the guard above green
  // while the README said nothing at all.
  let claims = 0;
  for (const name of ["README.md", "package.json", "server.json"]) {
    const text = await readFile(join(ROOT, name), "utf-8");
    claims += [...text.matchAll(/\*\*\d{2,3}\s+tools\*\*/g)].length;
    claims += [...text.matchAll(/\d{2,3}\s+tools\s+across/g)].length;
  }
  assert.ok(
    claims >= 3,
    `only ${claims} total-count claims found across the three files — either the ` +
      `wording changed or the counts were removed, and the guard above would ` +
      `pass while checking almost nothing`,
  );
});
