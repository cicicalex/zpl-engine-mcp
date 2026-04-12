/**
 * Domain registry.
 * Add new domain lenses here — they automatically appear in MCP tools.
 */

import type { DomainLens } from "./types.js";
import { financeLens } from "./finance.js";
import { gameLens } from "./game.js";
import { aiLens } from "./ai.js";
import { securityLens } from "./security.js";
import { cryptoLens } from "./crypto.js";
import { universalLens } from "./universal.js";

export const domains: Map<string, DomainLens> = new Map([
  ["finance", financeLens],
  ["game", gameLens],
  ["ai", aiLens],
  ["security", securityLens],
  ["crypto", cryptoLens],
  ["universal", universalLens],
]);

export function getDomain(id: string): DomainLens | undefined {
  return domains.get(id);
}

export function listDomains(): { id: string; name: string; description: string; examples: string[] }[] {
  return Array.from(domains.values()).map((d) => ({
    id: d.id,
    name: d.name,
    description: d.description,
    examples: d.examples,
  }));
}

export type { DomainLens, DomainInterpretation } from "./types.js";
