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
  const strip = (
    <ModeStrip mode={state.mode} onMode={(mode) => props.onParams({ ...props.params, mode })} />
  );
  if (state.mode === "record") {
    return (
      <>
        {strip}
        <RecordScreen {...props} state={recordOf(state)} />
      </>
    );
  }
  if (state.mode === "do") {
    return (
      <>
        {strip}
        <SurfacesScreen {...props} state={surfaceOf(state)} />
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
