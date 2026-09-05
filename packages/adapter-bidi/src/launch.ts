/**
 * Finding a WebDriver BiDi endpoint (LLD §7.3, REQ-ADP-4).
 *
 * "Stock Chrome, Edge, Firefox with no patched builds." A browser exposes BiDi in
 * one of two ways, and this file covers both without knowing anything about the
 * adapter above it:
 *
 * 1. **An endpoint someone else started.** `SVATAH_BIDI_URL` names a running
 *    BiDi WebSocket — geckodriver, chromedriver with `webSocketUrl: true`, Edge
 *    WebDriver, a remote grid, or a browser already launched by hand. This is
 *    the route for stock Chrome and Edge, whose remote agent speaks CDP rather
 *    than BiDi: their driver hosts the BiDi mapper, exactly as the W3C protocol
 *    intends, and Svatah connects to it.
 * 2. **A Gecko binary this adapter launches.** Firefox's remote agent *is* a
 *    BiDi server: `firefox --remote-debugging-port=<p>` prints
 *    `WebDriver BiDi listening on ws://127.0.0.1:<p>` and serves the protocol at
 *    `<url>/session` with nothing else in the loop. No driver, no mapper, no
 *    patched build.
 *
 * Route 2 is what CI takes, because `pnpm browsers` already downloads a Firefox
 * and the endpoint is Mozilla's own remote agent rather than anything Playwright
 * adds. Which browser and which build actually answered is recorded on the
 * session and printed by the conformance report, because "the BiDi suite passes"
 * means nothing without it.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionError } from "@svatah/surface";

/** Where a session is talking, and to what. */
export interface BidiEndpoint {
  /** The BiDi WebSocket URL, ready for `session.new`. */
  readonly url: string;
  /** The binary, or the URL, this came from. Diagnostics only, never a report. */
  readonly describedAs: string;
  /** True when this adapter started the browser; false when it attached. */
  readonly launched: boolean;
  /** Stop the browser this launched, if it launched one. */
  close(): Promise<void>;
}

export interface LaunchOptions {
  readonly headless?: boolean;
  /** An explicit browser binary; otherwise the search below. */
  readonly binary?: string;
  /** An already-running endpoint; otherwise a browser is launched. */
  readonly url?: string;
  /** How long to wait for the remote agent to announce itself. */
  readonly startupTimeoutMs?: number;
  readonly env?: NodeJS.ProcessEnv;
  readonly onLog?: (line: string) => void;
}

/** `SVATAH_BIDI_URL`: attach to a BiDi endpoint someone else is hosting. */
export const BIDI_URL_ENV = "SVATAH_BIDI_URL";
/** `SVATAH_BIDI_BROWSER`: the Gecko binary to launch. */
export const BIDI_BROWSER_ENV = "SVATAH_BIDI_BROWSER";

const DEFAULT_STARTUP_TIMEOUT_MS = 60_000;

/**
 * Where a Gecko binary might be, most specific first.
 *
 * Playwright's cache comes before the system install because `pnpm browsers`
 * puts one there and a contributor's own Firefox is not necessarily the one CI
 * has. Both are Firefox and both serve the same remote agent.
 */
function geckoCandidates(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = [];
  const home = env["HOME"] ?? "";

  const caches = [
    env["PLAYWRIGHT_BROWSERS_PATH"],
    home === "" ? undefined : join(home, "Library", "Caches", "ms-playwright"),
    home === "" ? undefined : join(home, ".cache", "ms-playwright"),
    env["LOCALAPPDATA"] === undefined
      ? undefined
      : join(env["LOCALAPPDATA"], "ms-playwright"),
  ].filter((c): c is string => c !== undefined && c !== "0" && existsSync(c));

  for (const cache of caches) {
    let entries: string[];
    try {
      entries = readdirSync(cache).filter((name) => name.startsWith("firefox"));
    } catch {
      continue;
    }
    // Highest build number first: `firefox-1538` beats `firefox-1489`.
    entries.sort((a, b) => Number(b.split("-")[1] ?? 0) - Number(a.split("-")[1] ?? 0));
    for (const entry of entries) {
      out.push(
        join(cache, entry, "firefox", "Nightly.app", "Contents", "MacOS", "firefox"),
        join(cache, entry, "firefox", "Firefox.app", "Contents", "MacOS", "firefox"),
        join(cache, entry, "firefox", "firefox"),
        join(cache, entry, "firefox", "firefox.exe"),
      );
    }
  }

  out.push(
    "/Applications/Firefox.app/Contents/MacOS/firefox",
    "/Applications/Firefox Developer Edition.app/Contents/MacOS/firefox",
    "/usr/bin/firefox",
    "/usr/local/bin/firefox",
    "/snap/bin/firefox",
    "C:\\Program Files\\Mozilla Firefox\\firefox.exe",
    "C:\\Program Files (x86)\\Mozilla Firefox\\firefox.exe",
  );
  return out;
}

/** The first Gecko binary that exists, or nothing. */
export function findGecko(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const named = env[BIDI_BROWSER_ENV];
  if (named !== undefined && named !== "" && existsSync(named)) return named;
  return geckoCandidates(env).find((path) => existsSync(path));
}

/**
 * Whether this machine can run the BiDi adapter at all.
 *
 * Used by the tests and by `svatah doctor`: a suite that silently passed because
 * no browser was there would be worse than one that says it was skipped.
 */
export function bidiAvailable(env: NodeJS.ProcessEnv = process.env): boolean {
  const url = env[BIDI_URL_ENV];
  return (url !== undefined && url !== "") || findGecko(env) !== undefined;
}

/**
 * Open a BiDi endpoint: attach to one, or launch a browser that serves one.
 */
export async function openEndpoint(options: LaunchOptions = {}): Promise<BidiEndpoint> {
  const env = options.env ?? process.env;

  const attach = options.url ?? env[BIDI_URL_ENV];
  if (attach !== undefined && attach !== "") {
    return {
      url: attach,
      describedAs: `an endpoint at ${attach}`,
      launched: false,
      close: async () => undefined,
    };
  }

  const binary = options.binary ?? findGecko(env);
  if (binary === undefined) {
    throw new SessionError(
      "No WebDriver BiDi endpoint and no Firefox to start one with.\n" +
        `  Point ${BIDI_URL_ENV} at a running BiDi endpoint — geckodriver, or chromedriver\n` +
        "  started with the `webSocketUrl` capability — or install a Gecko browser\n" +
        "  (`pnpm browsers` downloads one) or name it in " +
        `${BIDI_BROWSER_ENV}.`,
      { adapter: "bidi" },
    );
  }
  return await launchGecko(binary, options);
}

/**
 * Start Firefox with its remote agent and wait for the URL it prints.
 *
 * The port is `0`, so the browser picks a free one and says which — asking for a
 * specific port is how two runs on one machine collide, and the whole point of a
 * conformance suite is that it can run beside another one.
 */
async function launchGecko(binary: string, options: LaunchOptions): Promise<BidiEndpoint> {
  const profile = mkdtempSync(join(tmpdir(), "svatah-bidi-"));
  const args = [
    "--remote-debugging-port=0",
    "--profile",
    profile,
    // A second Firefox on the machine must not be handed this command line.
    "--no-remote",
    "--new-instance",
    "about:blank",
  ];
  if (options.headless !== false) args.unshift("--headless");

  const child: ChildProcess = spawn(binary, args, {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...(options.env ?? process.env), MOZ_HEADLESS: options.headless === false ? "0" : "1" },
  });

  /*
   * A browser must not outlive the process that started it.
   *
   * `close()` is the normal path, but a test runner that is killed, a `process.
   * exit()` in a script, or a crash between `open()` and `close()` would
   * otherwise leave a headless Firefox and its half-dozen content processes
   * running — and enough of those on one machine make the *next* run's
   * `session.new` time out, which reads as a flaky adapter rather than as
   * leaked processes.
   */
  const reap = (): void => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  };
  process.once("exit", reap);

  const url = await new Promise<string>((resolve, reject) => {
    let settled = false;
    let log = "";
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      reject(
        new SessionError(
          `${binary} did not announce a WebDriver BiDi endpoint within ` +
            `${options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS} ms. Last output:\n${log.slice(-800)}`,
          { adapter: "bidi" },
        ),
      );
    }, options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS);

    const read = (chunk: unknown): void => {
      const text = String(chunk);
      log += text;
      options.onLog?.(text.trimEnd());
      // "WebDriver BiDi listening on ws://127.0.0.1:51234"
      const found = /WebDriver BiDi listening on (ws:\/\/\S+)/.exec(log);
      if (found === null || settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(found[1]!.replace(/\/+$/, ""));
    };
    child.stdout?.on("data", read);
    child.stderr?.on("data", read);
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new SessionError(`Could not start ${binary}: ${error.message}`, { adapter: "bidi" }));
    });
    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(
        new SessionError(`${binary} exited with code ${String(code)} before serving BiDi.`, {
          adapter: "bidi",
        }),
      );
    });
  });

  return {
    // Gecko serves the protocol at `/session`; connecting to the root path is a
    // 400 with an unhelpful message, which is a confusing first experience.
    url: `${url}/session`,
    describedAs: binary,
    launched: true,
    close: async () => {
      process.removeListener("exit", reap);
      reap();
      await new Promise<void>((done) => {
        if (child.exitCode !== null || child.signalCode !== null) return done();
        child.once("exit", () => done());
        setTimeout(done, 5_000).unref?.();
      });
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
