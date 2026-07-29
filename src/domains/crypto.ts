/**
 * Crypto / Blockchain domain lens.
 * Analyzes on-chain metrics, token distributions, network decentralization.
 *
 * Input: holder distributions, validator weights, token supply metrics.
 * Output: decentralization score, concentration risk, network health.
 */

import type { ComputeResponse, SweepResponse } from "../engine-client.js";
import type { DomainLens, DomainInterpretation } from "./types.js";
import { ainScale, fmtAin, ainPct } from "../ain-format.js";

export const cryptoLens: DomainLens = {
  id: "crypto",
  name: "Crypto & Blockchain",
  description: "Analyze token distribution, network decentralization, holder concentration, and on-chain health",
  examples: [
    "Check token decentralization: top 10 holders own [15%, 8%, 6%, 5%, 4%, 3%, 2%, 2%, 1.5%, 1%]",
    "Analyze validator weight distribution: [25%, 18%, 15%, 12%, 10%, 8%, 6%, 4%, 2%]",
    "Test liquidity pool balance: [ETH: $2.1M, USDC: $2.3M, DAI: $0.8M, WBTC: $3.5M]",
  ],
  inputSchema: {
    distribution: {
      type: "number[]",
      description: "Distribution values (holder percentages, validator weights, pool sizes, etc.)",
      required: true,
    },
    metric_type: {
      type: "string",
      description: "Optional: 'holders', 'validators', 'liquidity', 'supply', 'transactions'",
    },
    network: {
      type: "string",
      description: "Optional network name: 'ethereum', 'bitcoin', 'solana', 'polygon', etc.",
    },
  },

  buildParams(input: Record<string, unknown>): { d: number; bias: number; samples?: number } {
    const dist = input.distribution as number[];
    if (!dist || !Array.isArray(dist) || dist.length < 2) {
      throw new Error("Crypto lens requires at least 2 values in 'distribution'");
    }

    const d = Math.max(3, Math.min(100, dist.length));
    const total = dist.reduce((s, v) => s + v, 0);
    if (total === 0) throw new Error("Distribution sums to zero");

    const normalized = dist.map((v) => v / total);

    // Herfindahl-Hirschman Index (HHI) for concentration
    const hhi = normalized.reduce((s, p) => s + p * p, 0);
    // HHI ranges from 1/n (perfect distribution) to 1 (monopoly)
    const minHHI = 1 / dist.length;
    const concentrationBias = (hhi - minHHI) / (1 - minHHI);

    const bias = Math.min(1, Math.max(0, concentrationBias));

    return { d, bias, samples: 2000 };
  },

  interpret(result: ComputeResponse, input: Record<string, unknown>): DomainInterpretation {
    const ain = ainScale(result.ain);
    const metricType = (input.metric_type as string) ?? "distribution";
    const network = (input.network as string) ?? "network";

    let signal: string;
    let recommendation: string;

    if (ain >= 80) {
      signal = "DECENTRALIZED";
      recommendation = `${network} ${metricType} shows excellent decentralization. No single entity dominates — healthy distribution detected.`;
    } else if (ain >= 60) {
      signal = "MODERATELY_DECENTRALIZED";
      recommendation = `${network} ${metricType} is reasonably distributed. Some concentration exists but within acceptable parameters for most protocols.`;
    } else if (ain >= 40) {
      signal = "CONCENTRATED";
      recommendation = `Notable concentration in ${network} ${metricType}. A few entities hold disproportionate influence. Consider this a centralization risk.`;
    } else if (ain >= 20) {
      signal = "HIGHLY_CONCENTRATED";
      recommendation = `${network} ${metricType} is dominated by a small number of entities. High centralization risk — governance attacks or rug pulls more likely.`;
    } else {
      signal = "CENTRALIZED";
      recommendation = `${network} ${metricType} is effectively centralized. Single-point-of-failure risk is critical. Not suitable for trustless applications.`;
    }

    return {
      summary: `${network} ${metricType}: AIN ${fmtAin(ain)}/100 — ${signal}`,
      ain,
      status: result.ain_status,
      signal,
      details: {
        "AIN Score": `${fmtAin(ain)}/100`,
        "Decentralization": result.ain_status,
        "Tokens Used": result.tokens_used,
      },
      recommendation,
    };
  },

  interpretSweep(result: SweepResponse, input: Record<string, unknown>): string {
    const network = (input.network as string) ?? "blockchain";
    let summary = `## ${network} Decentralization Sweep\n\n`;
    summary += `| Bias | AIN | Stability |\n|------|-----|--------|\n`;

    for (const r of result.results) {
      summary += `| ${r.bias.toFixed(2)} | ${ainPct(r.ain)}% | ${r.status} |\n`;
    }

    summary += `\n*Tokens used: ${result.total_tokens}*`;
    return summary;
  },
};
