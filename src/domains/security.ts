/**
 * Security domain lens.
 * Analyzes system vulnerability distribution, attack surface balance, risk scoring.
 *
 * Input: vulnerability scores, risk ratings, attack surface metrics.
 * Output: risk neutrality assessment, exposure analysis.
 */

import type { ComputeResponse, SweepResponse } from "../engine-client.js";
import type { DomainLens, DomainInterpretation } from "./types.js";

export const securityLens: DomainLens = {
  id: "security",
  name: "Security & Risk",
  description: "Analyze vulnerability distributions, attack surface balance, and security posture neutrality",
  examples: [
    "Analyze CVSS scores across components: [9.8, 4.3, 7.1, 2.5, 6.8, 3.2]",
    "Check attack surface balance: [high:5, medium:12, low:25, info:40]",
    "Evaluate security control coverage: [auth:0.9, encryption:0.8, logging:0.4, patching:0.6]",
  ],
  inputSchema: {
    scores: {
      type: "number[]",
      description: "Vulnerability scores, risk ratings, or coverage percentages across components/categories.",
      required: true,
    },
    scale_max: {
      type: "number",
      description: "Maximum value on the scoring scale (default: 10 for CVSS). Set to 1 for percentages.",
    },
    assessment_type: {
      type: "string",
      description: "Optional: 'vulnerability', 'risk', 'coverage', 'compliance', 'threat'",
    },
  },

  buildParams(input: Record<string, unknown>): { d: number; bias: number; samples?: number } {
    const scores = input.scores as number[];
    if (!scores || !Array.isArray(scores) || scores.length < 2) {
      throw new Error("Security lens requires at least 2 scores");
    }

    const d = Math.max(3, Math.min(100, scores.length));
    const scaleMax = typeof input.scale_max === "number" ? input.scale_max : 10;

    // Normalize to 0-1
    const normalized = scores.map((s) => Math.min(1, Math.max(0, s / scaleMax)));

    // Bias = how skewed the risk distribution is
    // Uniform risk = balanced security posture (but not necessarily good)
    // Skewed = some areas are much weaker than others
    const mean = normalized.reduce((s, v) => s + v, 0) / normalized.length;
    const variance = normalized.reduce((s, v) => s + (v - mean) ** 2, 0) / normalized.length;
    const stdDev = Math.sqrt(variance);

    // Also factor in overall severity
    const severityBias = mean; // high average score = high bias toward vulnerable

    const bias = Math.min(1, Math.max(0, stdDev * 0.5 + severityBias * 0.5));

    return { d, bias, samples: 2000 };
  },

  interpret(result: ComputeResponse, input: Record<string, unknown>): DomainInterpretation {
    const ain = Math.round(result.ain * 100);
    const assessmentType = (input.assessment_type as string) ?? "security";

    let signal: string;
    let recommendation: string;

    if (ain >= 80) {
      signal = "SECURE";
      recommendation = `${assessmentType} posture is well-balanced. Risk is evenly distributed without critical concentration points.`;
    } else if (ain >= 60) {
      signal = "ADEQUATE";
      recommendation = `${assessmentType} shows reasonable balance. Minor risk concentrations exist — prioritize remediation of outlier scores.`;
    } else if (ain >= 40) {
      signal = "ELEVATED_RISK";
      recommendation = `Uneven ${assessmentType} posture detected. Some components have significantly higher risk than others. Address the weakest links.`;
    } else if (ain >= 20) {
      signal = "HIGH_RISK";
      recommendation = `Critical imbalance in ${assessmentType}. Risk is heavily concentrated in specific areas. Immediate remediation needed.`;
    } else {
      signal = "CRITICAL";
      recommendation = `Extreme ${assessmentType} exposure. The system has severe, concentrated vulnerabilities. Consider emergency mitigation.`;
    }

    return {
      summary: `${assessmentType} Neutrality: AIN ${ain}/100 — ${signal}`,
      ain,
      status: result.ain_status,
      signal,
      details: {
        "AIN Score": ain,
        "Risk Status": result.ain_status,
        "Risk Concentration": +(result.bias.toFixed(4)),
        "Deviation": +(result.deviation.toFixed(6)),
        "Components Analyzed": result.d,
        "Tokens Used": result.tokens_used,
        "Compute Time": `${result.compute_ms}ms`,
      },
      recommendation,
    };
  },

  interpretSweep(result: SweepResponse, input: Record<string, unknown>): string {
    const type = (input.assessment_type as string) ?? "security";
    let summary = `## ${type} Risk Sweep (d=${result.d})\n\n`;
    summary += `| Bias | AIN | Status |\n|------|-----|--------|\n`;

    for (const r of result.results) {
      summary += `| ${r.bias.toFixed(2)} | ${Math.round(r.ain * 100)}% | ${r.status} |\n`;
    }

    summary += `\n**Tokens:** ${result.total_tokens} | **Time:** ${result.compute_ms}ms`;
    return summary;
  },
};
