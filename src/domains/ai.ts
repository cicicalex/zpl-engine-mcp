/**
 * AI / ML domain lens.
 * Analyzes model fairness, prediction bias, dataset balance.
 *
 * Input: model output distributions, confidence scores, class predictions.
 * Output: bias assessment, fairness score, model health signals.
 */

import type { ComputeResponse, SweepResponse } from "../engine-client.js";
import type { DomainLens, DomainInterpretation } from "./types.js";

export const aiLens: DomainLens = {
  id: "ai",
  name: "AI & Machine Learning",
  description: "Analyze model fairness, prediction bias, dataset balance, and output neutrality",
  examples: [
    "Check model fairness: prediction distribution [0.85, 0.12, 0.03] across 3 classes",
    "Analyze dataset balance: [5000, 3200, 8100, 1500] samples per category",
    "Evaluate model confidence distribution: [0.9, 0.7, 0.95, 0.4, 0.8, 0.6]",
  ],
  inputSchema: {
    outputs: {
      type: "number[]",
      description: "Model outputs, predictions, or class distributions. Can be probabilities, counts, or scores.",
      required: true,
    },
    model_type: {
      type: "string",
      description: "Optional: 'classifier', 'regressor', 'llm', 'generator', 'recommender'",
    },
    fairness_target: {
      type: "string",
      description: "Optional: 'demographic_parity', 'equal_opportunity', 'calibration'",
    },
  },

  buildParams(input: Record<string, unknown>): { d: number; bias: number; samples?: number } {
    const outputs = input.outputs as number[];
    if (!outputs || !Array.isArray(outputs) || outputs.length < 2) {
      throw new Error("AI lens requires at least 2 values in 'outputs' array");
    }

    const d = Math.max(3, Math.min(100, outputs.length));

    // Normalize outputs
    const total = outputs.reduce((s, v) => s + Math.abs(v), 0);
    if (total === 0) throw new Error("All outputs are zero — cannot analyze");

    const normalized = outputs.map((v) => Math.abs(v) / total);

    // Entropy-based bias detection
    // Max entropy = log(n) for uniform distribution
    const n = normalized.length;
    const maxEntropy = Math.log(n);
    const entropy = -normalized
      .filter((p) => p > 0)
      .reduce((s, p) => s + p * Math.log(p), 0);

    // Bias = 1 - (entropy / maxEntropy)
    // 0 = perfectly uniform (unbiased), 1 = single class dominates
    const bias = Math.min(1, Math.max(0, 1 - entropy / maxEntropy));

    return { d, bias, samples: 3000 };
  },

  interpret(result: ComputeResponse, input: Record<string, unknown>): DomainInterpretation {
    const ain = Math.round(result.ain * 100);
    const modelType = (input.model_type as string) ?? "model";

    let signal: string;
    let recommendation: string;

    if (ain >= 85) {
      signal = "FAIR";
      recommendation = `The ${modelType} shows excellent neutrality. Output distribution is well-balanced — no significant prediction bias detected.`;
    } else if (ain >= 65) {
      signal = "ACCEPTABLE";
      recommendation = `${modelType} fairness is adequate. Minor distributional skew exists but within standard thresholds for production deployment.`;
    } else if (ain >= 45) {
      signal = "REVIEW_NEEDED";
      recommendation = `The ${modelType} shows moderate bias. Review training data for class imbalance. Consider resampling or weighted loss functions.`;
    } else if (ain >= 25) {
      signal = "BIASED";
      recommendation = `Significant bias in ${modelType} outputs. The model strongly favors certain classes/outcomes. Retraining with balanced data recommended.`;
    } else {
      signal = "CRITICALLY_BIASED";
      recommendation = `Critical bias detected. The ${modelType} is essentially a constant predictor — outputs are dominated by one class. Do not deploy.`;
    }

    return {
      summary: `${modelType} Fairness: AIN ${ain}/100 — ${signal}`,
      ain,
      status: result.ain_status,
      signal,
      details: {
        "AIN Score": ain,
        "Fairness Status": result.ain_status,
        "Output Bias": +(result.bias.toFixed(4)),
        "Deviation": +(result.deviation.toFixed(6)),
        "Classes/Outputs": result.d,
        "Tokens Used": result.tokens_used,
        "Compute Time": `${result.compute_ms}ms`,
      },
      recommendation,
    };
  },

  interpretSweep(result: SweepResponse, input: Record<string, unknown>): string {
    const modelType = (input.model_type as string) ?? "model";
    let summary = `## ${modelType} Fairness Sweep (d=${result.d})\n\n`;
    summary += `How the ${modelType} would score across bias levels:\n\n`;
    summary += `| Bias | AIN | Status |\n|------|-----|--------|\n`;

    for (const r of result.results) {
      summary += `| ${r.bias.toFixed(2)} | ${Math.round(r.ain * 100)}% | ${r.status} |\n`;
    }

    summary += `\n**Tokens:** ${result.total_tokens} | **Time:** ${result.compute_ms}ms`;
    return summary;
  },
};
