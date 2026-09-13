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
import { useState } from "react";
import { Alert, Button, Field, Pill, Table } from "@svatah/yam-ui";
import type { SessionMode, SessionState } from "@svatah/yam-screens";
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
        <ConnectFirst {...props} mode="record" />
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

  return <SayMode {...props} strip={strip} />;
}

/**
 * The way in, from a mode that cannot start without one (`AX-02`, `AX-03`,
 * `B6`).
 *
 * Record with nothing connected said: *"No recording session. Press Record on
 * the Flows screen."* Flows is about a project, and for somebody without one
 * that is a wall — connect, record, Flows, "needs a project", and the loop has
 * no exit. Say had no way in at all.
 *
 * Every mode's first step is the same one, so every mode offers it: one
 * sentence and one enabled control, which goes to the place that has the form
 * rather than describing where the form is.
 */
function ConnectFirst(
  props: ScreenProps<SessionState> & { readonly mode: "record" | "say" },
): React.JSX.Element | null {
  if (props.state.surface.session !== undefined) return null;
  return (
    <Alert tone="abort" id={`session-${props.mode}-needs-surface`}>
      {props.mode === "record"
        ? "Nothing is connected, so there is nothing to watch."
        : "Nothing is connected, so a sentence has nothing to act on."}{" "}
      <Button
        id={`session-${props.mode}-connect`}
        label="Connect a surface"
        variant="ghost"
        onPress={() => props.onParams({ ...props.params, mode: "do" })}
      />
    </Alert>
  );
}

/**
 * Say — a sentence, in the app, as `i` takes one in the cockpit (`AX-02`,
 * `B5`).
 *
 * One of the three ways of working was a paragraph. It explained that "a
 * sentence is grounded against the session already open and appended to the
 * flow" and offered nowhere to type one: no textbox, no combobox, and no
 * enabled control beyond the rail. A mode you cannot act in is a tab that leads
 * to a description of itself.
 *
 * Grounding the line against the connected session needs the runtime to take a
 * broker session, which `docs/spec/view-layers` puts out of scope and names as a
 * runtime change (`TV-T07c`). So the sentence is *held* and said to be held —
 * the cockpit does exactly this, in the same words — and nothing pretends to
 * have executed. The field, the history and the zero state are the parts that
 * were missing, and they are here.
 */
function SayMode(
  props: ScreenProps<SessionState> & { readonly strip: React.ReactNode },
): React.JSX.Element {
  const say = props.state.say;
  const [line, setLine] = useState("");
  const [held, setHeld] = useState<string | undefined>(undefined);
  const submit = (): void => {
    const text = line.trim();
    if (text === "") return;
    setHeld(text);
    setLine("");
  };

  return (
    <div className="sv-say">
      {props.strip}
      <ConnectFirst {...props} mode="say" />
      <div className="sv-say-line" role="group" aria-label="Say what to do">
        <Field
          id="session-say"
          label="Say what to do"
          value={line}
          placeholder="click the Sign in button"
          onChange={setLine}
          onSubmit={submit}
        />
        <Button
          id="session-say-submit"
          label="Say it"
          variant="primary"
          disabled={line.trim() === ""}
          onPress={submit}
        />
      </div>
      {held === undefined ? null : (
        <Alert tone="abort" id="session-say-held">
          “{held}” is held, not run: grounding a sentence against the open session is a runtime
          change this view layer does not make. It is on the flow below, and <b>Record</b> writes
          the same line by watching you do it.
        </Alert>
      )}
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
        empty="Nothing said yet. Type a sentence above and press Say it."
      />
      <p className="sv-hint">
        A sentence is appended to the flow this session is writing, and a phrase Yam cannot ground
        asks rather than fails.
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
