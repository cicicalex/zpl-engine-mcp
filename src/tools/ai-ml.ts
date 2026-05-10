/**
 * AI/ML tools — 4 tools for model fairness and bias detection.
 */

import { z } from "zod";
import type { Server } from "./helpers.js";
import { distributionBias, concentrationBias, clampD } from "./helpers.js";
import { ZPLEngineClient } from "../engine-client.js";
import { addHistory } from "../store.js";

export function registerAIMLTools(server: Server, getClient: () => ZPLEngineClient) {

  // --- zpl_model_bias: full model output bias analysis ---
  server.tool(
    "zpl_model_bias",
    "Analyze ML model output bias. Provide prediction distributions, confidence scores, or class outputs. Detects whether the model favors certain predictions over others.",
    {
      predictions: z.array(z.object({
        class_name: z.string().max(100).describe("Class/category name"),
        count: z.number().min(0).describe("Number of predictions in this class"),
        avg_confidence: z.number().min(0).max(1).optional().describe("Average confidence for this class"),
      })).min(2).max(50).describe("Prediction distribution across classes"),
      model_name: z.string().max(200).optional().describe("Model name for label"),
      threshold: z.number().optional().describe("Decision threshold (default 0.5)"),
    },
    async ({ predictions, model_name, threshold }) => {
      try {
        const client = getClient();
        const counts = predictions.map((p) => p.count);
        const d = clampD(counts.length);
        const bias = distributionBias(counts);
        const result = await client.compute({ d, bias, samples: 3000 });
        const ain = Math.round(result.ain * 100);
        const total = counts.reduce((s, v) => s + v, 0);
        const label = model_name ?? "Model";

        let text = `## ${label} Bias — AIN ${ain}/100\n\n`;
        text += `| Class | Predictions | Share | ${predictions[0].avg_confidence !== undefined ? "Confidence |" : ""}\n`;
        text += `|-------|-------------|-------|${predictions[0].avg_confidence !== undefined ? "------------|" : ""}\n`;
        for (const p of predictions) {
          text += `| ${p.class_name} | ${p.count} | ${((p.count / total) * 100).toFixed(1)}% |`;
          if (p.avg_confidence !== undefined) text += ` ${(p.avg_confidence * 100).toFixed(1)}% |`;
          text += `\n`;
        }

        if (ain >= 70) text += `\n**Verdict:** Model predictions are well-distributed. No significant class bias.\n`;
        else if (ain >= 40) text += `\n**Verdict:** Some prediction skew. Model favors certain classes — review training data balance.\n`;
        else text += `\n**Verdict:** Severe prediction bias. Model is effectively ignoring minority classes. Retrain with balanced data.\n`;

        if (threshold !== undefined) text += `**Threshold:** ${threshold}\n`;
        text += `**Tokens:** ${result.tokens_used}`;

        addHistory({ tool: "zpl_model_bias", domain: "ai", results: { model_name, classes: predictions.map((p) => p.class_name), tokens_used: result.tokens_used }, ain_scores: { [label]: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_dataset_audit: training dataset balance ---
  server.tool(
    "zpl_dataset_audit",
    "Audit training dataset for class imbalance. Provide sample counts per class/category. Detects whether the dataset will cause model bias during training.",
    {
      classes: z.array(z.object({
        name: z.string().max(100),
        samples: z.number().int().min(0),
      })).min(2).max(100).describe("Dataset classes with sample counts"),
      dataset_name: z.string().max(200).optional(),
    },
    async ({ classes, dataset_name }) => {
      try {
        const client = getClient();
        const counts = classes.map((c) => c.samples);
        const d = clampD(counts.length);
        const bias = concentrationBias(counts);
        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);
        const total = counts.reduce((s, v) => s + v, 0);
        const label = dataset_name ?? "Dataset";

        const sorted = [...classes].sort((a, b) => b.samples - a.samples);
        let text = `## ${label} Balance — AIN ${ain}/100\n\n`;
        text += `**Total samples:** ${total.toLocaleString()} | **Classes:** ${classes.length}\n\n`;
        text += `| Class | Samples | Share |\n|-------|---------|-------|\n`;
        for (const c of sorted) {
          text += `| ${c.name} | ${c.samples.toLocaleString()} | ${((c.samples / total) * 100).toFixed(1)}% |\n`;
        }

        const ratio = Math.max(...counts) / Math.max(1, Math.min(...counts));
        text += `\n**Imbalance ratio:** ${ratio.toFixed(1)}:1 (largest/smallest)\n`;

        if (ain >= 70) text += `**Verdict:** Dataset is well-balanced. Training should produce fair predictions.\n`;
        else if (ain >= 40) text += `**Verdict:** Moderate imbalance. Consider oversampling minority classes or using weighted loss.\n`;
        else text += `**Verdict:** Severe imbalance. Model will be biased. Use SMOTE, class weights, or undersample majority.\n`;

        text += `**Tokens:** ${result.tokens_used}`;
        addHistory({ tool: "zpl_dataset_audit", domain: "ai", results: { dataset_name, classes: classes.map((c) => c.name), tokens_used: result.tokens_used }, ain_scores: { [label]: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_prompt_test: prompt consistency/bias ---
  server.tool(
    "zpl_prompt_test",
    "Test AI prompt for consistency and bias. Run the same prompt multiple times and provide the distribution of response types/sentiments. Detects if the model gives biased or inconsistent answers.",
    {
      responses: z.array(z.object({
        category: z.string().max(100).describe("Response category (e.g. 'positive', 'negative', 'neutral' or 'option A', 'option B')"),
        count: z.number().int().min(0).describe("How many times this response was given"),
      })).min(2).max(20).describe("Response distribution across categories"),
      total_runs: z.number().int().min(2).describe("Total number of prompt runs"),
      prompt_description: z.string().max(500).optional().describe("What the prompt asked"),
    },
    async ({ responses, total_runs, prompt_description }) => {
      try {
        const client = getClient();
        const counts = responses.map((r) => r.count);
        const d = clampD(counts.length);
        const bias = distributionBias(counts);
        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);

        let text = `## Prompt Consistency — AIN ${ain}/100\n\n`;
        if (prompt_description) text += `**Prompt:** ${prompt_description}\n`;
        text += `**Total runs:** ${total_runs}\n\n`;
        text += `| Response | Count | Rate |\n|----------|-------|------|\n`;
        for (const r of responses) {
          text += `| ${r.category} | ${r.count} | ${((r.count / total_runs) * 100).toFixed(1)}% |\n`;
        }

        if (ain >= 70) text += `\n**Verdict:** Responses are well-distributed. Model shows no strong bias on this prompt.\n`;
        else if (ain >= 40) text += `\n**Verdict:** Some response preference detected. Model leans toward certain answers.\n`;
        else text += `\n**Verdict:** Strong bias. Model consistently favors one response. This prompt triggers biased behavior.\n`;

        text += `**Tokens:** ${result.tokens_used}`;
        addHistory({ tool: "zpl_prompt_test", domain: "ai", results: { prompt_description, total_runs, tokens_used: result.tokens_used }, ain_scores: { prompt: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_benchmark: compare models on neutrality ---
  server.tool(
    "zpl_benchmark",
    "Compare multiple AI models on neutrality/fairness. Provide performance metrics for each model. Returns which model is most balanced across all metrics.",
    {
      models: z.array(z.object({
        name: z.string().max(200).describe("Model name"),
        scores: z.array(z.number()).min(2).max(50).describe("Performance scores across metrics (same metrics for all)"),
      })).min(2).max(10).describe("Models to compare"),
      metrics: z.array(z.string().max(100)).min(2).max(50).describe("Metric names (same order as scores)"),
    },
    async ({ models, metrics }) => {
      try {
        const client = getClient();
        const results: { name: string; ain: number; tokens: number }[] = [];

        for (const model of models) {
          const d = clampD(model.scores.length);
          const norm = model.scores.map((s) => Math.abs(s));
          const mean = norm.reduce((s, v) => s + v, 0) / norm.length;
          const variance = norm.reduce((s, v) => s + (v - mean) ** 2, 0) / norm.length;
          const bias = Math.min(1, Math.sqrt(variance) / (mean || 1));
          const r = await client.compute({ d, bias, samples: 1000 });
          results.push({ name: model.name, ain: Math.round(r.ain * 100), tokens: r.tokens_used });
        }

        results.sort((a, b) => b.ain - a.ain);
        let text = `## Model Benchmark — Neutrality Ranking\n\n`;
        text += `| Rank | Model | AIN |\n|------|-------|-----|\n`;
        for (let i = 0; i < results.length; i++) {
          text += `| ${i + 1} | ${results[i].name} | ${results[i].ain}/100 |\n`;
        }

        text += `\n**Metrics:** ${metrics.join(", ")}\n`;
        text += `**Most balanced:** ${results[0].name} (AIN ${results[0].ain})\n`;
        text += `**Total tokens:** ${results.reduce((s, r) => s + r.tokens, 0)}`;

        const scores: Record<string, number> = {};
        for (const r of results) scores[r.name] = r.ain;
        addHistory({ tool: "zpl_benchmark", domain: "ai", results: { models: models.map((m) => m.name), metrics, tokens_used: results.reduce((s, r) => s + r.tokens, 0) }, ain_scores: scores });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );
}
