/**
 * Auto-detect HTTP_PROXY / HTTPS_PROXY / NO_PROXY env vars and route Node's
 * native fetch through an undici ProxyAgent. Without this, corporate users
 * behind a TLS-inspecting proxy see every engine call time out — a complete
 * deal-breaker for enterprise adoption.
 *
 * Why this exists:
 *   Node 18+'s native fetch (built on undici) does NOT respect the standard
 *   proxy env vars by default. Most other tooling (curl, git, npm, pip) does.
 *   Users assume the same of every modern tool; when it doesn't, MCP simply
 *   "doesn't work" inside corporate networks and the user uninstalls.
 *
 * Resolution rules (mirror curl's behaviour):
 *   - HTTPS_PROXY (or https_proxy)  → used for https:// requests
 *   - HTTP_PROXY  (or http_proxy)   → used for http:// requests
 *   - NO_PROXY    (or no_proxy)     → comma-separated host list to bypass
 *                                     (suffix match: .company.com matches
 *                                      api.company.com)
 *   - ALL_PROXY   (or all_proxy)    → fallback for any scheme
 *
 * We install ONE global dispatcher at boot, so every fetch() call in the
 * MCP (engine-client, setup, eval-client, tools/*) gets proxy routing for
 * free. NO_PROXY hosts go direct via the EnvHttpProxyAgent's built-in bypass.
 *
 * Disable explicitly with ZPL_NO_PROXY=1 (e.g. if a misconfigured corporate
 * proxy is breaking us and the user wants to try direct).
 *
 * Ported from zpl-engine-cli src/proxy.ts so both clients honour the same
 * env vars with identical semantics.
 */
import { setGlobalDispatcher, EnvHttpProxyAgent } from "undici";

let installed = false;
let activeProxy: string | null = null;

/**
 * Return the effective proxy URL for an https:// request, just for diagnostic
 * output (zpl_diagnose tool, future about-style tool). Null = no proxy.
 */
export function detectActiveProxy(): string | null {
  if (process.env.ZPL_NO_PROXY === "1") return null;
  const httpsProxy =
    process.env.HTTPS_PROXY ?? process.env.https_proxy ?? null;
  const allProxy = process.env.ALL_PROXY ?? process.env.all_proxy ?? null;
  return httpsProxy ?? allProxy ?? null;
}

/**
 * Install the EnvHttpProxyAgent globally. Called at MCP boot (src/index.ts
 * main()) so every fetch() in the rest of the codebase honours proxy env
 * vars without each call site needing to know.
 *
 * Idempotent — safe to call twice.
 */
export function installProxyDispatcher(): void {
  if (installed) return;
  installed = true;

  if (process.env.ZPL_NO_PROXY === "1") {
    activeProxy = null;
    return;
  }

  const proxy = detectActiveProxy();
  if (!proxy) {
    activeProxy = null;
    return;
  }

  try {
    setGlobalDispatcher(new EnvHttpProxyAgent());
    activeProxy = proxy;
  } catch (err) {
    // Proxy install failure is non-fatal — fall back to direct connections.
    // We don't have process.stderr in the same way as the CLI (MCP is stdio
    // JSON-RPC, stderr is server logs), so we write a structured warning
    // that's clearly distinguishable from a JSON-RPC frame.
    process.stderr.write(
      `[zpl-engine-mcp] proxy: could not configure from HTTP_PROXY/HTTPS_PROXY: ` +
        `${(err as Error).message}. Falling back to direct connections.\n`,
    );
    activeProxy = null;
  }
}

/** For zpl_diagnose tool / debug output. */
export function getActiveProxy(): string | null {
  return activeProxy;
}
