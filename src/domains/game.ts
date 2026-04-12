/**
 * Game Economy domain lens.
 * Analyzes game balance, item distribution fairness, player economy health.
 *
 * Input: item drop rates, resource distributions, player power levels.
 * Output: balance assessment, fairness score, economy health signals.
 */

import type { ComputeResponse, SweepResponse } from "../engine-client.js";
import type { DomainLens, DomainInterpretation } from "./types.js";

export const gameLens: DomainLens = {
  id: "game",
  name: "Game Economy",
  description: "Analyze game balance, loot fairness, resource distribution, and player economy health",
  examples: [
    "Check if loot table is fair: [5%, 15%, 30%, 30%, 15%, 5%] drop rates across 6 rarities",
    "Analyze player power distribution: [100, 250, 180, 400, 120, 350, 200] across 7 classes",
    "Test resource economy balance with production rates [10, 8, 12, 6, 9] vs consumption [9, 7, 11, 8, 10]",
  ],
  inputSchema: {
    values: {
      type: "number[]",
      description: "Distribution values (drop rates, power levels, resource amounts). More values = higher dimension.",
      required: true,
    },
    expected_uniform: {
      type: "boolean",
      description: "If true, tests against perfectly uniform distribution. Default: false.",
    },
    game_type: {
      type: "string",
      description: "Optional: 'mmo', 'battle-royale', 'strategy', 'rpg', 'card-game', 'idle'",
    },
  },

  buildParams(input: Record<string, unknown>): { d: number; bias: number; samples?: number } {
    const values = input.values as number[];
    if (!values || !Array.isArray(values) || values.length < 2) {
      throw new Error("Game lens requires at least 2 values in 'values' array");
    }

    const d = Math.max(3, Math.min(100, values.length));

    // Compute distribution skew as bias
    const total = values.reduce((s, v) => s + v, 0);
    if (total === 0) throw new Error("Values sum to zero — cannot analyze empty distribution");

    const normalized = values.map((v) => v / total);
    const uniform = 1 / values.length;

    // Bias = how far from uniform distribution (Gini-like measure)
    const deviation = normalized.reduce((s, n) => s + Math.abs(n - uniform), 0) / 2;
    const bias = Math.min(1, Math.max(0, deviation));

    // If expected_uniform, use bias directly. Otherwise, some skew is intentional.
    const expectUniform = input.expected_uniform === true;
    const adjustedBias = expectUniform ? bias : bias * 0.7;

    return { d, bias: adjustedBias, samples: 2000 };
  },

  interpret(result: ComputeResponse, input: Record<string, unknown>): DomainInterpretation {
    const ain = Math.round(result.ain * 100);
    const gameType = (input.game_type as string) ?? "game";

    let signal: string;
    let recommendation: string;

    if (ain >= 85) {
      signal = "PERFECTLY_BALANCED";
      recommendation = `The ${gameType} economy is exceptionally balanced. All elements show fair distribution — no dominant strategy or unfair advantage detected.`;
    } else if (ain >= 65) {
      signal = "BALANCED";
      recommendation = `Good balance for ${gameType}. Minor asymmetries exist but within acceptable design parameters. Players should experience fair gameplay.`;
    } else if (ain >= 45) {
      signal = "SLIGHT_IMBALANCE";
      recommendation = `Noticeable imbalance in ${gameType} economy. Some elements are disproportionately weighted — consider adjusting drop rates or resource ratios.`;
    } else if (ain >= 25) {
      signal = "IMBALANCED";
      recommendation = `Significant imbalance detected. The ${gameType} economy favors certain strategies/items heavily. Patch recommended to prevent player frustration.`;
    } else {
      signal = "BROKEN_ECONOMY";
      recommendation = `Critical imbalance in ${gameType} economy. Distribution is severely skewed — this will lead to meta-gaming, exploits, or player churn.`;
    }

    return {
      summary: `${gameType} Balance: AIN ${ain}/100 — ${signal}`,
      ain,
      status: result.ain_status,
      signal,
      details: {
        "AIN Score": ain,
        "Balance Status": result.ain_status,
        "Distribution Bias": +(result.bias.toFixed(4)),
        "Deviation": +(result.deviation.toFixed(6)),
        "Elements Analyzed": result.d,
        "Tokens Used": result.tokens_used,
        "Compute Time": `${result.compute_ms}ms`,
      },
      recommendation,
    };
  },

  interpretSweep(result: SweepResponse, input: Record<string, unknown>): string {
    const gameType = (input.game_type as string) ?? "game";
    let summary = `## ${gameType} Balance Sweep (d=${result.d})\n\n`;
    summary += `Tests how your ${gameType} economy behaves across 19 bias levels:\n\n`;
    summary += `| Bias | AIN | Status |\n|------|-----|--------|\n`;

    for (const r of result.results) {
      const ainPct = Math.round(r.ain * 100);
      const emoji = ainPct >= 70 ? "BALANCED" : ainPct >= 40 ? "CAUTION" : "BROKEN";
      summary += `| ${r.bias.toFixed(2)} | ${ainPct}% | ${emoji} |\n`;
    }

    summary += `\n**Tokens:** ${result.total_tokens} | **Time:** ${result.compute_ms}ms`;
    return summary;
  },
};
