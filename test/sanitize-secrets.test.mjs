/**
 * Bug-fix regression tests for the addHistory secret sanitizer (Bug found
 * during PHASE 3.2 security audit, fixed in v3.7.2).
 *
 * Pre-3.7.2 the regex was `/zpl_[us]_[a-f0-9]{20,}/gi` which failed on
 * wizard-issued keys like `zpl_u_mcp_<hex>` because the first non-hex
 * letter after `zpl_u_` broke the match. If a tool ever stuffed the API
 * key into results (e.g. by accident in a debug log), it would be persisted
 * to ~/.zpl-engine/history.json in clear text.
 *
 * The new regex `/zpl_[us]_(?:[a-z]+_)?[a-f0-9]{20,}/gi` redacts all engine
 * key shapes the format validator accepts.
 *
 * Run after `npm run build`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const HEX48 = "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef";

async function withTempStore(fn) {
  const dir = await mkdtemp(join(tmpdir(), "zpl-sanitize-"));
  process.env.ZPL_STORE_PATH = dir;
  try {
    // Re-import to pick up the env var
    const store = await import(`../dist/store.js?cachebust=${Date.now()}`);
    await fn(store, dir);
  } finally {
    delete process.env.ZPL_STORE_PATH;
    await rm(dir, { recursive: true, force: true });
  }
}

test("sanitizer redacts legacy zpl_u_<hex> keys", async () => {
  await withTempStore(async (store, dir) => {
    store.addHistory({
      tool: "test_tool",
      results: { leaked_key: `zpl_u_${HEX48}` },
      ain_scores: { test: 50 },
    });
    const raw = await readFile(join(dir, "history.json"), "utf-8");
    assert.ok(raw.includes("[REDACTED]"), `expected REDACTED, got: ${raw.slice(0, 200)}`);
    assert.ok(!raw.includes(HEX48), "raw hex must NOT appear in stored history");
  });
});

test("sanitizer redacts wizard zpl_u_mcp_<hex> keys (Bug fix v3.7.2)", async () => {
  await withTempStore(async (store, dir) => {
    store.addHistory({
      tool: "test_tool",
      results: { leaked_key: `zpl_u_mcp_${HEX48}` },
      ain_scores: { test: 50 },
    });
    const raw = await readFile(join(dir, "history.json"), "utf-8");
    assert.ok(raw.includes("[REDACTED]"), `expected REDACTED, got: ${raw.slice(0, 200)}`);
    assert.ok(!raw.includes(HEX48), "wizard key hex must NOT appear in stored history");
  });
});

test("sanitizer redacts wizard zpl_u_cli_<hex> keys", async () => {
  await withTempStore(async (store, dir) => {
    store.addHistory({
      tool: "test_tool",
      results: { leaked_key: `zpl_u_cli_${HEX48}` },
      ain_scores: { test: 50 },
    });
    const raw = await readFile(join(dir, "history.json"), "utf-8");
    assert.ok(raw.includes("[REDACTED]"));
    assert.ok(!raw.includes(HEX48));
  });
});

test("sanitizer redacts service zpl_s_<hex> keys", async () => {
  await withTempStore(async (store, dir) => {
    store.addHistory({
      tool: "test_tool",
      results: { leaked_key: `zpl_s_${HEX48}` },
      ain_scores: { test: 50 },
    });
    const raw = await readFile(join(dir, "history.json"), "utf-8");
    assert.ok(raw.includes("[REDACTED]"));
    assert.ok(!raw.includes(HEX48));
  });
});

test("sanitizer redacts Bearer tokens", async () => {
  await withTempStore(async (store, dir) => {
    store.addHistory({
      tool: "test_tool",
      results: { error_msg: `Authorization: Bearer abc123def456ghi789` },
      ain_scores: { test: 50 },
    });
    const raw = await readFile(join(dir, "history.json"), "utf-8");
    assert.ok(raw.includes("[REDACTED]"));
    assert.ok(!raw.includes("abc123def456ghi789"));
  });
});

test("sanitizer redacts Anthropic-style sk-ant-* keys", async () => {
  await withTempStore(async (store, dir) => {
    // Fixture uses obviously-fake repeated string to avoid GitHub secret-scan flag.
    const fakePart = "FAKE_FIXTURE_NOT_A_REAL_KEY_xxx";
    store.addHistory({
      tool: "test_tool",
      results: { leaked: `sk-ant-api03-${fakePart}` },
      ain_scores: { test: 50 },
    });
    const raw = await readFile(join(dir, "history.json"), "utf-8");
    assert.ok(raw.includes("[REDACTED]"));
    assert.ok(!raw.includes(fakePart));
  });
});

test("sanitizer redacts Groq sk_* keys", async () => {
  await withTempStore(async (store, dir) => {
    store.addHistory({
      tool: "test_tool",
      results: { leaked: `gsk_AbC123dEf456GhI789` },
      ain_scores: { test: 50 },
    });
    const raw = await readFile(join(dir, "history.json"), "utf-8");
    assert.ok(raw.includes("[REDACTED]"));
    assert.ok(!raw.includes("AbC123dEf456GhI789"));
  });
});

test("sanitizer leaves normal data untouched", async () => {
  await withTempStore(async (store, dir) => {
    store.addHistory({
      tool: "test_tool",
      results: { asset: "BTC", price: 80000, ratio: 0.85 },
      ain_scores: { btc: 75 },
    });
    const raw = await readFile(join(dir, "history.json"), "utf-8");
    assert.ok(raw.includes("BTC"));
    assert.ok(raw.includes("80000"));
    assert.ok(!raw.includes("REDACTED"));
  });
});
