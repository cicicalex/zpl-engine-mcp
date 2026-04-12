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

// ---------------------------------------------------------------------------
// Configuration from environment
// ---------------------------------------------------------------------------

const API_KEY = process.env.ZPL_API_KEY ?? process.env.ZPL_ENGINE_KEY ?? "";
const ENGINE_URL = process.env.ZPL_ENGINE_URL ?? "https://engine.zeropointlogic.io";

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
  name: "zpl-engine",
  version: "1.0.0",
});

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
      const text = [
        `## ZPL Engine Result`,
        ``,
        `| Metric | Value |`,
        `|--------|-------|`,
        `| **AIN Score** | ${ain}/100 |`,
        `| **Status** | ${result.ain_status} |`,
        `| **Engine Status** | ${result.status} |`,
        `| **P-Output** | ${result.p_output.toFixed(6)} |`,
        `| **Deviation** | ${result.deviation.toFixed(6)} |`,
        `| **Dimension** | ${result.d} |`,
        `| **Bias Input** | ${result.bias.toFixed(4)} |`,
        `| **Samples** | ${result.samples} |`,
        `| **Tokens Used** | ${result.tokens_used} |`,
        `| **Compute Time** | ${result.compute_ms}ms |`,
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

      let text = `## ZPL Sweep (d=${result.d}, ${result.samples} samples)\n\n`;
      text += `| Bias | AIN | P-Output | Deviation | Status |\n`;
      text += `|------|-----|----------|-----------|--------|\n`;

      for (const r of result.results) {
        text += `| ${r.bias.toFixed(2)} | ${Math.round(r.ain * 100)}% | ${r.p_output.toFixed(4)} | ${r.deviation.toFixed(6)} | ${r.status} |\n`;
      }

      text += `\n**Total tokens:** ${result.total_tokens} | **Compute:** ${result.compute_ms}ms`;

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
    domain: z.enum(["finance", "game", "ai", "security", "crypto"]).describe("Domain lens to use"),
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
// Start server
// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
