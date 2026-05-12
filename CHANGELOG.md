# Changelog

All notable changes to `zpl-engine-mcp` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [4.1.4] — 2026-05-12

Funnel finding from the 12.05 audit: when a free-tier user runs out of
their monthly token budget, the engine returns HTTP 403 with the body
"Token limit exceeded: X/Y used this month". The MCP surfaced that raw
to Claude Desktop as a generic "Engine error 403", giving the user no
hint that they had simply hit a quota and could upgrade. Most users in
that state silently churn — the most engaged segment lost at the
precise moment they were ready to convert.

### Fixed

- `parseEngineError()` in `engine-client.ts` now detects the
  `/token limit exceeded/i` pattern and replaces the raw message with a
  friendly multi-line block containing a plan ladder
  (Basic $10 → GamePro $69 → Studio $149), a direct link to
  `https://zeropointlogic.io/pricing`, a fallback one-off pack link,
  and a note about the monthly quota reset.
- Numbers are parsed out of the engine response (`5000/5000`) so the
  message can show the actual usage if available.

No other surface changes. Engine response shape and the rest of the
MCP tool catalog are unaffected.

## [4.1.3] — 2026-05-12

Security finding from the 12.05 audit: the `setup` wizard wrote
`ZPL_API_KEY` in plaintext to `claude_desktop_config.json`,
`~/.cursor/mcp.json`, and `~/.codeium/windsurf/mcp_config.json`
with the user's default umask. On a multi-user POSIX box those
files come out 0o644 — every UID on the machine could `cat` the
file and read a working API key.

### Fixed

- New `chmodPrivateBestEffort()` helper that runs after every
  successful patch of a client config. POSIX-only (Windows NTFS
  ACLs already protect the per-user home directory).
- Logs a one-line note when tightening permissions on an
  already-existing file so the user sees what the wizard did.
- Best-effort; failure to chmod does not block setup.

## [4.1.2] — 2026-05-11

Implements ADR 0002 (`zpl-engine-sdk/docs/adr/0002-x-zpl-client-headers.md`)
in the MCP package. Coordination commit between SDK + MCP + CLI to give
the engine reliable, parser-friendly client attribution that doesn't
depend on regex-matching free-text User-Agent strings.

### Added

- **`X-ZPL-Client: mcp`** header on every engine request.
- **`X-ZPL-Client-Version: <package version>`** header on every engine
  request, sourced from `getMcpPackageVersion()` so it always tracks the
  published npm version automatically.

Both headers added to `engine-client.ts` `headers()` alongside the
existing `Authorization` / `Content-Type` / `User-Agent`. `User-Agent`
remains required for Cloudflare Bot Fight Mode compatibility — the new
headers are independent identity markers for engine telemetry.

### Compatibility

- Backwards compatible: engine ignores unknown headers today; once Alex
  ships engine-side persistence (E2 — `usage_log.client_type` /
  `.client_version` columns), these headers populate the dashboard
  automatically with no MCP redeploy needed.
- SDK TypeScript + Python ship the same convention from
  `zpl-engine-sdk` commit `d05dfd9`.
- CLI (`zpl-engine-cli@1.1.3`) ships matching headers in the same wave.

## [4.1.1] — 2026-05-10

Patch release surfacing two real bugs discovered during the v4.1.0 +
v1.1.1 paired test pass (5 test categories × 2 packages, ~180 unit
tests + live engine probes). Both bugs were silent — they did not
crash, they just produced wrong / misleading output. Patched here so
the next release of either client surfaces real engine errors instead
of false-positive Cloudflare misdirection.

### Fixed

- **`parseEngineError` mis-classified ALL 4xx with `cf-ray` as a
  Cloudflare HTML challenge.** Cloudflare adds the `cf-ray` request-ID
  header to EVERY response, including normal origin JSON errors. Our
  guard `(cfRay && res.status >= 400)` thus fired even when the engine
  returned a perfectly readable JSON error like
    `HTTP/1.1 403  Content-Type: application/json`
    `{"error":"API key not found or inactive"}`
  …and the user saw a confusing "Cloudflare returned an HTML page"
  message instead of "API key not found or inactive". Result: users
  with a stale or revoked key thought they had a network / WAF problem
  and didn't run `npx zpl-engine-mcp setup --force` to refresh.

  Fix: only treat as Cloudflare when the body actually IS HTML
  (`Content-Type: text/html`) OR when `cf-mitigated` explicitly says
  `challenge` / `block`. The `cf-ray` signal is no longer used for
  classification — it's still surfaced in the message when CF is
  detected, just doesn't gate the path anymore.

- **`engine-client.ts` was missing the `User-Agent` header on every
  fetch.** `setup.ts` had a Mozilla-compat UA for the device flow on
  zeropointlogic.io, but engine-client (which talks to
  engine.zeropointlogic.io for `/compute`, `/sweep`, `/health`,
  `/plans`) sent Node's default `node` UA. If Cloudflare ever turned
  on Bot Fight Mode for the engine subdomain, every real scoring call
  would 403 silently. The error message in `parseEngineError` even
  said "MCP sends a Mozilla-compat UA" — but the code didn't deliver.
  Now it does: USER_AGENT is shared via `src/user-agent.ts`. Defence
  in depth — fixed before the WAF rule lands, not after.

## [4.1.0] — 2026-05-10

Sister release to `zpl-engine-cli@1.1.0` — closes the same enterprise +
compliance gaps in the MCP package so both clients reach feature parity
on the things security teams + corporate IT care about.

### Added

- **HTTP_PROXY / HTTPS_PROXY / NO_PROXY support** — automatic. The MCP
  now installs an `undici.EnvHttpProxyAgent` at boot (BEFORE any module
  that uses fetch), so every engine call honours the standard proxy
  env vars without the user reconfiguring anything. Enterprise users
  behind a TLS-inspecting proxy can finally use the MCP. Disable with
  `ZPL_NO_PROXY=1`.
- **`SECURITY.md`** at the repo root — vulnerability disclosure policy
  required for corporate procurement gates. Specifies the
  `security@zeropointlogic.io` reporting address, response SLA, scope
  in/out, and an itemised list of defences shipped by default with
  pointers to the source.
- **`sanitizeSecrets()` is now exported** from `src/store.ts`. Previously
  the regex set was inlined in `addHistory()` only. Now it's reusable,
  has its own JSDoc, and is called by `parseEngineError` so any 401/500
  body the engine sends back is stripped of `zpl_u_*` / `zpl_s_*` /
  `Bearer …` / `sk-…` / `gsk_…` / `sk_(live|test)_…` shapes BEFORE the
  message bubbles up to the MCP client (and the user's chat scroll-back).

### Why a minor bump (4.0 → 4.1) and not a patch

Adding HTTP_PROXY support is technically backwards-compatible (no
existing flag changes meaning) but it changes the network behaviour
for any user who happened to have HTTP_PROXY set without realising
the MCP was ignoring it. That's a behavioural shift — semver MINOR is
the honest signal.

## [4.0.0] — 2026-05-10

**MAJOR RELEASE.** Two months of incremental fixes consolidated into one
clean v4.0 cut. The headline is the funnel-fix: 792 weekly npm downloads
at time of writing, 0 account signups — every user who ran
`npx zpl-engine-mcp setup` hit a key-format error and gave up. This
release ships the regex fix, plus 20 more bugs surfaced in the same
audit + an autonomous code review session, plus four new top-level
commands (`whoami`, `repair`, `diagnose`, `--help` / `--version`) so
future installs fail loud (with actionable next steps) instead of silent.

**21 bugs fixed.** **146 tests** (98 unit + 48 live MCP integration).
**Cross-OS verified** Windows + Linux Alpine. **Zero behavioural
regressions** for existing users — legacy `zpl_u_<48hex>` keys still
work, every existing tool keeps the same input shape and same output
contract. Why 4.0 instead of 3.7.2: too many surface-area changes
(new commands, removed dead env var, new config field, security
regex tightened) to fit comfortably in a patch number, and the funnel
metrics warrant a fresh "this is the version that actually works"
release tag.

### Fixed (CRITICAL — funnel-blockers)
- **API key format validator now accepts wizard-issued keys with type
  prefixes** (`zpl_u_mcp_`, `zpl_u_cli_`, `zpl_u_default_`). Previous
  regex `/^zpl_u_[a-f0-9]{48}$/` rejected every key the device-flow
  wizard generated, surfacing as "Server transport closed unexpectedly"
  in Claude Desktop logs with no actionable hint. Validation extracted
  to `src/api-key-format.ts` with 18-test regression suite so this
  cannot silently regress in v4 work.
- **Cloudflare HTML responses are now identified explicitly.** Previously
  a Bot Fight Mode challenge or rate-limit page surfaced as
  "Engine error 403: Forbidden" with no clue. The new `parseEngineError`
  helper detects HTML / cf-ray / cf-mitigated headers and returns a
  message that names the cause and the next step (User-Agent, retry,
  health check, issue link with cf-ray ID).

### Added
- **`npx zpl-engine-mcp setup` is now memory-aware.** Detects existing
  `~/.zpl/config.toml` and offers three choices instead of forcing a
  fresh device-flow login every time: keep, re-setup, or patch-only.
  Defaults to "keep" in non-interactive mode (CI / piped input). Pass
  `--force` to skip the prompt and rotate keys explicitly.
- **`npx zpl-engine-mcp whoami`** — print which account this install is
  logged into (email, config path, MCP version) without re-running
  setup. Useful for sanity-checking after an update.
- **`npx zpl-engine-mcp repair`** — wipe `~/.zpl/config.toml` and remove
  the `zpl-engine-mcp` entry from each MCP client config (Claude
  Desktop, Cursor, Windsurf). Other servers in those configs are left
  untouched. Confirms before destructive action; pass `--yes` to skip.
- **Smoke test at the end of `setup`.** After writing config and patching
  clients, the wizard now hits `/health` and runs a minimum-cost
  authenticated `/compute` (d=3, samples=100). Catches the rare but
  devastating case where the wizard succeeds on the website side but
  the engine doesn't recognise the key yet (replication lag, cache,
  network split). Prints a clear "the key was saved but engine didn't
  accept it on first try" message so the user knows whether to wait or
  re-setup.
- **`zpl_health` MCP tool** — full diagnostic report covering config
  source, key format, engine reachability, authenticated probe, and
  history sanity. Costs 1 token. Designed to be the first thing a user
  pastes when filing an issue.

### Fixed (audit-surfaced bugs)
- **`zpl_teach getting-started` referenced the wrong package name**
  (`@zeropointlogic/engine-mcp` instead of `zpl-engine-mcp`). Users
  copying the snippet got `npm ERR! 404` because that package never
  existed. Snippet now matches the actual published name.
- **Duplicate ZPL entries in client configs are now deduplicated.**
  Earlier wizard versions and copy-pasted snippets from old docs
  produced sibling entries like `"ZPL Engine MCP"`,
  `"@zeropointlogic/engine-mcp"`, `"zpl-engine"` which Claude Desktop
  loaded all at once → duplicate tools / quota counted twice. The
  patch step now removes any sibling whose key OR command/args
  matches our package, then writes the canonical
  `"zpl-engine-mcp"` entry.
- **`zpl_quota` token estimate** previously hardcoded `+= 5` per
  history entry, undercounting by 3-100x depending on tool dimension.
  Replaced with `estimateOpTokens(entry)` which prefers persisted
  `tokens_used` and falls back to a tool-shape heuristic only when the
  tool didn't save it. `zpl_alert` uses the same helper so the two
  tools agree.
- **`zpl_quota` plan detection** now reads from `~/.zpl/config.toml`
  when `ZPL_PLAN` env isn't set (was previously env-only, defaulting
  silently to "free"). Engine `/api/me` endpoint pending — once
  available, plan will auto-detect from the server.
- **`zpl_simulate` switched from `directionalBias` to `distributionBias`.**
  Most "what-if" inputs are positive-only values (portfolio allocations,
  team compositions, game balance) where `directionalBias` collapsed
  to 1.0 and the engine returned AIN ≈ 0 for both sides — visible as
  the "0/0" bug. `distributionBias` measures distance from uniform,
  which is what users want here. Also short-circuits on identical
  baseline/modified arrays so we don't burn tokens computing twice for
  a guaranteed delta=0.
- **`zpl_liquidity` table is now coherent with the verdict line.**
  Previously the table showed per-pool BALANCED/SLIGHT/IMBALANCED
  status (based on local deviation) while the verdict only paraphrased
  the aggregate AIN — the two could disagree on mixed pools. Verdict
  now cites the actual table totals (e.g. "3 of 5 pools BALANCED, 2
  IMBALANCED — aggregate AIN 47/100"). `tokens_used` now persists to
  history so quota estimates stay accurate.

### Removed
- **`ZPL_LANGUAGE` env constant deleted** — was read at module load and
  never consumed anywhere (P2 finding from 2026-04-18 audit). When
  i18n is wired through tool descriptions / `ainSignal` bands,
  reintroduce as `LANG` and pipe through `helpers.ts` so all tools
  share one source of truth.

### Security (PHASE 3.2 audit)
- **Secret sanitizer regex was leaking wizard-issued ZPL keys.** The pattern
  `/zpl_[us]_[a-f0-9]{20,}/gi` in `addHistory` failed on `zpl_u_mcp_*`,
  `zpl_u_cli_*`, `zpl_u_default_*` because the first non-hex letter after
  `zpl_u_` broke the match. Result: if any tool ever stuffed the API key
  into its `results` payload (e.g. via accidental debug logging), it would
  persist to `~/.zpl-engine/history.json` in clear text. Updated to
  `/zpl_[us]_(?:[a-z]+_)?[a-f0-9]{20,}/gi` — now redacts every shape the
  format validator accepts.
- **Anthropic / Stripe key sanitizer was truncating at the first hyphen.**
  `/sk-[A-Za-z0-9]+/gi` matched only `sk-ant` of `sk-ant-api03-AbCd...`
  and left the bulk of the key in clear text. Char class now includes
  `-` and `_`. Added explicit Stripe pattern (`sk_live_*`, `sk_test_*`).
- **Numeric env-var coercions now have safe bounds.** `ZPL_RATE_LIMIT`
  clamped to [1, 600] and `ZPL_MAX_RETRIES` to [0, 5]. Previously a typo
  like `ZPL_RATE_LIMIT=-1` produced `callLog.length >= -1` (always true)
  → rate limiter always blocked, OR `=999999` disabled the cap entirely.

### Tools (estimateOpTokens accuracy)
- **22 tools across 8 files** now persist `tokens_used` in their
  `addHistory()` results (zpl_decide, zpl_compare, zpl_rank, zpl_versus,
  zpl_model_bias, zpl_dataset_audit, zpl_prompt_test, zpl_benchmark,
  zpl_whale_check, zpl_defi_risk, zpl_tokenomics, zpl_portfolio,
  zpl_fear_greed, zpl_forex_pair, zpl_sector_bias, zpl_macro,
  zpl_correlation, zpl_market_scan, zpl_loot_table, zpl_matchmaking,
  zpl_economy_check, zpl_pvp_balance, zpl_gacha_audit, zpl_rng_test,
  zpl_vuln_map, zpl_risk_score, zpl_compliance, zpl_debate, zpl_news_bias,
  zpl_review_bias, zpl_check_response, zpl_batch). Fixes the
  cascading effect where `zpl_quota` and `zpl_alert` undercounted
  monthly token usage by 3-100x because each tool only fed back the
  fallback heuristic from `estimateOpTokens` rather than the engine's
  actual token cost. AI Eval tools (`tools/eval.ts`) deferred to
  v3.7.3 (different result shape, requires more careful refactor).

### CLI UX
- **`--help` / `-h` / `help`** — print usage + exit 0. POSIX expectation;
  pre-3.7.2 these flags fell through to the MCP main loop and hung.
- **`--version` / `-v` / `version`** — print just the version string
  + exit 0.

### Tests
- **34 → 98 tests** (+64). New regression suites:
  - `test/api-key-format.test.mjs` (18 tests)
  - `test/config-toml.test.mjs` (9 tests)
  - `test/estimate-tokens.test.mjs` (8 tests)
  - `test/dedupe-mcp-entries.test.mjs` (5 tests)
  - `test/cloudflare-error.test.mjs` (6 tests)
  - `test/setup-memory.test.mjs` (4 tests)
  - `test/source-regressions.test.mjs` (10 tests)
  - `test/edge-cases.test.mjs` (12 tests) — `--help` / `--version` /
    safety bounds (ZPL_RATE_LIMIT=-1, =999999, garbage) / hostile
    ZPL_ENGINE_URL / repair preserves siblings
  - `test/sanitize-secrets.test.mjs` (8 tests) — every key shape we redact
- **Integration suite added** (`test/integration-smoke.test.mjs`, 42 tests):
  spawns the real MCP via stdio, sends JSON-RPC, exercises ~3 tools per
  category (META, CORE, ADVANCED, CRYPTO, UNIVERSAL, FINANCE, GAMING,
  SECURITY, AI/ML — 38 distinct tools live-tested across 9 categories).
  Rate-limit-aware (Cloudflare 60/min cap respected via 1.5s delay
  between calls; CF-blocked calls treated as "Bug #8 detection working
  as designed" rather than failures).

### Cross-OS verified
- Windows (dev machine).
- Linux Alpine (Hetzner Docker `node:20-alpine`) — full re-test of
  `--version`, `--help`, `whoami` (with + without config), setup memory
  feature, `setup --force` device-flow opening, `repair --yes` with
  preservation of unrelated mcpServers entries.

### Internal
- API key validation extracted from `src/index.ts` to
  `src/api-key-format.ts` so it can be unit-tested in isolation.
- `parseEngineError` exported from `src/engine-client.ts` for testability.
- `readExistingConfig` exported from `src/setup.ts` for testability.
- `patchAllClients` extracted from `runSetup` so memory-aware setup,
  `--force` setup, and patch-only flow all share the same client-patching
  logic.
- Config TOML reader factored into reusable `parseTomlString(field)`
  so future fields (`plan`, future user-prefs) don't each invent their
  own parser.
- `estimateOpTokens(entry)` helper in `store.ts` — single source of
  truth for token-cost heuristics used by `zpl_quota` and `zpl_alert`.

## [3.7.0] — 2026-04-18

### Added
- **Setup wizard auto-configures Cursor and Windsurf.** `npx zpl-engine-mcp
  setup` now patches three MCP config files in a single pass instead of
  only `claude_desktop_config.json`:
  - Claude Desktop — existing behaviour preserved
  - Cursor — `~/.cursor/mcp.json` (same `{mcpServers: {...}}` shape)
  - Windsurf — `~/.codeium/windsurf/mcp_config.json`

  Context: users installing the MCP into Cursor or Windsurf previously saw
  a paste-the-snippet fallback, which the weekend funnel audit identified
  as a meaningful drop-off point. The three clients share the exact same
  config schema, so one generic `patchMcpConfigFile()` handles all three
  with identical merge semantics (preserves existing `mcpServers` entries,
  refuses to write on malformed JSON, writes fresh if the parent dir
  exists but the file doesn't).

  Each client's patch runs in its own try/catch — one failing client
  (missing, permission-denied, malformed) never blocks the others, and the
  user gets a single summary at the end listing which clients were
  configured plus the relevant restart hints.

### Fixed
- **Empty pre-existing config files no longer trigger a "malformed" error.**
  Cursor and some CI environments ship a zero-byte or whitespace-only
  `mcp.json` stub. We now treat empty files as equivalent to a missing
  file and write a fresh config, instead of bailing out.

### Changed
- The wizard's final output lists every client that was configured (one
  line each) plus the relevant restart hints, rather than focusing on
  Claude Desktop. If no supported client is detected, it prints the JSON
  snippet once as a paste-ready fallback.
- README: "Setup (free, 15 seconds)" section updated to document the
  three config files the wizard touches.

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

[3.4.3]: https://github.com/cicicalex/zpl-engine-mcp/releases/tag/v3.4.3
[3.4.2]: https://github.com/cicicalex/zpl-engine-mcp/releases/tag/v3.4.2
[3.4.1]: https://github.com/cicicalex/zpl-engine-mcp/releases/tag/v3.4.1
[3.4.0]: https://github.com/cicicalex/zpl-engine-mcp/releases/tag/v3.4.0
[3.3.0]: https://github.com/cicicalex/zpl-engine-mcp/releases/tag/v3.3.0
[3.2.0]: https://github.com/cicicalex/zpl-engine-mcp/releases/tag/v3.2.0
[3.1.0]: https://github.com/cicicalex/zpl-engine-mcp/releases/tag/v3.1.0
[3.0.0]: https://github.com/cicicalex/zpl-engine-mcp/releases/tag/v3.0.0
[2.3.0]: https://github.com/cicicalex/zpl-engine-mcp/releases/tag/v2.3.0
[2.2.0]: https://github.com/cicicalex/zpl-engine-mcp/releases/tag/v2.2.0
[2.1.0]: https://github.com/cicicalex/zpl-engine-mcp/releases/tag/v2.1.0
[2.0.0]: https://github.com/cicicalex/zpl-engine-mcp/releases/tag/v2.0.0
[1.0.0]: https://github.com/cicicalex/zpl-engine-mcp/releases/tag/v1.0.0
