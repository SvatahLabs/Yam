/**
 * The front door (T14.1, REQ-CLI-1, LLD §15.1).
 *
 * `yam` with no arguments answers two questions a newcomer has and the usage
 * text never did: where am I, and what do I do next. The state is five facts
 * derived from what exists on disk, and the next verb is a pure function of
 * them, in the order §15.1 lists. Reporting a state is never a failure, so the
 * exit code is 0 in every case.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { boolOption, CONFIG_FILES, EXIT, type CommandIo, type ExitCode, type ParsedArgs } from "@svatah/yam-bindings-cli";
import { readBindingIndex } from "@svatah/yam-bindings";
import type { Plan, Summary } from "@svatah/yam-schema";
import { loadProject, type LoadedProject } from "./project.js";

/** The project directory: the nearest ancestor of `dir` with a config file, or undefined. */
export function findProjectRoot(dir: string): string | undefined {
  let current = resolve(dir);
  for (;;) {
    if (CONFIG_FILES.some((name) => existsSync(join(current, name)))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/** Every file under `dir`, relative to `base`, sorted, or nothing when `dir` is absent. */
function filesUnder(dir: string, base: string): string[] {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isDirectory()) walk(path);
      else out.push(relative(base, path).split(sep).join("/"));
    }
  };
  walk(dir);
  return out.sort();
}

/**
 * The hash of everything the plan is compiled from: the flows, the data file,
 * the API requests, the custom steps and the config. A plan whose recorded
 * input hash differs from this one is stale.
 */
export function inputHash(loaded: LoadedProject): string {
  const root = loaded.root;
  const config = CONFIG_FILES.map((name) => join(root, name)).find((file) => existsSync(file));
  const paths = [
    ...(config === undefined ? [] : [relative(root, config)]),
    ...filesUnder(join(root, loaded.config.flows.dir), root),
    ...(existsSync(join(root, loaded.config.data.file)) ? [loaded.config.data.file] : []),
    ...filesUnder(join(root, loaded.config.api.dir), root),
    ...filesUnder(join(root, loaded.config.steps.dir), root),
  ];
  const hash = createHash("sha256");
  for (const path of paths) {
    hash.update(path).update("\0").update(readFileSync(join(root, path))).update("\0");
  }
  return hash.digest("hex");
}

/** Where the plan's input hash is kept: beside the plan, because the plan schema is closed (LLD §3.2). */
export function planInputsPath(root: string): string {
  return join(root, ".yam", "plan.inputs.json");
}

/** Record the hash of the inputs a plan was compiled from (T14.2). */
export function writePlanInputs(loaded: LoadedProject): void {
  mkdirSync(join(loaded.root, ".yam"), { recursive: true });
  writeFileSync(
    planInputsPath(loaded.root),
    `${JSON.stringify({ inputHash: inputHash(loaded), at: new Date().toISOString() }, null, 2)}\n`,
    "utf8",
  );
}

/** Where `run` records the run it started (REQ-CLI-6). */
export function lastRunPath(root: string): string {
  return join(root, ".yam", "last-run");
}

export interface LastRunRecord {
  readonly runId: string;
  readonly directory: string;
}

/** `run` writes this on start, so `yam heal` and `yam` can find the run without an id. */
export function writeLastRun(root: string, record: LastRunRecord): void {
  mkdirSync(join(root, ".yam"), { recursive: true });
  writeFileSync(lastRunPath(root), `${JSON.stringify(record, null, 2)}\n`, "utf8");
}

export function readLastRun(root: string): LastRunRecord | undefined {
  const file = lastRunPath(root);
  if (!existsSync(file)) return undefined;
  try {
    const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<LastRunRecord>;
    if (typeof parsed.runId !== "string" || typeof parsed.directory !== "string") return undefined;
    return { runId: parsed.runId, directory: parsed.directory };
  } catch {
    return undefined;
  }
}

/** What a newcomer sees about the last run: the verdict and why. */
export interface LastRunState {
  readonly runId: string;
  readonly verdict: "passed" | "failed" | "healed" | "aborted" | "unknown";
  readonly endedAt?: string;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  /** The first failed step's failure class, when there is one. */
  readonly failureClass?: string;
  /** The first failed step, as the report printed it. */
  readonly failedStep?: string;
}

export interface ProjectState {
  /** Undefined outside a project. */
  readonly project?: { readonly root: string; readonly name: string };
  readonly flows: { readonly files: number; readonly stories: number; readonly errors: number };
  readonly plan: "current" | "stale" | "missing";
  /** Element ids the plan targets that have no binding in the store. */
  readonly unbound: ReadonlyArray<{ readonly id: string; readonly phrase: string }>;
  readonly lastRun?: LastRunState;
  /** Why the project could not be read, when it could not. */
  readonly problem?: string;
}

function verdictOf(summary: Summary): LastRunState["verdict"] {
  switch (summary.exitCode) {
    case EXIT.ok:
      return "passed";
    case EXIT.failed:
      return "failed";
    case EXIT.healed:
      return "healed";
    case EXIT.aborted:
      return "aborted";
    default:
      return "unknown";
  }
}

function lastRunState(root: string): LastRunState | undefined {
  const record = readLastRun(root);
  if (record === undefined) return undefined;
  const directory = resolve(root, record.directory);
  const summaryFile = join(directory, "summary.json");
  if (!existsSync(summaryFile)) return undefined;
  let summary: Summary;
  try {
    summary = JSON.parse(readFileSync(summaryFile, "utf8")) as Summary;
  } catch {
    return undefined;
  }
  const state: { -readonly [K in keyof LastRunState]: LastRunState[K] } = {
    runId: summary.runId,
    verdict: verdictOf(summary),
    endedAt: summary.endedAt,
    passed: summary.totals.passed,
    failed: summary.totals.failed,
    skipped: summary.totals.skipped,
  };
  const resultsFile = join(directory, "results.jsonl");
  if (existsSync(resultsFile)) {
    for (const line of readFileSync(resultsFile, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        const result = JSON.parse(line) as {
          status?: string;
          story?: string;
          text?: string;
          failure?: { class?: string };
        };
        if (result.status === "failed") {
          if (result.failure?.class !== undefined) state.failureClass = result.failure.class;
          state.failedStep = `${result.story ?? ""} · ${result.text ?? ""}`;
          break;
        }
      } catch {
        // A line that does not parse is not the newcomer's problem here.
      }
    }
  }
  return state;
}

/** The five facts of LLD §15.1, from `dir` or the nearest project above it. */
export async function projectState(dir: string): Promise<ProjectState> {
  const root = findProjectRoot(dir);
  if (root === undefined) {
    return { flows: { files: 0, stories: 0, errors: 0 }, plan: "missing", unbound: [] };
  }
  let loaded: LoadedProject;
  try {
    loaded = await loadProject(root);
  } catch (error) {
    return {
      project: { root, name: root.split(sep).pop() ?? root },
      flows: { files: 0, stories: 0, errors: 1 },
      plan: "missing",
      unbound: [],
      problem: error instanceof Error ? error.message : String(error),
    };
  }
  const errors = loaded.diagnostics.filter((d) => d.severity === "error").length;
  const flows = {
    files: loaded.project.flows.length,
    stories: loaded.project.stories.size,
    errors,
  };

  const planFile = join(root, ".yam", "plan.json");
  let plan: ProjectState["plan"] = "missing";
  let unbound: Array<{ id: string; phrase: string }> = [];
  if (existsSync(planFile)) {
    plan = "stale";
    const inputs = planInputsPath(root);
    if (existsSync(inputs)) {
      try {
        const recorded = (JSON.parse(readFileSync(inputs, "utf8")) as { inputHash?: string }).inputHash;
        if (recorded === inputHash(loaded)) plan = "current";
      } catch {
        // An unreadable sidecar is a stale plan.
      }
    }
    try {
      const parsed = JSON.parse(readFileSync(planFile, "utf8")) as Plan;
      const store = join(root, loaded.config.bindings.dir);
      const bound = new Set(existsSync(store) ? readBindingIndex(store).map((entry) => entry.id) : []);
      unbound = Object.entries(parsed.targets)
        .filter(([id]) => !bound.has(id))
        .map(([id, target]) => ({ id, phrase: target.phrases[0] ?? id }));
    } catch {
      plan = "stale";
    }
  }

  return {
    project: { root, name: loaded.config.project },
    flows,
    plan,
    unbound,
    ...(lastRunState(root) === undefined ? {} : { lastRun: lastRunState(root)! }),
  };
}

export interface NextStep {
  /** The command to run, or a place to read. */
  readonly verb: string;
  readonly because: string;
}

/** The next verb, in the order LLD §15.1 lists. */
export function nextVerb(state: ProjectState): NextStep {
  if (state.project === undefined) return { verb: "yam init", because: "No Yam project here." };
  if (state.problem !== undefined || state.flows.errors > 0) {
    return { verb: "yam check", because: "The project does not read cleanly." };
  }
  if (state.flows.stories === 0) {
    return { verb: "write a flow", because: "The project has no flows yet. See `yam help flows`." };
  }
  if (state.plan !== "current") {
    return {
      verb: "yam check",
      because: state.plan === "missing" ? "There is no plan yet." : "The plan is older than the flows.",
    };
  }
  if (state.unbound.length > 0) {
    const first = state.unbound[0]!;
    return {
      verb: "yam record",
      because:
        `${state.unbound.length} target${state.unbound.length === 1 ? " has" : "s have"} no binding yet, ` +
        `starting with \`${first.phrase}\`.`,
    };
  }
  const run = state.lastRun;
  if (run === undefined) return { verb: "yam run", because: "The plan has never been run." };
  if (run.verdict === "failed" && run.failureClass === "locator") {
    return { verb: "yam heal", because: `The last run failed to find an element at \`${run.failedStep ?? "a step"}\`.` };
  }
  if (run.verdict === "failed" || run.verdict === "aborted") {
    return {
      verb: "yam run",
      because: `The last run ${run.verdict} at \`${run.failedStep ?? "a step"}\`; fix the flow or the application and replay.`,
    };
  }
  if (run.verdict === "healed") {
    return { verb: "yam heal", because: "The last run passed only because a binding was healed; review the repair." };
  }
  return { verb: "yam run", because: "Green. Replay whenever you like." };
}

/** `yam` with no arguments, and `yam status`. */
export async function statusCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const dir = args.command[1] ?? ".";
  const state = await projectState(dir);
  const next = nextVerb(state);

  if (boolOption(args, "json")) {
    io.out(JSON.stringify({ ...state, next }, null, 2));
    return EXIT.ok;
  }

  if (state.project === undefined) {
    io.out("No Yam project here.\n\n  yam init      start one in this directory");
    return EXIT.ok;
  }

  const lines: string[] = [];
  lines.push(`${state.project.name} · ${state.project.root}`);
  if (state.problem !== undefined) {
    lines.push(`flows     could not be read: ${state.problem.split("\n")[0]}`);
  } else {
    lines.push(
      `flows     ${state.flows.files} file${state.flows.files === 1 ? "" : "s"}, ` +
        `${state.flows.stories} stor${state.flows.stories === 1 ? "y" : "ies"}` +
        (state.flows.errors === 0 ? "" : `, ${state.flows.errors} error${state.flows.errors === 1 ? "" : "s"}`),
    );
  }
  lines.push(
    `plan      ${state.plan}` +
      (state.plan === "current" && state.unbound.length > 0
        ? `, ${state.unbound.length} target${state.unbound.length === 1 ? "" : "s"} unbound`
        : state.plan === "current"
          ? ", every target bound"
          : ""),
  );
  const run = state.lastRun;
  lines.push(
    run === undefined
      ? "last run  none yet"
      : `last run  ${run.verdict}${run.endedAt === undefined ? "" : ` ${ago(run.endedAt)}`} ` +
          `(${run.passed} passed, ${run.failed} failed, ${run.skipped} skipped) · ${run.runId}`,
  );
  lines.push("");
  lines.push(`next      ${next.verb}`);
  lines.push(`          ${next.because}`);
  io.out(lines.join("\n"));
  return EXIT.ok;
}

/** "2 min ago", in words a person reads at a glance. */
function ago(iso: string, now = Date.now()): string {
  const ms = now - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

/** Whether `.yam/plan.json` is compiled from what is on disk now (T14.2). */
export function planStaleness(loaded: LoadedProject): "current" | "stale" | "missing" {
  if (!existsSync(join(loaded.root, ".yam", "plan.json"))) return "missing";
  const inputs = planInputsPath(loaded.root);
  if (!existsSync(inputs)) return "stale";
  try {
    const recorded = (JSON.parse(readFileSync(inputs, "utf8")) as { inputHash?: string }).inputHash;
    return recorded === inputHash(loaded) ? "current" : "stale";
  } catch {
    return "stale";
  }
}

/**
 * The one line `run`, `record` and `heal` print when they had to check first
 * (REQ-CLI-3). They always compile from the flows; this says why that mattered.
 */
export function noteCheck(loaded: LoadedProject, io: CommandIo): void {
  const state = planStaleness(loaded);
  if (state === "stale") io.err("plan was stale; checked");
  else if (state === "missing") io.err("no plan yet; checked");
}

/** A failure's reason in one line, and the verb that resolves it (REQ-CLI-5, REQ-CLI-6). */
export function reasonFor(failure: { readonly class: string; readonly message: string }): {
  readonly message: string;
  readonly next?: string;
} {
  const message = failure.message.split("\n")[0] ?? failure.message;
  switch (failure.class) {
    case "locator":
      return message.startsWith("No binding for")
        ? { message, next: "yam record" }
        : { message, next: "yam heal" };
    case "data":
      return /reads \$\{?YAM_INPUT_[A-Z0-9_]+\}?, which is not set/.test(message)
        ? { message, next: "export the variable the message names, then yam run" }
        : { message };
    case "infrastructure":
      return /browser|chromium|executable doesn't exist|playwright install/i.test(message)
        ? { message, next: "npx playwright install chromium" }
        : { message };
    default:
      return { message };
  }
}
