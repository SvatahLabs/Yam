/**
 * Agents and tools, API, Data, Surface explorer, Import, Settings (T10.2,
 * REQ-ADE-11, LLD §13.7).
 *
 * The six screens the `Agents` artboard and the four artboards this phase added
 * describe. They are in one file because they are one *kind* of screen — a list
 * or a table, an editor, an inspector — and six files each with the same three
 * shapes in it would be five opportunities for them to drift.
 *
 * Every value is the model's (`@svatah/screens`'s `AgentsState`, `ApiState`,
 * `DataState`, `ExplorerState`, `ImportState`, `SettingsState`). What this file
 * decides is where each goes on a page.
 */
import { useEffect, useState } from "react";
import { Alert, Button, Chooser, Field, InspectorSection, KeyValues, Pill, Table } from "@svatah/ui";
import type {
  Action,
  AgentsState,
  ApiState,
  DataState,
  ExplorerState,
  ImportState,
  ScreenParams,
  SettingsState,
} from "@svatah/screens";
import { Code, Counts, EmptyInspector, Toolbar } from "./parts.js";

/** What every one of these six takes. */
export interface ScreenProps<S> {
  readonly state: S;
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

/* ────────────────────────────────────────────────────────────────────────────
 * Agents and tools (the `Agents` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

export function AgentsScreen(props: ScreenProps<AgentsState>): React.JSX.Element {
  const { state } = props;
  return (
    <>
      <Toolbar state={state} actions={props.actions} onAction={props.onAction} />
      <div className="sv-main">
        <aside className="sv-list" id="agents-tools-pane" aria-label="Exposed tools">
          <Table<AgentsState["tools"][number]>
            id="agents-tools"
            label="Tools"
            rows={[...state.tools]}
            rowKey={(row) => row.name}
            selected={state.selected ?? ""}
            onSelect={(selected) => props.onParams({ ...props.params, selected })}
            empty="No story is exposed as a tool. `svatah tool serve --expose` chooses them."
            columns={[
              {
                key: "name",
                header: "tool",
                cell: (row) => (
                  <span className="sv-flow-row">
                    <span className="sv-flow-name sv-mono">{row.name}</span>
                    <span className="sv-flow-meta">{row.story}</span>
                  </span>
                ),
              },
              {
                key: "idempotent",
                header: "side effects",
                cell: (row) =>
                  row.idempotent ? (
                    <Pill tone="pass" label="idempotent" />
                  ) : (
                    <Pill tone="abort" label="side effects" />
                  ),
              },
            ]}
          />
        </aside>
        <div className="sv-editor">
          <Table<AgentsState["invocations"][number]>
            id="agents-invocations"
            label="Invocations"
            rows={[...state.invocations]}
            rowKey={(row) => `${row.at}-${row.tool}`}
            onSelect={(key) => {
              const found = state.invocations.find((one) => `${one.at}-${one.tool}` === key);
              if (found?.runId !== undefined) props.onParams({ ...props.params, runId: found.runId });
            }}
            empty="No agent has called a tool yet. Each invocation is a deterministic run with an audit record."
            columns={[
              { key: "at", header: "when", monospace: true, cell: (row) => row.at },
              { key: "tool", header: "tool", monospace: true, cell: (row) => row.tool },
              { key: "invoker", header: "invoker", cell: (row) => row.invoker },
              { key: "run", header: "run", monospace: true, cell: (row) => row.runId ?? "—" },
              {
                key: "status",
                header: "status",
                cell: (row) => <Pill tone={row.status.tone} label={row.status.label} />,
              },
            ]}
          />
        </div>
      </div>
    </>
  );
}

export function AgentsInspector(props: ScreenProps<AgentsState>): React.JSX.Element {
  const chosen = props.state.tools.find((one) => one.selected);
  return (
    <>
      {chosen === undefined ? (
        <EmptyInspector id="inspector-empty" title="Inspector">
          Choose a tool to see the story behind it and the inputs its schema
          derives from.
        </EmptyInspector>
      ) : (
        <InspectorSection id="inspector-tool" title={chosen.name}>
          <KeyValues
            rows={[
              { key: "Story", value: chosen.story },
              {
                key: "Side effects",
                value: chosen.idempotent ? (
                  <Pill tone="pass" label="idempotent" />
                ) : (
                  <Pill tone="abort" label="declares side effects" />
                ),
              },
              { key: "Inputs", value: chosen.inputs.join(", ") || "none" },
            ]}
          />
        </InspectorSection>
      )}

      <InspectorSection id="inspector-refused" title="Refused">
        {props.state.refused.length === 0 ? (
          <p className="sv-empty">Every exposed story is idempotent (REQ-AUTO-8).</p>
        ) : (
          <KeyValues
            rows={props.state.refused.map((one) => ({ key: one.story, value: one.reason }))}
          />
        )}
      </InspectorSection>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * API (the `Api` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

export function ApiScreen(props: ScreenProps<ApiState>): React.JSX.Element {
  const { state } = props;
  const saved = state.request;

  /*
   * The draft: the request as the form has it, before it is on disk (K7).
   *
   * The Phase 10 verification's K7 — the API screen could *send* a saved
   * request and not change one, so the only way to fix a header was a text
   * editor outside the ADE, and "a release cannot ship an 'editor' that does
   * not edit". Like the flow editor's draft this is the window's, not a screen
   * parameter: a parameter is what the screen re-loads with.
   */
  const [draft, setDraft] = useState<ApiState["request"] | undefined>(undefined);
  const chosen = state.selected;
  useEffect(() => setDraft(undefined), [chosen]);

  const request = draft ?? saved;
  const dirty =
    draft !== undefined && JSON.stringify(draft) !== JSON.stringify(saved);
  const edit = (change: Partial<NonNullable<ApiState["request"]>>): void => {
    if (request === undefined) return;
    setDraft({ ...request, ...change });
  };

  return (
    <>
      <Toolbar
        state={state}
        actions={props.actions}
        onAction={(id, args) =>
          props.onAction(
            id,
            // Both `api.send` and `api.save` act on what is *in the form*, not
            // on what was last read from disk — which is the whole of K7.
            id === "api.send" || id === "api.save"
              ? { ...args, request: request as unknown as Record<string, unknown> }
              : args,
          )
        }
        primary="api.send"
        {...(dirty ? { beside: <Pill tone="abort" label="unsaved" /> } : {})}
      />
      <div className="sv-main">
        <aside className="sv-list" id="api-requests-pane" aria-label="Named requests">
          <Table<ApiState["requests"][number]>
            id="api-requests"
            label="Named requests"
            rows={[...state.requests]}
            rowKey={(row) => row.name}
            selected={state.selected ?? ""}
            onSelect={(selected) => props.onParams({ ...props.params, selected })}
            empty="No named request in api/."
            columns={[
              {
                key: "name",
                header: "request",
                cell: (row) => (
                  <span className="sv-flow-row">
                    <span className="sv-flow-name">{row.name}</span>
                    <span className="sv-flow-meta sv-mono">{row.url}</span>
                  </span>
                ),
              },
              {
                key: "method",
                header: "method",
                cell: (row) => <Pill tone="neutral" label={row.method} />,
              },
            ]}
          />
        </aside>

        <div className="sv-editor sv-split">
          <div className="sv-steps" id="api-request" aria-label="Request">
            {request === undefined ? (
              <p className="sv-empty">Choose a request.</p>
            ) : (
              <>
                <div className="sv-panel-head">
                  <Chooser
                    id="api-method"
                    label="Method"
                    value={request.method}
                    options={["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((one) => ({
                      value: one,
                      label: one,
                    }))}
                    onChange={(method) => edit({ method })}
                  />
                  <Field
                    id="api-url"
                    label="URL"
                    value={request.url}
                    onChange={(url) => edit({ url })}
                  />
                  <span className="sv-spacer" />
                  <Counts items={request.file === undefined ? [] : [request.file]} />
                </div>
                {/*
                  The headers, editable (K7). A blank last row is how one is
                  added, and blanking a name is how one is removed — the same
                  two gestures a person expects, with no button that only exists
                  to say "add".
                */}
                <div className="sv-headers" id="api-headers" aria-label="Headers">
                  {[...request.headers, { key: "", value: "" }].map((row, at) => (
                    <div className="sv-header-row" key={`header-${at}`}>
                      <Field
                        id={`api-header-key-${at}`}
                        label={at === 0 ? "Header" : `Header ${at + 1}`}
                        hideLabel
                        value={row.key}
                        placeholder="header"
                        onChange={(key) =>
                          edit({
                            headers: [...request.headers, { key: "", value: "" }]
                              .map((one, index) => (index === at ? { ...one, key } : one))
                              .filter((one) => one.key.trim() !== ""),
                          })
                        }
                      />
                      <Field
                        id={`api-header-value-${at}`}
                        label={at === 0 ? "Value" : `Value ${at + 1}`}
                        hideLabel
                        value={row.value}
                        placeholder="value"
                        onChange={(value) =>
                          edit({
                            headers: [...request.headers, { key: "", value: "" }]
                              .map((one, index) => (index === at ? { ...one, value } : one))
                              .filter((one) => one.key.trim() !== ""),
                          })
                        }
                      />
                    </div>
                  ))}
                </div>
                <div className="sv-panel-head">
                  <span>Request body</span>
                </div>
                <textarea
                  id="api-body"
                  className="sv-code sv-code-edit"
                  aria-label="Request body"
                  spellCheck={false}
                  value={request.body ?? ""}
                  onChange={(event) => edit({ body: event.target.value })}
                />
              </>
            )}
          </div>

          <div className="sv-audit-panel">
            <div className="sv-panel-head">
              <span>Response</span>
              <span className="sv-spacer" />
              {state.response === undefined ? null : (
                <>
                  <Pill tone={state.response.statusPill.tone} label={state.response.statusPill.label} />
                  <Counts
                    items={[
                      state.response.durationMs === undefined
                        ? "—"
                        : `${state.response.durationMs} ms`,
                      `${state.response.bytes ?? 0} B`,
                    ]}
                  />
                </>
              )}
            </div>
            {state.response === undefined ? (
              <p className="sv-empty">
                Press Send. Nothing is written to the project, and a response body is
                never stored.
              </p>
            ) : (
              <>
                <Code label="Response body" lines={state.response.body.split("\n")} />
                {state.response.paths.length === 0 ? null : (
                  <div className="sv-inspector-actions">
                    {state.response.paths.map((path) => (
                      <Button
                        key={path}
                        id={`api-path-${path.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()}`}
                        label={`Capture ${path}`}
                        title={`Writes: Remember the response as ${path.replace("$.", "")}`}
                        onPress={() => props.onAction("go.flows")}
                      />
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export function ApiInspector(props: ScreenProps<ApiState>): React.JSX.Element {
  const request = props.state.request;
  if (request === undefined) {
    return (
      <EmptyInspector id="inspector-empty" title="Inspector">
        Choose a named request to see where it lives and what it sends.
      </EmptyInspector>
    );
  }
  return (
    <>
      <InspectorSection id="inspector-request" title={request.name}>
        <KeyValues
          rows={[
            { key: "Method", value: <span className="sv-mono">{request.method}</span> },
            { key: "URL", value: <span className="sv-mono">{request.url}</span> },
            { key: "File", value: <span className="sv-mono">{request.file ?? "—"}</span> },
            { key: "Headers", value: String(request.headers.length) },
          ]}
        />
        <p className="sv-card">
          Sent through the same function <span className="sv-mono">svatah run</span> uses for an
          <span className="sv-mono"> api</span> step, so this is not a second HTTP client with its
          own idea of a header.
        </p>
      </InspectorSection>

      {props.state.response === undefined ? null : (
        <InspectorSection id="inspector-response" title="Response headers">
          <KeyValues
            rows={props.state.response.headers.map((one) => ({
              key: one.key,
              value: <span className="sv-mono">{one.value}</span>,
            }))}
          />
        </InspectorSection>
      )}
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Data (the `Data` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

export function DataScreen(props: ScreenProps<DataState>): React.JSX.Element {
  const { state } = props;
  return (
    <>
      <Toolbar state={state} actions={props.actions} onAction={props.onAction} primary="data.save" />
      <div className="sv-main" style={{ flexDirection: "column" }}>
        {state.unset === 0 ? null : (
          <Alert id="data-secret-unset" tone="abort">
            {state.unset} secret{state.unset === 1 ? "" : "s"} name{state.unset === 1 ? "s" : ""} an
            environment variable this service cannot read. A run that needs one fails on the step
            that types it.
          </Alert>
        )}
        <Table<DataState["rows"][number]>
          id="data-table"
          label="Run data"
          rows={[...state.rows]}
          rowKey={(row) => row.path}
          selected={state.selected ?? ""}
          onSelect={(selected) => props.onParams({ ...props.params, selected })}
          empty="This project has no run data. `data.yaml` is where it goes."
          columns={[
            { key: "path", header: "key", monospace: true, cell: (row) => row.path },
            {
              key: "value",
              header: "value",
              monospace: true,
              /*
               * A secret's *name*, never its value (REQ-NFR-6). The service
               * redacts on read; what is shown is the variable it is read from,
               * which is the only thing about a secret that is safe to draw.
               */
              cell: (row) =>
                row.secret ? (
                  <span className="sv-muted">
                    reads <span className="sv-mono">${`{${row.reads ?? "?"}}`}</span>
                  </span>
                ) : (
                  row.value
                ),
            },
            {
              key: "kind",
              header: "kind",
              cell: (row) => <Pill tone={row.kind.tone} label={row.kind.label} />,
            },
          ]}
        />
      </div>
    </>
  );
}

export function DataInspector(props: ScreenProps<DataState>): React.JSX.Element {
  const chosen = props.state.rows.find((one) => one.selected);
  if (chosen === undefined) {
    return (
      <EmptyInspector id="inspector-empty" title="Inspector">
        Choose a key to see what it is and where it is read from.
      </EmptyInspector>
    );
  }
  return (
    <InspectorSection id="inspector-value" title={chosen.path}>
      <KeyValues
        rows={[
          { key: "Kind", value: <Pill tone={chosen.kind.tone} label={chosen.kind.label} /> },
          ...(chosen.secret
            ? [
                {
                  key: "Reads",
                  value: <span className="sv-mono">${`{${chosen.reads ?? "?"}}`}</span>,
                },
              ]
            : [{ key: "Value", value: <span className="sv-mono">{chosen.value}</span> }]),
        ]}
      />
      {chosen.secret ? (
        <p className="sv-card">
          The value is never shown, never saved to <span className="sv-mono">data.yaml</span>, and
          never reaches a prompt, the audit, a result, a trace or a screenshot (REQ-NFR-6). What is
          edited here is the <i>name</i> of the variable it is read from.
        </p>
      ) : null}
    </InspectorSection>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Surface explorer (the `Explorer` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

export function ExplorerScreen(props: ScreenProps<ExplorerState>): React.JSX.Element {
  const { state } = props;
  const intent = state.intent ?? "";
  return (
    <>
      <Toolbar
        state={state}
        actions={props.actions}
        onAction={props.onAction}
        primary="explorer.snapshot"
      >
        <Chooser
          id="explorer-adapter"
          label="Adapter"
          value={state.adapter}
          options={state.adapters.map((one) => ({ value: one, label: one }))}
          onChange={(adapter) => props.onParams({ ...props.params, adapter })}
        />
      </Toolbar>

      <div className="sv-main">
        <aside className="sv-list" id="explorer-snapshot-pane" aria-label="Snapshot">
          {state.snapshot.length === 0 ? (
            <p className="sv-empty">
              {state.sessionId === undefined
                ? "Open a session to read its accessibility tree."
                : "Take a snapshot to see what is on the screen."}
            </p>
          ) : (
            <div className="sv-code" id="explorer-snapshot" aria-label="Snapshot tree">
              {state.snapshot.map((line, at) => (
                <button
                  key={at}
                  id={`snapshot-node-${at}`}
                  type="button"
                  className={line.selected ? "sv-code-line sv-code-current" : "sv-code-line"}
                  onClick={() =>
                    line.ref === undefined
                      ? undefined
                      : props.onParams({ ...props.params, selected: line.ref })
                  }
                >
                  <span className="sv-code-text">
                    {"  ".repeat(line.depth)}
                    {line.role}
                    {line.name === undefined ? "" : ` "${line.name}"`}
                  </span>
                  <span className="sv-code-note">{line.ref ?? ""}</span>
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="sv-editor">
          <div className="sv-toolbar">
            <Field
              id="explorer-intent"
              label="Intent"
              value={intent}
              placeholder="what this call is for"
              onChange={(value) => props.onParams({ ...props.params, intent: value })}
              onSubmit={() => props.onAction("explorer.snapshot")}
            />
          </div>

          {intent.trim() === "" ? (
            <Alert id="explorer-intent-required" tone="abort">
              <b>Every call records an intent.</b> A surface call is refused without one: the intent
              is what <span className="sv-mono">trajectory compile</span> turns into a step, and a
              call without it is a line the compiler has to throw away (REQ-BEH-4).
            </Alert>
          ) : null}

          <Table<ExplorerState["calls"][number]>
            id="explorer-calls"
            label="Trajectory"
            rows={[...state.calls]}
            rowKey={(row) => String(row.seq)}
            empty="No call yet. Each one is written to trajectory.jsonl with its intent."
            columns={[
              { key: "seq", header: "#", align: "right", cell: (row) => row.seq },
              { key: "call", header: "call", monospace: true, cell: (row) => row.call },
              { key: "intent", header: "intent", cell: (row) => row.intent },
              {
                key: "ok",
                header: "outcome",
                cell: (row) =>
                  row.ok ? <Pill tone="pass" label="ok" /> : <Pill tone="fail" label="failed" />,
              },
              {
                key: "duration",
                header: "time",
                align: "right",
                cell: (row) => (row.durationMs === undefined ? "—" : `${row.durationMs} ms`),
              },
            ]}
          />
        </div>
      </div>
    </>
  );
}

export function ExplorerInspector(props: ScreenProps<ExplorerState>): React.JSX.Element {
  const { state } = props;
  return (
    <>
      <InspectorSection id="inspector-session" title="Session">
        <KeyValues
          rows={[
            { key: "Adapter", value: <span className="sv-mono">{state.adapter}</span> },
            { key: "Base URL", value: <span className="sv-mono">{state.baseUrl ?? "—"}</span> },
            { key: "Session", value: <span className="sv-mono">{state.sessionId ?? "none"}</span> },
            {
              key: "Trajectory",
              value: <span className="sv-mono">{state.trajectory ?? "—"}</span>,
            },
            { key: "Calls", value: String(state.calls.length) },
          ]}
        />
      </InspectorSection>

      <InspectorSection id="inspector-compile" title="Compile to proposal">
        <p className="sv-card">
          Writes a story draft, a plan and a seed bindings store under{" "}
          <span className="sv-mono">proposals/</span>, every binding marked unverified. It writes
          nowhere else, and it keeps the calls that failed: a trajectory is an account of what an
          agent did, and dropping the mistakes would make the proposal a story of a session that
          never happened.
        </p>
        {state.proposal === undefined ? null : (
          <p className="sv-inspector-subject sv-mono">{state.proposal}</p>
        )}
      </InspectorSection>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Import prototype database (the `Import` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

export function ImportScreen(props: ScreenProps<ImportState>): React.JSX.Element {
  const { state } = props;
  return (
    <>
      <Toolbar
        state={state}
        actions={props.actions}
        onAction={props.onAction}
        primary="import.prototype"
      />
      <div className="sv-main" style={{ flexDirection: "column" }}>
        <div className="sv-toolbar">
          <Field
            id="import-source"
            label="Prototype database"
            value={state.source ?? ""}
            placeholder="~/Library/Application Support/svatah-ade/db"
            monospace
            onChange={(source) => props.onParams({ ...props.params, source })}
            onSubmit={() => props.onAction("import.prototype")}
          />
          <span className="sv-toolbar-sub">
            into <span className="sv-mono">{state.root ?? "—"}</span> — the open project, and
            nowhere else
          </span>
        </div>

        {state.result === undefined ? (
          <p className="sv-empty">
            Choose the prototype&apos;s electron-db directory. Nothing is written until you import,
            and results and screenshots are never imported.
          </p>
        ) : (
          <>
            <Table<NonNullable<ImportState["result"]>["rows"][number]>
              id="import-rows"
              label="What was imported"
              rows={[...state.result.rows]}
              rowKey={(row) => row.from}
              empty="Nothing to import."
              columns={[
                { key: "from", header: "from", monospace: true, cell: (row) => row.from },
                { key: "becomes", header: "becomes", monospace: true, cell: (row) => row.becomes },
                { key: "count", header: "count", align: "right", cell: (row) => row.count },
                {
                  key: "state",
                  header: "state",
                  cell: (row) => <Pill tone={row.state.tone} label={row.state.label} />,
                },
              ]}
            />
            <div className="sv-panel-head">
              <span>migration-review.md</span>
              <span className="sv-spacer" />
              <span className="sv-chip">{state.result.notes.length} notes</span>
            </div>
            <ol className="sv-audit" id="import-notes" aria-label="Migration review">
              {state.result.notes.length === 0 ? (
                <li className="sv-empty">Nothing needed a decision.</li>
              ) : (
                state.result.notes.map((note, at) => (
                  <li key={at}>
                    <span className="sv-mono sv-audit-at">{note.where}</span>
                    <span className={note.needsDecision ? "sv-tone-abort" : ""}>{note.text}</span>
                  </li>
                ))
              )}
            </ol>
          </>
        )}
      </div>
    </>
  );
}

export function ImportInspector(props: ScreenProps<ImportState>): React.JSX.Element {
  const { state } = props;
  return (
    <>
      <InspectorSection id="inspector-confinement" title="Where it may write">
        <KeyValues
          rows={[
            { key: "Reads", value: <span className="sv-mono">{state.source ?? "—"}</span> },
            { key: "Writes", value: <span className="sv-mono">{state.root ?? "—"}</span> },
            { key: "Refuses", value: "anything outside it" },
          ]}
        />
        <p className="sv-card">
          The service confines every write to the directory it was opened on, and an import that
          could write anywhere would be the one route around that. The flow is: open an empty
          directory as a project, then import into it.
        </p>
      </InspectorSection>

      <InspectorSection id="inspector-cli" title="The same thing from a terminal">
        <p className="sv-card sv-mono">
          svatah migrate {state.root ?? "<dest>"} --from-ade {state.source ?? "<src>"}
        </p>
      </InspectorSection>

      <InspectorSection id="inspector-not-imported" title="Not imported">
        <KeyValues
          rows={[
            { key: "Results", value: "the prototype's runs" },
            { key: "Screenshots", value: "its images" },
            { key: "Why", value: "a run is evidence of a plan this project does not have" },
          ]}
        />
      </InspectorSection>
    </>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Settings
 * ──────────────────────────────────────────────────────────────────────────── */

export function SettingsScreen(props: ScreenProps<SettingsState>): React.JSX.Element {
  const { state } = props;
  const groups = [...new Set(state.rows.map((one) => one.group))];
  return (
    <>
      <Toolbar state={state} actions={props.actions} onAction={props.onAction} />
      <div className="sv-main" style={{ flexDirection: "column" }}>
        {groups.map((group) => (
          <Table<SettingsState["rows"][number]>
            key={group}
            id={`settings-${group.toLowerCase()}`}
            label={group}
            rows={state.rows.filter((one) => one.group === group)}
            rowKey={(row) => row.label}
            empty="Nothing here."
            columns={[
              { key: "label", header: "setting", cell: (row) => row.label },
              { key: "value", header: "value", monospace: true, cell: (row) => row.value },
            ]}
          />
        ))}
      </div>
    </>
  );
}

export function SettingsInspector(props: ScreenProps<SettingsState>): React.JSX.Element {
  const { state } = props;
  return (
    <>
      <InspectorSection id="inspector-diagnostics" title="Diagnostics">
        {state.diagnostics.length === 0 ? (
          <p className="sv-empty">This project compiles clean.</p>
        ) : (
          state.diagnostics.map((one, at) => (
            <p key={at} className="sv-card">
              <Pill tone={one.severity.tone} label={one.severity.label} />{" "}
              <span className="sv-mono">{one.code}</span> {one.message}
            </p>
          ))
        )}
      </InspectorSection>

      <InspectorSection id="inspector-sources" title="Where this came from">
        {/*
          Every screen says which endpoints it was built from (§13.6's screen
          rule made visible). This is the screen where a reader would look for
          it, so it is drawn rather than only carried in `--json`.
        */}
        <KeyValues rows={state.sources.map((one, at) => ({ key: `#${at + 1}`, value: one }))} />
      </InspectorSection>
    </>
  );
}
