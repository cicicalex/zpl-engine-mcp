/**
 * Single source of truth for MCP package version (reads package.json at runtime).
 */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

let cachedVersion: string | null = null;

/** Absolute path to package.json (same file used for semver in `getMcpPackageVersion`). */
export function getMcpPackageJsonPath(): string {
  const dir = dirname(fileURLToPath(import.meta.url));
  return resolve(join(dir, "..", "package.json"));
}

export function getMcpPackageVersion(): string {
  if (cachedVersion !== null) return cachedVersion;
  const pkgPath = getMcpPackageJsonPath();
  const raw = readFileSync(pkgPath, "utf-8");
  const v = (JSON.parse(raw) as { version?: string }).version;
  if (!v || typeof v !== "string") {
    throw new Error("package.json is missing a valid \"version\" field");
  }
  cachedVersion = v;
  return cachedVersion;
}
