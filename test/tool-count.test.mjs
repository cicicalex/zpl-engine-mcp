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
