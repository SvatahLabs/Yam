/**
 * The local service's lifecycle, from the ADE's side (T3.6, LLD §13.6).
 *
 * "On project open, locate the bundled CLI (or a configured one), spawn `yam
 * serve --project <dir> --port 0`, read port and token from stdout, health-check
 * `GET /project`, and stop it on project close or app quit. If a service is
 * already running for the directory (lock file with port and token), connect
 * instead."
 *
 * ## Why the lock file is written here and not by `yam serve`
 *
 * `serve` deliberately writes nothing: "a token in a file is a token that
 * outlives the process that needed it." That is right for a command a person
 * runs in a terminal and stops with Ctrl-C. It is not enough for the ADE, which
 * has to survive its own reload and must not leave a second service running on a
 * project that already has one.
 *
 * So the lock file belongs to whoever can guarantee its lifetime: the ADE writes
 * it after the handshake, deletes it on stop, and deletes a stale one it finds —
 * a lock whose service does not answer is a lock about a process that is gone.
 * It goes in the user-data directory, not in the project, so a token never lands
 * in a repository (REQ-NFR-6) and a `git status` never mentions one.
 *
 * ## Everything here is pure but `spawn`
 *
 * `parseHandshake`, `lockPathFor` and `isStale` are exported and tested on their
 * own. What is left is process management, which is the part a test would have to
 * fake to say anything about.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface ServiceConnection {
  readonly url: string;
  readonly token: string;
  /** The project directory this service serves. */
  readonly project: string;
  /** True when the ADE connected to a service it did not start. */
  readonly adopted: boolean;
}

/** The one line `yam serve` prints when it is listening. */
export function parseHandshake(line: string): { url: string; token: string } | undefined {
  const match = /^yam serve listening url=(\S+) token=(\S+)$/m.exec(line);
  return match === null ? undefined : { url: match[1]!, token: match[2]! };
}

/**
 * Where a project's lock file lives.
 *
 * Keyed by a hash of the absolute project path, so two projects with the same
 * basename do not collide and the path itself — which can hold anything — never
 * becomes a file name.
 */
export function lockPathFor(userDataDir: string, project: string): string {
  const key = createHash("sha256").update(resolve(project)).digest("hex").slice(0, 16);
  return join(userDataDir, "services", `${key}.json`);
}

export interface Lock {
  readonly url: string;
  readonly token: string;
  readonly project: string;
  readonly pid: number;
}

export function readLock(path: string): Lock | undefined {
  if (!existsSync(path)) return undefined;
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as Lock;
    return typeof raw.url === "string" && typeof raw.token === "string" ? raw : undefined;
  } catch {
    return undefined;
  }
}

export function writeLock(path: string, lock: Lock): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(lock, null, 2)}\n`, "utf8");
}

/** Whether a lock describes a service that is not there any more. */
export async function isStale(lock: Lock, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const response = await fetcher(`${lock.url}/health`);
    if (!response.ok) return true;
    const body = (await response.json()) as { project?: string };
    // A live service on a *different* project is not this project's service.
    return body.project !== undefined && resolve(body.project) !== resolve(lock.project);
  } catch {
    return true;
  }
}

export interface StartOptions {
  readonly project: string;
  readonly userDataDir: string;
  /** The `yam` entry point. Bundled with the app in a packaged build. */
  readonly cli: string;
  /**
   * The interpreter that runs the CLI (Draft 2.9 LLD §13.6, T8.1).
   *
   * Resolved by `resolveNodeRuntime` and passed in, never `process.execPath`:
   * in a packaged build that is the ADE itself with the `RunAsNode` fuse off,
   * so the child is a second ADE that prints no handshake — the whole of P7-F1.
   * Passing it in rather than resolving it here keeps this file's only impure
   * function `spawn`, and lets the caller show the resolution's own alert.
   */
  readonly runtime: string;
  readonly onLog?: (line: string) => void;
  /** How long the handshake may take before the spawn is abandoned. */
  readonly timeoutMs?: number;
}

export interface RunningService {
  readonly connection: ServiceConnection;
  stop(): Promise<void>;
}

/**
 * Connect to the project's service, starting one if there is none.
 *
 * The order matters: adopt first, spawn second. A reload of the ADE, or a second
 * window on the same project, must not leave two services writing to one `runs/`
 * directory.
 */
export async function startOrAdopt(options: StartOptions): Promise<RunningService> {
  const lockPath = lockPathFor(options.userDataDir, options.project);
  const existing = readLock(lockPath);

  if (existing !== undefined) {
    if (!(await isStale(existing))) {
      options.onLog?.(`adopted the service already serving ${options.project} on ${existing.url}`);
      return {
        connection: { url: existing.url, token: existing.token, project: options.project, adopted: true },
        // Not ours to stop. Whoever started it will.
        stop: async () => undefined,
      };
    }
    options.onLog?.("removed a stale service lock");
    rmSync(lockPath, { force: true });
  }

  const child = spawn(options.runtime, [options.cli, "serve", options.project, "--port", "0"], {
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      // The service must not inherit a credential from the app's environment: it
      // compiles and runs, and neither needs a model (REQ-RUN-1).
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_AUTH_TOKEN: "",
      /*
       * And it must not inherit the ADE's own startup instructions (T8.1).
       *
       * While the spawn was `process.execPath` the child *was* an ADE, and it
       * read `YAM_ADE_SMOKE` from this environment, opened the project, and
       * spawned another: the verifier's "a second ADE instance appears" is one
       * generation of a fork bomb that reached 594 processes here. The runtime
       * fix removes the cause; clearing these removes the blast radius, which
       * is worth keeping for whatever the next mis-spawn turns out to be.
       */
      YAM_ADE_SMOKE: "",
      YAM_ADE_PROJECT: "",
    },
  });

  /*
   * A service whose parent died is a service nobody will stop — and it is
   * *most* likely to happen before the handshake, not after (P10-F1).
   *
   * The ADE launched by the desktop gate is quit as soon as its window is up,
   * which can be a second after `app.ready` and two seconds before
   * `yam serve` finishes starting. Registering this after `await` left the
   * half-started service with no parent and no lock file to find it by: one
   * orphan per launch loop, holding the fixtures project's `runs/` directory.
   */
  process.once("exit", () => {
    rmSync(lockPath, { force: true });
    child.kill("SIGTERM");
  });

  const handshake = await waitForHandshake(child, options);
  writeLock(lockPath, { ...handshake, project: resolve(options.project), pid: child.pid ?? -1 });

  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    rmSync(lockPath, { force: true });
    await stopChild(child);
  };

  return {
    connection: { ...handshake, project: options.project, adopted: false },
    stop,
  };
}

function waitForHandshake(
  child: ChildProcess,
  options: StartOptions,
): Promise<{ url: string; token: string }> {
  return new Promise((resolve_, reject) => {
    let buffer = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(
        new Error(
          `\`yam serve\` did not print its handshake within ${options.timeoutMs ?? 30_000} ms. ` +
            `What it did say:\n${buffer.slice(-2000)}`,
        ),
      );
    }, options.timeoutMs ?? 30_000);

    child.stdout?.on("data", (chunk) => {
      buffer += String(chunk);
      const found = parseHandshake(buffer);
      if (found === undefined) return;
      clearTimeout(timer);
      resolve_(found);
    });

    // stderr is the service's log, not its answer. It is forwarded so a failure
    // to start reads as the service's own message rather than as a timeout.
    child.stderr?.on("data", (chunk) => {
      buffer += String(chunk);
      options.onLog?.(String(chunk).trimEnd());
    });

    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`\`yam serve\` exited with ${code ?? "no code"}:\n${buffer.slice(-2000)}`));
    });
  });
}

/** SIGTERM, then SIGKILL if it will not go. */
async function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const hard = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("exit", () => {
      clearTimeout(hard);
      done();
    });
    child.kill("SIGTERM");
  });
}
