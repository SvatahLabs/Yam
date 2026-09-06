/**
 * The ADE's Flows screen (T9.4, REQ-ADE-11, LLD §13.7; the `Main` artboard).
 *
 * List, editor with lint, plan — drawn from `@svatah/screens`'s `FlowsState`
 * and from nothing else. Every number, every status word and every note in here
 * is the model's; this file decides where they go on a page.
 *
 * The same state renders in `svatah ui` as four panes of text. If either
 * renderer had to compute something the other did not, the two would disagree
 * the first time a project changed — which is the whole argument for a headless
 * model and the reason this file has no arithmetic in it.
 */
import {
  Button,
  InspectorSection,
  KeyValues,
  Pill,
  Table,
  TabStrip,
} from "@svatah/ui";
import { ago } from "@svatah/screens";
import type { Action, FlowsState, ScreenParams } from "@svatah/screens";

export interface FlowsProps {
  readonly state: FlowsState;
  readonly params: ScreenParams;
  readonly actions: readonly Action[];
  readonly onAction: (id: string) => void;
  readonly onParams: (params: ScreenParams) => void;
  readonly tab: "editor" | "plan" | "history";
  readonly onTab: (tab: "editor" | "plan" | "history") => void;
}

/** `flows/guards-and-compensation.flow` → an id a desktop adapter can bind to. */
const rowId = (prefix: string, value: string): string =>
  `${prefix}-${value.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}`;

export function FlowsScreen(props: FlowsProps): React.JSX.Element {
  const { state } = props;

  return (
    <>
      <div className="sv-toolbar">
        <h1 className="sv-toolbar-title">{state.title}</h1>
        <span className="sv-toolbar-sub">{state.subtitle}</span>
        <span className="sv-spacer" />
        {props.actions
          .filter((one) => ["record.start", "heal.run", "run.flow"].includes(one.id))
          .map((one) => (
            <Button
              key={one.id}
              id={rowId("action", one.id)}
              label={one.label}
              variant={one.id === "run.flow" ? "primary" : "default"}
              {...(one.key === undefined ? {} : { accelerator: one.key })}
              disabled={!one.availableWhen(state)}
              onPress={() => props.onAction(one.id)}
            />
          ))}
      </div>

      <div className="sv-main">
        <aside className="sv-list" aria-label="Flow files">
          <Table<FlowsState["files"][number]>
            id="flows-list"
            label="Flow files"
            rows={[...state.files]}
            rowKey={(row) => row.file}
            selected={state.file ?? ""}
            onSelect={(file) => props.onParams({ ...props.params, file, selected: undefined })}
            empty="No flow files yet. `svatah init` writes one."
            columns={[
              {
                key: "name",
                header: "flow",
                /*
                 * The relative time is the *renderer's* (P9-F4, Draft 2.12
                 * §13.7). The model carries `lastRunAt`, an instant, so two
                 * loads of an unchanged project are the same value; "run 4 min
                 * ago" is computed here from the same `ago()` `svatah ui` uses,
                 * so the two renderers still say the same words.
                 */
                cell: (row) => (
                  <span className="sv-flow-row">
                    <span className="sv-flow-name">{row.name}</span>
                    <span className="sv-flow-meta">
                      {[...row.meta, ago(row.lastRunAt, Date.now())]
                        .filter((one) => one !== undefined)
                        .join(" · ")}
                    </span>
                  </span>
                ),
              },
              {
                key: "status",
                header: "last run",
                cell: (row) => <Pill tone={row.status.tone} label={row.status.label} />,
              },
            ]}
          />
        </aside>

        <div className="sv-editor">
          <TabStrip
            id="flows-tabs"
            label="Flow views"
            value={props.tab}
            onChange={(value) => props.onTab(value as FlowsProps["tab"])}
            tabs={[
              {
                id: "editor",
                label: state.file?.split("/").pop() ?? "Editor",
                content: <Editor state={state} onSelect={(line) => props.onParams({ ...props.params, selected: `line:${line}` })} />,
              },
              { id: "plan", label: "Plan", content: <Plan state={state} /> },
              { id: "history", label: "History", content: <History state={state} /> },
            ]}
          />

          <div className="sv-panel-head">
            <span>Lint</span>
            <span className="sv-spacer" />
            <Pill
              tone={state.lint.some((one) => one.severity === "error") ? "fail" : "pass"}
              label={`${state.lint.filter((one) => one.severity === "error").length} errors`}
            />
            <Pill
              tone={state.lint.some((one) => one.severity === "warning") ? "abort" : "pass"}
              label={`${state.lint.filter((one) => one.severity === "warning").length} warnings`}
            />
          </div>
          <ul className="sv-lint" aria-label="Lint diagnostics">
            {state.lint.length === 0 ? (
              <li className="sv-empty">Nothing to report.</li>
            ) : (
              state.lint.slice(0, 8).map((one, at) => (
                <li key={`${one.code ?? ""}-${one.line ?? at}`}>
                  <span className="sv-mono sv-lint-line">{one.line ?? ""}</span>
                  <span className="sv-lint-code">{one.code ?? ""}</span>
                  <span>{one.message ?? ""}</span>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </>
  );
}

/**
 * The editor: every line of the file, with the gutter the last run wrote.
 *
 * A read-only view in Phase 9. `PUT /flows/:file` and the `flows.save` action
 * exist in the model; wiring a text editor to them is T10.1's, and a half-built
 * one that silently dropped a keystroke would be worse than a view that says it
 * is a view.
 */
function Editor({
  state,
  onSelect,
}: {
  readonly state: FlowsState;
  readonly onSelect: (line: number) => void;
}): React.JSX.Element {
  return (
    <div className="sv-code" aria-label="Flow editor">
      {state.lines.map((line) => (
        <button
          key={line.line}
          id={`flow-line-${line.line}`}
          type="button"
          className={
            state.inspector?.line === line.line ? "sv-code-line sv-code-current" : "sv-code-line"
          }
          onClick={() => onSelect(line.line)}
        >
          <span className="sv-code-number">{line.line}</span>
          <span className="sv-code-gutter">
            {line.outcome === undefined ? (
              " "
            ) : (
              <span className={`sv-tone-${line.outcome.tone}`} title={line.outcome.label}>
                {GLYPH[line.outcome.tone]}
              </span>
            )}
          </span>
          <span className={`sv-code-text sv-code-${line.kind}`}>{line.text || " "}</span>
          {line.warning === undefined ? null : (
            <span className="sv-code-warning">{line.warning}</span>
          )}
          {line.note === undefined ? null : <span className="sv-code-note">{line.note}</span>}
        </button>
      ))}
    </div>
  );
}

/** The gutter glyph per tone. The word is the `title`; colour is never alone. */
const GLYPH: Record<string, string> = {
  pass: "✓",
  fail: "✗",
  skip: "–",
  healed: "~",
  abort: "!",
  info: "•",
  neutral: "·",
};

/** The Plan tab: the compiled steps of the open file, from `GET /plan`. */
function Plan({ state }: { readonly state: FlowsState }): React.JSX.Element {
  const steps = state.lines.filter((one) => one.stepId !== undefined);
  return (
    <Table<(typeof steps)[number]>
      id="flows-plan"
      label="Compiled steps"
      rows={steps}
      rowKey={(row) => String(row.line)}
      empty="Nothing compiled for this file yet."
      columns={[
        { key: "line", header: "line", align: "right", cell: (row) => row.line },
        { key: "text", header: "step", monospace: true, cell: (row) => row.text.trim() },
        { key: "note", header: "origin", cell: (row) => row.note ?? "" },
      ]}
    />
  );
}

/** The History tab: what the last run did to this file, per story. */
function History({ state }: { readonly state: FlowsState }): React.JSX.Element {
  const rows = state.files.filter((one) => one.file === state.file);
  return (
    <Table<(typeof rows)[number]>
      id="flows-history"
      label="Run history"
      rows={rows}
      rowKey={(row) => row.file}
      empty="This flow has not been run."
      columns={[
        { key: "name", header: "flow", cell: (row) => row.name },
        {
          key: "status",
          header: "last run",
          cell: (row) => <Pill tone={row.status.tone} label={row.status.label} />,
        },
        {
          key: "meta",
          header: "detail",
          cell: (row) =>
            [...row.meta, ago(row.lastRunAt, Date.now())]
              .filter((one) => one !== undefined)
              .join(" · "),
        },
      ]}
    />
  );
}

/** The right inspector: the selected step, its binding and its provenance. */
export function FlowsInspector({
  state,
  onAction,
}: {
  readonly state: FlowsState;
  readonly onAction: (id: string) => void;
}): React.JSX.Element {
  const inspector = state.inspector;
  if (inspector === undefined) {
    return (
      <InspectorSection id="inspector-empty" title="Inspector">
        <p className="sv-empty">Choose a step to see its binding, its tier and its last run.</p>
      </InspectorSection>
    );
  }

  return (
    <>
      <InspectorSection id="inspector-step" title={`Step ${inspector.line}`}>
        <p className="sv-inspector-subject">{inspector.text}</p>
        <KeyValues
          rows={[
            {
              key: "Compiles at",
              value:
                inspector.tier === undefined
                  ? "—"
                  : `Tier ${inspector.tier}${
                      inspector.confidence === undefined ? "" : ` · confidence ${inspector.confidence}`
                    }`,
            },
            { key: "Target", value: <span className="sv-mono">{inspector.target ?? "—"}</span> },
            {
              key: "Binding",
              value:
                inspector.binding === undefined ? (
                  "—"
                ) : (
                  <>
                    <Pill
                      tone={inspector.binding.verified ? "pass" : "abort"}
                      label={inspector.binding.verified ? "verified" : "unverified"}
                    />{" "}
                    {inspector.binding.candidates.length} candidates
                  </>
                ),
            },
            { key: "Guard", value: inspector.guard ?? "—" },
            { key: "Last run", value: inspector.lastRun ?? "—" },
          ]}
        />
      </InspectorSection>

      {inspector.binding === undefined ? null : (
        <InspectorSection id="inspector-candidates" title="Candidates">
          <Table<(typeof inspector.binding.candidates)[number]>
            id="inspector-candidate-table"
            label="Resolver order"
            rows={[...inspector.binding.candidates]}
            rowKey={(row) => `${row.by}-${row.value}`}
            columns={[
              { key: "by", header: "by", monospace: true, cell: (row) => row.by },
              { key: "value", header: "value", monospace: true, cell: (row) => row.value },
              { key: "score", header: "score", align: "right", cell: (row) => row.score ?? "—" },
            ]}
          />
        </InspectorSection>
      )}

      {inspector.binding?.provenance === undefined ? null : (
        <InspectorSection id="inspector-provenance" title="Provenance">
          <KeyValues
            rows={[
              {
                key: "Grounded by",
                value: (
                  <span className="sv-mono">
                    {inspector.binding.provenance.model ?? "—"}
                    {inspector.binding.provenance.promptVersion === undefined
                      ? ""
                      : ` · ${inspector.binding.provenance.promptVersion}`}
                  </span>
                ),
              },
              { key: "Recorded", value: inspector.binding.provenance.at ?? "—" },
              { key: "Context", value: <span className="sv-mono">{inspector.binding.context ?? "—"}</span> },
            ]}
          />
        </InspectorSection>
      )}

      <div className="sv-inspector-actions">
        <Button
          id="inspector-open-binding"
          label="Open binding"
          onPress={() => onAction("go.bindings")}
        />
        <Button id="inspector-record-step" label="Re-record step" onPress={() => onAction("record.start")} />
      </div>
    </>
  );
}
