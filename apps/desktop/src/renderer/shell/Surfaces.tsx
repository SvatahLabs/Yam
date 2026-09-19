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
  actionCommands,
  agentTestView,
  refAt,
  surfaceOutcomeView,
  type ScreenStateBase,
  type SurfaceLoad,
  type SurfaceAdapterRow,
  type SurfaceActionOffer,
  type SurfaceTreeLine,
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

/**
 * The value the adapter chooser carries for "let Yam decide".
 *
 * Not the empty string: Radix reads that as *no selection* and shows its
 * placeholder, so the default state of the first task's form read "Choose…".
 */
const AUTOMATIC = "auto";

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
  const [adapter, setAdapter] = useState(AUTOMATIC);
  /*
   * Visible by default (TV-A09).
   *
   * The runtime has taken `headed` all along and nothing offered it, so
   * connecting from this screen drove a browser nobody could see — on the one
   * screen whose subject is watching what happens.
   */
  const [headed, setHeaded] = useState(true);

  /*
   * `"auto"`, not `""` (`AX-01`, and a defect found by driving the window).
   *
   * The default is automatic selection, and the option for it carried the empty
   * string — which is Radix's own sentinel for *nothing chosen*. So the control
   * rendered its placeholder: a person arriving at the only task on the screen
   * read **"Choose…"** beside a field, and the honest state was "Yam will pick
   * one". An invitation to make a decision nobody has to make, on the first
   * screen, is exactly the furniture this wave has been removing.
   *
   * `AUTOMATIC` is mapped back to "say nothing" on the way to the action, which
   * is what the runtime reads as "choose for me".
   */
  const adapterOptions = [
    { value: AUTOMATIC, label: "Automatic" },
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
  const PLACED_BY_THE_SCREEN = new Set<string>([
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
     * so it goes on the list — and only while that list is on the screen. Once
     * a surface is connected the discovery panel is replaced by the surface's
     * own tree, and an action placed by a panel that is not drawn is an action
     * reachable only through the palette.
     */
    ...(state.session === undefined ? ["surface.discover"] : []),
    "surface.act",
    "surface.request",
    "surface.take-control",
    "surface.release-control",
    "surface.test-agent",
    "surface.read",
    "surface.save-automation",
    // Beside the tree it is a picture of (T15).
    "surface.preview",
  ]);
  const toolbarActions = props.actions.filter((one) => !PLACED_BY_THE_SCREEN.has(one.id));
  const doConnect = (): void =>
    props.onAction("surface.connect", {
      url,
      adapter: adapter === AUTOMATIC ? "" : adapter,
      headed,
    });

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
            /*
             * What *this list* is, and what puts something in it (`EX-05`,
             * `AX-07`, `B18`).
             *
             * It repeated the screen's own status line word for word — one
             * sentence, twice on one screen, which tells a person their eyes
             * have not moved. A zero state's job is to say what is missing from
             * the thing it is inside, and which action changes that.
             */
            empty="No session is open. One appears here the moment you connect, and stays until you disconnect."
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
          {/* The summary is the control a person presses, so it is what carries an id (REQ-SURF-3). */}
          <summary id="surfaces-other-ways-summary">Other ways to connect ({rest.length})</summary>
          <Table<SurfaceAdapterRow>
            id="surfaces-adapters-other"
            label="Adapters that need something first"
            rows={[...rest]}
            rowKey={(row) => row.adapter}
            empty="Nothing else to offer: every adapter this build has is ready. Enter a target above and press Connect surface."
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
  const preview = props.actions.find((one) => one.id === "surface.preview");

  if (state.httpSurface) return <HttpForm {...props} />;

  return (
    <div className="sv-editor" id="surfaces-tree-pane" aria-label="Current surface">
      <div className="sv-panel-head">
        <span>Current surface</span>
        <span className="sv-spacer" />
        {preview === undefined ? null : (
          /*
           * A checkbox, because it is a state and not a verb: the preview is on
           * or off, and a screen reader says which. It runs the registry's
           * action, so the palette's row and this are one thing (T15).
           */
          <Checkbox
            id="surfaces-preview-toggle"
            label="Preview"
            checked={props.params.preview === true}
            disabled={!preview.availableWhen(state as never)}
            onChange={(show) => props.onAction("surface.preview", { show })}
          />
        )}
        {state.truncated ? <Pill tone="abort" label="truncated" /> : null}
        <span className="sv-chip">{state.tree.length} controls</span>
      </div>
      <Preview {...props} />
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

/**
 * A picture of the surface, above the tree it is a picture of (T15).
 *
 * Pointing at it draws the box of the control under the pointer — the model's
 * `refAt`, over the boxes the tree came with — and clicking selects that
 * control exactly as its row in the tree would. Nothing is sent to the
 * application: this is a way of *finding* a control, and the inspector is still
 * where anything is done to it. The picture is not focusable and has no
 * keyboard of its own on purpose; the tree below is the same selection, and it
 * is the one a keyboard or a screen reader uses.
 */
function Preview(props: ScreenProps<DrawnSurfaceLoad>): React.JSX.Element | null {
  const { state } = props;
  const [hover, setHover] = useState<(SurfaceTreeLine & { readonly box: readonly number[] }) | undefined>(
    undefined,
  );
  const preview = state.preview;
  if (preview === undefined) return null;
  if (!preview.shown) {
    return (
      <p className="sv-empty" id="surfaces-preview-unavailable">
        No picture: {preview.message}
        {preview.problem === undefined ? "" : ` ${preview.problem.nextAction}.`} The tree below is the
        whole surface either way.
      </p>
    );
  }

  /** The control under a pointer event, in the picture's own pixels. */
  const under = (event: React.MouseEvent<HTMLElement>): (SurfaceTreeLine & { readonly box: readonly number[] }) | undefined => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0) return undefined;
    const pixels = preview.width / rect.width;
    return refAt(state.tree, (event.clientX - rect.left) * pixels, (event.clientY - rect.top) * pixels, preview.scale);
  };
  /** A box as percentages of the picture, so it stays put however the picture is scaled to fit. */
  const placed = (box: readonly number[]): React.CSSProperties => ({
    left: `${((box[0]! * preview.scale) / preview.width) * 100}%`,
    top: `${((box[1]! * preview.scale) / preview.height) * 100}%`,
    width: `${((box[2]! * preview.scale) / preview.width) * 100}%`,
    height: `${((box[3]! * preview.scale) / preview.height) * 100}%`,
  });
  const selected = state.tree.find((line) => line.selected && line.box !== undefined);

  return (
    <figure className="sv-preview" id="surfaces-preview">
      <div
        className={preview.selectable ? "sv-preview-frame sv-preview-live" : "sv-preview-frame"}
        onMouseMove={(event) => setHover(preview.selectable ? under(event) : undefined)}
        onMouseLeave={() => setHover(undefined)}
        onClick={(event) => {
          const hit = preview.selectable ? under(event) : undefined;
          // The same selection a row of the tree makes, with its snapshot (SF-10).
          if (hit !== undefined) props.onParams({ ...props.params, ref: hit.ref, snapshot: state.snapshotId });
        }}
      >
        <img
          id="surfaces-preview-image"
          src={preview.src}
          width={preview.width}
          height={preview.height}
          alt="A picture of the surface. Choose a control from the tree below to select it without a pointer."
          draggable={false}
        />
        {selected?.box === undefined ? null : (
          <span className="sv-preview-box sv-preview-selected" aria-hidden="true" style={placed(selected.box)} />
        )}
        {hover === undefined ? null : (
          <span className="sv-preview-box sv-preview-hover" aria-hidden="true" style={placed(hover.box)} />
        )}
      </div>
      <figcaption className="sv-preview-caption" id="surfaces-preview-caption">
        <span className="sv-mono" id="surfaces-preview-hover">
          {!preview.selectable
            ? "Nothing on this picture can be selected; choose from the tree."
            : hover === undefined
              ? "Point at a control to see its box; click to select it. Nothing is clicked in the application."
              : `${hover.role}${hover.name === undefined ? "" : ` "${hover.name}"`} · ${hover.ref}`}
        </span>
        <span className="sv-muted">{preview.basis}</span>
      </figcaption>
    </figure>
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
  /** Which of the two copies was just made, until the form changes under it. */
  const [copied, setCopied] = useState<"cli" | "mcp" | undefined>(undefined);
  useEffect(() => {
    setValues({});
  }, [state.ref, state.action]);
  /*
   * "Copied" is about the lines as they were when copied: a keystroke in the
   * form makes new ones, and the button says Copy again.
   */
  const form = JSON.stringify([state.ref, state.action, values, ref2, verifyKind, state.snapshotId, props.params.snapshot]);
  useEffect(() => {
    setCopied(undefined);
  }, [form]);

  if (session === undefined) {
    return (
      <>
        {/*
          "Nothing selected", not "Inspector" (`AX-09`).

          The inspector is `<aside aria-label="Inspector">`, and a section
          inside it called "Inspector" published a second landmark with the same
          name — `complementary: Inspector` and `region: Inspector`, which is
          two answers to "where am I". The heading says what this section is
          rather than repeating what it is inside.
        */}
        <EmptyInspector id="inspector-empty" title="Nothing selected">
          Choose an open session to inspect it, or connect a new surface. Nothing here needs a
          project.
        </EmptyInspector>
        <AgentPanel {...props} collapsed />
      </>
    );
  }

  const offer = state.offers.find((one) => one.chosen);
  const snapshot = props.params.snapshot ?? state.snapshotId;
  /*
   * Copy command and Copy MCP call (T15): what Act would send, from the form as
   * it is now. The model writes both lines and says what to know about them;
   * this only decides what goes on the clipboard.
   */
  const commands =
    offer === undefined
      ? undefined
      : actionCommands({
          session: session.sessionId,
          action: offer.action,
          ...(offer.needsRef && state.ref !== undefined ? { ref: state.ref } : {}),
          ...(offer.needsRef2 && ref2 !== "" ? { ref2 } : {}),
          args: values,
          ...(snapshot === undefined ? {} : { snapshotId: snapshot }),
          secret: state.element?.secret === true,
          ...(session.controller === undefined ? {} : { holder: session.controller }),
          verify: verifyKind !== "",
        });
  const copy = (which: "cli" | "mcp"): void => {
    if (commands === undefined) return;
    void navigator.clipboard?.writeText(commands[which]).catch(() => undefined);
    setCopied(which);
  };

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
              <Button
                id="surfaces-copy-command"
                label={copied === "cli" && commands !== undefined ? "Copied" : "Copy command"}
                disabled={commands === undefined}
                onPress={() => copy("cli")}
              />
              <Button
                id="surfaces-copy-mcp"
                label={copied === "mcp" && commands !== undefined ? "Copied" : "Copy MCP call"}
                disabled={commands === undefined}
                onPress={() => copy("mcp")}
              />
            </div>
            {commands === undefined ? null : (
              /*
               * What is being copied, readable before it is pasted anywhere: a
               * person can see that a password is not in it, and that the
               * reference expires, without running either.
               */
              <details className="sv-disclosure" id="surfaces-copy-details">
                <summary id="surfaces-copy-summary">What Copy command and Copy MCP call copy</summary>
                <pre className="sv-block" id="surfaces-copy-cli" aria-label="The command">
                  {commands.cli}
                </pre>
                <pre className="sv-block" id="surfaces-copy-mcp-call" aria-label="The MCP call">
                  {commands.mcp}
                </pre>
                <ul className="sv-notes" id="surfaces-copy-notes">
                  {commands.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </details>
            )}
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
   * What the last test verified, when there has been one; until then, what
   * loading checked and what it did not (T16). The words are the model's.
   */
  const tested =
    props.lastOutcome?.id === "surface.test-agent" ? agentTestView(props.lastOutcome.value) : undefined;
  const checks = tested?.checks ?? agent.checks;
  const handshake = tested?.handshake ?? agent.handshake;
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
        <summary id="inspector-agent-summary">Connect an agent</summary>
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
          {
            key: "MCP server",
            value: <Pill tone={handshake.tone} label={handshake.label} />,
          },
          ...checks.map((one, at) => ({ key: at === 0 ? "Checked" : " ", value: one })),
        ]}
      />
    </Section>
  );
}
