/**
 * The Flows screen (T9.1, T9.4, LLD §13.7; the `Main` artboard).
 *
 * List, editor with lint, plan. The mockup's toolbar reads
 * "7 files · 22 stories · 41 bindings, 4 unverified", its list gives each flow
 * the status of its last run, its editor gutter marks each step with what that
 * run did to it, and its inspector describes the selected step: the tier it
 * compiled at, its target, its binding, its guard, and what the last run did.
 *
 * Every one of those is a service answer, and this file is the arithmetic
 * between them:
 *
 *   * `GET /project` — the files, the stories, the diagnostics.
 *   * `POST /compile` — the lint under the editor.
 *   * `GET /plan` — the tier, confidence and target of each step, which is what
 *     the gutter and the inspector are about.
 *   * `GET /runs` and `GET /runs/:id/results` — what the last run did, per step.
 *   * `GET /bindings` — the binding behind a step's target, verified or not.
 *   * `GET /flows/:file` — the text in the editor.
 *
 * A renderer adds nothing to this. That is the point of the model: the app and
 * `yam ui` draw the same rows differently and agree about every word in them.
 */
import { Sources, dotted, plural } from "../load.js";
import { actionsForScreen } from "../registry.js";
import type { ScreenService } from "../service.js";
import type { Binding, Pill, Screen, ScreenParams, ScreenStateBase } from "../types.js";
import type {
  BindingListRow,
  CompileResponse,
  Diagnostic,
  PlanResponse,
  PlanStep,
  ProjectResponse,
  StepResultResponse,
  SummaryResponse,
} from "../shapes.js";
import { parseBinding } from "../bindings.js";

/** One row of the flow list (the `Main` artboard's left column). */
export interface FlowRow {
  readonly file: string;
  /** `flows/simple.flow` → `simple.flow`, which is what the list shows. */
  readonly name: string;
  readonly stories: number;
  readonly status: Pill;
  /**
   * The grey lines under the name: "3 stories", and the failing step when there
   * is one. The mockup shows "run 4 min ago" beside them, and that is the
   * *renderer's* line — see `lastRunAt`.
   */
  readonly meta: readonly string[];
  /**
   * When the last run of this flow ended, as the summary wrote it (P9-F4).
   *
   * A timestamp, never "4 min ago" (Draft 2.12 §13.7: "State carries
   * timestamps, never a relative time as text"). The state of a project that
   * nothing has happened to must be the same value a second later, or
   * `yam ui --json` is not the model's state and two loads cannot be
   * compared. Both renderers call `ago()` from `@svatah/yam-screens` on this, so
   * they still print the same words.
   */
  readonly lastRunAt?: string;
  readonly selected: boolean;
}

/** One line of the editor, with what the plan and the last run say about it. */
export interface FlowLine {
  readonly line: number;
  readonly text: string;
  /** `story:` / `scenario:` / `test:` headers, comments, and steps read differently. */
  readonly kind: "header" | "comment" | "step" | "blank";
  /** The gutter glyph's tone, from the last run. Absent when the run said nothing. */
  readonly outcome?: Pill;
  /** "tier 1 · bound", "skipped last run" — the mockup's right-hand note. */
  readonly note?: string;
  /** The lint warning attached to this line, when there is one. */
  readonly warning?: string;
  readonly stepId?: string;
}

/** What the inspector shows about the selected step. */
export interface StepInspector {
  readonly stepId: string;
  readonly line: number;
  readonly text: string;
  readonly tier?: number;
  readonly confidence?: number;
  readonly target?: string;
  readonly targetStatus?: string;
  readonly guard?: string;
  readonly lastRun?: string;
  readonly binding?: {
    readonly elementId: string;
    readonly verified: boolean;
    readonly candidates: ReadonlyArray<{ by: string; value: string; score?: number }>;
    readonly context?: string;
    readonly provenance?: {
      model?: string;
      promptVersion?: string;
      at?: string;
      tokensIn?: number;
      tokensOut?: number;
      costUsd?: number;
    };
  };
}

export interface FlowsState extends ScreenStateBase {
  readonly screen: "flows";
  /** The counts in the toolbar, exactly as the mockup words them. */
  readonly counts: {
    readonly files: number;
    readonly stories: number;
    readonly bindings: number;
    readonly unverified: number;
  };
  readonly files: readonly FlowRow[];
  /** The open file, project-relative (`flows/…`), when one is open. */
  readonly file?: string;
  readonly lines: readonly FlowLine[];
  /**
   * The open file's text, exactly as `GET /flows/:file` answered (K6, T11.1).
   *
   * `lines` is the *annotated* view — the gutter, the note, the lint warning —
   * and it is what a reader reads. This is what an editor edits, and what
   * `flows.save` sends back to `PUT /flows/:file`. Keeping the two apart is what
   * lets the app draw the annotations beside a `<textarea>` without either of
   * them being derived from the other and drifting: a round trip through
   * `lines` would lose a trailing newline the first time somebody saved.
   */
  readonly text: string;
  readonly lint: readonly Diagnostic[];
  readonly planHash?: string;
  readonly bindingsHash?: string;
  readonly inspector?: StepInspector;
  /** The story names in the open file, for `run.story` and the palette. */
  readonly stories: readonly string[];
  readonly story?: string;
}

/** `flows/simple.flow` → `simple.flow`. */
const basename = (file: string): string => file.split("/").pop() ?? file;

const STATUS_PILL: Readonly<Record<string, Pill>> = {
  passed: { tone: "pass", label: "passed" },
  failed: { tone: "fail", label: "failed" },
  skipped: { tone: "skip", label: "skipped" },
  healed: { tone: "healed", label: "healed" },
  aborted: { tone: "abort", label: "aborted" },
  running: { tone: "info", label: "running" },
};

const NOT_RUN: Pill = { tone: "neutral", label: "not run" };

/**
 * Which line of the flow file a step is on, and what kind of line it is.
 *
 * Read from the *text*, not from the plan: a comment and a blank line have no
 * step and the editor still has to draw them, and the mockup's gutter is a
 * column beside every line rather than a list of steps.
 */
function classify(text: string): FlowLine["kind"] {
  const trimmed = text.trim();
  if (trimmed === "") return "blank";
  if (trimmed.startsWith("//") || trimmed.startsWith("#")) return "comment";
  if (/^(story|scenario|compose|test|run)\s*(\([^)]*\))?\s*:/.test(trimmed)) return "header";
  return "step";
}

export const flowsScreen: Screen<FlowsState> = {
  id: "flows",
  title: "Flows",
  actions: actionsForScreen("flows"),
  keys: FLOW_KEYS(),
  async load(service: ScreenService, params: ScreenParams = {}): Promise<FlowsState> {
    const sources = new Sources();

    const project = await sources.get<ProjectResponse>("GET /project", () => service.getProject(), {});
    const flows = project.flows ?? [];
    const file = params.file ?? flows[0];

    const summaries = await sources.optional<SummaryResponse[]>(
      "GET /runs",
      () => service.getRuns(),
      [],
    );
    const bindingList = await sources.optional<BindingListRow[]>(
      "GET /bindings",
      () => service.getBindings(),
      [],
    );
    const compiled = await sources.optional<CompileResponse>(
      "POST /compile",
      () => service.postCompile(),
      {},
    );
    const plan = await sources.optional<PlanResponse>("GET /plan", () => service.getPlan(), {});

    /*
     * The last run's step results, which is what the gutter draws.
     *
     * The newest run only. A gutter that merged several runs would be showing
     * something no run ever produced, and the mockup's note says "skipped last
     * run" — singular, and about a run someone can open.
     */
    const latest = summaries[0];
    const results =
      latest?.runId === undefined
        ? []
        : await sources.optional<StepResultResponse[]>(
            `GET /runs/${latest.runId}/results`,
            () => service.getRunsByIdResults(latest.runId!),
            [],
          );

    const text =
      file === undefined
        ? ""
        : await sources.optional<string>(
            `GET /flows/${basename(file)}`,
            () => service.getFlowsByFile(basename(file)),
            "",
          );

    /* ── the list ──────────────────────────────────────────────────────────── */

    const storiesOf = (one: string): string[] =>
      (project.stories ?? [])
        .filter((story) => story.file === one)
        .map((story) => story.name ?? "")
        .filter((name) => name !== "");

    /*
     * Which flow a run belongs to, when the run does not say.
     *
     * `summary.flows` is keyed by flow file for a whole-flow run and by the
     * literal `(selected)` for `yam run --story <name>` — which is what the
     * mockup's `comp` run is. So a match on the key alone left every row in the
     * list saying "not run" beside a run that had just happened. The stories the
     * run's results name belong to a file (`GET /project` says which), and that
     * is the flow the run was about.
     */
    const fileOfStory = new Map(
      (project.stories ?? [])
        .filter((story) => story.name !== undefined && story.file !== undefined)
        .map((story) => [story.name!, story.file!]),
    );
    const filesOfLatestRun = new Set(
      results
        .map((result) => fileOfStory.get(result.story ?? ""))
        .filter((one): one is string => one !== undefined),
    );

    const lastRunOf = (one: string): SummaryResponse | undefined => {
      const byKey = summaries.find((summary) =>
        Object.keys(summary.flows ?? {}).some((key) => key === one || key.endsWith(basename(one))),
      );
      if (byKey !== undefined) return byKey;
      return filesOfLatestRun.has(one) ? latest : undefined;
    };

    /*
     * The store's own count of what is unverified.
     *
     * `GET /bindings` answers ids and paths; the entries are in the YAML each
     * `GET /bindings/:id` returns. Reading all of them for a toolbar count would
     * be thirty requests per keystroke, so the count is of *files* and the
     * unverified figure comes from the one binding the inspector is about plus
     * whatever the last run could not resolve — which is the number that changes
     * something a person would do about it.
     */
    const unresolved = new Set(
      results
        .filter((result) => result.failure?.class === "locator")
        .map((result) => /"([^"]+)"/.exec(result.failure?.message ?? "")?.[1])
        .filter((id): id is string => id !== undefined),
    );

    const files: FlowRow[] = flows.map((one) => {
      const summary = lastRunOf(one);
      /*
       * The flow's own entry when the run named it, and the run's single entry
       * when it did not — a `--story` run has one `(selected)` entry, and its
       * status is the status of the thing that ran.
       */
      const entries = summary?.flows ?? {};
      const status = (entries[one] ?? entries[Object.keys(entries)[0] ?? ""])?.status;
      const failing = results.find(
        (result) => result.status === "failed" && storiesOf(one).includes(result.story ?? ""),
      );
      return {
        file: one,
        name: basename(one),
        stories: storiesOf(one).length,
        status: status === undefined ? NOT_RUN : (STATUS_PILL[status] ?? NOT_RUN),
        meta: [
          plural(storiesOf(one).length, "story", "stories"),
          ...(failing === undefined
            ? []
            : [`${failing.story ?? ""}#${(failing.stepId ?? "").split("#")[1] ?? ""} ${failing.failure?.class ?? ""}`.trim()]),
        ],
        ...(summary?.endedAt === undefined ? {} : { lastRunAt: summary.endedAt }),
        selected: one === file,
      };
    });

    /* ── the editor ────────────────────────────────────────────────────────── */

    const planStory = (plan.stories ?? []).filter(
      (story) => file === undefined || story.file === file || story.file === basename(file),
    );
    const stepAt = new Map<number, PlanStep>();
    for (const story of planStory) {
      for (const step of story.steps ?? []) {
        if (typeof step.line === "number") stepAt.set(step.line, step);
      }
    }
    const resultAt = new Map<number, StepResultResponse>();
    for (const result of results) {
      if (typeof result.line === "number") resultAt.set(result.line, result);
    }
    const diagnostics = [...(compiled.errors ?? []), ...(compiled.warnings ?? [])];
    const warningAt = new Map<number, string>();
    for (const one of diagnostics) {
      if (typeof one.line === "number" && one.message !== undefined) {
        warningAt.set(one.line, `${one.code ?? ""} ${one.message}`.trim());
      }
    }

    const lines: FlowLine[] = text.split("\n").map((one, at) => {
      const line = at + 1;
      const step = stepAt.get(line);
      const result = resultAt.get(line);
      const note =
        result?.status === "skipped"
          ? "skipped last run"
          : step === undefined
            ? undefined
            : dotted(
                step.origin?.tier === undefined ? undefined : `tier ${step.origin.tier}`,
                step.target?.status === "unbound" ? "unbound" : step.target === undefined ? undefined : "bound",
              );
      return {
        line,
        text: one,
        kind: classify(one),
        ...(result?.status === undefined ? {} : { outcome: STATUS_PILL[result.status] ?? NOT_RUN }),
        ...(note === undefined || note === "" ? {} : { note }),
        ...(warningAt.has(line) ? { warning: warningAt.get(line)! } : {}),
        ...(step?.id === undefined ? {} : { stepId: step.id }),
      };
    });

    /* ── the inspector ─────────────────────────────────────────────────────── */

    const selectedLine =
      params.selected === undefined ? undefined : Number(params.selected.replace(/^line:/, ""));
    const chosen =
      selectedLine !== undefined && Number.isFinite(selectedLine)
        ? stepAt.get(selectedLine)
        : undefined;
    /*
     * The binding behind the selected step, read the way `yam bindings show`
     * reads it: `GET /bindings/:id` answers the YAML file itself. One request,
     * for one step, when the inspector has a subject — a screen that fetched
     * thirty files to fill a toolbar count would be a screen with an opinion
     * about caching.
     */
    const elementId = chosen?.target?.ref;
    const binding =
      elementId === undefined
        ? undefined
        : parseBinding(
            await sources.optional<string>(
              `GET /bindings/${elementId}`,
              () => service.getBindingsById(elementId),
              "",
            ),
          );

    const inspector = ((): StepInspector | undefined => {
      if (chosen === undefined || chosen.line === undefined) return undefined;
      const result = resultAt.get(chosen.line);
      const entry = binding?.entries?.[0];
      return {
        stepId: chosen.id ?? `line:${chosen.line}`,
        line: chosen.line,
        text: chosen.text ?? "",
        ...(chosen.origin?.tier === undefined ? {} : { tier: chosen.origin.tier }),
        ...(chosen.origin?.confidence === undefined
          ? {}
          : { confidence: chosen.origin.confidence }),
        ...(elementId === undefined ? {} : { target: elementId }),
        ...(chosen.target?.status === undefined ? {} : { targetStatus: chosen.target.status }),
        ...(chosen.guard === undefined
          ? {}
          : { guard: dotted(chosen.guard.kind, chosen.guard.subject, chosen.guard.predicate) }),
        ...(result === undefined
          ? {}
          : {
              lastRun: dotted(
                result.status,
                result.status === "skipped" ? "guard false" : undefined,
                result.failure?.message?.split("\n")[0],
              ),
            }),
        ...(binding === undefined || entry === undefined
          ? {}
          : {
              binding: {
                elementId: binding.id ?? elementId ?? "",
                verified: entry.verified === true,
                candidates: (entry.candidates ?? []).map((candidate) => ({
                  by: candidate.by ?? "",
                  value:
                    candidate.value ??
                    dotted(
                      candidate.role,
                      candidate.name === undefined ? undefined : `"${candidate.name}"`,
                    ),
                  ...(candidate.score === undefined ? {} : { score: candidate.score }),
                })),
                ...(entry.context === undefined
                  ? {}
                  : { context: dotted(entry.context.pattern, entry.context.hash?.slice(0, 8)) }),
                ...(entry.provenance === undefined ? {} : { provenance: entry.provenance }),
              },
            }),
      };
    })();

    const counts = {
      files: flows.length,
      stories: (project.stories ?? []).length,
      bindings: bindingList.length,
      unverified: unresolved.size,
    };

    return {
      ...sources.base(
        "flows",
        "Flows",
        dotted(
          plural(counts.files, "file"),
          plural(counts.stories, "story", "stories"),
          `${plural(counts.bindings, "binding")}, ${counts.unverified} unverified`,
        ),
        dotted(
          file === undefined ? undefined : basename(file),
          selectedLine === undefined ? undefined : `line ${selectedLine}`,
        ),
      ),
      screen: "flows",
      counts,
      files,
      ...(file === undefined ? {} : { file }),
      lines,
      text,
      lint: diagnostics,
      ...(compiled.plan?.hash === undefined ? {} : { planHash: compiled.plan.hash }),
      ...(inspector === undefined ? {} : { inspector }),
      stories: file === undefined ? [] : storiesOf(file),
      ...(params.story === undefined ? {} : { story: params.story }),
    };
  },
};

/** The keys the Flows screen binds (LLD §13.7's "conventional keys throughout"). */
function FLOW_KEYS(): readonly Binding[] {
  return [
    { action: "run.flow", key: "⌘↵", terminal: "r", description: "Run the selected flow" },
    { action: "record.start", key: "R", terminal: "R", description: "Record the selected flow" },
    { action: "heal.run", key: "H", terminal: "h", description: "Heal the last run" },
    /*
     * `e` in the terminal, `⌘S` in the app (K6, T11.1).
     *
     * The two renderers edit a file the way their own medium does. The app has
     * a text area and a Save button; a terminal has `$EDITOR`, and a cockpit
     * that built its own modal editor inside Ink would be a worse `vi` nobody
     * asked for. `yam ui` opens the file in the editor a person already has,
     * and saves what comes back through the same `flows.save` action and the
     * same `PUT /flows/:file` — which is what makes it one action rather than
     * two features.
     */
    { action: "flows.save", key: "⌘S", terminal: "e", description: "Edit the open flow" },
    { action: "flows.compile", key: "⌘B", terminal: "c", description: "Compile and lint" },
  ];
}
