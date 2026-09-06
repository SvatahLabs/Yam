/**
 * The ADE's Run screen (T9.4, REQ-ADE-11, LLD §13.7; the `Run` artboard).
 *
 * One run, live: the stories it touched with their totals, every step with what
 * resolved it, the audit beside them, and an inspector on the failing step with
 * the candidates tried and what to do about it.
 *
 * Live and finished are the same screen. `step.result` and `run.summary` are
 * folded in by `applyEvent` from `@svatah/screens` — the renderer subscribes and
 * the *model* decides what an event means, so the ADE and `svatah ui` cannot
 * come to different conclusions about a run that is still going.
 */
import { Button, InspectorSection, KeyValues, Pill, Table } from "@svatah/ui";
import type { Action, RunState, ScreenParams } from "@svatah/screens";
import { Toolbar } from "./parts.js";

export interface RunProps {
  readonly state: RunState;
  readonly params: ScreenParams;
  readonly actions: readonly Action[];
  /**
   * Run an action, with what this screen knows that the parameters do not (K6,
   * K7, T11.1).
   *
   * `flows.save` needs the text in the editor and `api.save` needs the request
   * in the form, and neither is a *screen parameter*: a parameter is what a
   * screen re-loads with, and a draft is what has not been saved yet. So a
   * screen may hand its action the argument only it has, and everything else
   * still comes from the parameters (LLD §13.7's one action registry).
   */
  readonly onAction: (id: string, args?: Readonly<Record<string, unknown>>) => void;
  readonly onParams: (params: ScreenParams) => void;
  /** The screenshot the failing step wrote, as an object URL, when it has one. */
  readonly evidence?: string;
}

export function RunScreen(props: RunProps): React.JSX.Element {
  const { state } = props;

  return (
    <>
      {/*
        The shared `Toolbar`, not a fourth copy of one (P10-F3).
        
        Phase 10 had three screens building their own bar, and the title floor
        and the shedding that Draft 2.13 asks for live in the shared one — so a
        screen with its own copy was a screen where neither happened. The Run
        toolbar was the one the verifier measured overflowing.
        
        Stop first, because while a run is going it is the only one of the four
        that does anything (T10.4). It disables itself the moment the run ends:
        `run.stop`'s `availableWhen` is the model's `live`.
      */}
      <Toolbar
        state={state}
        actions={props.actions.filter((one) =>
          ["run.stop", "heal.run", "run.resume", "run.again"].includes(one.id),
        )}
        onAction={props.onAction}
        primary="run.again"
        {...(state.live ? { danger: "run.stop" } : {})}
        title={
          <>
            Run <span className="sv-mono">{state.runId ?? "—"}</span>
          </>
        }
        beside={<Pill tone={state.outcome.tone} label={state.outcome.label} />}
        labelFor={(one) =>
          one.id === "heal.run" ? `Heal run ${state.runId ?? ""}`.trim() : undefined
        }
      />

      <div className="sv-main">
        <aside className="sv-list" id="run-stories-pane" aria-label="Stories">
          <div className="sv-totals">
            <Pill tone="pass" label={`${state.totals.passed} passed`} />
            <Pill tone="fail" label={`${state.totals.failed} failed`} />
            <Pill tone="skip" label={`${state.totals.skipped} skipped`} />
            {state.totals.healed === 0 ? null : (
              <Pill tone="healed" label={`${state.totals.healed} healed`} />
            )}
          </div>
          <Table<RunState["stories"][number]>
            id="run-stories"
            label="Stories in this run"
            rows={[...state.stories]}
            rowKey={(row) => row.story}
            selected={state.stories.find((one) => one.selected)?.story ?? ""}
            onSelect={(story) => props.onParams({ ...props.params, story })}
            empty="This run touched no story."
            columns={[
              {
                key: "story",
                header: "story",
                cell: (row) => (
                  <span className="sv-flow-row">
                    <span className="sv-flow-name">{row.story}</span>
                    <span className="sv-flow-meta">{row.meta.join(" · ")}</span>
                  </span>
                ),
              },
              {
                key: "status",
                header: "outcome",
                cell: (row) => <Pill tone={row.status.tone} label={row.status.label} />,
              },
            ]}
          />
        </aside>

        <div className="sv-editor sv-split">
          <div className="sv-steps" id="run-steps" aria-label="Steps">
            {state.steps.length === 0 ? (
              <p className="sv-empty">{state.subtitle}</p>
            ) : (
              state.steps.map((step) => (
                <div key={step.stepId}>
                  <button
                    id={`run-step-${step.stepId.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`}
                    type="button"
                    className={step.selected ? "sv-step sv-step-selected" : "sv-step"}
                    onClick={() => props.onParams({ ...props.params, selected: step.stepId })}
                  >
                    <span className={`sv-step-glyph sv-tone-${step.status.tone}`} title={step.status.label}>
                      {GLYPH[step.status.tone]}
                    </span>
                    <span className="sv-step-text">{step.text}</span>
                    {step.failureClass === undefined ? (
                      <span className="sv-step-detail">{step.detail ?? ""}</span>
                    ) : (
                      <Pill tone={step.failureClass.tone} label={step.failureClass.label} />
                    )}
                    <span className="sv-step-detail">
                      {step.durationMs === undefined ? "" : `${step.durationMs} ms`}
                    </span>
                  </button>
                  {step.failure === undefined ? null : (
                    <p className="sv-step-failure">
                      {step.failure}
                      {step.policy === undefined ? null : (
                        <Pill tone="abort" label={step.policy} />
                      )}
                    </p>
                  )}
                </div>
              ))
            )}
            {state.exitCode === undefined ? null : (
              <p className={`sv-run-outcome sv-tone-${state.outcome.tone}`}>
                flow {state.outcome.label} · exit {state.exitCode}
                {state.totals.failed > 0 && state.outcome.label === "aborted"
                  ? " · the compensation itself passed"
                  : ""}
              </p>
            )}
          </div>

          <div className="sv-audit-panel">
            <div className="sv-panel-head">
              <span>Audit{state.live ? " · live" : ""}</span>
              <span className="sv-spacer" />
              <span className="sv-chip">{state.audit.length} lines</span>
            </div>
            <ol className="sv-audit" id="run-audit" aria-label="Audit">
              {state.audit.length === 0 ? (
                <li className="sv-empty">This run wrote no audit lines.</li>
              ) : (
                state.audit.map((line) => (
                  <li key={line.seq}>
                    <span className="sv-mono sv-audit-at">{line.at}</span>
                    <span className="sv-audit-kind">{line.kind}</span>
                    <span className={line.tone === "neutral" ? "" : `sv-tone-${line.tone}`}>
                      {line.text}
                    </span>
                  </li>
                ))
              )}
            </ol>
          </div>
        </div>
      </div>
    </>
  );
}

const GLYPH: Record<string, string> = {
  pass: "✓",
  fail: "✗",
  skip: "–",
  healed: "~",
  abort: "!",
  info: "•",
  neutral: "·",
};

/** The right inspector: the selected step, its evidence, and what to do. */
export function RunInspector(props: RunProps): React.JSX.Element {
  const inspector = props.state.inspector;
  if (inspector === undefined) {
    return (
      <InspectorSection id="inspector-empty" title="Inspector">
        <p className="sv-empty">Choose a step to see its evidence.</p>
      </InspectorSection>
    );
  }

  return (
    <>
      <InspectorSection id="inspector-step" title={inspector.title}>
        {props.evidence === undefined ? null : (
          <img
            className="sv-thumb"
            src={props.evidence}
            alt={`The screen at ${inspector.title}`}
          />
        )}
        <KeyValues
          rows={[
            {
              key: "Failure",
              value:
                inspector.failureClass === undefined ? (
                  "none"
                ) : (
                  <Pill tone={inspector.failureClass.tone} label={inspector.failureClass.label} />
                ),
            },
            { key: "Session", value: <span className="sv-mono">{inspector.session ?? "—"}</span> },
            { key: "Title", value: inspector.windowTitle ?? "—" },
            { key: "Dialog", value: inspector.dialog ?? "none" },
            { key: "Policy", value: inspector.policy ?? "—" },
          ]}
        />
      </InspectorSection>

      {inspector.candidatesTried.length === 0 ? null : (
        <InspectorSection id="inspector-candidates" title="Candidates tried">
          {/*
            The table's caption is the table's accessible name and is visible
            (LLD §13.7), so it must not repeat the section heading above it —
            which is what "the 'Candidates tried' heading renders twice" was
            (P9-F5). The section says what happened; the caption says what the
            rows are, exactly as the Flows inspector's "Resolver order" does.
          */}
          <Table<(typeof inspector.candidatesTried)[number]>
            id="inspector-candidates-table"
            label="Resolver order"
            rows={[...inspector.candidatesTried]}
            rowKey={(row) => `${row.by}-${row.value}`}
            columns={[
              { key: "by", header: "by", monospace: true, cell: (row) => row.by },
              { key: "value", header: "value", monospace: true, cell: (row) => row.value },
              { key: "matched", header: "matched", align: "right", cell: (row) => row.matched },
            ]}
          />
        </InspectorSection>
      )}

      {inspector.advice === undefined ? null : (
        <InspectorSection id="inspector-advice" title="What to do">
          <p className="sv-card">{inspector.advice}</p>
          <div className="sv-inspector-actions">
            <Button
              id="inspector-open-step"
              label="Open step in editor"
              onPress={() => props.onAction("go.flows")}
            />
            <Button
              id="inspector-heal-run"
              label={`Heal run ${props.state.runId ?? ""}`.trim()}
              onPress={() => props.onAction("heal.run")}
            />
          </div>
        </InspectorSection>
      )}
    </>
  );
}
