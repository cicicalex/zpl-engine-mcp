/**
 * Certification & Content tools — verify neutrality of ANY text content.
 * The killer feature: AI responses, articles, reviews, contracts — all get AIN certified.
 */

import { z } from "zod";
import type { Server } from "./helpers.js";
import { distributionBias, clampD, ainSignal, maybeRedactForPureMode } from "./helpers.js";
import { ZPLEngineClient } from "../engine-client.js";
import { addHistory } from "../store.js";

/** Analyze text with 6-factor weighted bias (gradient, not binary).
 *  Multilingual: EN + RO + FR + DE + ES + IT keyword detection.
 *  Adds symmetric uniformity penalty: texts that are 100% positive OR 100% negative
 *  (propaganda pattern, regardless of language) get a uniformity bonus to bias score. */
function analyzeText(text: string) {
  const words = text.split(/\s+/).length;
  const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);

  // Factor 1: Sentiment word balance — multilingual (EN/RO/FR/DE/ES/IT)
  const positive = (text.match(/\b(good|great|best|excellent|better|love|amazing|perfect|wonderful|superior|fantastic|incredible|brilliant|outstanding|remarkable|exceptional|superb|impressive|delicious|beautiful|strong|success|benefit|advantage|recommended|definitely|absolutely|always|favorite|genius|revolutionary|flawless|bun|grozav|minunat|suprem|absolut|incontestabil|total|exceptional|extraordinar|fenomenal|genial|magnific|indispensabil|esential|vital|neegalat|copilesit|divin|sacru|bon|excellent|parfait|supreme|absolu|fantastique|extraordinaire|magnifique|sublime|indispensable|gut|ausgezeichnet|perfekt|hervorragend|fantastisch|einzigartig|unschlagbar|bueno|excelente|perfecto|supremo|absoluto|fantastico|extraordinario|buono|eccellente|perfetto|assoluto|totale)\b/giu) || []).length;
  const negative = (text.match(/\b(bad|worst|terrible|poor|worse|hate|awful|horrible|never|inferior|disgusting|ugly|weak|failure|problem|disadvantage|avoid|dangerous|risky|wrong|impossible|dreadful|pathetic|useless|mediocre|disappointing|rau|oribil|ororar|ingrozitor|dezastros|fals|mincinos|criminal|distrugator|jenant|lamentabil|slab|mediocru|mauvais|horrible|terrible|faux|criminel|lamentable|schlecht|schrecklich|furchtbar|falsch|kriminell|malo|horrible|terrible|falso|criminal|cattivo|orribile|terribile|falso|criminale)\b/giu) || []).length;
  const neutral = (text.match(/\b(both|however|although|depends|consider|perspective|subjective|alternatively|balanced|equally|fair|might|could|perhaps|sometimes|whereas|nevertheless|nonetheless|on the other hand|in contrast|totusi|desi|totodata|depinde|pe de o parte|pe de alta parte|ambele|echilibrat|cependant|toutefois|malgre|equilibre|jedoch|allerdings|dennoch|ausgewogen|sin embargo|no obstante|equilibrado|tuttavia|comunque|equilibrato)\b/giu) || []).length;

  const totalSentiment = positive + negative;
  const sentimentImbalance = totalSentiment > 0 ? Math.abs(positive - negative) / totalSentiment : 0;

  // Factor 2: Superlative/absolute density — multilingual
  const superlatives = (text.match(/\b(best|worst|most|least|greatest|highest|lowest|biggest|smallest|fastest|always|never|absolutely|completely|totally|utterly|definitely|certainly|obviously|clearly|everyone|nobody|everything|nothing|suprem|absolut|total|mereu|niciodata|complet|sigur|evident|tuturor|nimeni|totul|nimic|supreme|absolu|total|toujours|jamais|completement|certainement|evidemment|absolut|total|immer|niemals|vollstaendig|sicher|offensichtlich|supremo|absoluto|total|siempre|nunca|completamente|seguramente|obviamente|supremo|assoluto|totale|sempre|mai|completamente|certamente|ovviamente)\b/giu) || []).length;
  const superlativeDensity = Math.min(1, superlatives / Math.max(words / 12, 1));

  // Factor 3: Hedging language (reduces bias)
  const hedgingRatio = Math.min(1, neutral / Math.max(words / 20, 1));

  // Factor 4: Contrast presence (both sides?) — multilingual
  const hasContrast = /\b(but|however|although|on the other hand|in contrast|while|whereas|nevertheless|yet|still|dar|insa|totusi|desi|pe de o parte|pe de alta parte|in schimb|mais|cependant|toutefois|malgre|aber|jedoch|allerdings|dennoch|pero|sin embargo|no obstante|ma|pero|tuttavia|comunque)\b/iu.test(text);

  // Factor 5: Exclamation density (hype indicator)
  const exclamations = (text.match(/!/g) || []).length;
  const exclamationDensity = Math.min(1, exclamations / Math.max(sentences.length, 1));

  // Factor 6: Pure uniformity — text is 100% positive OR 100% negative (symmetric propaganda trap)
  // Catches texts that are ONLY praise or ONLY condemnation, regardless of language
  const pureUniformity = ((positive > 0 && negative === 0) || (negative > 0 && positive === 0)) ? 1 : 0;

  // Combined bias: 0 = no bias, 1 = max bias
  // Weights sum to 0.90 + base 0.08 = max 0.98
  const combinedBias = Math.max(0.02, Math.min(0.98,
    sentimentImbalance * 0.25 +
    superlativeDensity * 0.20 +
    exclamationDensity * 0.10 +
    (1 - hedgingRatio) * 0.10 +
    (hasContrast ? 0 : 0.05) +
    pureUniformity * 0.20 +
    0.08
  ));

  return { positive, negative, neutral, sentences: sentences.length, words, sentimentBias: sentimentImbalance, combinedBias };
}

export function registerCertificationTools(server: Server, getClient: () => ZPLEngineClient) {

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

  // --- zpl_news_bias: language-balance score for any article ---
  server.tool(
    "zpl_news_bias",
    "Compute a language-balance score (AIN) for an article: the ratio of positive/negative/neutral wording, sentence-structure variance, and hedging density. Does NOT determine whether the article is true, factually correct, or editorially biased — only the linguistic balance of its wording. Use to flag articles for human review, not to certify them. LIMITATIONS: Detects tonal/linguistic balance only. Does NOT detect factual accuracy, propaganda presented in calm tone, or non-English/Romance language nuance reliably. Use as ONE signal among many — never as a verdict.",
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

        let output = `## Language Balance Score: "${title}"\n\n`;
        output += `| Metric | Value |\n|--------|-------|\n`;
        output += `| Language Balance (AIN) | **${ain}/100** |\n`;
        output += `| Signal | ${ainSignal(ain)} |\n`;
        output += `| Positive-coded words | ${analysis.positive} |\n`;
        output += `| Negative-coded words | ${analysis.negative} |\n`;
        output += `| Hedging / contrast words | ${analysis.neutral} |\n`;
        output += `| Sentences analyzed | ${analysis.sentences} |\n`;
        if (claimed_stance) output += `| Claimed stance (informational only) | ${claimed_stance} |\n`;
        output += `| Tokens | ${result.tokens_used} |\n`;

        output += `\n### Reading\n`;
        if (ain >= 80) output += `Linguistic balance is high — wording uses comparable amounts of positive, negative, and hedging language.\n`;
        else if (ain >= 60) output += `Slight linguistic skew toward one tone, but within typical editorial range.\n`;
        else if (ain >= 40) output += `Notable linguistic skew. The wording leans clearly in one direction.\n`;
        else output += `Heavy linguistic skew. The wording is one-sided in tone.\n`;

        output += `\n> **Important:** This score reflects the **wording**, not the **truth** or **editorial intent** of the article. ` +
          `An article can be linguistically balanced and factually wrong, or linguistically skewed and factually correct. ` +
          `Use this score to prioritize human review, not to certify content as "biased" or "neutral".\n`;

        addHistory({ tool: "zpl_news_bias", results: { title, sentences: analysis.sentences }, ain_scores: { article: ain } });

        const finalText = maybeRedactForPureMode({
          ain,
          tokens: result.tokens_used,
          fullText: output,
          toolName: "zpl_news_bias",
        });
        return { content: [{ type: "text" as const, text: finalText }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_review_bias: language-balance score for a review ---
  server.tool(
    "zpl_review_bias",
    "Compute a language-balance score (AIN) for a single review: the wording's positive/negative/hedging mix relative to the star rating. A low score means the wording is one-sided. Does NOT determine if the review is fake, paid, or untruthful — only that the wording is unbalanced. Use to flag reviews for moderation, not to certify them as inauthentic. LIMITATIONS: Detects tonal/linguistic balance only. Does NOT detect factual accuracy, propaganda presented in calm tone, or non-English/Romance language nuance reliably. Use as ONE signal among many — never as a verdict.",
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

        let output = `## Review Wording Balance: ${product}\n\n`;
        if (rating) output += `**Rating provided:** ${"★".repeat(rating)}${"☆".repeat(5 - rating)} (${rating}/5)\n\n`;
        output += `| Metric | Value |\n|---|---|\n`;
        output += `| Language Balance (AIN) | **${ain}/100** (${ainSignal(ain)}) |\n`;
        output += `| Positive-coded words | ${analysis.positive} |\n`;
        output += `| Negative-coded words | ${analysis.negative} |\n`;
        output += `| Hedging words | ${analysis.neutral} |\n`;

        output += `\n### Reading\n`;
        if (ain >= 70) output += `Wording is balanced — mentions both positive and negative aspects.\n`;
        else if (ain >= 40) output += `Wording leans in one direction but contains some balancing language.\n`;
        else output += `Wording is heavily one-sided in tone.\n`;

        output += `\n> **Important:** Wording balance is a weak signal of authenticity. Genuine reviews can be one-sided ` +
          `(strong opinion), and fake reviews can be linguistically balanced (skilled writer). ` +
          `Use this for triage only, not as a verdict on whether the review is real.\n`;

        output += `\nTokens: ${result.tokens_used}`;

        addHistory({ tool: "zpl_review_bias", results: { product }, ain_scores: { review: ain } });

        const finalText = maybeRedactForPureMode({
          ain,
          tokens: result.tokens_used,
          fullText: output,
          toolName: "zpl_review_bias",
        });
        return { content: [{ type: "text" as const, text: finalText }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

}
