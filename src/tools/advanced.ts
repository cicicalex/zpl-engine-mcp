/**
 * Advanced tools — 8 wow-factor tools that differentiate ZPL from everything else.
 * Created by Ciciu Alexandru-Costinel — Zero Point Logic
 */

import { z } from "zod";
import type { Server } from "./helpers.js";
import { distributionBias, directionalBias, concentrationBias, clampD, ainSignal } from "./helpers.js";
import { ZPLEngineClient } from "../engine-client.js";
import { addHistory, getHistory } from "../store.js";

export function registerAdvancedTools(server: Server, getClient: () => ZPLEngineClient) {

  // --- zpl_versus: auto-compare anything (fetches data itself) ---
  server.tool(
    "zpl_versus",
    `Compare 2-10 items head-to-head with automatic AIN scoring. Provide items with their key metrics — the engine scores each one's balance and picks the most neutral/stable. Works for anything: coins, stocks, frameworks, games, countries, companies.

Example: "BTC vs ETH vs SOL" with market cap, volume, price change → instant AIN ranking.
Example: "React vs Vue vs Svelte" with performance, ecosystem, learning curve → balanced winner.`,
    {
      title: z.string().describe("Comparison title (e.g. 'Top 3 Cryptos Q2 2026')"),
      items: z.array(z.object({
        name: z.string(),
        metrics: z.array(z.number().min(0).max(100)).min(3).describe("Metric scores 0-100 (normalized)"),
      })).min(2).max(10).describe("Items to compare with normalized metrics"),
      metric_names: z.array(z.string()).min(3).describe("Names of the metrics"),
    },
    async ({ title, items, metric_names }) => {
      try {
        const client = getClient();
        const results: { name: string; ain: number; status: string; tokens: number }[] = [];

        for (const item of items) {
          const d = clampD(item.metrics.length);
          const bias = distributionBias(item.metrics);
          const r = await client.compute({ d, bias, samples: 1000 });
          results.push({
            name: item.name,
            ain: Math.round(r.ain * 100),
            status: r.ain_status,
            tokens: r.tokens_used,
          });
        }

        results.sort((a, b) => b.ain - a.ain);

        let text = `## ${title}\n\n`;

        // Podium
        text += `### Ranking by Mathematical Balance\n\n`;
        for (let i = 0; i < results.length; i++) {
          const medal = i === 0 ? "1st" : i === 1 ? "2nd" : i === 2 ? "3rd" : `${i + 1}th`;
          const bar = "=".repeat(Math.round(results[i].ain / 5));
          text += `**${medal} ${results[i].name}** — AIN ${results[i].ain}/100 (${results[i].status})\n`;
          text += `\`[${bar}${"·".repeat(20 - Math.round(results[i].ain / 5))}]\`\n\n`;
        }

        // Metrics table
        text += `### Metrics Breakdown\n\n`;
        text += `| Metric |`;
        for (const item of items) text += ` ${item.name} |`;
        text += `\n|--------|`;
        for (let i = 0; i < items.length; i++) text += `--------|`;
        text += `\n`;

        for (let m = 0; m < metric_names.length; m++) {
          text += `| ${metric_names[m]} |`;
          for (const item of items) text += ` ${item.metrics[m]}/100 |`;
          text += `\n`;
        }

        text += `\n**Winner:** ${results[0].name} (AIN ${results[0].ain}) — most mathematically balanced\n`;
        text += `**Total tokens:** ${results.reduce((s, r) => s + r.tokens, 0)}`;

        const scores: Record<string, number> = {};
        for (const r of results) scores[r.name] = r.ain;
        addHistory({ tool: "zpl_versus", results: { title, items: items.map((i) => i.name) }, ain_scores: scores });

        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_simulate: what-if scenario analysis ---
  server.tool(
    "zpl_simulate",
    `What-if scenario analysis. "What happens if BTC drops 20%?" "What if I remove one class from my game?" Run the current state, then the modified state, compare AIN before vs after.

Powerful for risk planning, game balancing, portfolio stress testing.`,
    {
      scenario: z.string().describe("Describe the scenario (e.g. 'BTC crashes 20%')"),
      baseline: z.array(z.number()).min(3).max(50).describe("Current state values"),
      modified: z.array(z.number()).min(3).max(50).describe("Modified state values (same length as baseline)"),
      labels: z.array(z.string()).optional().describe("Labels for each value"),
    },
    async ({ scenario, baseline, modified, labels }) => {
      try {
        if (baseline.length !== modified.length) {
          return { content: [{ type: "text" as const, text: "Error: baseline and modified must have same length" }], isError: true };
        }

        const client = getClient();
        const d = clampD(baseline.length);

        const biasBase = directionalBias(baseline);
        const biasMod = directionalBias(modified);

        const [resultBase, resultMod] = await Promise.all([
          client.compute({ d, bias: biasBase, samples: 2000 }),
          client.compute({ d, bias: biasMod, samples: 2000 }),
        ]);

        const ainBase = Math.round(resultBase.ain * 100);
        const ainMod = Math.round(resultMod.ain * 100);
        const delta = ainMod - ainBase;

        let text = `## Simulation: ${scenario}\n\n`;

        // Before vs After
        text += `| | Before | After | Change |\n|---|--------|-------|--------|\n`;
        text += `| **AIN** | ${ainBase}/100 | ${ainMod}/100 | ${delta > 0 ? "+" : ""}${delta} |\n`;
        text += `| **Status** | ${resultBase.ain_status} | ${resultMod.ain_status} | |\n`;
        text += `| **Signal** | ${ainSignal(ainBase)} | ${ainSignal(ainMod)} | |\n`;

        // Detail table
        if (labels) {
          text += `\n### Value Changes\n\n`;
          text += `| Factor | Before | After | Change |\n|--------|--------|-------|--------|\n`;
          for (let i = 0; i < baseline.length; i++) {
            const change = modified[i] - baseline[i];
            const label = labels[i] ?? `Factor ${i + 1}`;
            text += `| ${label} | ${baseline[i]} | ${modified[i]} | ${change > 0 ? "+" : ""}${change.toFixed(2)} |\n`;
          }
        }

        // Verdict
        text += `\n### Verdict\n\n`;
        if (delta > 10) text += `**POSITIVE:** This scenario significantly improves stability (+${delta} AIN). The system becomes more balanced.\n`;
        else if (delta > 0) text += `**SLIGHTLY POSITIVE:** Marginal improvement (+${delta} AIN). Minor positive effect on balance.\n`;
        else if (delta === 0) text += `**NEUTRAL:** No change in stability. This scenario has no measurable impact.\n`;
        else if (delta > -10) text += `**SLIGHTLY NEGATIVE:** Minor instability introduced (${delta} AIN). Monitor but not critical.\n`;
        else text += `**NEGATIVE:** This scenario significantly destabilizes the system (${delta} AIN). Proceed with caution!\n`;

        text += `\n**Tokens:** ${resultBase.tokens_used + resultMod.tokens_used}`;

        addHistory({ tool: "zpl_simulate", results: { scenario, delta }, ain_scores: { before: ainBase, after: ainMod } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_certificate: generate ZPL Certified badge ---
  server.tool(
    "zpl_certificate",
    `Generate a "ZPL Certified" neutrality certificate for a game, model, protocol, or system. Runs a comprehensive analysis and issues a certificate with AIN score, grade, and timestamp.

Grades: A+ (90-99.9), A (80-89), B (60-79), C (40-59), D (20-39), F (0-19)
Use this to certify game balance, AI fairness, token distribution, or any system's neutrality.`,
    {
      subject: z.string().describe("What is being certified (e.g. 'Legends of Aria — Loot System')"),
      category: z.string().describe("Category: 'game-balance', 'ai-fairness', 'token-distribution', 'market-stability', 'security-posture', 'custom'"),
      values: z.array(z.number()).min(3).max(50).describe("The data to certify (distribution values, scores, metrics)"),
      certified_by: z.string().optional().describe("Organization requesting certification"),
    },
    async ({ subject, category, values, certified_by }) => {
      try {
        const client = getClient();
        const d = clampD(values.length);
        const bias = distributionBias(values);

        // Run with high samples for certification accuracy
        const result = await client.compute({ d, bias, samples: 5000 });
        const ain = Math.round(result.ain * 100);

        // Grade
        let grade: string;
        let verdict: string;
        if (ain >= 90) { grade = "A+"; verdict = "EXCEPTIONAL — Certified Neutral"; }
        else if (ain >= 80) { grade = "A"; verdict = "EXCELLENT — Certified Neutral"; }
        else if (ain >= 70) { grade = "B+"; verdict = "GOOD — Certified with minor notes"; }
        else if (ain >= 60) { grade = "B"; verdict = "ACCEPTABLE — Certified with recommendations"; }
        else if (ain >= 40) { grade = "C"; verdict = "BELOW STANDARD — Not certified, improvements needed"; }
        else if (ain >= 20) { grade = "D"; verdict = "POOR — Failed certification"; }
        else { grade = "F"; verdict = "CRITICAL — Failed certification, major issues"; }

        const passed = ain >= 60;
        const now = new Date();
        const certId = `ZPL-CERT-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

        let text = `\n`;
        text += `╔══════════════════════════════════════════════════════╗\n`;
        text += `║                                                      ║\n`;
        text += `║           ZERO POINT LOGIC — CERTIFICATE             ║\n`;
        text += `║                                                      ║\n`;
        text += `║   ${passed ? "CERTIFIED NEUTRAL" : "CERTIFICATION FAILED"}                             ║\n`;
        text += `║                                                      ║\n`;
        text += `║   Subject: ${subject.slice(0, 42).padEnd(42)} ║\n`;
        text += `║   Category: ${category.slice(0, 41).padEnd(41)} ║\n`;
        text += `║                                                      ║\n`;
        text += `║   ┌────────────────────────────────┐                 ║\n`;
        text += `║   │  AIN Score:  ${String(ain).padStart(3)}/100             │                 ║\n`;
        text += `║   │  Grade:      ${grade.padEnd(20)} │                 ║\n`;
        text += `║   │  Status:     ${result.ain_status.padEnd(20)}│                 ║\n`;
        text += `║   │  Deviation:  ${result.deviation.toFixed(6).padEnd(20)}│                 ║\n`;
        text += `║   │  Dimension:  ${String(d).padEnd(20)} │                 ║\n`;
        text += `║   │  Samples:    5,000              │                 ║\n`;
        text += `║   └────────────────────────────────┘                 ║\n`;
        text += `║                                                      ║\n`;
        text += `║   Verdict: ${verdict.slice(0, 42).padEnd(42)} ║\n`;
        text += `║                                                      ║\n`;
        text += `║   Certificate ID: ${certId}                  ║\n`;
        text += `║   Date: ${now.toISOString().slice(0, 10)}                                    ║\n`;
        if (certified_by) {
          text += `║   Requested by: ${certified_by.slice(0, 36).padEnd(36)} ║\n`;
        }
        text += `║                                                      ║\n`;
        text += `║   Powered by ZPL Engine v0.1.0                       ║\n`;
        text += `║   Created by Ciciu Alexandru-Costinel                 ║\n`;
        text += `║   https://zeropointlogic.io                          ║\n`;
        text += `║                                                      ║\n`;
        text += `╚══════════════════════════════════════════════════════╝\n`;

        addHistory({ tool: "zpl_certificate", results: { subject, category, grade, passed, certId }, ain_scores: { [subject]: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_predict: stability trend prediction ---
  server.tool(
    "zpl_predict",
    `Predict stability trend from historical data. Provide a time series (3+ data points). The engine analyzes whether the system is becoming more stable, less stable, or flat — and how confident the prediction is.

Not a price predictor — predicts STABILITY trajectory.`,
    {
      series: z.array(z.number()).min(3).max(100).describe("Time series data points (chronological order)"),
      label: z.string().optional().describe("What this data represents"),
      window: z.number().int().min(2).max(20).optional().default(3).describe("Analysis window size"),
    },
    async ({ series, label, window }) => {
      try {
        const client = getClient();
        const name = label ?? "Series";

        // Compute AIN for sliding windows
        const ains: number[] = [];
        for (let i = 0; i <= series.length - window; i++) {
          const slice = series.slice(i, i + window);
          const d = clampD(slice.length);
          const bias = directionalBias(slice);
          const r = await client.compute({ d, bias, samples: 500 });
          ains.push(Math.round(r.ain * 100));
        }

        // Trend analysis
        const firstHalf = ains.slice(0, Math.floor(ains.length / 2));
        const secondHalf = ains.slice(Math.floor(ains.length / 2));
        const avgFirst = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
        const avgSecond = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;
        const trend = avgSecond - avgFirst;

        let trendLabel: string;
        if (trend > 10) trendLabel = "STABILIZING — getting more neutral over time";
        else if (trend > 3) trendLabel = "SLIGHTLY IMPROVING — minor stability gain";
        else if (trend > -3) trendLabel = "FLAT — stability unchanged";
        else if (trend > -10) trendLabel = "SLIGHTLY DECLINING — minor stability loss";
        else trendLabel = "DESTABILIZING — losing neutrality over time";

        let text = `## Stability Prediction: ${name}\n\n`;
        text += `**Trend:** ${trendLabel}\n`;
        text += `**Direction:** ${trend > 0 ? "+" : ""}${trend.toFixed(1)} AIN (first half → second half)\n\n`;

        // AIN over time
        text += `### AIN Over Time\n\n`;
        text += `| Window | AIN | Status |\n|--------|-----|--------|\n`;
        for (let i = 0; i < ains.length; i++) {
          text += `| ${i + 1} | ${ains[i]}/100 | ${ainSignal(ains[i])} |\n`;
        }

        text += `\n**Latest AIN:** ${ains[ains.length - 1]}/100\n`;
        text += `**Windows analyzed:** ${ains.length}\n`;
        text += `**Tokens used:** ${ains.length} computations`;

        addHistory({ tool: "zpl_predict", results: { label, trend: trendLabel }, ain_scores: { latest: ains[ains.length - 1], trend: Math.round(trend) } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_leaderboard: top stable/unstable from history ---
  server.tool(
    "zpl_leaderboard",
    "Generate a leaderboard from your analysis history — top most stable and most unstable items ever analyzed. Gamification of neutrality analysis.",
    {
      top: z.number().int().min(3).max(20).optional().default(10).describe("How many entries in each category"),
    },
    async ({ top }) => {
      const history = getHistory(500);
      if (history.length === 0) {
        return { content: [{ type: "text" as const, text: "No history yet. Run some analyses first to build the leaderboard." }] };
      }

      // Collect all AIN scores
      const allScores: { name: string; ain: number; tool: string; date: string }[] = [];
      for (const h of history) {
        for (const [name, ain] of Object.entries(h.ain_scores)) {
          if (typeof ain === "number" && name !== "overall" && name !== "before" && name !== "after") {
            allScores.push({ name, ain, tool: h.tool, date: h.timestamp.slice(0, 10) });
          }
        }
      }

      if (allScores.length === 0) {
        return { content: [{ type: "text" as const, text: "No scored items in history yet." }] };
      }

      // Deduplicate — keep highest AIN per name
      const best = new Map<string, typeof allScores[0]>();
      for (const s of allScores) {
        const existing = best.get(s.name);
        if (!existing || s.ain > existing.ain) best.set(s.name, s);
      }

      const sorted = Array.from(best.values()).sort((a, b) => b.ain - a.ain);

      let text = `## ZPL Leaderboard\n\n`;

      // Most stable
      text += `### Most Stable (Top ${Math.min(top, sorted.length)})\n\n`;
      text += `| Rank | Name | AIN | Signal | Date |\n|------|------|-----|--------|------|\n`;
      for (let i = 0; i < Math.min(top, sorted.length); i++) {
        const s = sorted[i];
        text += `| ${i + 1} | ${s.name} | ${s.ain}/100 | ${ainSignal(s.ain)} | ${s.date} |\n`;
      }

      // Most unstable
      if (sorted.length > top) {
        const unstable = sorted.slice(-Math.min(top, sorted.length)).reverse();
        text += `\n### Most Unstable (Bottom ${unstable.length})\n\n`;
        text += `| Rank | Name | AIN | Signal | Date |\n|------|------|-----|--------|------|\n`;
        for (let i = 0; i < unstable.length; i++) {
          const s = unstable[i];
          text += `| ${i + 1} | ${s.name} | ${s.ain}/100 | ${ainSignal(s.ain)} | ${s.date} |\n`;
        }
      }

      text += `\n**Total items analyzed:** ${sorted.length}\n`;
      text += `*Powered by ZPL Engine — Ciciu Alexandru-Costinel, Zero Point Logic*`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // --- zpl_chart: ASCII visualization of AIN over time ---
  server.tool(
    "zpl_chart",
    "Generate an ASCII chart showing AIN scores over time from your analysis history. Visual stability tracking directly in the terminal.",
    {
      filter_tool: z.string().optional().describe("Filter by tool name (e.g. 'zpl_compute', 'zpl_ask')"),
      height: z.number().int().min(5).max(20).optional().default(10).describe("Chart height in rows"),
    },
    async ({ filter_tool, height }) => {
      const history = getHistory(100);
      const filtered = filter_tool
        ? history.filter((h) => h.tool === filter_tool)
        : history;

      if (filtered.length < 2) {
        return { content: [{ type: "text" as const, text: "Need at least 2 history entries to chart. Run more analyses first." }] };
      }

      // Extract first AIN score from each entry
      const points: { date: string; ain: number }[] = [];
      for (const h of filtered) {
        const firstScore = Object.values(h.ain_scores)[0];
        if (typeof firstScore === "number") {
          points.push({ date: h.timestamp.slice(5, 10), ain: firstScore });
        }
      }

      if (points.length < 2) {
        return { content: [{ type: "text" as const, text: "Not enough scored entries to chart." }] };
      }

      const maxAin = Math.max(...points.map((p) => p.ain), 100);
      const minAin = Math.min(...points.map((p) => p.ain), 0);
      const range = maxAin - minAin || 1;

      let text = `## AIN Chart${filter_tool ? ` (${filter_tool})` : ""}\n\n\`\`\`\n`;

      // Build ASCII chart
      for (let row = height; row >= 0; row--) {
        const threshold = minAin + (range * row) / height;
        const label = String(Math.round(threshold)).padStart(3);
        text += `${label} |`;

        for (const p of points) {
          if (Math.abs(p.ain - threshold) <= range / height / 2) {
            text += " * ";
          } else if (p.ain > threshold) {
            text += " | ";
          } else {
            text += "   ";
          }
        }
        text += `\n`;
      }

      // X axis
      text += `    +`;
      for (let i = 0; i < points.length; i++) text += `---`;
      text += `\n     `;
      for (const p of points) text += `${p.date.slice(0, 2)} `;
      text += `\n\`\`\`\n`;

      text += `**Points:** ${points.length} | **Range:** ${Math.round(minAin)}-${Math.round(maxAin)} AIN`;

      return { content: [{ type: "text" as const, text }] };
    }
  );

  // --- zpl_teach: explain ZPL and AIN concepts ---
  server.tool(
    "zpl_teach",
    "Learn about ZPL Engine and AIN concepts. Educational tool that explains post-binary analysis, neutrality scoring, how AIN works, and why it matters. Perfect for onboarding new users.",
    {
      topic: z.enum([
        "what-is-ain",
        "how-it-works",
        "post-binary",
        "use-cases",
        "scoring-guide",
        "plans",
        "getting-started",
      ]).describe("Topic to learn about"),
    },
    async ({ topic }) => {
      const topics: Record<string, string> = {
        "what-is-ain": `## What is AIN?

**AIN (AI Neutrality Index)** is a mathematical measure of how balanced, stable, or neutral a system is.

- Score: **0.1** (extreme bias) to **99.9** (perfect neutrality)
- It doesn't guess — it computes
- Works on ANY data: prices, game stats, model outputs, risk scores, token distributions

**Example:**
- AIN 85 = "This system is well-balanced, no dominant element"
- AIN 45 = "Noticeable imbalance, some elements are disproportionate"
- AIN 15 = "Extreme bias, one element dominates everything"

AIN is computed by the ZPL Engine — a post-binary mathematical system created by Ciciu Alexandru-Costinel.`,

        "how-it-works": `## How ZPL Engine Works

1. **You provide data** — prices, scores, distributions, anything numerical
2. **MCP converts** your data into engine parameters (dimension, bias, samples)
3. **Engine computes** — post-binary matrix analysis on the server
4. **You get AIN** — a single number that tells you how balanced your data is

The engine takes 3 inputs:
- **d (dimension):** complexity of analysis (3-100)
- **bias:** input bias level (0.0-1.0)
- **samples:** precision (100-50,000)

And returns:
- **AIN:** neutrality score (0.1-99.9)
- **status:** CERTIFIED_NEUTRAL, NEUTRAL, MODERATE_BIAS, HIGH_BIAS, EXTREME_BIAS
- **deviation:** mathematical deviation from perfect neutrality

**The formula is a trade secret.** The MCP only sends parameters and receives results — no computation logic is exposed.`,

        "post-binary": `## What is Post-Binary?

Traditional computing is binary: 0 or 1, true or false, yes or no.

**Post-binary** goes beyond that. Instead of asking "is it balanced?" (yes/no), ZPL asks "HOW balanced is it?" and gives you a precise mathematical answer.

Think of it like upgrading from a light switch (on/off) to a dimmer (0-100%).

The ZPL Engine uses a proprietary mathematical framework that:
- Operates on N×N matrices
- Analyzes neutrality at multiple dimensions simultaneously
- Produces results that are reproducible and deterministic
- Works across ANY domain (finance, games, AI, security, crypto)

This is what makes ZPL unique — it's not machine learning, not statistics, not AI. It's pure mathematics applied to neutrality analysis.

Created by Ciciu Alexandru-Costinel — published on Zenodo with DOI.`,

        "use-cases": `## ZPL Use Cases

### Finance
- Portfolio balance analysis (is my portfolio diversified?)
- Market stability scoring (is the market neutral or biased?)
- Fear & Greed validation (is sentiment justified or irrational?)

### Gaming
- Loot table fairness (are drop rates fair?)
- Matchmaking balance (are teams evenly matched?)
- Game economy health (inflation/deflation detection)
- PvP balance (which classes are OP?)
- Gacha audit (legal compliance for loot boxes)

### AI/ML
- Model bias detection (does the model favor certain outputs?)
- Dataset balance (is training data evenly distributed?)
- Prompt consistency testing (does the AI give biased answers?)

### Security
- Vulnerability distribution (where is risk concentrated?)
- Compliance scoring (how balanced is security coverage?)

### Crypto
- Token decentralization (whale concentration risk)
- DeFi protocol risk (smart contract, oracle, governance)
- Liquidity pool balance (impermanent loss risk)
- Tokenomics fairness (insider vs community allocation)

### Universal
- ANY decision: "Pizza or hotdog?" with mathematical scoring
- Compare anything: products, frameworks, strategies, ideas`,

        "scoring-guide": `## AIN Scoring Guide

| Score | Grade | Meaning |
|-------|-------|---------|
| 90-99.9 | A+ | EXCEPTIONAL — Perfect or near-perfect neutrality |
| 80-89 | A | EXCELLENT — Very well balanced |
| 70-79 | B+ | GOOD — Well balanced with minor deviations |
| 60-69 | B | ACCEPTABLE — Functional balance, some asymmetry |
| 40-59 | C | MODERATE — Noticeable imbalance, needs attention |
| 20-39 | D | WEAK — Significant bias, action needed |
| 0.1-19 | F | CRITICAL — Extreme bias, system is broken |

**Token cost:** d² + d tokens per computation
- d=3: 12 tokens
- d=9: 90 tokens
- d=16: 272 tokens
- d=25: 650 tokens

**Sweep:** 19× the single compute cost (tests all bias levels)`,

        "plans": `## ZPL Engine Plans

| Plan | Price | Max D | Tokens/Month | Best For |
|------|-------|-------|--------------|----------|
| Free | $0 | d=9 | 5,000 | Testing, personal use |
| Basic | $10/mo | d=16 | 10,000 | Indie developers |
| Pro | $29/mo | d=25 | 50,000 | Small teams, analysts |
| GamePro | $69/mo | d=32 | 150,000 | Game studios |
| Studio | $149/mo | d=48 | 500,000 | Professional studios |
| Agent | $199/mo | d=48 | 2,000,000 | AI agents, automation |
| Enterprise | $499/mo | d=64 | 10,000,000 | Large companies |
| Enterprise XL | $999/mo | d=100 | 50,000,000 | Maximum precision |

Rate limit: 60 requests/minute (all plans)
Get your key: https://zeropointlogic.io/pricing`,

        "getting-started": `## Getting Started

### 1. Get an API Key
- Visit https://zeropointlogic.io/auth/register
- Go to Dashboard → API Keys → Generate
- Copy your \`zpl_u_...\` key

### 2. Configure MCP
Add to your Claude Desktop config:
\`\`\`json
{
  "mcpServers": {
    "ZPL Engine MCP": {
      "command": "npx",
      "args": ["-y", "@zeropointlogic/engine-mcp"],
      "env": { "ZPL_API_KEY": "zpl_u_YOUR_KEY" }
    }
  }
}
\`\`\`

### 3. Start Using
Just ask naturally:
- "Is BTC stable?" → zpl_compute
- "Pizza or hotdog?" → zpl_ask
- "Is my loot table fair?" → zpl_loot_table
- "Compare React vs Vue" → zpl_versus

### 4. Check Your Usage
Say "check my ZPL usage" → zpl_usage

Created by Ciciu Alexandru-Costinel — Zero Point Logic
https://zeropointlogic.io`,
      };

      const content = topics[topic] ?? "Unknown topic.";
      return { content: [{ type: "text" as const, text: content }] };
    }
  );

  // --- zpl_alert: set budget/threshold alerts ---
  server.tool(
    "zpl_alert",
    "Set a threshold alert. Define a condition (AIN above/below a value) and the tool will check it against your last analysis. Useful for monitoring critical thresholds.",
    {
      check: z.enum(["budget", "threshold"]).describe("What to check: 'budget' (tokens remaining) or 'threshold' (last AIN vs target)"),
      target_ain: z.number().min(0).max(100).optional().describe("For 'threshold': alert if last AIN is below this value"),
      target_tokens: z.number().optional().describe("For 'budget': alert if tokens remaining below this value"),
      plan: z.enum(["free", "basic", "pro", "gamepro", "studio", "agent", "enterprise", "enterprise_xl"]).optional().default("free"),
    },
    async ({ check, target_ain, target_tokens, plan }) => {
      const history = getHistory(500);

      if (check === "budget") {
        const limit = Number((PLAN_INFO[plan] ?? PLAN_INFO.free).tokens.replace(/,/g, ""));
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        let monthTokens = 0;
        for (const h of history) {
          if (new Date(h.timestamp) >= monthStart) {
            const results = h.results as Record<string, unknown>;
            if (typeof results.totalTokens === "number") monthTokens += results.totalTokens;
          }
        }
        const remaining = Math.max(0, limit - monthTokens);
        const threshold = target_tokens ?? 500;
        const alert = remaining <= threshold;

        let text = alert
          ? `**ALERT: Low budget!** ~${remaining} tokens remaining (threshold: ${threshold}). Upgrade at zeropointlogic.io/pricing`
          : `**OK:** ~${remaining} tokens remaining (threshold: ${threshold}). No alert.`;
        return { content: [{ type: "text" as const, text }] };
      }

      if (check === "threshold") {
        const target = target_ain ?? 50;
        const lastEntry = history[history.length - 1];
        if (!lastEntry) {
          return { content: [{ type: "text" as const, text: "No history. Run an analysis first." }] };
        }
        const lastAin = Object.values(lastEntry.ain_scores)[0] ?? 0;
        const alert = lastAin < target;

        let text = alert
          ? `**ALERT:** Last AIN score (${lastAin}) is below threshold (${target}). Action may be needed.`
          : `**OK:** Last AIN score (${lastAin}) is above threshold (${target}). No alert.`;
        return { content: [{ type: "text" as const, text }] };
      }

      return { content: [{ type: "text" as const, text: "Unknown check type." }], isError: true };
    }
  );
}

const PLAN_INFO: Record<string, { tokens: string }> = {
  free: { tokens: "5,000" }, basic: { tokens: "10,000" }, pro: { tokens: "50,000" },
  gamepro: { tokens: "150,000" }, studio: { tokens: "500,000" }, agent: { tokens: "2,000,000" },
  enterprise: { tokens: "10,000,000" }, enterprise_xl: { tokens: "50,000,000" },
};
