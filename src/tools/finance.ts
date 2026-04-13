/**
 * Finance tools — 7 tools for market analysis.
 */

import { z } from "zod";
import type { Server } from "./helpers.js";
import { formatResult, directionalBias, distributionBias, concentrationBias, clampD } from "./helpers.js";
import { ZPLEngineClient } from "../engine-client.js";
import { addHistory } from "../store.js";

export function registerFinanceTools(server: Server, getClient: () => ZPLEngineClient) {

  // --- zpl_market_scan: scan multiple assets at once ---
  server.tool(
    "zpl_market_scan",
    "Scan multiple assets simultaneously. Provide price changes for 2-50 assets, get AIN stability score for each plus an overall market AIN. Great for daily market overview.",
    {
      assets: z.array(z.object({
        symbol: z.string().max(20).describe("Asset symbol (e.g. BTC, AAPL, EUR/USD)"),
        change: z.number().describe("Price change % (e.g. -3.2, +5.1)"),
      })).min(2).max(50).describe("Assets to scan"),
      market: z.string().max(100).optional().describe("Market name for label (e.g. 'crypto', 'S&P 500', 'forex')"),
    },
    async ({ assets, market }) => {
      try {
        const client = getClient();
        const label = market ?? "Market";
        const changes = assets.map((a) => a.change);
        const d = clampD(changes.length);
        const bias = directionalBias(changes);
        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);

        let text = `## ${label} Scan — Overall AIN: ${ain}/100\n\n`;
        text += `| Asset | Change | Direction |\n|-------|--------|-----------|\n`;
        for (const a of assets) {
          const dir = a.change > 0.3 ? "BULL" : a.change < -0.3 ? "BEAR" : "NEUTRAL";
          text += `| ${a.symbol} | ${a.change > 0 ? "+" : ""}${a.change.toFixed(2)}% | ${dir} |\n`;
        }
        text += `\n**Overall Stability:** ${result.ain_status} | **Bias:** ${result.bias.toFixed(4)} | **Tokens:** ${result.tokens_used}`;

        const scores: Record<string, number> = { overall: ain };
        addHistory({ tool: "zpl_market_scan", domain: "finance", results: { market, assets }, ain_scores: scores });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_portfolio: portfolio balance analysis ---
  server.tool(
    "zpl_portfolio",
    "Analyze portfolio balance. Provide asset allocations (weights/percentages) and optionally their returns. Returns AIN showing how balanced or concentrated the portfolio is.",
    {
      allocations: z.array(z.object({
        asset: z.string().max(100).describe("Asset name"),
        weight: z.number().min(0).describe("Portfolio weight % (e.g. 40 for 40%)"),
        return_pct: z.number().optional().describe("Optional: asset return %"),
      })).min(2).max(50).describe("Portfolio allocations"),
    },
    async ({ allocations }) => {
      try {
        const client = getClient();
        const weights = allocations.map((a) => a.weight);
        const d = clampD(weights.length);
        const bias = concentrationBias(weights);
        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);

        let text = `## Portfolio Balance — AIN ${ain}/100\n\n`;
        text += `| Asset | Weight | ${allocations[0].return_pct !== undefined ? "Return |" : ""}\n`;
        text += `|-------|--------|${allocations[0].return_pct !== undefined ? "--------|" : ""}\n`;
        for (const a of allocations) {
          text += `| ${a.asset} | ${a.weight.toFixed(1)}% |`;
          if (a.return_pct !== undefined) text += ` ${a.return_pct > 0 ? "+" : ""}${a.return_pct.toFixed(2)}% |`;
          text += `\n`;
        }

        const topWeight = Math.max(...weights);
        const topAsset = allocations.find((a) => a.weight === topWeight)!;
        text += `\n**Concentration:** ${topAsset.asset} dominates at ${topWeight.toFixed(1)}%\n`;
        text += `**Status:** ${result.ain_status} | **Tokens:** ${result.tokens_used}`;

        if (ain >= 70) text += `\n\n*Portfolio is well-diversified.*`;
        else if (ain >= 40) text += `\n\n*Some concentration risk — consider rebalancing.*`;
        else text += `\n\n*High concentration risk — portfolio heavily skewed.*`;

        addHistory({ tool: "zpl_portfolio", domain: "finance", results: { allocations }, ain_scores: { portfolio: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_fear_greed: Fear & Greed interpreted by engine ---
  server.tool(
    "zpl_fear_greed",
    "Interpret Fear & Greed index through ZPL Engine. Provide the current F&G value (0-100) plus market metrics. Returns whether fear/greed level is mathematically justified or irrational.",
    {
      fng_value: z.number().min(0).max(100).describe("Current Fear & Greed index value (0=extreme fear, 100=extreme greed)"),
      btc_change_24h: z.number().optional().describe("BTC 24h change %"),
      volume_change: z.number().optional().describe("Volume change vs average %"),
      volatility: z.number().optional().describe("Current volatility index"),
      social_sentiment: z.number().min(0).max(100).optional().describe("Social media sentiment 0-100"),
    },
    async ({ fng_value, btc_change_24h, volume_change, volatility, social_sentiment }) => {
      try {
        const client = getClient();
        const factors: number[] = [fng_value / 10]; // 0-10 scale
        if (btc_change_24h !== undefined) factors.push(5 + btc_change_24h / 2); // center at 5
        if (volume_change !== undefined) factors.push(5 + volume_change / 20);
        if (volatility !== undefined) factors.push(volatility / 10);
        if (social_sentiment !== undefined) factors.push(social_sentiment / 10);
        while (factors.length < 3) factors.push(5); // pad to minimum d=3

        const d = clampD(factors.length);
        const normalized = factors.map((f) => Math.min(1, Math.max(0, f / 10)));
        const mean = normalized.reduce((s, v) => s + v, 0) / normalized.length;
        const variance = normalized.reduce((s, v) => s + (v - mean) ** 2, 0) / normalized.length;
        const bias = Math.min(1, Math.max(0, Math.sqrt(variance) * 0.4 + Math.abs(mean - 0.5) * 0.6));

        const result = await client.compute({ d, bias, samples: 1000 });
        const ain = Math.round(result.ain * 100);

        const fngLabel = fng_value <= 20 ? "Extreme Fear" : fng_value <= 40 ? "Fear" : fng_value <= 60 ? "Neutral" : fng_value <= 80 ? "Greed" : "Extreme Greed";

        let text = `## Fear & Greed Analysis — AIN ${ain}/100\n\n`;
        text += `**F&G Index:** ${fng_value} (${fngLabel})\n\n`;

        if (ain >= 60 && (fng_value <= 25 || fng_value >= 75)) {
          text += `**Verdict:** Market sentiment is extreme but ZPL Engine shows stability (AIN ${ain}). Sentiment may be **irrational** — contrarian opportunity.\n`;
        } else if (ain < 40 && fng_value >= 40 && fng_value <= 60) {
          text += `**Verdict:** Sentiment looks calm but ZPL detects instability (AIN ${ain}). **Hidden risk** — the market is less stable than sentiment suggests.\n`;
        } else {
          text += `**Verdict:** Sentiment and mathematical stability are **aligned**. AIN ${ain} confirms the ${fngLabel.toLowerCase()} reading.\n`;
        }

        text += `\n**Tokens:** ${result.tokens_used} | **Status:** ${result.ain_status}`;
        addHistory({ tool: "zpl_fear_greed", domain: "finance", results: { fng_value }, ain_scores: { fear_greed: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_forex_pair: forex stability ---
  server.tool(
    "zpl_forex_pair",
    "Analyze forex pair stability. Provide bid, ask, spread, and recent changes to get AIN stability score and direction signal.",
    {
      pair: z.string().max(20).describe("Currency pair (e.g. EUR/USD)"),
      changes: z.array(z.number()).min(3).max(30).describe("Recent price changes % (e.g. hourly, daily). More data = more accurate."),
      spread_pips: z.number().optional().describe("Current spread in pips"),
    },
    async ({ pair, changes, spread_pips }) => {
      try {
        const client = getClient();
        const d = clampD(changes.length);
        const bias = directionalBias(changes);
        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);

        const avgChange = changes.reduce((s, v) => s + v, 0) / changes.length;
        const direction = avgChange > 0.1 ? "BULLISH" : avgChange < -0.1 ? "BEARISH" : "RANGING";

        let text = `## ${pair} Stability — AIN ${ain}/100\n\n`;
        text += `**Direction:** ${direction} (avg change: ${avgChange > 0 ? "+" : ""}${avgChange.toFixed(3)}%)\n`;
        text += `**Stability:** ${result.ain_status}\n`;
        if (spread_pips) text += `**Spread:** ${spread_pips} pips\n`;
        text += `\n**Data points:** ${changes.length} | **Tokens:** ${result.tokens_used}`;

        addHistory({ tool: "zpl_forex_pair", domain: "finance", results: { pair, direction }, ain_scores: { [pair]: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_sector_bias: sector rotation analysis ---
  server.tool(
    "zpl_sector_bias",
    "Analyze sector bias/rotation. Provide sector performance data to detect which sectors are overweight and whether the market is balanced across sectors.",
    {
      sectors: z.array(z.object({
        name: z.string().max(100).describe("Sector name"),
        change: z.number().describe("Sector change %"),
        weight: z.number().optional().describe("Optional: sector weight in index %"),
      })).min(3).max(30).describe("Sector data"),
    },
    async ({ sectors }) => {
      try {
        const client = getClient();
        const changes = sectors.map((s) => s.change);
        const d = clampD(changes.length);
        const bias = directionalBias(changes);
        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);

        const sorted = [...sectors].sort((a, b) => b.change - a.change);
        let text = `## Sector Bias — AIN ${ain}/100\n\n`;
        text += `| Sector | Change | Signal |\n|--------|--------|--------|\n`;
        for (const s of sorted) {
          const sig = s.change > 1 ? "STRONG" : s.change > 0 ? "BULL" : s.change > -1 ? "BEAR" : "WEAK";
          text += `| ${s.name} | ${s.change > 0 ? "+" : ""}${s.change.toFixed(2)}% | ${sig} |\n`;
        }
        text += `\n**Rotation signal:** ${ain >= 60 ? "Balanced rotation" : ain >= 40 ? "Moderate rotation bias" : "Heavy sector concentration"}\n`;
        text += `**Tokens:** ${result.tokens_used}`;

        addHistory({ tool: "zpl_sector_bias", domain: "finance", results: { sectors: sectors.map((s) => s.name) }, ain_scores: { sectors: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_macro: macroeconomic stability ---
  server.tool(
    "zpl_macro",
    "Analyze macroeconomic stability. Provide key economic indicators (GDP growth, inflation, unemployment, interest rates, etc.) to get a mathematical stability assessment.",
    {
      indicators: z.array(z.object({
        name: z.string().max(100).describe("Indicator name (e.g. GDP Growth, Inflation, Unemployment)"),
        value: z.number().describe("Current value"),
        target: z.number().optional().describe("Target/ideal value (e.g. 2% inflation target)"),
      })).min(3).max(20).describe("Economic indicators"),
      country: z.string().max(100).optional().describe("Country name"),
    },
    async ({ indicators, country }) => {
      try {
        const client = getClient();
        // Bias = how far each indicator is from target
        const deviations = indicators.map((ind) => {
          const target = ind.target ?? ind.value; // if no target, assume current is fine
          return Math.abs(ind.value - target);
        });
        const d = clampD(indicators.length);
        const maxDev = Math.max(...deviations, 1);
        const normDevs = deviations.map((dev) => dev / maxDev);
        const avgDev = normDevs.reduce((s, v) => s + v, 0) / normDevs.length;
        const bias = Math.min(1, Math.max(0, avgDev));

        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);
        const label = country ?? "Economy";

        let text = `## ${label} Macro Stability — AIN ${ain}/100\n\n`;
        text += `| Indicator | Value | ${indicators[0].target !== undefined ? "Target | Gap |" : ""}\n`;
        text += `|-----------|-------|${indicators[0].target !== undefined ? "--------|-----|" : ""}\n`;
        for (const ind of indicators) {
          text += `| ${ind.name} | ${ind.value} |`;
          if (ind.target !== undefined) {
            const gap = ind.value - ind.target;
            text += ` ${ind.target} | ${gap > 0 ? "+" : ""}${gap.toFixed(2)} |`;
          }
          text += `\n`;
        }
        text += `\n**Stability:** ${result.ain_status} | **Tokens:** ${result.tokens_used}`;

        addHistory({ tool: "zpl_macro", domain: "finance", results: { country, indicators: indicators.map((i) => i.name) }, ain_scores: { [label]: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_correlation: asset correlation analysis ---
  server.tool(
    "zpl_correlation",
    "Analyze correlation between assets. Provide parallel time series of returns/changes for 2+ assets. Detects whether assets move together (high correlation = concentration risk).",
    {
      assets: z.array(z.object({
        name: z.string().max(200),
        returns: z.array(z.number()).min(3).max(500).describe("Return series (same length for all assets, max 500 points)"),
      })).min(2).max(20).describe("Assets with return series"),
    },
    async ({ assets }) => {
      try {
        const client = getClient();
        // Flatten all returns into one vector to measure co-movement
        const len = assets[0].returns.length;
        const diffs: number[] = [];
        for (let t = 0; t < len; t++) {
          const vals = assets.map((a) => a.returns[t] ?? 0);
          const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
          const spread = vals.reduce((s, v) => s + Math.abs(v - mean), 0) / vals.length;
          diffs.push(spread);
        }

        // Low spread = high correlation = high bias (bad for diversification)
        const avgSpread = diffs.reduce((s, v) => s + v, 0) / diffs.length;
        const maxSpread = Math.max(...diffs, 1);
        const correlationBias = 1 - Math.min(1, avgSpread / maxSpread);

        const d = clampD(assets.length * 3);
        const result = await client.compute({ d, bias: correlationBias, samples: 2000 });
        const ain = Math.round(result.ain * 100);

        let text = `## Correlation Analysis — AIN ${ain}/100\n\n`;
        text += `**Assets:** ${assets.map((a) => a.name).join(", ")}\n`;
        text += `**Data points:** ${len} per asset\n\n`;

        if (ain >= 70) text += `**Low correlation** — assets move independently. Good diversification.\n`;
        else if (ain >= 40) text += `**Moderate correlation** — some co-movement detected. Diversification partial.\n`;
        else text += `**High correlation** — assets move together. Portfolio acts like single asset. Concentration risk!\n`;

        text += `\n**Tokens:** ${result.tokens_used}`;
        addHistory({ tool: "zpl_correlation", domain: "finance", results: { assets: assets.map((a) => a.name) }, ain_scores: { correlation: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );
}
