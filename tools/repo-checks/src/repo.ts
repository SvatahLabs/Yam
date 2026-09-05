import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/** Absolute path of the repository root, from anywhere inside `tools/repo-checks`. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Resolve a path relative to the repository root. */
export const fromRoot = (...parts: string[]): string => resolve(REPO_ROOT, ...parts);
