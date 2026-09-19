/**
 * Whether this machine runs a project's own code (SF-15).
 *
 * A project's `steps/` holds JavaScript and TypeScript that `loadSteps` imports,
 * and importing a module runs it. Every entry point loaded the project that
 * way: `yam` alone in a freshly cloned directory, the desktop opening a folder,
 * `yam serve`, an MCP server started on a project — so opening a repository
 * somebody else wrote ran their code as you, before anything had been asked of
 * it. An editor asks before it runs a workspace's tasks; this asks the same
 * question, once per directory.
 *
 * What counts as the project's code: the files under its steps directory, a
 * Playwright config at its root (`yam run --host playwright` runs it), and a
 * program its config launches (`app.launch`).
 *
 * A project is trusted when any of these holds:
 *
 * - it has no code, so there is nothing to run;
 * - its directory is in the trust store (`yam trust`, the desktop's prompt, or
 *   `yam init`, which made it);
 * - `YAM_TRUST_PROJECT=1`, for a process the person started on purpose;
 * - `CI` is `true` or `1`: a pipeline runs the repository's own checks, and a
 *   person who can change the pipeline can change the steps. Not for the MCP
 *   server, whose environment is an agent host's, and agent hosts set `CI=1`
 *   to keep tools from prompting.
 *
 * The store is a list of real paths in the user's state directory, beside the
 * broker's descriptor. It is not a signature over the code: trusting a
 * directory trusts what is pulled into it later, as an editor's does.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stepCode } from "@svatah/yam-steps";

/** Where the trusted directories are kept. `YAM_TRUST_STORE` names another file. */
export function trustStorePath(): string {
  const stated = process.env["YAM_TRUST_STORE"];
  if (stated !== undefined && stated.trim() !== "") return stated;
  const p = platform();
  const dir =
    p === "darwin"
      ? join(homedir(), "Library", "Application Support", "yam")
      : p === "win32"
        ? join(process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), "yam")
        : join(process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state"), "yam");
  return join(dir, "trusted-projects.json");
}

function canonical(root: string): string {
  const absolute = resolve(root);
  try {
    return realpathSync(absolute);
  } catch {
    return absolute;
  }
}

/** Every trusted directory. */
export function trustedProjects(): string[] {
  try {
    const parsed = JSON.parse(readFileSync(trustStorePath(), "utf8")) as { projects?: unknown };
    return Array.isArray(parsed.projects) ? parsed.projects.filter((one): one is string => typeof one === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Change the store: read, change, and replace the file in one rename.
 *
 * Two writers — the desktop and a terminal — each read, changed and wrote, so
 * the second could put back a list that lacked the first's change, and a crash
 * mid-write left a file nobody could parse. The read is as late as it can be,
 * the write goes to a file of its own, and a rename replaces the store whole;
 * the mode is set on every write, not only when the file was first made.
 */
function changeTrusted(change: (projects: string[]) => string[]): void {
  const path = trustStorePath();
  mkdirSync(dirname(path), { recursive: true });
  const next = [...new Set(change(trustedProjects()))].sort();
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ projects: next }, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  renameSync(temporary, path);
  try {
    chmodSync(path, 0o600);
  } catch {
    // A file system without modes; the rename is what mattered.
  }
}

/** Trust a directory's code. Answers the path it was stored under. */
export function trustProject(root: string): string {
  const path = canonical(root);
  changeTrusted((projects) => [...projects, path]);
  return path;
}

/** Stop trusting a directory. Answers whether it had been. */
export function revokeProject(root: string): boolean {
  const path = canonical(root);
  if (!trustedProjects().includes(path)) return false;
  changeTrusted((projects) => projects.filter((one) => one !== path));
  return true;
}

export interface ProjectTrust {
  /** Whether the project's step code may run. */
  readonly runsCode: boolean;
  /** Why: `no-code`, `store`, `YAM_TRUST_PROJECT`, `CI`, or `untrusted`. */
  readonly because: "no-code" | "store" | "YAM_TRUST_PROJECT" | "CI" | "untrusted";
  /** The project's code: step files relative to the root, a Playwright config, a launched program. */
  readonly code: readonly string[];
}

export interface ProjectTrustOptions {
  /** `config.steps.dir`; `steps` when not given. */
  readonly stepsDir?: string;
  /** What the config launches: `app.launch`'s bundle and path. */
  readonly launches?: readonly string[];
  /** Whether `CI` counts. The MCP server passes `false`. */
  readonly honourCi?: boolean;
}

const PLAYWRIGHT_CONFIGS = ["playwright.config.ts", "playwright.config.js", "playwright.config.mjs", "playwright.config.cjs"];

/** Whether this project's code may run here, and why. */
export function projectTrust(root: string, options: ProjectTrustOptions = {}): ProjectTrust {
  const absolute = resolve(root);
  const code = [
    ...stepCode(absolute, options.stepsDir ?? "steps"),
    ...PLAYWRIGHT_CONFIGS.filter((name) => existsSync(join(absolute, name))),
    ...(options.launches ?? []).map((program) => `app.launch: ${program}`),
  ];
  if (code.length === 0) return { runsCode: true, because: "no-code", code };
  const env = process.env["YAM_TRUST_PROJECT"];
  if (env === "1" || env === "true") return { runsCode: true, because: "YAM_TRUST_PROJECT", code };
  const ci = process.env["CI"];
  if (options.honourCi !== false && env !== "0" && env !== "false" && (ci === "true" || ci === "1")) {
    return { runsCode: true, because: "CI", code };
  }
  if (existsSync(trustStorePath()) && trustedProjects().includes(canonical(root))) {
    return { runsCode: true, because: "store", code };
  }
  return { runsCode: false, because: "untrusted", code };
}
