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
 * Everything here is the model's (`@svatah/yam-screens`'s `SurfaceLoad` and
 * `surfaceOutcomeView`); this file decides only where each thing goes. In
 * particular it never decides whether something was *verified*: that is the
 * model reading a postcondition's result, and it is false without one.
 */
import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Chooser,
  Field,
  InspectorSection,
  KeyValues,
  Pill,
  Table,
} from "@svatah/yam-ui";
import {
  surfaceOutcomeView,
  type ScreenStateBase,
  type SurfaceLoad,
  type SurfaceAdapterRow,
  type SurfaceActionOffer,
} from "@svatah/yam-screens";
import { Toolbar, EmptyInspector, actionId } from "./parts.js";
import type { ScreenProps } from "./Secondary.js";
import { acceleratorFor } from "./keys.js";

/**
 * A half, with the screen it is being drawn on (TV-M04).
 *
 * The loader does not produce a `screen` — it is not a screen — and the toolbar
 * needs one, because a toolbar names what it is the toolbar of. Session supplies
 * it when it hands a half to the component that draws it.
 */
export type DrawnSurfaceLoad = SurfaceLoad & Pick<ScreenStateBase, "screen">;

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

export function SurfacesScreen(props: ScreenProps<DrawnSurfaceLoad>): React.JSX.Element {
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
  /*
   * Visible by default (TV-A09).
   *
   * The runtime has taken `headed` all along and nothing offered it, so
   * connecting from this screen drove a browser nobody could see — on the one
   * screen whose subject is watching what happens.
   */
  const [headed, setHeaded] = useState(true);

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
  /*
   * The actions this screen places itself, so the toolbar does not also draw
   * them (T16).
   *
   * `Toolbar` renders every action the screen offers, which is right for a
   * screen whose actions all belong in the bar. Surfaces puts several beside
   * the thing they act on — Connect in the connect bar, Act and Verify in the
   * inspector, Take control beside the session, Test beside the agent's
   * configuration — and a button drawn in both places is *two controls with one
   * id*, which is the ambiguity the desktop suite rightly fails.
   */
  const PLACED_BY_THE_SCREEN = new Set([
    "surface.connect",
    /*
     * `surface.discover` refreshes the panel below, and it was the reason the
     * toolbar drew at all on a window with nothing connected (`AX-01`,
     * `AX-05`).
     *
     * One available action in the bar is enough to make the bar appear, and
     * with it came three disabled ones — Disconnect, Check the surface, Refresh
     * and select again — all of them above the only task a new person can
     * perform. Rechecking targets is something you do *to the list of targets*,
     * so it goes on the list.
     */
    "surface.discover",
    "surface.act",
    "surface.request",
    "surface.take-control",
    "surface.release-control",
    "surface.test-agent",
    "surface.read",
    "surface.save-automation",
  ]);
  const toolbarActions = props.actions.filter((one) => !PLACED_BY_THE_SCREEN.has(one.id));
  const doConnect = (): void => props.onAction("surface.connect", { url, adapter, headed });

  const connected = state.session !== undefined;
  /*
   * The state the surface is in: what loading it found (a held target, a
   * stale control), or else what the last action came to (a timed-out
   * navigation, a refusal). The model computed the second and the first cut
   * never drew it, so an unknown outcome showed a raw adapter message and no
   * way out — the dead end SF-17 exists to forbid. One alert, one id.
   */
  const problem = state.problem ?? surfaceOutcomeView(props.lastOutcome?.value)?.problem;

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
          <Checkbox
            id="surfaces-headed"
            label="Show the browser"
            hint="Off runs it hidden, as a scheduled run does."
            checked={headed}
            onChange={setHeaded}
          />
          <Button
            id="action-surface-connect"
            label="Connect surface"
            variant="primary"
            {...(connect === undefined || acceleratorFor(connect.id) === undefined ? {} : { accelerator: acceleratorFor(connect.id)! })}
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
      {problem === undefined ? null : (
        <Alert id={`surfaces-problem-${problem.kind}`} tone="abort">
          <b>{problem.message}</b> {problem.nextAction}.
          {problem.nextActionId === undefined ? null : (
            <>
              {" "}
              <Button
                id={`surfaces-problem-action`}
                label={problem.nextAction}
                variant="ghost"
                onPress={() => props.onAction(problem.nextActionId!)}
              />
            </>
          )}
        </Alert>
      )}

      <div className="sv-main">
        <aside className="sv-list" id="surfaces-sessions-pane" aria-label="Open sessions">
          <Table<SurfaceLoad["sessions"][number]>
            id="surfaces-sessions"
            label="Open sessions"
            rows={[...state.sessions]}
            rowKey={(row) => row.sessionId}
            selected={state.selected ?? ""}
            onSelect={(selected) =>
              props.onParams({ ...props.params, selected, ref: undefined, snapshot: undefined })
            }
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
              {
                // Who is driving (SF-13, T16). A shared target is only safe to
                // look at when a person can see who has it.
                key: "control",
                header: "control",
                cell: (row) =>
                  row.controller === undefined ? (
                    <span className="sv-muted">{row.control}</span>
                  ) : (
                    <Pill tone={row.heldByYou ? "pass" : "info"} label={row.control} />
                  ),
              },
            ]}
          />
        </aside>

        {connected ? (
          <SurfaceBody {...props} />
        ) : (
          <Discovery {...props} />
        )}
      </div>
    </>
  );
}


/**
 * What you can connect to: a status, not a catalogue (`AX-06`, `B19`, `B20`).
 *
 * The first screen used to list every adapter Yam knows about with a column
 * explaining why four of them could not work — BiDi wants `YAM_BIDI_URL`, UIA
 * says "this host is darwin", Appium wants a server on 4723, AT-SPI says "this
 * host is darwin". A new person's first screen was mostly a list of things this
 * machine cannot do.
 *
 * What is ready is a sentence. What is not is behind one disclosure, with the
 * single command each needs — `install` comes from the adapter's own probe, so
 * it is the command that would actually work rather than a description of the
 * condition.
 */
function Discovery(props: ScreenProps<DrawnSurfaceLoad>): React.JSX.Element {
  const { state } = props;
  const discover = props.actions.find((one) => one.id === "surface.discover");
  const all = state.groups.flatMap((group) => group.adapters);
  const ready = all.filter((one) => one.available);
  const rest = all.filter((one) => !one.available);

  return (
    <div className="sv-editor" id="surfaces-discovery" aria-label="What you can connect to">
      <div className="sv-panel-head">
        <h2 id="surfaces-discovery-heading">Ready here</h2>
        <span className="sv-spacer" />
        {discover === undefined ? null : (
          <Button
            id={actionId(discover.id)}
            label={discover.label}
            variant="ghost"
            disabled={!discover.availableWhen(state as never)}
            onPress={() => props.onAction(discover.id)}
          />
        )}
      </div>

      {all.length === 0 ? (
        <p className="sv-empty" id="surfaces-discovery-empty">
          {state.discoveryEmpty}
        </p>
      ) : ready.length === 0 ? (
        <p className="sv-empty" id="surfaces-ready-none">
          Nothing on this machine is ready to drive yet. Open <b>Other ways to connect</b> below —
          each one names the command that installs it.
        </p>
      ) : (
        <p id="surfaces-ready">
          {ready.map((one) => one.adapter).join(", ")} — enter a target above and press{" "}
          <b>Connect surface</b>. Connecting opens it and brings you back here.
        </p>
      )}

      {rest.length === 0 ? null : (
        <details className="sv-disclosure" id="surfaces-other-ways">
          <summary>Other ways to connect ({rest.length})</summary>
          <Table<SurfaceAdapterRow>
            id="surfaces-adapters-other"
            label="Adapters that need something first"
            rows={[...rest]}
            rowKey={(row) => row.adapter}
            empty="Nothing else to offer."
            columns={[
              { key: "adapter", header: "adapter", monospace: true, cell: (row) => row.adapter },
              {
                key: "status",
                header: "status",
                cell: (row) => <Pill tone={row.pill.tone} label={row.pill.label} />,
              },
              {
                key: "needs",
                header: "to use it",
                cell: (row) =>
                  row.install === undefined ? (
                    <span className="sv-muted">
                      {row.reason ?? row.prerequisites.join(", ") ?? "not available here"}
                    </span>
                  ) : (
                    <code className="sv-mono">{row.install}</code>
                  ),
              },
            ]}
          />
        </details>
      )}
    </div>
  );
}

/**
 * The connected surface: its semantic tree, or an HTTP surface's request form.
 *
 * The tree is always available, including where a screenshot is not — which is
 * why it, and not a picture, is what the inspector selects from.
 */
function SurfaceBody(props: ScreenProps<DrawnSurfaceLoad>): React.JSX.Element {
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
              onClick={() =>
                // The control, and the snapshot it was chosen from (SF-10).
                props.onParams({ ...props.params, ref: line.ref, snapshot: state.snapshotId })
              }
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
function HttpForm(props: ScreenProps<DrawnSurfaceLoad>): React.JSX.Element {
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
function LastResult(props: ScreenProps<DrawnSurfaceLoad>): React.JSX.Element | null {
  const [details, setDetails] = useState(false);
  const view = surfaceOutcomeView(props.lastOutcome?.value);
  if (view === undefined) return null;

  return (
    <section className="sv-surfaces-result" id="surfaces-last-result" aria-label="Last action">
      <div className="sv-panel-head">
        <span>Last action</span>
        <span className="sv-spacer" />
        <Pill
          tone={view.dispatched ? "pass" : view.outcome === "unknown" ? "abort" : "fail"}
          label={view.dispatched ? "dispatched" : view.outcome}
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

export function SurfacesInspector(props: ScreenProps<DrawnSurfaceLoad>): React.JSX.Element {
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
      <>
        <EmptyInspector id="inspector-empty" title="Inspector">
          Choose an open session to inspect it, or connect a new surface. Nothing here needs a
          project.
        </EmptyInspector>
        <AgentPanel {...props} collapsed />
      </>
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
            {
              key: "Control",
              value: (
                <Pill tone={session.heldByYou ? "pass" : session.controller === undefined ? "neutral" : "info"}
                  label={session.control} />
              ),
            },
          ]}
        />
        <div className="sv-inspector-actions">
          {session.heldByYou ? (
            <Button
              id="action-surface-release-control"
              label="Give up control"
              onPress={() => props.onAction("surface.release-control")}
            />
          ) : (
            <Button
              id="action-surface-take-control"
              label="Take control"
              onPress={() => props.onAction("surface.take-control")}
            />
          )}
        </div>
        <p className="sv-card">
          One session, whoever opened it — a person here or an agent over MCP. While a target is
          held, an action from anyone else is refused and told who has it.
        </p>
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
                    ...((props.params.snapshot ?? state.snapshotId) === undefined
                      ? {}
                      : { snapshot: props.params.snapshot ?? state.snapshotId }),
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

      {/*
        Save as automation (T17, SF-19): promote what this session did into a
        reviewed proposal, without a flow and without a run. It is the optional
        automation layer built on the direct journey — never a step in it.
      */}
      <InspectorSection id="inspector-promote" title="Save as automation">
        <p className="sv-card">
          Turns what you have done in this session into a proposal under{" "}
          <span className="sv-mono">proposals/</span> for review. No flow is written and nothing is
          run. Every binding it proposes is <b>unverified</b> until you verify it.
        </p>
        <div className="sv-inspector-actions">
          <Button
            id="action-surface-save-automation"
            label="Save as automation"
            onPress={() => props.onAction("surface.save-automation")}
          />
        </div>
      </InspectorSection>

      <AgentPanel {...props} />
    </>
  );
}

/**
 * Connect an agent (T16, SF-07).
 *
 * The copyable generic configuration, and a test of the thing that makes it
 * true — the broker an agent would share. Nobody is asked to choose a story to
 * connect an agent, and nothing here claims to have spoken MCP: the panel lists
 * exactly what was checked.
 */
function AgentPanel(
  props: ScreenProps<DrawnSurfaceLoad> & { readonly collapsed?: boolean },
): React.JSX.Element {
  const { agent } = props.state;
  const [copied, setCopied] = useState(false);
  /*
   * Shut, before there is anything to connect an agent *to* (`AX-06`, `B20`).
   *
   * A JSON snippet for agent authors was the first thing in the inspector on a
   * window where nobody had done anything yet. It is still one keystroke away,
   * and it opens itself once a session exists — which is the moment the
   * configuration describes something real.
   */
  const Section = ({ children }: { children: React.ReactNode }): React.JSX.Element =>
    props.collapsed === true ? (
      <details className="sv-disclosure" id="inspector-agent">
        <summary>Connect an agent</summary>
        {children}
      </details>
    ) : (
      <InspectorSection id="inspector-agent" title="Connect an agent">
        {children}
      </InspectorSection>
    );
  return (
    <Section>
      <p className="sv-card">
        Any compatible MCP client reaches these same sessions with this configuration. An agent and
        a person share one broker, so a session either opens is one both can see.
      </p>
      <pre className="sv-block" id="agent-mcp-config" aria-label="MCP configuration">
        {agent.config}
      </pre>
      <div className="sv-inspector-actions">
        <Button
          id="agent-copy-config"
          label={copied ? "Copied" : "Copy configuration"}
          onPress={() => {
            void navigator.clipboard?.writeText(agent.config).catch(() => undefined);
            setCopied(true);
          }}
        />
        <Button
          id="action-surface-test-agent"
          label="Test the connection"
          onPress={() => props.onAction("surface.test-agent")}
        />
      </div>
      <KeyValues
        rows={[
          {
            key: "Broker",
            value: (
              <Pill
                tone={agent.brokerReady ? "pass" : "abort"}
                label={agent.brokerReady ? "reachable" : "not answering"}
              />
            ),
          },
          ...agent.checks.map((one, at) => ({ key: at === 0 ? "Checked" : " ", value: one })),
        ]}
      />
    </Section>
  );
}
