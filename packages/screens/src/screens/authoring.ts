/**
 * The authoring loop's four screens (T10.1, LLD §13.7).
 *
 * > `record` (session, decisions, re-pick through the snapshot, deadline),
 * > `runs` (list, filters, evidence inspector), `heal` (proposals, before and
 * > after, scores, apply), `bindings` (table, resolver order, verify, prune).
 *
 * Phase 9 modelled these four thinly — enough for T9.1's "every screen loads
 * against the fake service" — and rendered neither. This file is what the
 * `Results`, `Bindings`, `RecordReview` and `HealReview` artboards actually
 * show, and it is the only place that decides what any of it means: the ADE and
 * `yam ui` draw these rows differently and agree about every word in them.
 *
 * ## The two that have no `GET`
 *
 * `record` and `heal` are about a *session*, not a file. There is no
 * `GET /record` and inventing one would put state in the service the CLI cannot
 * produce (§13.5's rule, read from the other side). So they load their static
 * half — what could be recorded, which runs are worth healing — and fill the
 * rest from `record.decision`, `record.candidates` and `heal.proposal` on the
 * event stream, through `applyRecordEvent` and `applyHealEvent` below. The
 * renderers subscribe; neither of them decides what an event means.
 */
import { Sources, dotted, plural } from "../load.js";
import { actionsForScreen } from "../registry.js";
import type { ServiceEventLike } from "../service.js";
import type { Pill, Screen, ScreenParams, ScreenStateBase } from "../types.js";
import { parseBinding } from "../bindings.js";
import type {
  BindingFileResponse,
  BindingListRow,
  ProjectResponse,
  StepResultResponse,
  SummaryResponse,
} from "../shapes.js";

const PILL: Readonly<Record<string, Pill>> = {
  passed: { tone: "pass", label: "passed" },
  failed: { tone: "fail", label: "failed" },
  skipped: { tone: "skip", label: "skipped" },
  aborted: { tone: "abort", label: "aborted" },
  healed: { tone: "healed", label: "healed" },
  stopped: { tone: "abort", label: "stopped" },
  running: { tone: "info", label: "running" },
};
const NEUTRAL: Pill = { tone: "neutral", label: "not run" };

/** How a summary's outcome reads, in one place (T10.4 added `stopped`). */
export function outcomeOf(summary: SummaryResponse): Pill {
  if (summary.stopped === true) return PILL["stopped"]!;
  if (summary.endedAt === undefined) return PILL["running"]!;
  if (Object.values(summary.flows ?? {}).some((one) => one.status === "aborted")) {
    return PILL["aborted"]!;
  }
  if ((summary.totals?.failed ?? 0) > 0) return PILL["failed"]!;
  if ((summary.totals?.healed ?? 0) > 0) return PILL["healed"]!;
  return PILL["passed"]!;
}

/* ────────────────────────────────────────────────────────────────────────────
 * runs — the list, its filters and its evidence (the `Results` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RunsRow {
  readonly runId: string;
  readonly status: Pill;
  readonly behavior: string;
  readonly invoker: string;
  /** What the run was about: the flow, or the stories a `--story` run named. */
  readonly subject: string;
  /** When it ended, as an instant. The renderers say "4 min ago" (P9-F4). */
  readonly at: string;
  readonly passed: number;
  readonly failed: number;
  readonly skipped: number;
  readonly durationMs?: number;
  readonly exitCode?: number;
  readonly selected: boolean;
}

/** What the inspector shows about the selected run (the artboard's right column). */
export interface RunsInspector {
  readonly runId: string;
  readonly status: Pill;
  readonly behavior: string;
  readonly invoker: string;
  readonly startedAt: string;
  readonly durationMs?: number;
  readonly exitCode?: number;
  readonly planHash?: string;
  readonly bindingsHash?: string;
  /** The failing step, when there is one: the evidence a reader opens a run for. */
  readonly failure?: {
    readonly stepId: string;
    readonly text: string;
    readonly failureClass: Pill;
    readonly message: string;
    readonly screenshot?: string;
  };
  /** `results.jsonl`, `audit.jsonl`, and how many screenshots the run wrote. */
  readonly artifacts: readonly string[];
}

/** The filter chips the artboard shows. `all` is not a filter. */
export interface RunsFilters {
  readonly behavior: string;
  readonly invoker: string;
  readonly status: string;
}

export interface RunsState extends ScreenStateBase {
  readonly screen: "runs";
  readonly rows: readonly RunsRow[];
  readonly runId?: string;
  readonly filters: RunsFilters;
  /** Every value each chip could take, from the runs themselves. */
  readonly choices: Readonly<Record<keyof RunsFilters, readonly string[]>>;
  readonly inspector?: RunsInspector;
  /** How many runs there are before the filters, so a chip can say what it hid. */
  readonly total: number;
}

/** What a run was about, when the summary's `flows` key does not say. */
function subjectOf(summary: SummaryResponse, results: readonly StepResultResponse[]): string {
  const keys = Object.keys(summary.flows ?? {}).filter((one) => one !== "(selected)");
  if (keys.length > 0) return keys.map((one) => one.split("/").pop() ?? one).join(", ");
  /*
   * `yam run --story <name>` writes one `(selected)` entry, so the flow key
   * says nothing. The stories the results name are what the run was about, and
   * that is what the `Results` artboard's second column shows.
   */
  const stories = [...new Set(results.map((one) => one.story ?? "").filter((one) => one !== ""))];
  return stories.length === 0 ? "—" : stories.join(" · ");
}

const runsScreen: Screen<RunsState> = {
  id: "runs",
  title: "Runs",
  actions: actionsForScreen("runs"),
  keys: [
    { action: "go.run", key: "↵", terminal: "\r", description: "Open the selected run" },
    { action: "heal.run", key: "H", terminal: "h", description: "Heal the selected run" },
  ],
  async load(service, params: ScreenParams = {}): Promise<RunsState> {
    const sources = new Sources();
    const summaries = await sources.optional<SummaryResponse[]>(
      "GET /runs",
      () => service.getRuns(),
      [],
    );

    const filters: RunsFilters = {
      behavior: typeof params.behavior === "string" ? params.behavior : "all",
      invoker: typeof params.invoker === "string" ? params.invoker : "all",
      status: typeof params.status === "string" ? params.status : "all",
    };

    /*
     * The filters are applied to the *summaries*, before anything is read per
     * run. A screen that filtered rows it had already paid to build would be a
     * screen that reads thirty results files to show three.
     */
    const matching = summaries.filter(
      (one) =>
        (filters.behavior === "all" || (one.behavior ?? "test") === filters.behavior) &&
        (filters.invoker === "all" || (one.invoker?.kind ?? "") === filters.invoker) &&
        (filters.status === "all" || outcomeOf(one).label === filters.status),
    );

    const selected = params.runId ?? matching[0]?.runId;

    /*
     * One run's results, for the inspector. Not every run's: the list shows
     * what the summaries say, and the evidence belongs to the run a reader
     * chose (the `Results` artboard's right column).
     */
    const chosen = matching.find((one) => one.runId === selected);
    const results =
      selected === undefined
        ? []
        : await sources.optional<StepResultResponse[]>(
            `GET /runs/${selected}/results`,
            () => service.getRunsByIdResults(selected),
            [],
          );

    const rows: RunsRow[] = matching.map((summary) => ({
      runId: summary.runId ?? "",
      status: outcomeOf(summary),
      behavior: summary.behavior ?? "test",
      invoker: dotted(summary.invoker?.kind, summary.invoker?.id, summary.invoker?.via),
      subject: subjectOf(summary, summary.runId === selected ? results : []),
      at: summary.endedAt ?? summary.startedAt ?? "",
      passed: summary.totals?.passed ?? 0,
      failed: summary.totals?.failed ?? 0,
      skipped: summary.totals?.skipped ?? 0,
      ...(summary.startedAt === undefined || summary.endedAt === undefined
        ? {}
        : { durationMs: Date.parse(summary.endedAt) - Date.parse(summary.startedAt) }),
      ...(summary.exitCode === undefined ? {} : { exitCode: summary.exitCode }),
      selected: summary.runId === selected,
    }));

    const failing = results.find((one) => one.status === "failed");
    const inspector: RunsInspector | undefined =
      chosen === undefined
        ? undefined
        : {
            runId: chosen.runId ?? "",
            status: outcomeOf(chosen),
            behavior: chosen.behavior ?? "test",
            invoker: dotted(chosen.invoker?.kind, chosen.invoker?.id, chosen.invoker?.via),
            startedAt: chosen.startedAt ?? "",
            ...(chosen.startedAt === undefined || chosen.endedAt === undefined
              ? {}
              : { durationMs: Date.parse(chosen.endedAt) - Date.parse(chosen.startedAt) }),
            ...(chosen.exitCode === undefined ? {} : { exitCode: chosen.exitCode }),
            // Eight characters, as the artboards write a hash.
            ...(chosen.planHash === undefined ? {} : { planHash: chosen.planHash.slice(0, 8) }),
            ...(chosen.bindingsHash === undefined
              ? {}
              : { bindingsHash: chosen.bindingsHash.slice(0, 8) }),
            ...(failing === undefined
              ? {}
              : {
                  failure: {
                    stepId: failing.stepId ?? "",
                    text: failing.text ?? "",
                    failureClass: {
                      tone: "fail" as const,
                      label: failing.failure?.class ?? "unknown",
                    },
                    message: failing.failure?.message?.split("\n")[0] ?? "",
                    ...(failing.failure?.screenshot === undefined
                      ? {}
                      : { screenshot: failing.failure.screenshot.split("/").pop()! }),
                  },
                }),
            artifacts: [
              `${plural(results.length, "result")} · results.jsonl`,
              "audit.jsonl",
              plural(
                results.filter((one) => one.failure?.screenshot !== undefined).length,
                "screenshot",
              ),
            ],
          };

    const choices = {
      behavior: ["all", ...new Set(summaries.map((one) => one.behavior ?? "test"))],
      invoker: ["all", ...new Set(summaries.map((one) => one.invoker?.kind ?? "user"))],
      status: ["all", ...new Set(summaries.map((one) => outcomeOf(one).label))],
    };

    return {
      ...sources.base(
        "runs",
        "Runs",
        rows.length === 0
          ? summaries.length === 0
            ? "No runs yet"
            : `no run matches these filters (${plural(summaries.length, "run")} in all)`
          : dotted(
              plural(rows.length, "run"),
              rows.length === summaries.length ? undefined : `of ${summaries.length}`,
            ),
        selected ?? "`yam run` writes one",
      ),
      screen: "runs",
      rows,
      ...(selected === undefined ? {} : { runId: selected }),
      filters,
      choices,
      ...(inspector === undefined ? {} : { inspector }),
      total: summaries.length,
    };
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * bindings — the store, its resolver order and its verification
 * ──────────────────────────────────────────────────────────────────────────── */

export interface BindingCandidate {
  readonly by: string;
  readonly value: string;
  readonly score?: number;
}

export interface BindingRow {
  readonly elementId: string;
  readonly phrase?: string;
  /** The context's URL or window pattern: the artboard's `page` column. */
  readonly page?: string;
  readonly contexts: number;
  readonly verified: Pill;
  readonly candidates: number;
  readonly topCandidate?: string;
  /** Where the binding came from: `fake:grounding-cases`, `seed · migrate`. */
  readonly provenance?: string;
  readonly file?: string;
  readonly selected: boolean;
}

/** What the inspector shows about the selected binding (the `Bindings` artboard). */
export interface BindingInspector {
  readonly elementId: string;
  readonly file?: string;
  readonly phrases: readonly string[];
  readonly context?: string;
  readonly platform?: string;
  readonly verified: Pill;
  readonly candidates: readonly BindingCandidate[];
  /** Tag, attributes, own text and neighbours: REQ-REC-4's fingerprint. */
  readonly fingerprint: ReadonlyArray<{ key: string; value: string }>;
  readonly provenance: ReadonlyArray<{ key: string; value: string }>;
}

export interface BindingsState extends ScreenStateBase {
  readonly screen: "bindings";
  readonly rows: readonly BindingRow[];
  readonly bindingId?: string;
  readonly unverified: number;
  readonly inspector?: BindingInspector;
  /** What the last `bindings.verify` answered, when one has run here. */
  readonly verified?: unknown;
}

/** A candidate as one phrase: `testid "pay"`, `role button "Pay"`. */
const candidateText = (one: NonNullable<
  NonNullable<BindingFileResponse["entries"]>[number]["candidates"]
>[number]): string =>
  dotted(
    one.by,
    one.value === undefined ? undefined : `"${one.value}"`,
    one.role,
    one.name === undefined ? undefined : `"${one.name}"`,
  );

/** The fingerprint's fields, as the artboard's three rows. */
function fingerprintRows(
  fingerprint: Record<string, unknown> | undefined,
): Array<{ key: string; value: string }> {
  if (fingerprint === undefined) return [];
  const attrs = fingerprint["attrs"];
  const neighbours = fingerprint["neighbours"] as
    | { before?: string[]; after?: string[] }
    | undefined;
  const rolePath = fingerprint["rolePath"];
  return [
    { key: "Tag", value: String(fingerprint["tag"] ?? "—") },
    {
      key: "Attrs",
      value:
        typeof attrs === "object" && attrs !== null
          ? Object.entries(attrs as Record<string, unknown>)
              .map(([key, value]) => `${key}=${String(value)}`)
              .join(" · ")
          : "—",
    },
    { key: "Text", value: String(fingerprint["text"] ?? "—") },
    {
      key: "Neighbours",
      value:
        [...(neighbours?.before ?? []), ...(neighbours?.after ?? [])].join(" · ") || "—",
    },
    { key: "Role path", value: Array.isArray(rolePath) ? rolePath.join(" › ") : "—" },
    { key: "Sibling index", value: String(fingerprint["index"] ?? "—") },
  ];
}

const bindingsScreen: Screen<BindingsState> = {
  id: "bindings",
  title: "Bindings",
  actions: actionsForScreen("bindings"),
  keys: [
    { action: "bindings.verify", key: "V", terminal: "v", description: "Dry-resolve every binding" },
  ],
  async load(service, params: ScreenParams = {}): Promise<BindingsState> {
    const sources = new Sources();
    const list = await sources.optional<BindingListRow[]>(
      "GET /bindings",
      () => service.getBindings(),
      [],
    );

    /*
     * Every file, because this screen *is* the store.
     *
     * `GET /bindings` answers ids and paths; the candidates, the contexts and
     * the verification are in each file's YAML. The `Bindings` artboard shows a
     * table of all of them, so all of them are read — which is thirty small
     * requests against a loopback service for the fixtures project, and the
     * honest cost of a screen that shows the store rather than a summary of it.
     */
    const files = new Map<string, BindingFileResponse | undefined>();
    const rows: BindingRow[] = [];
    for (const row of list) {
      if (row.id === undefined) continue;
      const file = parseBinding(
        await sources.optional<string>(
          `GET /bindings/${row.id}`,
          () => service.getBindingsById(row.id!),
          "",
        ),
      );
      files.set(row.id, file);
      const entries = file?.entries ?? [];
      const entry = entries[0];
      const verified = entries.length > 0 && entries.every((one) => one.verified === true);
      const top = entry?.candidates?.[0];
      rows.push({
        elementId: row.id,
        ...(file?.phrases?.[0] === undefined ? {} : { phrase: file.phrases[0] }),
        ...(entry?.context?.pattern === undefined ? {} : { page: entry.context.pattern }),
        contexts: entries.length,
        verified: verified
          ? { tone: "pass", label: "verified" }
          : { tone: "abort", label: "unverified" },
        candidates: entry?.candidates?.length ?? 0,
        ...(top === undefined ? {} : { topCandidate: `${top.by ?? ""} #0`.trim() }),
        ...(entry?.provenance?.model === undefined
          ? {}
          : {
              provenance: dotted(entry.provenance.model, entry.provenance.promptVersion),
            }),
        ...(row.file === undefined ? {} : { file: row.file }),
        selected: false,
      });
    }

    const selected = params.bindingId ?? rows[0]?.elementId;
    const withSelection = rows.map((row) => ({ ...row, selected: row.elementId === selected }));
    const unverified = rows.filter((one) => one.verified.label === "unverified").length;

    const chosen = selected === undefined ? undefined : files.get(selected);
    const entry = chosen?.entries?.[0];
    const chosenRow = rows.find((one) => one.elementId === selected);
    const inspector: BindingInspector | undefined =
      chosen === undefined || selected === undefined
        ? undefined
        : {
            elementId: chosen.id ?? selected,
            ...(chosenRow?.file === undefined ? {} : { file: chosenRow.file }),
            phrases: chosen.phrases ?? [],
            ...(entry?.context === undefined
              ? {}
              : {
                  context: dotted(entry.context.pattern, entry.context.hash?.slice(0, 8)),
                  ...(entry.context.platform === undefined
                    ? {}
                    : { platform: entry.context.platform }),
                }),
            verified:
              entry?.verified === true
                ? { tone: "pass", label: "verified" }
                : { tone: "abort", label: "unverified" },
            candidates: (entry?.candidates ?? []).map((one) => ({
              by: one.by ?? "",
              value: candidateText(one).replace(/^[a-z]+ · /, ""),
              ...(one.score === undefined ? {} : { score: one.score }),
            })),
            fingerprint: fingerprintRows(entry?.fingerprint),
            provenance: [
              { key: "Grounded by", value: entry?.provenance?.model ?? "—" },
              { key: "Prompt", value: entry?.provenance?.promptVersion ?? "—" },
              { key: "Recorded", value: entry?.recordedAt ?? entry?.provenance?.at ?? "—" },
              {
                key: "Cost",
                value:
                  entry?.provenance?.costUsd === undefined
                    ? "—"
                    : `${entry.provenance.tokensIn ?? 0} in · ${entry.provenance.tokensOut ?? 0} out · $${entry.provenance.costUsd}`,
              },
            ],
          };

    return {
      ...sources.base(
        "bindings",
        "Bindings",
        dotted(plural(rows.length, "element"), `${unverified} unverified`),
        selected ?? "",
      ),
      screen: "bindings",
      rows: withSelection,
      ...(selected === undefined ? {} : { bindingId: selected }),
      unverified,
      ...(inspector === undefined ? {} : { inspector }),
    };
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * record — the session and its decisions (the `RecordReview` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

/** One grounding waiting on a reviewer (REQ-ADE-4, the `record.decision` event). */
export interface RecordDecision {
  readonly target: string;
  readonly phrase?: string;
  readonly step?: string;
  /** The snapshot excerpt the model was shown, as lines the screen highlights. */
  readonly snapshot: readonly string[];
  /** Which line of `snapshot` the model chose. */
  readonly chose?: number;
  readonly ref?: string;
  readonly candidates: readonly BindingCandidate[];
  readonly fingerprint: ReadonlyArray<{ key: string; value: string }>;
  /** Model, prompt version, tokens and cost (REQ-AGT-3). */
  readonly provenance: ReadonlyArray<{ key: string; value: string }>;
  /** When the session stops waiting (`record.decisionDeadlineMs`, Draft 2.7). */
  readonly expiresAt?: string;
}

export interface RecordState extends ScreenStateBase {
  readonly screen: "record";
  readonly sessionId?: string;
  /**
   * The gateways this service can actually reach (REQ-ADE-4, Draft 2.7).
   *
   * `anthropic` only when `GET /project` reports a credential — the screen
   * offers what it can do rather than an option that fails on submit — and
   * `fake` always, labelled as the committed answers it is.
   */
  readonly gateways: ReadonlyArray<{ id: string; label: string; available: boolean }>;
  readonly gateway: string;
  readonly flows: readonly string[];
  /** The flow the Record button would record. */
  readonly file?: string;
  /** The grounding waiting on a reviewer, when one is. */
  readonly decision?: RecordDecision;
  /** Every decision this session has settled, newest last. */
  readonly decisions: ReadonlyArray<{ target: string; outcome: Pill; by?: string }>;
  /** The steps the session has performed, as `record.step` reports them. */
  readonly steps: ReadonlyArray<{ text: string; status: Pill }>;
  /** A session that ended badly: the alert the artboard shows (Draft 2.7). */
  readonly failure?: { message: string; advice: string };
}

/** `{ by, value, score }` off whatever shape a candidate arrived in. */
function candidatesOf(value: unknown): BindingCandidate[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((one): one is Record<string, unknown> => typeof one === "object" && one !== null)
    .map((one) => ({
      by: String(one["by"] ?? ""),
      value: dotted(
        typeof one["value"] === "string" ? `"${one["value"]}"` : undefined,
        typeof one["role"] === "string" ? one["role"] : undefined,
        typeof one["name"] === "string" ? `"${one["name"]}"` : undefined,
      ),
      ...(typeof one["score"] === "number" ? { score: one["score"] } : {}),
    }));
}

/** `{ key, value }` rows off an object, for the inspector's grids. */
function rowsOf(value: unknown, keys: readonly string[]): Array<{ key: string; value: string }> {
  const one = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  return keys.map((key) => ({
    key: key[0]!.toUpperCase() + key.slice(1),
    value: one[key] === undefined || one[key] === null ? "—" : String(one[key]),
  }));
}

const recordScreen: Screen<RecordState> = {
  id: "record",
  title: "Record review",
  actions: actionsForScreen("record"),
  keys: [
    { action: "record.accept", key: "A", terminal: "a", description: "Accept the grounding" },
    { action: "record.repick", key: "P", terminal: "p", description: "Re-pick in the session" },
    { action: "record.reject", key: "X", terminal: "x", description: "Reject the grounding" },
    { action: "record.stop", key: "Q", terminal: "q", description: "Stop the session" },
  ],
  async load(service, params: ScreenParams = {}): Promise<RecordState> {
    const sources = new Sources();
    const project = await sources.get<ProjectResponse>("GET /project", () => service.getProject(), {});
    const credential = project.gateway?.credential === true;
    const file = params.file ?? project.flows?.[0];
    return {
      ...sources.base(
        "record",
        "Record review",
        params.sessionId === undefined
          ? dotted("No session", file === undefined ? undefined : `would record ${file.split("/").pop()}`)
          : `session ${params.sessionId}`,
        credential ? "a model credential is available" : "no model credential on this service",
      ),
      screen: "record",
      ...(params.sessionId === undefined ? {} : { sessionId: params.sessionId }),
      gateways: [
        {
          id: "anthropic",
          label: credential
            ? "anthropic — the service's credential"
            : "anthropic — no credential on this service",
          available: credential,
        },
        {
          id: "fake",
          label: "fake — committed answers from evals/grounding/cases",
          available: true,
        },
      ],
      gateway:
        typeof params.gateway === "string"
          ? params.gateway
          : credential
            ? "anthropic"
            : "fake",
      flows: project.flows ?? [],
      ...(file === undefined ? {} : { file }),
      decisions: [],
      steps: [],
    };
  },
};

/**
 * Fold one event into the Record screen's state (LLD §13.5's stream).
 *
 * The renderers subscribe once and call this; neither of them decides what a
 * `record.decision` means. A screen that had built the decision itself would be
 * a screen that could disagree with the other renderer about what the model
 * chose.
 */
export function applyRecordEvent(state: RecordState, event: ServiceEventLike): RecordState {
  if (event["sessionId"] !== undefined && event["sessionId"] !== state.sessionId) {
    // A session id we do not have yet is this session starting.
    if (state.sessionId !== undefined) return state;
  }

  if (event.kind === "record.decision") {
    const proposal = (event["proposal"] ?? event["decision"] ?? {}) as Record<string, unknown>;
    const snapshot = proposal["snapshot"];
    return {
      ...state,
      ...(typeof event["sessionId"] === "string" ? { sessionId: event["sessionId"] } : {}),
      decision: {
        target: String(proposal["target"] ?? proposal["id"] ?? ""),
        ...(typeof proposal["phrase"] === "string" ? { phrase: proposal["phrase"] } : {}),
        ...(typeof proposal["step"] === "string" ? { step: proposal["step"] } : {}),
        snapshot:
          typeof snapshot === "string"
            ? snapshot.split("\n")
            : Array.isArray(snapshot)
              ? snapshot.map((one) => String(one))
              : [],
        ...(typeof proposal["chose"] === "number" ? { chose: proposal["chose"] } : {}),
        ...(typeof proposal["ref"] === "string" ? { ref: proposal["ref"] } : {}),
        candidates: candidatesOf(proposal["candidates"]),
        fingerprint: rowsOf(proposal["fingerprint"], ["tag", "text", "attrs", "index"]),
        provenance: rowsOf(proposal["provenance"], [
          "model",
          "promptVersion",
          "tokensIn",
          "tokensOut",
          "costUsd",
        ]),
        ...(typeof proposal["expiresAt"] === "string"
          ? { expiresAt: proposal["expiresAt"] }
          : {}),
      },
    };
  }

  if (event.kind === "record.candidates") {
    if (state.decision === undefined) return state;
    return {
      ...state,
      decision: { ...state.decision, candidates: candidatesOf(event["candidates"]) },
    };
  }

  if (event.kind === "record.decided") {
    const outcome = String(event["outcome"] ?? "accepted");
    return {
      ...state,
      ...(state.decision === undefined
        ? {}
        : {
            decisions: [
              ...state.decisions,
              {
                target: state.decision.target,
                outcome:
                  outcome === "accepted"
                    ? { tone: "pass" as const, label: "accepted" }
                    : outcome === "repicked"
                      ? { tone: "healed" as const, label: "re-picked" }
                      : { tone: "fail" as const, label: "rejected" },
                ...(typeof event["ref"] === "string" ? { by: event["ref"] } : {}),
              },
            ],
          }),
      decision: undefined,
    };
  }

  if (event.kind === "record.step") {
    const step = (event["step"] ?? {}) as Record<string, unknown>;
    return {
      ...state,
      steps: [
        ...state.steps,
        {
          text: String(step["text"] ?? ""),
          status: PILL[String(step["status"] ?? "passed")] ?? NEUTRAL,
        },
      ],
    };
  }

  if (event.kind === "record.failed") {
    return {
      ...state,
      decision: undefined,
      failure: {
        message: String(event["message"] ?? "The recording session stopped."),
        /*
         * Advice written for the screen, never a CLI flag (REQ-ADE-4,
         * Draft 2.7). Whoever is looking at this pressed a button; telling them
         * to pass `--rebind` is telling them to leave.
         */
        advice: String(
          event["advice"] ??
            "Nothing was written to the bindings store. Check that the application is " +
              "running at the project's base URL, then press Record again.",
        ),
      },
    };
  }

  if (event.kind === "record.stopped" || event.kind === "record.finished") {
    return { ...state, decision: undefined };
  }

  return state;
}

/* ────────────────────────────────────────────────────────────────────────────
 * heal — the proposals (the `HealReview` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

/** One repair the healer proposes: before, after, and why (REQ-HEAL-2). */
export interface HealProposal {
  readonly elementId: string;
  readonly phrase?: string;
  readonly method: string;
  /** The candidate list as it is, and as the healer would write it. */
  readonly before: readonly BindingCandidate[];
  readonly after: readonly BindingCandidate[];
  /** The relocalization scores the decision turned on (REQ-HEAL-1). */
  readonly scores: ReadonlyArray<{ key: string; value: number }>;
  readonly confidence?: number;
  /** Whether the repair was re-verified by re-running the story (REQ-HEAL-3). */
  readonly verified?: Pill;
  readonly applied: boolean;
}

export interface HealState extends ScreenStateBase {
  readonly screen: "heal";
  readonly runId?: string;
  /** Runs with a failure worth healing: what the screen offers to heal. */
  readonly candidates: ReadonlyArray<{
    runId: string;
    failed: number;
    at: string;
    subject: string;
    selected: boolean;
  }>;
  /** Proposals arrive on `heal.proposal`; there is no route that lists them. */
  readonly proposal?: HealProposal;
  readonly proposals: readonly HealProposal[];
  /** What the healer said when it finished: repaired, unrepaired, and why. */
  readonly report?: { repaired: number; unrepaired: number; message: string };
}

const healScreen: Screen<HealState> = {
  id: "heal",
  title: "Heal review",
  actions: actionsForScreen("heal"),
  keys: [
    { action: "heal.apply", key: "A", terminal: "a", description: "Apply the proposal" },
    { action: "heal.run", key: "H", terminal: "h", description: "Heal the selected run" },
  ],
  async load(service, params: ScreenParams = {}): Promise<HealState> {
    const sources = new Sources();
    const summaries = await sources.optional<SummaryResponse[]>(
      "GET /runs",
      () => service.getRuns(),
      [],
    );
    const worth = summaries.filter((one) => (one.totals?.failed ?? 0) > 0);
    const runId = params.runId ?? worth[0]?.runId;
    const candidates = worth.map((one) => ({
      runId: one.runId ?? "",
      failed: one.totals?.failed ?? 0,
      at: one.endedAt ?? "",
      subject: subjectOf(one, []),
      selected: one.runId === runId,
    }));
    return {
      ...sources.base(
        "heal",
        "Heal review",
        candidates.length === 0
          ? "No run has a failure to heal"
          : `${plural(candidates.length, "run")} with a failure`,
        runId ?? "`yam heal --run <id>` does the same thing",
      ),
      screen: "heal",
      ...(runId === undefined ? {} : { runId }),
      candidates,
      proposals: [],
    };
  },
};

/** One proposal off a `heal.proposal` event, whatever else came with it. */
function proposalOf(value: unknown): HealProposal | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const one = value as Record<string, unknown>;
  const elementId = one["id"] ?? one["elementId"];
  if (typeof elementId !== "string") return undefined;
  const scores = one["scores"];
  return {
    elementId,
    ...(typeof one["phrase"] === "string" ? { phrase: one["phrase"] } : {}),
    method: String(one["method"] ?? "relocalize"),
    before: candidatesOf(one["before"]),
    after: candidatesOf(one["after"]),
    scores:
      typeof scores === "object" && scores !== null
        ? Object.entries(scores as Record<string, unknown>)
            .filter(([, score]) => typeof score === "number")
            .map(([key, score]) => ({ key, value: score as number }))
        : [],
    ...(typeof one["confidence"] === "number" ? { confidence: one["confidence"] } : {}),
    ...(one["verified"] === undefined
      ? {}
      : {
          verified:
            one["verified"] === true
              ? { tone: "pass" as const, label: "re-ran green" }
              : { tone: "fail" as const, label: "did not verify" },
        }),
    applied: one["applied"] === true,
  };
}

/** Fold one event into the Heal screen's state (LLD §13.5's stream). */
export function applyHealEvent(state: HealState, event: ServiceEventLike): HealState {
  if (event.kind === "heal.proposal") {
    const proposal = proposalOf(event["proposal"] ?? event);
    if (proposal === undefined) return state;
    return {
      ...state,
      proposal,
      proposals: [...state.proposals.filter((one) => one.elementId !== proposal.elementId), proposal],
    };
  }

  if (event.kind === "heal.applied") {
    const elementId = event["id"] ?? event["elementId"];
    if (typeof elementId !== "string") return state;
    const applied = (one: HealProposal): HealProposal =>
      one.elementId === elementId ? { ...one, applied: true } : one;
    return {
      ...state,
      ...(state.proposal === undefined ? {} : { proposal: applied(state.proposal) }),
      proposals: state.proposals.map(applied),
    };
  }

  if (event.kind === "heal.summary" || event.kind === "heal.finished") {
    const repaired = Number(event["repaired"] ?? 0);
    const unrepaired = Number(event["unrepaired"] ?? 0);
    return {
      ...state,
      report: {
        repaired,
        unrepaired,
        message: String(
          event["message"] ??
            `${plural(repaired, "binding")} repaired, ${unrepaired} still failing.`,
        ),
      },
    };
  }

  return state;
}

export const AUTHORING_SCREENS = [
  runsScreen,
  bindingsScreen,
  recordScreen,
  healScreen,
] as const satisfies readonly Screen[];
