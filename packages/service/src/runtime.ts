/**
 * Which Node runs `svatah serve` (Draft 2.9 LLD §13.6, T8.1, P7-F1).
 *
 * > The ADE never runs the CLI with its own binary: the `RunAsNode` fuse is off
 * > in a packaged build, so `process.execPath` there is an application, not an
 * > interpreter, and the spawn produces a second ADE that prints no handshake.
 * > The runtime is resolved, in order, from `SVATAH_NODE`, then a `node` on
 * > `PATH` of the supported major or newer, then a Node binary shipped beside
 * > the CLI under `resources/` when the packager includes one.
 *
 * ## Why this lives in the service package and not in the ADE
 *
 * Two programs have to agree about it. The ADE resolves the runtime to spawn
 * the service; `svatah surface doctor` reports which runtime the ADE *would*
 * choose, so a person can find out why a packaged ADE opens nothing without
 * launching it. A second copy of the order in the CLI is a second copy that
 * drifts, and the ADE already depends on this package.
 *
 * ## Why a version check and not just "a file called node"
 *
 * `PATH` on a developer's machine holds whatever a version manager last put
 * there, and REQ-NFR-7 supports Node 22 LTS and newer. A Node 18 on `PATH`
 * starts, fails somewhere inside the CLI's ESM graph, and prints a stack trace
 * instead of the handshake — which reads exactly like the defect this file
 * exists to remove. So each candidate is asked its version and skipped when it
 * is too old, and the answer says so.
 */
import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

/** REQ-NFR-7 and every `package.json` `engines` field: Node 22 LTS. */
export const SUPPORTED_NODE_MAJOR = 22;

/** Where a resolved runtime came from, in the order §13.6 lists. */
export type RuntimeSource = "SVATAH_NODE" | "PATH" | "resources";

export interface NodeRuntime {
  /** Absolute path to the interpreter. */
  readonly path: string;
  readonly source: RuntimeSource;
  /** What `node --version` said, e.g. `v22.23.2`. */
  readonly version: string;
}

/** One candidate that was looked at, and what became of it. */
export interface RuntimeAttempt {
  readonly source: RuntimeSource;
  /** The place that was looked in, written for a person reading an alert. */
  readonly where: string;
  readonly path?: string;
  readonly version?: string;
  /** Absent when the candidate was chosen. */
  readonly rejected?: string;
}

export interface RuntimeResolution {
  readonly runtime?: NodeRuntime;
  readonly attempts: readonly RuntimeAttempt[];
}

export interface ResolveOptions {
  /** The CLI entry point (`…/dist/bin.js`); a packaged Node sits beside it. */
  readonly cli?: string;
  /** Defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Defaults to `process.platform`. */
  readonly platform?: NodeJS.Platform;
  /** Injected by the tests. Answers `node --version` for a candidate. */
  readonly probe?: (path: string) => string | undefined;
}

/** `node --version` for a real file, or `undefined` when it is not an interpreter. */
function probeVersion(path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  try {
    if (!statSync(path).isFile()) return undefined;
  } catch {
    return undefined;
  }
  const answer = spawnSync(path, ["--version"], { encoding: "utf8", timeout: 10_000 });
  if (answer.status !== 0) return undefined;
  const printed = (answer.stdout ?? "").trim();
  return /^v\d+\.\d+\.\d+/.test(printed) ? printed : undefined;
}

/** The major of a `v22.23.2`, or `undefined` when it is not a version. */
export function majorOf(version: string): number | undefined {
  const match = /^v(\d+)\./.exec(version);
  return match === null ? undefined : Number(match[1]);
}

/**
 * Resolve the runtime, and say what was looked at either way.
 *
 * Never `process.execPath`: in a packaged ADE that is the ADE (§13.6), and the
 * whole point of this function is that the ADE is not an interpreter.
 */
export function resolveNodeRuntime(options: ResolveOptions = {}): RuntimeResolution {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const probe = options.probe ?? probeVersion;
  const exe = platform === "win32" ? "node.exe" : "node";
  const attempts: RuntimeAttempt[] = [];

  const consider = (source: RuntimeSource, where: string, path: string): NodeRuntime | undefined => {
    const version = probe(path);
    if (version === undefined) {
      attempts.push({ source, where, path, rejected: "not an executable Node" });
      return undefined;
    }
    const major = majorOf(version);
    if (major === undefined || major < SUPPORTED_NODE_MAJOR) {
      attempts.push({
        source,
        where,
        path,
        version,
        rejected: `Node ${version} is older than the supported ${SUPPORTED_NODE_MAJOR}`,
      });
      return undefined;
    }
    attempts.push({ source, where, path, version });
    return { path, source, version };
  };

  /* 1. SVATAH_NODE — the override, so a host with an unusual layout has one. */
  const configured = env["SVATAH_NODE"];
  if (configured !== undefined && configured !== "") {
    const chosen = consider("SVATAH_NODE", "the SVATAH_NODE environment variable", configured);
    if (chosen !== undefined) return { runtime: chosen, attempts };
  } else {
    attempts.push({
      source: "SVATAH_NODE",
      where: "the SVATAH_NODE environment variable",
      rejected: "not set",
    });
  }

  /* 2. `node` on PATH, of the supported major or newer. */
  const path = env["PATH"] ?? "";
  const directories = path.split(delimiter).filter((one) => one !== "");
  if (directories.length === 0) {
    attempts.push({ source: "PATH", where: "a `node` on PATH", rejected: "PATH is empty" });
  } else {
    let found = false;
    for (const directory of directories) {
      const candidate = join(directory, exe);
      if (!existsSync(candidate)) continue;
      found = true;
      const chosen = consider("PATH", `a \`node\` on PATH (${directory})`, candidate);
      if (chosen !== undefined) return { runtime: chosen, attempts };
    }
    if (!found) {
      attempts.push({ source: "PATH", where: "a `node` on PATH", rejected: `no ${exe} on PATH` });
    }
  }

  /* 3. A Node shipped beside the CLI under `resources/`, when one is packaged. */
  const beside = options.cli === undefined ? undefined : join(dirname(options.cli), "..", exe);
  const where = "a Node shipped beside the CLI under `resources/`";
  if (beside === undefined) {
    attempts.push({ source: "resources", where, rejected: "the CLI's location is not known" });
  } else if (!existsSync(beside)) {
    attempts.push({ source: "resources", where, path: beside, rejected: "no Node is packaged here" });
  } else {
    const chosen = consider("resources", where, beside);
    if (chosen !== undefined) return { runtime: chosen, attempts };
  }

  return { attempts };
}

/**
 * The alert the Project screen shows when no runtime was found (§13.6).
 *
 * It names the three places, with what was found in each, because the person
 * reading it is looking at a packaged application and has no terminal output to
 * go on. "Could not find Node" would send them nowhere.
 */
export function runtimeNotFoundMessage(attempts: readonly RuntimeAttempt[]): string {
  const lines = attempts.map(
    (attempt) =>
      `  • ${attempt.where}${attempt.path === undefined ? "" : ` — ${attempt.path}`}` +
      `${attempt.rejected === undefined ? "" : `: ${attempt.rejected}`}`,
  );
  return (
    `The Svatah ADE could not find a Node ${SUPPORTED_NODE_MAJOR} or newer to run ` +
    "`svatah serve` with, so no project was opened. It looked in three places:\n" +
    `${lines.join("\n")}\n` +
    "Install Node 22 LTS (or newer) so that `node` is on PATH, or set SVATAH_NODE to the " +
    "interpreter you want used, and open the project again."
  );
}

/** One line for `svatah surface doctor` and the ADE's smoke check (§13.6). */
export function describeRuntime(resolution: RuntimeResolution): string {
  const { runtime } = resolution;
  if (runtime === undefined) return "runtime: none found (SVATAH_NODE, PATH, resources/)";
  return `runtime: ${runtime.path} (${runtime.version}, from ${runtime.source})`;
}
