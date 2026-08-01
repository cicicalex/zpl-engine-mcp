/**
 * ZPL Engine HTTP client.
 * Talks to engine.zeropointlogic.io (or custom URL).
 * All computation happens server-side — this MCP never sees the formula.
 */

import { sanitizeSecrets } from "./store.js";
import { USER_AGENT } from "./user-agent.js";
import { getMcpPackageVersion } from "./package-meta.js";

export interface ComputeRequest {
  d: number;       // dimension 3-100
  bias: number;    // 0.0-1.0
  samples?: number; // 100-50000
}

/**
 * `ain_status` and `status` are TWO DIFFERENT FIELDS with different value sets.
 * They have been mixed up repeatedly in docs — do not treat them as synonyms.
 *
 *  ain_status — quality of the equilibrium, derived from `ain`:
 *               CERTIFIED_NEUTRAL | HIGHLY_NEUTRAL | NEUTRAL |
 *               MODERATE_BIAS | SIGNIFICANT_BIAS | HIGH_BIAS
 *
 *  status     — stability regime:
 *               STABLE | ACTIVE | INHIBITED_HIGH | INHIBITED_LOW
 *               (there is no plain "INHIBITED" value)
 */
export interface ComputeResponse {
  d: number;
  bias: number;
  p_output: number;
  /** Equilibrium score, 0.0–1.0 with 6 decimals. Never round to whole percent — see src/ain-format.ts. */
  ain: number;
  /** Equilibrium quality — see the note above; NOT the same field as `status`. */
  ain_status: string;
  deviation: number;
  /** Stability regime — see the note above; NOT the same field as `ain_status`. */
  status: string;
  samples: number;
  tokens_used: number;
  compute_ms: number;
}

export interface SweepResult {
  bias: number;
  p_output: number;
  /** Equilibrium score, 0.0–1.0 with 6 decimals. */
  ain: number;
  deviation: number;
  /** Stability regime (STABLE / ACTIVE / INHIBITED_HIGH / INHIBITED_LOW) — sweep steps carry no ain_status. */
  status: string;
}

/** One operator family's verdict on a supplied matrix. */
export interface FamilyVerdict {
  family: number;
  bit: 0 | 1;
  /**
   * The fold reached an exact tie and the centre decided it. A tie means no
   * majority was found at all — weaker than a confident bit, and worth saying
   * out loud rather than presenting as a settled answer.
   */
  tie_broken: boolean;
}

/**
 * Result of analysing one specific matrix.
 *
 * Carries no `ain` and no `p_output`, and not by omission: both describe how
 * output bits distribute across many sampled matrices, and over a single
 * matrix the proportion is 0 or 1 and says nothing about balance.
 */
export interface AnalyzeResponse {
  n: number;
  families: FamilyVerdict[];
  ones: number;
  unanimous: boolean;
  /**
   * Cells set to 1 in the caller's own matrix, and the total.
   *
   * AUDIT 2026-07-31: the engine was swept over 3..=100. At every even
   * dimension the four family bits for an all-zeros matrix are identical to
   * those for an all-ones matrix - 49 of 49 even dimensions, none of the 49
   * odd ones. Every paid ceiling except Pro's 25 is even: 16, 32, 48, 64, 100.
   *
   * Optional: an engine older than that sweep does not send them. Absent must
   * stay absent - an input_ones of 0 is an all-zeros matrix, a real answer.
   */
  input_ones?: number;
  cells?: number;
  degenerate?: boolean;
  tokens_used: number;
  compute_ms?: number;
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
    const raw = err.error ?? res.statusText;

    // v4.1.4: friendly upgrade nudge when the user hits their monthly quota.
    // The engine returns 403 with "Token limit exceeded: X/Y used this month"
    // which is technically accurate but unhelpful — the user has no idea
    // where to upgrade, and seeing "Forbidden" in Claude Desktop is hostile.
    // Convert that single class of error into a clear actionable message.
    // (audit complet 12.05 — discoverability finding.)
    if (/token limit exceeded/i.test(raw)) {
      // Try to pull the used/limit numbers out so the user sees how close they
      // were. Format: "Token limit exceeded: 5000/5000 used this month".
      const m = raw.match(/(\d+)\s*\/\s*(\d+)/);
      const used = m?.[1];
      const limit = m?.[2];
      const usage = used && limit ? ` (${used} / ${limit} tokens used this month)` : "";
      return sanitizeSecrets(
        [
          `You've hit your monthly ZPL Engine quota${usage}.`,
          "",
          "Upgrade options:",
          "  • Basic   $10/mo   10,000 tokens",
          "  • Pro     $29/mo   50,000 tokens   ← most popular",
          "  • GamePro $69/mo  150,000 tokens",
          "  • Studio $149/mo  500,000 tokens",
          "",
          "Upgrade in one click: https://zeropointlogic.io/pricing",
          "Or buy a one-off token pack: https://zeropointlogic.io/dashboard/billing",
          "",
          "Your quota resets on the first of next month.",
        ].join("\n"),
      );
    }

    return sanitizeSecrets(`Engine error ${res.status}: ${raw}`);
  } catch {
    return `Engine error ${res.status}: ${res.statusText}`;
  }
}

/**
 * How long to wait for each engine route, in milliseconds.
 *
 * AUDIT 2026-08-01: every deadline here used to sit BELOW the engine's own
 * ceiling for the same route - compute 15s against 30s, sweep 30s against 60s.
 * That ordering is the expensive way round. The engine deducts tokens before it
 * starts computing and refunds only when its own timeout or blocking task
 * fails; a client that gives up first leaves the request future to be dropped
 * on disconnect, with the deduction committed and no refund path reached.
 *
 * Measured: a sweep at d=48 with samples=50000 takes about 52 seconds
 * server-side - past the old 30s abort, inside the engine's 60s ceiling. Each
 * abandoned attempt cost 19 x 150 = 2850 tokens and returned nothing.
 *
 * Waiting past the engine turns that into a 504 the engine itself issues, which
 * does refund. Values are the engine's ceiling plus headroom for the network,
 * not round numbers - if the engine's ceilings move these have to move with
 * them, which is what the guard checks.
 */
const ENGINE_COMPUTE_CEILING_MS = 30_000;
const ENGINE_SWEEP_CEILING_MS = 60_000;
const NETWORK_HEADROOM_MS = 5_000;

const DEADLINE_COMPUTE_MS = ENGINE_COMPUTE_CEILING_MS + NETWORK_HEADROOM_MS;
const DEADLINE_SWEEP_MS = ENGINE_SWEEP_CEILING_MS + NETWORK_HEADROOM_MS;

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
      // ADR 0002 (zpl-engine-sdk/docs/adr/0002-x-zpl-client-headers.md):
      // structured client identity for engine telemetry (E2). Independent
      // of User-Agent free text — middleware can reliably partition
      // traffic by `X-ZPL-Client` instead of regex-matching UA strings.
      // Engine persists into usage_log.client_type / .client_version
      // when E2 ships (Alex / Rust). Until then, harmless to send.
      "X-ZPL-Client": "mcp",
      "X-ZPL-Client-Version": getMcpPackageVersion(),
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
        // AUDIT 2026-08-01: an aborted request is terminal too, and it was the
        // most expensive thing this loop could retry. The engine has already
        // charged for the call by the time the deadline fires, so re-sending
        // charges again for work that may still be running on the other side.
        // One user call became three billed ones.
        //
        // Matched on the abort's own shape rather than a status code, because
        // AbortSignal.timeout produces a DOMException with name "TimeoutError"
        // and no status at all - which is exactly why the 4xx check above let
        // it through.
        if (lastError.name === "TimeoutError" || lastError.name === "AbortError") {
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
        signal: AbortSignal.timeout(DEADLINE_COMPUTE_MS),
      });

      if (!res.ok) {
        throw new Error(await parseEngineError(res));
      }

      return res.json() as Promise<ComputeResponse>;
    }, 15000);
  }

  /**
   * Analyse a specific matrix — the engine sees the caller's data.
   *
   * `compute` does not send a matrix. It sends a dimension and a density, and
   * the engine generates fresh random matrices at that density and reports on
   * those. Two entirely different inputs of equal density therefore receive
   * the same answer, which is why domain tools built on `compute` cannot
   * distinguish a fair distribution from an abusive one.
   *
   * This sends the matrix itself and returns each operator family's verdict.
   */
  async analyze(matrix: number[][]): Promise<AnalyzeResponse> {
    if (!checkRateLimit()) {
      throw new Error(`Rate limit exceeded (${RATE_LIMIT_PER_MIN}/min). Wait a moment and try again.`);
    }
    return this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/analyze`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ matrix }),
        redirect: "error",
        signal: AbortSignal.timeout(DEADLINE_COMPUTE_MS),
      });

      if (!res.ok) {
        throw new Error(await parseEngineError(res));
      }

      return res.json() as Promise<AnalyzeResponse>;
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
        signal: AbortSignal.timeout(DEADLINE_SWEEP_MS),
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
