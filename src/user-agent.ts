/**
 * Shared User-Agent for all outbound HTTP from the MCP package.
 *
 * Why this exists (CRITICAL — discovered v4.1.0 testing):
 *   src/setup.ts had a USER_AGENT for the device-flow login on
 *   zeropointlogic.io, but src/engine-client.ts did NOT set a User-Agent
 *   for /compute, /sweep, /health, /plans. Cloudflare's Bot Fight Mode on
 *   engine.zeropointlogic.io 403'd every non-Mozilla UA — and Node's
 *   default UA is "node". So every real scoring tool call was Cloudflare-
 *   blocked silently. (parseEngineError caught it as a CF challenge and
 *   surfaced "User-Agent looks like a bot" — but the MCP itself was the
 *   bot, despite the error message claiming otherwise.)
 *
 * v4.1.1 fix: extract the UA into one module that BOTH setup.ts and
 *            engine-client.ts import, so the comment in parseEngineError
 *            ("MCP sends a Mozilla-compat UA") is finally true.
 *
 * Mozilla envelope is the same convention used by bingbot / slackbot —
 * lets us identify the tool while clearing CF's Bot Fight Mode challenge.
 */
import { getMcpPackageVersion } from "./package-meta.js";

export const USER_AGENT = `Mozilla/5.0 (compatible; zpl-engine-mcp/${getMcpPackageVersion()}; +https://github.com/cicicalex/zpl-engine-mcp)`;
