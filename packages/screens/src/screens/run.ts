/**
 * The Run screen (T9.1, T9.4, LLD §13.7; the `Run` artboard).
 *
 * One run, live: the stories it touched with their totals, every step with its
 * status and the candidate that resolved it, the audit beside them, and an
 * inspector on the failing step with the screenshot, the candidates tried and
 * what to do about it.
 *
 * The mockup is the `comp` run of `guards-and-compensation.flow`: five steps,
 * the fifth fails with `locator`, the policy runs "cancel a booking" with the
 * failing story's scope, and the flow ends `aborted` with exit 11. Every number
 * on it — 6 passed, 1 failed, 0.74 s, `BK-4471`, the five candidates that
 * matched nothing — is what a real run of that flow writes, which is why the
 * fake-service fixtures under `test/fixtures/` are a recording of one rather
 * than an invention (`scripts/record-screen-fixtures.mjs`).
 *
 * ## Live and finished are the same screen
 *
 * A run in progress has the same shape with fewer steps in it: the renderers
 * subscribe to `step.result` and `run.summary` and call `applyEvent` to fold
 * each into the state. A screen that had a "live" mode and a "history" mode
 * would be two screens that must agree, and the mockup draws one.
 */
import { Sources, dotted, plural } from "../load.js";
import { actionsForScreen } from "../registry.js";
import type { ScreenService, ServiceEventLike } from "../service.js";
import type { Binding, Pill, Screen, ScreenParams, ScreenStateBase } from "../types.js";
import type {
  AuditResponse,
  StepResultResponse,
  SummaryResponse,
} from "../shapes.js";

export interface RunStoryRow {
  readonly story: string;
  readonly status: Pill;
  readonly steps: number;
  /** "policy compensate → cancel a booking", "compensation, ran with the failing scope". */
  readonly meta: readonly string[];
  readonly selected: boolean;
}

export interface RunStepRow {
  readonly stepId: string;
  readonly story: string;
  readonly index: number;
  readonly text: string;
  readonly status: Pill;
  /** "testid #0", "= BK-4471" — the mockup's first grey column. */
  readonly detail?: string;
  readonly durationMs?: number;
  /** The failure sentence under the row, when the step failed. */
  readonly failure?: string;
  /** The pill beside a failed step: its failure class. */
  readonly failureClass?: Pill;
  /** "policy applied · compensate: cancel a booking". */
  readonly policy?: string;
  readonly selected: boolean;
}

export interface AuditRow {
  readonly seq: number;
  /** `08.451` — seconds and milliseconds within the run, as the mockup writes it. */
  readonly at: string;
  /**
   * The narrow second column: `locate`, `act`, `check`, `story`, `policy`.
   *
   * The *call's* method when the line is a surface call, and the audit line's
   * own kind otherwise (P9-F5). `kind` is `"surface"` for every one of the
   * twenty surface lines a run writes, so a column showing it said the same
   * word twenty times while the thing a reader wants — which call — sat in the
   * text beside it. The `Run` artboard's column reads `locate`.
   */
  readonly kind: string;
  readonly text: string;
  readonly tone: "pass" | "fail" | "abort" | "neutral";
}

export interface RunInspector {
  readonly stepId: string;
  readonly title: string;
  readonly failureClass?: Pill;
  readonly session?: string;
  readonly windowTitle?: string;
  readonly dialog?: string;
  readonly policy?: string;
  readonly screenshot?: string;
  readonly candidatesTried: ReadonlyArray<{ by: string; value: string; matched: number }>;
  /** The mockup's "What to do" card, written for the screen rather than a log. */
  readonly advice?: string;
}

export interface RunState extends ScreenStateBase {
  readonly screen: "run";
  readonly runId?: string;
  readonly outcome: Pill;
  readonly behavior?: string;
  readonly invoker?: string;
  readonly durationMs?: number;
  readonly totals: {
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
    readonly healed: number;
  };
  readonly stories: readonly RunStoryRow[];
  readonly steps: readonly RunStepRow[];
  readonly audit: readonly AuditRow[];
  readonly inspector?: RunInspector;
  /** True while the run is still producing events; the Stop action needs it. */
  readonly live: boolean;
  /** The step `run.resume` would resume from: the first failure. */
  readonly resumeFrom?: string;
  readonly planHash?: string;
  readonly bindingsHash?: string;
  readonly exitCode?: number;
}

const PILL: Readonly<Record<string, Pill>> = {
  passed: { tone: "pass", label: "passed" },
  failed: { tone: "fail", label: "failed" },
  skipped: { tone: "skip", label: "skipped" },
  healed: { tone: "healed", label: "healed" },
  aborted: { tone: "abort", label: "aborted" },
  running: { tone: "info", label: "running" },
};

const NONE: Pill = { tone: "neutral", label: "no run" };

/** `2026-09-05T09:13:42.896Z` and the run's start → `08.451`, the mockup's stamp. */
export function stamp(at: string | undefined, startedAt: string | undefined): string {
  const when = Date.parse(at ?? "");
  const from = Date.parse(startedAt ?? "");
  if (!Number.isFinite(when)) return "";
  if (!Number.isFinite(from)) return new Date(when).toISOString().slice(17, 23);
  const ms = Math.max(0, when - from);
  return `${String(Math.floor(ms / 1000)).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

/** "testid #0" or "= BK-4471": what resolved the step, or what it captured. */
function detailOf(result: StepResultResponse): string | undefined {
  const captured = Object.values(result.captured ?? {});
  if (captured.length > 0) return `= ${String(captured[0])}`;
  if (result.matched?.by === undefined) return undefined;
  return `${result.matched.by} #${result.matched.candidateIndex ?? 0}`;
}

/** The first line of a failure message: the sentence, without the candidate list. */
const firstLine = (message: string | undefined): string | undefined =>
  message?.split("\n")[0]?.trim();

const candidateText = (candidate: Record<string, unknown>): string => {
  const value = candidate["value"];
  if (typeof value === "string") return value;
  const role = candidate["role"];
  const name = candidate["name"];
  return dotted(
    typeof role === "string" ? role : undefined,
    typeof name === "string" ? `"${name}"` : undefined,
  );
};

/**
 * An `onFailure` policy as one phrase (REQ-AUTO-4).
 *
 * `"stop"`, `"continue"`, or `compensate: <flow>` — which is how the flow file
 * writes it (`onFailure=compensate:cancel a booking`) and how the mockup's
 * status line and audit both read it.
 */
export function policyText(policy: string | { compensate?: string } | undefined): string | undefined {
  if (policy === undefined) return undefined;
  if (typeof policy === "string") return policy;
  return policy.compensate === undefined ? undefined : `compensate: ${policy.compensate}`;
}

/**
 * A candidate as the `Run` artboard writes one: `testid "pay"`, `role button "Pay"`.
 *
 * The audit records a `locate` call's candidate reduced to what identifies it
 * (`@svatah/runtime`'s `candidateOf`), and this is the sentence form of it. Not
 * `by "testid" value "pay"` — the mockup's audit pane reads like a person
 * describing what was tried, and `key "value"` pairs read like a dump.
 */
function locatorText(one: Record<string, unknown>): string | undefined {
  const parts = [
    typeof one["by"] === "string" ? one["by"] : undefined,
    typeof one["value"] === "string" ? `"${one["value"]}"` : undefined,
    typeof one["role"] === "string" ? one["role"] : undefined,
    typeof one["name"] === "string" ? `"${one["name"]}"` : undefined,
    typeof one["nth"] === "number" ? `#${one["nth"]}` : undefined,
  ].filter((part) => part !== undefined);
  return parts.length === 0 ? undefined : parts.join(" ");
}

/**
 * One surface call as a phrase (P9-F5, Draft 2.12 §13.7).
 *
 * > The ADE's audit pane renders the call detail the model carries
 * > (`locate · booking.book-now-button · testid #0 · ok`).
 *
 * `act click h0 value "Indiranagar"`, and — since T10.4 taught the auditor to
 * record which element a `locate` is about and what its candidate was —
 * `locate · checkout.pay-button · testid "pay"`, which is the `Run` artboard's
 * own line. Before that every locate line read `locate · ok`, because the
 * surface is handed a candidate and never the element it belongs to.
 *
 * `args` is the *argument list* — an array whose entries are whatever the method
 * takes, and mostly `{}` and `null`. Empty objects and nulls carry nothing a
 * reader wants, so they are dropped; what is left is written as `key "value"`
 * pairs.
 */
function callText(call: AuditResponse["call"]): string | undefined {
  if (call === undefined) return undefined;
  const entries = (Array.isArray(call.args) ? call.args : [call.args]).filter(
    (one): one is Record<string, unknown> => typeof one === "object" && one !== null,
  );
  if (call.method === "locate") {
    return dotted(call.ref, ...entries.map(locatorText));
  }
  const args = entries
    .flatMap((one) => Object.entries(one))
    .map(([key, value]) => `${key} ${typeof value === "string" ? `"${value}"` : String(value)}`)
    .join(" ");
  // Not `call.method`: that is the row's `kind` column now, and a line reading
  // `act | act · click · h0` says the word twice.
  return dotted(call.action, call.ref, args === "" ? undefined : args);
}

/** One audit line's `detail`, which is an object on most kinds. */
function detailText(detail: unknown): string | undefined {
  if (detail === undefined || detail === null) return undefined;
  if (typeof detail === "string") return detail;
  if (typeof detail !== "object") return String(detail);
  /*
   * A `locate`'s match count, in the artboard's words: "matched nothing", and
   * `matched 1` for the candidate that resolved. The resolver requires exactly
   * one match (REQ-RUN-5), so this is the whole of what a locate line has to
   * say about its outcome beyond `ok`.
   */
  const matched = (detail as Record<string, unknown>)["matched"];
  if (typeof matched === "number" && Object.keys(detail as object).length === 1) {
    return matched === 0 ? "matched nothing" : `matched ${matched}`;
  }
  const parts = Object.entries(detail as Record<string, unknown>).map(([key, value]) => {
    if (value === null || value === undefined) return key;
    if (typeof value === "object") {
      const inner = Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${k} ${String(v)}`)
        .join(" ");
      return inner === "" ? key : `${key} ${inner}`;
    }
    return `${key} ${String(value)}`;
  });
  return parts.join(" · ");
}

const auditTone = (line: AuditResponse): AuditRow["tone"] => {
  if (line.kind === "policy" || line.policy !== undefined) return "abort";
  const outcome = String(line.outcome ?? "");
  if (outcome === "ok" || outcome === "passed") return "pass";
  if (outcome === "failed" || outcome === "error") return "fail";
  return "neutral";
};

/** Build the whole state from a summary, its results and its audit. */
export function runStateFrom(
  sources: Sources,
  runId: string | undefined,
  summary: SummaryResponse,
  results: readonly StepResultResponse[],
  audit: readonly AuditResponse[],
  params: ScreenParams,
): RunState {
  const totals = {
    passed: summary.totals?.passed ?? results.filter((one) => one.status === "passed").length,
    failed: summary.totals?.failed ?? results.filter((one) => one.status === "failed").length,
    skipped: summary.totals?.skipped ?? results.filter((one) => one.status === "skipped").length,
    healed: summary.totals?.healed ?? 0,
  };

  const flowStatuses = Object.values(summary.flows ?? {}).map((one) => one.status);
  const outcome =
    runId === undefined
      ? NONE
      : summary.endedAt === undefined
        ? PILL["running"]!
        : (PILL[
            flowStatuses.includes("aborted")
              ? "aborted"
              : totals.failed > 0
                ? "failed"
                : totals.healed > 0
                  ? "healed"
                  : "passed"
          ] ?? NONE);

  const storyNames = [...new Set(results.map((one) => one.story ?? ""))].filter((one) => one !== "");
  const failedStep = results.find((one) => one.status === "failed");
  const compensating = policyText(failedStep?.failure?.policyApplied);
  const selectedStory = params.story ?? failedStep?.story ?? storyNames[0];

  const stories: RunStoryRow[] = storyNames.map((story) => {
    const own = results.filter((one) => one.story === story);
    const failed = own.some((one) => one.status === "failed");
    const isCompensation =
      compensating !== undefined && compensating.endsWith(story) && story !== failedStep?.story;
    return {
      story,
      status: failed ? PILL["failed"]! : PILL["passed"]!,
      steps: own.length,
      meta: [
        plural(own.length, "step"),
        ...(failed && compensating !== undefined ? [`policy ${compensating}`] : []),
        ...(isCompensation ? ["compensation, ran with the failing scope"] : []),
      ],
      selected: story === selectedStory,
    };
  });

  const selectedStep = params.selected ?? failedStep?.stepId;
  const steps: RunStepRow[] = results.map((result, at) => ({
    stepId: result.stepId ?? `step-${at}`,
    story: result.story ?? "",
    index: Number((result.stepId ?? "").split("#")[1] ?? at + 1),
    text: result.text ?? "",
    status: PILL[result.status ?? ""] ?? NONE,
    ...(detailOf(result) === undefined ? {} : { detail: detailOf(result)! }),
    ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
    ...(firstLine(result.failure?.message) === undefined
      ? {}
      : { failure: firstLine(result.failure?.message)! }),
    ...(result.failure?.class === undefined
      ? {}
      : { failureClass: { tone: "fail" as const, label: result.failure.class } }),
    ...(policyText(result.failure?.policyApplied) === undefined
      ? {}
      : { policy: `policy applied · ${policyText(result.failure?.policyApplied)!}` }),
    selected: (result.stepId ?? `step-${at}`) === selectedStep,
  }));

  const auditRows: AuditRow[] = audit.map((line, at) => ({
    seq: line.seq ?? at,
    at: stamp(line.at, summary.startedAt),
    kind: line.call?.method ?? String(line.kind ?? ""),
    /*
     * One readable line, in the order the mockup writes one: what was called,
     * on what, what came back, and how long it took.
     *
     * `call` is an *object* (`{ method, ref, args }`) rather than a string, and
     * reading it as one produced twenty audit rows that all said "ok" — which
     * is the shape of a log nobody can use.
     */
    text: dotted(
      callText(line.call),
      typeof line.ref === "string" ? line.ref : undefined,
      detailText(line.detail),
      typeof line.message === "string" ? line.message : undefined,
      typeof line.outcome === "string" ? line.outcome : undefined,
      line.durationMs === undefined ? undefined : `${line.durationMs} ms`,
    ),
    tone: auditTone(line),
  }));

  const chosen = results.find((one) => one.stepId === selectedStep) ?? failedStep;
  const inspector: RunInspector | undefined =
    chosen === undefined
      ? undefined
      : {
          stepId: chosen.stepId ?? "",
          title: `Step ${(chosen.stepId ?? "").split("#")[1] ?? ""} · ${chosen.text ?? ""}`.trim(),
          ...(chosen.failure?.class === undefined
            ? {}
            : { failureClass: { tone: "fail" as const, label: chosen.failure.class } }),
          ...(chosen.failure?.session?.url === undefined
            ? {}
            : {
                /*
                 * The path, and never `new URL(…)`. A recorded session URL can
                 * carry a placeholder where the port was, and a screen that
                 * threw on one would take the window down to render a subtitle.
                 */
                session: dotted(
                  /^[a-z]+:\/\/[^/]+(\/.*)?$/i.exec(chosen.failure.session.url)?.[1] ??
                    chosen.failure.session.url,
                  chosen.failure.session.windowIndex === undefined
                    ? undefined
                    : `window ${chosen.failure.session.windowIndex}`,
                ),
              }),
          ...(chosen.failure?.session?.windowTitle === undefined
            ? {}
            : { windowTitle: chosen.failure.session.windowTitle }),
          // `null` is the recorded "there was no dialog"; `undefined` is "the
          // failure said nothing about one". Both read "none" on the screen.
          dialog:
            chosen.failure?.session?.dialog === undefined ||
            chosen.failure?.session?.dialog === null
              ? "none"
              : "open",
          ...(policyText(chosen.failure?.policyApplied) === undefined
            ? {}
            : { policy: policyText(chosen.failure?.policyApplied)! }),
          ...(chosen.failure?.screenshot === undefined
            ? {}
            : { screenshot: chosen.failure.screenshot.split("/").pop()! }),
          candidatesTried: (chosen.failure?.candidatesTried ?? []).map((candidate) => ({
            by: String(candidate["by"] ?? ""),
            value: candidateText(candidate),
            // The resolver requires exactly one match, so a candidate that
            // reached the failure matched none (REQ-RUN-5).
            matched: 0,
          })),
          ...(chosen.status === "failed"
            ? {
                advice: firstLine(chosen.failure?.message),
              }
            : {}),
        };

  const duration =
    summary.startedAt === undefined || summary.endedAt === undefined
      ? undefined
      : Date.parse(summary.endedAt) - Date.parse(summary.startedAt);

  return {
    ...sources.base(
      "run",
      runId === undefined ? "Run" : `Run ${runId}`,
      dotted(
        summary.behavior === undefined ? undefined : `${summary.behavior} behavior`,
        summary.invoker === undefined
          ? undefined
          : `invoker ${summary.invoker.kind ?? ""} via ${summary.invoker.via ?? ""}`,
        duration === undefined ? undefined : `${(duration / 1000).toFixed(2)} s`,
      ),
      dotted(
        runId,
        `${plural(results.length, "step")}`,
        duration === undefined ? undefined : `${(duration / 1000).toFixed(2)} s`,
      ),
    ),
    screen: "run",
    ...(runId === undefined ? {} : { runId }),
    outcome,
    ...(summary.behavior === undefined ? {} : { behavior: summary.behavior }),
    ...(summary.invoker === undefined
      ? {}
      : { invoker: dotted(summary.invoker.kind, `via ${summary.invoker.via ?? ""}`) }),
    ...(duration === undefined ? {} : { durationMs: duration }),
    totals,
    stories,
    steps,
    audit: auditRows,
    ...(inspector === undefined ? {} : { inspector }),
    live: runId !== undefined && summary.endedAt === undefined,
    ...(failedStep?.stepId === undefined ? {} : { resumeFrom: failedStep.stepId }),
    ...(summary.planHash === undefined ? {} : { planHash: summary.planHash }),
    ...(summary.bindingsHash === undefined ? {} : { bindingsHash: summary.bindingsHash }),
    ...(summary.exitCode === undefined ? {} : { exitCode: summary.exitCode }),
  };
}

export const runScreen: Screen<RunState> = {
  id: "run",
  title: "Run",
  actions: actionsForScreen("run"),
  keys: [
    { action: "run.again", key: "⌘↵", terminal: "r", description: "Run the same thing again" },
    { action: "run.resume", key: "⇧R", terminal: "R", description: "Resume from the failing step" },
    { action: "heal.run", key: "H", terminal: "h", description: "Heal this run" },
  ] satisfies readonly Binding[],
  async load(service: ScreenService, params: ScreenParams = {}): Promise<RunState> {
    const sources = new Sources();

    /*
     * The run in `params`, or the newest one. "Open the ADE on the Run screen"
     * has to mean something without a run id, and the newest run is what a
     * person opening the screen is looking for.
     */
    const summaries = await sources.optional<SummaryResponse[]>(
      "GET /runs",
      () => service.getRuns(),
      [],
    );
    const runId = params.runId ?? summaries[0]?.runId;
    if (runId === undefined) {
      return {
        ...sources.base("run", "Run", "No runs yet", "`svatah run` writes one"),
        screen: "run",
        outcome: NONE,
        totals: { passed: 0, failed: 0, skipped: 0, healed: 0 },
        stories: [],
        steps: [],
        audit: [],
        live: false,
      };
    }

    const summary =
      summaries.find((one) => one.runId === runId) ??
      (await sources.optional<SummaryResponse>(
        `GET /runs/${runId}`,
        () => service.getRunsById(runId),
        {},
      ));
    const results = await sources.optional<StepResultResponse[]>(
      `GET /runs/${runId}/results`,
      () => service.getRunsByIdResults(runId),
      [],
    );
    const audit = await sources.optional<AuditResponse[]>(
      `GET /runs/${runId}/audit`,
      () => service.getRunsByIdAudit(runId),
      [],
    );

    return runStateFrom(sources, runId, summary, results, audit, params);
  },
};

/**
 * Fold one event into a run's state (LLD §13.5's stream, §13.7's live screen).
 *
 * The renderers subscribe once and call this; neither of them decides what a
 * `step.result` means. A screen that recomputed its own totals from the rows it
 * happened to have would disagree with `summary.json` the moment an event was
 * dropped, so `run.summary` replaces the totals outright rather than adding to
 * them.
 */
export function applyEvent(state: RunState, event: ServiceEventLike): RunState {
  if (event["runId"] !== undefined && event["runId"] !== state.runId) return state;

  if (event.kind === "step.result") {
    const result = event["result"] as StepResultResponse | undefined;
    if (result === undefined) return state;
    const stepId = result.stepId ?? `step-${state.steps.length}`;
    const row: RunStepRow = {
      stepId,
      story: result.story ?? "",
      index: Number((result.stepId ?? "").split("#")[1] ?? state.steps.length + 1),
      text: result.text ?? "",
      status: PILL[result.status ?? ""] ?? NONE,
      ...(detailOf(result) === undefined ? {} : { detail: detailOf(result)! }),
      ...(result.durationMs === undefined ? {} : { durationMs: result.durationMs }),
      ...(firstLine(result.failure?.message) === undefined
        ? {}
        : { failure: firstLine(result.failure?.message)! }),
      ...(result.failure?.class === undefined
        ? {}
        : { failureClass: { tone: "fail" as const, label: result.failure.class } }),
      selected: false,
    };
    const steps = [...state.steps.filter((one) => one.stepId !== stepId), row];
    return {
      ...state,
      steps,
      totals: {
        passed: steps.filter((one) => one.status.label === "passed").length,
        failed: steps.filter((one) => one.status.label === "failed").length,
        skipped: steps.filter((one) => one.status.label === "skipped").length,
        healed: steps.filter((one) => one.status.label === "healed").length,
      },
      live: true,
    };
  }

  if (event.kind === "run.summary") {
    const summary = event["summary"] as SummaryResponse | undefined;
    if (summary === undefined) return state;
    return {
      ...state,
      live: false,
      totals: {
        passed: summary.totals?.passed ?? state.totals.passed,
        failed: summary.totals?.failed ?? state.totals.failed,
        skipped: summary.totals?.skipped ?? state.totals.skipped,
        healed: summary.totals?.healed ?? state.totals.healed,
      },
      outcome:
        PILL[
          Object.values(summary.flows ?? {}).some((one) => one.status === "aborted")
            ? "aborted"
            : (summary.totals?.failed ?? 0) > 0
              ? "failed"
              : "passed"
        ] ?? state.outcome,
      ...(summary.exitCode === undefined ? {} : { exitCode: summary.exitCode }),
    };
  }

  if (event.kind === "run.failed") {
    return { ...state, live: false, error: String(event["message"] ?? "The run failed.") };
  }

  return state;
}
