/**
 * Yam controls the packaged Yam (T18, SF-18, SF-21).
 *
 *   node evals/self/yam-on-yam/run.mjs
 *   YAM_ON_YAM_EVIDENCE_DIR=docs/spec/surface-first/evidence/wave-4 node evals/self/yam-on-yam/run.mjs
 *   YAM_ON_YAM_PASSES=cli-browser,negative-cli node evals/self/yam-on-yam/run.mjs
 *
 * It needs a built workspace and a packaged application:
 *
 *   pnpm -r build && pnpm --filter @svatah/yam-desktop package
 *
 * ## What this is, and what it replaces
 *
 * `apps/desktop/test/surfaces-dogfood.mjs` builds the renderer and drives it in
 * a browser. It is real evidence about the screen model and the renderer, it
 * found nine defects, and it stays — **labelled browser-hosted**, because the
 * thing it drives is not the thing anybody installs. What it could not report
 * was that, for the whole of wave 3, the shipped renderer could not be built at
 * all: it aliased away the Node `crypto` that `@svatah/yam-schema`'s bundled
 * barrel imports, and `shell.spec.ts` skips when there is no packaged build.
 *
 * This suite launches the packaged application and drives it through Yam's own
 * public interfaces — `yam surface` as a person types it, and the MCP tools as
 * an agent calls them — with no selector, no injected script and no reach into
 * the renderer. A control is found in a snapshot **Yam took** and acted on by
 * the reference that snapshot gave it.
 *
 * ## Blocked is not skipped, and is not failed
 *
 * A pass this host cannot reach is recorded as `blocked` with the host's own
 * words for why, and it is counted in the denominator. `macOS AX` is the case
 * that matters: an accessibility client on a locked display is shown no
 * windows *by any application*, which the run proves by asking about the
 * Finder before blaming Yam. That is a host that cannot be asked, not a product
 * that failed, and not a row to leave out.
 */
import { mkdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { startSampleApp } from "sample-web";
import {
  ROOT,
  launchPackagedYam,
  packagedApp,
  awaitAxWindow,
  stagedContract,
  PROCESS_NAME,
} from "./launch.mjs";
import { cliDriver, mcpDriver } from "./drivers.mjs";
import { primaryJourney, JOURNEY_CHECKS } from "./journey.mjs";
import { negativeCases, negativeChecks } from "./negatives.mjs";
import { terminalCases, TERMINAL_CHECKS } from "./terminal.mjs";
import {
  windowOracles,
  fileHashes,
  changedFiles,
  WINDOW_ORACLE_CHECKS,
} from "./oracles.mjs";

const OUT =
  process.env["YAM_ON_YAM_EVIDENCE_DIR"] === undefined
    ? mkdtempSync(join(tmpdir(), "yam-on-yam-"))
    : resolve(ROOT, process.env["YAM_ON_YAM_EVIDENCE_DIR"]);
mkdirSync(OUT, { recursive: true });
const wanted =
  process.env["YAM_ON_YAM_PASSES"] === undefined
    ? undefined
    : new Set(process.env["YAM_ON_YAM_PASSES"].split(",").map((one) => one.trim()));

const results = [];
const transcript = [];
const record = (one) => {
  results.push(one);
  const mark = one.blocked !== undefined ? "blocked" : one.ok ? "ok  " : "FAIL";
  const why = one.blocked ?? one.detail;
  console.log(`${mark} [${one.pass}] ${one.name}${why === undefined ? "" : ` — ${why}`}`);
};
/** A whole pass this host cannot reach: one row, with the reason, in the count. */
const blockPass = (pass, name, reason) => record({ pass, name, blocked: reason });

/** Timings the coverage report turns into budgets (T19). */
const timings = [];
const timed = async (what, run) => {
  const started = Date.now();
  const answer = await run();
  timings.push({ what, ms: Date.now() - started });
  return answer;
};

console.log("Yam controls the packaged Yam (T18)\n");

/*
 * A broker from *this* build, and no other.
 *
 * The broker is one process per machine and it outlives the commands that use
 * it — the packaged application starts one of its own, from the copy of the CLI
 * staged inside the bundle. `connectToBroker` now refuses a broker whose
 * contract fingerprint is not this build's and replaces it, but a run that
 * begins by clearing the field is a run whose first measurement is not a
 * broker handover.
 *
 * Machine-wide, and deliberately so — unlike the test suites, which each reap
 * only their own by descriptor pid. This drives the *packaged application*,
 * which uses the machine's broker and cannot be told otherwise, so clearing the
 * machine is the only clearing that means anything. Do not run it beside
 * `pnpm -r test`: it will take those suites' brokers with it.
 */
spawnSync("pkill", ["-f", "surface broker"], { encoding: "utf8" });

/*
 * …and no service left by a previous run either.
 *
 * The application starts a service for the workspace it opens, and **adopts one
 * already serving that directory** rather than starting a second (the lock in
 * the user-data directory). Quitting the application does not stop the service
 * it started, so the next run's application adopts the last run's orphan — and
 * an orphan whose parent is gone is a service nobody will stop.
 *
 * Measured: a run that followed another without this line got eleven checks in
 * and then answered `SESSION_CLOSED — the session has no open page`, with every
 * later pass failing on a CDP protocol error and both AX passes blocked,
 * because the window had gone. None of it was a defect in Yam and all of it
 * looked like one, which is the failure this suite exists to not commit.
 */
spawnSync("pkill", ["-f", "bin.js serve"], { encoding: "utf8" });

/*
 * …and this build's CLI starts it, before the application is launched (T18).
 *
 * The broker is one process per machine and whichever client needs one first
 * starts it. Launch the application first and *it* starts the broker, from the
 * copy of the CLI staged inside `Yam.app` — and on macOS the Accessibility
 * permission belongs to a **program**, so every native session on the machine
 * is then asking on behalf of `Yam.app`, which nobody granted. Measured:
 * `yam surface doctor` in the terminal said granted and `connect --adapter ax`
 * said denied, a second apart, both true.
 *
 * So the suite starts it here, from the workspace binary the terminal's grant
 * applies to, and the application joins the one that is already running.
 */
spawnSync(process.execPath, [join(ROOT, "packages", "cli", "dist", "bin.js"), "surface", "sessions", "--json"], {
  encoding: "utf8",
  cwd: ROOT,
});

const app = packagedApp();
const sample = await startSampleApp(0);
/*
 * The fixture project, hashed before anything runs.
 *
 * "Verify zero unexpected changes to user project artifacts" is T20's Done and
 * SF-01's smoke, and the only way to say it is to say which bytes. The
 * application under test starts *projectless*, so the honest expectation is
 * that this map is identical afterwards.
 */
const before = fileHashes(join(ROOT, "evals", "fixtures"));
let launched = { launched: false, reason: "not attempted" };

/**
 * Every pass that needs the packaged application, named once.
 *
 * It used to be two literal lists, and `negative-mcp` was in neither — so on a
 * host that could not launch the application, that pass was not blocked, not
 * attempted and not reported: it left the denominator entirely. SF-21 asks for
 * "attempted, reached, passed, failed, blocked" precisely so a thing that did
 * not run stays visible, and a count that silently shrinks is the failure this
 * wave exists to stop. One list, read by both branches, so a pass added below
 * cannot be forgotten here.
 */
const NEEDS_THE_APP = [
  "cli-browser",
  "mcp-browser",
  "cli-ax",
  "mcp-ax",
  "negative-cli",
  "negative-mcp",
  "oracles",
];

/** The two checks the launch pass itself makes. */
const LAUNCH_CHECKS = [
  "the packaged application starts and publishes a window",
  "the packaged application speaks this build's contract",
];

/**
 * Every check this suite makes, per pass — the denominator, declared (SF-21,
 * T00).
 *
 * A host that cannot launch the application used to report *one* blocked row
 * per pass: seven rows where a healthy run reports ninety-two. So `attempted`
 * meant "however far this host got", which is the one thing SF-21's vocabulary
 * exists to prevent. The counts are now the same number on every host, and what
 * differs between them is how many of those checks are `blocked` and with which
 * of the host's own sentences.
 */
const CHECKS_OF = {
  launch: LAUNCH_CHECKS,
  "cli-browser": JOURNEY_CHECKS,
  "mcp-browser": JOURNEY_CHECKS,
  "cli-ax": JOURNEY_CHECKS,
  "mcp-ax": JOURNEY_CHECKS,
  "negative-cli": negativeChecks("cli"),
  "negative-mcp": negativeChecks("mcp"),
  oracles: WINDOW_ORACLE_CHECKS,
  "cli-terminal": TERMINAL_CHECKS,
  "mcp-terminal": TERMINAL_CHECKS,
};

/** Block every check of every pass that needs an application this host has not got. */
const blockEverything = (reason) => {
  for (const name of LAUNCH_CHECKS) blockPass("launch", name, reason);
  for (const pass of NEEDS_THE_APP) {
    for (const name of CHECKS_OF[pass]) blockPass(pass, name, reason);
  }
};

try {
  if (!app.present) {
    blockEverything(app.reason);
  } else {
    launched = await timed("app.launch-to-window", async () => await launchPackagedYam());
    if (!launched.launched) {
      blockEverything(launched.reason);
    } else {
      record({
        pass: "launch",
        name: "the packaged application starts and publishes a window",
        ok: true,
        detail: `${app.bundle} on ${launched.cdpUrl}`,
      });

      /*
       * The application and the suite are the same Yam (T00, SF-03).
       *
       * The application's own service reaches the same broker through the same
       * catalogue, using the copy of the command line staged inside the bundle.
       * If that copy speaks a different contract the service will *stop* the
       * broker this suite is driving through and start a replacement — and the
       * outer session then answers `SESSION_NOT_FOUND` halfway through a pass,
       * which reads exactly like a defect in Yam and is a stale build.
       *
       * A check rather than a guard, because it belongs in the denominator: a
       * run on a mismatched bundle should say so in its counts, not quietly do
       * something else.
       */
      const staged = await stagedContract();
      record({
        pass: "launch",
        name: "the packaged application speaks this build's contract",
        ok: staged.agrees === true,
        detail: staged.agrees === true ? `contract ${staged.contract}` : staged.reason,
      });

      /*
       * The oracles run **first**, on the freshly launched window (T18).
       *
       * The geometry they measure is the connect form's — the URL field beside
       * the Connect surface button, which is the overlap the T14 driving
       * actually found — and that form is on screen only while nothing is
       * connected. Run afterwards they measured a screen the passes had already
       * changed, and reported "one of them is not on screen", which is a
       * harness saying nothing rather than an oracle saying something.
       */
      if (wanted === undefined || wanted.has("oracles")) {
        console.log("\n── oracles (independent of Yam) ──");
        await windowOracles({
          cdpUrl: launched.cdpUrl,
          record,
          label: "oracles",
          screenshotPath: join(OUT, "packaged-surfaces.png"),
          root: ROOT,
        });
      }

      /* ── the browser target: the application's renderer, attached to ────── */
      const browserConnect = { adapter: "playwright", attach: launched.cdpUrl };

      const passes = [
        {
          label: "cli-browser",
          interface: "CLI",
          platform: "browser",
          make: async () => cliDriver({ transcript, holder: "yam cli" }),
          run: async (driver) =>
            await primaryJourney({
              driver,
              connect: browserConnect,
              sampleUrl: `${sample.origin}/login`,
              record,
              label: "cli-browser",
            }),
        },
        {
          label: "mcp-browser",
          interface: "MCP",
          platform: "browser",
          make: async () => await mcpDriver({ transcript, name: "yam-on-yam-agent" }),
          run: async (driver) =>
            await primaryJourney({
              driver,
              connect: browserConnect,
              sampleUrl: `${sample.origin}/login`,
              record,
              label: "mcp-browser",
            }),
        },
        {
          label: "negative-cli",
          interface: "CLI",
          platform: "browser",
          make: async () => cliDriver({ transcript, holder: "yam cli" }),
          run: async (driver) =>
            await negativeCases({ driver, connect: browserConnect, record, label: "negative-cli" }),
        },
        {
          label: "negative-mcp",
          interface: "MCP",
          platform: "browser",
          make: async () => await mcpDriver({ transcript, name: "yam-on-yam-agent" }),
          run: async (driver) =>
            await negativeCases({ driver, connect: browserConnect, record, label: "negative-mcp" }),
        },
      ];

      for (const pass of passes) {
        if (wanted !== undefined && !wanted.has(pass.label)) continue;
        console.log(`\n── ${pass.label} (${pass.interface}, ${pass.platform}) ──`);
        const driver = await pass.make();
        try {
          await timed(pass.label, async () => await pass.run(driver));
        } catch (error) {
          record({
            pass: pass.label,
            name: "the pass runs to the end",
            ok: false,
            detail: error instanceof Error ? `${error.message}`.slice(0, 300) : String(error),
          });
        } finally {
          await driver.close();
        }
      }

      /* ── the native target: the application's accessibility tree ────────── */
      /*
       * The helper's own default, not a shorter one. macOS registers a freshly
       * launched application's windows with the accessibility API on its own
       * schedule, and 20 s was short enough that a run following another
       * reported both AX passes `blocked` for want of a window that arrived a
       * few seconds later — a host reason invented by the harness's impatience.
       */
      const ax = await awaitAxWindow();
      for (const pass of [
        { label: "cli-ax", interface: "CLI" },
        { label: "mcp-ax", interface: "MCP" },
      ]) {
        if (wanted !== undefined && !wanted.has(pass.label)) continue;
        console.log(`\n── ${pass.label} (${pass.interface}, macOS AX) ──`);
        if (!ax.ready) {
          /*
           * One blocked row per check the pass would have made, not one for the
           * pass (SF-21). Collapsing a 17-check pass into a single row made the
           * run's `attempted` depend on whether the host could be asked, so the
           * denominator moved for the very reason it exists to record.
           */
          for (const name of JOURNEY_CHECKS) blockPass(pass.label, name, ax.reason);
          continue;
        }
        const driver =
          pass.interface === "CLI"
            ? cliDriver({ transcript, holder: "yam cli" })
            : await mcpDriver({ transcript, name: "yam-on-yam-agent" });
        try {
          await timed(pass.label, async () =>
            await primaryJourney({
              driver,
              connect: { adapter: "ax", app: PROCESS_NAME },
              sampleUrl: `${sample.origin}/login`,
              record,
              label: pass.label,
            }),
          );
        } catch (error) {
          record({
            pass: pass.label,
            name: "the pass runs to the end",
            ok: false,
            detail: error instanceof Error ? `${error.message}`.slice(0, 300) : String(error),
          });
        } finally {
          await driver.close();
        }
      }

    }
  }

  /* ── the terminal: Yam driving its own command line and cockpit (T22) ──── */
  /*
   * Outside the `if (app.present)` above on purpose. A terminal is a surface a
   * host either can or cannot allocate, and that is a different question from
   * whether a desktop bundle was built — so this pass runs on a host with no
   * packaged application, and is blocked with the *pty probe's* own sentence on
   * a host with no pseudo-terminal.
   */
  const { ptyReadiness } = await import("@svatah/yam-adapter-process");
  const pty = ptyReadiness();
  for (const pass of [
    { label: "cli-terminal", interface: "CLI" },
    { label: "mcp-terminal", interface: "MCP" },
  ]) {
    if (wanted !== undefined && !wanted.has(pass.label)) continue;
    console.log(`\n── ${pass.label} (${pass.interface}, a pseudo-terminal) ──`);
    const driver =
      pass.interface === "CLI"
        ? cliDriver({ transcript, holder: "yam cli" })
        : await mcpDriver({ transcript, name: "yam-on-yam-agent" });
    try {
      await timed(pass.label, async () =>
        await terminalCases({
          driver,
          record,
          label: pass.label,
          ...(pty.ready ? {} : { blockedReason: pty.reason }),
        }),
      );
    } catch (error) {
      record({
        pass: pass.label,
        name: "the pass runs to the end",
        ok: false,
        detail: error instanceof Error ? `${error.message}`.slice(0, 300) : String(error),
      });
    } finally {
      await driver.close();
    }
  }

  /* ── the fixture project is byte-for-byte unchanged ───────────────────── */
  const fixtures = join(ROOT, "evals", "fixtures");
  const after = fileHashes(fixtures);
  const changes = changedFiles(before, after);
  record({
    pass: "oracles",
    name: "the fixture project's files are byte-for-byte unchanged",
    ok: changes.length === 0,
    detail: changes.length === 0 ? `${Object.keys(after).length} file(s) unchanged` : changes.join(", "),
  });

  /*
   * …and the report accounts for every pass that ran (SF-21).
   *
   * `NEEDS_THE_APP` is what a host that cannot launch the application blocks,
   * so a pass that runs here and is missing from that list would simply vanish
   * on such a host — reported nowhere, in no denominator. That is how
   * `negative-mcp` went unnoticed. Checking it here means the omission shows up
   * on a *healthy* run, which is the run somebody actually looks at.
   */
  if (wanted === undefined) {
    const ran = [...new Set(results.map((one) => one.pass))].filter((one) => one !== "launch");
    /*
     * The terminal passes do not need the application and are blocked by their
     * own probe, so they are accounted for here rather than in `NEEDS_THE_APP`
     * — which is a list about the *bundle*, not about every pass.
     */
    const OWN_READINESS = ["cli-terminal", "mcp-terminal"];
    const unaccounted = ran.filter(
      (one) => !NEEDS_THE_APP.includes(one) && !OWN_READINESS.includes(one),
    );
    record({
      pass: "oracles",
      name: "every pass that ran is one a host without the application would report as blocked",
      ok: unaccounted.length === 0,
      detail:
        unaccounted.length === 0
          ? `${ran.length} pass(es) accounted for`
          : `missing from NEEDS_THE_APP, so they would leave the denominator: ${unaccounted.join(", ")}`,
    });
  }
} finally {
  await sample.close();
  launched.stop?.();
  /*
   * Leave the machine as the run found it. The application is quit above; the
   * service it started and the broker outlive it, and a leftover of either is
   * what the next run would drive by mistake.
   */
  spawnSync("pkill", ["-f", "surface broker"], { encoding: "utf8" });
  spawnSync("pkill", ["-f", "bin.js serve"], { encoding: "utf8" });
}

/* ── what the run found ───────────────────────────────────────────────────── */

const attempted = results.length;
const blocked = results.filter((one) => one.blocked !== undefined).length;
const reached = attempted - blocked;
const failed = results.filter((one) => one.blocked === undefined && one.ok !== true).length;
const passed = reached - failed;

const report = {
  schemaVersion: "1.0.0",
  suite: "yam-on-yam",
  ranAt: new Date().toISOString(),
  host: { platform: process.platform, arch: process.arch, node: process.version },
  packaged: app.present ? app.bundle : null,
  counts: { attempted, reached, passed, failed, blocked },
  timings,
  checks: results,
};
writeFileSync(join(OUT, "yam-on-yam.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(
  join(OUT, "yam-on-yam-transcript.json"),
  `${JSON.stringify(transcript, null, 2)}\n`,
  "utf8",
);
writeFileSync(
  join(OUT, "yam-on-yam-transcript.txt"),
  transcript
    .map((one) =>
      one.interface === "cli"
        ? `$ ${one.command}\n  exit ${one.exit}  ${JSON.stringify(one.answer).slice(0, 600)}`
        : `→ ${one.tool} ${JSON.stringify(one.arguments)}\n  isError=${one.isError}  ${JSON.stringify(one.answer).slice(0, 600)}`,
    )
    .join("\n\n"),
  "utf8",
);

console.log(
  `\n${passed} of ${reached} reached check(s) passed; ${blocked} blocked; ` +
    `${attempted} attempted → ${join(OUT, "yam-on-yam.json")}`,
);

/*
 * Three exits, because "everything was blocked" is not "everything passed"
 * (T00, SF-21).
 *
 * This suite is a gate now, and a gate that exits 0 on a host that could reach
 * nothing is a green build that proved nothing — which is the failure the whole
 * blocked/reached vocabulary exists to prevent. So:
 *
 *   1  a check failed. The product, or the harness, is wrong.
 *   2  this host could not be asked: nothing was reached beyond the two
 *      run-level oracles, which need neither an application nor a terminal.
 *      A caller decides whether that is tolerable; CI tolerates it and says so.
 *   0  something was reached and nothing failed.
 *
 * The same three the desktop conformance gate uses, for the same reason.
 */
const RUN_LEVEL = 2;
if (failed > 0) process.exit(1);
if (reached <= RUN_LEVEL) {
  console.log(
    `\nNothing was reached on this host: every check is blocked. ` +
      `The reasons are in yam-on-yam.json; the first is:\n  ` +
      `${results.find((one) => one.blocked !== undefined)?.blocked ?? "(none recorded)"}`,
  );
  process.exit(2);
}
process.exit(0);
