# ZPL Engine MCP Server

Model Context Protocol (MCP) server for the **Zero Point Logic Engine** — a post-binary stability and neutrality analysis system.

Connects any MCP-compatible AI client (Claude Desktop, Claude Code, Cursor, Windsurf, etc.) to the ZPL Engine API for real-time bias detection, stability scoring, and neutrality analysis across multiple domains.

**56 tools** across 9 categories: Finance, Gaming, AI/ML, Security, Crypto, Certification, Advanced, Universal, and Meta.

## What is ZPL Engine?

The ZPL Engine computes the **AIN (AI Neutrality Index)** — a mathematical measure of how stable or biased a system is. It works across:

- **Finance** — market stability, portfolio bias, risk concentration, forex pairs, fear & greed
- **Gaming** — economy balance, loot fairness, matchmaking, gacha audit, PvP balance
- **AI/ML** — model fairness, prediction bias, dataset balance, prompt testing, benchmarks
- **Security** — vulnerability distribution, risk matrix, compliance scoring
- **Crypto** — whale concentration, DeFi risk, liquidity analysis, tokenomics
- **Certification** — bias certify any text, debate balance, news bias, review authenticity
- **Universal** — quick decisions, structured comparison, AIN ranking, response bias check

One engine, multiple domains. The engine doesn't know what your data represents — domain "lenses" translate your specific data into the universal mathematical framework.

## Quick Start

### 1. Get an API Key

1. Create account: [zeropointlogic.io/auth/register](https://zeropointlogic.io/auth/register)
2. Choose a plan: [zeropointlogic.io/pricing](https://zeropointlogic.io/pricing)
3. Generate API key: [zeropointlogic.io/dashboard/api-keys](https://zeropointlogic.io/dashboard/api-keys)

Your key starts with `zpl_u_` and is shown **once** — save it immediately.

### 2. Install

**Via npm (recommended):**

```bash
npm install zpl-engine-mcp
```

**Or clone and build:**

```bash
git clone https://github.com/cicicalex/engine-mcp.git
cd engine-mcp
npm install
npm run build
```

### 3. Configure MCP Client

#### Claude Desktop (claude_desktop_config.json)

```json
{
  "mcpServers": {
    "zpl-engine": {
      "command": "npx",
      "args": ["-y", "zpl-engine-mcp"],
      "env": {
        "ZPL_API_KEY": "zpl_u_YOUR_KEY_HERE"
      }
    }
  }
}
```

#### Claude Code CLI (.claude/settings.json)

```json
{
  "mcpServers": {
    "zpl-engine": {
      "command": "npx",
      "args": ["-y", "zpl-engine-mcp"],
      "env": {
        "ZPL_API_KEY": "zpl_u_YOUR_KEY_HERE"
      }
    }
  }
}
```

#### Local build (alternative)

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

## Tool Categories (56 tools)

| Category | Tools | Examples |
|----------|-------|---------|
| **Core** | 7 | `zpl_compute`, `zpl_analyze`, `zpl_sweep`, `zpl_ask`, `zpl_domains`, `zpl_health`, `zpl_plans` |
| **Finance** | 8 | `zpl_portfolio`, `zpl_risk_score`, `zpl_market_scan`, `zpl_forex_pair`, `zpl_fear_greed`, `zpl_sector_bias`, `zpl_macro`, `zpl_correlation` |
| **Gaming** | 6 | `zpl_economy_check`, `zpl_loot_table`, `zpl_matchmaking`, `zpl_gacha_audit`, `zpl_pvp_balance`, `zpl_leaderboard` |
| **AI/ML** | 4 | `zpl_model_bias`, `zpl_dataset_audit`, `zpl_prompt_test`, `zpl_benchmark` |
| **Security** | 3 | `zpl_vuln_map`, `zpl_risk_score`, `zpl_compliance` |
| **Crypto** | 4 | `zpl_whale_check`, `zpl_defi_risk`, `zpl_liquidity`, `zpl_tokenomics` |
| **Certification** | 6 | `zpl_certify`, `zpl_debate`, `zpl_news_bias`, `zpl_review_bias`, `zpl_auto_certify`, `zpl_check_response` |
| **Advanced** | 10 | `zpl_simulate`, `zpl_predict`, `zpl_versus`, `zpl_chart`, `zpl_alert`, `zpl_watchlist`, `zpl_certificate`, `zpl_report`, `zpl_teach`, `zpl_rng_test` |
| **Universal** | 4 | `zpl_decide`, `zpl_compare`, `zpl_rank`, `zpl_explain` |
| **Meta** | 4 | `zpl_batch`, `zpl_export`, `zpl_usage`, `zpl_account` |

### Quick Examples

```
> Analyze my crypto portfolio for bias: BTC 40%, ETH 25%, SOL 15%, AVAX 10%, DOT 10%

> Check if this loot table is fair: Common 60%, Uncommon 25%, Rare 10%, Legendary 5%

> Is my ML model biased? Class A: 1200 predictions, Class B: 300 predictions

> Certify this AI response for neutrality bias

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

| Dimension | Tokens/call | Sweep (19x) | Free plan (5K) |
|-----------|-------------|-------------|----------------|
| D3–D5 | 1 | 19 | 5,000 calls |
| D6–D9 | 2 | 38 | 2,500 calls |
| D10–D16 | 5 | 95 | 1,000 calls |
| D17–D25 | 15 | 285 | — |
| D26–D32 | 40 | 760 | — |
| D33–D48 | 150 | 2,850 | — |
| D49–D64 | 500 | 9,500 | — |
| D65+ | 2,000 | 38,000 | — |

## API Key Management

- Keys are generated at [zeropointlogic.io/dashboard/api-keys](https://zeropointlogic.io/dashboard/api-keys)
- Format: `zpl_u_` + 48 hex characters (user keys) or `zpl_s_` + 48 hex (service keys)
- Keys are SHA-256 hashed server-side — the plaintext is shown **once** at creation
- **To rotate a key:** create a new key, update your MCP config, restart Claude, then delete the old key
- If a key is compromised, delete it immediately from the dashboard — it's invalidated instantly

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

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ZPL_API_KEY` | **Yes** | — | Your API key (`zpl_u_...` or `zpl_s_...`) |
| `ZPL_ENGINE_URL` | No | `https://engine.zeropointlogic.io` | Custom engine URL |
| `ZPL_RATE_LIMIT` | No | `60` | Max requests per minute |
| `ZPL_BUDGET_WARN` | No | `500` | Token budget warning threshold |
| `ZPL_MAX_RETRIES` | No | `2` | Retry count for transient failures |
| `ZPL_STORE_PATH` | No | `~/.zpl-engine/` | Local history storage path |

## Security

- All inputs validated via Zod schemas with strict maxLength limits
- API keys never logged or stored in plaintext locally
- In-memory rate limiting (configurable)
- Exponential backoff retry for transient engine failures (5xx only, not 4xx)
- Fail-fast startup if `ZPL_API_KEY` is not set
- Local history sanitizes API key prefixes before writing

## IP Protection (v2.2.0+)

The ZPL Engine computation method is a trade secret of Zero Point Logic. This MCP has been hardened to never expose it:

- Tool outputs return **AIN score + status + tokens used only**. No bias, deviation, p-output, dimension, or timing values are exposed.
- `zpl_ask` rejects questions that probe for the formula, algorithm, method, source, internals, or any IP-related terms.
- The MCP never receives or processes the engine formula — it sends `(d, bias, samples)` to the server and receives `(ain, status)` back.
- All computation happens server-side on the proprietary engine. The client-side code contains no algorithmic secrets.

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
