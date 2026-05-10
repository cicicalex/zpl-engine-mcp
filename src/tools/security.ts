/**
 * Security tools — 3 tools for risk and vulnerability analysis.
 */

import { z } from "zod";
import type { Server } from "./helpers.js";
import { varianceBias, distributionBias, clampD } from "./helpers.js";
import { ZPLEngineClient } from "../engine-client.js";
import { addHistory } from "../store.js";

export function registerSecurityTools(server: Server, getClient: () => ZPLEngineClient) {

  // --- zpl_vuln_map: vulnerability distribution ---
  server.tool(
    "zpl_vuln_map",
    "Map vulnerability distribution across system components. Provide CVSS scores or risk levels per component. Shows where risk is concentrated and whether security posture is balanced.",
    {
      components: z.array(z.object({
        name: z.string().max(200).describe("Component name (e.g. 'auth service', 'database', 'API gateway')"),
        score: z.number().min(0).max(10).describe("Vulnerability score (CVSS 0-10)"),
        count: z.number().int().min(0).optional().describe("Optional: number of vulnerabilities"),
      })).min(2).max(50).describe("System components with vulnerability scores"),
      system_name: z.string().max(200).optional(),
    },
    async ({ components, system_name }) => {
      try {
        const client = getClient();
        const scores = components.map((c) => c.score);
        const d = clampD(scores.length);
        const bias = varianceBias(scores, 10);
        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);
        const label = system_name ?? "System";

        const sorted = [...components].sort((a, b) => b.score - a.score);
        let text = `## ${label} Vulnerability Map — AIN ${ain}/100\n\n`;
        text += `| Component | CVSS | Risk | ${components[0].count !== undefined ? "Vulns |" : ""}\n`;
        text += `|-----------|------|------|${components[0].count !== undefined ? "-------|" : ""}\n`;
        for (const c of sorted) {
          const risk = c.score >= 9 ? "CRITICAL" : c.score >= 7 ? "HIGH" : c.score >= 4 ? "MEDIUM" : "LOW";
          text += `| ${c.name} | ${c.score.toFixed(1)} | ${risk} |`;
          if (c.count !== undefined) text += ` ${c.count} |`;
          text += `\n`;
        }

        const critical = sorted.filter((c) => c.score >= 9).length;
        const high = sorted.filter((c) => c.score >= 7 && c.score < 9).length;
        text += `\n**Summary:** ${critical} critical, ${high} high, ${sorted.length - critical - high} medium/low\n`;

        if (ain >= 60) text += `**Posture:** Risks are distributed evenly — no single point of failure.\n`;
        else if (ain >= 35) text += `**Posture:** Some components are significantly weaker. Prioritize the top vulnerabilities.\n`;
        else text += `**Posture:** Risk heavily concentrated in few components. Critical exposure — patch immediately.\n`;

        text += `**Tokens:** ${result.tokens_used}`;
        addHistory({ tool: "zpl_vuln_map", domain: "security", results: { system_name, components: components.map((c) => c.name), tokens_used: result.tokens_used }, ain_scores: { [label]: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_risk_score: risk matrix balance ---
  server.tool(
    "zpl_risk_score",
    "Analyze risk matrix balance. Provide risks with likelihood and impact scores. Detects whether risk management is covering all areas or leaving blind spots.",
    {
      risks: z.array(z.object({
        name: z.string().max(200),
        likelihood: z.number().min(1).max(5).describe("Likelihood 1-5"),
        impact: z.number().min(1).max(5).describe("Impact 1-5"),
      })).min(3).max(30).describe("Risks with likelihood and impact"),
    },
    async ({ risks }) => {
      try {
        const client = getClient();
        const riskScores = risks.map((r) => r.likelihood * r.impact);
        const d = clampD(riskScores.length);
        const bias = distributionBias(riskScores);
        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);

        let text = `## Risk Matrix — AIN ${ain}/100\n\n`;
        text += `| Risk | Likelihood | Impact | Score | Priority |\n`;
        text += `|------|------------|--------|-------|----------|\n`;
        const sorted = risks.map((r, i) => ({ ...r, score: riskScores[i] })).sort((a, b) => b.score - a.score);
        for (const r of sorted) {
          const pri = r.score >= 15 ? "CRITICAL" : r.score >= 10 ? "HIGH" : r.score >= 5 ? "MEDIUM" : "LOW";
          text += `| ${r.name} | ${r.likelihood} | ${r.impact} | ${r.score} | ${pri} |\n`;
        }

        text += `\n**Distribution:** ${ain >= 50 ? "Risk is spread across areas" : "Risk concentrated in few areas"}\n`;
        text += `**Tokens:** ${result.tokens_used}`;

        addHistory({ tool: "zpl_risk_score", domain: "security", results: { risks: risks.map((r) => r.name), tokens_used: result.tokens_used }, ain_scores: { risk: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );

  // --- zpl_compliance: compliance checklist scoring ---
  server.tool(
    "zpl_compliance",
    "Score compliance across multiple standards/categories. Provide scores per compliance area. Shows overall compliance health and weakest areas.",
    {
      areas: z.array(z.object({
        name: z.string().max(200).describe("Compliance area (e.g. 'Data Protection', 'Access Control', 'Encryption')"),
        score: z.number().min(0).max(100).describe("Compliance score 0-100%"),
        weight: z.number().optional().describe("Optional: area importance weight"),
      })).min(3).max(30).describe("Compliance areas with scores"),
      framework: z.string().max(100).optional().describe("Framework name (SOC2, ISO27001, GDPR, HIPAA, etc.)"),
    },
    async ({ areas, framework }) => {
      try {
        const client = getClient();
        const scores = areas.map((a) => a.score);
        const d = clampD(scores.length);
        const bias = varianceBias(scores, 100);
        const result = await client.compute({ d, bias, samples: 2000 });
        const ain = Math.round(result.ain * 100);
        const label = framework ?? "Compliance";

        const sorted = [...areas].sort((a, b) => a.score - b.score);
        let text = `## ${label} — AIN ${ain}/100\n\n`;
        text += `| Area | Score | Status |\n|------|-------|--------|\n`;
        for (const a of sorted) {
          const status = a.score >= 90 ? "PASS" : a.score >= 70 ? "OK" : a.score >= 50 ? "WARN" : "FAIL";
          text += `| ${a.name} | ${a.score}% | ${status} |\n`;
        }

        const avgScore = scores.reduce((s, v) => s + v, 0) / scores.length;
        text += `\n**Average:** ${avgScore.toFixed(1)}% | **Weakest:** ${sorted[0].name} (${sorted[0].score}%)\n`;
        text += `**Tokens:** ${result.tokens_used}`;

        addHistory({ tool: "zpl_compliance", domain: "security", results: { framework, areas: areas.map((a) => a.name), tokens_used: result.tokens_used }, ain_scores: { [label]: ain } });
        return { content: [{ type: "text" as const, text }] };
      } catch (err) {
        return { content: [{ type: "text" as const, text: `Error: ${(err as Error).message}` }], isError: true };
      }
    }
  );
}
