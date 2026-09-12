/**
 * Which Node runs `yam serve` (Draft 2.9 LLD §13.6, T8.1, P7-F1).
 *
 * > The app never runs the CLI with its own binary: the `RunAsNode` fuse is off
 * > in a packaged build, so `process.execPath` there is an application, not an
 * > interpreter, and the spawn produces a second APP_DIR that prints no handshake.
 * > The runtime is resolved, in order, from `YAM_NODE`, then a `node` on
 * > `PATH` of the supported major or newer, then a Node binary shipped beside
 * > the CLI under `resources/` when the packager includes one.
 *
 * ## Two more places, added after the first packaged launch (P-W2-F1)
 *
 * §13.6's three were written for a program started from a shell. A windowed app
 * on macOS is not: launched from Finder it inherits `launchd`'s environment, and
 * `PATH` there is `/usr/bin:/bin:/usr/sbin:/sbin`. Homebrew's Node is at
 * `/opt/homebrew/bin/node` and every version manager's is under a home
 * directory, so the very first packaged launch reported no Node on a machine
 * with a working Node 22 — correctly, and uselessly.
 *
 * So between `PATH` and `resources/`: ask the login shell what *its* `PATH` is,
 * and failing that look where installers put things. Both are recoveries of an
 * environment the window was denied, not guesses about one.
 *
 * ## Why this lives in the service package and not in the app
 *
 * Two programs have to agree about it. The app resolves the runtime to spawn
 * the service; `yam surface doctor` reports which runtime the app *would*
 * choose, so a person can find out why a packaged app opens nothing without
 * launching it. A second copy of the order in the CLI is a second copy that
 * drifts, and the app already depends on this package.
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
export type RuntimeSource = "YAM_NODE" | "PATH" | "login-shell" | "well-known" | "resources";

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
  /**
   * The `PATH` a child of this app should be given (P-W2-F2).
   *
   * Finding a Node is not the whole of the problem a windowed app has. The
   * service it spawns shells out too — `npx playwright --version` is how adapter
   * readiness is probed — and on launchd's `PATH` there is no `npx` either. So
   * the Session screen reported Playwright "unavailable", blaming a missing
   * browser, on a machine where Playwright 1.62.1 and its browsers were both
   * installed.
   *
   * Present when the `PATH` the process has is not the one that found Node: the
   * login shell's, with the chosen runtime's own directory ahead of it. Absent
   * when `PATH` was already enough, so nothing is rewritten that was working.
   */
  readonly childPath?: string;
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
  /**
   * Injected by the tests. Answers the login shell's `PATH`.
   *
   * Separate from `probe` because it is the expensive one: it starts a shell,
   * and a test that wanted to check the order should not have to.
   */
  readonly loginPath?: () => string | undefined;
  /**
   * Injected by the tests. The install locations to look in.
   *
   * Without this, a test that says `PATH: ""` and expects nothing found passes
   * or fails according to whether the machine running it has Homebrew — which is
   * a test that measures the laptop, not the code.
   */
  readonly wellKnown?: (platform: NodeJS.Platform, env: Readonly<Record<string, string | undefined>>) => readonly string[];
}

/**
 * The login shell's `PATH`, which on macOS is not the one a windowed app has.
 *
 * An application launched from Finder inherits `launchd`'s environment —
 * `/usr/bin:/bin:/usr/sbin:/sbin` and little else. Every version manager and
 * every Homebrew installs Node somewhere else and puts it on `PATH` from a shell
 * profile, so a machine with a perfectly good Node 22 on it looks, from inside
 * the app, like a machine with no Node at all. That is not a hypothetical: it is
 * what the first packaged launch did on the author's own Mac, where `node` is
 * only at `/opt/homebrew/bin/node`.
 *
 * Asking the login shell is how the environment is recovered without guessing at
 * anyone's layout — nvm, fnm, volta, asdf and Homebrew all answer. It is behind
 * a short timeout and a `try`, because a shell profile is arbitrary code and a
 * slow one must not hold up the window.
 */
function loginShellPath(): string | undefined {
  const shell = process.env["SHELL"];
  if (shell === undefined || shell === "" || process.platform === "win32") return undefined;
  try {
    /*
     * `-ilc` and `printf`: interactive *and* login, because `~/.zshrc` is where
     * most people's version manager ends up while `~/.zprofile` is where
     * Homebrew's `shellenv` does. `printf` rather than `echo` so nothing a
     * profile printed is mistaken for the answer — the marker is what is read.
     */
    const answer = spawnSync(shell, ["-ilc", 'printf "\\n__yam_path__%s__yam_end__" "$PATH"'], {
      encoding: "utf8",
      timeout: 5_000,
    });
    const printed = `${answer.stdout ?? ""}`;
    const match = /__yam_path__([\s\S]*?)__yam_end__/.exec(printed);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Where Node is when it is not on `PATH`, per platform.
 *
 * The last resort before giving up, and deliberately a short list of *install
 * locations* rather than a search: a resolver that went looking through a
 * filesystem would be slow, surprising, and would eventually find something it
 * should not run.
 */
function wellKnownPaths(platform: NodeJS.Platform, env: Readonly<Record<string, string | undefined>>): string[] {
  const home = env["HOME"] ?? env["USERPROFILE"] ?? "";
  if (platform === "win32") {
    const files = env["ProgramFiles"] ?? "C:\\Program Files";
    return [join(files, "nodejs", "node.exe")];
  }
  return [
    /* Homebrew on Apple Silicon, then on Intel and the nodejs.org installer. */
    "/opt/homebrew/bin/node",
    "/usr/local/bin/node",
    /* Volta and fnm keep a stable path to the selected version; nvm does not. */
    ...(home === "" ? [] : [join(home, ".volta", "bin", "node"), join(home, ".local", "bin", "node")]),
  ];
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
 * Never `process.execPath`: in a packaged app that is the app (§13.6), and the
 * whole point of this function is that the app is not an interpreter.
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

  /* 1. YAM_NODE — the override, so a host with an unusual layout has one. */
  const configured = env["YAM_NODE"];
  if (configured !== undefined && configured !== "") {
    const chosen = consider("YAM_NODE", "the YAM_NODE environment variable", configured);
    if (chosen !== undefined) return { runtime: chosen, attempts };
  } else {
    attempts.push({
      source: "YAM_NODE",
      where: "the YAM_NODE environment variable",
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

  /*
   * 3. The login shell's `PATH` — the environment a windowed app does not get.
   *
   * Only when step 2 found nothing, because it starts a shell.
   */
  const askLogin = options.loginPath ?? loginShellPath;
  const login = askLogin();
  const loginWhere = "a `node` on the login shell's PATH";
  if (login === undefined || login === "") {
    attempts.push({
      source: "login-shell",
      where: loginWhere,
      rejected: platform === "win32" ? "not asked on Windows" : "the login shell answered nothing",
    });
  } else {
    let found = false;
    for (const directory of login.split(delimiter).filter((one) => one !== "")) {
      if (directories.includes(directory)) continue;
      const candidate = join(directory, exe);
      if (!existsSync(candidate)) continue;
      found = true;
      const chosen = consider("login-shell", `${loginWhere} (${directory})`, candidate);
      if (chosen !== undefined) return { runtime: chosen, attempts, childPath: login };
    }
    if (!found) {
      attempts.push({ source: "login-shell", where: loginWhere, rejected: `no ${exe} there either` });
    }
  }

  /* 4. The places Node is installed on this platform, when nothing said so. */
  let knownFound = false;
  for (const candidate of (options.wellKnown ?? wellKnownPaths)(platform, env)) {
    if (!existsSync(candidate)) continue;
    knownFound = true;
    const chosen = consider("well-known", `a Node where ${candidate.includes("homebrew") || candidate.startsWith("/usr/local") ? "an installer" : "a version manager"} puts one`, candidate);
    if (chosen !== undefined) {
      return { runtime: chosen, attempts, childPath: [dirname(candidate), ...directories].join(delimiter) };
    }
  }
  if (!knownFound) {
    attempts.push({
      source: "well-known",
      where: "the usual install locations for this platform",
      rejected: "no Node in any of them",
    });
  }

  /* 5. A Node shipped beside the CLI under `resources/`, when one is packaged. */
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
 * It names every place it looked, with what was found in each, because the person
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
    `The Yam could not find a Node ${SUPPORTED_NODE_MAJOR} or newer to run ` +
    "`yam serve` with, so no project was opened. It looked in these places:\n" +
    `${lines.join("\n")}\n` +
    "Install Node 22 LTS (or newer) so that `node` is on PATH, or set YAM_NODE to the " +
    "interpreter you want used, and open the project again."
  );
}

/** One line for `yam surface doctor` and the app's smoke check (§13.6). */
export function describeRuntime(resolution: RuntimeResolution): string {
  const { runtime } = resolution;
  if (runtime === undefined) return "runtime: none found (YAM_NODE, PATH, resources/)";
  return `runtime: ${runtime.path} (${runtime.version}, from ${runtime.source})`;
}

/**
 * The environment to spawn a child of the app with (P-W2-F2).
 *
 * `PATH` is the recovered one when there was one, with the chosen runtime's own
 * directory first so the child uses the same Node this did. Everything else is
 * the caller's. A resolution that found Node on `PATH` changes nothing.
 */
export function childEnvironment(
  resolution: RuntimeResolution,
  env: Readonly<Record<string, string | undefined>> = process.env,
): Record<string, string | undefined> {
  const { runtime, childPath } = resolution;
  if (runtime === undefined || childPath === undefined) return { ...env };
  const here = dirname(runtime.path);
  const parts = childPath.split(delimiter).filter((one) => one !== "" && one !== here);
  return { ...env, PATH: [here, ...parts].join(delimiter) };
}
