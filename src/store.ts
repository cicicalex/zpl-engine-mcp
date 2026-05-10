/**
 * Local JSON storage for ZPL history, watchlist, and reports.
 * Stores in ~/.zpl-engine/ directory.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve, normalize } from "node:path";

const home = homedir();
// Accept both ZPL_STORE_PATH (README-documented) and ZPL_STORE_DIR (legacy).
const rawDir = process.env.ZPL_STORE_PATH ?? process.env.ZPL_STORE_DIR ?? join(home, ".zpl-engine");
const resolvedDir = normalize(resolve(rawDir));
// Reject path traversal / escape: the resolved path must be inside $HOME OR inside the OS tmp dir.
// Anything else (e.g. "../../etc", "C:\\Windows") falls back to the default under $HOME.
const tmp = process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? "";
const STORE_DIR = resolvedDir.startsWith(home) || (tmp && resolvedDir.startsWith(normalize(resolve(tmp))))
  ? resolvedDir
  : (() => {
      console.error(`[zpl-engine-mcp] store path "${rawDir}" resolves outside home; falling back to default.`);
      return join(home, ".zpl-engine");
    })();

function ensureDir(): void {
  if (!existsSync(STORE_DIR)) {
    mkdirSync(STORE_DIR, { recursive: true });
  }
}

function readJson<T>(filename: string, fallback: T): T {
  ensureDir();
  const path = join(STORE_DIR, filename);
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

function writeJson(filename: string, data: unknown): void {
  ensureDir();
  const filePath = join(STORE_DIR, filename);
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
  try { chmodSync(filePath, 0o600); } catch { /* Windows may not support chmod */ }
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

export interface HistoryEntry {
  id: string;
  timestamp: string;
  tool: string;
  question?: string;
  options?: string[];
  domain?: string;
  results: Record<string, unknown>;
  ain_scores: Record<string, number>;
}

const HISTORY_FILE = "history.json";
const MAX_HISTORY = 500;

export function getHistory(limit = 50): HistoryEntry[] {
  const all = readJson<HistoryEntry[]>(HISTORY_FILE, []);
  return all.slice(-limit);
}

export function addHistory(entry: Omit<HistoryEntry, "id" | "timestamp">): HistoryEntry {
  const all = readJson<HistoryEntry[]>(HISTORY_FILE, []);

  // Sanitize: strip any content that looks like API keys or tokens.
  // v3.7.2: regex updated to also match wizard-issued ZPL keys with type
  // prefixes (zpl_u_mcp_..., zpl_u_cli_..., zpl_u_default_...). The previous
  // pattern `zpl_[us]_[a-f0-9]{20,}` failed on prefixed keys because the
  // first non-hex letter after `zpl_u_` broke the match — meaning if a tool
  // ever accidentally stuffed the API key into results, it would be persisted
  // to history.json in the clear. Now redacts all real engine-issued shapes.
  // Regex notes:
  //  - ZPL keys: optional `<lowercase>_` prefix + 20+ hex chars
  //  - sk- prefix can contain hyphens internally (sk-ant-api03-...). Older
  //    pattern stopped at first `-` and leaked the bulk of the key. Now
  //    includes `-` and `_` in the char class.
  //  - Stripe: sk_live_*, sk_test_* (also _ in char class)
  const sanitized = JSON.parse(
    JSON.stringify(entry).replace(/zpl_[us]_(?:[a-z]+_)?[a-f0-9]{20,}/gi, "[REDACTED]")
      .replace(/Bearer [^\s"]+/gi, "Bearer [REDACTED]")
      .replace(/gsk_[A-Za-z0-9_-]+/gi, "[REDACTED]")
      .replace(/sk-[A-Za-z0-9_-]+/gi, "[REDACTED]")
      .replace(/sk_(?:live|test)_[A-Za-z0-9_-]+/gi, "[REDACTED]")
  );

  const full: HistoryEntry = {
    ...sanitized,
    id: `zpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };
  all.push(full);
  const trimmed = all.length > MAX_HISTORY ? all.slice(-MAX_HISTORY) : all;
  writeJson(HISTORY_FILE, trimmed);
  return full;
}

export function clearHistory(): number {
  const all = readJson<HistoryEntry[]>(HISTORY_FILE, []);
  const count = all.length;
  writeJson(HISTORY_FILE, []);
  return count;
}

/**
 * Best-effort token estimate for a single history entry.
 * Engine returns `tokens_used` per call — when tools persist that to
 * `results`, we use it directly. When they don't, we guess from tool
 * shape so quota/alert estimates aren't catastrophically wrong.
 *
 * Pre-v3.7.2 this was hardcoded `+= 5` everywhere, which under-counted
 * by 3-100x depending on dimension. Going forward, tools should save
 * `tokens_used` (or `totalTokens` for multi-call tools) in their history
 * results so this helper can return real numbers.
 */
export function estimateOpTokens(entry: HistoryEntry): number {
  const r = entry.results as Record<string, unknown>;
  if (typeof r.tokens_used === "number") return r.tokens_used;
  if (typeof r.totalTokens === "number") return r.totalTokens;
  if (typeof r.tokens === "number") return r.tokens;
  // Fallback by tool shape — better than blanket 5.
  // Multi-compute tools (compare two states, sweep N points, batch).
  const multi = new Set([
    "zpl_simulate", "zpl_versus", "zpl_compare", "zpl_balance_pair",
    "zpl_sweep", "zpl_market_scan", "zpl_batch", "zpl_leaderboard",
  ]);
  if (multi.has(entry.tool)) return 30;
  // Heavy single-call tools (high default d).
  const heavy = new Set([
    "zpl_portfolio", "zpl_loot_table", "zpl_pvp_balance",
    "zpl_tokenomics", "zpl_economy_check",
  ]);
  if (heavy.has(entry.tool)) return 15;
  // Default: single low-d compute.
  return 5;
}

// ---------------------------------------------------------------------------
// Watchlist
// ---------------------------------------------------------------------------

export interface WatchlistItem {
  id: string;
  name: string;
  domain: string;
  input: Record<string, unknown>;
  last_ain?: number;
  last_check?: string;
  added: string;
  notes?: string;
}

const WATCHLIST_FILE = "watchlist.json";

export function getWatchlist(): WatchlistItem[] {
  return readJson<WatchlistItem[]>(WATCHLIST_FILE, []);
}

export function addToWatchlist(item: Omit<WatchlistItem, "id" | "added">): WatchlistItem {
  const all = readJson<WatchlistItem[]>(WATCHLIST_FILE, []);
  const full: WatchlistItem = {
    ...item,
    id: `watch_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    added: new Date().toISOString(),
  };
  all.push(full);
  writeJson(WATCHLIST_FILE, all);
  return full;
}

export function removeFromWatchlist(id: string): boolean {
  const all = readJson<WatchlistItem[]>(WATCHLIST_FILE, []);
  const filtered = all.filter((item) => item.id !== id);
  if (filtered.length === all.length) return false;
  writeJson(WATCHLIST_FILE, filtered);
  return true;
}

export function updateWatchlistItem(id: string, ain: number): void {
  const all = readJson<WatchlistItem[]>(WATCHLIST_FILE, []);
  const item = all.find((i) => i.id === id);
  if (item) {
    item.last_ain = ain;
    item.last_check = new Date().toISOString();
    writeJson(WATCHLIST_FILE, all);
  }
}
