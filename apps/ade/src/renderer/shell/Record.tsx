/**
 * The ADE's Record review (T10.1, REQ-ADE-4, LLD §13.7; the `RecordReview`
 * artboard).
 *
 * A recording session streams a grounding decision per target *before* the
 * binding is written, and this is where it is reviewed: the snapshot excerpt the
 * model was shown with the line it chose, the candidate bundle, the fingerprint
 * and the provenance, and Accept, Re-pick or Reject.
 *
 * Two things the artboard is specific about, both from Draft 2.7:
 *
 *   * the gateway is **chosen on this screen** — `anthropic` when the service
 *     reports a credential, `fake` for the committed answers, and a fake-gateway
 *     session says so on its face;
 *   * a failed session is an alert whose advice is written for whoever is
 *     looking at it, never a CLI flag.
 */
import { Alert, Chooser, InspectorSection, KeyValues, Pill, Table } from "@svatah/ui";
import type { Action, RecordState, ScreenParams } from "@svatah/screens";
import { a11yVariant } from "../a11y-variant.js";
import { Code, EmptyInspector, GLYPH, Toolbar } from "./parts.js";

/** The two gateways a record session can run against (LLD §13.5, §13.6). */
export type GatewayChoice = "anthropic" | "fake";

/**
 * Advice a person at this window can act on (REQ-ADE-4, LLD §13.6).
 *
 * The service's message is written for whoever called it, and for the missing
 * credential it names a CLI flag. Everything the flag would do is a control on
 * this screen, so the advice says so; anything else is passed through, because
 * an invented explanation of an unfamiliar failure is worse than the real one.
 */
export function adviseOnFailure(message: string, gateway: GatewayChoice): string {
  if (/needs a model|ANTHROPIC_API_KEY|GatewayUnavailable/i.test(message)) {
    return gateway === "anthropic"
      ? "Recording needs a model, and this service has no credential. Choose the " +
          "fake gateway above to record from the committed grounding answers, or " +
          "restart the service with ANTHROPIC_API_KEY set."
      : "Recording needs a gateway, and none answered. Choose one above and start again.";
  }
  return message;
}

export interface RecordProps {
  readonly state: RecordState;
  readonly params: ScreenParams;
  readonly actions: readonly Action[];
  readonly onAction: (id: string) => void;
  readonly onParams: (params: ScreenParams) => void;
}

export function RecordScreen(props: RecordProps): React.JSX.Element {
  const { state } = props;
  const decision = state.decision;

  /*
   * The gateway control, which variant 2 moves (Draft 2.8 §16, T7.1, T10.3).
   *
   * > variant 2 moves the Record screen's gateway control into a different
   * > panel
   *
   * Its id and its name are unchanged; only where it sits is. A binding
   * recorded at variant 0 therefore keeps everything a fingerprint is made of
   * except its ancestor role path and its neighbours, which is the half of
   * relocalization variant 1 does not exercise.
   */
  const inWorkspace = a11yVariant() === 2;
  const gateway = (
    <Chooser
      id="record-gateway"
      label="Gateway"
      value={state.gateway}
      options={state.gateways.map((one) => ({
        value: one.id,
        label: one.label,
        disabled: !one.available,
      }))}
      onChange={(chosen) => props.onParams({ ...props.params, gateway: chosen })}
    />
  );

  return (
    <>
      <Toolbar
        state={state}
        actions={props.actions}
        onAction={props.onAction}
        primary="record.accept"
        danger="record.reject"
      >
        {inWorkspace ? null : gateway}
      </Toolbar>

      <div className="sv-main">
        <aside className="sv-list" id="record-flows-pane" aria-label="Flows">
          <Table<{ file: string }>
            id="record-flows"
            label="Flows to record"
            rows={state.flows.map((file) => ({ file }))}
            rowKey={(row) => row.file}
            selected={state.file ?? ""}
            onSelect={(file) => props.onParams({ ...props.params, file })}
            empty="No flow files yet."
            columns={[
              { key: "file", header: "flow", cell: (row) => row.file.split("/").pop() ?? row.file },
            ]}
          />
        </aside>

        <div className="sv-editor sv-split">
          <div className="sv-steps" id="record-session" aria-label="The session">
            {inWorkspace ? <div className="sv-panel-head">{gateway}</div> : null}
            {/*
              A fake-gateway session says so on its face (REQ-ADE-4, Draft 2.7)
              — as a note, not an `Alert`. `Alert` is `role="alert"`, and a
              screen reader announcing "this session uses the fake gateway"
              every time the screen renders would be noise; what this is, is a
              label on the session.
            */}
            {state.gateway === "fake" ? (
              <p id="record-fake-gateway" className="sv-card">
                <Pill tone="info" label="fake gateway" /> The groundings come from the committed
                answers under <span className="sv-mono">evals/grounding/cases</span>, not from a
                model. Nothing is sent anywhere and nothing is charged.
              </p>
            ) : null}

            {state.failure === undefined ? null : (
              <Alert id="record-failed" tone="fail">
                <b>{state.failure.message}</b> {state.failure.advice}
              </Alert>
            )}

            {decision === undefined ? (
              <p className="sv-empty">
                {state.sessionId === undefined
                  ? "No session. Press Record on the Flows screen, or choose a flow here and press Record."
                  : "The session is running. A grounding appears here when the recorder needs a decision."}
              </p>
            ) : (
              <>
                <div className="sv-panel-head">
                  <span>Grounding</span>
                  <span className="sv-spacer" />
                  <span className="sv-chip sv-mono">{decision.target}</span>
                  {decision.expiresAt === undefined ? null : (
                    <span className="sv-chip">expires {decision.expiresAt}</span>
                  )}
                </div>
                <p className="sv-inspector-subject">{decision.step ?? decision.phrase ?? ""}</p>
                <Code
                  label="The snapshot the model was shown"
                  lines={decision.snapshot}
                  {...(decision.chose === undefined ? {} : { highlight: decision.chose })}
                />
              </>
            )}

            {state.steps.length === 0 ? null : (
              <div id="record-steps" aria-label="Steps performed">
                {state.steps.map((step, at) => (
                  <div key={at} className="sv-step">
                    <span
                      className={`sv-step-glyph sv-tone-${step.status.tone}`}
                      title={step.status.label}
                    >
                      {GLYPH[step.status.tone]}
                    </span>
                    <span className="sv-step-text">{step.text}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="sv-audit-panel">
            <div className="sv-panel-head">
              <span>Decisions</span>
              <span className="sv-spacer" />
              <span className="sv-chip">{state.decisions.length} settled</span>
            </div>
            <ol className="sv-audit" id="record-decisions" aria-label="Decisions">
              {state.decisions.length === 0 ? (
                <li className="sv-empty">Nothing has been decided yet.</li>
              ) : (
                state.decisions.map((one, at) => (
                  <li key={at}>
                    <span className="sv-audit-kind">
                      <Pill tone={one.outcome.tone} label={one.outcome.label} />
                    </span>
                    <span className="sv-mono">{one.target}</span>
                    <span>{one.by ?? ""}</span>
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

/** The right inspector: what the model chose, and everything behind it. */
export function RecordInspector(props: RecordProps): React.JSX.Element {
  const decision = props.state.decision;
  if (decision === undefined) {
    return (
      <EmptyInspector id="inspector-empty" title="Inspector">
        A grounding shows the candidate bundle and the fingerprint before the
        binding is written. Accept, re-pick, or reject.
      </EmptyInspector>
    );
  }

  return (
    <>
      <InspectorSection id="inspector-decision" title={decision.target}>
        <KeyValues
          rows={[
            { key: "Phrase", value: decision.phrase ?? "—" },
            { key: "Step", value: decision.step ?? "—" },
            { key: "Chose", value: <span className="sv-mono">{decision.ref ?? "—"}</span> },
            { key: "Expires", value: decision.expiresAt ?? "—" },
          ]}
        />
      </InspectorSection>

      <InspectorSection id="inspector-candidates" title="Candidates">
        <Table<{ by: string; value: string; score?: number }>
          id="inspector-candidate-table"
          label="Resolver order"
          rows={[...decision.candidates]}
          rowKey={(row) => `${row.by}-${row.value}`}
          empty="The model proposed no candidate."
          columns={[
            { key: "by", header: "by", monospace: true, cell: (row) => row.by },
            { key: "value", header: "value", monospace: true, cell: (row) => row.value },
            {
              key: "score",
              header: "score",
              align: "right",
              cell: (row) => (row.score === undefined ? "—" : row.score),
            },
          ]}
        />
      </InspectorSection>

      <InspectorSection id="inspector-fingerprint" title="Fingerprint">
        <KeyValues
          rows={decision.fingerprint.map((one) => ({
            key: one.key,
            value: <span className="sv-mono">{one.value}</span>,
          }))}
        />
      </InspectorSection>

      <InspectorSection id="inspector-provenance" title="Provenance">
        <KeyValues
          rows={decision.provenance.map((one) => ({
            key: one.key,
            value: <span className="sv-mono">{one.value}</span>,
          }))}
        />
      </InspectorSection>
    </>
  );
}
