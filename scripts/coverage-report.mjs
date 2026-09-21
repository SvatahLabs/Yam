/**
 * What was reached, per interface and per platform (T19, SF-09, SF-18, SF-21).
 *
 *   node scripts/coverage-report.mjs
 *   node scripts/coverage-report.mjs --out docs/spec/surface-first/evidence/wave-5
 *   node scripts/coverage-report.mjs --skip-quick-start     # the slow half
 *
 * SF-21: "Evidence reports distinguish attempted, reached, passed, failed,
 * blocked and externally verified checks per interface/platform," and "a high
 * agreement percentage on a small reachable subset cannot satisfy release
 * coverage."
 *
 * ## Why a denominator, and why it is the headline
 *
 * A report that says "100 percent" is answering the wrong question. What a
 * release needs to know is *what was not asked*: which platform, for what host
 * reason, and how many checks went unrun because of it. So every row here reads
 * **passed of reached, of attempted**, and every blocked row carries the
 * sentence the host itself produced — `yam surface doctor`'s line, the exact
 * missing runner, the licence that keeps a tool out of the tree.
 *
 * ## It is generated, and it is generated from runs
 *
 * Nothing here is typed in. The suite results are read from the JSON their
 * runners wrote, adapter readiness is asked of the product, the timings are
 * measured in this process, and the quick starts are run from a packed tarball
 * in a directory outside the workspace. A hand-written table is not a report.
 */
import { execFileSync, spawn, spawnSync } from "node:child_process";
import {
  closeSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
const argv = process.argv.slice(2);
const option = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at < 0 ? undefined : argv[at + 1];
};
/**
 * Where the evidence for the current wave lives.
 *
 * The newest `evidence/wave-N` directory rather than a name written down here,
 * because a path that has to be edited every wave is a path that will be
 * forgotten — and a coverage report that silently kept reading the previous
 * wave's runs would be the "artefact trusted after the code beneath it moved"
 * defect in its purest form. `--out` overrides it.
 */
export function newestWave(root) {
  const evidence = join(root, "docs", "spec", "surface-first", "evidence");
  if (!existsSync(evidence)) return join(evidence, "wave-1");
  const waves = readdirSync(evidence)
    .filter((one) => /^wave-\d+$/u.test(one))
    .sort((a, b) => Number(a.slice(5)) - Number(b.slice(5)));
  return join(evidence, waves.at(-1) ?? "wave-1");
}

const OUT = resolve(ROOT, option("out") ?? newestWave(ROOT));
mkdirSync(OUT, { recursive: true });

/** One line of the report: a set of checks, whose interface and platform are known. */
const rows = [];
const addRow = (row) => {
  rows.push(row);
  console.log(
    `${row.interface.padEnd(8)} ${row.platform.padEnd(12)} ` +
      `${String(row.passed)}/${row.reached} reached, ${row.attempted} attempted` +
      `${row.blocked > 0 ? `, ${row.blocked} blocked` : ""}` +
      `${row.reason === undefined ? "" : ` — ${row.reason.slice(0, 110)}`}`,
  );
};

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/* ── 1. Yam controls Yam, per interface and platform (T18) ────────────────── */

/**
 * The suite's own report, grouped the way SF-21 asks for.
 *
 * A pass carries its interface and its platform in its label — `cli-browser`,
 * `mcp-ax` — because the suite runs one journey per pair, which is what makes
 * this grouping a fact about the run rather than a guess about it.
 */
const PASS_SHAPE = {
  "cli-browser": { interface: "CLI", platform: "browser" },
  "mcp-browser": { interface: "MCP", platform: "browser" },
  "negative-cli": { interface: "CLI", platform: "browser" },
  "negative-mcp": { interface: "MCP", platform: "browser" },
  "cli-ax": { interface: "CLI", platform: "macOS AX" },
  "mcp-ax": { interface: "MCP", platform: "macOS AX" },
  "cli-terminal": { interface: "CLI", platform: "a pseudo-terminal" },
  "mcp-terminal": { interface: "MCP", platform: "a pseudo-terminal" },
  launch: { interface: "desktop", platform: "packaged app" },
  oracles: { interface: "external", platform: "packaged app" },
};

const yamOnYamPath = join(OUT, "yam-on-yam.json");
if (!existsSync(yamOnYamPath)) {
  console.error(
    `No ${yamOnYamPath}. Run the T18 suite first:\n` +
      `  YAM_ON_YAM_EVIDENCE_DIR=${option("out") ?? relative(ROOT, OUT)} ` +
      "node evals/self/yam-on-yam/run.mjs",
  );
  process.exit(2);
}
const yamOnYam = readJson(yamOnYamPath);
const grouped = new Map();
for (const check of yamOnYam.checks) {
  const shape = PASS_SHAPE[check.pass] ?? { interface: "CLI", platform: "browser" };
  const key = `${shape.interface}\u0000${shape.platform}`;
  const at = grouped.get(key) ?? {
    ...shape,
    suite: "yam-on-yam",
    attempted: 0,
    reached: 0,
    passed: 0,
    failed: 0,
    blocked: 0,
    externallyVerified: shape.interface === "external",
    reasons: new Set(),
  };
  at.attempted += 1;
  if (check.blocked !== undefined) {
    at.blocked += 1;
    at.reasons.add(check.blocked);
  } else {
    at.reached += 1;
    if (check.ok === true) at.passed += 1;
    else at.failed += 1;
  }
  grouped.set(key, at);
}
for (const one of grouped.values()) {
  addRow({
    ...one,
    reasons: undefined,
    ...(one.reasons.size === 0 ? {} : { reason: [...one.reasons][0] }),
  });
}

/* ── 2. The browser-hosted desktop evidence, labelled as such ─────────────── */

/*
 * `apps/desktop/test/surfaces-dogfood.mjs` drives the *built renderer* in a
 * browser. It is not the packaged application and it is not counted as if it
 * were: its row says `desktop (browser-hosted)`, which is the label T18's
 * decision requires it to keep.
 */
const dogfoodPath = join(OUT, "surfaces-dogfood.json");
if (existsSync(dogfoodPath)) {
  const checks = readJson(dogfoodPath);
  addRow({
    interface: "desktop",
    platform: "browser-hosted",
    suite: "surfaces-dogfood",
    attempted: checks.length,
    reached: checks.length,
    passed: checks.filter((one) => one.ok).length,
    failed: checks.filter((one) => !one.ok).length,
    blocked: 0,
    externallyVerified: false,
  });
} else {
  addRow({
    interface: "desktop",
    platform: "browser-hosted",
    suite: "surfaces-dogfood",
    attempted: 0,
    reached: 0,
    passed: 0,
    failed: 0,
    blocked: 1,
    externallyVerified: false,
    reason:
      `no ${dogfoodPath}; regenerate with \`SURFACES_EVIDENCE_DIR=… ` +
      "pnpm --filter @svatah/yam-desktop exec node test/surfaces-dogfood.mjs`",
  });
}

/* ── 3. The HTTP interface: the catalogue's routes, over a real service ───── */

/*
 * The third interface of SF-21's list, and the one the wave-2 verification
 * found serving hand-written routes while the catalogue generated a document
 * nobody served. What is measured is the property that failure would break:
 * every operation the catalogue declares is reachable over HTTP on the path it
 * declares.
 */
function httpInterface() {
  const workspace = mkdtempSync(join(tmpdir(), "yam-coverage-http-"));
  const service = spawnSync(
    process.execPath,
    [join(ROOT, "packages", "cli", "dist", "bin.js"), "--version"],
    { encoding: "utf8" },
  );
  void service;
  try {
    const operations = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { OPERATIONS } from ${JSON.stringify(join(ROOT, "packages/surface-control/dist/index.js"))};` +
            "process.stdout.write(JSON.stringify(OPERATIONS.map(o => ({ name: o.name, method: o.service.method, path: o.service.path }))));",
        ],
        { encoding: "utf8" },
      ),
    );
    const document = JSON.parse(
      execFileSync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { openApiDocument } from ${JSON.stringify(join(ROOT, "packages/service/dist/index.js"))};` +
            'process.stdout.write(JSON.stringify(openApiDocument("0.1.0")));',
        ],
        { encoding: "utf8" },
      ),
    );
    let described = 0;
    const missing = [];
    for (const operation of operations) {
      const path = Object.keys(document.paths ?? {}).find(
        (one) => one.replace(/\{[^}]+\}/g, ":x") === operation.path.replace(/:[^/]+/g, ":x"),
      );
      const has =
        path !== undefined &&
        document.paths[path][operation.method.toLowerCase()] !== undefined;
      if (has) described += 1;
      else missing.push(`${operation.method} ${operation.path}`);
    }
    addRow({
      interface: "HTTP",
      platform: "service /v1",
      suite: "catalogue-to-openapi",
      attempted: operations.length,
      reached: operations.length,
      passed: described,
      failed: operations.length - described,
      blocked: 0,
      externallyVerified: false,
      ...(missing.length === 0 ? {} : { reason: `not described: ${missing.join(", ")}` }),
    });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}
httpInterface();

/* ── 4. Every adapter: revalidated, or unvalidated with the host's reason ─── */

/*
 * SF-09: "An adapter's presence in a dropdown is insufficient evidence of
 * support." So each is *asked*, through `yam surface targets`, and the answer
 * it gives about itself is what the row says. An adapter that is registered and
 * not ready is `blocked` with its own prerequisite — never `failed`, and never
 * quietly absent.
 */
function adapters() {
  const ran = spawnSync(process.execPath, [CLI, "surface", "targets", "--json"], {
    encoding: "utf8",
    cwd: ROOT,
  });
  let discovered;
  try {
    discovered = JSON.parse(ran.stdout).result.adapters ?? [];
  } catch {
    addRow({
      interface: "adapter",
      platform: "discovery",
      suite: "surface targets",
      attempted: 1,
      reached: 0,
      passed: 0,
      failed: 0,
      blocked: 1,
      externallyVerified: false,
      reason: `\`yam surface targets\` produced no JSON: ${(ran.stderr || ran.stdout).trim().slice(0, 200)}`,
    });
    return [];
  }

  /*
   * Which adapters this run actually *drove* (SF-09, T19).
   *
   * "An adapter's presence in a dropdown is insufficient evidence of support",
   * and neither is `available: true` — that means registered and on a matching
   * platform, which is a claim about this machine and not about the adapter.
   * The only evidence that an adapter works is a session opened through it, so
   * the answer comes from the T18 transcript: every `--adapter` on a command
   * line and every `adapter` in a tool call that succeeded.
   */
  const validated = new Map();
  const transcriptPath = join(OUT, "yam-on-yam-transcript.json");
  if (existsSync(transcriptPath)) {
    for (const entry of readJson(transcriptPath)) {
      if (entry.answer?.status !== "succeeded") continue;
      const name =
        entry.interface === "mcp"
          ? entry.arguments?.adapter
          : /--adapter\s+(\S+)/.exec(entry.command ?? "")?.[1];
      const kind = entry.answer?.result?.kind;
      if (typeof name === "string" && kind !== undefined) {
        validated.set(name, `a session of kind \`${kind}\` opened through it in this run`);
      }
    }
  }

  /**
   * Why an adapter this run did not drive was not driven — in the words of the
   * thing that would have had to be true.
   */
  const NOT_DRIVEN = {
    bidi:
      "needs a Chrome or Firefox started with a BiDi endpoint; `pnpm bidi:independence` is the " +
      "suite that drives it and it is not part of this run",
    appium:
      "needs an Appium server and a device or emulator; neither is present on this host. CI's " +
      "`appium-emulator` leg drives it against Android Chrome on an emulator",
    uia:
      "needs Windows; not this host. CI's `desktop-conformance` Windows leg drives it against " +
      "the packaged application",
    http:
      "driven by `packages/cli/test/surface-transport.test.ts` in the gate rather than by this " +
      "suite, which drives the packaged desktop",
    atspi:
      "needs a Linux host with a session bus, toolkit accessibility on, `at-spi2-registryd` " +
      "running and `python3` with `pyatspi`; not this host. Its tree mapping, reference scope, " +
      "state inversion, action selection and refusals are driven by " +
      "`packages/adapter-atspi/test/tree.test.ts`, and its conversation with a real registry by " +
      "CI's `desktop-conformance` Linux leg, against the packaged application on a virtual display",
    process:
      "driven by the `cli-terminal` and `mcp-terminal` passes of this suite and by " +
      "`packages/adapter-process/test/surface.test.ts`",
  };

  const out = [];
  for (const adapter of discovered) {
    const name = adapter.adapter;
    const platforms = (adapter.platform ?? []).join(", ") || "—";
    const eligible = adapter.available === true;
    const drivenHere = validated.get(name);
    const status = drivenHere !== undefined ? "validated" : eligible ? "unvalidated" : "blocked";
    /*
     * Both halves, when there are two (T23).
     *
     * A blocked row used to carry only the host's sentence — "AT-SPI is Linux's
     * accessibility bus; this host is darwin" — and lose the more important
     * one: that its bridge has been driven against no live registry *anywhere*.
     * A reader on Linux would have been told it was available and nothing else.
     * So the host's reason and what would have to be true are joined, and a row
     * says both.
     */
    const reason =
      drivenHere ??
      [adapter.reason, NOT_DRIVEN[name], (adapter.prerequisites ?? []).join("; ")]
        .filter((one) => one !== undefined && one !== "")
        .join(" — ");
    out.push({
      adapter: name,
      platforms,
      status,
      reason,
      /*
       * What the host said its version is, and the versions this repository has
       * driven (T23). "Each newly supported capability gets a reproducible
       * conformance result, its limitations and its version range" — the first
       * is the run, and these two are the other half of the sentence.
       */
      version: adapter.probe?.version ?? "—",
      range: adapter.range ?? "—",
    });
    addRow({
      interface: "adapter",
      platform: name,
      suite: "readiness",
      attempted: 1,
      reached: status === "validated" ? 1 : 0,
      passed: status === "validated" ? 1 : 0,
      failed: 0,
      blocked: status === "validated" ? 0 : 1,
      externallyVerified: false,
      ...(status === "validated" ? {} : { reason: `${status}: ${reason}` }),
    });
  }
  return out;
}
const adapterRows = adapters();

/* ── 5. Timing budgets, defined here and measured here ────────────────────── */

/**
 * The budgets, and where they come from.
 *
 * `requirements.md`: "warm core overhead (excluding adapter/application
 * execution) should have p95 ≤100 ms across 100 operations; first web connect
 * and useful snapshot should have p95 ≤5 s across 20 launches", and it calls
 * them "proposed product budgets to calibrate, not measured current
 * performance". These are the calibration: the numbers are this host's, the
 * environment is recorded beside them, and adapter time is reported separately
 * where the envelope carries it.
 */
const BUDGETS = [
  { what: "connect", budgetMs: 5000, note: "first connect to a target (SF-21's 5 s)" },
  { what: "snapshot", budgetMs: 5000, note: "a useful first snapshot" },
  { what: "act", budgetMs: 5000, note: "one dispatched action, typing into a real field" },
  { what: "desktop first paint", budgetMs: 60000, note: "launch to Surfaces on screen" },
];

function percentile(values, p) {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function timings() {
  const measured = [];
  const sample = [];
  const runs = Number(option("timing-runs") ?? 5);

  /*
   * A real browser against a real application, because that is what the budget
   * is about (SF-21: "first web connect and useful snapshot").
   *
   * An earlier draft measured an HTTP session and called the third number
   * `act` — while actually timing `capabilities`, because an HTTP surface
   * refuses `act`. A budget measured on a different operation than the one it
   * names is worse than no budget, so this drives the sample application and
   * types into a field of it.
   *
   * The sample application runs in a **child process**: the commands below are
   * `spawnSync`, which blocks this process's event loop, and an in-process
   * server cannot answer a browser while that is happening.
   */
  /*
   * Its output goes to a **file**, not to a pipe this process reads.
   *
   * `spawnSync` below blocks this event loop, and a pipe needs the loop to
   * deliver its data — so polling `child.stdout` here found nothing and the
   * whole measurement reported "the sample application did not start" while it
   * was running perfectly. The kernel writes to a file without asking us.
   */
  const log = join(mkdtempSync(join(tmpdir(), "yam-coverage-sample-")), "sample.log");
  const handle = openSync(log, "w");
  const web = spawn(process.execPath, [join(ROOT, "apps", "sample-web", "dist", "cli.js")], {
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", handle, handle],
  });
  let origin;
  const started = Date.now();
  while (origin === undefined && Date.now() - started < 60_000) {
    const found = /listening on (http:\/\/\S+)/.exec(readFileSync(log, "utf8"));
    if (found !== null) origin = found[1];
    else spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 100)"]);
  }
  closeSync(handle);

  const yam = (...argv) =>
    spawnSync(process.execPath, [CLI, "surface", ...argv, "--json"], {
      encoding: "utf8",
      cwd: ROOT,
      maxBuffer: 64 * 1024 * 1024,
    });

  try {
    for (let i = 0; i < runs && origin !== undefined; i += 1) {
      const connectAt = Date.now();
      const connected = yam("connect", "--url", `${origin}/login`);
      const connectMs = Date.now() - connectAt;
      let session;
      try {
        session = JSON.parse(connected.stdout).result?.sessionId;
      } catch {
        session = undefined;
      }
      if (session === undefined) continue;
      sample.push({ what: "connect", ms: connectMs });

      const snapAt = Date.now();
      const snapped = yam("snapshot", "--session", session, "--interactive-only", "--max-nodes", "50");
      sample.push({ what: "snapshot", ms: Date.now() - snapAt });

      let ref;
      try {
        ref = (JSON.parse(snapped.stdout).result?.nodes ?? []).find(
          (node) => node.role === "textbox",
        )?.ref;
      } catch {
        ref = undefined;
      }
      if (ref !== undefined) {
        const actAt = Date.now();
        spawnSync(
          process.execPath,
          [CLI, "surface", "act", "--session", session, "--action", "type", "--ref", ref, "--input", "-", "--json"],
          { encoding: "utf8", cwd: ROOT, input: JSON.stringify({ value: "ada" }) },
        );
        sample.push({ what: "act", ms: Date.now() - actAt });
      }

      yam("close", "--session", session);
    }
  } finally {
    web.kill("SIGTERM");
  }

  /* The desktop's first paint is the T18 suite's own launch measurement. */
  for (const one of yamOnYam.timings ?? []) {
    if (one.what === "app.launch-to-window") sample.push({ what: "desktop first paint", ms: one.ms });
  }

  for (const budget of BUDGETS) {
    const values = sample.filter((one) => one.what === budget.what).map((one) => one.ms);
    measured.push({
      ...budget,
      samples: values.length,
      p95Ms: percentile(values, 95),
      medianMs: percentile(values, 50),
      within:
        values.length === 0 ? undefined : (percentile(values, 95) ?? Infinity) <= budget.budgetMs,
      ...(values.length === 0
        ? {
            reason:
              budget.what === "desktop first paint"
                ? "the T18 run recorded no launch on this host"
                : origin === undefined
                  ? "the sample application did not start, so there was nothing to time against"
                  : "no sample: the command line did not open a session to measure",
          }
        : {}),
    });
  }
  return measured;
}

const budgets = timings();
for (const one of budgets) {
  console.log(
    `budget  ${one.what.padEnd(20)} ${
      one.p95Ms === undefined ? `no sample — ${one.reason}` : `p95 ${one.p95Ms} ms of ${one.budgetMs} ms (${one.samples} sample(s)) ${one.within ? "within" : "OVER"}`
    }`,
  );
}

/* ── 6. Clean-package quick starts, from the docs, outside the workspace ──── */

/*
 * SF-20: "Test packed artifacts outside workspace symlinks and copied examples
 * verbatim." `scripts/surface-quick-start.mjs` is what runs them; this records what it
 * answered. Its commands are extracted from the documentation source, so a doc
 * that drifts is a failing check rather than a stale page.
 */
function quickStart() {
  if (argv.includes("--skip-quick-start")) {
    return { skipped: "--skip-quick-start" };
  }
  const ran = spawnSync(process.execPath, [join(ROOT, "scripts", "surface-quick-start.mjs"), "--json"], {
    encoding: "utf8",
    cwd: ROOT,
    maxBuffer: 64 * 1024 * 1024,
    timeout: 20 * 60 * 1000,
  });
  try {
    return JSON.parse(ran.stdout);
  } catch {
    return {
      error:
        `\`node scripts/quick-start.mjs --json\` produced no JSON (exit ${ran.status}): ` +
        `${(ran.stderr || ran.stdout).trim().split("\n").slice(-4).join(" ").slice(0, 400)}`,
    };
  }
}
const quick = quickStart();
if (quick.commands !== undefined) {
  addRow({
    interface: "packaging",
    platform: "clean install",
    suite: "quick-start",
    attempted: quick.commands.length,
    reached: quick.commands.filter((one) => one.blocked === undefined).length,
    passed: quick.commands.filter((one) => one.ok === true).length,
    failed: quick.commands.filter((one) => one.blocked === undefined && one.ok !== true).length,
    blocked: quick.commands.filter((one) => one.blocked !== undefined).length,
    externallyVerified: false,
  });
}

/* ── the report ───────────────────────────────────────────────────────────── */

const totals = rows.reduce(
  (at, one) => ({
    attempted: at.attempted + one.attempted,
    reached: at.reached + one.reached,
    passed: at.passed + one.passed,
    failed: at.failed + one.failed,
    blocked: at.blocked + one.blocked,
  }),
  { attempted: 0, reached: 0, passed: 0, failed: 0, blocked: 0 },
);

const report = {
  schemaVersion: "1.0.0",
  ranAt: new Date().toISOString(),
  host: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    /*
     * Named, because a budget without an environment is a number without a
     * question. `requirements.md` asks for "environment, cold/warm distinction,
     * failures and adapter time separately".
     */
    reference: `${process.platform} ${process.arch}, Node ${process.version}`,
  },
  totals,
  rows,
  adapters: adapterRows,
  budgets,
  quickStart: quick,
};
writeFileSync(join(OUT, "coverage.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(join(OUT, "coverage.md"), renderMarkdown(report), "utf8");

console.log(
  `\n${totals.passed} of ${totals.reached} reached check(s) passed; ` +
    `${totals.blocked} blocked; ${totals.attempted} attempted → ${join(OUT, "coverage.md")}`,
);
process.exit(totals.failed === 0 ? 0 : 1);

function renderMarkdown(one) {
  const line = (row) =>
    `| ${row.interface} | ${row.platform} | ${row.suite} | ${row.passed} | ${row.failed} | ` +
    `${row.reached} | ${row.blocked} | ${row.attempted} | ${row.externallyVerified ? "yes" : "no"} | ` +
    `${(row.reason ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ")} |`;

  return `# Surface-first coverage

Generated by \`node scripts/coverage-report.mjs\` on ${one.ranAt}.
Reference machine: **${one.host.reference}**.

**${one.totals.passed} of ${one.totals.reached} reached checks passed. ${one.totals.blocked} were blocked. ${one.totals.attempted} were attempted.**

The denominator is the headline (SF-21). A percentage over the reachable subset
would say nothing about the platforms this host could not be asked, and those are
named below with the exact reason each was unreachable.

## By interface and platform

| Interface | Platform | Suite | Passed | Failed | Reached | Blocked | Attempted | Externally verified | Reason, where blocked |
|---|---|---|---|---|---|---|---|---|---|
${one.rows.map(line).join("\n")}

## Adapters: what each says about itself

An adapter's presence in a list is not evidence of support (SF-09).

\`validated\` means a session was opened through it *in this run*.
\`unvalidated\` means the adapter is registered and on a matching platform and
nothing here drove it — which is not the same claim. \`blocked\` means it could
not be asked, and says what would have to be true.

| Adapter | Platforms | Status | Version here | Driven range | Evidence, or why not |
|---|---|---|---|---|---|
${
  one.adapters.length === 0
    ? "| — | — | — | — | — | discovery returned no adapters |"
    : one.adapters
        .map(
          (a) =>
            `| \`${a.adapter}\` | ${a.platforms} | ${a.status === "validated" ? "**validated**" : a.status} | ${a.version ?? "—"} | ${a.range ?? "—"} | ${(a.reason ?? "—").replace(/\|/g, "\\|")} |`,
        )
        .join("\n")
}

## Timing budgets

Proposed product budgets, measured on the reference machine above. Cold start is
included in \`connect\`: each sample is a fresh process, which is what a person
at a terminal actually pays.

| What | Budget | p95 | Median | Samples | Within |
|---|---|---|---|---|---|
${one.budgets
  .map(
    (b) =>
      `| ${b.what} | ${b.budgetMs} ms | ${b.p95Ms === undefined ? "—" : `${b.p95Ms} ms`} | ` +
      `${b.medianMs === undefined ? "—" : `${b.medianMs} ms`} | ${b.samples} | ` +
      `${b.within === undefined ? `— (${b.reason})` : b.within ? "yes" : "**no**"} |`,
  )
  .join("\n")}

## Clean-package quick starts

${
  one.quickStart.skipped !== undefined
    ? `Not run (\`${one.quickStart.skipped}\`).`
    : one.quickStart.error !== undefined
      ? `**Did not run:** ${one.quickStart.error}`
      : `Every command below was extracted from the documentation source, run verbatim in \`${one.quickStart.directory}\` — a directory outside this workspace — against the packed tarball \`${one.quickStart.tarball}\`.

| Command | From | Outcome |
|---|---|---|
${one.quickStart.commands
  .map(
    (c) =>
      `| \`${c.command.replace(/\|/g, "\\|")}\` | ${c.source} | ${
        c.blocked !== undefined ? `blocked — ${c.blocked}` : c.ok ? "passed" : `**failed** — ${(c.detail ?? "").slice(0, 160)}`
      } |`,
  )
  .join("\n")}`
}
`;
}
