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

import { createHash } from "node:crypto";
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
import { loadApiKey } from "./config.js";
import { getValidatedEngineBaseUrl } from "./engine-url.js";
import { getMcpPackageVersion } from "./package-meta.js";
import { ainScale, fmtAin, ainPct } from "./ain-format.js";
import { equilibriumOffset, ZPL_DISCLAIMER, tokenCostTable, getTokenCost } from "./tools/helpers.js";
import { TOOL_COUNT_PHRASE } from "./tool-count.js";
// API key format validation extracted to api-key-format.ts for unit testing.
// v3.7.2: Accepts wizard-issued keys with type prefixes (zpl_u_mcp_, zpl_u_cli_,
// zpl_u_default_). See src/api-key-format.ts for full spec + regex rationale.
import { isValidApiKeyFormat, isServiceKey } from "./api-key-format.js";

// ---------------------------------------------------------------------------
// Configuration from environment / config file
// ---------------------------------------------------------------------------
//
// v3.6.0: API key is loaded asynchronously at main() boot so ~/.zpl/config.toml
// (written by `npx zpl-engine-mcp setup`) takes priority over ZPL_API_KEY env.
// Tool registration still happens at module load, so getClient() reads from
// the module-scoped `API_KEY` that main() populates before stdio transport
// is wired up.
let API_KEY = "";

// API key check moved to main() — allows Smithery sandbox scanning without key
// ZPL_ENGINE_URL validated in getValidatedEngineBaseUrl() (host allowlist, no creds in URL).
const DEFAULT_D = Math.max(3, Math.min(100, Number(process.env.ZPL_DEFAULT_D) || 9));
const DEFAULT_SAMPLES = Math.max(100, Math.min(50000, Number(process.env.ZPL_DEFAULT_SAMPLES) || 1000));
const OUTPUT_STYLE = (process.env.ZPL_OUTPUT ?? "detailed") as "detailed" | "compact";
// ZPL_LANGUAGE removed in v3.7.2 — was dead code (never consumed). i18n
// not yet wired through tool descriptions / ainSignal bands. When implemented,
// reintroduce as `LANG` and pipe through helpers.ts so all tools share it.
const BUDGET_WARN = Number(process.env.ZPL_BUDGET_WARN) || 500;
const SAVE_HISTORY = process.env.ZPL_SAVE_HISTORY !== "false";

// ZPL_MODE (pure/coach) lives in tools/helpers.ts so all tool files can share it.

function getClient(): ZPLEngineClient {
  if (!API_KEY) {
    throw new Error(
      "ZPL API key not configured.\n" +
      "\n" +
      "QUICK SETUP (15 seconds, recommended):\n" +
      "  npx zpl-engine-mcp setup\n" +
      "\n" +
      "This opens your browser so you can:\n" +
      "  1. Create a FREE ZPL account (or sign in if you already have one)\n" +
      "  2. Approve this device\n" +
      "  3. Your API key flows back automatically — no copy-paste\n" +
      "\n" +
      "The wizard then auto-configures Claude Desktop, Cursor and Windsurf\n" +
      "for you. Free plan: 5,000 tokens/month, no credit card required.\n" +
      "\n" +
      "Manual alternative: set ZPL_API_KEY env var to a key from\n" +
      "https://zeropointlogic.io/dashboard/api-keys (requires signup first).\n" +
      "Must be a user key `zpl_u_...` — service keys `zpl_s_...` are rejected."
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
      "QUICK FIX (15 seconds):\n" +
      "  npx zpl-engine-mcp setup\n" +
      "\n" +
      "Or create a user key manually at:\n" +
      "https://zeropointlogic.io/dashboard/api-keys"
    );
  }
  if (!isValidApiKeyFormat(API_KEY)) {
    throw new Error(
      "ZPL_API_KEY format invalid. Expected `zpl_u_<48 hex>` (54 chars total).\n" +
      "\n" +
      "Easiest fix:\n" +
      "  npx zpl-engine-mcp setup\n" +
      "\n" +
      "This regenerates a correctly-formatted key and patches your config.\n" +
      "Or manually: https://zeropointlogic.io/dashboard/api-keys"
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
  description: `Mathematical stability engine. ${TOOL_COUNT_PHRASE}. AIN is a STABILITY measurement only — never prediction or advice. v4.0 ships 21 bug fixes, memory-aware setup, repair/whoami/diagnose commands, and a much friendlier error UX (Cloudflare detection, smoke-test on first install). Built by Zero Point Logic.`,
});

// Register every tool (see src/tool-count.ts for the single declared count)
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

      const ain = ainScale(result.ain);
      // AUDIT 2026-07-30: p_output was withheld here as "IP protection". It
      // was not protecting anything — the engine's HTTP response carries
      // p_output and deviation to every API caller, so the only person it was
      // hidden from was whoever reads this output. The method is what stays
      // secret, and a single output coefficient does not reveal it.
      //
      // p_output is the engine's actual measurement: output balance, 0.500
      // being equilibrium. It leads, because it is what the reading means.
      const text = [
        `## ZPL Engine Result`,
        ``,
        `**Output balance (p_output):** ${result.p_output.toFixed(6)}`,
        `**Distance from 0.500:** ${equilibriumOffset(result.p_output)}`,
        ``,
        `**AIN Score:** ${fmtAin(ain)}/100`,
        `**AIN Status:** ${result.ain_status}`,
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

      // AUDIT 2026-07-30: see zpl_compute above — p_output was withheld under
      // an "IP protection" note that protected nothing, since the HTTP
      // response carries it to every caller regardless. A sweep is where it
      // matters most: it shows where the output balance crosses 0.500, which
      // is the whole point of running one.
      let text = `## ZPL Sweep (d=${result.d})\n\n`;
      text += `| Bias | p_output | From 0.500 | AIN | Stability |\n`;
      text += `|------|----------|------------|-----|--------|\n`;

      for (const r of result.results) {
        const p = typeof r.p_output === "number" ? r.p_output : null;
        text += `| ${r.bias.toFixed(2)} | ${p !== null ? p.toFixed(6) : "n/a"} `
          + `| ${p !== null ? equilibriumOffset(p) : "n/a"} `
          + `| ${ainPct(r.ain)}% | ${r.status} |\n`;
      }

      text += `\n*Total tokens used: ${result.total_tokens}*`;

      return { content: [{ type: "text" as const, text }] };
    } catch (err) {
      return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
    }
  }
);

// ---------------------------------------------------------------------------
// Tool: zpl_matrix — run the method over a matrix the caller supplies
// ---------------------------------------------------------------------------

server.tool(
  "zpl_matrix",
  "Analyse a SPECIFIC binary matrix you provide (NxN, cells 0 or 1, 3<=N<=100). " +
    "Unlike zpl_compute, which takes a dimension and a density and reports on random " +
    "matrices the engine generates, this runs the method over YOUR data and returns what " +
    "each of the four operator families concluded, plus how far they agree. " +
    "Returns no AIN: one matrix is a single observation, so a proportion over it is 0 or 1 " +
    "and would say nothing about balance.",
  {
    matrix: z
      .array(z.array(z.number().int().min(0).max(1)))
      .min(3)
      .max(100)
      .describe("Square binary matrix, 3x3 to 100x100. Rows of 0s and 1s."),
    label: z.string().max(120).optional().describe("Optional name for this matrix, shown in the output"),
  },
  async ({ matrix, label }) => {
    try {
      const client = getClient();
      const result = await client.analyze(matrix);

      const agreement = result.unanimous
        ? `unanimous — all ${result.families.length} families agree`
        : `split — ${result.ones} of ${result.families.length} returned 1`;

      let text = `## ${label ?? "Matrix"} — ${result.n}x${result.n}\n\n`;
      // AUDIT 2026-07-31: the engine was swept over 3..=100. At every even
      // dimension the four family bits for an all-zeros matrix are identical
      // to those for an all-ones matrix, so agreement alone cannot tell a
      // caller their input was uniform - and every paid ceiling except Pro's
      // 25 is even. The engine counts the caller's own cells back now, so a
      // degenerate input says so before the verdict does.
      if (result.degenerate) {
        const all = result.input_ones === 0 ? "0" : "1";
        text += `> **Every cell in this matrix is ${all}.** At even dimensions the families can return the same verdict for an all-0 and an all-1 matrix, so read the agreement below with that in mind.\n\n`;
      } else if (result.n % 2 === 0) {
        // AUDIT 2026-07-31: `degenerate` fires only for a uniform matrix, and
        // that is a narrower warning than the reading needs. Measured over the
        // engine at n = 16, 32, 48, 64 and 100 - every even dimension sold -
        // five of eight distinct test shapes return one identical set of family
        // bits: an all-0 matrix, an all-1 matrix, a checkerboard, a left-half
        // matrix and a top-half matrix. Only two of those five are degenerate.
        //
        // So a caller sending a checkerboard at n=48 got a confident verdict
        // table and nothing telling them a blank matrix produces the same one.
        // At odd dimensions the same sweep separates seven of the eight.
        //
        // Every paid ceiling except Pro's 25 is even: 16, 32, 48, 64, 100.
        // This is the reading customers pay most for.
        // What the odd alternative actually costs. Every sold even ceiling sits
        // at the TOP of a cost band - 16, 32, 48 and 64 are all band edges - so
        // n+1 always crosses into the next band and costs 3-4x more. Saying
        // "just use n+1" without that would be advice priced at someone else's
        // expense. And at 100 there is no odd option at all: the engine rejects
        // d > 100, so the largest legal odd dimension is 99, which is smaller.
        const here = getTokenCost(result.n);
        const odd = result.n < 100 ? getTokenCost(result.n + 1) : null;
        const advice = odd === null
          ? `100 is the largest dimension the engine accepts, so there is no odd dimension above it — ` +
            `99 discriminates but is smaller than what you sent.`
          : `Re-running at ${result.n + 1} discriminates, but it crosses a cost band: ` +
            `${here} tokens becomes ${odd}.`;

        text += `> **${result.n} is an even dimension, and even dimensions discriminate less.** ` +
          `Measured across the sold range, five structurally different matrices — uniform, ` +
          `checkerboard, and half-filled by row or by column — return one identical set of ` +
          `family bits at even n, where an odd dimension tells seven of eight apart. ` +
          `The verdict below may not be specific to your arrangement. ${advice}\n\n`;
      }
      if (result.input_ones !== undefined && result.cells !== undefined) {
        const pct = ((result.input_ones / result.cells) * 100).toFixed(1);
        text += `**Your matrix:** ${result.input_ones} of ${result.cells} cells set (${pct}%)\n\n`;
      }
      text += `**Agreement:** ${agreement}\n\n`;
      text += `| Family | Bit | Tie-broken |\n|--------|-----|------------|\n`;
      for (const f of result.families) {
        // A tie means the fold found no majority and the centre decided it.
        // Saying so matters: it is a weaker claim than a confident bit.
        text += `| ${f.family} | ${f.bit} | ${f.tie_broken ? "yes — no majority, centre decided" : "no"} |\n`;
      }
      text += `\n*Tokens used: ${result.tokens_used}*\n`;
      text += `\n${ZPL_DISCLAIMER}\n`;

      // AUDIT 2026-07-31: this was the only tool that reached the engine and
      // wrote nothing to history. Around 45 tools across every domain module
      // call addHistory, so the omission was not a house style - it was the one
      // tool carrying the caller's own data leaving no trace of having run.
      //
      // What is recorded is the verdict and the shape, plus a digest of the
      // matrix - never the matrix. A digest is enough to prove later that a
      // given input produced a given verdict, which is the whole point of a
      // deterministic engine, and it keeps up to 10,000 cells of somebody's
      // data out of history.json on disk. Storing the input would have made
      // the audit trail itself the largest thing this package holds.
      //
      // ain_scores is {} because zpl_matrix returns no AIN, for the reason its
      // own description gives: one matrix is a single observation. The field is
      // required by HistoryEntry, so empty is the honest value, not a zero.
      addHistory({
        tool: "zpl_matrix",
        results: {
          label: label ?? null,
          n: result.n,
          matrix_sha256: createHash("sha256").update(JSON.stringify(matrix)).digest("hex"),
          unanimous: result.unanimous,
          ones: result.ones,
          families: result.families.map((f) => ({ family: f.family, bit: f.bit, tie_broken: f.tie_broken })),
          input_ones: result.input_ones,
          cells: result.cells,
          degenerate: result.degenerate,
          tokens_used: result.tokens_used,
        },
        ain_scores: {},
      });

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

      // AUDIT 2026-07-31: this line read "Token cost per compute: d\u00B2 + d
      // (e.g., d=9 costs 90 tokens)". Nothing charges d\u00B2+d \u2014 not the engine,
      // not the website, not this package's own helper. A d=9 call costs 2.
      // Printed from getTokenCost now, so the quoted prices are the charged
      // ones by construction.
      text += `\n**Token cost per compute** \u2014 step bands, not a formula:\n\n`;
      text += `${tokenCostTable()}\n`;
      text += `\nA sweep runs 19 bias steps and costs 19x one compute at the same d.\n`;
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
        .map(([k, v]) => `${k}: ${typeof v === "number" ? fmtAin(v) : v}`)
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
          const lastAin = item.last_ain !== undefined ? `${fmtAin(item.last_ain)}/100` : "—";
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
            const ain = ainScale(result.ain);
            const prev = item.last_ain;
            const delta = prev !== undefined ? ain - prev : null;
            const deltaStr = delta !== null ? (delta > 0 ? ` (+${fmtAin(delta)})` : delta < 0 ? ` (${fmtAin(delta)})` : ` (=)`) : " (first check)";

            updateWatchlistItem(item.id, ain);
            text += `- **${item.name}**: AIN ${fmtAin(ain)}/100${deltaStr} — ${result.ain_status}\n`;
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
      text += `**AIN Score:** ${fmtAin(interpretation.ain)}/100\n`;
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
            text += `| d=${testD} | ${ainPct(r.ain)}% | ${r.ain_status} | ${r.tokens_used} |\n`;
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
  // v4.1.0: install proxy dispatcher BEFORE any module/code that uses fetch.
  // EnvHttpProxyAgent reads HTTP_PROXY/HTTPS_PROXY/NO_PROXY env vars at this
  // call. If we install later, the first fetch (e.g. update-check, setup
  // device flow, eval-client) would already have been issued direct, defeating
  // the corporate-proxy support. Idempotent + non-fatal on failure (falls
  // back to direct connections with a stderr warning).
  const { installProxyDispatcher } = await import("./proxy.js");
  installProxyDispatcher();

  // v3.6.0: `npx zpl-engine-mcp setup` runs the device-flow wizard and exits.
  // Must be the very first thing main() does — before the version check so users
  // with an outdated install can still *run* setup to get a fresh key flow
  // (setup itself doesn't call the engine, only zeropointlogic.io).
  // v3.7.2: subcommands dispatch table.
  //   --help / -h  — print usage and exit 0 (POSIX UX expectation).
  //   --version / -v — print package version and exit 0.
  //   setup   — interactive device-flow auth (now memory-aware: detects existing
  //             config and asks before re-logging in. `--force` bypasses).
  //   repair  — wipe local config + remove zpl-engine-mcp entries from clients.
  //             `--yes` skips confirmation. Use when install is in confused state.
  //   whoami  — print which account this install is logged into. No-op safe.
  const cmd = process.argv[2];
  if (cmd === "--help" || cmd === "-h" || cmd === "help") {
    process.stdout.write(
      `zpl-engine-mcp v${getMcpPackageVersion()} — ZPL Engine Model Context Protocol server\n` +
      `\n` +
      `Usage:\n` +
      `  npx zpl-engine-mcp                      Start the MCP server (called automatically by Claude Desktop / Cursor / Windsurf via MCP config)\n` +
      `  npx zpl-engine-mcp setup [--force]      Interactive device-flow login. --force re-logs even if a config exists\n` +
      `  npx zpl-engine-mcp whoami               Show which account this install is logged into\n` +
      `  npx zpl-engine-mcp repair [--yes|-y]    Wipe local config + remove entries from MCP client configs (Claude / Cursor / Windsurf)\n` +
      `  npx zpl-engine-mcp --version            Print version\n` +
      `  npx zpl-engine-mcp --help               This screen\n` +
      `\n` +
      `Docs:    https://github.com/cicicalex/zpl-engine-mcp\n` +
      `Issues:  https://github.com/cicicalex/zpl-engine-mcp/issues\n` +
      `Account: https://zeropointlogic.io/dashboard/api-keys\n`,
    );
    process.exit(0);
  }
  if (cmd === "--version" || cmd === "-v" || cmd === "version") {
    process.stdout.write(`${getMcpPackageVersion()}\n`);
    process.exit(0);
  }
  if (cmd === "setup") {
    const { runSetup } = await import("./setup.js");
    const force = process.argv.includes("--force");
    await runSetup({ force });
    process.exit(0);
  }
  if (cmd === "repair") {
    const { runRepair } = await import("./setup.js");
    const yes = process.argv.includes("--yes") || process.argv.includes("-y");
    await runRepair({ yes });
    process.exit(0);
  }
  if (cmd === "whoami") {
    const { runWhoami } = await import("./setup.js");
    await runWhoami();
    process.exit(0);
  }

  // Blocking version check — if a major version is behind, exit before starting.
  // Non-major versions emit a warning and return "ok" immediately.
  const versionStatus = await checkLatestVersion();
  if (versionStatus === "block") {
    process.exit(1);
  }

  // v3.6.0: resolve API key from ~/.zpl/config.toml first, env var second.
  const loaded = await loadApiKey();
  API_KEY = loaded.key;

  if (!API_KEY) {
    // Friendly first-run message. First-time users are MOST of the audience
    // (~1300 npm downloads, only a fraction have accounts yet) so spell out
    // the create-account step explicitly — the wizard handles all of it.
    // All writes go to stderr — stdout is reserved for the MCP JSON-RPC stream.
    console.error("");
    console.error(`┌──────────────────────────────────────────────────────────────┐`);
    console.error(`│  ZPL MCP v${getMcpPackageVersion().padEnd(8)} — first-time setup                      │`);
    console.error(`├──────────────────────────────────────────────────────────────┤`);
    console.error(`│                                                              │`);
    console.error(`│  Run this in your terminal (NOT inside Claude/Cursor):      │`);
    console.error(`│                                                              │`);
    console.error(`│     npx zpl-engine-mcp setup                                 │`);
    console.error(`│                                                              │`);
    console.error(`│  The wizard opens your browser so you can:                  │`);
    console.error(`│    1. Create a free ZPL account (no credit card)            │`);
    console.error(`│    2. Approve this device                                    │`);
    console.error(`│    3. Your API key flows back — no copy-paste               │`);
    console.error(`│                                                              │`);
    console.error(`│  Free plan: 5,000 tokens/month.                              │`);
    console.error(`│  Docs: https://zeropointlogic.io/docs/mcp-setup             │`);
    console.error(`│                                                              │`);
    console.error(`│  Then restart Claude Desktop / Cursor to pick up the key.   │`);
    console.error(`│                                                              │`);
    console.error(`└──────────────────────────────────────────────────────────────┘`);
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

// Auto-run when:
//   - stdin is piped (MCP client connected over stdio), OR
//   - the user invoked `zpl-engine-mcp setup` explicitly from a TTY.
// Skip otherwise (Smithery scan, module import for testing, etc.)
if (!process.stdin.isTTY || ["setup", "repair", "whoami"].includes(process.argv[2])) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
