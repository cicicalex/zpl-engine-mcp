# v4.0.0 — MAJOR release (2026-05-10)

Two months of incremental work consolidated into one clean v4.0 cut.

## TL;DR

**Pre-4.0 was broken for new installs.** 792 weekly npm downloads → 0 account signups because every wizard install hit a key-format error and gave up. v4.0 ships the regex fix, plus 20 more bugs surfaced in the same audit + autonomous code review session, plus four new top-level commands so future installs fail loud (with actionable next steps) instead of silent.

**21 bugs fixed.** **146 tests** (98 unit + 48 live MCP integration). **Cross-OS verified** Windows + Linux Alpine. **Zero behavioural regressions** for existing users — legacy `zpl_u_<48hex>` keys still work, every existing tool keeps the same input shape and same output contract.

## New commands

```bash
npx zpl-engine-mcp setup [--force]   # memory-aware (detects existing config, asks before re-login)
npx zpl-engine-mcp whoami            # account info without re-login
npx zpl-engine-mcp repair [--yes]    # wipe local config + remove client entries (preserves siblings)
npx zpl-engine-mcp --help / --version  # POSIX-standard
```

Plus a new MCP tool: **`zpl_diagnose`** — full health report (config + key + engine + auth) for issue triage.

## Critical fixes

- **API key regex** now accepts wizard-issued keys with type prefixes (`zpl_u_mcp_`, `zpl_u_cli_`, `zpl_u_default_`). Pre-4.0 the wizard install always failed silently with "Server transport closed unexpectedly" in Claude Desktop logs.
- **Cloudflare HTML responses** identified explicitly with cf-ray ID + actionable retry guidance instead of generic 403.
- **Smoke test at end of setup** catches the rare case where the wizard succeeds on the website but the engine doesn't accept the key yet (replication lag).
- **Secret sanitizer** in `addHistory` no longer leaks wizard-prefixed ZPL keys (regex was failing on the first non-hex letter) or full Anthropic `sk-ant-*` tokens (regex was truncating at first hyphen).
- **Safety bounds on numeric env vars:** `ZPL_RATE_LIMIT` clamped to [1, 600], `ZPL_MAX_RETRIES` to [0, 5]. Pre-4.0 a typo like `ZPL_RATE_LIMIT=-1` could disable the limiter entirely.

## Tool fixes

- `zpl_simulate` 0/0 result on positive inputs (switched to `distributionBias` + identical-input short-circuit).
- `zpl_liquidity` table/verdict misalignment (verdict now cites per-pool counts).
- `zpl_quota` plan auto-detection from config.toml (env > config > "free").
- `zpl_quota` + `zpl_alert` token estimate accuracy — **22 tools** now persist real `tokens_used` instead of hardcoded heuristic. Resolves 3-100x undercount.
- `zpl_teach` snippet referenced never-published `@zeropointlogic/engine-mcp` package name; now uses correct `zpl-engine-mcp`.
- Duplicate Claude Desktop entries auto-deduplicated on `setup`.
- `LANGUAGE` dead-code env var removed.

## Tests (34 → 146)

- 98 unit tests across 11 suites
- 48 live MCP integration tests via stdio JSON-RPC
- Exercises 44 tools across 10 categories (META, CORE, ADVANCED, CRYPTO, UNIVERSAL, FINANCE, GAMING, SECURITY, AI/ML, CERTIFICATION). AI Eval (8 tools) skipped — needs `ANTHROPIC_API_KEY`.
- **Stability:** 5/5 consecutive runs identical, 0 flake.
- **Cross-OS:** Windows + Linux Alpine (musl libc) full feature parity.

## Upgrade

If you're already running v3.7.x:
```bash
npm i -g zpl-engine-mcp@latest
npx zpl-engine-mcp whoami        # confirm your account is still recognized
```

Existing config + Claude Desktop entries are preserved. The first call will run the new smoke test silently to verify your key is still accepted by the engine.

## Why 4.0 instead of 3.7.2

Too many surface-area changes (new commands, removed dead env var, new config field, security regex tightened) to fit comfortably in a patch number, and the funnel metrics warrant a fresh "this is the version that actually works" release tag.

---

Full CHANGELOG: [CHANGELOG.md](./CHANGELOG.md)
