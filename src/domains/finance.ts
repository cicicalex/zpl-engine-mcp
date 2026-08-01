/**
 * Finance domain lens.
 * Analyzes market stability, portfolio bias, asset correlations.
 *
 * Input: price changes, volatility metrics, or asset weights.
 * Output: stability assessment, bias detection, risk signals.
 */

import type { ComputeResponse, SweepResponse } from "../engine-client.js";
import type { DomainLens, DomainInterpretation } from "./types.js";
import { ainScale, fmtAin, ainPct } from "../ain-format.js";

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
    const raw = input.assets;
    if (!raw || !Array.isArray(raw) || raw.length < 2) {
      throw new Error("Finance lens requires at least 2 asset price changes in 'assets' array");
    }

    // AUDIT 2026-08-01: this cast `input.assets as number[]` and trusted it.
    //
    // `zpl_report` takes a free-form `input` object, so nothing validates the
    // shape before it arrives here — and `zpl_market_scan`, the other finance
    // tool, spells the same key as an array of OBJECTS: [{symbol, change}].
    // Handing zpl_report the shape its sibling documents made
    // `assets.filter(a => a > 0)` count nothing and
    // `assets.reduce((s, a) => s + Math.abs(a))` produce NaN, so bias came out
    // NaN, went to the engine unchecked, and returned
    // "Engine error 422: Unprocessable Entity". No mention of assets, of the
    // shape, or of which of the two spellings this tool wanted.
    //
    // Found by calling every registered tool against the live engine rather
    // than by reading — nothing in the type system objects to a cast.
    //
    // Both spellings are now accepted, since a caller who has just used
    // zpl_market_scan has every reason to expect the same shape to work. A
    // number is the change; an object contributes its `change` (or `value`).
    // Anything else is named in the error rather than silently becoming NaN.
    const assets: number[] = [];
    const rejected: string[] = [];
    for (const entry of raw) {
      if (typeof entry === "number" && Number.isFinite(entry)) {
        assets.push(entry);
        continue;
      }
      if (entry && typeof entry === "object") {
        const obj = entry as Record<string, unknown>;
        const change = typeof obj.change === "number" ? obj.change
          : typeof obj.value === "number" ? obj.value
          : undefined;
        if (change !== undefined && Number.isFinite(change)) {
          assets.push(change);
          continue;
        }
      }
      rejected.push(JSON.stringify(entry)?.slice(0, 40) ?? String(entry));
    }

    if (assets.length < 2) {
      throw new Error(
        `Finance lens needs at least 2 usable asset price changes; ${rejected.length} entr` +
          `${rejected.length === 1 ? "y was" : "ies were"} not a number and carried no numeric ` +
          `"change" or "value" field: ${rejected.slice(0, 3).join(", ")}. Pass either ` +
          `[1.2, -0.8] or [{"symbol":"AAA","change":1.2}] — the same shape zpl_market_scan takes.`,
      );
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
    const ain = ainScale(result.ain);
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
      summary: `${context} AIN: ${fmtAin(ain)}/100 — ${result.ain_status}`,
      ain,
      status: result.ain_status,
      signal,
      details: {
        "AIN Score": `${fmtAin(ain)}/100`,
        "Status": result.ain_status,
        "Tokens Used": result.tokens_used,
      },
      recommendation,
    };
  },

  interpretSweep(result: SweepResponse, input: Record<string, unknown>): string {
    const context = (input.context as string) ?? "market";
    const neutral = result.results.find((r) => r.ain >= 0.9);
    const unstable = result.results.filter((r) => r.ain < 0.3);

    let summary = `## ${context} Stability Sweep\n\n`;
    summary += `| Bias | AIN | Stability |\n|------|-----|--------|\n`;

    for (const r of result.results) {
      summary += `| ${r.bias.toFixed(2)} | ${ainPct(r.ain)}% | ${r.status} |\n`;
    }

    summary += `\n*Tokens used: ${result.total_tokens}*\n`;

    if (neutral) {
      summary += `\nNeutral point identified (AIN ${ainPct(neutral.ain)}%).`;
    }
    if (unstable.length > 0) {
      summary += `\n${unstable.length} of 19 bias steps show instability (AIN < 30%).`;
    }

    return summary;
  },
};
