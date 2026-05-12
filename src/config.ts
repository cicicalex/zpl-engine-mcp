/**
 * Load the ZPL user API key from (in priority order):
 *
 *   1. ~/.zpl/config.toml  — written by `npx zpl-engine-mcp setup` device flow.
 *      Preferred because a config file is not logged by Claude Desktop / Cursor,
 *      is per-user (not per-project), and survives MCP client updates.
 *
 *   2. process.env.ZPL_API_KEY / ZPL_ENGINE_KEY — legacy path, still supported
 *      so existing users don't break. `env-keys.ts::resolveZplApiKey()` is the
 *      single source of truth for env-name lookup.
 *
 * Returns the raw key string as-is (no format validation) plus a tag for
 * debugging / first-run messages. Format validation lives in `index.ts` where
 * the user-visible error text is assembled.
 *
 * Never logs the key. File read is best-effort — if the file exists but is
 * malformed, we warn to stderr and fall through to the env var so the user
 * still gets *some* way to run the MCP.
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveZplApiKey } from "./env-keys.js";

export type ApiKeySource = "config" | "env" | "none";

export interface LoadedApiKey {
  key: string;
  source: ApiKeySource;
}

/** Absolute path to the config.toml the `setup` subcommand writes. */
export function getConfigPath(): string {
  return join(homedir(), ".zpl", "config.toml");
}

/**
 * Parse the single `api_key = "..."` line out of our config.toml.
 * We deliberately don't pull in a TOML library — the file is written by our
 * own `setup` command with a known shape, and the only value the MCP needs
 * at startup is `api_key`. Keeps the dep tree at 1 package.
 *
 * Accepts both double and single quotes. Comments (#) and whitespace OK.
 * Returns undefined on any parse failure — caller decides what to do.
 */
export function parseApiKeyFromToml(raw: string): string | undefined {
  return parseTomlString(raw, "api_key");
}

/** Read a single named string field from our minimal config.toml. */
export function parseTomlString(raw: string, field: string): string | undefined {
  // Field names are caller-provided constants; escape just in case.
  const fieldEsc = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${fieldEsc}\\s*=\\s*(?:"([^"]*)"|'([^']*)')\\s*(?:#.*)?$`);
  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = re.exec(line);
    if (m) {
      const val = (m[1] ?? m[2] ?? "").trim();
      if (val) return val;
    }
  }
  return undefined;
}

/**
 * Best-effort plan lookup from local config.
 *
 * Engine doesn't expose a /api/me endpoint yet (TODO M3.x), so we can't
 * auto-detect plan from the server. v3.7.2 adds `plan` to config.toml so
 * users can set it once after setup and zpl_quota / zpl_alert estimates
 * stay accurate. Precedence: env var > config.toml > "free".
 */
export async function loadPlan(): Promise<string> {
  const envPlan = process.env.ZPL_PLAN?.toLowerCase();
  if (envPlan) return envPlan;
  try {
    const { readFile } = await import("node:fs/promises");
    const raw = await readFile(getConfigPath(), "utf-8");
    const plan = parseTomlString(raw, "plan");
    if (plan) return plan.toLowerCase();
  } catch { /* config missing — fine */ }
  return "free";
}

/**
 * Load the API key. v4.1.7 (audit 2026-05-13): aligned precedence with
 * the CLI — ENV wins over file. Previously MCP did file-wins-over-env,
 * which meant a dual-tool user with `ZPL_API_KEY=staging` in shell and a
 * prod key in `~/.zpl/config.toml` saw CLI hit staging but MCP hit prod.
 * Same machine, same file, same env var, different behaviour. v4.1.7
 * flips MCP so both tools resolve identically: env first (12-factor
 * standard), config.toml as fallback.
 *
 * Migration impact: zero for normal users (most have ONE source). Users
 * who relied on file-wins must `unset ZPL_API_KEY` before running MCP
 * via `npx`. The setup wizard still writes config.toml first; that path
 * is unchanged.
 */
export async function loadApiKey(): Promise<LoadedApiKey> {
  // 1. Env var first (12-factor; aligns with CLI).
  const envKey = resolveZplApiKey();
  if (envKey) return { key: envKey, source: "env" };

  // 2. Fallback to config.toml written by `npx zpl-engine-mcp setup`.
  const path = getConfigPath();
  try {
    const raw = await readFile(path, "utf-8");
    const key = parseApiKeyFromToml(raw);
    if (key) return { key, source: "config" };
    console.error(`[zpl-engine-mcp] ${path} exists but has no api_key.`);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code && code !== "ENOENT") {
      console.error(`[zpl-engine-mcp] could not read ${path}: ${code}`);
    }
  }

  return { key: "", source: "none" };
}
