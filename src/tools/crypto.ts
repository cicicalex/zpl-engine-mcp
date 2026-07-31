/**
 * Crypto/Blockchain tools — 4 tools for on-chain and DeFi analysis.
 */

import { z } from "zod";
import type { Server } from "./helpers.js";
import { concentrationBias, distributionBias, varianceBias, clampD, whaleConcentrationBand, insiderShareBand } from "./helpers.js";
import { ZPLEngineClient } from "../engine-client.js";
import { addHistory } from "../store.js";
import { ainScale, fmtAin } from "../ain-format.js";

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
        const ain = ainScale(result.ain);
        const label = token ?? "Token";

        // AUDIT 2026-07-31: measured against the live engine, before:
        //
        //   top 5 hold   5% of supply -> "High whale risk! Rug pull risk elevated."
        //   top 5 hold 100% of supply -> "High whale risk!"
        //   top 5 hold  51%, one at 40% -> "Well-distributed. Low whale risk.
        //                                   Healthy decentralization."
        //
        // The safest book and the most dangerous one got the same verdict, and
        // the genuinely concentrated case got the reassuring one.
        //
        // Two faults, not one. The inversion is the same as everywhere else
        // tonight — concentrationBias is 0 for an even split and 0 collapses
        // the engine reading. But evenness was also the wrong question: five
        // holders at 20% each are perfectly even AND own the entire supply.
        // Swapping in a fairness measure would have kept the tool wrong while
        // making it look fixed.
        //
        // Whale risk is how much of the supply the listed holders control, and
        // whether any single one is large enough to move the price alone. The
        // tool already computed and printed the first number one line below the
        // headline; it just did not use it.
        //
        // The band edges below are a judgement call, not a measurement — Alex's
        // to set. What the tests pin is the ordering, which is not a judgement
        // call: more supply in the top holders must never produce a calmer
        // verdict.
        const topTotal = pcts.reduce((s, v) => s + v, 0);
        const largest = Math.max(...pcts);
        const whaleBand = whaleConcentrationBand(topTotal, largest);
        let text = `## ${label} Whale Check — top ${holders.length} hold ${topTotal.toFixed(1)}% of supply\n\n`;
        text += `**Engine AIN:** ${fmtAin(ain)}/100 — the engine's own reading, not the concentration above.\n\n`;
        if (total_holders) text += `**Total holders:** ${total_holders.toLocaleString()}\n`;
        text += `\n| Holder | Share |\n|--------|-------|\n`;
        for (const h of holders) {
          text += `| ${h.label ?? "Wallet"} | ${h.percentage.toFixed(2)}% |\n`;
        }

        text += `\n**Largest single holder:** ${largest.toFixed(2)}% of supply\n`;
        if (whaleBand === "low") text += `\n**Verdict:** Well-distributed. Low whale risk. Healthy decentralization.\n`;
        else if (whaleBand === "moderate") text += `\n**Verdict:** Moderate concentration. A few wallets hold significant supply. Watch for whale dumps.\n`;
        else if (whaleBand === "elevated") text += `\n**Verdict:** Elevated concentration. The listed holders together could move the price.\n`;
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
        const ain = ainScale(result.ain);

        let text = `## ${protocol} DeFi Risk — AIN ${fmtAin(ain)}/100\n\n`;
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
        const ain = ainScale(result.ain);

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

        let text = `## Liquidity Analysis — AIN ${fmtAin(ain)}/100\n\n`;
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
        text += `. Aggregate AIN ${fmtAin(ain)}/100 — `;
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
        const ain = ainScale(result.ain);
        const label = token ?? "Token";

        // AUDIT 2026-07-31: measured against the live engine, before:
        //
        //   insiders 10% / community 80% -> "Fair distribution."
        //   insiders 40% / community 40% -> "Insider-heavy. High concentration
        //                                    risk."
        //   insiders 85% / community 10% -> "Fair distribution. Community has
        //                                    meaningful ownership."
        //
        // A token where insiders hold 85% was certified fair, with the words
        // "community has meaningful ownership" printed directly beneath the
        // tool's own line reading "Insider allocation: 85.0% | Community:
        // 10.0%". The 40/40 case, which is better on every reading, got the
        // harshest verdict of the three.
        //
        // Same inversion as everywhere else, and the same second fault as
        // zpl_whale_check: evenness across allocation categories is not what
        // "fair tokenomics" means. A 50% community / 10% team split is better
        // than a perfectly even four-way split, not worse.
        //
        // The verdict now comes from the insider share, which the tool already
        // computed and printed. Thresholds are a judgement call and Alex's to
        // set; the ordering is not, and the tests pin it.
        const insiderPctForVerdict = allocations
          .filter((a) => ["team", "investors", "advisors", "founders"].some((k) => a.category.toLowerCase().includes(k)))
          .reduce((s, a) => s + a.percentage, 0);
        const communityPctForVerdict = allocations
          .filter((a) => ["community", "public", "airdrop", "ecosystem", "rewards"].some((k) => a.category.toLowerCase().includes(k)))
          .reduce((s, a) => s + a.percentage, 0);
        // Both buckets are keyword matches on free-text category names. When a
        // caller labels allocations something this does not recognise, both come
        // out 0 — and a verdict of "fair, insiders hold 0%" would be invented
        // rather than measured. That case says what happened instead.
        const recognised = insiderPctForVerdict > 0 || communityPctForVerdict > 0;

        let text = `## ${label} Tokenomics — insiders ${recognised ? `${insiderPctForVerdict.toFixed(1)}%` : "not identifiable"}\n\n`;
        text += `**Engine AIN:** ${fmtAin(ain)}/100 — the engine's own reading, not the insider share.\n\n`;
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

        if (!recognised) {
          text +=
            `**Verdict:** Cannot judge. No allocation category was recognisable as ` +
            `insider (team, investors, advisors, founders) or community (community, ` +
            `public, airdrop, ecosystem, rewards), so there is nothing to compare. ` +
            `Relabel the categories and run again.\n`;
        } else {
          const band = insiderShareBand(insiderPctForVerdict);
          if (band === "fair") text += `**Verdict:** Fair distribution. Community has meaningful ownership.\n`;
          else if (band === "moderate") text += `**Verdict:** Moderately concentrated. Insiders hold significant share — check vesting.\n`;
          else if (band === "insider-heavy") text += `**Verdict:** Insider-heavy. High concentration risk. Dump potential when vesting unlocks.\n`;
          else text += `**Verdict:** Insiders hold the majority of supply. Whatever the vesting schedule says, control sits with them.\n`;
        }

        text += `**Tokens:** ${result.tokens_used}`;
        addHistory({ tool: "zpl_tokenomics", domain: "crypto", results: { token, insiderPct, communityPct, tokens_used: result.tokens_used }, ain_scores: { [label]: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );
}

