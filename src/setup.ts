/**
 * `npx zpl-engine-mcp setup` — interactive device-flow auth.
 *
 * Why this exists:
 *   The MCP runs over stdio JSON-RPC inside Claude Desktop / Cursor / Windsurf.
 *   It cannot show UI, cannot open a browser, and cannot prompt for input — any
 *   stdout write corrupts the JSON-RPC stream. So the user was previously
 *   forced to: sign up on the website, find the dashboard, create an API key,
 *   copy-paste it into a JSON config file by hand. 10+ minutes, high drop-off.
 *
 *   `setup` is a separate CLI entry point invoked *outside* the MCP loop.
 *   It drives the RFC 8628-style device flow against
 *   zeropointlogic.io/api/auth/cli/*, stores the resulting user key in
 *   ~/.zpl/config.toml (which the MCP picks up automatically at next launch),
 *   and auto-patches every supported client's MCP config (Claude Desktop,
 *   Cursor, Windsurf) so the user doesn't have to touch JSON at all. Clients
 *   that aren't installed are skipped silently; the snippet is printed once
 *   as a fallback for non-standard setups (Claude Code, VS Code, Zed).
 *   Install-to-working in ~15 seconds.
 *
 * Safety:
 *   - Never logs the API key.
 *   - Chmod 600 on the config file (no-op on Windows, which is fine; NTFS ACLs
 *     default to per-user home anyway).
 *   - Preserves existing mcpServers entries across all patched configs.
 *   - On malformed config JSON, refuses to write and prints instructions
 *     instead of destroying the file.
 *   - Each client patch is isolated — one failing doesn't abort the others.
 *   - Bounded polling (10 min max) and always uses `interval_s` from the
 *     backend so a misbehaving server can't DoS itself.
 */

import { mkdir, writeFile, readFile, chmod, stat, rm, unlink } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { getMcpPackageVersion } from "./package-meta.js";
import { getConfigPath, parseApiKeyFromToml } from "./config.js";

const BACKEND_BASE = process.env.ZPL_BACKEND_URL ?? "https://zeropointlogic.io";
const POLL_TIMEOUT_MS = 10 * 60 * 1000; // 10 min hard cap — matches device_code expiry
const POLL_MAX_INTERVAL_MS = 10_000;    // cap interval_s so a stuck server doesn't stall us forever

// Cloudflare Bot Fight Mode is enabled on zeropointlogic.io and blocks any
// User-Agent that doesn't start with "Mozilla/". Node's default fetch UA
// ("node") gets a 403 challenge page, which silently breaks the wizard.
// Using the browser-compat "Mozilla/5.0 (compatible; ...)" pattern — same
// convention used by well-behaved crawlers (bingbot, slackbot, etc.) — lets
// us identify the tool while still clearing the challenge.
const USER_AGENT = `Mozilla/5.0 (compatible; zpl-engine-mcp/${getMcpPackageVersion()}; +https://github.com/cicicalex/zpl-engine-mcp)`;

// ---------------------------------------------------------------------------
// Backend shape — mirrors /api/auth/cli/start and /api/auth/cli/status
// ---------------------------------------------------------------------------

interface StartResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  interval_s: number;
  expires_at: string; // ISO timestamp
}

interface StatusPending {
  status: "pending";
}
interface StatusApproved {
  status: "approved";
  api_key: string;
  user_email: string;
}
interface StatusDenied {
  status: "denied" | "expired";
  reason?: string;
}
type StatusResponse = StatusPending | StatusApproved | StatusDenied;

interface ClaudeDesktopConfig {
  mcpServers?: Record<string, unknown>;
  [k: string]: unknown;
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function log(msg: string): void {
  // Setup prints to stdout since this is a standalone CLI, not the MCP stdio loop.
  process.stdout.write(msg + "\n");
}

function logErr(msg: string): void {
  process.stderr.write(msg + "\n");
}

/**
 * Read one line from stdin. Returns empty string when stdin is not a TTY
 * (CI, piped input, MCP stdio context) so non-interactive callers fall
 * through to safe defaults instead of hanging on a prompt that nobody
 * will ever answer.
 */
async function prompt(question: string): Promise<string> {
  if (!process.stdin.isTTY) return "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise<string>((resolve) => {
    rl.question(question, (ans) => {
      rl.close();
      resolve(ans.trim());
    });
  });
}

/**
 * Read existing ~/.zpl/config.toml and return key + email.
 * Returns null if file missing, unreadable, or no api_key inside.
 * Exported for unit tests (so we can verify behaviour against fixture configs).
 */
export async function readExistingConfig(): Promise<{ apiKey: string; userEmail: string; path: string } | null> {
  const path = getConfigPath();
  try {
    const raw = await readFile(path, "utf-8");
    const apiKey = parseApiKeyFromToml(raw);
    if (!apiKey) return null;
    // user_email is the only other thing we ever write — same parser shape.
    let userEmail = "";
    for (const rawLine of raw.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const m = /^user_email\s*=\s*(?:"([^"]*)"|'([^']*)')\s*(?:#.*)?$/.exec(line);
      if (m) { userEmail = (m[1] ?? m[2] ?? "").trim(); break; }
    }
    return { apiKey, userEmail: userEmail || "(unknown)", path };
  } catch {
    return null;
  }
}

/**
 * Best-effort open a URL in the user's default browser. Never throws —
 * the verification URL is always printed so the user can paste it manually.
 */
function openInBrowser(url: string): void {
  try {
    const plat = platform();
    if (plat === "win32") {
      // `start` is a cmd.exe builtin, not an exe. Use shell.
      // The empty "" first arg is a cmd quirk: it's the window title when
      // the next arg contains spaces.
      spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (plat === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    // Swallow. User will paste the URL manually.
  }
}

/**
 * Absolute path to the user-scoped Claude Desktop config for the current OS.
 */
function claudeDesktopConfigPath(): string {
  const home = homedir();
  const plat = platform();
  if (plat === "darwin") {
    return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (plat === "win32") {
    // %APPDATA% is usually C:\Users\<name>\AppData\Roaming. Prefer the env
    // var so we respect roaming-profile redirects.
    const appdata = process.env.APPDATA ?? join(home, "AppData", "Roaming");
    return join(appdata, "Claude", "claude_desktop_config.json");
  }
  // Linux / other
  return join(home, ".config", "Claude", "claude_desktop_config.json");
}

/**
 * Absolute path to the Cursor MCP config. Cursor uses the same
 * `{ mcpServers: {...} }` shape as Claude Desktop. Path is cross-platform
 * (`~/.cursor/mcp.json`) — Cursor normalises it on Windows via its own home
 * resolution, so homedir() is correct on all three OSes.
 */
function cursorConfigPath(): string {
  return join(homedir(), ".cursor", "mcp.json");
}

/**
 * Absolute path to the Windsurf (Codeium) MCP config. Same
 * `{ mcpServers: {...} }` shape as Claude/Cursor. Path is cross-platform
 * (`~/.codeium/windsurf/mcp_config.json`).
 */
function windsurfConfigPath(): string {
  return join(homedir(), ".codeium", "windsurf", "mcp_config.json");
}

// ---------------------------------------------------------------------------
// Device flow
// ---------------------------------------------------------------------------

async function startDeviceFlow(): Promise<StartResponse> {
  const res = await fetch(`${BACKEND_BASE}/api/auth/cli/start`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": USER_AGENT,
    },
    body: JSON.stringify({ client: "mcp" }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Backend returned ${res.status}. ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as Partial<StartResponse>;
  if (!data.device_code || !data.user_code || !data.verification_uri) {
    throw new Error("Backend /auth/cli/start returned an unexpected shape.");
  }
  return {
    device_code: data.device_code,
    user_code: data.user_code,
    verification_uri: data.verification_uri,
    interval_s: Math.max(1, Math.min(30, data.interval_s ?? 2)),
    expires_at: data.expires_at ?? new Date(Date.now() + POLL_TIMEOUT_MS).toISOString(),
  };
}

async function pollStatus(deviceCode: string): Promise<StatusResponse> {
  const url = `${BACKEND_BASE}/api/auth/cli/status?device_code=${encodeURIComponent(deviceCode)}`;
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    // Surface as a pending-like object so the caller keeps polling on transient 5xx;
    // a final "expired" will end the loop correctly.
    if (res.status >= 500) return { status: "pending" };
    const body = await res.text().catch(() => "");
    throw new Error(`Backend returned ${res.status}. ${body.slice(0, 200)}`);
  }
  return (await res.json()) as StatusResponse;
}

async function waitForApproval(start: StartResponse): Promise<StatusApproved> {
  const intervalMs = Math.min(POLL_MAX_INTERVAL_MS, start.interval_s * 1000);
  const deadline = Date.now() + POLL_TIMEOUT_MS;

  log("Waiting for approval in your browser...");

  while (Date.now() < deadline) {
    await sleep(intervalMs);
    let status: StatusResponse;
    try {
      status = await pollStatus(start.device_code);
    } catch (err) {
      // Transient failure — keep polling until deadline.
      logErr(`  (network issue, retrying: ${(err as Error).message})`);
      continue;
    }
    if (status.status === "approved") return status;
    if (status.status === "denied") {
      throw new Error("You denied the request in the browser. Run setup again to retry.");
    }
    if (status.status === "expired") {
      throw new Error("Code expired before approval. Run setup again to retry.");
    }
    // status === "pending" — loop
  }
  throw new Error("Timed out waiting for approval (10 min). Run setup again to retry.");
}

// ---------------------------------------------------------------------------
// Config file writers
// ---------------------------------------------------------------------------

async function writeConfigToml(apiKey: string, userEmail: string): Promise<string> {
  const home = homedir();
  const dir = join(home, ".zpl");
  const path = join(dir, "config.toml");
  await mkdir(dir, { recursive: true });
  const createdAt = new Date().toISOString();
  const content =
    `# ZPL config — written by \`npx zpl-engine-mcp setup\`\n` +
    `# This file is read by the MCP at startup. Keep it private (mode 600).\n` +
    `api_key = "${apiKey}"\n` +
    `user_email = "${userEmail}"\n` +
    `created_at = "${createdAt}"\n`;
  await writeFile(path, content, "utf-8");
  // chmod is a no-op on Windows (NTFS ACLs handle privacy at the home-dir level).
  // We still try so POSIX installs are properly locked down.
  try {
    await chmod(path, 0o600);
  } catch {
    // ignore
  }
  return path;
}

/**
 * Patch a standard MCP config file (Claude Desktop / Cursor / Windsurf all
 * share the same `{ mcpServers: {...} }` shape). Returns:
 *   - "updated" if we wrote a merged file,
 *   - "created" if the parent dir existed but the file didn't (we wrote fresh),
 *   - "manual" if the parent dir doesn't exist (client not installed)
 *      — caller decides whether to print a snippet.
 *   - "malformed" if JSON didn't parse — we refuse to write, caller explains.
 *
 * Design note: one function for all three clients is intentional. They all
 * accept the same shape (`{mcpServers: {"zpl-engine-mcp": {command, args, env}}}`),
 * and keeping the merge logic in one place means malformed/missing handling
 * can't drift between clients over time.
 */
type PatchResult = "updated" | "created" | "manual" | "malformed";

export async function patchMcpConfigFile(
  path: string,
  apiKey: string,
): Promise<{ result: PatchResult; path: string }> {
  // Does the file exist?
  let existing: string | undefined;
  try {
    existing = await readFile(path, "utf-8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      // Permission error etc — don't try to write, tell user.
      return { result: "manual", path };
    }
  }

  const entry = {
    command: "npx",
    args: ["-y", "zpl-engine-mcp"],
    env: {
      ZPL_API_KEY: apiKey,
    },
  };

  // If file exists: merge. If malformed, bail.
  if (existing !== undefined) {
    // Empty files are common when a client pre-creates the path but leaves
    // it blank. Treat the same as "file didn't exist" to keep the flow clean.
    if (existing.trim().length === 0) {
      const fresh: ClaudeDesktopConfig = { mcpServers: { "zpl-engine-mcp": entry } };
      await writeFile(path, JSON.stringify(fresh, null, 2), "utf-8");
      return { result: "created", path };
    }
    let parsed: ClaudeDesktopConfig;
    try {
      parsed = JSON.parse(existing) as ClaudeDesktopConfig;
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { result: "malformed", path };
      }
    } catch {
      return { result: "malformed", path };
    }
    parsed.mcpServers = parsed.mcpServers ?? {};
    // v3.7.2: dedupe legacy/variant keys so we end up with EXACTLY ONE
    // ZPL entry. Earlier versions of this wizard (and copy-pasted snippets
    // from old docs) created keys like "ZPL Engine MCP", "zpl-engine",
    // "@zeropointlogic/engine-mcp" which Claude Desktop happily loaded all
    // at once → duplicate tools / quota counted twice / confusion. We drop
    // any siblings whose command/args clearly point at this package, then
    // (re)write the canonical "zpl-engine-mcp" entry.
    const ZPL_PKG_PATTERNS = [/zpl-engine-mcp/i, /@zeropointlogic\/engine-mcp/i];
    for (const key of Object.keys(parsed.mcpServers)) {
      if (key === "zpl-engine-mcp") continue; // canonical entry — keep, will overwrite below
      const v = parsed.mcpServers[key] as { command?: string; args?: string[] } | undefined;
      const cmd = v?.command ?? "";
      const args = (v?.args ?? []).join(" ");
      const looksLikeZpl =
        ZPL_PKG_PATTERNS.some((p) => p.test(cmd) || p.test(args)) ||
        ZPL_PKG_PATTERNS.some((p) => p.test(key));
      if (looksLikeZpl) {
        delete parsed.mcpServers[key];
      }
    }
    parsed.mcpServers["zpl-engine-mcp"] = entry;
    await writeFile(path, JSON.stringify(parsed, null, 2), "utf-8");
    return { result: "updated", path };
  }

  // File doesn't exist. Check parent dir.
  const dir = path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
  try {
    await stat(dir);
  } catch {
    // Client likely not installed on this machine.
    return { result: "manual", path };
  }

  // Parent exists, file doesn't — write a fresh config.
  const fresh: ClaudeDesktopConfig = { mcpServers: { "zpl-engine-mcp": entry } };
  await writeFile(path, JSON.stringify(fresh, null, 2), "utf-8");
  return { result: "created", path };
}

// ---------------------------------------------------------------------------
// Client patching (extracted so re-setup, --force, and patch-only all share it)
// ---------------------------------------------------------------------------

const CLIENTS: Array<{ name: string; path: string; restartHint: string }> = [
  { name: "Claude Desktop", path: claudeDesktopConfigPath(), restartHint: "Restart Claude Desktop" },
  { name: "Cursor",         path: cursorConfigPath(),         restartHint: "Restart Cursor" },
  { name: "Windsurf",       path: windsurfConfigPath(),       restartHint: "Restart Windsurf" },
];

/**
 * Patch all three MCP-compatible clients with the given API key.
 * Each patch is isolated — one client failing (or not being installed) never
 * blocks the others. Logs status to stdout. Returns aggregate counts so the
 * caller can decide whether to print the manual fallback snippet.
 */
async function patchAllClients(apiKey: string): Promise<{
  configured: number;
  malformed: number;
  manual: number;
}> {
  const patches = await Promise.all(
    CLIENTS.map(async (c) => {
      try {
        const r = await patchMcpConfigFile(c.path, apiKey);
        return { client: c, ...r };
      } catch (err) {
        logErr(`(${c.name} config patch failed: ${(err as Error).message})`);
        return { client: c, result: "manual" as PatchResult, path: c.path };
      }
    }),
  );

  const configured = patches.filter((p) => p.result === "updated" || p.result === "created");
  const malformed  = patches.filter((p) => p.result === "malformed");
  const manual     = patches.filter((p) => p.result === "manual");

  if (configured.length > 0) {
    log("Configured clients:");
    for (const p of configured) {
      log(`  - ${p.client.name}: ${p.path}`);
    }
    log("");
    const restartLines = Array.from(new Set(configured.map((p) => p.client.restartHint)));
    for (const line of restartLines) log(`${line} to activate.`);
  } else {
    log("No MCP-compatible clients detected at default paths.");
  }

  if (malformed.length > 0) {
    log("");
    log("Couldn't auto-patch these configs (existing file isn't valid JSON):");
    for (const p of malformed) {
      log(`  - ${p.client.name}: ${p.path}`);
    }
    log("Open each file manually and paste the snippet below under mcpServers.");
  }

  if (malformed.length > 0 || (configured.length === 0 && manual.length > 0)) {
    if (manual.length > 0 && configured.length === 0) {
      log("");
      log("If you're using a client we don't auto-detect (Claude Code, VS Code, Zed, ...), add this to its MCP config:");
    }
    printSnippet(apiKey);
  }

  return { configured: configured.length, malformed: malformed.length, manual: manual.length };
}

// ---------------------------------------------------------------------------
// Public entries: setup / repair / whoami
// ---------------------------------------------------------------------------

export interface SetupOptions {
  /** Skip the "already logged in" prompt and force a fresh device-flow login. */
  force?: boolean;
}

/**
 * `npx zpl-engine-mcp setup` — interactive device-flow auth.
 *
 * v3.7.2: detects existing config and offers three choices instead of
 * silently re-authenticating. Stops the "every run forces a new browser
 * login" UX papercut. `--force` skips the prompt for power users who
 * want to rotate keys.
 */
export async function runSetup(opts: SetupOptions = {}): Promise<void> {
  log("");
  log(`Welcome to ZPL MCP setup. (v${getMcpPackageVersion()})`);
  log("");

  // v3.7.2: respect existing login. Saves a browser round-trip every time.
  if (!opts.force) {
    const existing = await readExistingConfig();
    if (existing) {
      log(`✅ Already logged in as ${existing.userEmail}`);
      log(`   Config: ${existing.path}`);
      log("");
      log("What would you like to do?");
      log("  [1] Keep existing config (default)");
      log("  [2] Re-setup — login again with a different account / new key");
      log("  [3] Patch only — keep this key, just (re-)install Claude/Cursor/Windsurf entries");
      log("");
      const choice = await prompt("Choose [1/2/3] (or press Enter for 1): ");

      if (choice === "" || choice === "1") {
        log("");
        log("Keeping existing config. Nothing to do.");
        log("Tip: run `npx zpl-engine-mcp setup --force` if you want to re-login anyway.");
        log("");
        return;
      }

      if (choice === "3") {
        log("");
        log("Patching MCP client configs with existing key (no re-login needed)...");
        log("");
        await patchAllClients(existing.apiKey);
        log("");
        return;
      }

      // choice === "2" → fall through to full device flow.
      log("");
      log("Re-setup requested. Starting fresh device-flow login...");
      log("");
    }
  } else {
    log("--force passed — skipping existing-config check, going straight to device-flow login.");
    log("");
  }

  // ---- Full device flow (first-time install OR explicit re-setup) ----

  let start: StartResponse;
  try {
    start = await startDeviceFlow();
  } catch (err) {
    logErr(`Could not contact ${BACKEND_BASE}: ${(err as Error).message}`);
    logErr("Check your internet connection and try again.");
    process.exit(1);
  }

  const sep = start.verification_uri.includes("?") ? "&" : "?";
  const approveUrl = `${start.verification_uri}${sep}code=${encodeURIComponent(start.user_code)}`;

  log(`Opening ${approveUrl} in your browser...`);
  log(`(If it doesn't open, paste that URL manually.)`);
  log("");
  openInBrowser(approveUrl);

  let approved: StatusApproved;
  try {
    approved = await waitForApproval(start);
  } catch (err) {
    logErr(`Setup failed: ${(err as Error).message}`);
    process.exit(1);
  }

  let configPath: string;
  try {
    configPath = await writeConfigToml(approved.api_key, approved.user_email);
  } catch (err) {
    logErr(`Could not write config file: ${(err as Error).message}`);
    logErr("Your API key was approved, but we couldn't save it locally.");
    logErr(`Set this env var in your MCP config instead:  ZPL_API_KEY=${approved.api_key}`);
    process.exit(1);
  }

  log("");
  log(`Connected as ${approved.user_email}`);
  log(`Key saved to ${configPath}`);
  log("");

  await patchAllClients(approved.api_key);

  // v3.7.2: smoke-test the freshly-issued key against the engine. Catches
  // the (rare but devastating) case where the wizard succeeds on the
  // website side but the engine doesn't recognise the key yet (replication
  // lag, Cloudflare cache, network split). Failing here gives an actionable
  // error before the user opens Claude Desktop and sees a generic "tool
  // failed" with no clue.
  log("");
  log("Smoke test: contacting engine with the new key...");
  try {
    await runSmokeTest(approved.api_key);
    log("✅ Engine OK — your install is ready. Restart your MCP client to use it.");
  } catch (err) {
    logErr(`⚠️  Smoke test failed: ${(err as Error).message}`);
    logErr("The key was saved, but the engine didn't accept it on first try.");
    logErr("This is usually transient — wait 30s and restart your MCP client.");
    logErr("If it persists, run `npx zpl-engine-mcp repair` and try again.");
  }
  log("");
}

/**
 * Verify the freshly-issued key works end-to-end:
 *   1. /health responds (engine reachable, not behind broken Cloudflare)
 *   2. /compute with the smallest possible call accepts our key (auth OK)
 *
 * Imports the engine client lazily so non-setup paths don't pay the cost.
 */
async function runSmokeTest(apiKey: string): Promise<void> {
  const { ZPLEngineClient } = await import("./engine-client.js");
  const { getValidatedEngineBaseUrl } = await import("./engine-url.js");
  const baseUrl = getValidatedEngineBaseUrl();
  const client = new ZPLEngineClient(apiKey, baseUrl);

  // Step 1: health (no auth required — catches Cloudflare / DNS / outage).
  const health = await client.health();
  if (health.status !== "ok") {
    throw new Error(`Engine /health returned status="${health.status}"`);
  }

  // Step 2: minimum-cost authenticated compute (catches auth & key issues).
  const result = await client.compute({ d: 3, bias: 0.5, samples: 100 });
  if (typeof result.ain !== "number") {
    throw new Error(`Engine /compute returned malformed response (no ain field)`);
  }
}

/**
 * `npx zpl-engine-mcp repair` — wipe local config + remove MCP entries
 * from Claude Desktop / Cursor / Windsurf configs.
 *
 * Use when:
 *   - Setup left the install in a confused state (duplicate entries, stale key)
 *   - User wants a clean uninstall before reinstalling
 *   - Switching to a different account and `--force` re-setup isn't enough
 *
 * Always asks for confirmation in interactive mode. Pass `--yes` to skip
 * (useful for automation / one-line bash docs).
 */
export interface RepairOptions {
  /** Skip the confirmation prompt. */
  yes?: boolean;
}

export async function runRepair(opts: RepairOptions = {}): Promise<void> {
  log("");
  log(`ZPL MCP repair. (v${getMcpPackageVersion()})`);
  log("");
  log("This will:");
  log(`  1. Delete ${getConfigPath()}`);
  log(`  2. Remove the "zpl-engine-mcp" entry from each MCP client config:`);
  for (const c of CLIENTS) log(`      - ${c.name}: ${c.path}`);
  log("");
  log("Other MCP servers in those configs are left untouched.");
  log("");

  if (!opts.yes) {
    const ok = await prompt("Continue? [y/N]: ");
    if (ok.toLowerCase() !== "y" && ok.toLowerCase() !== "yes") {
      log("Cancelled. Nothing was changed.");
      return;
    }
  }

  // 1. Wipe local config.
  let configRemoved = false;
  try {
    await unlink(getConfigPath());
    configRemoved = true;
    log(`Deleted ${getConfigPath()}`);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      log(`(${getConfigPath()} did not exist — skipping.)`);
    } else {
      logErr(`Could not delete config: ${(err as Error).message}`);
    }
  }

  // Best-effort wipe of ~/.zpl directory if empty.
  if (configRemoved) {
    try {
      await rm(join(homedir(), ".zpl"), { recursive: false }); // only if empty
    } catch { /* dir not empty or doesn't exist — fine */ }
  }

  // 2. Remove zpl-engine-mcp entry from each client.
  for (const c of CLIENTS) {
    try {
      const raw = await readFile(c.path, "utf-8");
      let parsed: ClaudeDesktopConfig;
      try {
        parsed = JSON.parse(raw) as ClaudeDesktopConfig;
      } catch {
        log(`(${c.name}: malformed JSON — skipped, please clean up manually at ${c.path})`);
        continue;
      }
      if (!parsed.mcpServers || typeof parsed.mcpServers !== "object") {
        log(`(${c.name}: no mcpServers section — nothing to remove)`);
        continue;
      }
      if (!("zpl-engine-mcp" in parsed.mcpServers)) {
        log(`(${c.name}: no zpl-engine-mcp entry — already clean)`);
        continue;
      }
      delete parsed.mcpServers["zpl-engine-mcp"];
      await writeFile(c.path, JSON.stringify(parsed, null, 2), "utf-8");
      log(`Removed zpl-engine-mcp entry from ${c.name} (${c.path})`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        log(`(${c.name}: config file does not exist — nothing to remove)`);
      } else {
        logErr(`(${c.name}: could not patch — ${(err as Error).message})`);
      }
    }
  }

  log("");
  log("Repair complete.");
  log("To reinstall: `npx zpl-engine-mcp setup`");
  log("");
}

/**
 * `npx zpl-engine-mcp whoami` — print which account this install is logged
 * into, without re-running the full setup. Useful for sanity-checking
 * after an update or when troubleshooting.
 */
export async function runWhoami(): Promise<void> {
  const existing = await readExistingConfig();
  if (!existing) {
    log("");
    log("Not logged in. Run `npx zpl-engine-mcp setup` to get started.");
    log("");
    return;
  }
  log("");
  log(`Logged in as: ${existing.userEmail}`);
  log(`Config:       ${existing.path}`);
  log(`MCP version:  ${getMcpPackageVersion()}`);
  log("");
}

function printSnippet(apiKey: string): void {
  log("");
  log("  {");
  log('    "mcpServers": {');
  log('      "zpl-engine-mcp": {');
  log('        "command": "npx",');
  log('        "args": ["-y", "zpl-engine-mcp"],');
  log('        "env": {');
  log(`          "ZPL_API_KEY": "${apiKey}"`);
  log("        }");
  log("      }");
  log("    }");
  log("  }");
}
