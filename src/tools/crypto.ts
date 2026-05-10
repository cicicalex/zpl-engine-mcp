/**
 * Crypto/Blockchain tools — 4 tools for on-chain and DeFi analysis.
 */

import { z } from "zod";
import type { Server } from "./helpers.js";
import { concentrationBias, distributionBias, varianceBias, clampD } from "./helpers.js";
import { ZPLEngineClient } from "../engine-client.js";
import { addHistory } from "../store.js";

export function registerCryptoTools(server: Server, getClient: () => ZPLEngineClient) {

  // --- zpl_whale_check: whale concentration ---
  server.tool(
    "zpl_whale_check",
    "Check token holder concentration (whale risk). Provide top holder percentages. Returns decentralization AIN score — low score means whales dominate.",
    {
      holders: z.array(z.object({
        label: z.string().max(100).optional().describe("Holder label (e.g. 'Top 1', 'Binance', 'Unknown wallet')"),
        percentage: z.number().min(0).max(100).describe("% of total supply held"),
      })).min(2).max(50).describe("Top holders with supply %"),
      token: z.string().max(100).optional().describe("Token name"),
      total_holders: z.number().optional().describe("Total number of holders (for context)"),
    },
    async ({ holders, token, total_holders }) => {
      try {
        const client = getClient();
        const pcts = holders.map((h) => h.percentage);
        const d = clampD(pcts.length);
        const bias = concentrationBias(pcts);
        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);
        const label = token ?? "Token";

        const topTotal = pcts.reduce((s, v) => s + v, 0);
        let text = `## ${label} Whale Check — AIN ${ain}/100\n\n`;
        text += `**Top ${holders.length} holders control ${topTotal.toFixed(1)}% of supply**\n`;
        if (total_holders) text += `**Total holders:** ${total_holders.toLocaleString()}\n`;
        text += `\n| Holder | Share |\n|--------|-------|\n`;
        for (const h of holders) {
          text += `| ${h.label ?? "Wallet"} | ${h.percentage.toFixed(2)}% |\n`;
        }

        if (ain >= 70) text += `\n**Verdict:** Well-distributed. Low whale risk. Healthy decentralization.\n`;
        else if (ain >= 40) text += `\n**Verdict:** Moderate concentration. A few wallets hold significant supply. Watch for whale dumps.\n`;
        else text += `\n**Verdict:** High whale risk! Top holders can crash the price. Rug pull risk elevated.\n`;

        text += `**Tokens:** ${result.tokens_used}`;
        addHistory({ tool: "zpl_whale_check", domain: "crypto", results: { token, topTotal, tokens_used: result.tokens_used }, ain_scores: { [label]: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_defi_risk: DeFi protocol risk ---
  server.tool(
    "zpl_defi_risk",
    "Analyze DeFi protocol risk by scoring multiple risk factors. Covers smart contract, economic, governance, and oracle risks.",
    {
      protocol: z.string().max(200).describe("Protocol name"),
      factors: z.array(z.object({
        name: z.string().max(100).describe("Risk factor (e.g. 'Smart Contract', 'Oracle', 'Governance', 'Liquidity')"),
        score: z.number().min(0).max(10).describe("Risk level 0 (safe) to 10 (dangerous)"),
      })).min(3).max(15).describe("Risk factors"),
      tvl: z.number().optional().describe("Optional: Total Value Locked in $"),
    },
    async ({ protocol, factors, tvl }) => {
      try {
        const client = getClient();
        const scores = factors.map((f) => f.score);
        const d = clampD(scores.length);
        const bias = varianceBias(scores, 10);
        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);

        let text = `## ${protocol} DeFi Risk — AIN ${ain}/100\n\n`;
        if (tvl) text += `**TVL:** $${(tvl / 1e9).toFixed(2)}B\n\n`;
        text += `| Risk Factor | Score | Level |\n|-------------|-------|-------|\n`;
        const sorted = [...factors].sort((a, b) => b.score - a.score);
        for (const f of sorted) {
          const level = f.score >= 8 ? "CRITICAL" : f.score >= 6 ? "HIGH" : f.score >= 4 ? "MEDIUM" : "LOW";
          text += `| ${f.name} | ${f.score}/10 | ${level} |\n`;
        }

        const avgRisk = scores.reduce((s, v) => s + v, 0) / scores.length;
        text += `\n**Avg risk:** ${avgRisk.toFixed(1)}/10 | **Biggest risk:** ${sorted[0].name} (${sorted[0].score}/10)\n`;
        text += `**Tokens:** ${result.tokens_used}`;

        addHistory({ tool: "zpl_defi_risk", domain: "crypto", results: { protocol, avgRisk, tokens_used: result.tokens_used }, ain_scores: { [protocol]: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_liquidity: liquidity pool balance ---
  server.tool(
    "zpl_liquidity",
    "Analyze liquidity pool balance. Provide pool token amounts/values. Checks if the pool is balanced or if impermanent loss risk is high.",
    {
      pools: z.array(z.object({
        name: z.string().max(100).describe("Pool name (e.g. 'ETH/USDC')"),
        token_a_value: z.number().describe("Value of token A in pool ($)"),
        token_b_value: z.number().describe("Value of token B in pool ($)"),
      })).min(1).max(20).describe("Liquidity pools"),
    },
    async ({ pools }) => {
      try {
        const client = getClient();
        const ratios = pools.map((p) => {
          const total = p.token_a_value + p.token_b_value;
          return total > 0 ? p.token_a_value / total : 0.5;
        });
        const deviations = ratios.map((r) => Math.abs(r - 0.5) * 2); // 0 = perfect 50/50, 1 = all one side
        const d = clampD(pools.length * 2);
        const avgDev = deviations.reduce((s, v) => s + v, 0) / deviations.length;
        const bias = Math.min(1, Math.max(0, avgDev));

        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);

        // v3.7.2: align table & verdict — categorize pools first so the verdict
        // can cite the actual table contents (e.g. "2 of 5 IMBALANCED") instead
        // of just paraphrasing the aggregate AIN.
        const rows = pools.map((p, i) => {
          const total = p.token_a_value + p.token_b_value;
          const pctA = total > 0 ? Math.round((p.token_a_value / total) * 100) : 50;
          const dev = deviations[i];
          const balance = dev < 0.1 ? "BALANCED" : dev < 0.3 ? "SLIGHT" : "IMBALANCED";
          return { name: p.name, a: p.token_a_value, b: p.token_b_value, pctA, balance };
        });
        const counts = {
          balanced:   rows.filter((r) => r.balance === "BALANCED").length,
          slight:     rows.filter((r) => r.balance === "SLIGHT").length,
          imbalanced: rows.filter((r) => r.balance === "IMBALANCED").length,
        };

        let text = `## Liquidity Analysis — AIN ${ain}/100\n\n`;
        text += `| Pool | Token A | Token B | Ratio | Balance |\n`;
        text += `|------|---------|---------|-------|---------|\n`;
        for (const r of rows) {
          text += `| ${r.name} | $${r.a.toLocaleString()} | $${r.b.toLocaleString()} | ${r.pctA}/${100 - r.pctA} | ${r.balance} |\n`;
        }

        // Verdict cites the table totals so display + summary stay consistent.
        text += `\n**Verdict:** `;
        text += `${counts.balanced} of ${rows.length} pools BALANCED`;
        if (counts.slight > 0) text += `, ${counts.slight} SLIGHT`;
        if (counts.imbalanced > 0) text += `, ${counts.imbalanced} IMBALANCED`;
        text += `. Aggregate AIN ${ain}/100 — `;
        if (ain >= 70) text += `pools are well-balanced overall. Low impermanent loss risk.\n`;
        else if (ain >= 40) text += `some imbalance present. Monitor for impermanent loss.\n`;
        else text += `significant imbalance. High impermanent loss risk — consider rebalancing.\n`;

        text += `\n**Tokens:** ${result.tokens_used}`;
        // v3.7.2: persist tokens_used so estimateOpTokens reflects reality.
        addHistory({
          tool: "zpl_liquidity",
          domain: "crypto",
          results: { pools: pools.map((p) => p.name), tokens_used: result.tokens_used, counts },
          ain_scores: { liquidity: ain },
        });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_tokenomics: token supply fairness ---
  server.tool(
    "zpl_tokenomics",
    "Analyze tokenomics fairness. Provide token allocation breakdown (team, investors, community, treasury, etc.). Checks if distribution is fair or insider-heavy.",
    {
      allocations: z.array(z.object({
        category: z.string().max(100).describe("Allocation category (Team, Investors, Community, Treasury, etc.)"),
        percentage: z.number().min(0).max(100).describe("% of total supply"),
        vesting_months: z.number().optional().describe("Vesting period in months (0 = fully unlocked)"),
      })).min(2).max(15).describe("Token allocation breakdown"),
      token: z.string().optional(),
    },
    async ({ allocations, token }) => {
      try {
        const client = getClient();
        const pcts = allocations.map((a) => a.percentage);
        const d = clampD(pcts.length);
        const bias = concentrationBias(pcts);
        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);
        const label = token ?? "Token";

        let text = `## ${label} Tokenomics — AIN ${ain}/100\n\n`;
        text += `| Category | % Supply | ${allocations[0].vesting_months !== undefined ? "Vesting |" : ""}\n`;
        text += `|----------|----------|${allocations[0].vesting_months !== undefined ? "---------|" : ""}\n`;
        for (const a of allocations) {
          text += `| ${a.category} | ${a.percentage}% |`;
          if (a.vesting_months !== undefined) text += ` ${a.vesting_months === 0 ? "None" : `${a.vesting_months}mo`} |`;
          text += `\n`;
        }

        const insiderPct = allocations
          .filter((a) => ["team", "investors", "advisors", "founders"].some((k) => a.category.toLowerCase().includes(k)))
          .reduce((s, a) => s + a.percentage, 0);
        const communityPct = allocations
          .filter((a) => ["community", "public", "airdrop", "ecosystem", "rewards"].some((k) => a.category.toLowerCase().includes(k)))
          .reduce((s, a) => s + a.percentage, 0);

        text += `\n**Insider allocation:** ${insiderPct.toFixed(1)}% | **Community:** ${communityPct.toFixed(1)}%\n`;

        if (ain >= 65) text += `**Verdict:** Fair distribution. Community has meaningful ownership.\n`;
        else if (ain >= 35) text += `**Verdict:** Moderately concentrated. Insiders hold significant share — check vesting.\n`;
        else text += `**Verdict:** Insider-heavy. High concentration risk. Dump potential when vesting unlocks.\n`;

        text += `**Tokens:** ${result.tokens_used}`;
        addHistory({ tool: "zpl_tokenomics", domain: "crypto", results: { token, insiderPct, communityPct, tokens_used: result.tokens_used }, ain_scores: { [label]: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );
}

