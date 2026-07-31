/**
 * Security tools — 3 tools for risk and vulnerability analysis.
 */

import { z } from "zod";
import type { Server } from "./helpers.js";
import { varianceBias, distributionBias, clampD, distributionFairness, cvssBand, riskMatrixBand } from "./helpers.js";
import { ZPLEngineClient } from "../engine-client.js";
import { addHistory } from "../store.js";
import { ainScale, fmtAin } from "../ain-format.js";

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
        const ain = ainScale(result.ain);
        const label = system_name ?? "System";

        // AUDIT 2026-07-31: posture came from AIN derived from varianceBias —
        // a spread measure. See the note above cvssBand in helpers.ts for the
        // measured before/after; the short version is that four components all
        // at CVSS 9.5 were told they had no single point of failure.
        const sorted = [...components].sort((a, b) => b.score - a.score);
        const worst = sorted[0];
        const posture = cvssBand(worst.score);
        let text = `## ${label} Vulnerability Map — worst component ${worst.score.toFixed(1)} CVSS (${posture.toUpperCase()})\n\n`;
        text += `**Engine AIN:** ${fmtAin(ain)}/100 — the engine's own reading, not the severity above.\n\n`;
        text += `| Component | CVSS | Risk | ${components[0].count !== undefined ? "Vulns |" : ""}\n`;
        text += `|-----------|------|------|${components[0].count !== undefined ? "-------|" : ""}\n`;
        for (const c of sorted) {
          // Same function as the posture above, so a row can never be labelled
          // CRITICAL under a summary that calls the system healthy.
          const risk = cvssBand(c.score).toUpperCase();
          text += `| ${c.name} | ${c.score.toFixed(1)} | ${risk} |`;
          if (c.count !== undefined) text += ` ${c.count} |`;
          text += `\n`;
        }

        const critical = sorted.filter((c) => cvssBand(c.score) === "critical").length;
        const high = sorted.filter((c) => cvssBand(c.score) === "high").length;
        text += `\n**Summary:** ${critical} critical, ${high} high, ${sorted.length - critical - high} medium/low\n`;

        if (posture === "critical") text += `**Posture:** Critical exposure — ${critical} component${critical === 1 ? "" : "s"} at CVSS 9 or above. Patch before anything else here.\n`;
        else if (posture === "high") text += `**Posture:** High exposure. ${high} component${high === 1 ? "" : "s"} in the 7-9 range — prioritise these.\n`;
        else if (posture === "medium") text += `**Posture:** Moderate exposure. Nothing critical, but the worst component is a real finding.\n`;
        else text += `**Posture:** Low exposure. No component scores above 4.\n`;

        // Spread is reported as an observation, not as safety. It used to be
        // the verdict, which is how a system with every component critical was
        // congratulated for having no single point of failure.
        //
        // CVSS starts at 0 and a clean system legitimately scores 0 across the
        // board. distributionFairness throws on an all-zero input, by design —
        // there is no distribution to judge — so calling it unguarded would
        // have made the healthiest possible report the one that errors out.
        if (scores.some((s) => s > 0)) {
          const spread = distributionFairness(scores);
          text +=
            spread.band === "fair"
              ? `**Spread:** Scores are close together — this posture is systemic, not one weak link.\n`
              : `**Spread:** Scores vary widely — ${worst.name} carries much more risk than the rest.\n`;
        } else {
          text += `**Spread:** Every component scores 0 — nothing to compare.\n`;
        }

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
        const ain = ainScale(result.ain);

        // AUDIT 2026-07-31: the Distribution line was decided by AIN derived
        // from distributionBias. An all-1x1 matrix and an all-5x5 matrix
        // produced identical output — "Risk concentrated in few areas" — and a
        // matrix with one 5x5 among three 1x1s, which genuinely is
        // concentrated, read "Risk is spread across areas".
        //
        // Two separate statements were collapsed into one: how bad the worst
        // risk is, and whether the risks resemble each other. They are now
        // reported separately, the first from the same thresholds the Priority
        // column already uses.
        const sorted = risks.map((r, i) => ({ ...r, score: riskScores[i] })).sort((a, b) => b.score - a.score);
        const worst = sorted[0];
        const worstBand = riskMatrixBand(worst.score);
        let text = `## Risk Matrix — worst risk ${worst.score}/25 (${worstBand.toUpperCase()})\n\n`;
        text += `**Engine AIN:** ${fmtAin(ain)}/100 — the engine's own reading, not the severity above.\n\n`;
        text += `| Risk | Likelihood | Impact | Score | Priority |\n`;
        text += `|------|------------|--------|-------|----------|\n`;
        for (const r of sorted) {
          text += `| ${r.name} | ${r.likelihood} | ${r.impact} | ${r.score} | ${riskMatrixBand(r.score).toUpperCase()} |\n`;
        }

        const worstCount = sorted.filter((r) => riskMatrixBand(r.score) === worstBand).length;
        text += `\n**Highest priority:** ${worst.name} at ${worst.score}/25`;
        text += worstCount > 1 ? ` (${worstCount} risks share this band)\n` : `\n`;
        const spread = distributionFairness(riskScores);
        text +=
          spread.band === "fair"
            ? `**Distribution:** Risk is spread evenly across the areas listed — no single area stands out.\n`
            : `**Distribution:** Risk is concentrated — ${worst.name} scores well above the rest.\n`;
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
        const ain = ainScale(result.ain);
        const label = framework ?? "Compliance";

        const sorted = [...areas].sort((a, b) => a.score - b.score);
        let text = `## ${label} — AIN ${fmtAin(ain)}/100\n\n`;
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
