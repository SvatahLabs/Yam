/**
 * Launching the packaged Yam, and knowing when it is ready (T18, SF-21).
 *
 * The audit harness this replaces (`apps/desktop/test/surfaces-dogfood.mjs`)
 * built the renderer itself and served it in a browser. That is honest evidence
 * about the *screen model and the renderer*, and it stays — labelled as
 * browser-hosted. It is not evidence about the thing a person installs.
 *
 * This module opens the packaged application, the same bundle
 * `pnpm --filter @svatah/yam-desktop package` produces, and answers one
 * question about it: is it ready to be driven yet.
 *
 * ## Readiness is awaited, never slept on
 *
 * T18's Do says so in as many words, and the reason is not tidiness. A sleep
 * that is long enough on an idle machine is short on a loaded one, and a suite
 * whose first snapshot lands on a half-painted window reports a defect in the
 * product for a defect in the harness. Worse — measured while writing this —
 * the Playwright adapter chooses its snapshot mechanism *once*, when the
 * session opens, by feature-testing the frame; a session opened against a page
 * that has not painted picks the fallback and keeps it, and every snapshot
 * afterwards is empty and says `succeeded`.
 *
 * So each readiness helper polls a *condition*: the DevTools endpoint answers,
 * a page target exists, the renderer has painted a control the Surfaces screen
 * owns. Each returns `{ ready }` or `{ ready: false, reason }`, and a reason is
 * always the host's own words.
 *
 * ## Why `open(1)` and not `spawn`
 *
 * A GUI application forked from a process that is not in the user's Aqua
 * session never attaches to the WindowServer (LLD §7.5, measured): it runs, its
 * renderer runs, and no accessibility client ever sees a window. `open` goes
 * through LaunchServices, which places the application in the session a person
 * is looking at. `evals/self/yam.config.yaml` says the same thing about
 * `app.launch.bundle`.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
/**
 * The MCP server, which is its own installable now (PK-02).
 *
 * `yam mcp` was a subcommand until the packaging wave moved the 6 MB SDK out of
 * the base install. Anything here that wants to speak MCP spawns this.
 */
export const MCP_SERVER = join(ROOT, "packages", "mcp", "dist", "bin.js");
export const BUNDLE = join(ROOT, "apps", "desktop", "out", "Yam-darwin-arm64", "Yam.app");
export const EXECUTABLE = join(BUNDLE, "Contents", "MacOS", "Yam");
/** The name the accessibility API knows the application's process by. */
export const PROCESS_NAME = "Yam";
const BUNDLE_ID = "com.electron.yam";

/** Wait for a condition, polling it; never a bare sleep. */
export async function waitUntil(condition, { timeoutMs = 60_000, everyMs = 250, what }) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try {
      const answer = await condition();
      if (answer === true || answer?.ready === true) {
        return { ready: true, ...(typeof answer === "object" ? answer : {}), ms: timeoutMs };
      }
      last = typeof answer === "object" ? answer?.reason : undefined;
    } catch (error) {
      last = error instanceof Error ? error.message : String(error);
    }
    await new Promise((done) => setTimeout(done, everyMs));
  }
  return {
    ready: false,
    reason: `${what} was not ready within ${timeoutMs} ms${last === undefined ? "" : `: ${last}`}`,
  };
}

/**
 * The CLI staged inside the bundle, which is the one the application's own
 * service runs (T00, SF-03).
 *
 * `pnpm --filter @svatah/yam-desktop package` deploys the workspace CLI into
 * `Resources/yam`, so a bundle packaged after the last build carries this
 * build. A bundle packaged *before* it does not — and that is not a cosmetic
 * difference. The broker refuses to serve a contract it does not speak, so the
 * application's service, reaching for a broker mid-run, stops the one the suite
 * is driving through and starts a replacement. The outer session then answers
 * `SESSION_NOT_FOUND`, which is exactly the sentence wave 4 spent a
 * verification pass failing to root-cause.
 *
 * It is a fact about the *build*, not about the product, so the suite states it
 * as its own precondition rather than letting it arrive later disguised as a
 * defect in Yam.
 */
export const STAGED_CLI = join(BUNDLE, "Contents", "Resources", "yam", "dist", "bin.js");

export async function stagedContract() {
  const staged = join(
    BUNDLE,
    "Contents",
    "Resources",
    "yam",
    "node_modules",
    "@svatah",
    "yam-surface-control",
    "dist",
    "index.js",
  );
  if (!existsSync(staged)) {
    return { known: false, reason: `the packaged application carries no CLI at ${STAGED_CLI}` };
  }
  const [inside, here] = await Promise.all([
    import(pathToFileURL(staged).href),
    import(
      pathToFileURL(join(ROOT, "packages", "surface-control", "dist", "index.js")).href
    ),
  ]);
  const theirs = inside.catalogueFingerprint();
  const ours = here.catalogueFingerprint();
  return theirs === ours
    ? { known: true, agrees: true, contract: ours }
    : {
        known: true,
        agrees: false,
        contract: ours,
        reason:
          `the packaged application carries a copy of the command line that speaks contract ` +
          `${theirs}, and this build speaks ${ours}. Re-run ` +
          "`pnpm -r build && pnpm --filter @svatah/yam-desktop package` so the application and " +
          "the suite are the same Yam; until then the application's own service will replace " +
          "the session holder this suite is driving through.",
      };
}

/** Is there a packaged application to drive at all, and where? */
export function packagedApp() {
  if (process.platform !== "darwin") {
    return {
      present: false,
      reason:
        `this host is ${process.platform}; the packaged macOS bundle is built and driven on ` +
        "darwin, and no macOS runner is available here",
    };
  }
  if (!existsSync(EXECUTABLE)) {
    return {
      present: false,
      reason:
        `there is no packaged application at ${EXECUTABLE}; run ` +
        "`pnpm --filter @svatah/yam-desktop package` first",
    };
  }
  return { present: true, bundle: BUNDLE, executable: EXECUTABLE };
}

/** Every process of the packaged bundle that is running now. */
export function running() {
  return (spawnSync("pgrep", ["-f", EXECUTABLE], { encoding: "utf8" }).stdout ?? "")
    .split("\n")
    .filter((one) => one.trim() !== "");
}

/** Quit it the way a person would, then insist. */
export function quit() {
  if (running().length === 0) return;
  spawnSync("osascript", ["-e", `tell application id "${BUNDLE_ID}" to quit`], {
    encoding: "utf8",
  });
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline && running().length > 0) {
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 200)"]);
  }
  if (running().length > 0) spawnSync("pkill", ["-f", EXECUTABLE], { encoding: "utf8" });
}

/**
 * Open the packaged application with a DevTools endpoint, projectless.
 *
 * `YAM_APP_PROJECT` is deliberately not set: the application starts on
 * Surfaces with a private workspace of its own, which is the journey T18
 * drives, and SF-01's "no project" is the point. Nothing here writes into that
 * workspace, and `run.mjs` checks afterwards that nothing did.
 */
export async function launchPackagedYam({ port } = {}) {
  const app = packagedApp();
  if (!app.present) return { launched: false, reason: app.reason };

  quit();
  const debugPort = port ?? 9400 + Math.floor(Math.random() * 180);
  const args = ["-n", "-F"];
  for (const [name, value] of Object.entries({
    // An Electron application publishes almost nothing to AX until told to
    // (REQ-ADE-6); this is the flag `evals/self/yam.config.yaml` sets too.
    YAM_A11Y: "1",
    YAM_APP_DEBUG: "1",
  })) {
    args.push("--env", `${name}=${value}`);
  }
  args.push("-a", BUNDLE, "--args", `--remote-debugging-port=${debugPort}`);
  const opened = spawnSync("open", args, { encoding: "utf8" });
  if (opened.status !== 0) {
    return {
      launched: false,
      reason: `\`open\` refused to launch ${BUNDLE}: ${(opened.stderr ?? "").trim()}`,
    };
  }

  const cdpUrl = `http://127.0.0.1:${debugPort}`;
  const endpoint = await waitUntil(
    async () => {
      const response = await fetch(`${cdpUrl}/json/version`, {
        signal: AbortSignal.timeout(2000),
      }).catch(() => undefined);
      return response?.ok === true;
    },
    { timeoutMs: 60_000, what: "the application's DevTools endpoint" },
  );
  if (!endpoint.ready) {
    quit();
    return { launched: false, reason: endpoint.reason };
  }

  const page = await waitUntil(
    async () => {
      const response = await fetch(`${cdpUrl}/json/list`, { signal: AbortSignal.timeout(2000) });
      const targets = await response.json();
      const found = targets.find((one) => one.type === "page");
      return found === undefined
        ? { ready: false, reason: "the application has no page target yet" }
        : { ready: true, title: found.title };
    },
    { timeoutMs: 60_000, what: "the application's window" },
  );
  if (!page.ready) {
    quit();
    return { launched: false, reason: page.reason };
  }

  /*
   * A page target is not a ready application (T18).
   *
   * The main process opens a projectless service on ready and tells the
   * renderer when it is up; until then the window is on the loading state. A
   * suite that started driving at "there is a page" was reading whichever
   * screen happened to be there — and on a machine with recent projects the
   * screen it found was the project chooser, which is how that defect was
   * found. So readiness is *Surfaces is on screen*, polled.
   *
   * This is the launch helper and it may look through the DevTools endpoint;
   * the *driving* is what has to go through `yam surface` and the MCP tools,
   * and it does.
   */
  const ready = await waitUntil(
    async () => {
      const { chromium } = await import("@playwright/test");
      const browser = await chromium.connectOverCDP(cdpUrl);
      try {
        const page = browser.contexts()[0]?.pages()[0];
        if (page === undefined) return { ready: false, reason: "no page in the context" };
        /*
         * The rail is not the screen. An earlier condition stopped at
         * `#rail-surfaces` and the window under it still said "Loading…" —
         * the shell had rendered and the screen model had not resolved — so
         * the oracles measured a window with no toolbar title and no connect
         * form, and reported "one of them is not on screen". The condition is
         * the Surfaces *body*: its discovery panel when nothing is connected,
         * or its tree when something is.
         */
        const body =
          (await page.locator("#surfaces-discovery").count()) +
          (await page.locator("#surfaces-tree-pane").count());
        if (body > 0) return { ready: true };
        const starting = (await page.locator("#screen-starting").count()) > 0;
        const welcome = (await page.locator("#screen-welcome").count()) > 0;
        const rail = (await page.locator("#rail-surfaces").count()) > 0;
        return {
          ready: false,
          reason: starting
            ? "the application is still starting its service"
            : welcome
              ? "the application is on the welcome screen, not Surfaces"
              : rail
                ? "the Surfaces screen is still loading its model"
                : "Surfaces is not on screen yet",
        };
      } finally {
        await browser.close().catch(() => undefined);
      }
    },
    { timeoutMs: 90_000, everyMs: 500, what: "the application's Surfaces screen" },
  );
  if (!ready.ready) {
    quit();
    return { launched: false, reason: ready.reason };
  }

  return { launched: true, cdpUrl, port: debugPort, stop: quit };
}

/**
 * Whether an accessibility client can read a window on this host, and if not,
 * why — in the host's own words (P10-F1, SF-21).
 *
 * The distinction this draws is the whole of an honest coverage report. A
 * locked display makes macOS answer every application's window list with the
 * application itself, so *every* accessibility read on the machine fails, and a
 * suite that recorded that as a product failure would be publishing a defect
 * that is not there. The probe therefore asks about an application that is
 * always running and is not ours — the Finder — so the answer separates "this
 * host cannot be asked" from "Yam could not read Yam".
 */
export function accessibilityHost() {
  const doctor = spawnSync(process.execPath, [CLI, "surface", "doctor"], {
    encoding: "utf8",
    cwd: ROOT,
  });
  const lines = `${doctor.stdout ?? ""}${doctor.stderr ?? ""}`.split("\n");
  const line = (id) => lines.find((one) => one.includes(id))?.trim() ?? "";

  const grant = line("ax/accessibility");
  if (grant !== "" && !grant.includes("granted")) {
    return { readable: false, reason: `\`yam surface doctor\` says: ${grant}` };
  }

  const session = line("ax/session");
  const finder = spawnSync(
    "osascript",
    ["-e", 'tell application "System Events" to tell process "Finder" to count windows'],
    { encoding: "utf8" },
  );
  const finderWindows = Number((finder.stdout ?? "").trim());
  if (Number.isFinite(finderWindows) && finderWindows === 0 && session.includes("locked")) {
    return {
      readable: false,
      reason:
        `${session.replace(/^warn\s+/, "`yam surface doctor` says: ")} — and the Finder, which ` +
        "is always running, reports 0 windows to the same accessibility client, so this is the " +
        "host and not the application under test",
    };
  }
  if (session !== "" && session.startsWith("warn")) {
    return { readable: false, reason: `\`yam surface doctor\` says: ${session}` };
  }
  return { readable: true };
}

/** Whether an accessibility client can read *this application's* window yet. */
export async function awaitAxWindow({ timeoutMs = 45_000 } = {}) {
  const host = accessibilityHost();
  if (!host.readable) return { ready: false, reason: host.reason };
  return await waitUntil(
    () => {
      const counted = spawnSync(
        "osascript",
        [
          "-e",
          `tell application "System Events" to tell process "${PROCESS_NAME}" to count windows`,
        ],
        { encoding: "utf8" },
      );
      const windows = Number((counted.stdout ?? "").trim());
      return Number.isFinite(windows) && windows > 0
        ? { ready: true }
        : { ready: false, reason: `"${PROCESS_NAME}" owns no readable window yet` };
    },
    { timeoutMs, what: `an accessibility-readable window of "${PROCESS_NAME}"` },
  );
}
