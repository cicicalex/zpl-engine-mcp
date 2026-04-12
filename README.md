# ZPL Engine MCP Server

Model Context Protocol (MCP) server for the **Zero Point Logic Engine** — a post-binary stability and neutrality analysis system.

Connects any MCP-compatible AI client (Claude Code, Cursor, Windsurf, etc.) to the ZPL Engine API for real-time bias detection, stability scoring, and neutrality analysis across multiple domains.

## What is ZPL Engine?

The ZPL Engine computes the **AIN (AI Neutrality Index)** — a mathematical measure of how stable or biased a system is. It works across:

- **Finance** — market stability, portfolio bias, risk concentration
- **Gaming** — economy balance, loot fairness, power distribution
- **AI/ML** — model fairness, prediction bias, dataset balance
- **Security** — vulnerability distribution, attack surface analysis
- **Crypto** — token decentralization, validator concentration, network health

One engine, multiple domains. The engine doesn't know what your data represents — domain "lenses" translate your specific data into the universal mathematical framework.

## Quick Start

### 1. Get an API Key

Visit [zeropointlogic.io/pricing](https://zeropointlogic.io/pricing) to create an account and get your API key.

### 2. Install

```bash
npm install @zeropointlogic/engine-mcp
```

Or clone and build:

```bash
git clone https://github.com/zeropointlogic/zpl-engine-mcp.git
cd zpl-engine-mcp
npm install
npm run build
```

### 3. Configure MCP Client

#### Claude Code (claude_desktop_config.json)

```json
{
  "mcpServers": {
    "zpl-engine": {
      "command": "node",
      "args": ["C:/Proiecte/zpl-engine-mcp/dist/index.js"],
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
      "command": "node",
      "args": ["C:/Proiecte/zpl-engine-mcp/dist/index.js"],
      "env": {
        "ZPL_API_KEY": "zpl_u_YOUR_KEY_HERE"
      }
    }
  }
}
```

#### Cursor / Windsurf

Add to your MCP configuration following the respective IDE's documentation, with the same command/args/env structure.

## Available Tools

### `zpl_compute`
Raw engine computation. Provide dimension (d), bias (0-1), and samples directly.

```
> Use zpl_compute with d=9, bias=0.3, samples=1000
```

### `zpl_analyze`
Smart domain-aware analysis. Provide a domain and your data — the lens handles the rest.

```
> Use zpl_analyze with domain="finance" and input={"assets": [-3.2, 8.5, -1.1, 0.4, 2.1], "context": "crypto"}
```

```
> Use zpl_analyze with domain="game" and input={"values": [5, 15, 30, 30, 15, 5], "game_type": "rpg"}
```

```
> Use zpl_analyze with domain="ai" and input={"outputs": [0.85, 0.12, 0.03], "model_type": "classifier"}
```

### `zpl_sweep`
Full 19-step bias sweep for a dimension. Shows how stability changes across all bias levels.

```
> Use zpl_sweep with d=16
```

### `zpl_domains`
Lists all available domain lenses with input schemas and examples.

### `zpl_health`
Engine health check (no API key needed).

### `zpl_plans`
Show all subscription plans with pricing and limits.

## Domain Lenses

| Domain | Input | What It Analyzes |
|--------|-------|------------------|
| `finance` | Price changes, volatility | Market stability, portfolio bias |
| `game` | Drop rates, power levels | Economy balance, fairness |
| `ai` | Model outputs, distributions | Prediction bias, dataset balance |
| `security` | CVSS scores, risk ratings | Vulnerability concentration |
| `crypto` | Holder %, validator weights | Decentralization, concentration |

### Adding Custom Domains

Create a new file in `src/domains/` implementing the `DomainLens` interface, then register it in `src/domains/index.ts`. The engine API is domain-agnostic — your lens just needs to convert domain data into `(d, bias, samples)` and interpret the result.

## Token Cost

Each computation costs `d² + d` tokens. Example costs:

| Dimension | Single Compute | Full Sweep (19x) |
|-----------|---------------|------------------|
| d=3 | 12 tokens | 228 tokens |
| d=9 | 90 tokens | 1,710 tokens |
| d=16 | 272 tokens | 5,168 tokens |
| d=25 | 650 tokens | 12,350 tokens |

## Architecture

```
Your AI Client (Claude, Cursor, etc.)
    │
    ▼ (MCP Protocol — stdio)
ZPL Engine MCP Server
    │
    ├── Domain Lenses (data → engine params)
    │   ├── finance.ts
    │   ├── game.ts
    │   ├── ai.ts
    │   ├── security.ts
    │   └── crypto.ts
    │
    ▼ (HTTPS — Bearer auth)
ZPL Engine API (engine.zeropointlogic.io)
    │
    ▼ (Post-binary computation — trade secret)
    AIN Result
```

The MCP server **never** sees or contains the engine formula. It sends `(d, bias, samples)` and receives `(ain, deviation, status)`. All computation happens server-side.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ZPL_API_KEY` | Yes | Your ZPL Engine API key (zpl_u_...) |
| `ZPL_ENGINE_URL` | No | Custom engine URL (default: https://engine.zeropointlogic.io) |

## License

MIT

## Links

- [ZPL Engine](https://zeropointlogic.io) — Main site
- [Finance Monitor](https://finance.zeropointlogic.io) — Live financial analysis
- [API Documentation](https://zeropointlogic.io/docs) — Full API reference
- [Pricing](https://zeropointlogic.io/pricing) — Plans & API keys
