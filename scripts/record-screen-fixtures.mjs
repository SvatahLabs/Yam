#!/usr/bin/env node
/**
 * Record what the local service answers for `evals/fixtures` (T9.1, LLD §13.7).
 *
 *   node scripts/record-screen-fixtures.mjs            # re-record and write
 *   node scripts/record-screen-fixtures.mjs --check    # fail if the committed
 *                                                     # fixtures have drifted
 *
 * `@svatah/yam-screens` is tested against a fake service, and a fake service is only
 * worth testing against if its answers are ones a real service gave. So this
 * starts `apps/sample-web`, wires the service exactly as `yam serve` does,
 * makes the run the mockups are drawn from, and writes every response into
 * `packages/screens/test/fixtures/`.
 *
 * ## The run is the mockup's run
 *
 * The `Run` artboard shows `comp`: `guards-and-compensation.flow`'s two
 * scenarios, five steps, the fifth failing with `locator`, the policy running
 * "cancel a booking" with the failing story's scope, six passed and one failed,
 * exit 11, `plan a60918dc`, `bindings aa7c8799`. Those are not illustrative
 * numbers — they are what a run of that flow writes, and this script makes one.
 *
 * ## Why it needs a browser and the fixtures do not
 *
 * The recording needs Chromium and the sample application; the tests that read
 * the recording need neither, which is what keeps `@svatah/yam-screens` a fast,
 * DOM-free package. `--check` is what a verifier runs to prove the recording is
 * still what the service says.
 *
 * ## Why it works on a copy (P9-F1, Draft 2.12 §13.7)
 *
 * > The fake service's fixtures are a recording taken against a **copy** of the
 * > fixtures project in a temporary directory, never the committed one, so the
 * > check does not depend on what else ran there.
 *
 * The first version ran `comp` inside `evals/fixtures` and recorded `GET /runs`,
 * which answers with *every* run in that directory. The test suite leaves runs
 * there, the client smoke leaves one, and so does anyone who runs a flow — so
 * `--check` failed for reasons that had nothing to do with the fixtures, and
 * passed only on a directory nobody had touched. A recording that depends on
 * what else happened in a directory it does not own is not a recording of the
 * project.
 *
 * So the project is copied to a temporary directory first — without `runs/` and
 * without `node_modules/` — the run is made there, the service is opened there,
 * and the copy is removed afterwards. The temporary path is normalised back to
 * `<repo>/evals/fixtures` in the recording, because what the fixture is *about*
 * is the committed project and not the directory this script borrowed.
 */
import { spawn } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp } from "sample-web";
/* The comparator lives in `scripts/lib/` so a test can drive it without a recording. */
import { comparable } from "./lib/screen-fixture-compare.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
const OUT = join(ROOT, "packages", "screens", "test", "fixtures");
/** The committed project the recording is *about*. Never written to. */
const SOURCE = join(ROOT, "evals", "fixtures");
/** How the recording spells `SOURCE`, whatever directory the run happened in. */
const AS_RECORDED = "<repo>/evals/fixtures";
const TOKEN = "screen-fixtures";
const RUN_ID = "comp";
const FLOW = "flows/guards-and-compensation.flow";
const STORIES = ["I want to book and then fail", "cancel a booking"];

const check = process.argv.includes("--check");

/**
 * What is normalised out of the recording, and why.
 *
 * Two things, both about *this machine* rather than about the project: the
 * ephemeral port the sample application took, and this checkout's absolute
 * path. Everything else is kept, timestamps included — the Run screen stamps
 * its audit lines from the run's start (`08.451`), so a fixture with the times
 * removed could not test the screen that shows them.
 *
 * Stacks are dropped: they are the only field that names files this repository
 * will rename, and no screen shows one.
 */
function stable(value, workspace) {
  const seen = JSON.stringify(value, (key, one) => {
    if (key === "stack") return undefined;
    if (typeof one === "string") {
      /*
       * The working copy first, then the checkout. The copy lives under
       * `/var/folders/…` (or `/tmp`) and is a different directory on every
       * run; the fixture is about `evals/fixtures`, so that is what it says.
       *
       * The rest of such a path is said with `/`, because the separator is as
       * much a fact about the machine as the prefix: on Windows a failure's
       * screenshot came back as `<repo>/evals/fixtures\runs\comp\…` and the
       * check failed on a file that was the same.
       */
      const underneath = (text, prefix, as) =>
        text
          .split(prefix)
          .map((part, index) => (index === 0 ? part : part.replace(/^[^\s"'`]*/, (path) => path.replaceAll("\\", "/"))))
          .join(as);
      return underneath(
        underneath(one.replace(/127\.0\.0\.1:\d+/g, "127.0.0.1:PORT"), workspace, AS_RECORDED),
        ROOT,
        "<repo>",
      );
    }
    return one;
  });
  return JSON.parse(seen);
}


/** `yam <args>`, as a person would run it, with the sample application's URL. */
function yam(args, options = {}) {
  const { NODE_OPTIONS, ...environment } = process.env;
  void NODE_OPTIONS;
  return new Promise((done) => {
    let output = "";
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: ROOT,
      env: { ...environment, ...(options.env ?? {}) },
    });
    child.stdout.on("data", (chunk) => {
      output += String(chunk);
      options.onStdout?.(output, child);
    });
    child.stderr.on("data", (chunk) => (output += String(chunk)));
    child.on("close", (code) => done({ code: code ?? 1, output, child }));
  });
}

if (!existsSync(CLI)) {
  process.stderr.write("Run `pnpm -r build` first.\n");
  process.exit(2);
}

/*
 * The working copy (P9-F1, Draft 2.12 §13.7).
 *
 * `runs/` and `node_modules/` are left behind: the first is what made the check
 * depend on its surroundings, and the second is a symlink farm nobody needs to
 * copy. `.yam/` goes too — it is a build product of `yam compile` and the
 * run makes its own.
 */
const app = await startSampleApp(0);
/*
 * `realpathSync`, because on macOS `mkdtemp` answers `/var/folders/…` and every
 * program that resolves the path answers `/private/var/folders/…`. A recording
 * normalised against only one of the two spellings keeps the other, which is an
 * absolute path from this machine in a committed fixture.
 */
const workspace = realpathSync(mkdtempSync(join(tmpdir(), "yam-screen-fixtures-")));
const PROJECT = join(workspace, "fixtures");
cpSync(SOURCE, PROJECT, {
  recursive: true,
  filter: (from) =>
    !from.includes(`${sep}node_modules`) &&
    !from.includes(`${sep}runs`) &&
    !from.includes(`${sep}.yam`),
});
const runsDir = join(PROJECT, "runs");
let serve;
try {
  /*
   * The run first, so `GET /runs` and the Flows screen's gutter have something
   * to read. Through the command line, because the fixtures have to be what
   * *the service* answers and the service calls the same functions `yam run`
   * does — a fixture assembled in this process would be a fixture about this
   * script.
   *
   * `comp` aborts by design (exit 11): the fifth step cannot resolve, the policy
   * runs the compensating story, and that is the subject of the Run artboard.
   */
  rmSync(join(runsDir, RUN_ID), { recursive: true, force: true });
  const ran = await yam([
    "run",
    PROJECT,
    "--host",
    "none",
    "--flow",
    FLOW,
    ...STORIES.flatMap((story) => ["--story", story]),
    "--run-id",
    RUN_ID,
    "--base-url",
    app.origin,
  ]);
  if (ran.code !== 11) {
    process.stderr.write(
      `\`yam run\` exited ${ran.code}; the Run artboard is drawn from an aborted run ` +
        `(exit 11).\n${ran.output}\n`,
    );
    process.exit(1);
  }

  /* The service, spawned exactly as the app spawns it (LLD §13.6). */
  const handshake = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [CLI, "serve", PROJECT, "--port", "0", "--token", TOKEN],
      /*
       * `CI` is set so the service answers `gateway.display: false` wherever the
       * recording is taken: whether a person can click is a fact about the host,
       * not about the project, and a fixture that recorded a desk's answer failed
       * the check on every host without one (Draft 2.22).
       */
      { cwd: ROOT, env: { ...process.env, YAM_BASE_URL: app.origin, CI: "1" } },
    );
    serve = child;
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("`yam serve` printed no handshake")), 30_000);
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const match = /^yam serve listening url=(\S+) token=(\S+)$/m.exec(buffer);
      if (match !== null) {
        clearTimeout(timer);
        resolve({ url: match[1], token: match[2] });
      }
    });
    child.on("error", reject);
  });

  const call = async (path, options = {}) => {
    const response = await fetch(`${handshake.url}${path}`, {
      ...options,
      headers: {
        authorization: `Bearer ${handshake.token}`,
        ...(options.body === undefined ? {} : { "content-type": "application/json" }),
        ...(options.headers ?? {}),
      },
    });
    const raw = await response.text();
    if (!response.ok) throw new Error(`${path} answered ${response.status}: ${raw.slice(0, 300)}`);
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  const flows = {};
  const project = await call("/project");
  for (const file of project.flows ?? []) {
    flows[file.split("/").pop()] = await call(`/flows/${file.split("/").pop()}`);
  }

  /*
   * Every binding file, not only the list. `GET /bindings` answers `{ id, file }`
   * rows and `GET /bindings/:id` answers the YAML — which is the file the CLI
   * reads, so a screen that shows a candidate table reads the same bytes
   * `yam bindings show` prints.
   */
  const bindingList = await call("/bindings");
  const bindingById = {};
  for (const one of bindingList) bindingById[one.id] = await call(`/bindings/${one.id}`);

  const fixtures = {
    project,
    plan: await call("/plan"),
    compile: await call("/compile", { method: "POST" }),
    runs: await call("/runs"),
    bindings: bindingList,
    bindingById,
    data: await call("/data"),
    api: await call("/api"),
    tools: await call("/tools"),
    flows,
    runById: {
      [RUN_ID]: {
        summary: await call(`/runs/${RUN_ID}`),
        results: await call(`/runs/${RUN_ID}/results`),
        audit: await call(`/runs/${RUN_ID}/audit`),
      },
    },
  };

  const text = `${JSON.stringify(stable(fixtures, PROJECT), null, 2)}\n`;
  const path = join(OUT, "fixtures-project.json");

  if (check) {
    if (!existsSync(path)) {
      process.stderr.write(`${path} does not exist. Run this without --check.\n`);
      process.exit(1);
    }
    const committed = readFileSync(path, "utf8");
    if (comparable(committed) !== comparable(text)) {
      /*
       * Where, and not only that. On a CI runner nobody can open, "differ" was
       * the whole message, and the diff it pointed at is only on that machine.
       */
      const was = comparable(committed).split("\n");
      const now = comparable(text).split("\n");
      let at = 0;
      while (at < was.length && at < now.length && was[at] === now[at]) at += 1;
      const around = (lines) =>
        lines
          .slice(Math.max(0, at - 2), at + 3)
          .map((line, index) => `  ${Math.max(0, at - 2) + index + 1}: ${line.slice(0, 200)}`)
          .join("\n");
      process.stderr.write(
        "The committed screen fixtures differ from what the service answers now.\n" +
          `The first difference is at line ${at + 1}.\ncommitted:\n${around(was)}\nnow:\n${around(now)}\n` +
          "Run `node scripts/record-screen-fixtures.mjs` and read the diff.\n",
      );
      process.exit(1);
    }
    process.stdout.write(
      `${path} matches the service: ${(project.flows ?? []).length} flow(s), ` +
        `${(project.stories ?? []).length} stories, ${fixtures.bindings.length} bindings, ` +
        `run ${RUN_ID} exit ${fixtures.runById[RUN_ID].summary.exitCode}\n`,
    );
  } else {
    mkdirSync(OUT, { recursive: true });
    writeFileSync(path, text, "utf8");
    process.stdout.write(
      `wrote ${path}: ${(project.flows ?? []).length} flow(s), ` +
        `${(project.stories ?? []).length} stories, ${fixtures.bindings.length} bindings, ` +
        `${fixtures.runs.length} run(s)\n`,
    );
  }
} finally {
  serve?.kill("SIGTERM");
  await app.close();
  // The copy is the point: nothing this script did touched `evals/fixtures`,
  // and nothing it left behind can change what the next `--check` answers.
  rmSync(workspace, { recursive: true, force: true });
}
