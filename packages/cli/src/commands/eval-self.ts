/**
 * `yam eval self` — the two-sided parity gate (T11.5, REQ-SELF-2, REQ-SELF-3,
 * LLD §13.9, §15).
 *
 * > `yam eval self [--report reports/self-parity.md]` runs both sides of
 * > every check and compares verdicts per check: agreement (both pass or both
 * > fail the same way), disagreement (one passes, the other fails), one-sided
 * > (one side unreachable). The report publishes agreement over the checks both
 * > sides reach, each side's coverage, wall time per side, and every
 * > disagreement and one-sided check by id. **The gate passes only at 100
 * > percent agreement**; a disagreement means one oracle is wrong and is a
 * > finding that names both pieces of evidence.
 *
 * ## Why the runners are per *source*, not per check
 *
 * A check's external side is a Playwright case, a vitest case, a script's exit
 * code. Running the suite that holds it once per check would run the app's
 * Playwright suite thirty-eight times. So each **source** runs once and answers
 * with a map of name → verdict, and the catalogue says which name belongs to
 * which check. The same for the Yam side: one `yam run` per project, and
 * a story name per check.
 *
 * That also means a source that cannot run at all — no macOS, no packaged app,
 * a locked display — makes every check it carries `unreachable` *with the same
 * reason*, which is exactly what the one-sided list is for.
 *
 * ## What is deliberately not compared
 *
 * REQ-SELF-3's three oracles stay external by design and the report names them:
 * the healing eval's ground-truth keys, axe-core on the component sheet, and the
 * renderer-versus-adapter tree agreement. They sit *below* the surface Yam
 * drives, and they are what keeps the gate from grading its own homework.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parse as parseYaml } from "yaml";
import { boolOption, stringOption, EXIT, type CommandIo, type ExitCode, type ParsedArgs } from "@svatah/yam-bindings-cli";

/* ── the catalogue ────────────────────────────────────────────────────────── */

/** One side's answer about one check. */
export type Verdict = "pass" | "fail" | "unreachable";

export interface SideResult {
  readonly verdict: Verdict;
  /** What the side saw: a failure message, or why it could not look. */
  readonly evidence: string;
}

/** How a side of a check is run, and what name identifies it in that source. */
export interface SideSpec {
  /** The source that answers for this side; a key of `SOURCES` below. */
  readonly source: string;
  /** The name this check has within that source: a story, a test title. */
  readonly name?: string;
  /** The project a `yam` source runs, relative to the catalogue. */
  readonly project?: string;
  /** Why there is no implementation on this side at all. */
  readonly unreachable?: string;
}

export interface Check {
  readonly id: string;
  readonly says: string;
  readonly yam?: SideSpec;
  readonly external?: SideSpec;
  /** REQ-SELF-3: an oracle that stays external on purpose, and why. */
  readonly externalByDesign?: string;
}

export interface Catalogue {
  readonly checks: readonly Check[];
}

/* ── the sources ──────────────────────────────────────────────────────────── */

/** What a source answered: name → verdict, plus why the source itself failed. */
interface SourceAnswers {
  readonly byName: Map<string, SideResult>;
  /** Set when the source could not run at all; every check it holds is this. */
  readonly unreachable?: string;
  readonly wallMs: number;
  readonly command: string;
}

interface SourceSpec {
  /** What it is, for the report. */
  readonly what: string;
  run(context: RunContext): SourceAnswers;
}

interface RunContext {
  readonly root: string;
  readonly catalogueDir: string;
  readonly projects: readonly string[];
  readonly io: CommandIo;
}

const ok = (evidence: string): SideResult => ({ verdict: "pass", evidence });
const no = (evidence: string): SideResult => ({ verdict: "fail", evidence });
const cannot = (evidence: string): SideResult => ({ verdict: "unreachable", evidence });

/**
 * The failures that are the *host's*, not the check's (P10-F1, P10-F5).
 *
 * A locked display makes macOS answer `AXWindows` with the application element
 * for every application on the machine, so every desktop step fails — and a
 * gate that recorded that as `fail` would publish a disagreement with an
 * external oracle that had just passed, and name a cause where the honest
 * answer is "could not tell". These are the sentences the adapter and
 * `surface doctor` already write when the host is what stopped them; a step
 * that carries one is `unreachable`, with the doctor's own line as the reason.
 */
const HOST_STOPPED_IT: readonly string[] = [
  "CGSSessionScreenIsLocked",
  "no login session",
  "ax/accessibility",
];

/** The marker in a failure message, when the host is what stopped the step. */
function hostStoppedIt(message: string): string | undefined {
  return HOST_STOPPED_IT.find((marker) => message.includes(marker));
}

/** Run a command, and say how long it took. */
function shell(
  command: string,
  args: readonly string[],
  options: { cwd: string; env?: Record<string, string> },
): { status: number | null; stdout: string; stderr: string; wallMs: number; line: string } {
  const startedAt = Date.now();
  const ran = spawnSync(command, [...args], {
    encoding: "utf8",
    cwd: options.cwd,
    maxBuffer: 128 * 1024 * 1024,
    env: { ...process.env, ...(options.env ?? {}) },
  });
  return {
    status: ran.status,
    stdout: ran.stdout ?? "",
    stderr: ran.stderr ?? "",
    wallMs: Date.now() - startedAt,
    line: [command, ...args].map((word) => readable(word, options.cwd)).join(" "),
  };
}

/**
 * The command as a verifier would type it: this host's Node is `node`, and a
 * path inside the checkout is written relative to it. The report is a document
 * somebody re-runs, so an absolute path from the machine that wrote it is a
 * command nobody else can run.
 */
function readable(word: string, cwd: string): string {
  if (word === process.execPath) return "node";
  const root = cwd.endsWith("/") ? cwd : `${cwd}/`;
  return word.startsWith(root) ? word.slice(root.length) : word;
}

/**
 * A `yam run` of one self project, mapped story → verdict.
 *
 * The run's own artifacts are the evidence: `results.jsonl` carries a line per
 * step with its status and its failure, which is the same file a person reads
 * after a red run. Nothing is re-derived.
 */
function yamSource(project: string, options: { attach?: boolean } = {}): SourceSpec {
  return {
    what: `yam run ${project}`,
    run({ root, catalogueDir, io }): SourceAnswers {
      const directory = resolve(catalogueDir, project);
      const cli = join(root, "packages", "cli", "dist", "bin.js");
      if (!existsSync(join(directory, "yam.config.yaml"))) {
        return {
          byName: new Map(),
          unreachable: `no project at ${directory}`,
          wallMs: 0,
          command: `yam run ${project}`,
        };
      }
      /*
       * The attaching side needs something to attach to (T11.5).
       *
       * `evals/self/cdp` drives the app's *renderer* over CDP, and a renderer
       * has a DevTools endpoint only when the application was started with
       * one. The AX side launches its own APP_DIR through `app.launch`; this side
       * deliberately does not — a session that launched its own would be
       * reading a different application from the one the other side read,
       * which is the one thing a parity gate must not do. So the gate starts
       * one, points `YAM_CDP_URL` at it, and stops it afterwards.
       */
      const desktopApp = options.attach === true ? startAppWithDebugging(root, io) : undefined;
      if (desktopApp?.error !== undefined) {
        return {
          byName: new Map(),
          unreachable: desktopApp.error,
          wallMs: 0,
          command: `yam run ${project}`,
        };
      }

      io.err(`  running ${project}…`);
      const ran = shell(process.execPath, [cli, "run", directory, "--host", "none"], {
        cwd: root,
        ...(desktopApp?.url === undefined ? {} : { env: { YAM_CDP_URL: desktopApp.url } }),
      });
      desktopApp?.stop();

      const runs = join(directory, "runs");
      const latest = existsSync(runs)
        ? readdirSync(runs)
            .sort()
            .at(-1)
        : undefined;
      const byName = new Map<string, SideResult>();
      if (latest === undefined) {
        return {
          byName,
          unreachable:
            `\`yam run ${project}\` wrote no run directory (exit ${ran.status ?? "none"}): ` +
            `${(ran.stderr || ran.stdout).trim().split("\n").slice(-3).join(" ")}`,
          wallMs: ran.wallMs,
          command: ran.line,
        };
      }

      const results = join(runs, latest, "results.jsonl");
      const lines = existsSync(results)
        ? readFileSync(results, "utf8").split("\n").filter((one) => one.trim() !== "")
        : [];
      /*
       * A story passes when every one of its steps did. A skipped step follows
       * a failed one, so it is not a verdict of its own — the story's verdict is
       * the first thing that went wrong in it.
       */
      for (const line of lines) {
        const step = JSON.parse(line) as {
          story?: string;
          status?: string;
          failure?: { message?: string };
          step?: { text?: string };
        };
        const story = step.story ?? "";
        if (story === "") continue;
        const already = byName.get(story);
        if (step.status === "failed" || step.status === "aborted") {
          if (already?.verdict !== "fail" && already?.verdict !== "unreachable") {
            const message = step.failure?.message ?? "failed";
            const evidence = `${step.step?.text ?? "a step"}: ${message}`
              .split("\n")[0]!
              .slice(0, 300);
            byName.set(story, hostStoppedIt(message) === undefined ? no(evidence) : cannot(evidence));
          }
          continue;
        }
        if (already === undefined) byName.set(story, ok(`every step passed`));
      }
      return { byName, wallMs: ran.wallMs, command: ran.line };
    },
  };
}

/**
 * A packaged app with a DevTools endpoint, for the attaching side (T11.5).
 *
 * Through `open` on macOS, because a GUI application forked from a process that
 * is not in the user's Aqua session never attaches to the WindowServer
 * (LLD §7.5) — and the point of this side is to drive the *same* application
 * the accessibility side drives, window and all.
 */
function startAppWithDebugging(
  root: string,
  io: CommandIo,
): { url?: string; error?: string; stop: () => void } {
  const bundle = join(root, "apps", "desktop", "out", "Yam-darwin-arm64", "Yam.app");
  const executable = join(bundle, "Contents", "MacOS", "Yam");
  const noop = { stop: () => undefined };
  if (process.platform !== "darwin") {
    return { ...noop, error: "attaching to the app's renderer needs the packaged macOS build" };
  }
  if (!existsSync(executable)) {
    return {
      ...noop,
      error: `the app is not packaged (${executable}); run \`pnpm --filter @svatah/yam-desktop package\``,
    };
  }

  const alive = (): string[] =>
    (spawnSync("pgrep", ["-f", executable], { encoding: "utf8" }).stdout ?? "")
      .split("\n")
      .filter((one) => one.trim() !== "");
  const stop = (): void => {
    if (alive().length === 0) return;
    spawnSync("osascript", ["-e", 'tell application id "com.electron.yam" to quit'], {
      encoding: "utf8",
    });
    for (let waited = 0; waited < 20_000 && alive().length > 0; waited += 250) {
      spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 250)"]);
    }
    if (alive().length > 0) spawnSync("pkill", ["-f", executable], { encoding: "utf8" });
  };

  stop();
  const port = 9400 + Math.floor(Math.random() * 90);
  const open = ["-n", "-F"];
  /*
   * The *same* environment the accessibility side's `app.launch` gives it, and
   * `YAM_APP_PROJECT` is deliberately not in it (T11.5).
   *
   * That variable opens a project *for* the app on ready, so the welcome screen
   * never appears — and the self flows open the fixtures project through the
   * Recent list, which is the gesture T11.2's Validate names. Two sides looking
   * at applications that started differently is the one thing a parity gate
   * must not do. `node scripts/seed-app-recents.mjs` is what puts the project
   * in that list.
   */
  for (const [name, value] of Object.entries({
    YAM_A11Y: "1",
    YAM_APP_DEBUG: "1",
    YAM_CLI: join(root, "packages", "cli", "dist", "bin.js"),
  })) {
    open.push("--env", `${name}=${value}`);
  }
  open.push("-a", bundle, "--args", `--remote-debugging-port=${port}`);
  if (spawnSync("open", open, { encoding: "utf8" }).status !== 0) {
    return { ...noop, error: `\`open\` refused to launch ${bundle}` };
  }
  io.err(`  started the app with a DevTools endpoint on ${port}…`);

  const url = `http://127.0.0.1:${port}`;
  for (let waited = 0; waited < 60_000; waited += 500) {
    const asked = spawnSync("curl", ["-sf", `${url}/json/version`], { encoding: "utf8" });
    if (asked.status === 0) return { url, stop };
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 500)"]);
  }
  stop();
  return { ...noop, error: `the app published no DevTools endpoint on ${port} within 60 s` };
}

/** Playwright's JSON reporter, mapped test title → verdict. */
function playwrightSource(packageDir: string, what: string): SourceSpec {
  return {
    what,
    run({ root, io }): SourceAnswers {
      const cwd = join(root, packageDir);
      io.err(`  running ${what}…`);
      const ran = shell(
        "npx",
        ["playwright", "test", "--reporter=json"],
        { cwd, env: { PLAYWRIGHT_JSON_OUTPUT_NAME: "" } },
      );
      const byName = new Map<string, SideResult>();
      let report: unknown;
      try {
        report = JSON.parse(ran.stdout.slice(ran.stdout.indexOf("{")));
      } catch {
        return {
          byName,
          unreachable:
            `${what} produced no JSON report (exit ${ran.status ?? "none"}): ` +
            `${(ran.stderr || ran.stdout).trim().split("\n").slice(-3).join(" ")}`,
          wallMs: ran.wallMs,
          command: ran.line,
        };
      }
      walkPlaywright(report, byName);
      return { byName, wallMs: ran.wallMs, command: ran.line };
    },
  };
}

/** Playwright's report is suites within suites; every spec is a leaf. */
function walkPlaywright(node: unknown, into: Map<string, SideResult>): void {
  if (typeof node !== "object" || node === null) return;
  const one = node as Record<string, unknown>;
  for (const suite of (one["suites"] as unknown[]) ?? []) walkPlaywright(suite, into);
  for (const spec of (one["specs"] as unknown[]) ?? []) {
    const it = spec as { title?: string; ok?: boolean; tests?: Array<{ results?: Array<{ error?: { message?: string } }> }> };
    const title = it.title ?? "";
    if (title === "") continue;
    const error = it.tests?.[0]?.results?.[0]?.error?.message ?? "";
    into.set(
      title,
      it.ok === true ? ok("the case passed") : no(error.split("\n")[0]?.slice(0, 300) ?? "failed"),
    );
  }
}

/**
 * Every name a catalogue may call one vitest case by (P11-F2).
 *
 * The catalogue writes a nested case the way a reader writes one — its
 * ancestors and its own title, joined by `>`:
 *
 *   `yam ui` draws in a pseudo-terminal (T9.4) > opens on the `comp` run …
 *
 * Vitest's JSON reporter does *not*: `fullName` is those same parts joined by a
 * space, and the gate matched on that string alone. Two checks therefore found
 * nothing, and the report called them "neither side could look" — a shortcoming
 * of Yam's, when the external side had run and passed (the Phase 11
 * verification, F2). LLD §13.9: "the catalogue names an external case by its
 * ancestor titles and its title, and the runner matches on those rather than on
 * a joined string."
 *
 * So the parts are what is matched, and this builds every spelling of them a
 * catalogue might reasonably use: the `>` form, the reporter's own `fullName`,
 * and the bare title for a case with no ancestors. `vitestCaseNames` is exported
 * because the catalogue test asserts the catalogue's names against exactly
 * these — a rule written twice is a rule that drifts.
 */
export function vitestCaseNames(one: {
  ancestorTitles?: readonly string[];
  fullName?: string;
  title?: string;
}): string[] {
  const parts = [...(one.ancestorTitles ?? []), one.title ?? ""].filter((part) => part !== "");
  const names = new Set<string>();
  if (parts.length > 0) names.add(parts.join(" > "));
  if (one.fullName !== undefined && one.fullName !== "") names.add(one.fullName);
  if (one.title !== undefined && one.title !== "") names.add(one.title);
  return [...names];
}

/** Vitest's JSON reporter, mapped case name → verdict. */
function vitestSource(packageDir: string, files: readonly string[], what: string): SourceSpec {
  return {
    what,
    run({ root, io }): SourceAnswers {
      const cwd = join(root, packageDir);
      io.err(`  running ${what}…`);
      const ran = shell("npx", ["vitest", "run", ...files, "--reporter=json"], { cwd });
      const byName = new Map<string, SideResult>();
      let report: { testResults?: Array<{ assertionResults?: Array<{ ancestorTitles?: string[]; fullName?: string; title?: string; status?: string; failureMessages?: string[] }> }> };
      try {
        report = JSON.parse(ran.stdout.slice(ran.stdout.indexOf("{"))) as typeof report;
      } catch {
        return {
          byName,
          unreachable:
            `${what} produced no JSON report (exit ${ran.status ?? "none"}): ` +
            `${(ran.stderr || ran.stdout).trim().split("\n").slice(-3).join(" ")}`,
          wallMs: ran.wallMs,
          command: ran.line,
        };
      }
      for (const file of report.testResults ?? []) {
        for (const one of file.assertionResults ?? []) {
          const names = vitestCaseNames(one);
          if (names.length === 0) continue;
          const result =
            one.status === "passed"
              ? ok("the case passed")
              : one.status === "skipped" || one.status === "pending"
                ? { verdict: "unreachable" as const, evidence: "the case was skipped" }
                : no((one.failureMessages?.[0] ?? "failed").split("\n")[0]!.slice(0, 300));
          for (const name of names) byName.set(name, result);
        }
      }
      return { byName, wallMs: ran.wallMs, command: ran.line };
    },
  };
}

/**
 * A command whose exit code is the verdict, for one named check.
 *
 * `0` passes, `2` is *unreachable* — the convention every host-dependent script
 * in this repository already uses (`surface doctor`, the desktop gate) — and
 * anything else fails. A script that cannot run is not a script that failed,
 * and the difference is the whole of the one-sided list.
 */
function commandSource(
  name: string,
  command: string,
  args: readonly string[],
  what: string,
): SourceSpec {
  return {
    what,
    run({ root, io }): SourceAnswers {
      io.err(`  running ${what}…`);
      const ran = shell(command === "node" ? process.execPath : command, args, { cwd: root });
      const tail = `${ran.stdout}${ran.stderr}`.trim().split("\n").slice(-4).join(" ").slice(0, 400);
      const byName = new Map<string, SideResult>();
      byName.set(
        name,
        ran.status === 0
          ? ok(tail || "exit 0")
          : ran.status === 2
            ? { verdict: "unreachable", evidence: tail || "exit 2 — the host is not ready" }
            : no(tail || `exit ${ran.status ?? "none"}`),
      );
      return { byName, wallMs: ran.wallMs, command: ran.line };
    },
  };
}

/* ── the command ──────────────────────────────────────────────────────────── */

interface Compared {
  readonly check: Check;
  readonly yam: SideResult;
  readonly external: SideResult;
  readonly outcome: "agree" | "disagree" | "one-sided" | "neither";
}


/**
 * The source a side needs, including the project it names (T11.5).
 *
 * `yam` runs `evals/self`, and a catalogue may point one check at a
 * *different* project — a copy with something deliberately broken in it, which
 * is how `scripts/self-parity-bite.mjs` shows the gate biting. So the key is
 * the source and the project together, and two checks over two projects run two
 * `yam run`s rather than sharing one.
 */
function sourceKeyFor(spec: SideSpec): string {
  return spec.project === undefined ? spec.source : `${spec.source}:${spec.project}`;
}

export async function evalSelfCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = repositoryRoot();
  const cataloguePath = resolve(
    stringOption(args, "catalogue") ?? join(root, "evals", "self", "checks.yaml"),
  );
  if (!existsSync(cataloguePath)) {
    io.err(`No check catalogue at ${cataloguePath}. LLD §13.9 puts it at evals/self/checks.yaml.`);
    return EXIT.usage;
  }

  const catalogue = parseYaml(readFileSync(cataloguePath, "utf8")) as Catalogue;
  /*
   * Where the reports go (P11-F3).
   *
   *   yam eval self                 # a temporary directory, and it says where
   *   yam eval self --update        # the committed set under reports/
   *   yam eval self --report <path> # this report there; the sources' still outside
   *
   * Two of the gate's sources write a *committed* report as a side effect of
   * answering: the healing eval writes `reports/eval-healing.md` and the
   * desktop gate writes `reports/adapter-ax.md`. So a clean checkout was dirty
   * after running the contract's own gate, and a verifier reading `git status`
   * had to work out whether two modified files were a change or an echo (the
   * Phase 11 verification, F3). This is the rule `app:shoot` already follows:
   * committed artefacts are refreshed when somebody asks for that, and a run
   * that only wants an answer leaves the tree alone.
   */
  const update = boolOption(args, "update");
  const reportsDir = update
    ? join(root, "reports")
    : mkdtempSync(join(tmpdir(), "yam-self-parity-"));
  const only = stringOption(args, "only");
  const side = stringOption(args, "side");
  const checks = catalogue.checks.filter((one) => only === undefined || one.id === only);
  if (checks.length === 0) {
    io.err(`No check matches --only ${only ?? ""}.`);
    return EXIT.usage;
  }

  const context: RunContext = {
    root,
    catalogueDir: dirname(cataloguePath),
    projects: [],
    io,
  };

  /* Which sources are actually needed, so nothing runs for nothing. */
  const wanted = new Set<string>();
  for (const check of checks) {
    if (side !== "external" && check.yam?.source !== undefined) {
      wanted.add(sourceKeyFor(check.yam));
    }
    if (side !== "yam" && check.external?.source !== undefined) {
      wanted.add(sourceKeyFor(check.external));
    }
  }

  const answers = new Map<string, SourceAnswers>();
  const sources = sourcesFor(catalogue, reportsDir);
  for (const name of [...wanted].sort()) {
    /*
     * `yam:<project>` is a `yam` run of a project the catalogue named;
     * anything else is a source by name.
     */
    const [base, project] = name.includes(":") ? name.split(":") : [name, undefined];
    const source =
      project === undefined
        ? sources[base!]
        : base === "yam"
          ? yamSource(project)
          : base === "yam-cdp"
            ? yamSource(project, { attach: true })
            : undefined;
    if (source === undefined) {
      answers.set(name, {
        byName: new Map(),
        unreachable: `no source named "${name}" — the catalogue and the gate disagree`,
        wallMs: 0,
        command: "(none)",
      });
      continue;
    }
    answers.set(name, source.run(context));
  }

  const verdictFor = (spec: SideSpec | undefined): SideResult => {
    if (spec === undefined) {
      return { verdict: "unreachable", evidence: "this check has no implementation on this side" };
    }
    if (spec.unreachable !== undefined) {
      return { verdict: "unreachable", evidence: spec.unreachable };
    }
    const source = answers.get(sourceKeyFor(spec));
    if (source === undefined) {
      return { verdict: "unreachable", evidence: `the "${spec.source}" source did not run` };
    }
    if (source.unreachable !== undefined) {
      return { verdict: "unreachable", evidence: source.unreachable };
    }
    const found = spec.name === undefined ? undefined : source.byName.get(spec.name);
    if (found === undefined) {
      return {
        verdict: "unreachable",
        evidence:
          `"${spec.name ?? "(unnamed)"}" is not in what \`${source.command}\` reported — ` +
          "the catalogue names something the source does not have",
      };
    }
    return found;
  };

  const compared: Compared[] = checks.map((check) => {
    const yam =
      side === "external"
        ? { verdict: "unreachable" as const, evidence: "--side external" }
        : verdictFor(check.yam);
    const external =
      side === "yam"
        ? { verdict: "unreachable" as const, evidence: "--side yam" }
        : verdictFor(check.external);
    const outcome =
      yam.verdict === "unreachable" && external.verdict === "unreachable"
        ? "neither"
        : yam.verdict === "unreachable" || external.verdict === "unreachable"
          ? "one-sided"
          : yam.verdict === external.verdict
            ? "agree"
            : "disagree";
    return { check, yam, external, outcome };
  });

  const both = compared.filter((one) => one.outcome === "agree" || one.outcome === "disagree");
  const disagreements = compared.filter((one) => one.outcome === "disagree");
  const agreement = both.length === 0 ? 1 : (both.length - disagreements.length) / both.length;

  const reportPath = resolve(stringOption(args, "report") ?? join(reportsDir, "self-parity.md"));
  const report = renderReport({ catalogue, compared, answers, agreement, side });
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, report, "utf8");

  if (boolOption(args, "json")) {
    io.out(
      `${JSON.stringify(
        {
          agreement,
          checks: compared.map((one) => ({
            id: one.check.id,
            outcome: one.outcome,
            yam: one.yam,
            external: one.external,
          })),
        },
        null,
        2,
      )}\n`,
    );
  }

  io.err(
    `\nwrote ${reportPath}\n` +
      (update
        ? ""
        : `the sources' own reports are under ${reportsDir} ` +
          "(pass --update to refresh the committed set)\n"),
  );
  io.out(
    disagreements.length === 0
      ? `self parity: ${Math.round(agreement * 100)}% agreement over ${both.length} check(s) ` +
          `both sides reached; ${compared.filter((one) => one.outcome === "one-sided").length} ` +
          `one-sided → ${reportPath}\n`
      : `self parity: ${disagreements.length} disagreement(s) — ` +
          `${disagreements.map((one) => one.check.id).join(", ")} → ${reportPath}\n`,
  );
  return disagreements.length === 0 ? EXIT.ok : EXIT.failed;
}

/* ── where the sources come from ──────────────────────────────────────────── */

function sourcesFor(catalogue: Catalogue, reportsDir: string): Record<string, SourceSpec> {
  const projects = new Set<string>();
  for (const check of catalogue.checks) {
    if (check.yam?.source === "yam" || check.yam?.source === "yam-cdp") {
      projects.add(check.yam.project ?? ".");
    }
  }
  void projects;
  return {
    /** The AX side: `evals/self` driven through the desktop adapter. */
    yam: yamSource("."),
    /** The same flows through the Playwright adapter attached over CDP. */
    "yam-cdp": yamSource("cdp", { attach: true }),
    /** The app's own Playwright cases, over CDP against the packaged build. */
    "app-playwright": playwrightSource("apps/desktop", "the app's Playwright cases"),
    /** The cockpit in a real pseudo-terminal, and `--json` against the model. */
    "tui-pty": vitestSource(
      "tools/repo-checks",
      ["test/tui-pty.test.ts"],
      "the cockpit's pseudo-terminal cases",
    ),
    /** The sample application's behaviours, through the runtime's own tests. */
    "runtime-behaviours": vitestSource(
      "packages/runtime",
      [],
      "the runtime's behaviour cases",
    ),
    /** The generated clients' smoke, which is the SDK's other two languages. */
    "client-smoke": commandSource(
      "clients",
      "node",
      [join("scripts", "smoke-clients.mjs")],
      "the generated clients' smoke",
    ),
    /** axe-core on the component sheet — external by design (REQ-SELF-3). */
    "axe-sheet": commandSource(
      "sheet",
      "node",
      [join("scripts", "audit-sheet.mjs")],
      "axe-core and the in-house audit on the component sheet",
    ),
    /** The healing eval's ground truth — external by design (REQ-SELF-3). */
    "healing-eval": commandSource(
      "healing",
      "node",
      [join("scripts", "eval-healing.mjs"), "--report", join(reportsDir, "eval-healing.md")],
      "the healing eval against its ground-truth keys",
    ),
    /** The renderer-versus-adapter tree agreement — external by design. */
    "tree-agreement": commandSource(
      "tree",
      "node",
      [join("scripts", "tree-agreement.mjs")],
      "the app's renderer tree over CDP against its AX snapshot",
    ),
    /** The live desktop conformance gate. */
    "desktop-gate": commandSource(
      "gate",
      "node",
      [
        join("scripts", "desktop-conformance.mjs"),
        "--adapter",
        "ax",
        "--report",
        join(reportsDir, "adapter-ax.md"),
      ],
      "the live macOS desktop conformance gate",
    ),
    /** The artboards, read as designs. */
    // The front door (T14.6, REQ-CLI-1, 3, 8): Yam's side runs the built
    // binary as a newcomer would; the external side is the command line's own
    // cases, which compare the words with the design document.
    "front-door-status": commandSource("status", "node", [join("scripts", "front-door-self.mjs"), "status"], "`yam` with no arguments, on a fresh project"),
    "front-door-check": commandSource("check", "node", [join("scripts", "front-door-self.mjs"), "check"], "`yam check`, and the plan it writes"),
    "front-door-help": commandSource("help", "node", [join("scripts", "front-door-self.mjs"), "help"], "`yam help exit-codes` and the top-level help"),
    "front-door-explore": commandSource("explore", "node", [join("scripts", "front-door-self.mjs"), "explore"], "an exploration through `yam explore` becomes a proposal"),
    "cli-vitest": vitestSource(
      "packages/cli",
      ["test/front-door.test.ts", "test/check.test.ts", "test/help.test.ts", "test/explore.test.ts"],
      "the command line's own front-door cases",
    ),
    artboards: commandSource(
      "artboards",
      "node",
      [join("scripts", "audit-artboards.mjs")],
      "the artboards measured against their own layout rules",
    ),
  };
}

/** The repository this build came from, found from the built file's own path. */
function repositoryRoot(): string {
  let at = dirname(new URL(import.meta.url).pathname);
  for (let up = 0; up < 8; up += 1) {
    if (existsSync(join(at, "pnpm-workspace.yaml"))) return at;
    at = dirname(at);
  }
  return process.cwd();
}

/* ── the report ───────────────────────────────────────────────────────────── */

function renderReport(input: {
  catalogue: Catalogue;
  compared: readonly Compared[];
  answers: Map<string, SourceAnswers>;
  agreement: number;
  side?: string;
}): string {
  const { compared, answers, agreement } = input;
  const both = compared.filter((one) => one.outcome === "agree" || one.outcome === "disagree");
  const disagreements = compared.filter((one) => one.outcome === "disagree");
  const oneSided = compared.filter((one) => one.outcome === "one-sided");
  const neither = compared.filter((one) => one.outcome === "neither");

  const reached = (pick: (one: Compared) => SideResult): number =>
    compared.filter((one) => pick(one).verdict !== "unreachable").length;

  const wall = (which: (name: string) => boolean): number => {
    let total = 0;
    for (const [name, source] of answers) if (which(name)) total += source.wallMs;
    return total;
  };
  const yamSources = (name: string): boolean => name.startsWith("yam");
  const seconds = (ms: number): string => `${(ms / 1000).toFixed(1)} s`;

  const rows = (list: readonly Compared[]): string[] =>
    list.map(
      (one) =>
        `| \`${one.check.id}\` | ${one.yam.verdict} | ${one.external.verdict} | ` +
        `${one.check.says.replace(/\|/g, "\\|")} |`,
    );

  return [
    "# Yam verifies Yam — the parity gate",
    "",
    `Run at ${new Date().toISOString()} on ${process.platform} ${process.arch}, Node ${process.version}.`,
    "",
    disagreements.length === 0
      ? `**${Math.round(agreement * 100)} percent agreement** over the ${both.length} check(s) ` +
        "both sides reached. The gate passes only at 100 percent (REQ-SELF-2)."
      : `**Not conformant.** ${disagreements.length} disagreement(s) over the ${both.length} ` +
        "check(s) both sides reached. A disagreement means one oracle is wrong.",
    "",
    "| | Yam | External |",
    "|---|---|---|",
    `| Checks reached | ${reached((one) => one.yam)} of ${compared.length} | ` +
      `${reached((one) => one.external)} of ${compared.length} |`,
    `| Wall time | ${seconds(wall(yamSources))} | ${seconds(wall((n) => !yamSources(n)))} |`,
    "",
    "## Disagreements",
    "",
    disagreements.length === 0
      ? "None. Every check both sides reached, they answered the same way."
      : [
          "| Check | Yam says | External says |",
          "|---|---|---|",
          ...disagreements.map(
            (one) =>
              `| \`${one.check.id}\` | ${one.yam.verdict}: ${one.yam.evidence.replace(/\|/g, "\\|")} ` +
              `| ${one.external.verdict}: ${one.external.evidence.replace(/\|/g, "\\|")} |`,
          ),
        ].join("\n"),
    "",
    "## One-sided checks — Yam's own shortcomings",
    "",
    "Every one names the adapter or the step Yam lacks, and the list is",
    "expected to shrink phase by phase (LLD §13.9). A row whose reason is the",
    "*host* — a locked display, a refused permission — is not a shortcoming of",
    "either side: it is what this machine could not be asked, said in the",
    "doctor's own words rather than guessed at (P10-F1, P10-F5).",
    "",
    oneSided.length === 0
      ? "None: both sides reach every check."
      : [
          "| Check | Reached by | Why the other side does not |",
          "|---|---|---|",
          ...oneSided.map((one) => {
            const missing = one.yam.verdict === "unreachable" ? one.yam : one.external;
            const has = one.yam.verdict === "unreachable" ? "external" : "Yam";
            return `| \`${one.check.id}\` | ${has} | ${missing.evidence.replace(/\|/g, "\\|")} |`;
          }),
        ].join("\n"),
    "",
    ...(neither.length === 0
      ? []
      : [
          "## Neither side could look",
          "",
          "| Check | Yam | External |",
          "|---|---|---|",
          ...neither.map(
            (one) =>
              `| \`${one.check.id}\` | ${one.yam.evidence.replace(/\|/g, "\\|")} | ` +
              `${one.external.evidence.replace(/\|/g, "\\|")} |`,
          ),
          "",
        ]),
    "## Kept external by design (REQ-SELF-3)",
    "",
    "Three oracles sit *below* the surface Yam drives, and they are what keeps",
    "this gate from grading its own homework.",
    "",
    "| Oracle | Why it stays external |",
    "|---|---|",
    ...compared
      .filter((one) => one.check.externalByDesign !== undefined)
      .map((one) => `| \`${one.check.id}\` | ${one.check.externalByDesign!.replace(/\|/g, "\\|")} |`),
    "",
    "## Every check",
    "",
    "| Check | Yam | External | What it says |",
    "|---|---|---|---|",
    ...rows(compared),
    "",
    "## The sources, and what each cost",
    "",
    "| Source | Command | Wall | Answered about |",
    "|---|---|---|---|",
    ...[...answers.entries()].map(
      ([name, source]) =>
        `| \`${name}\` | \`${source.command.replace(/\|/g, "\\|")}\` | ${seconds(source.wallMs)} | ` +
        `${source.unreachable === undefined ? `${source.byName.size} name(s)` : `unreachable — ${source.unreachable.replace(/\|/g, "\\|")}`} |`,
    ),
    "",
  ].join("\n");
}
