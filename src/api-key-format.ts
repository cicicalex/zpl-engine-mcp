/**
 * Client-side API key format validation (defence-in-depth).
 *
 * Engine is the authoritative validator. This module fails fast on obvious
 * garbage and prevents accidentally leaking unrelated secrets (e.g. Stripe
 * keys) in the Authorization header.
 *
 * v3.7.2: Accept wizard-issued keys with type prefixes (`zpl_u_mcp_`,
 * `zpl_u_cli_`, `zpl_u_default_`) — engine emits these from the device-flow
 * wizard. Previous regex (`/^zpl_u_[a-f0-9]{48}$/`) rejected them, causing
 * `Server transport closed unexpectedly` for users who ran
 * `npx zpl-engine-mcp setup`.
 *
 * Accepted formats:
 *   - `zpl_u_<48 hex>`              (legacy direct keys)
 *   - `zpl_u_<prefix>_<48 hex>`     (wizard keys: prefix is lowercase letters)
 *
 * Rejected formats:
 *   - `zpl_s_...`                   (service keys — server-side only, see isServiceKey)
 *   - anything else (Stripe sk_, Anthropic sk-ant-, etc.)
 *
 * Spec reference: docs/superpowers/specs/2026-04-17-zpl-cli-mcp-device-flow-design.md
 * Engine emits prefixes: 'zpl_u_', 'zpl_u_default_', 'zpl_u_cli_', 'zpl_u_mcp_'.
 * Regex allows any future `[a-z]+_` prefix without code change.
 */

/** Matches user keys: `zpl_u_` + optional `<lowercase prefix>_` + 48 hex. */
export const API_KEY_FORMAT = /^zpl_u_(?:[a-z]+_)?[a-f0-9]{48}$/;

/** Matches service keys: `zpl_s_` + 48 hex. Rejected by MCP (server-side only). */
export const SERVICE_KEY_FORMAT = /^zpl_s_[a-f0-9]{48}$/;

/** True if `key` is a valid user API key shape. */
export function isValidApiKeyFormat(key: string): boolean {
  return API_KEY_FORMAT.test(key);
}

/** True if `key` is a service key (rejected — must use user key in MCP). */
export function isServiceKey(key: string): boolean {
  return SERVICE_KEY_FORMAT.test(key);
}
