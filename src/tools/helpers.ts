/**
 * Shared helpers for tool registration.
 * Reduces boilerplate — every tool follows the same pattern:
 * take input → convert to (d, bias, samples) → call engine → format result.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZPLEngineClient, ComputeResponse } from "../engine-client.js";
import { ainScale, fmtAin } from "../ain-format.js";

export type Server = McpServer;

/** Standard AIN interpretation bands */
export function ainSignal(ain: number): string {
  if (ain >= 80) return "EXCELLENT";
  if (ain >= 60) return "GOOD";
  if (ain >= 40) return "MODERATE";
  if (ain >= 20) return "WEAK";
  return "CRITICAL";
}

/**
 * ZPL_MODE — controls how scores reach the AI assistant.
 *
 *  pure  (default): scores are computed and saved to history, but tools that
 *                   evaluate AI-generated text return only an audit pointer.
 *                   The assistant does NOT see the AIN inline — prevents
 *                   reactivity bias / observer effect.
 *
 *  coach           : full inline output (current behaviour). The assistant
 *                    sees the score and may self-correct.
 *
 *  Tools that evaluate AI-generated text (zpl_check_response, zpl_news_bias,
 *  zpl_review_bias) honour this. Tools that score external data
 *  (zpl_portfolio, zpl_loot_table, etc.) ignore it — there is no AI to
 *  influence in those cases.
 */
export const ZPL_MODE: "pure" | "coach" =
  (process.env.ZPL_MODE ?? "pure").toLowerCase() === "coach" ? "coach" : "pure";

/**
 * Wrap a tool result so AI-evaluation outputs respect ZPL_MODE.
 * In pure mode, returns a redacted summary with an audit ID instead of the
 * AIN/details. In coach mode, returns the full original text.
 */
export function maybeRedactForPureMode(args: {
  ain: number;
  tokens?: number;
  fullText: string;
  toolName: string;
}): string {
  if (ZPL_MODE === "coach") return args.fullText;
  const id = `pure-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  return [
    `[ZPL_MODE=pure] ${args.toolName} complete.`,
    ``,
    `The AIN score has been computed and recorded in your audit log.`,
    `This assistant is intentionally not shown the score (prevents reactivity bias).`,
    ``,
    `Tracking ID: ${id}`,
    `Tokens used: ${args.tokens ?? "n/a"}`,
    ``,
    `View the score:`,
    `  https://zeropointlogic.io/dashboard/audit/${id}`,
    ``,
    `To allow inline scores during this session, restart the MCP with ZPL_MODE=coach.`,
  ].join("\n");
}

/**
 * Standard footer appended to every tool result.
 * Reminds the user (and any AI consuming the output) that the AIN score is a
 * stability measurement only — never a recommendation, prediction, or
 * financial / gambling / investment advice.
 */
export const ZPL_DISCLAIMER =
  "_ZPL measures mathematical stability of the input distribution. " +
  "It does NOT predict future outcomes, recommend actions, or constitute " +
  "financial, gambling, medical, or legal advice._";

/**
 * Format a single compute result as markdown.
 * IP protection: shows AIN score + status only. No bias, no deviation,
 * no p_output, no dimension, no compute time — anything that could hint at
 * the engine's internal method is stripped.
 *
 * Always appends ZPL_DISCLAIMER so downstream AIs do not over-interpret the score.
 */
export function formatResult(label: string, result: ComputeResponse, extras?: Record<string, string | number>): string {
  const ain = ainScale(result.ain);
  let text = `## ${label} — AIN ${fmtAin(ain)}/100 (${ainSignal(ain)})\n\n`;
  text += `| Metric | Value |\n|--------|-------|\n`;
  text += `| AIN Score | ${fmtAin(ain)}/100 |\n`;
  text += `| Status | ${result.ain_status} |\n`;
  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      text += `| ${k} | ${v} |\n`;
    }
  }
  text += `| Tokens | ${result.tokens_used} |\n`;
  text += `\n${ZPL_DISCLAIMER}\n`;
  return text;
}

/** Compute bias from an array of values (how far from uniform) */
export function distributionBias(values: number[]): number {
  const total = values.reduce((s, v) => s + Math.abs(v), 0);
  if (total === 0) return 0.5;
  const n = values.length;
  const norm = values.map((v) => Math.abs(v) / total);
  const uniform = 1 / n;
  const deviation = norm.reduce((s, p) => s + Math.abs(p - uniform), 0) / 2;
  return Math.min(1, Math.max(0, deviation));
}

/** Compute bias from directional imbalance (positive vs negative) */
export function directionalBias(values: number[]): number {
  const pos = values.filter((v) => v > 0).length;
  const ratio = pos / values.length;
  const dirBias = Math.abs(ratio - 0.5) * 2;
  const avgMag = values.reduce((s, v) => s + Math.abs(v), 0) / values.length;
  const magFactor = Math.min(avgMag / 10, 1);
  return Math.min(1, Math.max(0, dirBias * 0.6 + magFactor * 0.4));
}

/** Compute bias from variance of normalized scores */
export function varianceBias(scores: number[], scaleMax = 10): number {
  const safeScale = Math.max(scaleMax || 10, 1);
  const norm = scores.map((s) => Math.min(1, Math.max(0, s / safeScale)));
  const mean = norm.reduce((s, v) => s + v, 0) / norm.length;
  const variance = norm.reduce((s, v) => s + (v - mean) ** 2, 0) / norm.length;
  const severity = mean;
  return Math.min(1, Math.max(0, Math.sqrt(variance) * 0.5 + severity * 0.5));
}

/** HHI concentration index as bias */
export function concentrationBias(shares: number[]): number {
  const total = shares.reduce((s, v) => s + v, 0);
  if (total === 0) return 0.5;
  const norm = shares.map((v) => v / total);
  const hhi = norm.reduce((s, p) => s + p * p, 0);
  const minHHI = 1 / shares.length;
  return Math.min(1, Math.max(0, (hhi - minHHI) / (1 - minHHI)));
}

/** Clamp dimension to valid range */
export function clampD(n: number): number {
  return Math.max(3, Math.min(100, Math.round(n)));
}
