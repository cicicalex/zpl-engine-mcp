/**
 * Tool registry — imports and registers all tool modules.
 */

import type { Server } from "./helpers.js";
import type { ZPLEngineClient } from "../engine-client.js";
import { registerFinanceTools } from "./finance.js";
import { registerGamingTools } from "./gaming.js";
import { registerAIMLTools } from "./ai-ml.js";
import { registerSecurityTools } from "./security.js";
import { registerCryptoTools } from "./crypto.js";
import { registerUniversalTools } from "./universal.js";
import { registerMetaTools } from "./meta.js";
import { registerAdvancedTools } from "./advanced.js";
import { registerCertificationTools } from "./certification.js";
import { registerEvalTools } from "./eval.js";

export function registerAllTools(server: Server, getClient: () => ZPLEngineClient): void {
  registerFinanceTools(server, getClient);       // 7 tools
  registerGamingTools(server, getClient);        // 6 tools
  registerAIMLTools(server, getClient);          // 4 tools
  registerSecurityTools(server, getClient);      // 3 tools
  registerCryptoTools(server, getClient);        // 4 tools
  registerUniversalTools(server, getClient);     // 5 tools (decide, compare, rank, explain, check_response)
  registerMetaTools(server, getClient);          // 4 tools (batch, export, usage, account)
  registerAdvancedTools(server, getClient);      // 8 tools (versus, simulate, certificate, predict, leaderboard, chart, teach, alert)
  registerCertificationTools(server, getClient); // 5 tools (certify, debate, news_bias, review_bias, auto_certify)
  registerEvalTools(server, getClient);          // 8 tools (consistency, sycophancy, refusal, language, persona, safety, hallucination, emotional)
}
