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
 * Score: the engine's AIN on the 0.0-1.0 scale (6 decimals), displayed here on
 * a 0-100 scale with its decimals kept — see src/ain-format.ts.
 */

import type { ComputeResponse } from "../engine-client.js";
import type { DomainLens, DomainInterpretation } from "./types.js";
import { ainScale, fmtAin } from "../ain-format.js";
import { clampBias } from "../tools/helpers.js";

/**
 * Given an array of factor scores (0-10) for one option,
 * compute how balanced/neutral that option is.
 *
 * Perfect balance = all factors equal = low bias = high AIN
 * Imbalanced = some factors way higher than others = high bias = low AIN
 */
function computeOptionBias(scores: number[]): { d: number; bias: number } {
  // AUDIT 2026-07-30: reached from zpl_analyze, whose `input` is typed
  // `z.record(z.string(), z.unknown())` — nothing has checked these values
  // before they arrive. A non-numeric entry used to divide into NaN and take
  // the whole computation with it; a `null` entry was quietly read as a score
  // of zero and produced a confident answer from an input nobody supplied.
  // The five other lenses each reject short input at their own boundary. This
  // one, the flagship, had no such check.
  if (!Array.isArray(scores) || scores.length === 0) {
    throw new Error(
      "Each option needs at least one factor score. Received an empty list.",
    );
  }
  const bad = scores.findIndex((s) => typeof s !== "number" || !Number.isFinite(s));
  if (bad !== -1) {
    throw new Error(
      `Factor score at position ${bad} is not a finite number ` +
        `(received ${JSON.stringify(scores[bad])}). Scores are numbers from 0 to 10.`,
    );
  }

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
  const bias = clampBias(imbalance * 0.7 + (1 - mean) * 0.3, "computeOptionBias");

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
    const ain = ainScale(result.ain);
    const context = (input.context as string) ?? "choice";

    let signal: string;
    if (ain >= 75) signal = "EXCELLENT_BALANCE";
    else if (ain >= 55) signal = "GOOD_BALANCE";
    else if (ain >= 40) signal = "MODERATE";
    else if (ain >= 25) signal = "IMBALANCED";
    else signal = "POOR_BALANCE";

    return {
      summary: `${context}: AIN ${fmtAin(ain)}/100`,
      ain,
      status: result.ain_status,
      signal,
      details: {
        "AIN Score": `${fmtAin(ain)}/100`,
        "Balance": result.ain_status,
      },
      recommendation: `This ${context} scores ${fmtAin(ain)}/100 on mathematical balance.`,
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
  const ain = ainScale(result.ain);
  let signal: string;
  if (ain >= 75) signal = "EXCELLENT";
  else if (ain >= 55) signal = "GOOD";
  else if (ain >= 40) signal = "MODERATE";
  else if (ain >= 25) signal = "WEAK";
  else signal = "POOR";

  const factorScores: Record<string, number> = {};
  factors.forEach((f, i) => { factorScores[f] = scores[i] ?? 0; });

  // Only expose AIN + status + signal. Bias/deviation/timing never shown to protect IP.
  return {
    name,
    ain,
    status: result.ain_status,
    signal,
    bias: 0,
    deviation: 0,
    tokens_used: 0,
    compute_ms: 0,
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

  // Build summary — AIN score only. No bias, no deviation, no timing, no hints about internals.
  const ctx = context ?? "decision";
  let summary = `## ${question}\n\n`;

  for (const opt of sorted) {
    summary += `- **${opt.name}** — AIN ${fmtAin(opt.ain)}/100\n`;
  }

  if (sorted.length >= 2) {
    const diff = sorted[0].ain - sorted[1].ain;
    summary += `\n`;
    if (diff <= 5) {
      summary += `Very close — **${sorted[0].name}** (${fmtAin(sorted[0].ain)}) and **${sorted[1].name}** (${fmtAin(sorted[1].ain)}) score nearly equal. Personal preference decides.`;
    } else if (diff <= 15) {
      summary += `**${sorted[0].name}** (${fmtAin(sorted[0].ain)}) scores higher than **${sorted[1].name}** (${fmtAin(sorted[1].ain)}).`;
    } else {
      summary += `**${sorted[0].name}** (${fmtAin(sorted[0].ain)}) scores clearly higher than **${sorted[1].name}** (${fmtAin(sorted[1].ain)}).`;
    }
  }

  return {
    question,
    options: sorted,
    winner: winner.name,
    winner_ain: winner.ain,
    summary,
    factor_breakdown: "",
  };
}
