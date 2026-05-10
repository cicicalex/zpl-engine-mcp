/**
 * Bug #8 regression tests — Cloudflare HTML detection in parseEngineError.
 *
 * Pre-v3.7.2 a Cloudflare challenge / block / rate-limit page surfaced as
 * "Engine error 403: Forbidden" with no clue what actually happened.
 * parseEngineError now inspects content-type + cf-* headers + body
 * markers and returns an actionable message.
 *
 * Run after `npm run build`.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { parseEngineError } from "../dist/engine-client.js";

/** Build a minimal Response-like object the helper can read. */
function fakeResponse({ status = 503, contentType = "text/html", body = "", headers = {} } = {}) {
  const h = new Map(Object.entries({ "content-type": contentType, ...headers }).map(([k, v]) => [k.toLowerCase(), String(v)]));
  return {
    status,
    statusText: status === 503 ? "Service Unavailable" : status === 403 ? "Forbidden" : "Error",
    headers: { get: (name) => h.get(name.toLowerCase()) ?? null },
    text: async () => body,
    json: async () => { throw new Error("not json"); },
  };
}

test("identifies a Cloudflare 'Just a moment...' challenge page", async () => {
  const msg = await parseEngineError(fakeResponse({
    status: 503,
    contentType: "text/html; charset=UTF-8",
    body: "<html><title>Just a moment...</title><body>Checking your browser before accessing engine.zeropointlogic.io</body></html>",
    headers: { "cf-ray": "abc123-FRA", "cf-mitigated": "challenge" },
  }));
  assert.match(msg, /Cloudflare/);
  assert.match(msg, /browser challenge/);
  assert.match(msg, /cf-ray: abc123-FRA/);
  assert.match(msg, /User-Agent/);
});

test("identifies a Cloudflare 'Attention Required' block page", async () => {
  const msg = await parseEngineError(fakeResponse({
    status: 403,
    contentType: "text/html",
    body: "<html><title>Attention Required! | Cloudflare</title></html>",
    headers: { "cf-ray": "xyz789-AMS" },
  }));
  assert.match(msg, /Cloudflare/);
  assert.match(msg, /blocked/);
  assert.match(msg, /xyz789-AMS/);
});

test("falls back to generic Cloudflare-HTML message when body is unrecognised", async () => {
  const msg = await parseEngineError(fakeResponse({
    status: 502,
    contentType: "text/html",
    body: "<html>strange page</html>",
    headers: { "cf-ray": "qqq-LHR" },
  }));
  assert.match(msg, /Cloudflare/);
  assert.match(msg, /HTML page instead of JSON/);
  assert.match(msg, /qqq-LHR/);
});

test("triggers on cf-mitigated header even without text/html content-type", async () => {
  const msg = await parseEngineError(fakeResponse({
    status: 403,
    contentType: "application/octet-stream",
    body: "",
    headers: { "cf-mitigated": "block", "cf-ray": "rrr-CDG" },
  }));
  assert.match(msg, /Cloudflare/);
  assert.match(msg, /rrr-CDG/);
});

test("falls back to JSON parsing when no Cloudflare signals present", async () => {
  // Engine's own structured error response — should NOT trigger the CF path.
  const res = {
    status: 401,
    statusText: "Unauthorized",
    headers: { get: (name) => name.toLowerCase() === "content-type" ? "application/json" : null },
    text: async () => '{"error":"Missing Authorization header","code":401}',
    json: async () => ({ error: "Missing Authorization header", code: 401 }),
  };
  const msg = await parseEngineError(res);
  assert.match(msg, /Engine error 401/);
  assert.match(msg, /Missing Authorization header/);
  assert.doesNotMatch(msg, /Cloudflare/);
});

test("falls back to statusText when JSON parse fails AND no CF signals", async () => {
  const res = {
    status: 500,
    statusText: "Internal Server Error",
    headers: { get: () => null },
    text: async () => "not json, not html, not anything",
    json: async () => { throw new Error("not json"); },
  };
  const msg = await parseEngineError(res);
  assert.match(msg, /Engine error 500/);
  assert.match(msg, /Internal Server Error/);
});
