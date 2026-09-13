/**
 * The app's Flows screen (T9.4, REQ-ADE-11, LLD §13.7; the `Main` artboard).
 *
 * List, editor with lint, plan — drawn from `@svatah/yam-screens`'s `FlowsState`
 * and from nothing else. Every number, every status word and every note in here
 * is the model's; this file decides where they go on a page.
 *
 * The same state renders in `yam ui` as four panes of text. If either
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
} from "@svatah/yam-ui";
import { useEffect, useState } from "react";
import { ago } from "@svatah/yam-screens";
import type { Action, FlowsState, ScreenParams } from "@svatah/yam-screens";

export interface FlowsProps {
  readonly state: FlowsState;
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
  readonly tab: "editor" | "plan" | "history";
  readonly onTab: (tab: "editor" | "plan" | "history") => void;
}

import { Toolbar } from "./parts.js";

export function FlowsScreen(props: FlowsProps): React.JSX.Element {
  const { state } = props;

  /*
   * The draft: what is in the editor but not yet on disk (K6, T11.1).
   *
   * Not a screen parameter. A parameter is what the screen *re-loads* with, and
   * re-loading with a draft would make every keystroke a request; what is
   * unsaved belongs to the window it is unsaved in. `undefined` means "nothing
   * has been typed", which is what makes Save unavailable rather than a Save
   * that writes the file back exactly as it was.
   */
  const [draft, setDraft] = useState<string | undefined>(undefined);
  const file = state.file;
  // A different file is a different draft. Editing `a.flow`, opening `b.flow`
  // and pressing Save must not write `a.flow`'s text into `b.flow`.
  useEffect(() => setDraft(undefined), [file]);

  const dirty = draft !== undefined && draft !== state.text;
  const save = (): void => {
    if (draft === undefined) return;
    props.onAction("flows.save", { text: draft });
    setDraft(undefined);
  };

  /*
   * ⌘S / Ctrl-S, which is what a person's hands do (K6).
   *
   * The Shell's own accelerators refuse to fire while a `<textarea>` has focus
   * — that is the difference between an accelerator and a lost keystroke — and
   * Save is the one action that has to work from inside the editor.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s") return;
      event.preventDefault();
      save();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      {/* The shared `Toolbar`, so the title floor and the shedding of
          Draft 2.13 apply here too (P10-F3). */}
      <Toolbar
        state={state}
        actions={props.actions.filter((one) =>
          ["flows.save", "capture.start", "record.start", "heal.run", "run.flow"].includes(one.id),
        )}
        onAction={(id, args) => (id === "flows.save" ? save() : props.onAction(id, args))}
        primary="run.flow"
        {...(dirty ? { beside: <Pill tone="abort" label="unsaved" /> } : {})}
      />

      <div className="sv-main">
        <aside className="sv-list" id="flows-files-pane" aria-label="Flow files">
          <Table<FlowsState["files"][number]>
            id="flows-list"
            label="Flow files"
            rows={[...state.files]}
            rowKey={(row) => row.file}
            selected={state.file ?? ""}
            onSelect={(file) => props.onParams({ ...props.params, file, selected: undefined })}
            empty="No flow files yet. Press New flow, or run `yam init` to write one."
            columns={[
              {
                key: "name",
                header: "flow",
                /*
                 * The relative time is the *renderer's* (P9-F4, Draft 2.12
                 * §13.7). The model carries `lastRunAt`, an instant, so two
                 * loads of an unchanged project are the same value; "run 4 min
                 * ago" is computed here from the same `ago()` `yam ui` uses,
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
                label: `${state.file?.split("/").pop() ?? "Editor"}${dirty ? " •" : ""}`,
                content: (
                  <Editor
                    state={state}
                    draft={draft}
                    onEdit={setDraft}
                    onSelect={(line) =>
                      props.onParams({ ...props.params, selected: `line:${line}` })
                    }
                  />
                ),
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
          <ul className="sv-lint" id="flows-lint" aria-label="Lint diagnostics">
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
 * The editor: every line of the file, with the gutter the last run wrote — and
 * a way to change it (K6, T11.1).
 *
 * Phase 9 and Phase 10 shipped this read-only, with a reason: `PUT /flows/:file`
 * and the `flows.save` action existed in the model, and a half-built editor that
 * silently dropped a keystroke would be worse than a view that says it is a
 * view. The Phase 10 verification's K6 makes the other half of that a release
 * blocker — "a release cannot ship an 'editor' that does not edit" — so here it
 * is.
 *
 * ## Two views of one file, and why they are not one view
 *
 * A prose flow's value in the app is the *annotation*: the gutter glyph from the
 * last run, the lint warning on the line, the plan's note. None of that survives
 * a `<textarea>`, and a per-line contenteditable is a text editor nobody asked
 * this project to write.
 *
 * So: **Read** is the annotated view, and it is what opens. **Edit** is a
 * textarea holding exactly the text `GET /flows/:file` answered. Saving writes
 * it back and the screen re-loads, which re-lints — and the lint pane below is
 * the answer. The one thing that would be wrong is an editor whose text was
 * *derived* from the annotated lines: a round trip through them loses a trailing
 * newline the first time anybody saves.
 */
function Editor({
  state,
  draft,
  onEdit,
  onSelect,
}: {
  readonly state: FlowsState;
  readonly draft?: string;
  readonly onEdit: (text: string) => void;
  readonly onSelect: (line: number) => void;
}): React.JSX.Element {
  const editing = draft !== undefined;
  return (
    <>
      <div className="sv-panel-head">
        <span>{editing ? "Editing" : "Read"}</span>
        <span className="sv-spacer" />
        <Button
          id="flows-edit"
          label={editing ? "Stop editing" : "Edit"}
          variant="ghost"
          onPress={() => onEdit(editing ? (undefined as unknown as string) : state.text)}
        />
      </div>
      {editing ? (
        <textarea
          id="flows-editor-text"
          className="sv-code sv-code-edit"
          aria-label="Flow text"
          spellCheck={false}
          value={draft}
          onChange={(event) => onEdit(event.target.value)}
        />
      ) : (
        <ReadOnlyEditor state={state} onSelect={onSelect} />
      )}
    </>
  );
}

/** The annotated view: every line, with what the plan and the last run say. */
function ReadOnlyEditor({
  state,
  onSelect,
}: {
  readonly state: FlowsState;
  readonly onSelect: (line: number) => void;
}): React.JSX.Element {
  return (
    <div className="sv-code" id="flows-editor" aria-label="Flow editor">
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
      empty="Nothing compiled for this file yet. Press Compile to see the steps it makes."
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
        <Button id="inspector-record-step" label="Re-bind step" onPress={() => onAction("record.start")} />
      </div>
    </>
  );
}
