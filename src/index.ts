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

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

const API_KEY = process.env.ZPL_API_KEY ?? process.env.ZPL_ENGINE_KEY ?? "";

// API key check moved to main() — allows Smithery sandbox scanning without key
const ENGINE_URL = process.env.ZPL_ENGINE_URL ?? "https://engine.zeropointlogic.io";
const DEFAULT_D = Math.max(3, Math.min(100, Number(process.env.ZPL_DEFAULT_D) || 9));
const DEFAULT_SAMPLES = Math.max(100, Math.min(50000, Number(process.env.ZPL_DEFAULT_SAMPLES) || 1000));
const OUTPUT_STYLE = (process.env.ZPL_OUTPUT ?? "detailed") as "detailed" | "compact";
const LANGUAGE = process.env.ZPL_LANGUAGE ?? "en";
const BUDGET_WARN = Number(process.env.ZPL_BUDGET_WARN) || 500;
const SAVE_HISTORY = process.env.ZPL_SAVE_HISTORY !== "false";
const RATE_LIMIT_PER_MIN = Number(process.env.ZPL_RATE_LIMIT) || 60;

// ZPL_MODE (pure/coach) lives in tools/helpers.ts so all tool files can share it.

// Simple rate limiter — prevents accidental token drain
const callLog: number[] = [];
function checkRateLimit(): boolean {
  const now = Date.now();
  // Remove entries older than 1 minute
  while (callLog.length > 0 && callLog[0] < now - 60_000) callLog.shift();
  if (callLog.length >= RATE_LIMIT_PER_MIN) return false;
  callLog.push(now);
  return true;
}

function getClient(): ZPLEngineClient {
  if (!API_KEY) {
    throw new Error(
      "ZPL API key not configured. Set ZPL_API_KEY environment variable.\n" +
      "Get your key at https://zeropointlogic.io/pricing"
    );
  }
  return new ZPLEngineClient(API_KEY, ENGINE_URL);
}

// ---------------------------------------------------------------------------
// MCP Server
// ---------------------------------------------------------------------------

const server = new McpServer({
  name: "ZPL Engine MCP",
  version: "3.3.1",
  description: "Mathematical stability engine. 67 tools (63 unique + 4 backwards-compat aliases). AIN is a STABILITY measurement only — never prediction or advice. v3.3 adds clearer balance-prefixed names, v3.3.1 adds 8 AI Eval tools for model consistency testing. Created by Ciciu Alexandru-Costinel.",
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
    if (!checkRateLimit()) {
      return { content: [{ type: "text" as const, text: `⚠️ Rate limit exceeded (${RATE_LIMIT_PER_MIN}/min). Wait a moment and try again.` }], isError: true };
    }
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
      const client = new ZPLEngineClient("", ENGINE_URL);
      const health = await client.health();

      return {
        content: [{
          type: "text" as const,
          text: `ZPL Engine: **${health.status}** (${health.version})\nURL: ${ENGINE_URL}`,
        }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: `Engine unreachable at ${ENGINE_URL}: ${(err as Error).message}` }],
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
      text += `*Report generated by ZPL Engine MCP v1.0.0*\n`;

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
 * Non-blocking version check — runs at startup, never crashes the server.
 * Caches the result for 24h so we don't hit npm on every run.
 */
async function checkLatestVersion(): Promise<void> {
  try {
    const cacheFile = `${process.env.TMPDIR ?? process.env.TEMP ?? "/tmp"}/zpl-mcp-version-check.json`;
    const fs = await import("node:fs/promises");

    // Skip if cached within 24h
    try {
      const cached = JSON.parse(await fs.readFile(cacheFile, "utf-8"));
      if (Date.now() - cached.checkedAt < 24 * 60 * 60 * 1000) return;
    } catch { /* no cache, continue */ }

    const res = await fetch("https://registry.npmjs.org/zpl-engine-mcp/latest", {
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return;
    const { version: latest } = (await res.json()) as { version: string };

    const current = "3.3.1"; // bumped — keep in sync with package.json
    if (latest && latest !== current) {
      console.error(`\nℹ️  zpl-engine-mcp v${latest} is available (you have v${current}).`);
      console.error(`   Update: npm i -g zpl-engine-mcp@latest\n`);
    }

    // Cache the check
    await fs.writeFile(cacheFile, JSON.stringify({ checkedAt: Date.now(), latest }));
  } catch {
    // Silently ignore — version check must NEVER block the MCP from starting
  }
}

async function main() {
  // Non-blocking — fires in background, doesn't delay startup
  void checkLatestVersion();

  if (!API_KEY) {
    console.error("");
    console.error("┌─────────────────────────────────────────────────────────────┐");
    console.error("│                                                             │");
    console.error("│    Welcome to ZPL Engine MCP — let's get you set up!       │");
    console.error("│                                                             │");
    console.error("│    You need a free API key to use the 63 ZPL tools.        │");
    console.error("│    Free plan: 5,000 tokens / month. No credit card.        │");
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
