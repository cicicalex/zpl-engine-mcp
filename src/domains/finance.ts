/**
 * Finance domain lens.
 * Analyzes market stability, portfolio bias, asset correlations.
 *
 * Input: price changes, volatility metrics, or asset weights.
 * Output: stability assessment, bias detection, risk signals.
 */

import type { ComputeResponse, SweepResponse } from "../engine-client.js";
import type { DomainLens, DomainInterpretation } from "./types.js";

export const financeLens: DomainLens = {
  id: "finance",
  name: "Financial Markets",
  description: "Analyze market stability, portfolio bias, and asset risk using price movements and volatility data",
  examples: [
    "Analyze BTC stability given 24h change of -3.2% and 7d change of +8.5%",
    "Check portfolio bias: 60% crypto, 30% stocks, 10% bonds",
    "Evaluate forex pair EUR/USD stability with bid/ask spread 0.0002",
  ],
  inputSchema: {
    assets: {
      type: "number[]",
      description: "Array of price change percentages (e.g. [-3.2, 8.5, -1.1, 0.4]). More assets = higher dimension.",
      required: true,
    },
    volatility: {
      type: "number",
      description: "Optional annualized volatility (0-200%). Used to refine bias calculation.",
    },
    context: {
      type: "string",
      description: "Optional context: 'crypto', 'forex', 'equities', 'commodities', 'mixed'",
    },
  },

  buildParams(input: Record<string, unknown>): { d: number; bias: number; samples?: number } {
    const assets = input.assets as number[];
    if (!assets || !Array.isArray(assets) || assets.length < 2) {
      throw new Error("Finance lens requires at least 2 asset price changes in 'assets' array");
    }

    // Dimension = number of assets (clamped 3-100)
    const d = Math.max(3, Math.min(100, assets.length));

    // Bias = normalized directional imbalance
    // If all assets move the same direction → high bias (not neutral)
    // If assets are balanced (some up, some down) → low bias (neutral)
    const positives = assets.filter((a) => a > 0).length;
    const ratio = positives / assets.length; // 0 = all down, 1 = all up
    const rawBias = Math.abs(ratio - 0.5) * 2; // 0 = perfectly balanced, 1 = all same direction

    // Factor in magnitude — large uniform moves = higher bias
    const avgMagnitude = assets.reduce((s, a) => s + Math.abs(a), 0) / assets.length;
    const magnitudeFactor = Math.min(avgMagnitude / 10, 1); // cap at 10% avg move

    // Volatility adjustment
    const vol = typeof input.volatility === "number" ? input.volatility : 0;
    const volFactor = vol > 0 ? Math.min(vol / 100, 1) * 0.2 : 0;

    const bias = Math.min(1, Math.max(0, rawBias * 0.6 + magnitudeFactor * 0.3 + volFactor * 0.1));

    // More samples for larger portfolios
    const samples = d > 20 ? 5000 : d > 10 ? 2000 : 1000;

    return { d, bias, samples };
  },

  interpret(result: ComputeResponse, input: Record<string, unknown>): DomainInterpretation {
    const ain = Math.round(result.ain * 100);
    const context = (input.context as string) ?? "market";

    let signal: string;
    let recommendation: string;

    if (ain >= 80) {
      signal = "HIGHLY_STABLE";
      recommendation = `This ${context} configuration shows exceptional neutrality. Low directional bias detected — conditions favor balanced positioning.`;
    } else if (ain >= 60) {
      signal = "STABLE";
      recommendation = `${context} conditions are moderately stable. Some directional tendency exists but within normal parameters.`;
    } else if (ain >= 40) {
      signal = "CAUTION";
      recommendation = `Elevated bias detected in ${context} data. Consider hedging or reducing exposure to concentrated positions.`;
    } else if (ain >= 20) {
      signal = "UNSTABLE";
      recommendation = `Significant market bias detected. ${context} shows strong directional momentum — exercise caution with leveraged positions.`;
    } else {
      signal = "EXTREME_BIAS";
      recommendation = `Extreme directional bias in ${context}. This typically precedes volatility events. Defensive positioning recommended.`;
    }

    return {
      summary: `${context} AIN: ${ain}/100 — ${result.ain_status}`,
      ain,
      status: result.ain_status,
      signal,
      details: {
        "AIN Score": ain,
        "Engine Status": result.status,
        "Deviation": +(result.deviation.toFixed(6)),
        "P-Output": +(result.p_output.toFixed(6)),
        "Dimension": result.d,
        "Bias Input": +(result.bias.toFixed(4)),
        "Tokens Used": result.tokens_used,
        "Compute Time": `${result.compute_ms}ms`,
      },
      recommendation,
    };
  },

  interpretSweep(result: SweepResponse, input: Record<string, unknown>): string {
    const context = (input.context as string) ?? "market";
    const neutral = result.results.find((r) => r.ain >= 0.9);
    const unstable = result.results.filter((r) => r.ain < 0.3);

    let summary = `## ${context} Stability Sweep (d=${result.d})\n\n`;
    summary += `| Bias | AIN | Status | Deviation |\n|------|-----|--------|-----------|\n`;

    for (const r of result.results) {
      const ainPct = Math.round(r.ain * 100);
      summary += `| ${r.bias.toFixed(2)} | ${ainPct}% | ${r.status} | ${r.deviation.toFixed(6)} |\n`;
    }

    summary += `\n**Tokens used:** ${result.total_tokens} | **Compute:** ${result.compute_ms}ms\n`;

    if (neutral) {
      summary += `\nNeutral point found at bias=${neutral.bias.toFixed(2)} (AIN ${Math.round(neutral.ain * 100)}%).`;
    }
    if (unstable.length > 0) {
      summary += `\n${unstable.length} of 19 bias steps show instability (AIN < 30%).`;
    }

    return summary;
  },
};
