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
import type { RecordState, SurfacesState } from "@svatah/yam-screens";
import { RecordInspector, RecordScreen } from "./Record.js";
import { SurfacesInspector, SurfacesScreen } from "./Surfaces.js";
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

const surfaceOf = (state: SessionState): SurfacesState =>
  envelope(state, state.surface, "surfaces") as SurfacesState;
const recordOf = (state: SessionState): RecordState =>
  envelope(state, state.record, "record") as RecordState;

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

export function SessionScreen(props: ScreenProps<SessionState>): React.JSX.Element {
  const { state } = props;
  if (state.mode === "record") return <RecordScreen {...props} state={recordOf(state)} />;
  if (state.mode === "do") return <SurfacesScreen {...props} state={surfaceOf(state)} />;

  const say = state.say;
  return (
    <div className="sv-say">
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
