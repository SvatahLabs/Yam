/**
 * Surfaces — connect to something, then inspect and act on it (T14, T15).
 *
 * Two moods of one screen. With no session chosen it is T14's connect flow:
 * discovery grouped by platform with the exact prerequisite for anything
 * unavailable, and the sessions that are open. With a session chosen it is
 * T15's action inspector: the semantic tree on the left, and on the right the
 * selected control with a form built from what the *catalogue* says the action
 * needs — fill takes a value, click takes the control, drag takes two, navigate
 * takes a URL, and an HTTP surface gets method and path instead.
 *
 * Everything here is the model's (`@svatah/yam-screens`'s `SurfacesState` and
 * `surfaceOutcomeView`); this file decides only where each thing goes. In
 * particular it never decides whether something was *verified*: that is the
 * model reading a postcondition's result, and it is false without one.
 */
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chooser,
  Field,
  InspectorSection,
  KeyValues,
  Pill,
  Table,
} from "@svatah/yam-ui";
import {
  surfaceOutcomeView,
  type SurfacesState,
  type SurfaceAdapterRow,
  type SurfaceActionOffer,
} from "@svatah/yam-screens";
import { Toolbar, EmptyInspector } from "./parts.js";
import type { ScreenProps } from "./Secondary.js";

/** `Browser` → `browser`, for an `automationId` a desktop flow can address. */
const slug = (text: string): string => text.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();

/**
 * What a postcondition can say, in the words the mockup uses.
 *
 * The predicate kinds are the contract's (`VALUE_PREDICATE_KINDS`,
 * `STATE_PREDICATE_KINDS`); these are the handful an inspector offers, each
 * with whether it needs a value beside it.
 */
const VERIFY_KINDS: ReadonlyArray<{ kind: string; label: string; needsValue: boolean }> = [
  { kind: "", label: "Nothing — dispatch only", needsValue: false },
  { kind: "value", label: "Value equals", needsValue: true },
  { kind: "text", label: "Text equals", needsValue: true },
  { kind: "textContains", label: "Text contains", needsValue: true },
  { kind: "visible", label: "Is visible", needsValue: false },
  { kind: "checked", label: "Is checked", needsValue: false },
  { kind: "urlContains", label: "URL contains", needsValue: true },
];

export function SurfacesScreen(props: ScreenProps<SurfacesState>): React.JSX.Element {
  const { state } = props;

  /*
   * The URL and the chosen adapter are the window's, not screen parameters
   * (K7's pattern, the API screen's `draft`): what a person is typing before
   * they connect is not what the screen re-loads with. Holding them as
   * parameters made the model re-load on every keystroke — a reload storm that
   * raced selection.
   */
  const [url, setUrl] = useState("");
  const [adapter, setAdapter] = useState("");

  const adapterOptions = [
    { value: "", label: "Automatic" },
    ...state.groups.flatMap((group) =>
      group.adapters.map((one) => ({
        value: one.adapter,
        label: one.available ? one.adapter : `${one.adapter} (unavailable)`,
        disabled: !one.available,
      })),
    ),
  ];

  const connect = props.actions.find((one) => one.id === "surface.connect");
  // Connect is the connect *bar*'s primary, not a toolbar button (T14): a URL
  // field is too wide for the 40px toolbar and overlapped the buttons there at
  // 1440×1000.
  const toolbarActions = props.actions.filter(
    (one) => one.id !== "surface.connect" && one.id !== "surface.act" && one.id !== "surface.request",
  );
  const doConnect = (): void => props.onAction("surface.connect", { url, adapter });

  const connected = state.session !== undefined;

  return (
    <>
      <Toolbar state={state} actions={toolbarActions} onAction={props.onAction} />

      {connected ? null : (
        <div className="sv-surfaces-connect" role="group" aria-label="Connect a surface">
          <Field
            id="surfaces-url"
            label="URL"
            value={url}
            placeholder="http://127.0.0.1:4173"
            monospace
            onChange={setUrl}
            onSubmit={doConnect}
          />
          <Chooser
            id="surfaces-adapter"
            label="Adapter"
            value={adapter}
            options={adapterOptions}
            onChange={setAdapter}
          />
          <Button
            id="action-surface-connect"
            label="Connect surface"
            variant="primary"
            {...(connect?.key === undefined ? {} : { accelerator: connect.key })}
            disabled={connect === undefined ? false : !connect.availableWhen(state as never)}
            onPress={doConnect}
          />
        </div>
      )}

      {state.discoveryMessage === undefined ? null : (
        <Alert id="surfaces-discovery-error" tone="abort">
          {state.discoveryMessage} Press <b>Recheck targets</b> to try again — the connect form still
          works and starts the broker when you use it.
        </Alert>
      )}

      {/*
        The SF-17 state the surface is in, and the way out of it. Never a bare
        colour and never a dead end: every one names its next action, and an
        unknown outcome offers inspection rather than a Retry.
      */}
      {state.problem === undefined ? null : (
        <Alert id={`surfaces-problem-${state.problem.kind}`} tone="abort">
          <b>{state.problem.message}</b> {state.problem.nextAction}.
          {state.problem.nextActionId === undefined ? null : (
            <>
              {" "}
              <Button
                id={`surfaces-problem-action`}
                label={state.problem.nextAction}
                variant="ghost"
                onPress={() => props.onAction(state.problem!.nextActionId!)}
              />
            </>
          )}
        </Alert>
      )}

      <div className="sv-main">
        <aside className="sv-list" id="surfaces-sessions-pane" aria-label="Open sessions">
          <Table<SurfacesState["sessions"][number]>
            id="surfaces-sessions"
            label="Open sessions"
            rows={[...state.sessions]}
            rowKey={(row) => row.sessionId}
            selected={state.selected ?? ""}
            onSelect={(selected) => props.onParams({ ...props.params, selected, ref: undefined })}
            empty="Choose a browser, app, device or API to control. Enter a URL above and press Connect surface."
            columns={[
              {
                key: "session",
                header: "session",
                cell: (row) => (
                  <span className="sv-flow-row">
                    <span className="sv-flow-name sv-mono">{row.sessionId}</span>
                    <span className="sv-flow-meta">
                      {row.adapter}
                      {row.kind === "" ? "" : ` · ${row.kind}`}
                    </span>
                  </span>
                ),
              },
              {
                key: "status",
                header: "status",
                cell: (row) => <Pill tone={row.pill.tone} label={row.pill.label} />,
              },
            ]}
          />
        </aside>

        {connected ? (
          <SurfaceBody {...props} />
        ) : (
          <div className="sv-editor" id="surfaces-discovery" aria-label="What you can connect to">
            {state.groups.length === 0 ? (
              <p className="sv-empty">
                No adapter is installed. `yam surface targets` shows the same list from a terminal.
              </p>
            ) : (
              state.groups.map((group) => (
                <section
                  key={group.family}
                  className="sv-surface-group"
                  id={`surfaces-group-${slug(group.family)}`}
                  aria-labelledby={`surfaces-group-${slug(group.family)}-heading`}
                >
                  <h3
                    className="sv-inspector-heading"
                    id={`surfaces-group-${slug(group.family)}-heading`}
                  >
                    {group.family}
                  </h3>
                  <Table<SurfaceAdapterRow>
                    id={`surfaces-adapters-${slug(group.family)}`}
                    label={`${group.family} adapters`}
                    rows={[...group.adapters]}
                    rowKey={(row) => row.adapter}
                    empty="No adapter here."
                    columns={[
                      { key: "adapter", header: "adapter", monospace: true, cell: (row) => row.adapter },
                      {
                        key: "status",
                        header: "status",
                        cell: (row) => <Pill tone={row.pill.tone} label={row.pill.label} />,
                      },
                      {
                        key: "requires",
                        header: "requires",
                        cell: (row) =>
                          row.available ? (
                            <span className="sv-muted">ready</span>
                          ) : (
                            <span className="sv-tone-abort">
                              {row.reason ?? row.prerequisites.join(", ") ?? "unavailable"}
                            </span>
                          ),
                      },
                    ]}
                  />
                </section>
              ))
            )}
          </div>
        )}
      </div>
    </>
  );
}

/**
 * The connected surface: its semantic tree, or an HTTP surface's request form.
 *
 * The tree is always available, including where a screenshot is not — which is
 * why it, and not a picture, is what the inspector selects from.
 */
function SurfaceBody(props: ScreenProps<SurfacesState>): React.JSX.Element {
  const { state } = props;

  if (state.httpSurface) return <HttpForm {...props} />;

  return (
    <div className="sv-editor" id="surfaces-tree-pane" aria-label="Current surface">
      <div className="sv-panel-head">
        <span>Current surface</span>
        <span className="sv-spacer" />
        {state.truncated ? <Pill tone="abort" label="truncated" /> : null}
        <span className="sv-chip">{state.tree.length} controls</span>
      </div>
      {state.tree.length === 0 ? (
        <p className="sv-empty">
          Nothing to act on here yet. Press <b>Refresh and select again</b> to take a fresh
          snapshot of what is on the surface now.
        </p>
      ) : (
        <div className="sv-code" id="surfaces-tree" aria-label="Semantic tree">
          {state.tree.map((line) => (
            <button
              key={line.ref}
              id={`surfaces-node-${slug(line.ref)}`}
              type="button"
              className={line.selected ? "sv-code-line sv-code-current" : "sv-code-line"}
              aria-pressed={line.selected}
              onClick={() => props.onParams({ ...props.params, ref: line.ref })}
            >
              <span className="sv-code-text">
                {"  ".repeat(Math.min(line.depth, 8))}
                {line.role}
                {line.name === undefined ? "" : ` "${line.name}"`}
                {line.value === undefined ? "" : ` = ${line.value}`}
              </span>
              <span className="sv-code-note">{line.ref}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** An HTTP surface has no elements: method and path are its form (T15, SF-04). */
function HttpForm(props: ScreenProps<SurfacesState>): React.JSX.Element {
  const [method, setMethod] = useState("GET");
  const [path, setPath] = useState("");
  const send = (): void => props.onAction("surface.request", { method, url: path });

  return (
    <div className="sv-editor" id="surfaces-http" aria-label="HTTP request">
      <div className="sv-panel-head">
        <span>Request</span>
      </div>
      <div className="sv-surfaces-connect">
        <Chooser
          id="surfaces-http-method"
          label="Method"
          value={method}
          options={["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"].map((one) => ({
            value: one,
            label: one,
          }))}
          onChange={setMethod}
        />
        <Field
          id="surfaces-http-url"
          label="Path or URL"
          value={path}
          placeholder="/things?q=1"
          monospace
          onChange={setPath}
          onSubmit={send}
        />
        <Button
          id="action-surface-request"
          label="Send the request"
          variant="primary"
          accelerator="⌘↵"
          onPress={send}
        />
      </div>
      <p className="sv-card">
        An HTTP target has no controls to click: its tree is empty and an action on an element is
        refused. This sends the request through the same adapter an <span className="sv-mono">api</span>{" "}
        step uses, so what is sent here is what a run would send.
      </p>
      <LastResult {...props} />
    </div>
  );
}

/**
 * Dispatch and verification, shown separately (SF-11).
 *
 * `verified` is the model's, and it is true only when a postcondition passed.
 * An action that reached the target and was never checked reads "dispatched,
 * not verified" — not a tick.
 */
function LastResult(props: ScreenProps<SurfacesState>): React.JSX.Element | null {
  const [details, setDetails] = useState(false);
  const view = surfaceOutcomeView(props.lastOutcome?.value);
  if (view === undefined) return null;

  return (
    <section className="sv-surfaces-result" id="surfaces-last-result" aria-label="Last action">
      <div className="sv-panel-head">
        <span>Last action</span>
        <span className="sv-spacer" />
        <Pill
          tone={view.dispatched ? "pass" : "fail"}
          label={view.dispatched ? "dispatched" : "refused"}
        />
        <Pill
          tone={
            view.verification === "passed"
              ? "pass"
              : view.verification === "failed"
                ? "fail"
                : "neutral"
          }
          label={
            view.verification === "passed"
              ? "verified"
              : view.verification === "failed"
                ? "not verified"
                : "unverified"
          }
        />
        <Button
          id="surfaces-result-details"
          label={details ? "Hide details" : "Details"}
          variant="ghost"
          onPress={() => setDetails((one) => !one)}
        />
      </div>
      <p className="sv-card" id="surfaces-result-summary">
        {view.summary}
      </p>
      {view.verification === "none" ? null : (
        <KeyValues
          rows={[
            { key: "Expected", value: <span className="sv-mono">{view.expected ?? "—"}</span> },
            { key: "Observed", value: <span className="sv-mono">{view.actual ?? "—"}</span> },
          ]}
        />
      )}
      {details ? (
        <pre className="sv-block" id="surfaces-result-raw" aria-label="The request and its answer">
          {view.raw}
        </pre>
      ) : null}
    </section>
  );
}

export function SurfacesInspector(props: ScreenProps<SurfacesState>): React.JSX.Element {
  const { state } = props;
  const session = state.sessions.find((one) => one.selected);

  /*
   * The form's values are the window's, not screen parameters: what is typed
   * into "Value" before Act is pressed is a draft, and a parameter is what the
   * screen re-loads with. They are cleared when the selected control changes.
   */
  const [values, setValues] = useState<Record<string, string>>({});
  const [verifyKind, setVerifyKind] = useState("");
  const [verifyValue, setVerifyValue] = useState("");
  const [ref2, setRef2] = useState("");
  useEffect(() => {
    setValues({});
  }, [state.ref, state.action]);

  if (session === undefined) {
    return (
      <EmptyInspector id="inspector-empty" title="Inspector">
        Choose an open session to inspect it, or connect a new surface. Nothing here needs a
        project.
      </EmptyInspector>
    );
  }

  const offer = state.offers.find((one) => one.chosen);

  return (
    <>
      <InspectorSection id="inspector-session" title="Session">
        <KeyValues
          rows={[
            { key: "Session", value: <span className="sv-mono">{session.sessionId}</span> },
            { key: "Adapter", value: <span className="sv-mono">{session.adapter}</span> },
            { key: "Kind", value: session.kind === "" ? "—" : session.kind },
            { key: "Status", value: <Pill tone={session.pill.tone} label={session.pill.label} /> },
          ]}
        />
      </InspectorSection>

      {state.httpSurface ? null : state.element === undefined ? (
        <EmptyInspector id="inspector-select" title="Selected">
          Click a control in the tree to act on it. The tree is the surface as the adapter sees it,
          so what is listed is what can be addressed.
        </EmptyInspector>
      ) : (
        <>
          <InspectorSection id="inspector-element" title={state.element.name ?? state.element.ref}>
            <p className="sv-inspector-subject">{state.element.summary}</p>
            <KeyValues
              rows={[
                { key: "Role", value: state.element.role },
                ...(state.element.value === undefined
                  ? []
                  : [{ key: "Value", value: <span className="sv-mono">{state.element.value}</span> }]),
                { key: "Reference", value: <span className="sv-mono">{state.element.ref}</span> },
              ]}
            />
          </InspectorSection>

          <InspectorSection id="inspector-action" title="Do something">
            {/*
              The action, and the fields it needs — both from the catalogue. A
              form is never empty and never asks for an argument the contract
              does not name, which is what stops "Choose an action" being a
              dead end.
            */}
            <Chooser
              id="surfaces-action"
              label="Action"
              value={state.action ?? ""}
              options={state.offers.map((one: SurfaceActionOffer) => ({
                value: one.action,
                label: one.label,
              }))}
              onChange={(action) => props.onParams({ ...props.params, action })}
            />

            {(offer?.fields ?? []).map((field) => (
              <Field
                key={field.name}
                id={`surfaces-field-${slug(field.name)}`}
                label={field.required ? field.label : `${field.label} (optional)`}
                value={values[field.name] ?? ""}
                {...(field.placeholder === undefined ? {} : { placeholder: field.placeholder })}
                onChange={(value) => setValues((one) => ({ ...one, [field.name]: value }))}
              />
            ))}

            {offer?.needsRef2 === true ? (
              <Field
                id="surfaces-ref2"
                label="Onto which control"
                value={ref2}
                placeholder="a reference from the tree"
                monospace
                onChange={setRef2}
              />
            ) : null}

            <Chooser
              id="surfaces-verify"
              label="Verify afterwards"
              value={verifyKind}
              options={VERIFY_KINDS.map((one) => ({ value: one.kind, label: one.label }))}
              onChange={setVerifyKind}
            />
            {VERIFY_KINDS.find((one) => one.kind === verifyKind)?.needsValue === true ? (
              <Field
                id="surfaces-verify-value"
                label="Expected"
                value={verifyValue}
                placeholder="what it should be"
                onChange={setVerifyValue}
              />
            ) : null}

            <div className="sv-inspector-actions">
              <Button
                id="action-surface-act"
                label={offer === undefined ? "Perform the action" : offer.label}
                variant="primary"
                accelerator="⌘↵"
                disabled={offer === undefined}
                onPress={() =>
                  props.onAction("surface.act", {
                    action: state.action,
                    args: values,
                    ...(state.snapshotId === undefined ? {} : { snapshot: state.snapshotId }),
                    ...(ref2 === "" ? {} : { ref2 }),
                    ...(verifyKind === ""
                      ? {}
                      : { verify: { kind: verifyKind, value: verifyValue } }),
                  })
                }
              />
              <Button
                id="action-surface-read"
                label="Read a value"
                onPress={() => props.onAction("surface.read", { kind: "text" })}
              />
            </div>
          </InspectorSection>
        </>
      )}

      {state.httpSurface ? null : <LastResult {...props} />}
    </>
  );
}
