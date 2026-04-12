/**
 * Domain lens interface.
 * Each domain knows how to interpret raw data into engine parameters
 * and how to interpret engine results in domain-specific terms.
 */

import type { ComputeResponse, SweepResponse } from "../engine-client.js";

export interface DomainLens {
  /** Unique domain identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** What this domain analyzes */
  description: string;
  /** Example use cases */
  examples: string[];
  /** Required input fields */
  inputSchema: Record<string, { type: string; description: string; required?: boolean }>;

  /**
   * Convert domain-specific input into engine parameters (d, bias).
   * This is where the domain knowledge lives — how to map
   * e.g. price changes into a bias value for the engine.
   */
  buildParams(input: Record<string, unknown>): { d: number; bias: number; samples?: number };

  /**
   * Interpret engine results in domain-specific language.
   * Returns a structured interpretation with actionable insights.
   */
  interpret(result: ComputeResponse, input: Record<string, unknown>): DomainInterpretation;

  /**
   * Interpret a sweep in domain-specific terms.
   */
  interpretSweep(result: SweepResponse, input: Record<string, unknown>): string;
}

export interface DomainInterpretation {
  /** One-line summary */
  summary: string;
  /** AIN score 0-100 */
  ain: number;
  /** Human-readable status */
  status: string;
  /** Domain-specific signal (e.g. "STABLE", "BUY", "BALANCED") */
  signal: string;
  /** Detailed breakdown */
  details: Record<string, string | number>;
  /** Actionable recommendation */
  recommendation: string;
}
