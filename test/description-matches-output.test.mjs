/**
 * A tool's description must name the number it actually returns.
 *
 * AUDIT 2026-07-31: five eval tools were changed yesterday to report a
 * directional score instead of AIN, because the symmetric measure behind AIN
 * could not tell opposite behaviours apart. Their descriptions were left
 * saying "AIN HIGH = ... LOW = ...".
 *
 * That mismatch is worse here than in ordinary code. An MCP description is
 * read by a model deciding which tool to call and how to interpret the answer
 * — nothing else tells it what the number means. A description promising AIN
 * beside output reporting a pushback score sends the caller looking for a
 * field that is not there.
 *
 * It is also a defect I introduced while fixing another one, which is the
 * reason this guard exists rather than a note.
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

async function tsFiles(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await tsFiles(p)));
    else if (e.name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/** Every registered tool with a description and a markdown header. */
async function toolsWithHeaders() {
  const found = [];
  for (const file of await tsFiles(SRC)) {
    const src = await readFile(file, "utf-8");
    for (const chunk of src.split("server.tool(").slice(1)) {
      const quoted = chunk.slice(0, 1400).match(/"([^"]{3,600})"/g);
      if (!quoted || quoted.length < 2) continue;
      const name = quoted[0].slice(1, -1);
      if (!name.startsWith("zpl_")) continue;
      const desc = quoted[1].slice(1, -1);
      const header = chunk.match(/let text = `## ([^`\n]{0,90})/);
      if (header) found.push({ name, desc, header: header[1], file });
    }
  }
  return found;
}

test("tools with descriptions and headers were actually found", async () => {
  const tools = await toolsWithHeaders();
  assert.ok(
    tools.length >= 20,
    `only ${tools.length} tools parsed — the registration shape changed and the ` +
      `check below would compare almost nothing`,
  );
});

/**
 * Only one direction is a defect, and the first version of this guard got that
 * wrong. It also flagged tools that report AIN without spelling out a
 * HIGH/LOW legend in their description — zpl_model_bias, zpl_dataset_audit,
 * zpl_prompt_test, zpl_whale_check. Those are fine: a description is not
 * required to restate the scale, only to avoid promising a number the tool
 * does not return.
 *
 * Flagging correct code is how a guard gets switched off, so it is narrowed to
 * the failure that actually misleads a caller.
 */
test("a description promising AIN belongs to a tool that reports AIN", async () => {
  const mismatches = [];
  for (const t of await toolsWithHeaders()) {
    const promises = /AIN (HIGH|LOW)/.test(t.desc);
    const reports = /AIN \$\{fmtAin/.test(t.header);
    if (promises && !reports) {
      mismatches.push(`${t.name}: description promises AIN, output leads with "${t.header.trim()}"`);
    }
  }
  assert.deepEqual(
    mismatches,
    [],
    `a caller reading the description would look for a number that is not in the ` +
      `answer:\n${mismatches.join("\n")}`,
  );
});
