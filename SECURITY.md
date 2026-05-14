# Security policy — zpl-engine-mcp

We take the security of the MCP server seriously because it handles a
credential (your ZPL API key) that can spend money and burn quota on your
account. This document explains how to report vulnerabilities, what's in
scope, and what defences ship by default.

## Reporting a vulnerability

**Do NOT open a public GitHub issue for security reports.** Instead:

- **Email:** `security@zeropointlogic.io` (preferred) or
  `contact@zeropointlogic.io`.
- **Subject:** start with `[SECURITY]` so it gets triaged on the same day.
- Include: the MCP version (`npx zpl-engine-mcp --version`), your OS, the
  client you're using (Claude Desktop / Cursor / Windsurf / etc.), a
  minimal reproducer, and what you believe the impact is.

We commit to:

- **Acknowledge** within 2 business days.
- **Initial assessment** within 5 business days.
- **Patch + coordinated release** within 30 days for high-severity issues
  (key exfiltration, RCE, auth bypass, prompt-injection vector that
  reaches the engine), 90 days for medium (DoS, secret leak in logs),
  best effort for low.
- **Credit** you in `CHANGELOG.md` and the GitHub release notes once
  the patch ships, unless you ask to remain anonymous.

If you do not receive an acknowledgement within 5 business days, please
re-send to `security@zeropointlogic.io`.

## Scope

In scope:

- The published `zpl-engine-mcp` npm package and its source on
  [github.com/cicicalex/zpl-engine-mcp](https://github.com/cicicalex/zpl-engine-mcp).
- Any MCP behaviour that handles, stores, or transmits the API key.
- Tool input handling — anything an LLM client could send via
  `tools/call` that bypasses our quoting / validation.
- Local file handling (config, history) on supported platforms
  (macOS, Linux, Windows).
- Anything that could route an authenticated request to an unintended host.

Out of scope:

- Vulnerabilities in third-party dependencies — please report those
  upstream first; we'll fast-track the advisory once patched.
- The ZPL engine itself — report engine-side issues to
  `security@zeropointlogic.io` separately.
- Vulnerabilities in MCP clients themselves (Claude Desktop, Cursor,
  Windsurf, etc.) — report to those vendors.
- Self-hosted or modified copies — only the npm-published binary is
  covered.
- Social-engineering attacks against ZPL employees.

## Defences shipped by default (v4.0+)

The MCP ships these protections out of the box. Most of them have unit
or integration tests in `test/` (146 tests, 5 stability runs verified).

### Credentials

- **API key is never written to history.** All four secret-shape
  patterns (`zpl_u_*`, `zpl_s_*`, `Bearer …`, `sk-…`, `gsk_…`) are
  redacted by `addHistory()` (`src/store.ts`).
- **API key is never written to MCP error responses sent to clients.**
  Tool error responses are sanitised before being returned over the
  JSON-RPC channel (v4.1.0+).
- **Config file mode 0600 on POSIX.** `src/setup.ts` writes
  `~/.zpl/config.toml` with owner-only perms.
- **API key format validated client-side.** `src/api-key-format.ts`
  rejects anything that isn't a `zpl_u_<48 hex>` or
  `zpl_u_<prefix>_<48 hex>` shape, blocking accidental leaks of
  Stripe/Anthropic/Groq keys via mistyped env vars.

### Network

- **Engine URL host allowlist.** `src/engine-url.ts` rejects any
  `ZPL_ENGINE_URL` that isn't `https://` AND in the default allowlist
  (`engine.zeropointlogic.io`). Self-hosters extend via
  `ZPL_ENGINE_HOST_ALLOWLIST="staging.example.com,…"`.
- **HTTPS only by default.** Plain `http://` is rejected unless the
  user opts in to insecure local development with
  `ZPL_ENGINE_ALLOW_INSECURE_LOCAL=1` AND the host is `localhost`.
- **No userinfo in URLs.** `https://user:pass@host/...` is rejected
  (those credentials would end up in proxy logs).
- **Production-mode escape-hatch lockdown.** `ZPL_ENGINE_DISABLE_URL_GUARD=1`
  is REJECTED if `NODE_ENV=production` so a misconfigured production
  deployment cannot accidentally accept arbitrary engine URLs.
- **Cloudflare HTML detection.** Any 200-or-4xx response with HTML
  body is surfaced as a typed error with the cf-ray ID, preventing
  JSON-parse crashes that would expose the request.
- **HTTP_PROXY / HTTPS_PROXY / NO_PROXY support (v4.1.0+).** Standard
  proxy env vars are honoured automatically, so corporate users behind
  TLS-inspecting proxies don't need to reconfigure anything. Disable
  with `ZPL_NO_PROXY=1`.

### Filesystem

- **No file IO from tool inputs.** Tools accept structured numeric /
  text data from the LLM, never paths to read or write.
- **History file mode 0600 on POSIX**, capped at 500 entries.

### Process / runtime

- **Cross-OS verified.** Test suite runs on Windows + Linux Alpine
  (musl libc) full feature parity per release.
- **Env-var bounds.** Numeric env vars (`ZPL_RATE_LIMIT`,
  `ZPL_MAX_RETRIES`) are clamped to safe ranges so a typo can't
  disable the limiter or DOS the engine.
- **Smoke-test at end of setup.** Catches the rare case where the
  device-flow approval lands on the website before the engine
  follower DB receives the new key — warns the user instead of
  leaving them with a saved-but-not-yet-working key.

## Telemetry

The MCP sends **one** outbound request to npm's registry on each
launch, solely to detect new versions. No telemetry, no usage
analytics, no phone-home. Disable with `ZPL_SKIP_UPDATE_CHECK=1`.

The engine logs requests for billing purposes only. Logs never feed
training data.

## Hash-of-the-binary verification

If you want to verify the npm tarball hasn't been tampered with:

```bash
npm view zpl-engine-mcp@latest dist.shasum
```

Compare with the SHA-1 you compute locally:

```bash
shasum -a 1 $(npm pack zpl-engine-mcp@latest --dry-run --json | jq -r '.[0].filename')
```

(Future improvements: package signing via `npm provenance` once we
wire SLSA into the CI release flow. Tracked in CHANGELOG.)

## Encryption / TLS

The MCP relies on Node 18+'s native fetch / undici stack for TLS. CA
certificates come from the system trust store (override with
`NODE_EXTRA_CA_CERTS=/path/to/ca.pem` for corporate MITM proxies).
Minimum TLS 1.2 enforced by Node defaults; we do not ship a
`NODE_TLS_REJECT_UNAUTHORIZED=0` escape hatch.

## Acknowledgements

Thank you to the security researchers who have responsibly disclosed
issues. Credits land here as patches ship.
