/**
 * AI/ML tools — 4 tools for model fairness and bias detection.
 */

import { z } from "zod";
import type { Server } from "./helpers.js";
import { distributionBias, concentrationBias, clampD, distributionFairness } from "./helpers.js";
import { ZPLEngineClient } from "../engine-client.js";
import { addHistory } from "../store.js";
import { ainScale, fmtAin } from "../ain-format.js";

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
        const ain = ainScale(result.ain);
        const total = counts.reduce((s, v) => s + v, 0);
        const label = model_name ?? "Model";

        // AUDIT 2026-07-31: the headline was the AIN, which is the number the
        // verdict below stopped trusting. Left there, the fixed tool printed
        // "AIN 0.00/100" directly above "well-distributed" for a 50/50 split —
        // trading an inverted verdict for a self-contradicting one, since the
        // headline is what gets read. It now leads with the measure the verdict
        // actually uses, and AIN is reported plainly as the separate reading it
        // is.
        const fair = distributionFairness(counts);
        let text = `## ${label} Bias — class balance ${fair.fairness.toFixed(1)}/100\n\n`;
        text += `**Engine AIN:** ${fmtAin(ain)}/100 — the engine's own reading, not the class balance.\n\n`;
        text += `| Class | Predictions | Share | ${predictions[0].avg_confidence !== undefined ? "Confidence |" : ""}\n`;
        text += `|-------|-------------|-------|${predictions[0].avg_confidence !== undefined ? "------------|" : ""}\n`;
        for (const p of predictions) {
          text += `| ${p.class_name} | ${p.count} | ${((p.count / total) * 100).toFixed(1)}% |`;
          if (p.avg_confidence !== undefined) text += ` ${(p.avg_confidence * 100).toFixed(1)}% |`;
          text += `\n`;
        }

        // AUDIT 2026-07-31: these bands read `ain`, and the verdict came out
        // exactly inverted. Measured against the live engine:
        //
        //   500 / 500  (perfectly balanced) -> AIN 0/100  "Severe prediction bias"
        //   990 /  10  (99:1)               -> AIN 87/100 "well-distributed"
        //
        // Same cause as the loot-table inversion fixed on 2026-07-30, in a file
        // that already carried the diagnosis: distributionBias measures
        // distance from uniform, 0 meaning perfectly even, and it was handed to
        // the engine's density parameter, where 0 means an all-zeros matrix and
        // the reading collapses. Balanced input therefore looked degenerate,
        // and a skewed one landed mid-range where scores are high. For two
        // classes the mapping is monotonically backwards.
        //
        // The verdict now comes from the class counts, measured locally and
        // deterministically. AIN is still shown, because it is a real reading —
        // of something else.
        if (fair.band === "fair") text += `\n**Verdict:** Model predictions are well-distributed. No significant class bias.\n`;
        else if (fair.band === "tiered") text += `\n**Verdict:** Some prediction skew. Model favors certain classes — review training data balance.\n`;
        else if (fair.band === "harsh") text += `\n**Verdict:** Marked prediction skew. A minority of classes takes most of the predictions.\n`;
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
        const ain = ainScale(result.ain);
        const total = counts.reduce((s, v) => s + v, 0);
        const label = dataset_name ?? "Dataset";

        const sorted = [...classes].sort((a, b) => b.samples - a.samples);
        // Headline leads with the measure the verdict uses — see the note in
        // zpl_model_bias above for why AIN cannot be the headline here.
        const fair = distributionFairness(counts);
        let text = `## ${label} Balance — class balance ${fair.fairness.toFixed(1)}/100\n\n`;
        text += `**Engine AIN:** ${fmtAin(ain)}/100 — the engine's own reading, not the class balance.\n\n`;
        text += `**Total samples:** ${total.toLocaleString()} | **Classes:** ${classes.length}\n\n`;
        text += `| Class | Samples | Share |\n|-------|---------|-------|\n`;
        for (const c of sorted) {
          text += `| ${c.name} | ${c.samples.toLocaleString()} | ${((c.samples / total) * 100).toFixed(1)}% |\n`;
        }

        const ratio = Math.max(...counts) / Math.max(1, Math.min(...counts));
        text += `\n**Imbalance ratio:** ${ratio.toFixed(1)}:1 (largest/smallest)\n`;

        // AUDIT 2026-07-31: same inversion as zpl_model_bias above — see the
        // note there for the measured before/after. concentrationBias is also a
        // distance-from-even measure, so a balanced dataset drove the engine's
        // density to zero and scored as severe imbalance.
        //
        // The imbalance ratio printed directly above was always correct, which
        // made the contradiction visible in the tool's own output: a 1.0:1
        // ratio sat one line above "Severe imbalance".
        if (fair.band === "fair") text += `**Verdict:** Dataset is well-balanced. Training should produce fair predictions.\n`;
        else if (fair.band === "tiered") text += `**Verdict:** Moderate imbalance. Consider oversampling minority classes or using weighted loss.\n`;
        else if (fair.band === "harsh") text += `**Verdict:** Marked imbalance. Minority classes are thin enough to hurt recall — weight the loss or resample.\n`;
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
        const ain = ainScale(result.ain);

        // Headline leads with the measure the verdict uses — see zpl_model_bias.
        const fair = distributionFairness(counts);
        let text = `## Prompt Consistency — response spread ${fair.fairness.toFixed(1)}/100\n\n`;
        text += `**Engine AIN:** ${fmtAin(ain)}/100 — the engine's own reading, not the response spread.\n\n`;
        if (prompt_description) text += `**Prompt:** ${prompt_description}\n`;
        text += `**Total runs:** ${total_runs}\n\n`;
        text += `| Response | Count | Rate |\n|----------|-------|------|\n`;
        for (const r of responses) {
          text += `| ${r.category} | ${r.count} | ${((r.count / total_runs) * 100).toFixed(1)}% |\n`;
        }

        // AUDIT 2026-07-31: same inversion as the two tools above. A prompt
        // answered evenly across categories — the definition of unbiased here —
        // drove the engine's density to zero and was reported as strong bias.
        if (fair.band === "fair") text += `\n**Verdict:** Responses are well-distributed. Model shows no strong bias on this prompt.\n`;
        else if (fair.band === "tiered") text += `\n**Verdict:** Some response preference detected. Model leans toward certain answers.\n`;
        else if (fair.band === "harsh") text += `\n**Verdict:** Marked preference. Most runs land on a small number of answers.\n`;
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
          results.push({ name: model.name, ain: ainScale(r.ain), tokens: r.tokens_used });
        }

        results.sort((a, b) => b.ain - a.ain);
        let text = `## Model Benchmark — Neutrality Ranking\n\n`;
        text += `| Rank | Model | AIN |\n|------|-------|-----|\n`;
        for (let i = 0; i < results.length; i++) {
          text += `| ${i + 1} | ${results[i].name} | ${fmtAin(results[i].ain)}/100 |\n`;
        }

        text += `\n**Metrics:** ${metrics.join(", ")}\n`;
        text += `**Most balanced:** ${results[0].name} (AIN ${fmtAin(results[0].ain)})\n`;
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
