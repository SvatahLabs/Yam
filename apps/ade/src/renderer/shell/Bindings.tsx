/**
 * The ADE's Bindings screen (T10.1, REQ-ADE-11, LLD §13.7; the `Bindings`
 * artboard).
 *
 * The store as a table, and an inspector with the selected element's resolver
 * order, its fingerprint and where it came from. The rows are the YAML files
 * `svatah bindings show` prints — `GET /bindings/:id` answers the bytes on
 * disk — so a candidate table here and a candidate table in a pull request are
 * the same thing.
 */
import { InspectorSection, KeyValues, Pill, Table } from "@svatah/ui";
import type { Action, BindingsState, ScreenParams } from "@svatah/screens";
import { EmptyInspector, Toolbar } from "./parts.js";

export interface BindingsProps {
  readonly state: BindingsState;
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

export function BindingsScreen(props: BindingsProps): React.JSX.Element {
  const { state } = props;
  return (
    <>
      <Toolbar state={state} actions={props.actions} onAction={props.onAction} />

      <div className="sv-main" style={{ flexDirection: "column" }}>
        <Table<BindingsState["rows"][number]>
          id="bindings-table"
          label="Bindings"
          rows={[...state.rows]}
          rowKey={(row) => row.elementId}
          selected={state.bindingId ?? ""}
          onSelect={(bindingId) => props.onParams({ ...props.params, bindingId })}
          empty="No bindings yet. `svatah record` writes them."
          columns={[
            { key: "element", header: "element", monospace: true, cell: (row) => row.elementId },
            { key: "phrase", header: "phrase", cell: (row) => row.phrase ?? "—" },
            { key: "page", header: "page", monospace: true, cell: (row) => row.page ?? "—" },
            {
              key: "matched",
              header: "matched by",
              monospace: true,
              cell: (row) => row.topCandidate ?? "—",
            },
            {
              key: "state",
              header: "state",
              cell: (row) => <Pill tone={row.verified.tone} label={row.verified.label} />,
            },
            {
              key: "provenance",
              header: "provenance",
              monospace: true,
              cell: (row) => row.provenance ?? "—",
            },
          ]}
        />
      </div>
    </>
  );
}

/** The right inspector: the resolver order, the fingerprint, the provenance. */
export function BindingsInspector(props: BindingsProps): React.JSX.Element {
  const inspector = props.state.inspector;
  if (inspector === undefined) {
    return (
      <EmptyInspector id="inspector-empty" title="Inspector">
        Choose an element to see the order its candidates are tried in.
      </EmptyInspector>
    );
  }

  return (
    <>
      <InspectorSection id="inspector-binding" title={inspector.elementId}>
        <KeyValues
          rows={[
            { key: "Phrases", value: inspector.phrases.join(" · ") || "—" },
            { key: "Context", value: <span className="sv-mono">{inspector.context ?? "—"}</span> },
            { key: "Platform", value: inspector.platform ?? "—" },
            {
              key: "State",
              value: <Pill tone={inspector.verified.tone} label={inspector.verified.label} />,
            },
            { key: "File", value: <span className="sv-mono">{inspector.file ?? "—"}</span> },
          ]}
        />
      </InspectorSection>

      <InspectorSection id="inspector-candidates" title="Candidates">
        {/*
          The caption names the rows, and never repeats the heading above it: a
          `<caption>` is visible and is the table's accessible name (P9-F5).
        */}
        <Table<BindingsState["inspector"] extends undefined ? never : { by: string; value: string; score?: number }>
          id="inspector-candidate-table"
          label="Resolver order"
          rows={[...inspector.candidates]}
          rowKey={(row) => `${row.by}-${row.value}`}
          empty="This entry has no candidate."
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
          rows={inspector.fingerprint.map((one) => ({
            key: one.key,
            value: <span className="sv-mono">{one.value}</span>,
          }))}
        />
      </InspectorSection>

      <InspectorSection id="inspector-provenance" title="Provenance">
        <KeyValues
          rows={inspector.provenance.map((one) => ({
            key: one.key,
            value: <span className="sv-mono">{one.value}</span>,
          }))}
        />
      </InspectorSection>
    </>
  );
}
