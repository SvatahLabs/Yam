/**
 * Session — one session, three modes, in the app (REQ-ADE-14, Draft 2.27, TV-A02).
 *
 * The screen a person lands on. Draft 2.27 merged Surfaces and Record because
 * the three ways of writing a flow disagree about who is driving and not about
 * what is being made — so this is one screen with a mode strip, over one broker
 * session, and switching modes never reconnects.
 *
 * The **do** and **record** modes draw what those screens always drew: the merge
 * is of *destinations*, not of pixels, and re-drawing two working screens to
 * prove a point would be a rewrite nobody asked for. The halves are handed back
 * the screen envelope their components expect, which is the same envelope the
 * merged state came from.
 *
 * **Say** is the new one, and it is deliberately small: the sentences said, the
 * flow they are writing, and — the moment that matters — a phrase Yam could not
 * ground, offering the three groundings the product already has rather than
 * failing the line.
 */
import { Alert, Pill, Table } from "@svatah/yam-ui";
import type { SessionMode, SessionState } from "@svatah/yam-screens";
import type { RecordLoad, SurfaceLoad } from "@svatah/yam-screens";
import { RecordInspector, RecordScreen, type DrawnRecordLoad } from "./Record.js";
import { SurfacesInspector, SurfacesScreen, type DrawnSurfaceLoad } from "./Surfaces.js";
import type { ScreenProps } from "./Secondary.js";

/** The screen envelope, put back around a half for the component that wants it. */
const envelope = <T,>(state: SessionState, half: T, screen: string): T =>
  ({
    ...half,
    screen,
    title: state.title,
    subtitle: state.subtitle,
    status: state.status,
    sources: state.sources,
    ...(state.error === undefined ? {} : { error: state.error }),
  }) as T;

const surfaceOf = (state: SessionState): DrawnSurfaceLoad =>
  envelope(state, state.surface, "session") as DrawnSurfaceLoad;
const recordOf = (state: SessionState): DrawnRecordLoad =>
  envelope(state, state.record, "session") as DrawnRecordLoad;

/** The three modes, as the artboard's strip draws them. */
export function ModeStrip(props: {
  readonly mode: SessionMode;
  readonly onMode: (mode: SessionMode) => void;
  /**
   * What is live right now, drawn on the tab it belongs to (P-W2-F7).
   *
   * Nothing in the application said whether a recording was running. The Record
   * pane says so once you are on it and a capture has started, and that is the
   * one place — so a person who had started one, switched mode, and come back
   * had no way to tell, and a person who had *not* started one could not tell
   * that either. A live state that is visible on one screen only is a live state
   * you have to go and check.
   */
  readonly capturing?: boolean;
  readonly sentences?: number;
  readonly connected?: boolean;
}): React.JSX.Element {
  return (
    <div className="sv-modes" role="tablist" aria-label="Session mode">
      {(["record", "say", "do"] as const).map((one) => (
        <button
          key={one}
          /*
           * An id, because every interactive control has one (REQ-ADE-6, LLD
           * §13.7) — a flow sentence has to be able to say "the Record tab" and
           * mean something. These three had none: the merge that made this strip
           * landed while the suite that checks the rule was skipping for want of
           * a packaged build.
           */
          id={`session-mode-${one}`}
          type="button"
          role="tab"
          aria-selected={props.mode === one}
          className={props.mode === one ? "sv-mode active" : "sv-mode"}
          onClick={() => props.onMode(one)}
        >
          {one === "record" ? "Record" : one === "say" ? "Say" : "Do"}
          {one === "record" && props.capturing === true ? (
            <span className="sv-mode-live" id="session-recording">
              <span className="sv-mode-dot" aria-hidden="true" />
              {`recording · ${props.sentences ?? 0}`}
            </span>
          ) : null}
          {one === "do" && props.connected === true ? (
            <span className="sv-mode-live" id="session-connected">
              <span className="sv-mode-dot" aria-hidden="true" />
              connected
            </span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/**
 * The screen, with its mode strip above whichever mode is showing.
 *
 * The strip was written, exported, and never rendered — so the app had a screen
 * with three modes and nothing on it to change them, which is the same defect
 * as the cockpit having a rail it never drew: the model knows and the view does
 * not show. The mode is a screen parameter, so switching re-loads rather than
 * remounting, and the broker session is never touched (REQ-ADE-14).
 */
export function SessionScreen(props: ScreenProps<SessionState>): React.JSX.Element {
  const { state } = props;
  const record = recordOf(state);
  const surface = surfaceOf(state);
  const strip = (
    <ModeStrip
      mode={state.mode}
      onMode={(mode) => props.onParams({ ...props.params, mode })}
      capturing={record.capturing === true}
      sentences={record.sentences?.length ?? 0}
      connected={surface.session !== undefined}
    />
  );
  /*
   * This mode's actions, not all seventeen (REQ-ADE-14, P-W2-F6).
   *
   * The merge put every Surfaces and Record action on one screen, and the
   * toolbar offered all of them whatever the mode: nine shed into the palette at
   * 1900px and fourteen at 1100px, with no window width at which they fit.
   * `availableWhen` already refused the ones belonging to another mode, but a
   * refused action is a *disabled button*, and a disabled button takes the room
   * that hides a working one.
   *
   * Which mode an action belongs to is the action's own property now, so this
   * reads the model rather than deciding anything.
   */
  const forMode = {
    ...props,
    actions: props.actions.filter(
      (one) => one.modes === undefined || one.modes.includes(state.mode),
    ),
  };
  if (state.mode === "record") {
    return (
      <>
        {strip}
        <RecordScreen {...forMode} state={record} />
      </>
    );
  }
  if (state.mode === "do") {
    return (
      <>
        {strip}
        <SurfacesScreen {...forMode} state={surface} />
      </>
    );
  }

  const say = state.say;
  return (
    <div className="sv-say">
      {strip}
      {say.unbound === undefined ? null : (
        <Alert tone="abort" id="session-unbound">
          Nothing is bound to “{say.unbound.phrase}”. {say.unbound.reason}
        </Alert>
      )}
      <Table
        id="session-said"
        label="Sentences said"
        rows={[...say.sentences]}
        rowKey={(row) => row.text}
        columns={[
          { key: "text", header: "Sentence", cell: (row) => row.text },
          {
            key: "outcome",
            header: "Outcome",
            cell: (row) => <Pill tone={row.outcome.tone} label={row.outcome.label} />,
          },
          { key: "target", header: "Target", cell: (row) => row.target ?? "—" },
        ]}
        empty="Nothing said yet."
      />
      <p className="sv-hint">
        A sentence is grounded against the session already open and appended to the flow; a phrase
        Yam cannot ground asks rather than fails.
      </p>
    </div>
  );
}

export function SessionInspector(props: ScreenProps<SessionState>): React.JSX.Element {
  const { state } = props;
  if (state.mode === "record") return <RecordInspector {...props} state={recordOf(state)} />;
  if (state.mode === "do") return <SurfacesInspector {...props} state={surfaceOf(state)} />;
  return (
    <div className="sv-isec">
      <h2>Will be written</h2>
      <dl className="sv-kv">
        <dt>flow</dt>
        <dd>{state.say.file ?? "not yet named"}</dd>
        <dt>lines</dt>
        <dd>{state.say.flow.length}</dd>
        <dt>bindings</dt>
        <dd>
          {state.say.bindings}
          {state.say.unverified > 0 ? `, ${state.say.unverified} unverified` : ""}
        </dd>
        <dt>on disk</dt>
        <dd>{state.say.written ? "written" : "nothing yet"}</dd>
      </dl>
    </div>
  );
}
