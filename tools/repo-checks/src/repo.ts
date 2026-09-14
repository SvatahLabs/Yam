import { fileURLToPath } from "node:url";
import { dirname, relative, resolve, sep } from "node:path";

/** Absolute path of the repository root, from anywhere inside `tools/repo-checks`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Resolve a path relative to the repository root. */
export const fromRoot = (...parts: string[]): string => resolve(REPO_ROOT, ...parts);

/**
 * A file's path from the repository root, spelt as git spells it: with `/`.
 *
 * The checks compare paths with strings like `packages/cli/src/cli.ts`, and on
 * the Windows runner every path they built with `join` or `relative` had
 * backslashes: an exemption stopped matching its file, a page list came back
 * empty, and a manifest's `repository.directory` compared unequal to itself.
 */
export const repoPath = (absolute: string): string => relative(REPO_ROOT, absolute).split(sep).join("/");

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
