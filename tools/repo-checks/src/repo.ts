import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** Absolute path of the repository root, from anywhere inside `tools/repo-checks`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Resolve a path relative to the repository root. */
export const fromRoot = (...parts: string[]): string => resolve(REPO_ROOT, ...parts);

/**
 * The npm specifier of a workspace package directory (Draft 2.18): the CLI is
 * the umbrella package `@svatah/yam`; every other package is `@svatah/yam-<dir>`.
 */
export function specifierOf(dir: string): string {
  return dir === "cli" ? "@svatah/yam" : `@svatah/yam-${dir}`;
}

/** The workspace directory a specifier names, or undefined for anything not ours. */
export function dirOf(specifier: string): string | undefined {
  if (specifier === "@svatah/yam") return "cli";
  const match = /^@svatah\/yam-([^/]+)$/.exec(specifier);
  return match === null ? undefined : match[1];
}
