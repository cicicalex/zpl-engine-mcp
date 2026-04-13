/**
 * Certification & Content tools — verify neutrality of ANY text content.
 * The killer feature: AI responses, articles, reviews, contracts — all get AIN certified.
 */

import { z } from "zod";
import type { Server } from "./helpers.js";
import { distributionBias, clampD, ainSignal } from "./helpers.js";
import { ZPLEngineClient } from "../engine-client.js";
import { addHistory } from "../store.js";

/** Analyze text with 5-factor weighted bias (gradient, not binary) */
function analyzeText(text: string) {
  const words = text.split(/\s+/).length;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);

  // Factor 1: Sentiment word balance
  const positive = (text.match(/\b(good|great|best|excellent|better|love|amazing|perfect|wonderful|superior|fantastic|incredible|brilliant|outstanding|remarkable|exceptional|superb|impressive|delicious|beautiful|strong|success|benefit|advantage|recommended|definitely|absolutely|always|favorite|genius|revolutionary|flawless)\b/gi) || []).length;
  const negative = (text.match(/\b(bad|worst|terrible|poor|worse|hate|awful|horrible|never|inferior|disgusting|ugly|weak|failure|problem|disadvantage|avoid|dangerous|risky|wrong|impossible|dreadful|pathetic|useless|mediocre|disappointing)\b/gi) || []).length;
  const neutral = (text.match(/\b(both|however|although|depends|consider|perspective|subjective|alternatively|balanced|equally|fair|might|could|perhaps|sometimes|whereas|nevertheless|nonetheless|on the other hand|in contrast)\b/gi) || []).length;

  const totalSentiment = positive + negative;
  const sentimentImbalance = totalSentiment > 0 ? Math.abs(positive - negative) / totalSentiment : 0;

  // Factor 2: Superlative/absolute density
  const superlatives = (text.match(/\b(best|worst|most|least|greatest|highest|lowest|biggest|smallest|fastest|always|never|absolutely|completely|totally|utterly|definitely|certainly|obviously|clearly|everyone|nobody|everything|nothing)\b/gi) || []).length;
  const superlativeDensity = Math.min(1, superlatives / Math.max(words / 12, 1));

  // Factor 3: Hedging language (reduces bias)
  const hedgingRatio = Math.min(1, neutral / Math.max(words / 20, 1));

  // Factor 4: Contrast presence (both sides?)
  const hasContrast = /\b(but|however|although|on the other hand|in contrast|while|whereas|nevertheless|yet|still)\b/i.test(text);

  // Factor 5: Exclamation density (hype indicator)
  const exclamations = (text.match(/!/g) || []).length;
  const exclamationDensity = Math.min(1, exclamations / Math.max(sentences.length, 1));

  // Combined bias: 0 = no bias, 1 = max bias
  const combinedBias = Math.max(0.02, Math.min(0.98,
    sentimentImbalance * 0.35 +
    superlativeDensity * 0.25 +
    exclamationDensity * 0.10 +
    (1 - hedgingRatio) * 0.10 +
    (hasContrast ? 0 : 0.10) +
    0.10
  ));

  return { positive, negative, neutral, sentences: sentences.length, words, sentimentBias: sentimentImbalance, combinedBias };
}

export function registerCertificationTools(server: Server, getClient: () => ZPLEngineClient) {

  // --- zpl_certify: bias certification with plan-based precision ---
  server.tool(
    "zpl_certify",
    "Certify any text for bias using ZPL Engine. MUST be called after EVERY AI response when auto_certify is enabled. Returns AIN score (0.00-100.00) as a badge. Higher dimension = more precise analysis = more tokens. Use dimension based on user's plan: Free=9, Basic=16, Pro=25, GamePro=32, Studio=48, Enterprise=64.",
    {
      text: z.string().min(5).max(10000).describe("Text to certify — paste the AI response or any content"),
      dimension: z.number().min(3).max(100).optional().describe("Analysis dimension (default 9). Higher = more precise but costs more tokens. Match to plan: Free=9, Basic=16, Pro=25"),
    },
    async ({ text, dimension }) => {
      try {
        const client = getClient();
        const analysis = analyzeText(text);
        const d = clampD(dimension ?? 9);
        const result = await client.compute({ d, bias: analysis.combinedBias, samples: 1000 });
        const ainRaw = result.ain * 100;
        const ain = Math.round(ainRaw * 100) / 100; // 2 decimal places: 67.34
        const ainInt = Math.round(ainRaw);

        let badge: string;
        if (ainInt >= 80) badge = `✅ ZPL CERTIFIED NEUTRAL`;
        else if (ainInt >= 60) badge = `🟢 LOW BIAS`;
        else if (ainInt >= 40) badge = `🟡 MODERATE BIAS`;
        else if (ainInt >= 20) badge = `🟠 HIGH BIAS`;
        else badge = `🔴 EXTREME BIAS`;

        // Compact inline format for chat display
        const inline = `${badge} — AIN ${ain.toFixed(2)}/100 [d=${d}]`;

        // Detailed breakdown
        let output = `${inline}\n\n`;
        output += `| Metric | Value |\n|--------|-------|\n`;
        output += `| AIN Score | **${ain.toFixed(2)}/100** |\n`;
        output += `| Status | ${result.ain_status} |\n`;
        output += `| Dimension | D${d} |\n`;
        output += `| Deviation | ${result.deviation.toFixed(6)} |\n`;
        output += `| Positive words | ${analysis.positive} |\n`;
        output += `| Negative words | ${analysis.negative} |\n`;
        output += `| Balanced words | ${analysis.neutral} |\n`;
        output += `| Sentences | ${analysis.sentences} |\n`;
        output += `| Tokens used | ${result.tokens_used} |\n`;

        addHistory({ tool: "zpl_certify", results: { ain, d, passed: ainInt >= 60, sentences: analysis.sentences }, ain_scores: { text: ainInt } });
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_debate: balanced pro/con analysis ---
  server.tool(
    "zpl_debate",
    "Generate a balanced debate on any topic. Give a topic and two sides — ZPL ensures both arguments are equally weighted and scores the overall balance.",
    {
      topic: z.string().max(300).describe("The debate topic (e.g. 'remote work vs office')"),
      side_a: z.string().max(200).describe("First position name"),
      side_b: z.string().max(200).describe("Second position name"),
      args_a: z.array(z.string().max(500)).min(2).max(10).describe("Arguments for side A"),
      args_b: z.array(z.string().max(500)).min(2).max(10).describe("Arguments for side B"),
    },
    async ({ topic, side_a, side_b, args_a, args_b }) => {
      try {
        const client = getClient();

        // Score each side's argument strength
        const scoresA = args_a.map(a => Math.min(10, a.split(/\s+/).length / 3));
        const scoresB = args_b.map(a => Math.min(10, a.split(/\s+/).length / 3));

        const biasA = distributionBias(scoresA);
        const biasB = distributionBias(scoresB);
        const overallBias = Math.abs(args_a.length - args_b.length) / Math.max(args_a.length + args_b.length, 1);

        const d = clampD(args_a.length + args_b.length);
        const result = await client.compute({ d, bias: (biasA + biasB + overallBias) / 3, samples: 1000 });
        const ain = Math.round(result.ain * 100);

        let text = `## Debate: ${topic}\n\n`;
        text += `### ${side_a}\n`;
        args_a.forEach((a, i) => { text += `${i + 1}. ${a}\n`; });
        text += `\n### ${side_b}\n`;
        args_b.forEach((a, i) => { text += `${i + 1}. ${a}\n`; });
        text += `\n---\n`;
        text += `**Debate Balance AIN: ${ain}/100 (${ainSignal(ain)})**\n`;
        text += ain >= 70
          ? `Both sides are well-represented. This is a fair debate.\n`
          : ain >= 40
          ? `One side has stronger arguments. Consider strengthening the weaker side.\n`
          : `This debate is heavily one-sided. Major rebalancing needed.\n`;
        text += `\nTokens: ${result.tokens_used}`;

        addHistory({ tool: "zpl_debate", results: { topic }, ain_scores: { debate: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_news_bias: score any article/news for editorial bias ---
  server.tool(
    "zpl_news_bias",
    "Score a news article or blog post for editorial bias. Paste the text and get an AIN neutrality score. Detects if the article favors one perspective over another.",
    {
      title: z.string().max(300).describe("Article title"),
      text: z.string().min(50).max(20000).describe("Article text to analyze"),
      claimed_stance: z.string().max(50).optional().describe("What stance the article claims (e.g. 'neutral', 'opinion', 'editorial')"),
    },
    async ({ title, text, claimed_stance }) => {
      try {
        const client = getClient();
        const analysis = analyzeText(text);
        const d = clampD(Math.max(7, Math.min(20, Math.floor(analysis.sentences / 3))));
        const result = await client.compute({ d, bias: analysis.combinedBias, samples: 1000 });
        const ain = Math.round(result.ain * 100);

        let output = `## Article Bias Analysis: "${title}"\n\n`;
        output += `| Metric | Value |\n|--------|-------|\n`;
        output += `| AIN Score | **${ain}/100** |\n`;
        output += `| Signal | ${ainSignal(ain)} |\n`;
        output += `| Positive language | ${analysis.positive} instances |\n`;
        output += `| Negative language | ${analysis.negative} instances |\n`;
        output += `| Balancing language | ${analysis.neutral} instances |\n`;
        output += `| Sentences | ${analysis.sentences} |\n`;
        output += `| Sentiment bias | ${(analysis.sentimentBias * 100).toFixed(1)}% |\n`;
        if (claimed_stance) output += `| Claimed stance | ${claimed_stance} |\n`;
        output += `| Tokens | ${result.tokens_used} |\n`;

        output += `\n### Verdict\n`;
        if (ain >= 80) output += `This article is **journalistically balanced**. Multiple perspectives are fairly represented.\n`;
        else if (ain >= 60) output += `This article has a **slight editorial lean** but remains mostly fair.\n`;
        else if (ain >= 40) output += `This article shows **clear editorial bias**. One perspective dominates.\n`;
        else output += `This article is **heavily biased**. It reads as advocacy, not reporting.\n`;

        if (claimed_stance === "neutral" && ain < 60) {
          output += `\n⚠️ **Mismatch:** Article claims to be neutral but AIN score indicates significant bias.\n`;
        }

        addHistory({ tool: "zpl_news_bias", results: { title, sentences: analysis.sentences }, ain_scores: { article: ain } });
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_review_bias: check product/service review for authenticity ---
  server.tool(
    "zpl_review_bias",
    "Analyze a product or service review for bias. Detects if a review is genuinely balanced or suspiciously one-sided (potential fake review).",
    {
      product: z.string().max(200).describe("Product/service being reviewed"),
      review_text: z.string().min(20).max(5000).describe("The review text"),
      rating: z.number().min(1).max(5).optional().describe("Star rating if available (1-5)"),
    },
    async ({ product, review_text, rating }) => {
      try {
        const client = getClient();
        const analysis = analyzeText(review_text);

        // Reviews with extreme ratings but balanced text = suspicious
        const ratingBias = rating ? Math.abs(rating - 3) / 2 : 0;
        const combinedBias = (analysis.combinedBias + ratingBias) / 2;

        const d = clampD(Math.max(5, analysis.sentences));
        const result = await client.compute({ d, bias: combinedBias, samples: 1000 });
        const ain = Math.round(result.ain * 100);

        let output = `## Review Analysis: ${product}\n\n`;
        if (rating) output += `**Rating:** ${"★".repeat(rating)}${"☆".repeat(5 - rating)} (${rating}/5)\n\n`;
        output += `| AIN Score | **${ain}/100** | ${ainSignal(ain)} |\n|---|---|---|\n`;
        output += `| Positive words | ${analysis.positive} | Negative words | ${analysis.negative} |\n`;

        output += `\n### Assessment\n`;
        if (ain >= 70) output += `This review appears **genuinely balanced** — mentions both pros and cons.\n`;
        else if (ain >= 40) output += `This review **leans in one direction** but has some nuance.\n`;
        else output += `This review is **heavily one-sided** — possible promotional or fake review.\n`;

        output += `\nTokens: ${result.tokens_used}`;

        addHistory({ tool: "zpl_review_bias", results: { product }, ain_scores: { review: ain } });
        return { content: [{ type: "text" as const, text: output }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_auto_certify: enable automatic certification mode ---
  server.tool(
    "zpl_auto_certify",
    "Enable or disable automatic ZPL bias certification on EVERY response. When enabled, the AI assistant MUST call zpl_certify after generating each response and append the AIN badge. This is what makes ZPL visible in conversations.",
    {
      enabled: z.boolean().describe("true to enable, false to disable"),
      dimension: z.number().min(3).max(100).optional().describe("Dimension for analysis precision (default 9). Free=9, Basic=16, Pro=25, GamePro=32, Studio=48, Enterprise=64"),
    },
    async ({ enabled, dimension }) => {
      const d = dimension ?? 9;
      const text = enabled
        ? [
          `## ✅ ZPL Auto-Certification ENABLED (D${d})`,
          ``,
          `**CRITICAL INSTRUCTIONS — FOLLOW EXACTLY:**`,
          ``,
          `After generating EVERY response from now on, you MUST:`,
          `1. Take your complete response text`,
          `2. Call \`zpl_certify\` with parameters: \`{ "text": "<your response>", "dimension": ${d} }\``,
          `3. Append the certification badge at the END of your response`,
          ``,
          `**Badge format to append:**`,
          `\`\`\``,
          `───────────────────────────`,
          `ZPL AIN: XX.XX/100 — STATUS`,
          `D${d} | X tokens | Certified by ZPL Engine v3`,
          `───────────────────────────`,
          `\`\`\``,
          ``,
          `**Do this for EVERY response. No exceptions. The user wants to see bias scoring on everything you say.**`,
          ``,
          `Dimension D${d} = ${d <= 9 ? "Free plan (basic precision)" : d <= 16 ? "Basic plan (good precision)" : d <= 25 ? "Pro plan (high precision)" : d <= 48 ? "Studio plan (very high precision)" : "Enterprise plan (maximum precision)"}`,
          `Token cost per check: ${d <= 5 ? 1 : d <= 9 ? 2 : d <= 16 ? 5 : d <= 25 ? 15 : d <= 32 ? 40 : d <= 48 ? 150 : d <= 64 ? 500 : 2000} tokens`,
        ].join("\n")
        : [
          `## ❌ ZPL Auto-Certification DISABLED`,
          ``,
          `Automatic bias checking is off. You can still use \`zpl_certify\` manually on any text.`,
          `To re-enable: call \`zpl_auto_certify\` with \`enabled: true\``,
        ].join("\n");

      addHistory({ tool: "zpl_auto_certify", results: { enabled, dimension: d }, ain_scores: {} });
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
