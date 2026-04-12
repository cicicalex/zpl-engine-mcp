/**
 * Local JSON storage for ZPL history, watchlist, and reports.
 * Stores in ~/.zpl-engine/ directory.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const STORE_DIR = process.env.ZPL_STORE_DIR ?? join(homedir(), ".zpl-engine");

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
  writeFileSync(join(STORE_DIR, filename), JSON.stringify(data, null, 2), "utf-8");
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
  const full: HistoryEntry = {
    ...entry,
    id: `zpl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
  };
  all.push(full);
  // Keep only last MAX_HISTORY entries
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
