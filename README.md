# ZPL Engine MCP Server

Model Context Protocol (MCP) server for the **Zero Point Logic Engine** — a post-binary stability and neutrality analysis system.

Connects any MCP-compatible AI client (Claude Desktop, Claude Code, Cursor, Windsurf, etc.) to the ZPL Engine API for real-time bias detection, stability scoring, and neutrality analysis across multiple domains.

**68 tools** (64 unique + 4 backwards-compat aliases) across 11 categories: Core, Finance, Gaming, AI/ML, Security, Crypto, Certification, Advanced, Universal, Meta, and AI Eval.

## What's new in v4.0.0 (MAJOR RELEASE)

Two months of incremental work consolidated. **21 bugs fixed**, **146 tests** (98 unit + 48 live MCP integration), **Windows + Linux verified**. Backwards compatible — legacy `zpl_u_<48hex>` keys still work, all 68 tools keep the same input shape.

### New commands
- **`npx zpl-engine-mcp setup`** — now memory-aware. Detects existing config and offers keep / re-setup / patch-only instead of forcing a fresh login. `--force` bypasses.
- **`npx zpl-engine-mcp whoami`** — shows which account this install is logged into.
- **`npx zpl-engine-mcp repair`** — wipes local config + removes the entry from each MCP client config (Claude Desktop, Cursor, Windsurf). Preserves unrelated entries. `--yes` skips confirmation.
- **`npx zpl-engine-mcp --help`** / `--version` — POSIX-standard usage and version flags.
- **`zpl_diagnose` MCP tool** — full health report (config + key + engine + auth) for issue reports.

### Critical fixes
- **API key regex** now accepts wizard-issued keys with type prefixes (`zpl_u_mcp_`, `zpl_u_cli_`, `zpl_u_default_`). Pre-4.0 the wizard install always failed silently.
- **Cloudflare HTML responses explained** — actionable error messages with cf-ray ID instead of generic 403.
- **Smoke test at end of setup** — catches replication lag between wizard approval and engine acceptance.
- **Secret sanitizer in history** — no longer leaks wizard-prefixed ZPL keys or full Anthropic `sk-ant-*` tokens (regex was truncating at first hyphen).
- **Safety bounds on numeric env vars** — `ZPL_RATE_LIMIT` clamped to [1, 600], `ZPL_MAX_RETRIES` to [0, 5].

### Tool fixes
- `zpl_simulate` 0/0 result on positive inputs (switched to distributionBias + identical-input short-circuit).
- `zpl_liquidity` table/verdict misalignment (verdict now cites per-pool counts).
- `zpl_quota` plan auto-detection from config.toml (env > config > "free").
- `zpl_quota` + `zpl_alert` token estimate accuracy — 22 tools now persist real `tokens_used` instead of hardcoded heuristic.
- `zpl_teach` snippet referenced never-published `@zeropointlogic/engine-mcp` package name.
- Duplicate Claude Desktop entries auto-deduplicated on `setup`.
- `LANGUAGE` dead-code env var removed.

See [CHANGELOG](./CHANGELOG.md) for the complete list with rationales.

## What's new in v3.7.0

- **Setup wizard auto-configures Cursor and Windsurf, not just Claude Desktop.** Each run patches `claude_desktop_config.json`, `~/.cursor/mcp.json`, and `~/.codeium/windsurf/mcp_config.json` in a single pass. Clients that aren't installed are skipped silently; each patch is isolated so one missing client never blocks the others. Empty pre-existing config files (common for Cursor's stub `{"mcpServers":{}}`) are now handled correctly.

## What's new in v3.6.1

- **Free plan quota corrected** — all docs/copy now show **5,000 tokens/month** (was erroneously "500 tokens / ~14 days" in early migration draft). Engine-side was already 5,000; this release just syncs the MCP. See [CHANGELOG](./CHANGELOG.md).

## What's new in v3.6.0

- **`npx zpl-engine-mcp setup`** — one-command device-flow wizard: opens browser, authenticates with your ZPL account, creates a per-machine API key, and auto-patches `claude_desktop_config.json`. No more copy-paste.
- **User-key only** — `ZPL_SERVICE_KEY` fallback removed. MCP requires a `zpl_u_...` user key so plan limits apply per account.

## What's new in v3.4.3

- **Local dev fix** — with `ZPL_ENGINE_ALLOW_INSECURE_LOCAL=1`, `localhost` / `127.0.0.1` / `::1` are accepted as engine hostnames (not only production). Use with `http://127.0.0.1:PORT` for a local engine.
- **Version from `package.json`** — MCP `version` field, update check, and report footers no longer hardcode semver strings.
- **`npm test`** — regression tests for engine URL validation (`npm run build && node --test test/engine-url.test.mjs`).

## What's new in v3.4.2

- **Engine URL hardening** — default allowlist is `engine.zeropointlogic.io` only. Self-hosted engines: set `ZPL_ENGINE_HOST_ALLOWLIST=your.hostname`. Local HTTP: `ZPL_ENGINE_ALLOW_INSECURE_LOCAL=1` with `http://127.0.0.1` only. Optional `ZPL_ENGINE_DISABLE_URL_GUARD=1` disables hostname checks (not recommended). All engine `fetch` calls use `redirect: "error"` so redirects cannot carry your Bearer token to a new origin.

## What's new in v3.4.1

- **v3.4.1** — Bug fixes: fixed `zpl_consistency_test` bias inversion (inconsistent responses now correctly lower AIN), session-budget double-counting on Claude eval tools (upfront reservation instead of post-increment), `zpl_alert` budget calc that silently always said "OK" (now uses the same estimate as `zpl_quota`), `zpl_validate_input` stack overflow on very large arrays (reduce loop instead of `Math.min(...values)`), version-check cache ignoring its own 24h window (fixed filename instead of PID-suffixed), stale version strings in `zpl_account`/`zpl_report` output. Store now honours `ZPL_STORE_PATH` (documented) in addition to legacy `ZPL_STORE_DIR`. CSV export now escapes embedded commas/quotes. API key format is validated client-side (fail-fast on obvious mis-paste, prevents accidentally leaking unrelated secrets in the Authorization header). Removed an internal engine-method reference from `zpl_check_response` output. Core `zpl_sweep` and `zpl_analyze` now honour the per-minute rate limiter.
- **v3.4.0** — 8 new AI Eval tools (`zpl_consistency_test`, `zpl_sycophancy_score`, `zpl_refusal_balance`, `zpl_language_equity`, `zpl_persona_drift`, `zpl_safety_boundary`, `zpl_hallucination_consistency`, `zpl_emotional_stability`) that run prompts through Claude and score response distributions with the ZPL engine. Requires a separate `ANTHROPIC_API_KEY` env var. Session budget cap of 100 Claude calls per process to prevent accidental spend. Multilingual propaganda-detection update for `zpl_news_bias` / `zpl_review_bias`: EN + RO + FR + DE + ES + IT keyword lists with a symmetric uniformity penalty (100% positive-only OR 100% negative-only texts trigger the same bonus).
- **v3.3.0** — Added 4 clearer "balance"-prefixed aliases: `zpl_balance_check` (= `zpl_decide`), `zpl_balance_compare` (= `zpl_versus`), `zpl_balance_pair` (= `zpl_compare`), `zpl_balance_rank` (= `zpl_rank`). Both old and new names work; old names get a DEPRECATED note in their description. Existing users keep working without changes.
- **v3.2.0** — 4 new tools: `zpl_about` (project info, no auth), `zpl_quota` (remaining tokens), `zpl_score_only` (minimal JSON for CI/CD), `zpl_validate_input` (free validation). Auto-update check, friendlier signup message, hard disclaimers on hypothetical/bias tools, RNG sample-size warnings, and bias tools re-framed as "language balance" instead of "fake/biased".
- **v3.1.0** — Added `ZPL_MODE` env var (`pure` | `coach`). Pure mode hides AIN scores from the AI on text-evaluation tools (`zpl_check_response`, `zpl_news_bias`, `zpl_review_bias`) to prevent reactivity bias / observer effect.
- **v3.0.0 (BREAKING)** — Removed 5 tools that created false-authority risk: `zpl_ask`, `zpl_certify`, `zpl_certificate`, `zpl_predict`, `zpl_auto_certify`. AIN is a STABILITY measurement only — never a prediction or recommendation.

## Setup (free, 15 seconds)

Run this in your terminal — it authenticates you, creates an API key, and
writes your Claude Desktop config for you:

```bash
npx zpl-engine-mcp@latest setup
```

The wizard will:
1. Open your browser to approve the CLI (sign up if you don't have an account — free, **5,000 tokens/month**, no credit card)
2. Save the key to `~/.zpl/config.toml` (chmod 600)
3. Patch the MCP config of every supported client that's installed:
   - **Claude Desktop** — `claude_desktop_config.json`
   - **Cursor** — `~/.cursor/mcp.json`
   - **Windsurf** — `~/.codeium/windsurf/mcp_config.json`
4. Print which clients were configured and which to restart.

That's it. Clients that aren't installed are skipped silently. If you're
using a client we don't auto-detect (Claude Code, VS Code, Zed, ...), the
wizard prints the exact JSON snippet to paste into that client's MCP
config.

<details>
<summary><strong>Manual setup (advanced)</strong></summary>

If you can't run the wizard (air-gapped install, policy restriction, etc.):

1. Sign up at [zeropointlogic.io/auth/register](https://zeropointlogic.io/auth/register) — free, 5,000 tokens/month, no credit card.
2. Copy your `zpl_u_...` key from [/dashboard](https://zeropointlogic.io/dashboard).
3. Add to your Claude Desktop config:

```json
{
  "mcpServers": {
    "zpl-engine": {
      "command": "npx",
      "args": ["-y", "zpl-engine-mcp@latest"],
      "env": {
        "ZPL_API_KEY": "zpl_u_YOUR_KEY_HERE",
        "ZPL_MODE": "pure"
      }
    }
  }
}
```

4. Restart Claude Desktop.
</details>

## What is ZPL Engine?

The ZPL Engine computes the **AIN (AI Neutrality Index)** — a mathematical measure of how stable or biased a system is. It works across:

- **Finance** — market stability, portfolio bias, risk concentration, forex pairs, fear & greed
- **Gaming** — economy balance, loot fairness, matchmaking, gacha audit, PvP balance
- **AI/ML** — model fairness, prediction bias, dataset balance, prompt testing, benchmarks
- **Security** — vulnerability distribution, risk matrix, compliance scoring
- **Crypto** — whale concentration, DeFi risk, liquidity analysis, tokenomics
- **Certification** — language-balance check on text, debate balance, news balance, review authenticity
- **Universal** — quick decisions, structured comparison, AIN ranking, response balance check

One engine, multiple domains. The engine doesn't know what your data represents — domain "lenses" translate your specific data into the universal mathematical framework.

## Modes (ZPL_MODE)

ZPL Engine MCP supports two modes for how text-evaluation results are returned:

| Mode | Behavior | When to use |
|------|----------|-------------|
| `pure` (default) | AIN score is **hidden from the AI** on `zpl_check_response`, `zpl_news_bias`, `zpl_review_bias`. The AI gets a verdict category only; the user sees the numeric score separately. | Default for most users. Prevents the **observer effect** — once the AI knows the numeric score, its subsequent output can drift toward it, contaminating downstream analysis. |
| `coach` | AIN score is **exposed to the AI** on all tools. | When you explicitly want the AI to reason *about* the score (e.g. teaching mode, debugging, writing articles about balance scores). |

**Why this matters:** stability scoring only works if the measurement doesn't change the thing it measures. If an AI sees "AIN = 42" and then writes the next paragraph, its language naturally drifts to justify the score. Pure mode breaks that feedback loop.

Set via env: `"ZPL_MODE": "pure"` or `"ZPL_MODE": "coach"`.

## Installation

**Via npm (recommended):**

```bash
npm install zpl-engine-mcp
```

**Or clone and build:**

```bash
git clone https://github.com/cicicalex/zpl-engine-mcp.git
cd zpl-engine-mcp
npm install
npm run build
```

### Alternative client configs

#### Claude Code CLI (.claude/settings.json)

```json
{
  "mcpServers": {
    "zpl-engine": {
      "command": "npx",
      "args": ["-y", "zpl-engine-mcp@latest"],
      "env": {
        "ZPL_API_KEY": "zpl_u_YOUR_KEY_HERE",
        "ZPL_MODE": "pure"
      }
    }
  }
}
```

#### Local build

```json
{
  "mcpServers": {
    "zpl-engine": {
      "command": "node",
      "args": ["/path/to/engine-mcp/dist/index.js"],
      "env": {
        "ZPL_API_KEY": "zpl_u_YOUR_KEY_HERE"
      }
    }
  }
}
```

#### Cursor / Windsurf

Add to your MCP configuration following the respective IDE's documentation, with the same command/args/env structure.

## Tool Categories (67 tools)

Unique tool names: 63. With 4 backwards-compat aliases (`zpl_balance_*` pairs) the registered total is 67.

| Category | Tools | Examples |
|----------|-------|---------|
| **Core** | 9 | `zpl_compute`, `zpl_sweep`, `zpl_analyze`, `zpl_domains`, `zpl_health`, `zpl_plans`, `zpl_history`, `zpl_watchlist`, `zpl_report` |
| **Finance** | 7 | `zpl_market_scan`, `zpl_portfolio`, `zpl_fear_greed`, `zpl_forex_pair`, `zpl_sector_bias`, `zpl_macro`, `zpl_correlation` |
| **Gaming** | 6 | `zpl_loot_table`, `zpl_matchmaking`, `zpl_economy_check`, `zpl_pvp_balance`, `zpl_gacha_audit`, `zpl_rng_test` |
| **AI/ML** | 4 | `zpl_model_bias`, `zpl_dataset_audit`, `zpl_prompt_test`, `zpl_benchmark` |
| **Security** | 3 | `zpl_vuln_map`, `zpl_risk_score`, `zpl_compliance` |
| **Crypto** | 4 | `zpl_whale_check`, `zpl_defi_risk`, `zpl_liquidity`, `zpl_tokenomics` |
| **Certification** | 3 | `zpl_debate`, `zpl_news_bias`, `zpl_review_bias` |
| **Advanced** | 7 | `zpl_simulate`, `zpl_leaderboard`, `zpl_chart`, `zpl_teach`, `zpl_alert`, `zpl_versus` (+ alias `zpl_balance_compare`) |
| **Universal** | 8 | `zpl_check_response`, `zpl_explain`, `zpl_decide` (+ alias `zpl_balance_check`), `zpl_compare` (+ alias `zpl_balance_pair`), `zpl_rank` (+ alias `zpl_balance_rank`) |
| **Meta** | 8 | `zpl_about`, `zpl_quota`, `zpl_score_only`, `zpl_validate_input`, `zpl_batch`, `zpl_export`, `zpl_usage`, `zpl_account` |
| **AI Eval** | 8 | `zpl_consistency_test`, `zpl_sycophancy_score`, `zpl_refusal_balance`, `zpl_language_equity`, `zpl_persona_drift`, `zpl_safety_boundary`, `zpl_hallucination_consistency`, `zpl_emotional_stability` |

### New in v3.2: Meta tools

| Tool | Auth | Purpose |
|------|------|---------|
| `zpl_about` | No | Project info + doc links — works before signup |
| `zpl_quota` | Yes | Remaining tokens this month, reset date |
| `zpl_score_only` | Yes | Minimal JSON `{ain, status}` for CI/CD pipelines |
| `zpl_validate_input` | No | Input validation with no token cost — sanity check before paying |

### v3.0.0 Removed Tools (and why)

| Removed | Why | Replacement |
|---------|-----|-------------|
| `zpl_ask` | Accepted user-provided scores → returned "official AIN" → false authority risk | `zpl_decide`, `zpl_compare`, `zpl_rank` |
| `zpl_certify` | Generated "ZPL Certified" badge on arbitrary text → scam-tool risk | `zpl_check_response` (raw balance score, no certification claim) |
| `zpl_certificate` | Generated "Certificate ID" + grades A+/F → enabled fake ZPL endorsements | None — manual review only |
| `zpl_predict` | Name implies prediction; users misused for stock/lottery "predictions" | `zpl_chart` (historical visualization, no forecast) |
| `zpl_auto_certify` | Forced AIN badge on every Claude response → spam + false authority at scale | None — explicit user requests only |

### Quick Examples

```
> Analyze my crypto portfolio for balance: BTC 40%, ETH 25%, SOL 15%, AVAX 10%, DOT 10%

> Check if this loot table is fair: Common 60%, Uncommon 25%, Rare 10%, Legendary 5%

> Is my ML model output balanced? Class A: 1200 predictions, Class B: 300 predictions

> Check this AI response for language balance

> Compare React vs Vue across 5 criteria
```

## Pricing Plans

All paid plans offer **20% discount with annual billing**.

| Plan | Monthly | Annual | Max D | Tokens/mo | Keys |
|------|---------|--------|-------|-----------|------|
| Free | $0 | — | d=9 | 5,000 | 1 |
| Basic | $10/mo | $8/mo | d=16 | 10,000 | 1 |
| Pro | $29/mo | $23/mo | d=25 | 50,000 | 3 |
| GamePro | $69/mo | $55/mo | d=32 | 150,000 | 5 |
| Studio | $149/mo | $119/mo | d=48 | 500,000 | 10 |
| Agent | $199/mo | $159/mo | d=48 | 2,000,000 | 15 |
| Enterprise | $499/mo | $399/mo | d=64 | 10,000,000 | 25 |
| Enterprise XL | $999/mo | $799/mo | d=100 | 50,000,000 | 50 |

## Token Cost

Token cost depends on the dimension tier:

| Dimension | Tokens/call | Sweep (19x) | Free plan (5,000, d<=9) |
|-----------|-------------|-------------|-------------------------|
| D3–D5 | 1 | 19 | 5,000 calls |
| D6–D9 | 2 | 38 | 2,500 calls |
| D10–D16 | 5 | 95 | — (needs Basic+) |
| D17–D25 | 15 | 285 | — (needs Pro+) |
| D26–D32 | 40 | 760 | — (needs GamePro+) |
| D33–D48 | 150 | 2,850 | — (needs Studio+) |
| D49–D64 | 500 | 9,500 | — (needs Enterprise) |
| D65+ | 2,000 | 38,000 | — (needs Enterprise XL) |

## API Key Management

- Keys are generated at [zeropointlogic.io/dashboard/api-keys](https://zeropointlogic.io/dashboard/api-keys)
- Format: `zpl_u_` + 48 hex characters (user keys). **v3.5.0+: the MCP only accepts user keys.** Service keys (`zpl_s_...`) are engine-to-engine only — server-side, IP-restricted, not MCP-usable.
- Keys are SHA-256 hashed server-side — the plaintext is shown **once** at creation
- **To rotate a key:** create a new key, update your MCP config, restart Claude, then delete the old key
- If a key is compromised, delete it immediately from the dashboard — it's invalidated instantly

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ZPL_API_KEY` | **Yes*** | — | Your user API key (`zpl_u_...` — 48 hex chars). *Optional for `zpl_about` and `zpl_validate_input`. Format is validated client-side. Service keys (`zpl_s_...`) are rejected from v3.5.0 — they're engine-to-engine only and use IP allowlisting instead of plan limits. |
| `ZPL_MODE` | No | `pure` | `pure` hides AIN from AI on text-eval tools; `coach` exposes it. See Modes above. |
| `ZPL_ENGINE_URL` | No | `https://engine.zeropointlogic.io` | Engine base URL (must match host allowlist; see Security) |
| `ZPL_ENGINE_HOST_ALLOWLIST` | No | — | Extra allowed hostnames (comma-separated), e.g. `staging.engine.example.com` for self-hosted engines |
| `ZPL_ENGINE_ALLOW_INSECURE_LOCAL` | No | unset | Set to `1` to allow `http://` to localhost / 127.0.0.1 / ::1 **and** to treat those hostnames as allowed (no extra `ZPL_ENGINE_HOST_ALLOWLIST` needed for local dev) |
| `ZPL_ENGINE_DISABLE_URL_GUARD` | No | unset | Set to `1` to skip hostname allowlist (dangerous; mistyped URLs could exfiltrate your API key) |
| `ZPL_RATE_LIMIT` | No | `60` | Max requests per minute (applies to `zpl_compute`, `zpl_sweep`, `zpl_analyze`) |
| `ZPL_BUDGET_WARN` | No | `500` | Token budget warning threshold |
| `ZPL_MAX_RETRIES` | No | `2` | Retry count for transient engine failures (5xx only) |
| `ZPL_STORE_PATH` | No | `~/.zpl-engine/` | Local history storage path (legacy alias: `ZPL_STORE_DIR`). Must resolve inside `$HOME` or the OS tmp dir; otherwise falls back to default. |
| `ANTHROPIC_API_KEY` | Only for AI Eval tools | — | Required for the 8 AI Eval tools (`zpl_consistency_test`, etc.). Session capped at 100 Claude calls per process. |

## Architecture

```
Your AI Client (Claude, Cursor, etc.)
    |
    v (MCP Protocol — stdio)
ZPL Engine MCP Server (this package)
    |
    +-- Tool modules (data -> engine params)
    |   +-- finance, gaming, ai-ml, security, crypto
    |   +-- certification, advanced, universal, meta
    |
    v (HTTPS — Bearer auth)
ZPL Engine API (engine.zeropointlogic.io)
    |
    v (Post-binary computation)
    AIN Result (0.1-99.9)
```

The MCP server **never** sees or contains the engine formula. It sends `(d, bias, samples)` and receives `(ain, deviation, status)`. All computation happens server-side.

## Security

- All inputs validated via Zod schemas with strict maxLength limits
- API keys never logged or stored in plaintext locally
- **Engine URL allowlist** — requests only go to `engine.zeropointlogic.io` unless you add hosts with `ZPL_ENGINE_HOST_ALLOWLIST`. Rejects userinfo embedded in `ZPL_ENGINE_URL` (use env vars for keys). `fetch(..., { redirect: "error" })` prevents following HTTP redirects that could send your Bearer token elsewhere.
- In-memory rate limiting (configurable)
- Exponential backoff retry for transient engine failures (5xx only, not 4xx)
- Fail-fast startup if `ZPL_API_KEY` is not set (except for no-auth tools)
- Local history sanitizes API key prefixes before writing

## IP Protection (v3.0.0+)

The ZPL Engine computation method is a trade secret of Zero Point Logic. This MCP has been hardened to never expose it:

- Tool outputs return **AIN score + status + tokens used only**. No bias, deviation, p-output, dimension, or timing values are exposed.
- The MCP never receives or processes the engine formula — it sends `(d, bias, samples)` to the server and receives `(ain, status)` back.
- All computation happens server-side on the proprietary engine. The client-side code contains no algorithmic secrets.
- v3.0 removed tools that allowed user-provided scores to be presented as official AIN measurements (false authority risk).

## License

MIT (covers the MCP client code only). The ZPL Engine computation algorithm, AIN formula, and server-side processing are proprietary trade secrets of Zero Point Logic and are **NOT** covered by this license.

## Author

**Ciciu Alexandru-Costinel** — [Zero Point Logic](https://zeropointlogic.io)

## Links

- [ZPL Engine](https://zeropointlogic.io) — Main site
- [Finance Monitor](https://finance.zeropointlogic.io) — Live financial analysis
- [API Documentation](https://zeropointlogic.io/docs) — Full API reference
- [Pricing](https://zeropointlogic.io/pricing) — Plans & API keys
- [Smithery Registry](https://smithery.ai) — MCP discovery

See [CHANGELOG.md](./CHANGELOG.md) for full version history.
