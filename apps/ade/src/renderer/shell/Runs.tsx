/**
 * The ADE's Runs screen (T10.1, REQ-ADE-11, LLD §13.7; the `Results` artboard).
 *
 * Every run the project has written, with the three filter chips the artboard
 * shows, and an inspector on the selected one: its outcome, its hashes, its
 * failing step and the evidence that step wrote.
 *
 * Every number and every status word is `RunsState`'s. This file decides where
 * they go on a page and nothing else — `svatah ui` draws the same state as four
 * panes of text and agrees about every one of them.
 */
import { InspectorSection, KeyValues, Pill, Table } from "@svatah/ui";
import { ago, type Action, type RunsState, type ScreenParams } from "@svatah/screens";
import { Counts, EmptyInspector, FilterChip, Toolbar } from "./parts.js";

export interface RunsProps {
  readonly state: RunsState;
  readonly params: ScreenParams;
  readonly actions: readonly Action[];
  readonly onAction: (id: string) => void;
  readonly onParams: (params: ScreenParams) => void;
  /** The failing step's screenshot, as an object URL, when it has one. */
  readonly evidence?: string;
}

export function RunsScreen(props: RunsProps): React.JSX.Element {
  const { state } = props;
  const now = Date.now();

  return (
    <>
      <Toolbar state={state} actions={props.actions} onAction={props.onAction}>
        <FilterChip
          id="runs-filter-behavior"
          label="behavior"
          value={state.filters.behavior}
          choices={state.choices.behavior}
          onChoose={(behavior) => props.onParams({ ...props.params, behavior, runId: undefined })}
        />
        <FilterChip
          id="runs-filter-invoker"
          label="invoker"
          value={state.filters.invoker}
          choices={state.choices.invoker}
          onChoose={(invoker) => props.onParams({ ...props.params, invoker, runId: undefined })}
        />
        <FilterChip
          id="runs-filter-status"
          label="status"
          value={state.filters.status}
          choices={state.choices.status}
          onChoose={(status) => props.onParams({ ...props.params, status, runId: undefined })}
        />
      </Toolbar>

      <div className="sv-main" style={{ flexDirection: "column" }}>
        <Table<RunsState["rows"][number]>
          id="runs-table"
          label="Runs"
          rows={[...state.rows]}
          rowKey={(row) => row.runId}
          selected={state.runId ?? ""}
          onSelect={(runId) => props.onParams({ ...props.params, runId })}
          empty={
            state.total === 0
              ? "No runs yet. `svatah run` writes one."
              : `No run matches these filters; ${state.total} in all.`
          }
          columns={[
            { key: "runId", header: "run", monospace: true, cell: (row) => row.runId },
            { key: "subject", header: "flow / story", cell: (row) => row.subject },
            { key: "behavior", header: "behavior", cell: (row) => row.behavior },
            { key: "invoker", header: "invoker", cell: (row) => row.invoker },
            {
              key: "status",
              header: "status",
              cell: (row) => <Pill tone={row.status.tone} label={row.status.label} />,
            },
            {
              key: "totals",
              header: "pass · fail · skip",
              monospace: true,
              cell: (row) => `${row.passed} · ${row.failed} · ${row.skipped}`,
            },
            {
              key: "duration",
              header: "time",
              align: "right",
              cell: (row) =>
                row.durationMs === undefined ? "—" : `${(row.durationMs / 1000).toFixed(2)} s`,
            },
            {
              key: "when",
              header: "when",
              // The relative time is the renderer's (P9-F4): the model carries
              // the instant, and `ago()` is the same function `svatah ui` calls.
              cell: (row) => ago(row.at, now)?.replace("run ", "") ?? "—",
            },
          ]}
        />
      </div>
    </>
  );
}

/** The right inspector: the selected run, its failing step and its evidence. */
export function RunsInspector(props: RunsProps): React.JSX.Element {
  const inspector = props.state.inspector;
  if (inspector === undefined) {
    return (
      <EmptyInspector id="inspector-empty" title="Inspector">
        Choose a run to see what it did and what it wrote.
      </EmptyInspector>
    );
  }

  return (
    <>
      <InspectorSection id="inspector-run" title={`Run ${inspector.runId}`}>
        <KeyValues
          rows={[
            {
              key: "Outcome",
              value: <Pill tone={inspector.status.tone} label={inspector.status.label} />,
            },
            { key: "Behavior", value: inspector.behavior },
            { key: "Invoker", value: inspector.invoker },
            {
              key: "Duration",
              value:
                inspector.durationMs === undefined
                  ? "—"
                  : `${(inspector.durationMs / 1000).toFixed(2)} s`,
            },
            { key: "Exit", value: inspector.exitCode === undefined ? "—" : String(inspector.exitCode) },
            { key: "Plan", value: <span className="sv-mono">{inspector.planHash ?? "—"}</span> },
            {
              key: "Bindings",
              value: <span className="sv-mono">{inspector.bindingsHash ?? "—"}</span>,
            },
          ]}
        />
      </InspectorSection>

      {inspector.failure === undefined ? null : (
        <InspectorSection id="inspector-failure" title="Failing step">
          {props.evidence === undefined ? null : (
            <img
              className="sv-thumb"
              src={props.evidence}
              alt={`The screen at ${inspector.failure.text}`}
            />
          )}
          <p className="sv-inspector-subject">{inspector.failure.text}</p>
          <KeyValues
            rows={[
              {
                key: "Class",
                value: (
                  <Pill
                    tone={inspector.failure.failureClass.tone}
                    label={inspector.failure.failureClass.label}
                  />
                ),
              },
              { key: "Step", value: <span className="sv-mono">{inspector.failure.stepId}</span> },
              {
                key: "Screenshot",
                value: <span className="sv-mono">{inspector.failure.screenshot ?? "none"}</span>,
              },
            ]}
          />
          <p className="sv-card">{inspector.failure.message}</p>
        </InspectorSection>
      )}

      <InspectorSection id="inspector-artifacts" title="What it wrote">
        <div className="sv-sheet-row">
          <Counts items={[...inspector.artifacts]} />
        </div>
      </InspectorSection>
    </>
  );
}
