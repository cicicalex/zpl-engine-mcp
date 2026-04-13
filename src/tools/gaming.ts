/**
 * Gaming tools — 6 tools for game balance analysis.
 */

import { z } from "zod";
import type { Server } from "./helpers.js";
import { distributionBias, concentrationBias, clampD } from "./helpers.js";
import { ZPLEngineClient } from "../engine-client.js";
import { addHistory } from "../store.js";

export function registerGamingTools(server: Server, getClient: () => ZPLEngineClient) {

  // --- zpl_loot_table: loot drop rate fairness ---
  server.tool(
    "zpl_loot_table",
    "Analyze loot table fairness. Provide drop rates for items/rarities. Returns AIN showing whether drops are fair or if certain items dominate unfairly. Works for any game: RPG, MMO, gacha, idle, card games.",
    {
      items: z.array(z.object({
        name: z.string().max(100).describe("Item/rarity name"),
        drop_rate: z.number().min(0).describe("Drop rate (% or weight, same unit for all)"),
      })).min(2).max(50).describe("Loot table items with drop rates"),
      expected_uniform: z.boolean().optional().default(false).describe("True if all items should drop equally"),
      game: z.string().max(200).optional().describe("Game name for label"),
    },
    async ({ items, expected_uniform, game }) => {
      try {
        const client = getClient();
        const rates = items.map((i) => i.drop_rate);
        const d = clampD(rates.length);
        const rawBias = distributionBias(rates);
        const bias = expected_uniform ? rawBias : rawBias * 0.7; // intentional skew is OK
        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);
        const label = game ?? "Loot Table";

        let text = `## ${label} Fairness — AIN ${ain}/100\n\n`;
        text += `| Item | Drop Rate | Share |\n|------|-----------|-------|\n`;
        const total = rates.reduce((s, v) => s + v, 0);
        for (const item of items) {
          text += `| ${item.name} | ${item.drop_rate} | ${((item.drop_rate / total) * 100).toFixed(1)}% |\n`;
        }

        if (ain >= 70) text += `\n**Verdict:** Loot table is well-balanced. Players should feel drops are fair.\n`;
        else if (ain >= 40) text += `\n**Verdict:** Some items are significantly rarer. Acceptable for tiered loot but monitor player feedback.\n`;
        else text += `\n**Verdict:** Heavy skew detected. Some items are almost impossible to get — likely to frustrate players.\n`;

        text += `**Tokens:** ${result.tokens_used}`;
        addHistory({ tool: "zpl_loot_table", domain: "game", results: { game, items: items.map((i) => i.name) }, ain_scores: { loot: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_matchmaking: matchmaking fairness ---
  server.tool(
    "zpl_matchmaking",
    "Analyze matchmaking fairness. Provide player ratings/skill levels in a match. Returns AIN showing whether the match is balanced or if one side has an unfair advantage.",
    {
      team_a: z.array(z.number()).min(1).max(20).describe("Team A player ratings/skill levels"),
      team_b: z.array(z.number()).min(1).max(20).describe("Team B player ratings/skill levels"),
      game: z.string().max(200).optional().describe("Game name"),
    },
    async ({ team_a, team_b, game }) => {
      try {
        const client = getClient();
        const avgA = team_a.reduce((s, v) => s + v, 0) / team_a.length;
        const avgB = team_b.reduce((s, v) => s + v, 0) / team_b.length;
        const allRatings = [...team_a, ...team_b];
        const d = clampD(allRatings.length);

        // Bias = team imbalance
        const maxRating = Math.max(...allRatings);
        const teamDiff = Math.abs(avgA - avgB) / maxRating;
        // Also factor in within-team variance
        const allMean = allRatings.reduce((s, v) => s + v, 0) / allRatings.length;
        const variance = allRatings.reduce((s, v) => s + (v - allMean) ** 2, 0) / allRatings.length;
        const spread = Math.sqrt(variance) / maxRating;
        const bias = Math.min(1, Math.max(0, teamDiff * 0.6 + spread * 0.4));

        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);

        let text = `## Matchmaking ${game ?? ""} — AIN ${ain}/100\n\n`;
        text += `| Metric | Team A | Team B |\n|--------|--------|--------|\n`;
        text += `| Players | ${team_a.length} | ${team_b.length} |\n`;
        text += `| Avg Rating | ${avgA.toFixed(0)} | ${avgB.toFixed(0)} |\n`;
        text += `| Min | ${Math.min(...team_a)} | ${Math.min(...team_b)} |\n`;
        text += `| Max | ${Math.max(...team_a)} | ${Math.max(...team_b)} |\n`;

        const favoredTeam = avgA > avgB ? "Team A" : avgA < avgB ? "Team B" : "Neither";
        text += `\n**Advantage:** ${favoredTeam} (${Math.abs(avgA - avgB).toFixed(0)} rating gap)\n`;

        if (ain >= 70) text += `**Verdict:** Fair match. Both teams are competitive.\n`;
        else if (ain >= 40) text += `**Verdict:** Slight imbalance. ${favoredTeam} has a noticeable advantage.\n`;
        else text += `**Verdict:** Unfair match. ${favoredTeam} heavily favored — consider re-matching.\n`;

        text += `**Tokens:** ${result.tokens_used}`;
        addHistory({ tool: "zpl_matchmaking", domain: "game", results: { game, avgA, avgB }, ain_scores: { matchmaking: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_economy_check: game economy health ---
  server.tool(
    "zpl_economy_check",
    "Analyze game economy health. Provide resource production vs consumption rates. Detects inflation, deflation, or balanced economy.",
    {
      resources: z.array(z.object({
        name: z.string().max(100).describe("Resource name (gold, wood, gems, etc.)"),
        production: z.number().min(0).describe("Production rate per time unit"),
        consumption: z.number().min(0).describe("Consumption/sink rate per time unit"),
      })).min(2).max(30).describe("Game resources with flow rates"),
      game: z.string().optional(),
    },
    async ({ resources, game }) => {
      try {
        const client = getClient();
        const ratios = resources.map((r) => {
          if (r.consumption === 0) return 10; // infinite production, no sink
          return r.production / r.consumption;
        });
        const d = clampD(ratios.length);
        // Ideal ratio = 1.0. Deviation from 1 = imbalance
        const deviations = ratios.map((r) => Math.abs(r - 1));
        const avgDev = deviations.reduce((s, v) => s + v, 0) / deviations.length;
        const bias = Math.min(1, Math.max(0, avgDev / 2));

        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);

        let text = `## ${game ?? "Game"} Economy — AIN ${ain}/100\n\n`;
        text += `| Resource | Production | Consumption | Ratio | Health |\n`;
        text += `|----------|------------|-------------|-------|--------|\n`;
        for (let i = 0; i < resources.length; i++) {
          const r = resources[i];
          const ratio = ratios[i];
          const health = ratio > 1.3 ? "INFLATING" : ratio < 0.7 ? "DRAINING" : "BALANCED";
          text += `| ${r.name} | ${r.production} | ${r.consumption} | ${ratio.toFixed(2)}x | ${health} |\n`;
        }

        const inflating = ratios.filter((r) => r > 1.3).length;
        const draining = ratios.filter((r) => r < 0.7).length;
        text += `\n**Summary:** ${inflating} inflating, ${draining} draining, ${resources.length - inflating - draining} balanced\n`;
        text += `**Tokens:** ${result.tokens_used}`;

        addHistory({ tool: "zpl_economy_check", domain: "game", results: { game, resources: resources.map((r) => r.name) }, ain_scores: { economy: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_pvp_balance: PvP class/weapon balance ---
  server.tool(
    "zpl_pvp_balance",
    "Analyze PvP balance across classes, weapons, or characters. Provide win rates, pick rates, or power scores. Detects dominant meta and underpowered options.",
    {
      entities: z.array(z.object({
        name: z.string().max(100).describe("Class/weapon/character name"),
        win_rate: z.number().optional().describe("Win rate % (e.g. 52.3)"),
        pick_rate: z.number().optional().describe("Pick rate % (e.g. 15.2)"),
        power: z.number().optional().describe("Power score (arbitrary scale)"),
      })).min(2).max(50).describe("PvP entities to analyze"),
      game: z.string().optional(),
    },
    async ({ entities, game }) => {
      try {
        const client = getClient();
        // Use win_rate if available, else pick_rate, else power
        const values = entities.map((e) => e.win_rate ?? e.pick_rate ?? e.power ?? 50);
        const d = clampD(values.length);
        const bias = distributionBias(values);
        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);

        const sorted = entities.map((e, i) => ({ ...e, value: values[i] })).sort((a, b) => b.value - a.value);
        let text = `## ${game ?? "PvP"} Balance — AIN ${ain}/100\n\n`;
        text += `| Rank | Name | Score | Status |\n|------|------|-------|--------|\n`;
        const avg = values.reduce((s, v) => s + v, 0) / values.length;
        for (let i = 0; i < sorted.length; i++) {
          const s = sorted[i];
          const status = s.value > avg * 1.15 ? "OP" : s.value < avg * 0.85 ? "WEAK" : "OK";
          text += `| ${i + 1} | ${s.name} | ${s.value.toFixed(1)} | ${status} |\n`;
        }

        const op = sorted.filter((s) => s.value > avg * 1.15).length;
        const weak = sorted.filter((s) => s.value < avg * 0.85).length;
        text += `\n**Meta:** ${op} overpowered, ${weak} underpowered, ${sorted.length - op - weak} balanced\n`;
        text += `**Tokens:** ${result.tokens_used}`;

        addHistory({ tool: "zpl_pvp_balance", domain: "game", results: { game, entities: entities.map((e) => e.name) }, ain_scores: { pvp: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_gacha_audit: gacha/loot box fairness ---
  server.tool(
    "zpl_gacha_audit",
    "Audit gacha/loot box system fairness. Provide banner rates and pity system info. Checks if the system is mathematically fair or predatory. Useful for game compliance and player protection.",
    {
      tiers: z.array(z.object({
        name: z.string().max(50).describe("Rarity tier (SSR, SR, R, N)"),
        rate: z.number().min(0).describe("Pull rate %"),
        value_score: z.number().min(0).max(10).optional().describe("Desirability score 0-10"),
      })).min(2).max(10).describe("Gacha tiers"),
      pity: z.number().optional().describe("Pity system: guaranteed after N pulls (0 = no pity)"),
      cost_per_pull: z.number().optional().describe("Cost per pull in $ equivalent"),
    },
    async ({ tiers, pity, cost_per_pull }) => {
      try {
        const client = getClient();
        const rates = tiers.map((t) => t.rate);
        const d = clampD(rates.length + 2);
        const bias = distributionBias(rates);
        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);

        let text = `## Gacha Audit — AIN ${ain}/100\n\n`;
        text += `| Tier | Rate | Expected pulls |\n|------|------|----------------|\n`;
        for (const t of tiers) {
          const expected = t.rate > 0 ? Math.ceil(100 / t.rate) : "∞";
          text += `| ${t.name} | ${t.rate}% | ~${expected} pulls |\n`;
        }

        if (pity) text += `\n**Pity:** Guaranteed at ${pity} pulls\n`;
        if (cost_per_pull && tiers[0]) {
          const costToGuarantee = pity ? pity * cost_per_pull : Math.ceil(100 / tiers[0].rate) * cost_per_pull;
          text += `**Worst-case cost for top tier:** $${costToGuarantee.toFixed(2)}\n`;
        }

        if (ain >= 60) text += `\n**Verdict:** Rates are reasonable. System appears fair.\n`;
        else if (ain >= 30) text += `\n**Verdict:** Moderate skew. Top-tier items are quite rare. ${pity ? "Pity system helps." : "No pity system — consider adding one."}\n`;
        else text += `\n**Verdict:** Heavily predatory rates. Top-tier items are extremely rare. May face regulatory issues in EU/JP/CN.\n`;

        text += `**Tokens:** ${result.tokens_used}`;
        addHistory({ tool: "zpl_gacha_audit", domain: "game", results: { tiers: tiers.map((t) => t.name), pity }, ain_scores: { gacha: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_rng_test: RNG fairness test ---
  server.tool(
    "zpl_rng_test",
    "Test whether a random number sequence is truly random or biased. Provide a sequence of outcomes and the expected distribution. Useful for auditing dice rolls, card draws, slot machines, etc.",
    {
      outcomes: z.array(z.number()).min(10).max(1000).describe("Sequence of outcomes (e.g. dice results: [1,3,6,2,4,5,1,3,...]"),
      possible_values: z.number().int().min(2).describe("Number of possible outcomes (e.g. 6 for a die)"),
    },
    async ({ outcomes, possible_values }) => {
      try {
        const client = getClient();
        // Count frequency of each outcome
        const counts = new Array(possible_values).fill(0);
        for (const o of outcomes) {
          const idx = Math.min(possible_values - 1, Math.max(0, Math.round(o) - 1));
          counts[idx]++;
        }
        const d = clampD(possible_values);
        const bias = distributionBias(counts);
        const result = await client.compute({ d, bias, samples: 3000 });
        const ain = Math.round(result.ain * 100);

        const expected = outcomes.length / possible_values;
        let text = `## RNG Fairness Test — AIN ${ain}/100\n\n`;
        text += `**Sample size:** ${outcomes.length} | **Possible values:** ${possible_values}\n\n`;
        text += `| Value | Count | Expected | Deviation |\n|-------|-------|----------|-----------|\n`;
        for (let i = 0; i < possible_values; i++) {
          const dev = ((counts[i] - expected) / expected * 100).toFixed(1);
          text += `| ${i + 1} | ${counts[i]} | ${expected.toFixed(0)} | ${Number(dev) > 0 ? "+" : ""}${dev}% |\n`;
        }

        if (ain >= 70) text += `\n**Verdict:** RNG appears fair. Distribution matches expected uniform.\n`;
        else if (ain >= 40) text += `\n**Verdict:** Slight bias detected. Some values appear more than expected. May need more samples to confirm.\n`;
        else text += `\n**Verdict:** Significant bias. RNG is NOT producing fair results. Check implementation.\n`;

        text += `**Tokens:** ${result.tokens_used}`;
        addHistory({ tool: "zpl_rng_test", domain: "game", results: { possible_values, sample_size: outcomes.length }, ain_scores: { rng: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );
}
