#!/usr/bin/env node

/**
 * ZPL Engine MCP Server
 *
 * Exposes the Zero Point Logic stability engine to any MCP client
 * (Claude Code, Cursor, Windsurf, etc.) via the Model Context Protocol.
 *
 * The engine performs post-binary neutrality analysis — this MCP wraps it
 * with domain-specific "lenses" for finance, games, AI, security, and crypto.
 *
 * IMPORTANT: The engine formula is a trade secret. This MCP only sends
 * (d, bias, samples) to the API and receives (ain, status, deviation).
 * No computation logic exists in this codebase.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ZPLEngineClient } from "./engine-client.js";
import { domains, getDomain, listDomains } from "./domains/index.js";
import {
  getHistory, addHistory, clearHistory,
  getWatchlist, addToWatchlist, removeFromWatchlist, updateWatchlistItem,
} from "./store.js";
import { registerAllTools } from "./tools/index.js";
import { resolveZplApiKey } from "./env-keys.js";
import { getValidatedEngineBaseUrl } from "./engine-url.js";
import { getMcpPackageVersion } from "./package-meta.js";

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

const API_KEY = resolveZplApiKey();

// Defence-in-depth: validate API key format client-side before hitting the engine.
// Engine still does the authoritative check; this just fails fast on obvious garbage
// and prevents accidentally leaking unrelated secrets (e.g. Stripe keys) in the
// Authorization header.
//
// v3.5.0: Only `zpl_u_...` (user keys) are accepted. Service keys (`zpl_s_...`)
// are server-side only and must be IP-restricted on the engine (see M2.1).
// MCP clients must authenticate with user keys so plan limits apply per account.
// Format: zpl_u_ + 48 hex chars = 54 chars total.
const API_KEY_FORMAT = /^zpl_u_[a-f0-9]{48}$/;
function isValidApiKeyFormat(key: string): boolean {
  return API_KEY_FORMAT.test(key);
}
function isServiceKey(key: string): boolean {
  return /^zpl_s_[a-f0-9]{48}$/.test(key);
}

// API key check moved to main() — allows Smithery sandbox scanning without key
// ZPL_ENGINE_URL validated in getValidatedEngineBaseUrl() (host allowlist, no creds in URL).
const DEFAULT_D = Math.max(3, Math.min(100, Number(process.env.ZPL_DEFAULT_D) || 9));
const DEFAULT_SAMPLES = Math.max(100, Math.min(50000, Number(process.env.ZPL_DEFAULT_SAMPLES) || 1000));
const OUTPUT_STYLE = (process.env.ZPL_OUTPUT ?? "detailed") as "detailed" | "compact";
const LANGUAGE = process.env.ZPL_LANGUAGE ?? "en";
const BUDGET_WARN = Number(process.env.ZPL_BUDGET_WARN) || 500;
const SAVE_HISTORY = process.env.ZPL_SAVE_HISTORY !== "false";

// ZPL_MODE (pure/coach) lives in tools/helpers.ts so all tool files can share it.

function getClient(): ZPLEngineClient {
  if (!API_KEY) {
    throw new Error(
      "ZPL API key not configured. Set ZPL_API_KEY (or ZPL_ENGINE_KEY).\n" +
      "Create a user key at https://zeropointlogic.io/dashboard/api-keys\n" +
      "(v3.5.0+: service keys `zpl_s_...` are NOT accepted by the MCP — " +
      "use a per-user `zpl_u_...` key so plan limits apply per account.)"
    );
  }
  if (isServiceKey(API_KEY)) {
    throw new Error(
      "Service keys (`zpl_s_...`) are no longer accepted by the ZPL MCP.\n" +
      "\n" +
      "Service keys bypass all plan limits and are server-side only.\n" +
      "MCP clients (Claude Desktop, Claude Code, Cursor, etc.) must use\n" +
      "a USER key (`zpl_u_...`) so your usage is metered against your plan.\n" +
      "\n" +
      "Create a user key:  https://zeropointlogic.io/dashboard/api-keys"
    );
  }
  if (!isValidApiKeyFormat(API_KEY)) {
    throw new Error(
      "ZPL_API_KEY format invalid. Expected `zpl_u_<48 hex>` (54 chars total).\n" +
      "This check runs client-side to avoid sending unrelated secrets to the engine.\n" +
      "Get a correctly formatted key at https://zeropointlogic.io/dashboard/api-keys"
    );
  }
  return new ZPLEngineClient(API_KEY, getValidatedEngineBaseUrl());
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "ZPL Engine MCP",
  version: getMcpPackageVersion(),
  description: "Mathematical stability engine. 67 tools (63 unique + 4 backwards-compat aliases). AIN is a STABILITY measurement only — never prediction or advice. v3.3 adds clearer balance-prefixed names, v3.4 adds 8 AI Eval tools for model consistency testing. Created by Ciciu Alexandru-Costinel.",
});

// Register all domain-specific tools (31 tools across 7 categories)
registerAllTools(server, getClient);

// ---------------------------------------------------------------------------
// Tool: zpl_compute — Raw engine computation
// ---------------------------------------------------------------------------

server.tool(
  "zpl_compute",
  "Run a raw ZPL Engine computation. Takes dimension (d), bias (0-1), and optional samples. Returns AIN score, status, deviation, and token usage. Use this for direct engine access without domain interpretation.",
  {
    d: z.number().int().min(3).max(100).describe("Matrix dimension (3-100). Higher = more complex analysis, more tokens."),
    bias: z.number().min(0).max(1).describe("Input bias (0.0 = no bias, 1.0 = maximum bias). This is what the engine evaluates."),
    samples: z.number().int().min(100).max(50000).optional().default(1000).describe("Number of samples (100-50000). More samples = more precise, more tokens."),
  },
  async ({ d, bias, samples }) => {
    try {
      const client = getClient();
      const result = await client.compute({ d, bias, samples });

      const ain = Math.round(result.ain * 100);
      // IP protection: expose AIN score + status only. No p_output, no deviation,
      // no intermediate values. Tokens shown separately so user knows usage.
      const text = [
        `## ZPL Engine Result`,
        ``,
        `**AIN Score:** ${ain}/100`,
        `**Status:** ${result.ain_status}`,
        ``,
        `*Tokens used: ${result.tokens_used}*`,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: zpl_sweep — Bias sweep across 19 steps
// ---------------------------------------------------------------------------

server.tool(
  "zpl_sweep",
  "Run a ZPL Engine sweep: tests all 19 bias levels (0.0 to 1.0) for a given dimension. Shows how stability changes as bias increases. Useful for understanding sensitivity and finding neutral points. Costs 19x a single compute.",
  {
    d: z.number().int().min(3).max(100).describe("Matrix dimension to sweep"),
    samples: z.number().int().min(100).max(50000).optional().default(1000).describe("Samples per step"),
  },
  async ({ d, samples }) => {
    try {
      const client = getClient();
      const result = await client.sweep(d, samples);

      // IP protection: expose AIN score + status only per step. No p_output, no deviation.
      let text = `## ZPL Sweep (d=${result.d})\n\n`;
      text += `| Bias | AIN | Status |\n`;
      text += `|------|-----|--------|\n`;

      for (const r of result.results) {
        text += `| ${r.bias.toFixed(2)} | ${Math.round(r.ain * 100)}% | ${r.status} |\n`;
      }

      text += `\n*Total tokens used: ${result.total_tokens}*`;

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: zpl_analyze — Domain-aware analysis
// ---------------------------------------------------------------------------

server.tool(
  "zpl_analyze",
  "Smart analysis using a domain lens. Automatically converts domain-specific data (prices, game stats, model outputs, etc.) into engine parameters and interprets results in domain-specific language. Available domains: finance, game, ai, security, crypto.",
  {
    domain: z.enum(["finance", "game", "ai", "security", "crypto", "universal"]).describe("Domain lens to use"),
    input: z.record(z.string(), z.unknown()).describe("Domain-specific input data. Use zpl_domains to see required fields for each domain."),
    sweep: z.boolean().optional().default(false).describe("If true, runs a full 19-step sweep instead of single compute"),
  },
  async ({ domain, input, sweep }) => {
    try {
      // Validate input size to prevent abuse
      const inputStr = JSON.stringify(input);
      if (inputStr.length > 50000) {
        return { content: [{ type: "text" as const, text: "Error: Input too large (max 50KB)" }], isError: true };
      }

      const lens = getDomain(domain);
      if (!lens) {
        return {
          content: [{ type: "text" as const, text: `Unknown domain: ${domain}. Available: ${Array.from(domains.keys()).join(", ")}` }],
          isError: true,
        };
      }

      const client = getClient();
      const params = lens.buildParams(input);

      if (sweep) {
        const result = await client.sweep(params.d, params.samples);
        const text = lens.interpretSweep(result, input);
        return { content: [{ type: "text" as const, text }] };
      }

      const result = await client.compute(params);
      const interpretation = lens.interpret(result, input);

      const text = [
        `## ${interpretation.summary}`,
        ``,
        `**Signal:** ${interpretation.signal}`,
        ``,
        `### Details`,
        ...Object.entries(interpretation.details).map(([k, v]) => `- **${k}:** ${v}`),
        ``,
        `### Recommendation`,
        interpretation.recommendation,
      ].join("\n");

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: zpl_domains — List available domain lenses
// ---------------------------------------------------------------------------

server.tool(
  "zpl_domains",
  "List all available ZPL domain lenses with their descriptions, input schemas, and examples. Use this to discover what types of analysis are available.",
  {},
  async () => {
    const allDomains = listDomains();
    let text = `## ZPL Engine Domain Lenses\n\n`;
    text += `The ZPL Engine analyzes stability and neutrality across multiple domains.\n`;
    text += `Each domain converts your data into the engine's mathematical framework.\n\n`;

    for (const d of allDomains) {
      const lens = getDomain(d.id)!;
      text += `### ${d.name} (\`${d.id}\`)\n`;
      text += `${d.description}\n\n`;
      text += `**Input fields:**\n`;
      for (const [field, schema] of Object.entries(lens.inputSchema)) {
        text += `- \`${field}\` (${schema.type})${schema.required ? " *required*" : ""}: ${schema.description}\n`;
      }
      text += `\n**Examples:**\n`;
      for (const ex of d.examples) {
        text += `- ${ex}\n`;
      }
      text += `\n---\n\n`;
    }

    text += `### Get an API Key\n`;
    text += `Visit https://zeropointlogic.io/pricing to choose a plan and get your ZPL API key.\n`;
    text += `Set it as \`ZPL_API_KEY\` in your environment or MCP config.\n`;

    return { content: [{ type: "text" as const, text }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: zpl_health — Engine health check
// ---------------------------------------------------------------------------

server.tool(
  "zpl_health",
  "Check if the ZPL Engine is online and responding. Returns status and version. Does not require an API key.",
  {},
  async () => {
    try {
      const base = getValidatedEngineBaseUrl();
      const client = new ZPLEngineClient("", base);
      const health = await client.health();

      return {
        content: [{
          type: "text" as const,
          text: `ZPL Engine: **${health.status}** (${health.version})\nURL: ${base}`,
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Engine health check failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: zpl_plans — Show available plans
// ---------------------------------------------------------------------------

server.tool(
  "zpl_plans",
  "Show all ZPL Engine subscription plans with pricing, token limits, and dimension limits. Requires a valid API key.",
  {},
  async () => {
    try {
      const client = getClient();
      const plans = await client.plans();

      let text = `## ZPL Engine Plans\n\n`;
      text += `| Plan | Price | Max Dimension | Tokens/Month | API Keys |\n`;
      text += `|------|-------|---------------|--------------|----------|\n`;

      for (const p of plans) {
        text += `| ${p.name} | $${p.price_usd}/mo | ${p.max_d} | ${p.tokens_per_month.toLocaleString()} | ${p.max_keys} |\n`;
      }

      text += `\nToken cost per compute: **d\u00B2 + d** (e.g., d=9 costs 90 tokens)\n`;
      text += `Sweeps cost 19x (19 bias steps).\n`;
      text += `\nGet your key at https://zeropointlogic.io/pricing`;

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: zpl_history — View past analyses
// ---------------------------------------------------------------------------

server.tool(
  "zpl_history",
  "View history of past ZPL analyses. Shows recent questions, scores, and results. Useful for comparing over time or recalling past decisions.",
  {
    limit: z.number().int().min(1).max(100).optional().describe("Number of recent entries to show (default: 20)"),
    clear: z.boolean().optional().describe("If true, clears all history"),
  },
  async ({ limit: rawLimit, clear }) => {
    const limit = rawLimit ?? 20;
    if (clear) {
      const count = clearHistory();
      return { content: [{ type: "text" as const, text: `Cleared ${count} history entries.` }] };
    }

    const history = getHistory(limit);
    if (history.length === 0) {
      return { content: [{ type: "text" as const, text: "No history yet. Use `zpl_compute` or `zpl_analyze` to start building history." }] };
    }

    let text = `## ZPL History (last ${history.length} entries)\n\n`;
    text += `| # | Time | Tool | Question/Domain | AIN Scores |\n`;
    text += `|---|------|------|-----------------|------------|\n`;

    for (let i = 0; i < history.length; i++) {
      const h = history[i];
      const time = new Date(h.timestamp).toLocaleString();
      const label = h.question ?? h.domain ?? "-";
      const scores = Object.entries(h.ain_scores)
        .map(([k, v]) => `${k}: ${v}`)
        .join(", ");
      text += `| ${i + 1} | ${time} | ${h.tool} | ${label.slice(0, 40)} | ${scores} |\n`;
    }

    return { content: [{ type: "text" as const, text }] };
  }
);

// ---------------------------------------------------------------------------
// Tool: zpl_watchlist — Monitor items over time
// ---------------------------------------------------------------------------

server.tool(
  "zpl_watchlist",
  "Manage a watchlist of items to monitor with ZPL. Add assets, portfolios, or any analysis to track AIN changes over time.",
  {
    action: z.enum(["list", "add", "remove", "check"]).describe("Action: list (show all), add (new item), remove (delete by ID), check (re-run all and update scores)"),
    name: z.string().max(200).optional().describe("Item name (for 'add')"),
    domain: z.string().max(50).optional().describe("Domain lens (for 'add'): finance, game, ai, security, crypto, universal"),
    input: z.record(z.string(), z.unknown()).optional().describe("Domain input data (for 'add')"),
    id: z.string().optional().describe("Item ID (for 'remove')"),
    notes: z.string().max(500).optional().describe("Optional notes (for 'add')"),
  },
  async ({ action, name, domain, input, id, notes }) => {
    try {
      if (action === "list") {
        const items = getWatchlist();
        if (items.length === 0) {
          return { content: [{ type: "text" as const, text: "Watchlist is empty. Use action='add' to add items." }] };
        }

        let text = `## ZPL Watchlist (${items.length} items)\n\n`;
        text += `| ID | Name | Domain | Last AIN | Last Check | Notes |\n`;
        text += `|----|------|--------|----------|------------|-------|\n`;

        for (const item of items) {
          const lastAin = item.last_ain !== undefined ? `${item.last_ain}/100` : "—";
          const lastCheck = item.last_check ? new Date(item.last_check).toLocaleDateString() : "never";
          text += `| \`${item.id.slice(0, 12)}\` | ${item.name} | ${item.domain} | ${lastAin} | ${lastCheck} | ${item.notes ?? ""} |\n`;
        }

        return { content: [{ type: "text" as const, text }] };
      }

      if (action === "add") {
        if (!name || !domain || !input) {
          return { content: [{ type: "text" as const, text: "Error: 'add' requires name, domain, and input" }], isError: true };
        }
        const item = addToWatchlist({ name, domain, input, notes });
        return { content: [{ type: "text" as const, text: `Added to watchlist: **${item.name}** (${item.domain}) — ID: \`${item.id}\`` }] };
      }

      if (action === "remove") {
        if (!id) {
          return { content: [{ type: "text" as const, text: "Error: 'remove' requires id" }], isError: true };
        }
        const removed = removeFromWatchlist(id);
        return { content: [{ type: "text" as const, text: removed ? `Removed \`${id}\` from watchlist.` : `Item \`${id}\` not found.` }] };
      }

      if (action === "check") {
        const items = getWatchlist();
        if (items.length === 0) {
          return { content: [{ type: "text" as const, text: "Watchlist is empty." }] };
        }

        const client = getClient();
        let text = `## Watchlist Check (${items.length} items)\n\n`;

        for (const item of items) {
          try {
            const lens = getDomain(item.domain);
            if (!lens) {
              text += `- **${item.name}**: Unknown domain "${item.domain}"\n`;
              continue;
            }
            const params = lens.buildParams(item.input);
            const result = await client.compute(params);
            const ain = Math.round(result.ain * 100);
            const prev = item.last_ain;
            const delta = prev !== undefined ? ain - prev : null;
            const deltaStr = delta !== null ? (delta > 0 ? ` (+${delta})` : delta < 0 ? ` (${delta})` : ` (=)`) : " (first check)";

            updateWatchlistItem(item.id, ain);
            text += `- **${item.name}**: AIN ${ain}/100${deltaStr} — ${result.ain_status}\n`;
          } catch (err) {
            text += `- **${item.name}**: Error — ${(err as Error).message}\n`;
          }
        }

        return { content: [{ type: "text" as const, text }] };
      }

      return { content: [{ type: "text" as const, text: "Unknown action" }], isError: true };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: zpl_report — Generate comprehensive analysis report
// ---------------------------------------------------------------------------

server.tool(
  "zpl_report",
  "Generate a comprehensive ZPL analysis report. Runs multiple computations across different bias levels and dimensions, producing a full stability profile. Use for in-depth analysis of a single topic.",
  {
    title: z.string().max(200).describe("Report title (e.g. 'BTC Market Stability Q2 2026')"),
    domain: z.enum(["finance", "game", "ai", "security", "crypto"]).describe("Domain lens"),
    input: z.record(z.string(), z.unknown()).describe("Domain-specific input data"),
    include_sweep: z.boolean().optional().default(true).describe("Include full 19-step bias sweep"),
    include_sensitivity: z.boolean().optional().default(true).describe("Include dimension sensitivity test (d=3,5,9,16)"),
  },
  async ({ title, domain, input, include_sweep, include_sensitivity }) => {
    try {
      const lens = getDomain(domain);
      if (!lens) {
        return { content: [{ type: "text" as const, text: `Unknown domain: ${domain}` }], isError: true };
      }

      const client = getClient();
      const params = lens.buildParams(input);

      let text = `# ZPL Report: ${title}\n\n`;
      text += `**Domain:** ${lens.name} | **Generated:** ${new Date().toISOString()}\n\n`;

      // 1. Main computation
      text += `## 1. Primary Analysis\n\n`;
      const mainResult = await client.compute(params);
      const interpretation = lens.interpret(mainResult, input);
      text += `**AIN Score:** ${interpretation.ain}/100\n`;
      text += `**Status:** ${interpretation.status}\n`;
      text += `**Signal:** ${interpretation.signal}\n\n`;
      text += Object.entries(interpretation.details).map(([k, v]) => `- **${k}:** ${v}`).join("\n");
      text += `\n\n**Recommendation:** ${interpretation.recommendation}\n\n`;

      let totalTokens = mainResult.tokens_used;

      // 2. Bias sweep
      if (include_sweep) {
        text += `## 2. Bias Sweep (19 steps)\n\n`;
        const sweepResult = await client.sweep(params.d, params.samples);
        text += lens.interpretSweep(sweepResult, input);
        text += `\n\n`;
        totalTokens += sweepResult.total_tokens;
      }

      // 3. Dimension sensitivity
      if (include_sensitivity) {
        text += `## 3. Dimension Sensitivity\n\n`;
        text += `How does AIN change across different complexity levels?\n\n`;
        text += `| Dimension | AIN | Status | Tokens |\n`;
        text += `|-----------|-----|--------|--------|\n`;

        for (const testD of [3, 5, 9, 16]) {
          if (testD > params.d + 10) continue; // skip unreasonably large
          try {
            const r = await client.compute({ d: testD, bias: params.bias, samples: params.samples });
            text += `| d=${testD} | ${Math.round(r.ain * 100)}% | ${r.ain_status} | ${r.tokens_used} |\n`;
            totalTokens += r.tokens_used;
          } catch {
            text += `| d=${testD} | — | Error | 0 |\n`;
          }
        }
        text += `\n`;
      }

      // Summary
      text += `---\n\n`;
      text += `**Total tokens used:** ${totalTokens}\n`;
      text += `*Report generated by ZPL Engine MCP v${getMcpPackageVersion()}*\n`;

      // Save to history
      addHistory({
        tool: "zpl_report",
        domain,
        results: { title, interpretation, totalTokens },
        ain_scores: { [title]: interpretation.ain },
      });

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Smithery sandbox — allows Smithery to scan tools without real credentials
// ---------------------------------------------------------------------------

export function createSandboxServer() {
  return server;
}

// ---------------------------------------------------------------------------
// Main — connect to stdio transport
// ---------------------------------------------------------------------------

/**
 * Version check with forced-upgrade policy:
 *  - MAJOR version behind  -> BLOCK (exit 1, user must reinstall). Breaking changes or security fixes.
 *  - MINOR version behind  -> WARN but continue. New features available.
 *  - PATCH version behind  -> WARN quietly. Bug fixes available.
 *  - Up-to-date / ahead   -> silent.
 *
 * Cache: 1h for MAJOR check (so stuck users retry npm soon), 24h for minor/patch warnings.
 * Set ZPL_SKIP_UPDATE_CHECK=1 to bypass entirely (for self-hosted / offline / CI).
 * Network errors are non-fatal — never blocks if npm unreachable.
 */
type SemverParts = { major: number; minor: number; patch: number };
function parseSemver(v: string): SemverParts | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}
/** -1 if a<b, 0 if equal, +1 if a>b, or null if either unparseable. */
function cmpSemver(a: string, b: string): number | null {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa || !pb) return null;
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1;
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1;
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1;
  return 0;
}

async function checkLatestVersion(): Promise<"ok" | "block"> {
  if (process.env.ZPL_SKIP_UPDATE_CHECK === "1") return "ok";
  try {
    const cacheFile = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/zpl-mcp-version-check.json`;
    const fs = await import("node:fs/promises");

    // Short cache (1h) — so stuck users retry npm soon after a new major lands.
    let cachedLatest: string | undefined;
    try {
      const cached = JSON.parse(await fs.readFile(cacheFile, "utf-8"));
      if (Date.now() - cached.checkedAt < 60 * 60 * 1000) {
        cachedLatest = cached.latest as string;
      }
    } catch { /* no cache, continue */ }

    let latest = cachedLatest;
    if (!latest) {
      const res = await fetch("https://registry.npmjs.org/zpl-engine-mcp/latest", {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) return "ok"; // npm unreachable — do not block startup
      const body = (await res.json()) as { version?: string };
      if (!body.version) return "ok";
      latest = body.version;
      await fs.writeFile(cacheFile, JSON.stringify({ checkedAt: Date.now(), latest })).catch(() => {});
    }

    const current = getMcpPackageVersion();
    const ord = cmpSemver(current, latest);
    if (ord === null || ord >= 0) return "ok"; // up-to-date or ahead (dev build)

    const pc = parseSemver(current)!;
    const pl = parseSemver(latest)!;

    if (pl.major > pc.major) {
      // HARD BLOCK — major version behind. Likely breaking change or security fix.
      console.error("");
      console.error("┌──────────────────────────────────────────────────────────────┐");
      console.error("│  zpl-engine-mcp: required upgrade                            │");
      console.error("├──────────────────────────────────────────────────────────────┤");
      console.error(`│  You have v${current.padEnd(14)} Latest is v${latest.padEnd(14)}  │`);
      console.error("│  A new MAJOR version is available — upgrade is required.    │");
      console.error("│                                                              │");
      console.error("│  Claude Desktop / Cursor users:                              │");
      console.error('│    Your config should use  "zpl-engine-mcp@latest"          │');
      console.error("│    Restart your MCP client to pick up the new version.      │");
      console.error("│                                                              │");
      console.error("│  Global install users:                                       │");
      console.error("│    npm i -g zpl-engine-mcp@latest                            │");
      console.error("│                                                              │");
      console.error("│  Offline / self-hosted override (not recommended):           │");
      console.error("│    env ZPL_SKIP_UPDATE_CHECK=1                               │");
      console.error("└──────────────────────────────────────────────────────────────┘");
      console.error("");
      return "block";
    }

    // MINOR or PATCH behind — warn but continue.
    const severity = pl.minor > pc.minor ? "new features" : "bug fixes";
    console.error(`\nℹ️  zpl-engine-mcp v${latest} is available (${severity}). You have v${current}.`);
    console.error(`   Update: your config should pin "zpl-engine-mcp@latest". Restart your MCP client.\n`);
    return "ok";
  } catch {
    // Any unexpected error — never block. Version check is best-effort.
    return "ok";
  }
}

async function main() {
  // Blocking version check — if a major version is behind, exit before starting.
  // Non-major versions emit a warning and return "ok" immediately.
  const versionStatus = await checkLatestVersion();
  if (versionStatus === "block") {
    process.exit(1);
  }

  if (!API_KEY) {
    console.error("");
    console.error("┌─────────────────────────────────────────────────────────────┐");
    console.error("│                                                             │");
    console.error("│    Welcome to ZPL Engine MCP — let's get you set up!       │");
    console.error("│                                                             │");
    console.error("│    You need a free API key to use the 63 ZPL tools.        │");
    console.error("│    Free plan: 500 tokens / month. No credit card.          │");
    console.error("│                                                             │");
    console.error("│    1. Get your key (10 seconds, no credit card):           │");
    console.error("│       https://zeropointlogic.io/auth/register              │");
    console.error("│                                                             │");
    console.error("│    2. Add it to your MCP config (Claude Desktop example):  │");
    console.error('│       "env": { "ZPL_API_KEY": "zpl_u_YOUR_KEY_HERE" }      │');
    console.error("│                                                             │");
    console.error("│    3. Restart your MCP client. Done.                       │");
    console.error("│                                                             │");
    console.error("│    Optional — audit-grade mode (default):                  │");
    console.error('│       "ZPL_MODE": "pure"   (AI does not see scores)        │');
    console.error('│       "ZPL_MODE": "coach"  (AI sees scores, can adjust)    │');
    console.error("│                                                             │");
    console.error("│    Questions? https://github.com/cicicalex/engine-mcp      │");
    console.error("│                                                             │");
    console.error("└─────────────────────────────────────────────────────────────┘");
    console.error("");
    process.exit(1);
  }

  // v3.5.0: block service keys up front, before stdio handshake, so Claude
  // Desktop / Cursor / Windsurf users get a clear error in the client log
  // instead of every tool call failing mysteriously.
  if (isServiceKey(API_KEY)) {
    console.error("");
    console.error("┌─────────────────────────────────────────────────────────────┐");
    console.error("│  Service keys (zpl_s_...) are no longer accepted by the    │");
    console.error("│  ZPL MCP (v3.5.0+).                                         │");
    console.error("│                                                             │");
    console.error("│  Service keys bypass plan limits and are server-side only. │");
    console.error("│  MCP clients must use a USER key (zpl_u_...) so usage is   │");
    console.error("│  metered per account.                                       │");
    console.error("│                                                             │");
    console.error("│  Create a user key (free, no card):                         │");
    console.error("│     https://zeropointlogic.io/dashboard/api-keys           │");
    console.error("└─────────────────────────────────────────────────────────────┘");
    console.error("");
    process.exit(1);
  }
  if (!isValidApiKeyFormat(API_KEY)) {
    console.error("");
    console.error("ZPL_API_KEY format invalid. Expected zpl_u_<48 hex> (54 chars).");
    console.error("Create a key: https://zeropointlogic.io/dashboard/api-keys");
    console.error("");
    process.exit(1);
  }
  try {
    getValidatedEngineBaseUrl();
  } catch (err) {
    console.error("Fatal:", (err as Error).message);
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

// Only auto-run when stdin is piped (MCP client connected).
// Skip when running in terminal (Smithery scan, testing, etc.)
if (!process.stdin.isTTY) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
