/**
 * Meta tools — 4 utility tools for batch, export, usage, and account info.
 */

import { z } from "zod";
import type { Server } from "./helpers.js";
import { clampD, ainSignal } from "./helpers.js";
import { ZPLEngineClient } from "../engine-client.js";
import { getHistory, addHistory } from "../store.js";

/** Plan details — MUST match constants.ts on ZPL Main website */
const PLAN_INFO: Record<string, { price: string; annualPrice: string; maxD: number; tokens: string; rate: string; keys: number }> = {
  free:          { price: "Free",     annualPrice: "—",        maxD: 9,   tokens: "5,000",      rate: "60/min", keys: 1 },
  basic:         { price: "$10/mo",   annualPrice: "$8/mo",    maxD: 16,  tokens: "10,000",     rate: "60/min", keys: 1 },
  pro:           { price: "$29/mo",   annualPrice: "$23/mo",   maxD: 25,  tokens: "50,000",     rate: "60/min", keys: 3 },
  gamepro:       { price: "$69/mo",   annualPrice: "$55/mo",   maxD: 32,  tokens: "150,000",    rate: "60/min", keys: 5 },
  studio:        { price: "$149/mo",  annualPrice: "$119/mo",  maxD: 48,  tokens: "500,000",    rate: "60/min", keys: 10 },
  agent:         { price: "$199/mo",  annualPrice: "$159/mo",  maxD: 48,  tokens: "2,000,000",  rate: "60/min", keys: 15 },
  enterprise:    { price: "$499/mo",  annualPrice: "$399/mo",  maxD: 64,  tokens: "10,000,000", rate: "60/min", keys: 25 },
  enterprise_xl: { price: "$999/mo",  annualPrice: "$799/mo",  maxD: 100, tokens: "50,000,000", rate: "60/min", keys: 50 },
};

/** Token cost per dimension — MUST match getTokenCost() on ZPL Main website */
function getTokenCost(d: number): number {
  if (d <= 5) return 1;
  if (d <= 9) return 2;
  if (d <= 16) return 5;
  if (d <= 25) return 15;
  if (d <= 32) return 40;
  if (d <= 48) return 150;
  if (d <= 64) return 500;
  return 2000;
}

export function registerMetaTools(server: Server, getClient: () => ZPLEngineClient) {

  // --- zpl_batch: run multiple computations at once ---
  server.tool(
    "zpl_batch",
    "Run multiple ZPL Engine computations in a single call. Provide an array of (d, bias) pairs. Returns all AIN scores. Efficient for bulk analysis. Max 50 jobs per call.",
    {
      jobs: z.array(z.object({
        label: z.string().max(200).describe("Label for this computation"),
        d: z.number().int().min(3).max(100),
        bias: z.number().min(0).max(1),
        samples: z.number().int().min(100).max(50000).optional(),
      })).min(1).max(50).describe("Computation jobs"),
    },
    async ({ jobs }) => {
      try {
        const client = getClient();
        let text = `## Batch Results (${jobs.length} jobs)\n\n`;
        text += `| # | Label | d | Bias | AIN | Status | Tokens |\n`;
        text += `|---|-------|---|------|-----|--------|--------|\n`;

        let totalTokens = 0;
        const scores: Record<string, number> = {};

        for (let i = 0; i < jobs.length; i++) {
          const job = jobs[i];
          try {
            const result = await client.compute({
              d: job.d,
              bias: job.bias,
              samples: job.samples ?? 1000,
            });
            const ain = Math.round(result.ain * 100);
            totalTokens += result.tokens_used;
            scores[job.label] = ain;
            text += `| ${i + 1} | ${job.label} | ${job.d} | ${job.bias.toFixed(2)} | ${ain}/100 | ${result.ain_status} | ${result.tokens_used} |\n`;
          } catch (err) {
            text += `| ${i + 1} | ${job.label} | ${job.d} | ${job.bias.toFixed(2)} | ERROR | ${(err as Error).message.slice(0, 30)} | 0 |\n`;
          }
        }

        text += `\n**Total tokens:** ${totalTokens}`;
        addHistory({ tool: "zpl_batch", results: { job_count: jobs.length }, ain_scores: scores });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_export: export history as structured data ---
  server.tool(
    "zpl_export",
    "Export ZPL analysis history as structured JSON or CSV-formatted text. Useful for creating reports, importing into spreadsheets, or archiving past analyses.",
    {
      format: z.enum(["json", "csv"]).default("csv").describe("Export format"),
      limit: z.number().int().min(1).max(500).optional().describe("Number of entries to export (default: 50)"),
    },
    async ({ format, limit: rawLimit }) => {
      const limit = rawLimit ?? 50;
      const history = getHistory(limit);
      if (history.length === 0) {
        return { content: [{ type: "text" as const, text: "No history to export. Run some analyses first (zpl_ask, zpl_compute, zpl_analyze, etc.)." }] };
      }

      if (format === "json") {
        return { content: [{ type: "text" as const, text: "```json\n" + JSON.stringify(history, null, 2) + "\n```" }] };
      }

      let csv = "id,timestamp,tool,question,domain,ain_scores\n";
      for (const h of history) {
        const scores = Object.entries(h.ain_scores).map(([k, v]) => `${k}:${v}`).join(";");
        csv += `${h.id},${h.timestamp},${h.tool},"${(h.question ?? "").replace(/"/g, '""')}",${h.domain ?? ""},${scores}\n`;
      }

      return { content: [{ type: "text" as const, text: "```csv\n" + csv + "```\n\n" + `Exported ${history.length} entries.` }] };
    }
  );

  // --- zpl_usage: full account + usage dashboard ---
  server.tool(
    "zpl_usage",
    "Full account dashboard — shows your current plan, token usage this month, remaining budget, rate limits, max dimension allowed, monthly reset date, and what operations you can still do. Warns if tokens are running low.",
    {
      plan: z.enum(["free", "basic", "pro", "gamepro", "studio", "agent", "enterprise", "enterprise_xl"]).optional().default("free").describe("Your current plan (check zeropointlogic.io/dashboard)"),
    },
    async ({ plan }) => {
      const history = getHistory(500);
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
      const daysLeft = Math.ceil((monthEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

      const info = PLAN_INFO[plan] ?? PLAN_INFO.free;
      const monthlyLimit = Number(info.tokens.replace(/,/g, ""));

      // Count from local history
      let monthTokens = 0;
      let monthOps = 0;
      let allTimeOps = history.length;

      for (const h of history) {
        if (new Date(h.timestamp) >= monthStart) {
          monthOps++;
          const results = h.results as Record<string, unknown>;
          if (typeof results.totalTokens === "number") monthTokens += results.totalTokens;
        }
      }

      const remaining = Math.max(0, monthlyLimit - monthTokens);
      const budgetWarn = Number(process.env.ZPL_BUDGET_WARN) || 500;
      const isLow = remaining <= budgetWarn;

      let text = `## ZPL Account Dashboard\n\n`;

      // Plan info
      text += `### Your Plan: **${plan.toUpperCase()}** (${info.price})\n\n`;
      text += `| Setting | Value |\n|---------|-------|\n`;
      text += `| Plan | ${plan} (${info.price}) |\n`;
      text += `| Annual Price | ${info.annualPrice} (save 20%) |\n`;
      text += `| Max Dimension | d=${info.maxD} |\n`;
      text += `| Rate Limit | ${info.rate} |\n`;
      text += `| API Keys Allowed | ${info.keys} |\n`;
      text += `| Monthly Tokens | ${info.tokens} |\n`;

      // Usage
      text += `\n### This Month\n\n`;
      text += `| Metric | Value |\n|--------|-------|\n`;
      text += `| Operations | ${monthOps} |\n`;
      text += `| Tokens Used (est.) | ~${monthTokens.toLocaleString()} |\n`;
      text += `| Tokens Remaining | ~${remaining.toLocaleString()} |\n`;
      text += `| Days Until Reset | ${daysLeft} (resets ${monthEnd.toLocaleDateString()}) |\n`;
      text += `| All-time Operations | ${allTimeOps} |\n`;

      // Warning
      if (isLow) {
        text += `\n**WARNING: Low token budget!** Only ~${remaining.toLocaleString()} tokens remaining.\n`;
        text += `**Options:**\n`;
        text += `- Upgrade plan: https://zeropointlogic.io/pricing\n`;
        text += `- Buy token pack (one-time, never expire): https://zeropointlogic.io/dashboard/billing\n`;
        text += `\n| Token Pack | Price | Per Token |\n|------------|-------|-----------|\n`;
        text += `| 10K | $3 | $0.0003 |\n`;
        text += `| 50K | $10 | $0.0002 |\n`;
        text += `| 250K | $40 | $0.00016 |\n`;
        text += `| 1M | $120 | $0.00012 |\n`;
        text += `| 5M | $450 | $0.00009 |\n`;
        text += `| 20M | $1,500 | $0.000075 |\n`;
      }

      // What you can do
      text += `\n### Remaining Budget Breakdown\n\n`;
      text += `| Operation | Cost | Available |\n|-----------|------|-----------|\n`;

      const ops = [
        { name: "Quick compute (d=3–5)", cost: getTokenCost(3) },
        { name: "Standard compute (d=6–9)", cost: getTokenCost(9) },
      ];
      if (info.maxD >= 16) ops.push({ name: "Complex compute (d=10–16)", cost: getTokenCost(16) });
      if (info.maxD >= 25) ops.push({ name: "Deep compute (d=17–25)", cost: getTokenCost(25) });
      if (info.maxD >= 32) ops.push({ name: "GamePro compute (d=26–32)", cost: getTokenCost(32) });
      if (info.maxD >= 48) ops.push({ name: "Studio compute (d=33–48)", cost: getTokenCost(48) });
      if (info.maxD >= 64) ops.push({ name: "Enterprise compute (d=49–64)", cost: getTokenCost(64) });
      ops.push({ name: "Sweep (d=9, 19 steps)", cost: getTokenCost(9) * 19 });

      for (const op of ops) {
        const count = Math.floor(remaining / op.cost);
        text += `| ${op.name} | ${op.cost} tokens | ${count}x |\n`;
      }

      // Plan comparison hint
      if (plan === "free" || plan === "basic") {
        text += `\n### Upgrade?\n`;
        text += `| Plan | Monthly | Annual (save 20%) | Tokens | Max D |\n|------|---------|-------------------|--------|-------|\n`;
        text += `| Basic | $10/mo | $8/mo ($96/yr) | 10,000 | d=16 |\n`;
        text += `| Pro | $29/mo | $23/mo ($276/yr) | 50,000 | d=25 |\n`;
        text += `| GamePro | $69/mo | $55/mo ($660/yr) | 150,000 | d=32 |\n`;
        text += `\nUpgrade: https://zeropointlogic.io/pricing\n`;
      }

      text += `\n---\n*Created by Ciciu Alexandru-Costinel — Zero Point Logic | engine.zeropointlogic.io*\n`;
      text += `*Token tracking estimated from local history. Exact usage at zeropointlogic.io/dashboard*`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // --- zpl_account: API key status and validation ---
  server.tool(
    "zpl_account",
    "Check your API key status and engine connection. Verifies the key is valid, shows key type (user/service), and confirms engine is reachable. Use this to troubleshoot connection issues or verify your setup is correct.",
    {},
    async () => {
      const apiKey = process.env.ZPL_API_KEY ?? "";
      const engineUrl = process.env.ZPL_ENGINE_URL ?? "https://engine.zeropointlogic.io";

      let text = `## ZPL Account Status\n\n`;

      // Key check
      if (!apiKey) {
        text += `**API Key:** NOT SET\n\n`;
        text += `You need an API key to use ZPL Engine tools.\n`;
        text += `1. Create account: https://zeropointlogic.io/auth/register\n`;
        text += `2. Get API key: https://zeropointlogic.io/dashboard/api-keys\n`;
        text += `3. Add to MCP config: \`"ZPL_API_KEY": "zpl_u_your_key_here"\`\n`;
        text += `4. Restart Claude\n`;
        return { content: [{ type: "text" as const, text }] };
      }

      const keyType = apiKey.startsWith("zpl_s_") ? "Service" : apiKey.startsWith("zpl_u_") ? "User" : "Unknown";
      const keyPrefix = apiKey.slice(0, 12) + "...";

      text += `| Setting | Value |\n|---------|-------|\n`;
      text += `| API Key | \`${keyPrefix}\` |\n`;
      text += `| Key Type | ${keyType} |\n`;
      text += `| Engine URL | ${engineUrl} |\n`;

      // Health check
      try {
        const client = new (await import("../engine-client.js")).ZPLEngineClient("", engineUrl);
        const health = await client.health();
        text += `| Engine Status | **${health.status}** |\n`;
        text += `| Engine Version | ${health.version} |\n`;
      } catch {
        text += `| Engine Status | **OFFLINE** |\n`;
        text += `\n**Engine unreachable at ${engineUrl}**. Check your internet or ZPL_ENGINE_URL.\n`;
      }

      // Test key validity with minimal compute
      try {
        const client = new (await import("../engine-client.js")).ZPLEngineClient(apiKey, engineUrl);
        const result = await client.compute({ d: 3, bias: 0.5, samples: 100 });
        text += `| Key Valid | **YES** |\n`;
        text += `| Test AIN | ${Math.round(result.ain * 100)}/100 |\n`;
        text += `\n**Everything works!** Your API key is valid and the engine is responding.\n`;
      } catch (err) {
        const msg = (err as Error).message;
        text += `| Key Valid | **NO** |\n`;
        text += `| Error | ${msg} |\n`;

        if (msg.includes("403")) {
          text += `\n**API key rejected.** Possible causes:\n`;
          text += `- Key was revoked or expired\n`;
          text += `- Key doesn't exist in engine database\n`;
          text += `- Token limit exceeded for this month\n`;
          text += `\nGenerate a new key: https://zeropointlogic.io/dashboard/api-keys\n`;
        } else if (msg.includes("401")) {
          text += `\n**Invalid key format.** Make sure your key starts with \`zpl_u_\` or \`zpl_s_\`.\n`;
        }
      }

      text += `\n---\n*ZPL Engine MCP v2.1.0 — by Ciciu Alexandru-Costinel, Zero Point Logic*`;

      return { content: [{ type: "text" as const, text }] };
    }
  );
}
