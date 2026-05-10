/**
 * ZPL Engine HTTP client.
 * Talks to engine.zeropointlogic.io (or custom URL).
 * All computation happens server-side — this MCP never sees the formula.
 */

import { sanitizeSecrets } from "./store.js";
import { USER_AGENT } from "./user-agent.js";

export interface ComputeRequest {
  d: number;       // dimension 3-100
  bias: number;    // 0.0-1.0
  samples?: number; // 100-50000
}

export interface ComputeResponse {
  d: number;
  bias: number;
  p_output: number;
  ain: number;
  ain_status: string;
  deviation: number;
  status: string;
  samples: number;
  tokens_used: number;
  compute_ms: number;
}

export interface SweepResult {
  bias: number;
  p_output: number;
  ain: number;
  deviation: number;
  status: string;
}

export interface SweepResponse {
  d: number;
  samples: number;
  results: SweepResult[];
  total_tokens: number;
  compute_ms: number;
}

export interface PlanInfo {
  name: string;
  max_d: number;
  tokens_per_month: number;
  max_keys: number;
  price_usd: number;
  unlimited: boolean;
}

export interface HealthResponse {
  status: string;
  version: string;
}

export interface EngineError {
  error: string;
  code: number;
}

// v3.7.2: bound to [1, 600] so a typo (`ZPL_RATE_LIMIT=-1` or `=999999`) can't
// disable the cap or starve the engine. 600/min = 10/sec is plenty for any
// legitimate human + AI use; abusive callers bounce off the engine's own cap.
function safeRateLimit(): number {
  const raw = Number(process.env.ZPL_RATE_LIMIT);
  if (!Number.isFinite(raw) || raw <= 0) return 60;
  return Math.max(1, Math.min(600, Math.floor(raw)));
}
const RATE_LIMIT_PER_MIN = safeRateLimit();
const callLog: number[] = [];

function checkRateLimit(): boolean {
  const now = Date.now();
  while (callLog.length > 0 && callLog[0] < now - 60_000) {
    callLog.shift();
  }
  if (callLog.length >= RATE_LIMIT_PER_MIN) return false;
  callLog.push(now);
  return true;
}

/**
 * Parse a non-OK fetch response into a clear, actionable error message.
 *
 * Engine returns JSON `{error, code}` for its own failures. But when the
 * request is intercepted by Cloudflare (Bot Fight Mode challenge, rate
 * limit, "under attack" mode, or origin offline) the body is HTML — the
 * generic JSON parse falls back to `res.statusText`, which leaves users
 * staring at "Engine error 403: Forbidden" with no actionable next step.
 *
 * v3.7.2: detect HTML/Cloudflare bodies explicitly and return a message
 * that tells the user what actually happened and how to fix it.
 *
 * Exported so unit tests can feed it synthetic Response objects without
 * hitting the network.
 */
export async function parseEngineError(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") ?? "";
  const isHtml = ct.includes("text/html");
  const cfRay = res.headers.get("cf-ray");
  const cfMitigated = res.headers.get("cf-mitigated"); // "challenge" / "block"

  // v4.1.1 FIX: pre-v4.1.1 we used `(cfRay && res.status >= 400)` as a CF-block
  // signal. But Cloudflare adds cf-ray to EVERY response (it's the request ID
  // header), so a normal origin JSON error like
  //   HTTP/1.1 403  Content-Type: application/json
  //   {"error":"API key not found or inactive"}
  // was being mis-categorized as a Cloudflare HTML challenge — and the user
  // never saw the actual "API key not found" message. Only flag CF when the
  // body IS html or cf-mitigated explicitly says "challenge"/"block".
  if (isHtml || cfMitigated) {
    let snippet = "";
    try {
      const body = await res.text();
      // Look for tell-tale Cloudflare strings without dumping the whole HTML.
      if (/Just a moment|Checking your browser|cf-browser-verification|cf_chl_/i.test(body)) {
        snippet = "Cloudflare browser challenge intercepted the request";
      } else if (/Attention Required|cloudflare/i.test(body)) {
        snippet = "Cloudflare blocked the request";
      } else {
        snippet = "Cloudflare returned an HTML page instead of JSON";
      }
    } catch { /* body read failure — keep generic message */ }
    const ray = cfRay ? ` (cf-ray: ${cfRay})` : "";
    return [
      `Engine ${res.status} via Cloudflare${ray}: ${snippet}.`,
      "",
      "Likely causes & fixes:",
      "  • Your User-Agent looks like a bot. The MCP sends a Mozilla-compat UA;",
      "    if you're calling the engine yourself, set a browser-like User-Agent.",
      "  • Your IP hit Cloudflare rate limits. Wait 60 seconds and retry.",
      "  • Engine is temporarily unreachable. Check https://engine.zeropointlogic.io/health",
      "  • If this persists, report at https://github.com/cicicalex/zpl-engine-mcp/issues",
      ray ? `  • Include cf-ray ${cfRay} in any bug report.` : "",
    ].filter(Boolean).join("\n");
  }

  // Standard JSON error path. v4.1.0: sanitize the engine's `err.error` field
  // before it propagates up to tool error responses. The engine SHOULDN'T put
  // the user's API key in error bodies, but if it ever does (accidentally
  // echoing back the Authorization header in a debug dump, e.g.), we don't
  // want it landing in Claude Desktop's UI for the user (and possibly their
  // chat-export logs) to read.
  try {
    const err = await res.json() as EngineError;
    return sanitizeSecrets(`Engine error ${res.status}: ${err.error ?? res.statusText}`);
  } catch {
    return `Engine error ${res.status}: ${res.statusText}`;
  }
}

export class ZPLEngineClient {
  private baseUrl: string;
  private apiKey: string;
  private maxRetries: number;

  constructor(apiKey: string, baseUrl = "https://engine.zeropointlogic.io") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    // v3.7.2: bounded so a typo can't thrash the engine with retry storms.
    const rawRetries = Number(process.env.ZPL_MAX_RETRIES);
    this.maxRetries = Number.isFinite(rawRetries) && rawRetries >= 0
      ? Math.max(0, Math.min(5, Math.floor(rawRetries)))
      : 2;
  }

  private headers(): Record<string, string> {
    return {
      "Authorization": `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
      // CRITICAL: Cloudflare Bot Fight Mode on engine.zeropointlogic.io
      // 403s any UA that doesn't start with "Mozilla/". Pre-v4.1.1 this
      // header was missing, so /compute and /sweep were silently blocked
      // for every user. parseEngineError correctly diagnosed it as
      // "User-Agent looks like a bot" — but the bot was us. Now fixed.
      "User-Agent": USER_AGENT,
    };
  }

  /** Retry with exponential backoff for transient failures (5xx, network) */
  private async withRetry<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;
        const msg = lastError.message;
        // Don't retry client errors (4xx) — only transient failures
        if (msg.includes("401") || msg.includes("403") || msg.includes("400") || msg.includes("422")) {
          throw lastError;
        }
        if (attempt < this.maxRetries) {
          const delay = Math.min(1000 * 2 ** attempt, 4000);
          await new Promise(r => setTimeout(r, delay));
        }
      }
    }
    throw lastError!;
  }

  async compute(req: ComputeRequest): Promise<ComputeResponse> {
    if (!checkRateLimit()) {
      throw new Error(`Rate limit exceeded (${RATE_LIMIT_PER_MIN}/min). Wait a moment and try again.`);
    }
    return this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/compute`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          d: req.d,
          bias: req.bias,
          samples: req.samples ?? 1000,
        }),
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        throw new Error(await parseEngineError(res));
      }

      return res.json() as Promise<ComputeResponse>;
    }, 15000);
  }

  async sweep(d: number, samples?: number): Promise<SweepResponse> {
    if (!checkRateLimit()) {
      throw new Error(`Rate limit exceeded (${RATE_LIMIT_PER_MIN}/min). Wait a moment and try again.`);
    }
    return this.withRetry(async () => {
      const params = new URLSearchParams({ d: String(d) });
      if (samples) params.set("samples", String(samples));

      const res = await fetch(`${this.baseUrl}/sweep?${params}`, {
        headers: this.headers(),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        throw new Error(await parseEngineError(res));
      }

      return res.json() as Promise<SweepResponse>;
    }, 30000);
  }

  async health(): Promise<HealthResponse> {
    return this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/health`, {
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(await parseEngineError(res));
      return res.json() as Promise<HealthResponse>;
    }, 5000);
  }

  async plans(): Promise<PlanInfo[]> {
    return this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/plans`, {
        headers: this.headers(),
        redirect: "error",
      });
      if (!res.ok) throw new Error(await parseEngineError(res));
      const data = await res.json() as { plans: PlanInfo[] };
      return data.plans;
    }, 10000);
  }
}
