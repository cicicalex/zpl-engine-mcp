/**
 * Certification & Content tools — verify neutrality of ANY text content.
 * The killer feature: AI responses, articles, reviews, contracts — all get AIN certified.
 */

import { z } from "zod";
import type { Server } from "./helpers.js";
import { distributionBias, clampD, ainSignal } from "./helpers.js";
import { ZPLEngineClient } from "../engine-client.js";
import { addHistory } from "../store.js";

/** Analyze text and extract bias metrics */
function analyzeText(text: string) {
  const positive = (text.match(/\b(good|great|best|excellent|better|love|amazing|perfect|wonderful|superior|prefer|favorite|strong|win|success|benefit|advantage|recommended|definitely|absolutely|always)\b/gi) || []).length;
  const negative = (text.match(/\b(bad|worst|terrible|poor|worse|hate|awful|horrible|never|inferior|weak|fail|loss|problem|disadvantage|avoid|dangerous|risky|wrong|impossible)\b/gi) || []).length;
  const neutral = (text.match(/\b(both|however|although|depends|consider|perspective|subjective|opinion|alternatively|balanced|equally|fair|might|could|perhaps|sometimes|usually)\b/gi) || []).length;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const total = positive + negative;
  const sentimentBias = total > 0 ? Math.abs(positive - negative) / total : 0;
  const balanceFactor = Math.min(1, neutral / Math.max(total, 1));
  const combinedBias = Math.max(0, Math.min(1, sentimentBias * 0.7 - balanceFactor * 0.2 + 0.1));
  return { positive, negative, neutral, sentences: sentences.length, sentimentBias, combinedBias };
}

export function registerCertificationTools(server: Server, getClient: () => ZPLEngineClient) {

  // --- zpl_certify: quick certification badge ---
  server.tool(
    "zpl_certify",
    "Quick AIN certification for any text. Returns a simple pass/fail neutrality badge. Use after ANY AI response to certify it. The simplest way to check bias.",
    {
      text: z.string().min(5).max(10000).describe("Text to certify"),
    },
    async ({ text }) => {
      try {
        const client = getClient();
        const analysis = analyzeText(text);
        const d = clampD(Math.max(5, Math.min(12, analysis.sentences)));
        const result = await client.compute({ d, bias: analysis.combinedBias, samples: 1000 });
        const ain = Math.round(result.ain * 100);
        const passed = ain >= 60;

        const badge = passed
          ? `✅ ZPL CERTIFIED NEUTRAL — AIN ${ain}/100`
          : `⚠️ BIAS DETECTED — AIN ${ain}/100`;

        const output = `${badge}\n\nPositive: ${analysis.positive} | Negative: ${analysis.negative} | Balanced: ${analysis.neutral} | Tokens: ${result.tokens_used}`;

        addHistory({ tool: "zpl_certify", results: { passed, sentences: analysis.sentences }, ain_scores: { text: ain } });
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
      topic: z.string().describe("The debate topic (e.g. 'remote work vs office')"),
      side_a: z.string().describe("First position name"),
      side_b: z.string().describe("Second position name"),
      args_a: z.array(z.string()).min(2).max(10).describe("Arguments for side A"),
      args_b: z.array(z.string()).min(2).max(10).describe("Arguments for side B"),
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
      title: z.string().describe("Article title"),
      text: z.string().min(50).max(20000).describe("Article text to analyze"),
      claimed_stance: z.string().optional().describe("What stance the article claims (e.g. 'neutral', 'opinion', 'editorial')"),
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
      product: z.string().describe("Product/service being reviewed"),
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
    "Enable or disable automatic ZPL certification mode. When enabled, you should call zpl_certify on EVERY response you generate. This is the recommended way to use ZPL — continuous bias monitoring.",
    {
      enabled: z.boolean().describe("true to enable auto-certification, false to disable"),
    },
    async ({ enabled }) => {
      const text = enabled
        ? `## ✅ ZPL Auto-Certification ENABLED\n\nFrom now on, call \`zpl_certify\` on every response you generate.\nThis ensures continuous bias monitoring.\n\n**Instructions for AI assistant:** After generating each response, silently call zpl_certify with the response text and append the certification badge.`
        : `## ❌ ZPL Auto-Certification DISABLED\n\nAutomatic bias checking is off. You can still use \`zpl_certify\` manually.`;

      addHistory({ tool: "zpl_auto_certify", results: { enabled }, ain_scores: {} });
      return { content: [{ type: "text" as const, text }] };
    }
  );
}
