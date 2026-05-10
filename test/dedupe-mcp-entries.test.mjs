/**
 * Regression tests for the dedupe behavior added to patchMcpConfigFile in v3.7.2.
 *
 * Earlier wizard versions and copy-pasted snippets from old docs left users
 * with multiple ZPL entries under different keys (e.g. "ZPL Engine MCP",
 * "@zeropointlogic/engine-mcp", "zpl-engine"). Claude Desktop happily loaded
 * all of them → duplicate tools / quota counted twice / confusion.
 *
 * patchMcpConfigFile now removes any sibling whose key OR command/args clearly
 * point at this package, then writes the canonical "zpl-engine-mcp" entry.
 *
 * Run after `npm run build`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { patchMcpConfigFile } from "../dist/setup.js";

async function setupTmp() {
  const dir = await mkdtemp(join(tmpdir(), "zpl-mcp-test-"));
  return { dir, path: join(dir, "config.json") };
}

const KEY = `zpl_u_${"a".repeat(48)}`;

test("removes legacy entry under '@zeropointlogic/engine-mcp' key", async () => {
  const { dir, path } = await setupTmp();
  try {
    const before = {
      mcpServers: {
        "@zeropointlogic/engine-mcp": {
          command: "npx",
          args: ["-y", "@zeropointlogic/engine-mcp"],
          env: { ZPL_API_KEY: "old-key" },
        },
        "other-server": { command: "node", args: ["other.js"] },
      },
    };
    await writeFile(path, JSON.stringify(before, null, 2), "utf-8");
    const result = await patchMcpConfigFile(path, KEY);
    assert.equal(result.result, "updated");
    const after = JSON.parse(await readFile(path, "utf-8"));
    // Legacy key gone, canonical key present, sibling preserved.
    assert.equal(after.mcpServers["@zeropointlogic/engine-mcp"], undefined);
    assert.ok(after.mcpServers["zpl-engine-mcp"]);
    assert.equal(after.mcpServers["zpl-engine-mcp"].env.ZPL_API_KEY, KEY);
    assert.ok(after.mcpServers["other-server"], "non-ZPL sibling must be preserved");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removes 'ZPL Engine MCP' key whose args reference the package", async () => {
  const { dir, path } = await setupTmp();
  try {
    const before = {
      mcpServers: {
        "ZPL Engine MCP": {
          command: "npx",
          args: ["-y", "zpl-engine-mcp"],
          env: { ZPL_API_KEY: "old-key" },
        },
      },
    };
    await writeFile(path, JSON.stringify(before, null, 2), "utf-8");
    await patchMcpConfigFile(path, KEY);
    const after = JSON.parse(await readFile(path, "utf-8"));
    assert.equal(after.mcpServers["ZPL Engine MCP"], undefined);
    assert.equal(after.mcpServers["zpl-engine-mcp"].env.ZPL_API_KEY, KEY);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("removes 'zpl-engine' (close but wrong) key", async () => {
  const { dir, path } = await setupTmp();
  try {
    const before = {
      mcpServers: {
        "zpl-engine": {
          command: "npx",
          args: ["-y", "zpl-engine-mcp"],
        },
      },
    };
    await writeFile(path, JSON.stringify(before, null, 2), "utf-8");
    await patchMcpConfigFile(path, KEY);
    const after = JSON.parse(await readFile(path, "utf-8"));
    assert.equal(after.mcpServers["zpl-engine"], undefined);
    assert.ok(after.mcpServers["zpl-engine-mcp"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("does NOT remove unrelated entries that mention 'zpl' in name only", async () => {
  // Hypothetical: a sibling tool that happens to have "zpl" in its name but
  // is unrelated. The dedupe should ONLY catch entries whose command/args/key
  // matches our published package names.
  const { dir, path } = await setupTmp();
  try {
    const before = {
      mcpServers: {
        "my-zpl-helper": { // doesn't match zpl-engine-mcp pattern
          command: "node",
          args: ["./my-script.js"],
        },
      },
    };
    await writeFile(path, JSON.stringify(before, null, 2), "utf-8");
    await patchMcpConfigFile(path, KEY);
    const after = JSON.parse(await readFile(path, "utf-8"));
    assert.ok(after.mcpServers["my-zpl-helper"], "unrelated sibling must be preserved");
    assert.ok(after.mcpServers["zpl-engine-mcp"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("idempotent: re-running with same key gives same result", async () => {
  const { dir, path } = await setupTmp();
  try {
    await writeFile(path, JSON.stringify({ mcpServers: {} }), "utf-8");
    await patchMcpConfigFile(path, KEY);
    const first = await readFile(path, "utf-8");
    await patchMcpConfigFile(path, KEY);
    const second = await readFile(path, "utf-8");
    assert.equal(first, second, "second patch must produce identical output");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
