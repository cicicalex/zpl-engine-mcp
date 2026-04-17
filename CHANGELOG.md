# Changelog

All notable changes to `zpl-engine-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.6.1] — 2026-04-17

### Fixed
- **Setup wizard now clears Cloudflare challenge.** `npx zpl-engine-mcp setup`
  used Node's default fetch User-Agent (`node`), which Cloudflare Bot Fight
  Mode on `zeropointlogic.io` silently rejected with HTTP 403 — the wizard
  printed "Could not contact zeropointlogic.io" and exited before ever
  showing a device code. Every fetch from the wizard now sends
  `Mozilla/5.0 (compatible; zpl-engine-mcp/<version>; +<repo URL>)`,
  matching the bingbot/slackbot convention, so Bot Fight Mode passes it
  through while we stay identifiable in server logs.

### Changed
- **Free plan quota corrected to 5,000 tokens/month.** All copy (README,
  `zpl_about`, `zpl_plans`, `PLAN_INFO` tables) previously referenced
  **500 tokens** from an early migration draft. Alex's final decision
  (per `feedback_free_plan_5k.md`): the free plan ships **5,000
  tokens/month** — enough for hobbyists to explore the engine without
  immediately hitting a paywall. The engine DB (`plan_limits.free.tokens_per_month = 5000`) has been the source of truth
  since Session 40; this release just syncs the MCP's static copy.
- **Token-cost table** in README now shows free-plan reachable calls:
  5,000 @ D3–D5 (1 tok/call), 2,500 @ D6–D9 (2 tok/call). D10+ requires
  Basic or higher (free is d=9 capped).

### Notes for upgraders from v3.4.4
This is the first npm publish after v3.4.4 — v3.5.0 and v3.6.0 were
prepared in-repo but never shipped. Jumping from 3.4.4 directly to 3.6.1
brings in:
- **v3.5.0** — service keys (`zpl_s_...`) rejected at startup; MCP is now
  user-key only (`zpl_u_...`).
- **v3.6.0** — `npx zpl-engine-mcp setup` device-flow wizard writes
  `~/.zpl/config.toml` and patches `claude_desktop_config.json` so
  install-to-working takes ~15 seconds instead of 10+ minutes of
  manual copy-paste.
- **v3.6.1** — the two items above.

### No behavior change
- MCP `zpl_plans` tool already reads `tokens_per_month` dynamically from
  the engine's `/plans` endpoint, so live quota was always correct.
- Only static copy in `zpl_about`, README, and fallback `PLAN_INFO`
  tables was stale. No auth, rate-limit, or API changes.

## [3.5.0] — 2026-04-17

### Security (BREAKING)
- **Service keys (`zpl_s_...`) no longer accepted.** MCP is a per-user tool
  that must authenticate with a user key so plan limits (token/month,
  dimension cap) apply per account. Service keys bypass all plan limits
  and are server-side only (engine-to-engine), now also IP-restricted on
  the engine side in a paired fix (see `zpl-api` M2.1).
- **`ZPL_SERVICE_KEY` fallback removed** from `resolveZplApiKey()`. Clients
  that set `ZPL_SERVICE_KEY` with a user key still work — just use
  `ZPL_API_KEY` or `ZPL_ENGINE_KEY` instead, same format
  (`zpl_u_<48 hex>`).

### Migration
If you see `Service keys are no longer accepted by the ZPL MCP` at
startup:
1. Create a user API key: https://zeropointlogic.io/dashboard/api-keys
2. Update MCP config env to `"ZPL_API_KEY": "zpl_u_..."`
3. Restart your MCP client

### Notes
- Claude Desktop / Cursor / Windsurf configs **should** pin
  `"zpl-engine-mcp@latest"` and use `npx -y` so new versions are picked
  up on restart.
- This is a semver-MAJOR-level behavioral change gated by the v3.4.4
  forced-upgrade mechanism — all v2.x installs were already required to
  reinstall. v3.x users keep working unless they set `ZPL_SERVICE_KEY`.

## [3.4.4] — 2026-04-17

### Changed
- **Forced upgrade on MAJOR version skew** — at startup, MCP queries `registry.npmjs.org/zpl-engine-mcp/latest` and parses the semver. If the installed MAJOR is behind the latest MAJOR, MCP now exits with a clear reinstall message instead of only warning. MINOR / PATCH behind still warn-and-continue. This protects users from running abandoned installs that miss security patches. Override: `ZPL_SKIP_UPDATE_CHECK=1` for offline / self-hosted / CI. Cache: 1h (was 24h) so post-release users pick up new majors quickly.
- **Semver-aware comparison** — parses `MAJOR.MINOR.PATCH` and reacts to each level separately; "block / warn features / warn fixes" instead of "any diff warns".
- **Version check is now awaited** (with ~2.5s network timeout) so the block decision happens before the stdio transport connects. Non-major results return `"ok"` fast.

### Notes for users
- Claude Desktop / Cursor / Windsurf configs **should** pin `"zpl-engine-mcp@latest"`. `npx -y zpl-engine-mcp@latest` re-resolves the dist-tag on every launch, so restarting the MCP client is all that's needed to pick up a new major after a forced block.
- Network errors from npm never block — version check is best-effort.

## [3.4.3] — 2026-04-16

### Security
- **Local engine host** — when `ZPL_ENGINE_ALLOW_INSECURE_LOCAL=1`, `localhost` / `127.0.0.1` / `::1` are allowed as hostnames (in addition to `http://` for those hosts). Previously only the scheme was relaxed; the hostname still had to be on `ZPL_ENGINE_HOST_ALLOWLIST`, which made local dev engines awkward.

### Changed
- **Single version source** — MCP server `version`, npm update check, `zpl_report` footer, and `zpl_account` footer read `version` from `package.json` at runtime via `getMcpPackageVersion()` (no duplicated semver strings in code).

### Added
- **`npm test`** — builds then runs `node:test` regression tests for `engine-url` (`test/engine-url.test.mjs`).

## [3.4.2] — 2026-04-16

### Security
- **Engine URL guard** — `ZPL_ENGINE_URL` must point at `engine.zeropointlogic.io` by default, or at hostnames you explicitly allow via `ZPL_ENGINE_HOST_ALLOWLIST` (comma-separated). Blocks accidental or malicious configs that would send your Bearer token to another host. Escape hatch: `ZPL_ENGINE_DISABLE_URL_GUARD=1` (not recommended).
- **No credentials in URL** — userinfo in `ZPL_ENGINE_URL` is rejected; use env vars for the API key only.
- **HTTPS by default** — `http://` is only allowed for `localhost` / `127.0.0.1` / `::1` when `ZPL_ENGINE_ALLOW_INSECURE_LOCAL=1` (local dev engines).
- **No automatic redirects on engine HTTP** — all `fetch` calls to the engine use `redirect: "error"` so a 3xx to an unexpected origin cannot follow with your Authorization header.

## [3.4.1] — 2026-04-16

Bug-fix pass. No behaviour changes to documented APIs; all 67 tools preserved.

### Fixed
- `zpl_consistency_test` — inverted bias input to the engine. Previously the bias was folded around 0.5 (`bias > 0.5 ? 1-bias : bias`), which clipped the signal and made highly-inconsistent and highly-consistent responses produce similar AIN scores. Now the bias is `1 - distributionBias(groups)` so HIGH engine-bias (→ LOW AIN) correctly corresponds to spread-out response clusters.
- AI Eval session budget double-counting. Each eval tool previously called `checkClaudeCallBudget(n)` at entry AND `sessionClaudeCalls += n` on success, charging 2× on happy paths. Now the budget is reserved up front inside `checkClaudeCallBudget` and the post-increment lines are removed — one charge per tool call.
- `zpl_alert` budget check silently always returned "OK". It only credited entries whose `results.totalTokens` was a number, but almost no tool writes that field. It now uses the same per-op estimate as `zpl_quota`.
- `zpl_validate_input` stack overflow risk on very large arrays (`Math.min(...values)` with 10k-element arrays can blow the arg-spread limit on some Node versions). Replaced with a single reduce loop.
- Version-check cache file was PID-suffixed, so the 24h "skip if cached" guard never hit across restarts. Fixed name now.
- Stale version strings: `zpl_account` was reporting `v2.1.0`, `zpl_report` was reporting `v1.0.0`. Both now track `package.json`.
- `ZPL_STORE_PATH` from the README was not actually read — code only honoured `ZPL_STORE_DIR`. Both now work; `ZPL_STORE_PATH` takes precedence when set.
- Store path validation now allows OS tmp directory too, not only `$HOME`, so containerised use cases work. Paths outside both still fall back to the default.
- `zpl_export` CSV: embedded commas, quotes, or newlines in tool/domain/question fields are now escaped per RFC 4180 instead of breaking downstream parsers.

### Changed (security)
- `ZPL_API_KEY` format is validated client-side (`^zpl_[us]_[a-f0-9]{48}$`). Fails fast with a clear error instead of sending a malformed Authorization header to the engine — also reduces the risk of accidentally leaking an unrelated secret (Stripe key, etc.) if a user pastes the wrong value.
- `zpl_sweep` and `zpl_analyze` now also honour the per-minute rate limiter (previously only `zpl_compute` was rate-limited).

### Removed
- `*Analyzed by ZPL Engine v3 — 8N+3 theorem*` footer from `zpl_check_response`. The reference hinted at engine internals; replaced with a plain `*Analyzed by ZPL Engine*`.

## [3.4.0] — 2026-04-15

AI Eval tools — 8 new tools for model behavioural consistency testing.

### Added
- `zpl_consistency_test` — run a prompt N times, score cluster consistency.
- `zpl_sycophancy_score` — present a false claim, check if the model pushes back.
- `zpl_refusal_balance` — mix safe + borderline + dangerous prompts, score refusal balance.
- `zpl_language_equity` — ask the same question in N languages, compare response length.
- `zpl_persona_drift` — multi-turn conversation with an assigned persona, detect character breaks.
- `zpl_safety_boundary` — escalation prompts from safe → dangerous, score boundary sharpness.
- `zpl_hallucination_consistency` — repeat factual questions at temperature 0, check if answers stay consistent.
- `zpl_emotional_stability` — sentiment trajectory across a conversation.
- `ANTHROPIC_API_KEY` env var — required only for AI Eval tools.
- Session Claude-call cap of 100 per process to prevent budget drain (restart MCP to reset).

### Changed
- `zpl_news_bias` and `zpl_review_bias` now run a multilingual propaganda-detection pass (EN + RO + FR + DE + ES + IT) with a symmetric uniformity penalty: texts that are 100% positive OR 100% negative (regardless of language) trigger the same high-bias bonus.

## [3.3.0] — 2026-04-15

Clearer tool names via backwards-compat aliases.

### Added
- `zpl_balance_check` — alias for `zpl_decide`.
- `zpl_balance_compare` — alias for `zpl_versus`.
- `zpl_balance_pair` — alias for `zpl_compare`.
- `zpl_balance_rank` — alias for `zpl_rank`.

### Changed
- Old names (`zpl_decide`, `zpl_versus`, `zpl_compare`, `zpl_rank`) marked DEPRECATED in their description but continue to work. No breaking change.
- Registered tool count: 67 (63 unique + 4 aliases).

## [3.2.0] — 2026-04-15

Onboarding tools + hard disclaimers + safety polish.

### Added
- `zpl_about` — project info, doc links, no auth required. Works before signup so new users can discover what the server does.
- `zpl_quota` — show remaining tokens this month plus reset date.
- `zpl_score_only` — minimal JSON output (`{ain, status}`) for CI/CD pipelines and programmatic consumers.
- `zpl_validate_input` — free input validation with no token cost. Sanity-check your payload before paying for a compute call.
- Auto-update check on startup (logs a hint when a newer version is available on npm).
- RNG sample-size warnings on `zpl_rng_test` when sample count is too small to draw reliable conclusions.

### Changed
- Signup message made friendlier for users without an API key.
- Hard disclaimers added to hypothetical/bias tools (`zpl_check_response`, `zpl_news_bias`, `zpl_review_bias`) clarifying that AIN measures *language balance*, not truth or factuality.
- Bias tools re-framed: language described as "language balance" instead of "fake/biased" to avoid moral-judgement framing.
- Tool count now **55** (up from 51).

## [3.1.0] — 2026-04-15

Observer-effect mitigation via runtime mode switch.

### Added
- `ZPL_MODE` environment variable with two values:
  - `pure` (default) — hides the raw AIN score from the AI on `zpl_check_response`, `zpl_news_bias`, and `zpl_review_bias`. The AI receives a verdict category only; the numeric score is surfaced to the user separately.
  - `coach` — exposes the AIN score to the AI on all tools (legacy behavior).

### Changed
- Text-evaluation tools now route through the mode check before returning. Rationale: when an AI sees "AIN = 42" in the tool result and then continues writing, its subsequent output can drift toward justifying the score. Pure mode breaks that feedback loop so stability measurements stay uncontaminated by downstream AI output.

## [3.0.0] — 2026-04-15 — BREAKING

Removed 5 tools that created false-authority risk. AIN is a STABILITY measurement only — never a prediction or a recommendation.

### Removed
- `zpl_ask` — accepted user-provided scores and returned "official AIN," which could be misrepresented as a ZPL endorsement of arbitrary user inputs. Replacement: `zpl_decide`, `zpl_compare`, `zpl_rank`.
- `zpl_certify` — generated "ZPL Certified" badges on arbitrary text. Scam-tool risk. Replacement: `zpl_check_response` (raw balance score, no certification claim).
- `zpl_certificate` — generated "Certificate IDs" and A+/F grades. Enabled forged ZPL endorsements. No replacement — manual review only.
- `zpl_predict` — name implied forecasting; users misused it for stock/lottery "predictions." Replacement: `zpl_chart` (historical visualization, no forecast).
- `zpl_auto_certify` — forced an AIN badge on every Claude response. Spam + false authority at scale. No replacement — explicit requests only.

### Changed
- Tool count **56 → 51**.
- IP Protection section in README expanded to make the scope of the v3.0 removals explicit.

## [2.3.0] — 2026-04-14

### Changed (security)
- Normalized filter input across all text-evaluation tools to defeat leet-speak bypass attempts (`h4ck`, `crypt0`, etc.).

## [2.2.0] — 2026-04-14

### Added
- `zpl_versus`, `zpl_simulate`, `zpl_certificate`, `zpl_predict`, `zpl_leaderboard`, `zpl_chart`, `zpl_teach`, `zpl_alert` — advanced tools.
- `zpl_check_response` — verify any text or AI response for bias.
- 5 certification tools (later consolidated; `zpl_certify`/`zpl_certificate`/`zpl_predict`/`zpl_auto_certify` were removed in 3.0).
- Package renamed to `zpl-engine-mcp` (no npm scope).
- IP protection section in README.

### Changed (security)
- All engine internals stripped from tool outputs. Responses now return `{ain, status, tokens_used}` only — no bias, deviation, p-output, dimension, or timing values.
- Blocked IP-extraction attempts in `zpl_ask` (removed entirely in 3.0).
- Smithery scanner support: `createSandboxServer` + stdin.isTTY detection so the server is scannable without leaking config at build time.

## [2.1.0] — 2026-04-13

### Added
- Full security hardening pass.
- Token sync between engine and frontend (tokens represent compute power, not currency).
- npm publish readiness: package metadata, keywords, files whitelist.
- `zpl_account` tool + enhanced `zpl_usage` dashboard with plan limits and reset date.
- 8 Smithery config options.
- Timeouts on all engine HTTP calls.
- Plan-based dimension caps enforced client-side (fail-fast before wasted tokens).

### Changed (security)
- Fixed all LOW-severity vulnerabilities reported by `npm audit`.
- Exponential backoff retry for transient engine failures (5xx only, never 4xx).

## [2.0.0] — 2026-04-12

### Added
- 41 tools across 7 domain lenses: Finance, Gaming, AI/ML, Security, Crypto, Certification, Universal.
- `zpl_ask` (universal AI), `zpl_history`, `zpl_watchlist`, `zpl_report`.

### Changed
- AIN range corrected to full engine precision 0.1–99.9 (was artificially clamped before).

## [1.0.0] — 2026-04-12

### Added
- Initial ZPL Engine MCP server: 6 tools, 5 domain lenses.

[3.4.3]: https://github.com/cicicalex/engine-mcp/releases/tag/v3.4.3
[3.4.2]: https://github.com/cicicalex/engine-mcp/releases/tag/v3.4.2
[3.4.1]: https://github.com/cicicalex/engine-mcp/releases/tag/v3.4.1
[3.4.0]: https://github.com/cicicalex/engine-mcp/releases/tag/v3.4.0
[3.3.0]: https://github.com/cicicalex/engine-mcp/releases/tag/v3.3.0
[3.2.0]: https://github.com/cicicalex/engine-mcp/releases/tag/v3.2.0
[3.1.0]: https://github.com/cicicalex/engine-mcp/releases/tag/v3.1.0
[3.0.0]: https://github.com/cicicalex/engine-mcp/releases/tag/v3.0.0
[2.3.0]: https://github.com/cicicalex/engine-mcp/releases/tag/v2.3.0
[2.2.0]: https://github.com/cicicalex/engine-mcp/releases/tag/v2.2.0
[2.1.0]: https://github.com/cicicalex/engine-mcp/releases/tag/v2.1.0
[2.0.0]: https://github.com/cicicalex/engine-mcp/releases/tag/v2.0.0
[1.0.0]: https://github.com/cicicalex/engine-mcp/releases/tag/v1.0.0
