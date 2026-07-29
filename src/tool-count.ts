/**
 * Tool count — declared in ONE place, used everywhere.
 *
 * Three different figures used to circulate (docs, code, homepage). The number
 * below is the measured one: every tool registration in src/.
 * `test/tool-count.test.mjs` re-counts the registrations and fails if this file
 * drifts, so the constant cannot silently go stale.
 *
 * Anything that needs to state how many tools this MCP has — the server
 * description, zpl_about, the README, package.json — must take the number from
 * here rather than typing it again.
 */

/** Tools actually registered on the MCP server (includes the aliases). */
export const REGISTERED_TOOL_COUNT = 68;

/** Backwards-compat aliases that reuse another tool's handler. */
export const ALIAS_TOOL_COUNT = 4;

/** Distinct tools once the aliases are discounted. */
export const UNIQUE_TOOL_COUNT = REGISTERED_TOOL_COUNT - ALIAS_TOOL_COUNT;

/** Ready-made phrase, so the wording stays identical everywhere. */
export const TOOL_COUNT_PHRASE =
  `${REGISTERED_TOOL_COUNT} tools (${UNIQUE_TOOL_COUNT} unique + ${ALIAS_TOOL_COUNT} backwards-compat aliases)`;
