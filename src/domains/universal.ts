/**
 * Universal domain lens — the "ZPL AI" feature.
 *
 * ANY question, ANY topic. The AI breaks it into options + factors,
 * the engine scores each option's balance/neutrality mathematically.
 *
 * "Pizza or hotdog?" → factors: nutrition, cost, taste, health, convenience
 * → Engine computes AIN for each → balanced mathematical answer
 *
 * This is what makes ZPL unique: not opinions, but math.
 * Score range: ~4.0 to ~90.0 (realistic, not always 0 or 100).
 */

import type { ComputeResponse } from "../engine-client.js";
import type { DomainLens, DomainInterpretation } from "./types.js";

/**
 * Given an array of factor scores (0-10) for one option,
 * compute how balanced/neutral that option is.
 *
 * Perfect balance = all factors equal = low bias = high AIN
 * Imbalanced = some factors way higher than others = high bias = low AIN
 */
function computeOptionBias(scores: number[]): { d: number; bias: number } {
  const d = Math.max(3, Math.min(100, scores.length));

  // Normalize to 0-1
  const maxScore = 10;
  const normalized = scores.map((s) => Math.min(1, Math.max(0, s / maxScore)));

  // How balanced are the scores?
  const mean = normalized.reduce((s, v) => s + v, 0) / normalized.length;

  // Variance = imbalance
  const variance = normalized.reduce((s, v) => s + (v - mean) ** 2, 0) / normalized.length;
  const imbalance = Math.sqrt(variance); // 0 = perfectly balanced, ~0.5 = very imbalanced

  // Also factor in overall quality (mean)
  // Low overall + balanced = neutral but mediocre
  // High overall + balanced = excellent neutral choice
  // High overall + imbalanced = strong but biased

  // Bias = imbalance weighted more, overall level weighted less
  const bias = Math.min(1, Math.max(0, imbalance * 0.7 + (1 - mean) * 0.3));

  return { d, bias };
}

export const universalLens: DomainLens = {
  id: "universal",
  name: "Universal (ZPL AI)",
  description: "Answer ANY question with mathematical balance scoring. The AI breaks your question into options and factors, the engine scores each option's neutrality. Not opinions — math.",
  examples: [
    "Pizza or hotdog? Factors: nutrition [7,5], cost [6,8], taste [9,7], health [5,4], convenience [8,9]",
    "React or Vue? Factors: performance [8,7], ecosystem [9,7], learning [6,8], jobs [9,6], DX [7,9]",
    "Buy house or rent? Factors: cost [3,7], flexibility [2,9], equity [9,1], maintenance [3,8], stability [9,4]",
    "Morning jog or gym? Factors: health [8,7], cost [9,4], time [7,5], mood [9,7], social [3,8]",
  ],
  inputSchema: {
    options: {
      type: "string[]",
      description: "The choices to compare (e.g. ['Pizza', 'Hotdog']). 2-10 options.",
      required: true,
    },
    factors: {
      type: "string[]",
      description: "Factor names to evaluate (e.g. ['nutrition', 'cost', 'taste']). 3-20 factors.",
      required: true,
    },
    scores: {
      type: "number[][]",
      description: "Score matrix: one array per option, each with scores 0-10 for each factor. scores[i][j] = option i, factor j.",
      required: true,
    },
    context: {
      type: "string",
      description: "Optional context for the question (e.g. 'choosing lunch', 'career decision', 'tech stack').",
    },
  },

  buildParams(input: Record<string, unknown>): { d: number; bias: number; samples?: number } {
    // For universal, we compute per-option. This returns params for the FIRST option.
    // The actual zpl_ask tool handles multi-option by calling compute multiple times.
    const scores = input.scores as number[][];
    if (!scores?.[0]) throw new Error("Scores matrix required");
    return { ...computeOptionBias(scores[0]), samples: 1000 };
  },

  interpret(result: ComputeResponse, input: Record<string, unknown>): DomainInterpretation {
    const ain = Math.round(result.ain * 100);
    const context = (input.context as string) ?? "choice";

    let signal: string;
    if (ain >= 75) signal = "EXCELLENT_BALANCE";
    else if (ain >= 55) signal = "GOOD_BALANCE";
    else if (ain >= 40) signal = "MODERATE";
    else if (ain >= 25) signal = "IMBALANCED";
    else signal = "POOR_BALANCE";

    return {
      summary: `${context}: AIN ${ain}/100`,
      ain,
      status: result.ain_status,
      signal,
      details: {
        "AIN Score": ain,
        "Balance": result.ain_status,
        "Deviation": +(result.deviation.toFixed(6)),
      },
      recommendation: `This ${context} scores ${ain}/100 on mathematical balance.`,
    };
  },

  interpretSweep(): string {
    return "Use zpl_ask for universal questions instead of sweep.";
  },
};

/**
 * Run full multi-option comparison.
 * Called by the zpl_ask tool — computes AIN for each option separately.
 */
export interface AskResult {
  question: string;
  options: OptionResult[];
  winner: string;
  winner_ain: number;
  summary: string;
  factor_breakdown: string;
}

export interface OptionResult {
  name: string;
  ain: number;
  status: string;
  signal: string;
  bias: number;
  deviation: number;
  tokens_used: number;
  compute_ms: number;
  factor_scores: Record<string, number>;
}

export function buildOptionParams(scores: number[]): { d: number; bias: number; samples: number } {
  const { d, bias } = computeOptionBias(scores);
  return { d, bias, samples: 1000 };
}

export function interpretOption(
  name: string,
  result: ComputeResponse,
  factors: string[],
  scores: number[],
): OptionResult {
  const ain = Math.round(result.ain * 100);
  let signal: string;
  if (ain >= 75) signal = "EXCELLENT";
  else if (ain >= 55) signal = "GOOD";
  else if (ain >= 40) signal = "MODERATE";
  else if (ain >= 25) signal = "WEAK";
  else signal = "POOR";

  const factorScores: Record<string, number> = {};
  factors.forEach((f, i) => { factorScores[f] = scores[i] ?? 0; });

  return {
    name,
    ain,
    status: result.ain_status,
    signal,
    bias: +(result.bias.toFixed(4)),
    deviation: +(result.deviation.toFixed(6)),
    tokens_used: result.tokens_used,
    compute_ms: result.compute_ms,
    factor_scores: factorScores,
  };
}

export function formatAskResult(
  question: string,
  options: OptionResult[],
  factors: string[],
  context?: string,
): AskResult {
  // Sort by AIN descending — highest balance wins
  const sorted = [...options].sort((a, b) => b.ain - a.ain);
  const winner = sorted[0];

  // Build factor breakdown table
  let breakdown = `| Factor |`;
  for (const opt of options) breakdown += ` ${opt.name} |`;
  breakdown += `\n|--------|`;
  for (let i = 0; i < options.length; i++) breakdown += `--------|`;
  breakdown += `\n`;

  for (const factor of factors) {
    breakdown += `| ${factor} |`;
    for (const opt of options) {
      const score = opt.factor_scores[factor] ?? 0;
      breakdown += ` ${score}/10 |`;
    }
    breakdown += `\n`;
  }

  // Build summary
  const ctx = context ?? "decision";
  let summary = `## ZPL Analysis: ${question}\n\n`;

  // Results per option
  for (const opt of sorted) {
    const bar = "=".repeat(Math.round(opt.ain / 5));
    summary += `### ${opt.name} — AIN ${opt.ain}/100 (${opt.signal})\n`;
    summary += `\`[${bar}${"·".repeat(20 - Math.round(opt.ain / 5))}]\` ${opt.status}\n\n`;
  }

  // Factor breakdown
  summary += `### Factor Breakdown\n\n${breakdown}\n`;

  // Winner
  if (sorted.length >= 2) {
    const diff = sorted[0].ain - sorted[1].ain;
    if (diff <= 5) {
      summary += `**Result:** Very close! **${sorted[0].name}** (${sorted[0].ain}) and **${sorted[1].name}** (${sorted[1].ain}) are nearly equally balanced. Your personal preference should decide.\n`;
    } else if (diff <= 15) {
      summary += `**Result:** **${sorted[0].name}** (AIN ${sorted[0].ain}) is the more balanced ${ctx}. ${sorted[1].name} (${sorted[1].ain}) is close but slightly less neutral.\n`;
    } else {
      summary += `**Result:** **${sorted[0].name}** (AIN ${sorted[0].ain}) is clearly the more balanced ${ctx}. ${sorted[1].name} (${sorted[1].ain}) shows more bias in its factor distribution.\n`;
    }
  }

  // Token usage
  const totalTokens = options.reduce((s, o) => s + o.tokens_used, 0);
  const totalMs = options.reduce((s, o) => s + o.compute_ms, 0);
  summary += `\n*Computed by ZPL Engine | ${totalTokens} tokens | ${totalMs}ms*`;

  return {
    question,
    options: sorted,
    winner: winner.name,
    winner_ain: winner.ain,
    summary,
    factor_breakdown: breakdown,
  };
}
