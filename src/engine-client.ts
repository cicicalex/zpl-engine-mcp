/**
 * ZPL Engine HTTP client.
 * Talks to engine.zeropointlogic.io (or custom URL).
 * All computation happens server-side — this MCP never sees the formula.
 */

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

export class ZPLEngineClient {
  private baseUrl: string;
  private apiKey: string;
  private maxRetries: number;

  constructor(apiKey: string, baseUrl = "https://engine.zeropointlogic.io") {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.maxRetries = Number(process.env.ZPL_MAX_RETRIES) || 2;
  }

  private headers(): Record<string, string> {
    return {
      "Authorization": `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
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
    return this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/compute`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          d: req.d,
          bias: req.bias,
          samples: req.samples ?? 1000,
        }),
        signal: AbortSignal.timeout(15000),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText, code: res.status })) as EngineError;
        throw new Error(`Engine error ${res.status}: ${err.error}`);
      }

      return res.json() as Promise<ComputeResponse>;
    }, 15000);
  }

  async sweep(d: number, samples?: number): Promise<SweepResponse> {
    return this.withRetry(async () => {
      const params = new URLSearchParams({ d: String(d) });
      if (samples) params.set("samples", String(samples));

      const res = await fetch(`${this.baseUrl}/sweep?${params}`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(30000),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText, code: res.status })) as EngineError;
        throw new Error(`Engine error ${res.status}: ${err.error}`);
      }

      return res.json() as Promise<SweepResponse>;
    }, 30000);
  }

  async health(): Promise<HealthResponse> {
    return this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/health`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error(`Engine unreachable: ${res.status}`);
      return res.json() as Promise<HealthResponse>;
    }, 5000);
  }

  async plans(): Promise<PlanInfo[]> {
    return this.withRetry(async () => {
      const res = await fetch(`${this.baseUrl}/plans`, {
        headers: this.headers(),
      });
      if (!res.ok) throw new Error(`Failed to fetch plans: ${res.status}`);
      const data = await res.json() as { plans: PlanInfo[] };
      return data.plans;
    }, 10000);
  }
}
