/**
 * The ADE's Heal review (T10.1, REQ-ADE-5, LLD §13.7; the `HealReview`
 * artboard).
 *
 * The runs worth healing on the left, the proposals in the middle, and the
 * selected proposal's before and after in the inspector with the scores the
 * decision turned on. Nothing is written until Apply: REQ-HEAL-2 is that a
 * repair is a diff to the bindings store plus a report, and this screen is where
 * the diff is read.
 */
import { InspectorSection, KeyValues, Pill, Table } from "@svatah/ui";
import { ago, type Action, type HealState, type ScreenParams } from "@svatah/screens";
import { EmptyInspector, Toolbar } from "./parts.js";

export interface HealProps {
  readonly state: HealState;
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
}

export function HealScreen(props: HealProps): React.JSX.Element {
  const { state } = props;
  const now = Date.now();
  return (
    <>
      <Toolbar
        state={state}
        actions={props.actions}
        onAction={props.onAction}
        primary="heal.apply"
      />

      <div className="sv-main">
        <aside className="sv-list" id="heal-runs-pane" aria-label="Runs with a failure">
          <Table<HealState["candidates"][number]>
            id="heal-candidates"
            label="Runs with a failure"
            rows={[...state.candidates]}
            rowKey={(row) => row.runId}
            selected={state.runId ?? ""}
            onSelect={(runId) => props.onParams({ ...props.params, runId })}
            empty="No run has a failure to heal."
            columns={[
              {
                key: "run",
                header: "run",
                cell: (row) => (
                  <span className="sv-flow-row">
                    <span className="sv-flow-name sv-mono">{row.runId}</span>
                    <span className="sv-flow-meta">
                      {[row.subject, ago(row.at, now)?.replace("run ", "")]
                        .filter((one) => one !== undefined && one !== "")
                        .join(" · ")}
                    </span>
                  </span>
                ),
              },
              {
                key: "failed",
                header: "failed",
                align: "right",
                cell: (row) => <Pill tone="fail" label={`${row.failed}`} />,
              },
            ]}
          />
        </aside>

        <div className="sv-editor">
          <Table<HealState["proposals"][number]>
            id="heal-proposals"
            label="Proposals"
            rows={[...state.proposals]}
            rowKey={(row) => row.elementId}
            selected={state.proposal?.elementId ?? ""}
            onSelect={(bindingId) => props.onParams({ ...props.params, bindingId })}
            empty="Press Heal to repair this run's locator failures. Nothing is written until you apply a proposal."
            columns={[
              { key: "element", header: "element", monospace: true, cell: (row) => row.elementId },
              { key: "method", header: "method", cell: (row) => row.method },
              {
                key: "confidence",
                header: "confidence",
                align: "right",
                cell: (row) => (row.confidence === undefined ? "—" : row.confidence),
              },
              {
                key: "verified",
                header: "re-ran",
                cell: (row) =>
                  row.verified === undefined ? (
                    "—"
                  ) : (
                    <Pill tone={row.verified.tone} label={row.verified.label} />
                  ),
              },
              {
                key: "applied",
                header: "state",
                cell: (row) =>
                  row.applied ? (
                    <Pill tone="pass" label="applied" />
                  ) : (
                    <Pill tone="info" label="proposed" />
                  ),
              },
            ]}
          />

          {state.report === undefined ? null : (
            <p
              className={`sv-run-outcome sv-tone-${state.report.unrepaired > 0 ? "abort" : "pass"}`}
            >
              {state.report.message}
            </p>
          )}
        </div>
      </div>
    </>
  );
}

/** The right inspector: the diff, and the scores behind it. */
export function HealInspector(props: HealProps): React.JSX.Element {
  const proposal = props.state.proposal;
  if (proposal === undefined) {
    return (
      <EmptyInspector id="inspector-empty" title="Inspector">
        A proposal shows the candidates as they are and as the healer would write
        them. Nothing is written to the store until you apply one.
      </EmptyInspector>
    );
  }

  return (
    <>
      <InspectorSection id="inspector-proposal" title={proposal.elementId}>
        <KeyValues
          rows={[
            { key: "Phrase", value: proposal.phrase ?? "—" },
            { key: "Method", value: proposal.method },
            {
              key: "Confidence",
              value: proposal.confidence === undefined ? "—" : String(proposal.confidence),
            },
            {
              key: "Verified",
              value:
                proposal.verified === undefined ? (
                  "not re-run"
                ) : (
                  <Pill tone={proposal.verified.tone} label={proposal.verified.label} />
                ),
            },
          ]}
        />
      </InspectorSection>

      <InspectorSection id="inspector-diff" title="Before and after">
        <div className="sv-diff" id="heal-diff" aria-label="The proposed change">
          {proposal.before.map((one, at) => (
            <p key={`before-${at}`} className="sv-diff-del">
              − {one.by} {one.value}
            </p>
          ))}
          {proposal.after.map((one, at) => (
            <p key={`after-${at}`} className="sv-diff-add">
              + {one.by} {one.value}
            </p>
          ))}
        </div>
      </InspectorSection>

      {proposal.scores.length === 0 ? null : (
        <InspectorSection id="inspector-scores" title="Scores">
          <KeyValues
            rows={proposal.scores.map((one) => ({ key: one.key, value: String(one.value) }))}
          />
        </InspectorSection>
      )}
    </>
  );
}
