/**
 * Shared helpers for tool registration.
 * Reduces boilerplate — every tool follows the same pattern:
 * take input → convert to (d, bias, samples) → call engine → format result.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZPLEngineClient, ComputeResponse } from "../engine-client.js";

export type Server = McpServer;

/** Standard AIN interpretation bands */
export function ainSignal(ain: number): string {
  if (ain >= 80) return "EXCELLENT";
  if (ain >= 60) return "GOOD";
  if (ain >= 40) return "MODERATE";
  if (ain >= 20) return "WEAK";
  return "CRITICAL";
}

/** Format a single compute result as markdown table */
export function formatResult(label: string, result: ComputeResponse, extras?: Record<string, string | number>): string {
  const ain = Math.round(result.ain * 100);
  let text = `## ${label} — AIN ${ain}/100 (${ainSignal(ain)})\n\n`;
  text += `| Metric | Value |\n|--------|-------|\n`;
  text += `| AIN Score | ${ain}/100 |\n`;
  text += `| Status | ${result.ain_status} |\n`;
  text += `| Deviation | ${result.deviation.toFixed(6)} |\n`;
  text += `| Dimension | ${result.d} |\n`;
  text += `| Bias | ${result.bias.toFixed(4)} |\n`;
  if (extras) {
    for (const [k, v] of Object.entries(extras)) {
      text += `| ${k} | ${v} |\n`;
    }
  }
  text += `| Tokens | ${result.tokens_used} |\n`;
  text += `| Compute | ${result.compute_ms}ms |\n`;
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
