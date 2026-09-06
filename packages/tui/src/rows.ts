/**
 * What each pane shows, for every screen (T10.1, T10.2, REQ-TUI-1, LLD §13.7).
 *
 * The cockpit draws four panes, and twelve screens have to fill them. This file
 * is the whole of "which of the model's rows go where", as *data* — a title and
 * a list of lines, each line a list of cells — so `panes.tsx` is a renderer of
 * one shape rather than a `switch` with twelve arms in four places.
 *
 * Nothing here computes a number, a status word or a label. Every string is the
 * model's; what this decides is which pane it belongs in and how wide its column
 * is, which is a terminal's business and not the app's.
 *
 * `select` is what `Enter` does to a row: the screen parameters to re-load with.
 * Selection is a *screen parameter* in both renderers (§13.7), so opening a row
 * in the cockpit and clicking it in the app reach the same state.
 */
import type { StatusTone } from "@svatah/yam-ui-tokens";
import {
  ago,
  type AgentsState,
  type ApiState,
  type BindingsState,
  type DataState,
  type ExplorerState,
  type FlowsState,
  type HealState,
  type ImportState,
  type RecordState,
  type RunState,
  type RunsState,
  type ScreenParams,
  type ScreenStateBase,
  type SettingsState,
} from "@svatah/yam-screens";

/** One column of a line. `grow` takes whatever width is left over. */
export interface Cell {
  readonly text: string;
  /** A status tone colours it, and the *word* is always the text (LLD §13.7). */
  readonly tone?: StatusTone;
  /** Grey: a secondary column. */
  readonly dim?: boolean;
  /** A fixed width in characters; `grow` when it should take the rest. */
  readonly width?: number;
  readonly grow?: boolean;
}

export interface Line {
  readonly key: string;
  readonly cells: readonly Cell[];
  /** What `Enter` on this row re-loads the screen with. */
  readonly select?: ScreenParams;
}

export interface PaneContent {
  readonly title: string;
  readonly lines: readonly Line[];
  /** One line under the rows: a lint summary, an exit code, a total. */
  readonly footer?: Cell;
  /** When there is nothing: what the screen says instead of drawing a blank. */
  readonly empty: string;
}

export interface PaneModel {
  readonly tree: PaneContent;
  readonly main: PaneContent;
  readonly inspector: PaneContent;
  readonly audit: PaneContent;
}

const text = (one: string, extra: Partial<Cell> = {}): Cell => ({ text: one, ...extra });
const dim = (one: string, extra: Partial<Cell> = {}): Cell => ({ text: one, dim: true, ...extra });
const pill = (one: { tone: StatusTone; label: string }, width = 10): Cell => ({
  text: one.label,
  tone: one.tone,
  width,
});

/** A key–value line, which is what every inspector is made of. */
const kv = (key: string, value: string, tone?: StatusTone): Line => ({
  key,
  cells: [dim(key, { width: 13 }), { text: value, grow: true, ...(tone === undefined ? {} : { tone }) }],
});

/** A heading inside a pane: the artboards' small upper-case section labels. */
const heading = (one: string): Line => ({ key: `heading:${one}`, cells: [dim(one.toUpperCase())] });

const none: PaneContent = { title: "—", lines: [], empty: "nothing here" };

/* ────────────────────────────────────────────────────────────────────────────
 * The twelve
 * ──────────────────────────────────────────────────────────────────────────── */

export function paneModel(state: ScreenStateBase, now: number = Date.now()): PaneModel {
  switch (state.screen) {
    case "flows":
      return flows(state as FlowsState, now);
    case "run":
      return runScreen(state as RunState);
    case "runs":
      return runs(state as RunsState, now);
    case "bindings":
      return bindings(state as BindingsState);
    case "record":
      return record(state as RecordState);
    case "heal":
      return heal(state as HealState, now);
    case "agents":
      return agents(state as AgentsState);
    case "api":
      return api(state as ApiState);
    case "data":
      return data(state as DataState);
    case "explorer":
      return explorer(state as ExplorerState);
    case "import":
      return importing(state as ImportState);
    case "settings":
      return settings(state as SettingsState);
    default:
      return { tree: none, main: none, inspector: none, audit: none };
  }
}

function flows(state: FlowsState, now: number): PaneModel {
  return {
    tree: {
      title: "Flows",
      empty: "no flow files",
      lines: state.files.map((file) => ({
        key: file.file,
        cells: [
          text(file.name, { grow: true }),
          pill(file.status),
          ...(ago(file.lastRunAt, now) === undefined ? [] : [dim(ago(file.lastRunAt, now)!)]),
        ],
        select: { file: file.file, selected: undefined },
      })),
    },
    main: {
      title: state.file ?? "Flows",
      empty: "no file open",
      lines: state.lines.map((line) => ({
        key: String(line.line),
        cells: [
          dim(String(line.line).padStart(3), { width: 3 }),
          ...(line.outcome === undefined
            ? [text(" ", { width: 1 })]
            : [{ text: GLYPH[line.outcome.tone], tone: line.outcome.tone, width: 1 }]),
          text(line.text, { grow: true }),
          ...(line.note === undefined ? [] : [dim(line.note, { width: 16 })]),
        ],
        select: { selected: `line:${line.line}` },
      })),
      ...(state.lint.length === 0
        ? {}
        : {
            footer: {
              text: `lint: ${state.lint.length} — ${state.lint[0]?.code ?? ""} ${state.lint[0]?.message ?? ""}`,
              tone: "abort" as const,
            },
          }),
    },
    inspector: {
      title: state.inspector === undefined ? "Inspect" : `Step ${state.inspector.line}`,
      empty: "no step selected",
      lines:
        state.inspector === undefined
          ? []
          : [
              { key: "text", cells: [text(state.inspector.text, { grow: true })] },
              kv("tier", state.inspector.tier === undefined ? "—" : String(state.inspector.tier)),
              kv("target", state.inspector.target ?? "—"),
              kv(
                "binding",
                state.inspector.binding === undefined
                  ? "—"
                  : state.inspector.binding.verified
                    ? "verified"
                    : "unverified",
                state.inspector.binding?.verified === true ? "pass" : "abort",
              ),
              kv("guard", state.inspector.guard ?? "—"),
              kv("last run", state.inspector.lastRun ?? "—"),
              ...(state.inspector.binding === undefined
                ? []
                : [
                    heading("candidates"),
                    ...state.inspector.binding.candidates.map((one, at) => ({
                      key: `${one.by}-${one.value}-${at}`,
                      cells: [
                        dim(one.by, { width: 8 }),
                        text(one.value, { grow: true }),
                        dim(one.score === undefined ? "" : String(one.score), { width: 5 }),
                      ],
                    })),
                  ]),
            ],
    },
    audit: {
      title: "Lint",
      empty: "nothing to report",
      lines: state.lint.map((one, at) => ({
        // Two diagnostics can share a code and a line (a project with two
        // unset secrets reports `W_SECRET_UNSET` twice at line 0), so the index
        // is part of the key rather than a fallback for a missing line.
        key: `${one.code ?? ""}-${one.line ?? ""}-${at}`,
        cells: [
          dim(String(one.line ?? ""), { width: 5 }),
          dim(one.code ?? "", { width: 22 }),
          {
            text: one.message ?? "",
            grow: true,
            tone: one.severity === "error" ? ("fail" as const) : ("abort" as const),
          },
        ],
      })),
    },
  };
}

function runScreen(state: RunState): PaneModel {
  return {
    tree: {
      title: "Stories",
      empty: "this run touched no story",
      lines: state.stories.map((story) => ({
        key: story.story,
        cells: [text(story.story, { grow: true }), pill(story.status)],
        select: { story: story.story },
      })),
    },
    main: {
      title: `Run ${state.runId ?? "—"} · ${state.outcome.label}`,
      empty: state.subtitle,
      lines: state.steps.map((step) => ({
        key: step.stepId,
        cells: [
          { text: GLYPH[step.status.tone], tone: step.status.tone, width: 1 },
          dim(String(step.index).padStart(2), { width: 2 }),
          text(step.text, { grow: true }),
          dim(step.detail ?? "", { width: 12 }),
          dim(step.durationMs === undefined ? "" : `${step.durationMs} ms`, { width: 8 }),
        ],
        select: { selected: step.stepId },
      })),
      ...(state.exitCode === undefined
        ? {}
        : {
            footer: {
              text: `flow ${state.outcome.label} · exit ${state.exitCode}`,
              tone: state.outcome.tone,
            },
          }),
    },
    inspector: {
      title: state.inspector?.title ?? "Inspect",
      empty: "no step selected",
      lines:
        state.inspector === undefined
          ? []
          : [
              kv(
                "failure",
                state.inspector.failureClass?.label ?? "none",
                state.inspector.failureClass?.tone,
              ),
              kv("session", state.inspector.session ?? "—"),
              kv("window", state.inspector.windowTitle ?? "—"),
              kv("dialog", state.inspector.dialog ?? "none"),
              kv("policy", state.inspector.policy ?? "—"),
              ...(state.inspector.candidatesTried.length === 0
                ? []
                : [
                    heading("candidates tried"),
                    ...state.inspector.candidatesTried.map((one, at) => ({
                      key: `${one.by}-${one.value}-${at}`,
                      cells: [
                        dim(one.by, { width: 8 }),
                        text(one.value, { grow: true }),
                        { text: String(one.matched), tone: "fail" as const, width: 3 },
                      ],
                    })),
                  ]),
              ...(state.inspector.screenshot === undefined
                ? []
                : [kv("screenshot", state.inspector.screenshot)]),
              ...(state.inspector.advice === undefined
                ? []
                : [heading("what to do"), { key: "advice", cells: [text(state.inspector.advice, { grow: true })] }]),
            ],
    },
    audit: {
      title: `Audit${state.live ? " · live" : ""}`,
      empty: "this run wrote no audit lines",
      lines: state.audit.map((line) => ({
        key: String(line.seq),
        cells: [
          dim(line.at, { width: 6 }),
          dim(line.kind, { width: 10 }),
          {
            text: line.text,
            grow: true,
            ...(line.tone === "neutral" ? {} : { tone: line.tone }),
          },
        ],
      })),
      footer: dim("yam ui --json streams these same lines to stdout for an agent"),
    },
  };
}

function runs(state: RunsState, now: number): PaneModel {
  const inspector = state.inspector;
  return {
    tree: {
      title: `Filters · ${state.rows.length} of ${state.total}`,
      empty: "no runs yet",
      lines: [
        heading("behavior"),
        ...state.choices.behavior.map((one) => ({
          key: `behavior:${one}`,
          cells: [
            text(one === state.filters.behavior ? `▸ ${one}` : `  ${one}`, { grow: true }),
          ],
          select: { behavior: one },
        })),
        heading("invoker"),
        ...state.choices.invoker.map((one) => ({
          key: `invoker:${one}`,
          cells: [text(one === state.filters.invoker ? `▸ ${one}` : `  ${one}`, { grow: true })],
          select: { invoker: one },
        })),
        heading("status"),
        ...state.choices.status.map((one) => ({
          key: `status:${one}`,
          cells: [text(one === state.filters.status ? `▸ ${one}` : `  ${one}`, { grow: true })],
          select: { status: one },
        })),
      ],
    },
    main: {
      title: "Runs",
      empty: state.total === 0 ? "`yam run` writes one" : "no run matches these filters",
      lines: state.rows.map((row) => ({
        key: row.runId,
        cells: [
          text(row.runId, { width: 14 }),
          text(row.subject, { grow: true }),
          dim(row.behavior, { width: 9 }),
          pill(row.status),
          dim(`${row.passed} · ${row.failed} · ${row.skipped}`, { width: 12 }),
          dim(ago(row.at, now)?.replace("run ", "") ?? "", { width: 12 }),
        ],
        select: { runId: row.runId },
      })),
    },
    inspector: {
      title: inspector === undefined ? "Inspect" : `Run ${inspector.runId}`,
      empty: "no run selected",
      lines:
        inspector === undefined
          ? []
          : [
              kv("outcome", inspector.status.label, inspector.status.tone),
              kv("behavior", inspector.behavior),
              kv("invoker", inspector.invoker),
              kv(
                "duration",
                inspector.durationMs === undefined
                  ? "—"
                  : `${(inspector.durationMs / 1000).toFixed(2)} s`,
              ),
              kv("exit", inspector.exitCode === undefined ? "—" : String(inspector.exitCode)),
              kv("plan", inspector.planHash ?? "—"),
              kv("bindings", inspector.bindingsHash ?? "—"),
              ...(inspector.failure === undefined
                ? []
                : [
                    heading("failing step"),
                    { key: "failing", cells: [text(inspector.failure.text, { grow: true })] },
                    kv("class", inspector.failure.failureClass.label, "fail"),
                    { key: "why", cells: [dim(inspector.failure.message, { grow: true })] },
                    ...(inspector.failure.screenshot === undefined
                      ? []
                      : [kv("screenshot", inspector.failure.screenshot)]),
                  ]),
              heading("artifacts"),
              ...inspector.artifacts.map((one, at) => ({
                key: `artifact-${at}`,
                cells: [dim(one, { grow: true })],
              })),
            ],
    },
    audit: {
      title: "Runs · newest first",
      empty: "no runs yet",
      lines: state.rows.slice(0, 12).map((row) => ({
        key: `tail-${row.runId}`,
        cells: [
          dim(ago(row.at, now)?.replace("run ", "") ?? "", { width: 12 }),
          dim(row.runId, { width: 14 }),
          { text: row.subject, grow: true, tone: row.status.tone },
        ],
      })),
    },
  };
}

function bindings(state: BindingsState): PaneModel {
  const inspector = state.inspector;
  return {
    tree: {
      title: `Elements · ${state.unverified} unverified`,
      empty: "no bindings yet",
      lines: state.rows.map((row) => ({
        key: row.elementId,
        cells: [text(row.elementId, { grow: true }), pill(row.verified, 11)],
        select: { bindingId: row.elementId },
      })),
    },
    main: {
      title: "Bindings",
      empty: "`yam record` writes them",
      lines: state.rows.map((row) => ({
        key: `main-${row.elementId}`,
        cells: [
          text(row.elementId, { width: 32 }),
          dim(row.phrase ?? "", { grow: true }),
          dim(row.page ?? "", { width: 14 }),
          dim(row.topCandidate ?? "—", { width: 12 }),
          pill(row.verified, 11),
        ],
        select: { bindingId: row.elementId },
      })),
    },
    inspector: {
      title: inspector?.elementId ?? "Inspect",
      empty: "no binding selected",
      lines:
        inspector === undefined
          ? []
          : [
              kv("phrases", inspector.phrases.join(" · ") || "—"),
              kv("context", inspector.context ?? "—"),
              kv("platform", inspector.platform ?? "—"),
              kv("state", inspector.verified.label, inspector.verified.tone),
              heading("candidates · resolver order"),
              ...inspector.candidates.map((one, at) => ({
                key: `candidate-${at}`,
                cells: [
                  dim(String(at), { width: 2 }),
                  dim(one.by, { width: 8 }),
                  text(one.value, { grow: true }),
                  dim(one.score === undefined ? "" : String(one.score), { width: 5 }),
                ],
              })),
              heading("fingerprint"),
              ...inspector.fingerprint.map((one) => kv(one.key.toLowerCase(), one.value)),
              heading("provenance"),
              ...inspector.provenance.map((one) => kv(one.key.toLowerCase(), one.value)),
            ],
    },
    audit: {
      title: "Store",
      empty: "no bindings yet",
      lines: state.rows
        .filter((one) => one.verified.label !== "verified")
        .map((row) => ({
          key: `unverified-${row.elementId}`,
          cells: [
            dim("unverified", { width: 12 }),
            { text: row.elementId, grow: true, tone: "abort" as const },
            dim(row.file ?? "", { width: 40 }),
          ],
        })),
      footer: dim(`${state.rows.length} element(s) · ${state.unverified} unverified`),
    },
  };
}

function record(state: RecordState): PaneModel {
  const decision = state.decision;
  return {
    tree: {
      title: "Gateway",
      empty: "no gateway",
      lines: [
        ...state.gateways.map((one) => ({
          key: one.id,
          cells: [
            text(one.id === state.gateway ? `▸ ${one.id}` : `  ${one.id}`, {
              grow: true,
              ...(one.available ? {} : { dim: true }),
            }),
          ],
          ...(one.available ? { select: { gateway: one.id } } : {}),
        })),
        heading("flows"),
        ...state.flows.map((one) => ({
          key: one,
          cells: [text(one === state.file ? `▸ ${one.split("/").pop()}` : `  ${one.split("/").pop()}`, { grow: true })],
          select: { file: one },
        })),
      ],
    },
    main: {
      title:
        state.sessionId === undefined
          ? "Record review · no session"
          : state.capturing
            ? `Recording what you do · ${state.sessionId}`
            : `Session ${state.sessionId}`,
      empty:
        state.sessionId === undefined
          ? "press R on the Flows screen to record what you do, B to bind a flow"
          : state.capturing
            ? "drive the application; each thing you do becomes a sentence"
            : "waiting for the first grounding",
      lines: [
        /*
         * The sentences a capture is writing (Draft 2.23). The cockpit shows
         * the same session the app does, so it shows them here too.
         */
        ...(state.sentences.length === 0
          ? []
          : [
              heading(state.captured === undefined ? "the flow so far" : "the flow"),
              ...state.sentences.map((sentence, at) => ({
                key: `sentence-${at}`,
                cells: [dim(String(at + 1), { width: 3 }), text(sentence, { grow: true })],
              })),
            ]),
        ...(state.captured === undefined
          ? []
          : [
              kv("wrote", state.captured.file),
              kv("story", state.captured.story),
              kv("bound", String(state.captured.bound)),
              ...(state.captured.unbound.length === 0
                ? []
                : [kv("not bound", state.captured.unbound.join(", "))]),
            ]),
        ...(decision === undefined
          ? []
          : [
              heading(`grounding ${decision.target}`),
              ...decision.snapshot.map((line, at) => ({
                key: `snap-${at}`,
                cells: [
                  {
                    text: line,
                    grow: true,
                    ...(at === decision.chose ? { tone: "info" as const } : { dim: true }),
                  },
                ],
              })),
            ]),
        ...state.steps.map((step, at) => ({
          key: `step-${at}`,
          cells: [
            { text: GLYPH[step.status.tone], tone: step.status.tone, width: 1 },
            text(step.text, { grow: true }),
          ],
        })),
      ],
      ...(state.failure === undefined
        ? {}
        : { footer: { text: state.failure.message, tone: "fail" as const } }),
    },
    inspector: {
      title: decision === undefined ? "Decision" : decision.target,
      empty:
        state.sessionId === undefined
          ? "no session"
          : "nothing is waiting for a decision",
      lines:
        decision === undefined
          ? []
          : [
              kv("phrase", decision.phrase ?? "—"),
              kv("step", decision.step ?? "—"),
              kv("chose", decision.ref ?? "—"),
              ...(decision.expiresAt === undefined ? [] : [kv("expires", decision.expiresAt)]),
              heading("candidates"),
              ...decision.candidates.map((one, at) => ({
                key: `candidate-${at}`,
                cells: [
                  dim(String(at), { width: 2 }),
                  dim(one.by, { width: 8 }),
                  text(one.value, { grow: true }),
                  dim(one.score === undefined ? "" : String(one.score), { width: 5 }),
                ],
              })),
              heading("fingerprint"),
              ...decision.fingerprint.map((one) => kv(one.key.toLowerCase(), one.value)),
              heading("provenance"),
              ...decision.provenance.map((one) => kv(one.key.toLowerCase(), one.value)),
            ],
    },
    audit: {
      title: "Decisions",
      empty: "no decision has been settled yet",
      lines: [
        ...state.decisions.map((one, at) => ({
          key: `decided-${at}`,
          cells: [
            pill(one.outcome, 11),
            text(one.target, { grow: true }),
            dim(one.by ?? "", { width: 12 }),
          ],
        })),
        ...(state.failure === undefined
          ? []
          : [
              {
                key: "advice",
                cells: [{ text: state.failure.advice, grow: true, tone: "abort" as const }],
              },
            ]),
      ],
    },
  };
}

function heal(state: HealState, now: number): PaneModel {
  const proposal = state.proposal;
  return {
    tree: {
      title: "Runs with a failure",
      empty: "nothing to heal",
      lines: state.candidates.map((one) => ({
        key: one.runId,
        cells: [
          text(one.selected ? `▸ ${one.runId}` : `  ${one.runId}`, { grow: true }),
          { text: `${one.failed} failed`, tone: "fail" as const, width: 10 },
          dim(ago(one.at, now)?.replace("run ", "") ?? "", { width: 10 }),
        ],
        select: { runId: one.runId },
      })),
    },
    main: {
      title: state.runId === undefined ? "Heal review" : `Heal ${state.runId}`,
      empty: "press H to heal the selected run",
      lines: state.proposals.map((one) => ({
        key: one.elementId,
        cells: [
          text(one.elementId, { grow: true }),
          dim(one.method, { width: 12 }),
          dim(one.confidence === undefined ? "" : String(one.confidence), { width: 6 }),
          ...(one.verified === undefined ? [] : [pill(one.verified, 14)]),
          {
            text: one.applied ? "applied" : "proposed",
            tone: one.applied ? ("pass" as const) : ("info" as const),
            width: 9,
          },
        ],
        select: { bindingId: one.elementId },
      })),
      ...(state.report === undefined
        ? {}
        : {
            footer: {
              text: state.report.message,
              tone: state.report.unrepaired > 0 ? ("abort" as const) : ("pass" as const),
            },
          }),
    },
    inspector: {
      title: proposal?.elementId ?? "Proposal",
      empty: "no proposal yet",
      lines:
        proposal === undefined
          ? []
          : [
              kv("phrase", proposal.phrase ?? "—"),
              kv("method", proposal.method),
              kv(
                "confidence",
                proposal.confidence === undefined ? "—" : String(proposal.confidence),
              ),
              ...(proposal.verified === undefined
                ? []
                : [kv("verified", proposal.verified.label, proposal.verified.tone)]),
              heading("before"),
              ...proposal.before.map((one, at) => ({
                key: `before-${at}`,
                cells: [
                  { text: "-", tone: "fail" as const, width: 1 },
                  dim(one.by, { width: 8 }),
                  text(one.value, { grow: true }),
                ],
              })),
              heading("after"),
              ...proposal.after.map((one, at) => ({
                key: `after-${at}`,
                cells: [
                  { text: "+", tone: "pass" as const, width: 1 },
                  dim(one.by, { width: 8 }),
                  text(one.value, { grow: true }),
                ],
              })),
              heading("scores"),
              ...proposal.scores.map((one) => kv(one.key, String(one.value))),
            ],
    },
    audit: {
      title: "Proposals",
      empty: "no proposal yet",
      lines: state.proposals.map((one) => ({
        key: `tail-${one.elementId}`,
        cells: [
          dim(one.method, { width: 12 }),
          { text: one.elementId, grow: true, tone: one.applied ? ("pass" as const) : ("info" as const) },
          dim(one.applied ? "applied" : "waiting", { width: 9 }),
        ],
      })),
    },
  };
}

function agents(state: AgentsState): PaneModel {
  const chosen = state.tools.find((one) => one.selected);
  return {
    tree: {
      title: `Tools · ${state.tools.length}`,
      empty: "no story is exposed as a tool",
      lines: state.tools.map((one) => ({
        key: one.name,
        cells: [
          text(one.selected ? `▸ ${one.name}` : `  ${one.name}`, { grow: true }),
          {
            text: one.idempotent ? "idempotent" : "side effects",
            tone: one.idempotent ? ("pass" as const) : ("abort" as const),
            width: 13,
          },
        ],
        select: { selected: one.name },
      })),
    },
    main: {
      title: "Invocations",
      empty: "no agent has called a tool yet",
      lines: state.invocations.map((one, at) => ({
        key: `invocation-${at}`,
        cells: [
          dim(one.at, { width: 22 }),
          text(one.tool, { width: 24 }),
          dim(one.invoker, { grow: true }),
          dim(one.runId ?? "", { width: 14 }),
          pill(one.status),
        ],
        ...(one.runId === undefined ? {} : { select: { runId: one.runId } }),
      })),
    },
    inspector: {
      title: chosen?.name ?? "Tool",
      empty: "no tool selected",
      lines:
        chosen === undefined
          ? []
          : [
              kv("story", chosen.story),
              kv("idempotent", String(chosen.idempotent), chosen.idempotent ? "pass" : "abort"),
              heading("inputs"),
              ...(chosen.inputs.length === 0
                ? [{ key: "no-inputs", cells: [dim("none")] }]
                : chosen.inputs.map((one) => kv(one, "declared"))),
            ],
    },
    audit: {
      title: "Refused",
      empty: "every exposed story is idempotent",
      lines: state.refused.map((one, at) => ({
        key: `refused-${at}`,
        cells: [
          { text: one.story, tone: "abort" as const, width: 30 },
          dim(one.reason, { grow: true }),
        ],
      })),
      footer: dim("`yam tool serve` exposes them over MCP"),
    },
  };
}

function api(state: ApiState): PaneModel {
  const request = state.request;
  const response = state.response;
  return {
    tree: {
      title: `Requests · ${state.requests.length}`,
      empty: "no request in api/",
      lines: state.requests.map((one) => ({
        key: one.name,
        cells: [
          dim(one.method, { width: 7 }),
          text(one.selected ? `▸ ${one.name}` : `  ${one.name}`, { grow: true }),
        ],
        select: { selected: one.name },
      })),
    },
    main: {
      title: request === undefined ? "API" : `${request.method} ${request.name}`,
      empty: "no request selected",
      lines:
        request === undefined
          ? []
          : [
              kv("url", request.url),
              heading("headers"),
              ...request.headers.map((one) => kv(one.key, one.value)),
              ...(request.body === undefined
                ? []
                : [
                    heading("body"),
                    ...request.body.split("\n").map((line, at) => ({
                      key: `body-${at}`,
                      cells: [text(line, { grow: true })],
                    })),
                  ]),
            ],
    },
    inspector: {
      title: response === undefined ? "Response" : `${response.status}`,
      empty: "press Enter to send it",
      lines:
        response === undefined
          ? []
          : [
              kv("status", response.statusPill.label, response.statusPill.tone),
              kv(
                "time",
                response.durationMs === undefined ? "—" : `${response.durationMs} ms`,
              ),
              kv("size", `${response.bytes ?? 0} B`),
              heading("headers"),
              ...response.headers.map((one) => kv(one.key, one.value)),
              heading("paths"),
              ...response.paths.map((one) => ({
                key: `path-${one}`,
                cells: [text(one, { grow: true })],
              })),
            ],
    },
    audit: {
      title: "Body",
      empty: "nothing has been sent from this screen",
      lines:
        response === undefined
          ? []
          : response.body.split("\n").map((line, at) => ({
              key: `line-${at}`,
              cells: [text(line, { grow: true })],
            })),
    },
  };
}

function data(state: DataState): PaneModel {
  const chosen = state.rows.find((one) => one.selected);
  return {
    tree: {
      title: `Keys · ${state.rows.length}`,
      empty: "data.yaml is empty",
      lines: state.rows.map((one) => ({
        key: one.path,
        cells: [text(one.selected ? `▸ ${one.path}` : `  ${one.path}`, { grow: true })],
        select: { selected: one.path },
      })),
    },
    main: {
      title: "data.yaml",
      empty: "no run data",
      lines: state.rows.map((one) => ({
        key: `row-${one.path}`,
        cells: [
          text(one.path, { width: 24 }),
          /*
           * A secret's *name*, never its value (REQ-NFR-6). The service redacts
           * on read and this shows the variable it is read from, which is the
           * only thing about a secret that is safe to draw.
           */
          one.secret
            ? dim(one.reads === undefined ? one.value : `reads \${${one.reads}}`, { grow: true })
            : text(one.value, { grow: true }),
          pill(one.kind, 15),
        ],
        select: { selected: one.path },
      })),
      footer: dim(`${state.secrets} secret(s), ${state.unset} unset`),
    },
    inspector: {
      title: chosen?.path ?? "Value",
      empty: "no key selected",
      lines:
        chosen === undefined
          ? []
          : [
              kv("kind", chosen.kind.label, chosen.kind.tone),
              ...(chosen.secret
                ? [
                    kv("reads", chosen.reads === undefined ? "—" : `\${${chosen.reads}}`),
                    {
                      key: "never",
                      cells: [
                        dim(
                          "The value is never shown, never saved, and never reaches a prompt, " +
                            "the audit, a result, a trace or a screenshot.",
                          { grow: true },
                        ),
                      ],
                    },
                  ]
                : [kv("value", chosen.value)]),
            ],
    },
    audit: {
      title: "Secrets",
      empty: "this project declares no secret",
      lines: state.rows
        .filter((one) => one.secret)
        .map((one) => ({
          key: `secret-${one.path}`,
          cells: [
            pill(one.kind, 15),
            text(one.path, { width: 24 }),
            dim(one.reads === undefined ? "" : `\${${one.reads}}`, { grow: true }),
          ],
        })),
    },
  };
}

function explorer(state: ExplorerState): PaneModel {
  return {
    tree: {
      title: state.sessionId === undefined ? "Adapters" : "Snapshot",
      empty: state.sessionId === undefined ? "no session" : "press S to take a snapshot",
      lines:
        state.sessionId === undefined
          ? state.adapters.map((one) => ({
              key: one,
              cells: [text(one === state.adapter ? `▸ ${one}` : `  ${one}`, { grow: true })],
              select: { adapter: one },
            }))
          : state.snapshot.map((line, at) => ({
              key: `node-${at}`,
              cells: [
                text(
                  `${"  ".repeat(line.depth)}${line.role}${line.name === undefined ? "" : ` "${line.name}"`}`,
                  { grow: true, ...(line.selected ? { tone: "info" as const } : {}) },
                ),
                dim(line.ref ?? "", { width: 6 }),
              ],
              ...(line.ref === undefined ? {} : { select: { selected: line.ref } }),
            })),
    },
    main: {
      title:
        state.sessionId === undefined
          ? `Surface explorer · ${state.adapter}`
          : `Session ${state.sessionId}`,
      empty:
        state.sessionId === undefined
          ? "press O to open a session"
          : "every call records an intent",
      lines: state.calls.map((one) => ({
        key: `call-${one.seq}`,
        cells: [
          dim(String(one.seq), { width: 3 }),
          text(one.call, { width: 10 }),
          dim(one.intent, { grow: true }),
          {
            text: one.ok ? "ok" : "failed",
            tone: one.ok ? ("pass" as const) : ("fail" as const),
            width: 7,
          },
          dim(one.durationMs === undefined ? "" : `${one.durationMs} ms`, { width: 8 }),
        ],
      })),
      ...(state.proposal === undefined
        ? {}
        : { footer: { text: `wrote ${state.proposal}`, tone: "pass" as const } }),
    },
    inspector: {
      title: "Next call",
      empty: "no session",
      lines: [
        kv("adapter", state.adapter),
        kv("base url", state.baseUrl ?? "—"),
        kv("session", state.sessionId ?? "—"),
        kv("trajectory", state.trajectory ?? "—"),
        heading("intent"),
        {
          key: "intent",
          cells:
            state.intent === undefined || state.intent.trim() === ""
              ? [
                  {
                    text: "required — every surface call records why it was made",
                    grow: true,
                    tone: "abort" as const,
                  },
                ]
              : [text(state.intent, { grow: true })],
        },
      ],
    },
    audit: {
      title: "trajectory.jsonl",
      empty: "no call yet",
      lines: state.calls.map((one) => ({
        key: `tail-${one.seq}`,
        cells: [
          dim(String(one.seq), { width: 3 }),
          dim(one.call, { width: 10 }),
          {
            text: one.detail === "" ? one.intent : one.detail,
            grow: true,
            ...(one.ok ? {} : { tone: "fail" as const }),
          },
        ],
      })),
    },
  };
}

function importing(state: ImportState): PaneModel {
  const result = state.result;
  return {
    tree: {
      title: "Import",
      empty: "nothing chosen",
      lines: [
        kv("from", state.source ?? "choose a folder"),
        kv("into", state.root ?? "—"),
      ],
    },
    main: {
      title: "Import prototype database",
      empty:
        state.source === undefined
          ? "choose the prototype's electron-db directory"
          : "nothing has been written",
      lines:
        result === undefined
          ? []
          : result.rows.map((row, at) => ({
              key: `row-${at}`,
              cells: [
                text(row.from, { width: 22 }),
                text(row.becomes, { grow: true }),
                dim(String(row.count), { width: 5 }),
                pill(row.state, 14),
              ],
            })),
      footer: dim("writes only into the project the service was opened on"),
    },
    inspector: {
      title: "Where it may write",
      empty: "—",
      lines: [
        kv("reads", state.source ?? "—"),
        kv("writes", state.root ?? "—"),
        kv("refuses", "anything outside it"),
        heading("the same thing from a terminal"),
        {
          key: "cli",
          cells: [text(`yam migrate ${state.root ?? "<dest>"} --from-prototype <src>`, { grow: true })],
        },
      ],
    },
    audit: {
      title: "migration-review.md",
      empty: "nothing imported yet",
      lines: (result?.notes ?? []).map((note, at) => ({
        key: `note-${at}`,
        cells: [
          dim(note.where, { width: 24 }),
          {
            text: note.text,
            grow: true,
            ...(note.needsDecision ? { tone: "abort" as const } : {}),
          },
        ],
      })),
    },
  };
}

function settings(state: SettingsState): PaneModel {
  const groups = [...new Set(state.rows.map((one) => one.group))];
  return {
    tree: {
      title: "Settings",
      empty: "—",
      lines: groups.map((group) => ({ key: group, cells: [text(group, { grow: true })] })),
    },
    main: {
      title: "Settings",
      empty: "no project open",
      lines: groups.flatMap((group) => [
        heading(group),
        ...state.rows
          .filter((one) => one.group === group)
          .map((one) => kv(one.label.toLowerCase(), one.value)),
      ]),
    },
    inspector: {
      title: "Sources",
      empty: "—",
      lines: state.sources.map((one, at) => ({
        key: `source-${at}`,
        cells: [dim(one, { grow: true })],
      })),
    },
    audit: {
      title: `Diagnostics · ${state.diagnostics.length}`,
      empty: "this project compiles clean",
      lines: state.diagnostics.map((one, at) => ({
        key: `diagnostic-${at}`,
        cells: [
          pill(one.severity, 8),
          dim(one.code, { width: 22 }),
          text(one.message, { grow: true }),
        ],
      })),
    },
  };
}

/** The gutter glyph per tone. The word is always beside it (LLD §13.7). */
export const GLYPH: Readonly<Record<StatusTone, string>> = {
  pass: "✓",
  fail: "✗",
  skip: "–",
  healed: "~",
  abort: "!",
  info: "•",
  neutral: "·",
};
