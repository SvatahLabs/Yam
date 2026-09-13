/**
 * The `session` screen — one session, three modes (REQ-ADE-14, Draft 2.27, TV-M01).
 *
 * > **Session** is a single screen over a single broker session with three modes
 * > a person switches between without reconnecting: **record** — the person
 * > drives the application and Yam observes; **say** — the person writes one
 * > sentence at a time, which Yam grounds against the connected session and
 * > performs; **do** — the person selects a control from the snapshot and an
 * > action from the published catalogue.
 *
 * Draft 2.25 made connect → inspect → act → verify the primary journey and
 * Draft 2.27 noticed that the three ways of *writing* a flow disagree about who
 * is driving and not about what is being made. So they are modes of one screen
 * over one session, and all three end in the same artifacts: a flow, and
 * bindings that are unverified until reviewed.
 *
 * ## Why this composes rather than copies
 *
 * The surface half and the record half are two hundred and seventy lines of
 * loader between them, each with its own failure handling, its own optional
 * endpoints and its own honest empty states. A merged screen that re-implemented
 * either would be a second implementation of the thing this package exists to be
 * the only one of — so `load` calls both and joins what they return. `mode` is a
 * screen parameter, which is what makes it a deep link in both renderers and
 * `--screen session --mode say` on the command line.
 */
import { loadRecord, type RecordView } from "./authoring.js";
import { loadSurface, type SurfaceView } from "./surfaces.js";
import { Sources } from "../load.js";
import type {
  Pill,
  Screen,
  ScreenParams,
  ScreenStateBase,
} from "../types.js";
import type { ScreenService } from "../service.js";
import { actionsForScreen } from "../registry.js";

/** The three ways of driving one session (REQ-ADE-14). */
/* The modes moved to `types.ts`, where `Action` can declare which it belongs to. */
import { SESSION_MODES, type SessionMode } from "../types.js";
export { SESSION_MODES };
export type { SessionMode };

/**
 * The field shapes are the loaders' own (TV-M04).
 *
 * They were `Omit<SurfacesState, keyof ScreenStateBase>` while those were
 * screens; now that they are halves, each loader defines the shape it returns
 * and this re-exports it, so a merge cannot transcribe a field and drift.
 */
export type { SurfaceView, RecordView };

/** One sentence the person said, and what became of it. */
export interface SaidSentence {
  readonly text: string;
  readonly outcome: Pill;
  /** The target the sentence named, once it is bound. */
  readonly target?: string;
  /** The reference it resolved to in the connected session. */
  readonly ref?: string;
  readonly durationMs?: number;
}

/**
 * The **say** mode's own state (TV-15).
 *
 * A phrase Yam can ground deterministically is grounded and run; one it cannot
 * stops and *asks*, and the three answers are the three groundings the product
 * already has — a person points at it (`REQ-REC-12`), a model is asked where one
 * is configured, or the line stays unbound and the flow says so. `pending` and
 * `unbound` are set by actions rather than by `load`: they are what the session
 * is in the middle of, which no endpoint knows.
 */
export interface SayView {
  readonly sentences: readonly SaidSentence[];
  /** Typed, not yet said. */
  readonly pending?: string;
  /** Said, and ungroundable: the phrase, and why. */
  readonly unbound?: { readonly phrase: string; readonly reason: string };
  /** The flow these sentences are writing, line by line. */
  readonly flow: readonly string[];
  /** Where it will be written. Nothing is on disk until it is. */
  readonly file?: string;
  readonly bindings: number;
  readonly unverified: number;
  readonly written: boolean;
}

export interface SessionState extends ScreenStateBase {
  readonly screen: "session";
  readonly mode: SessionMode;
  /** The **do** mode's subject, and the substrate the other two run on. */
  readonly surface: SurfaceView;
  /** The **record** mode's subject. */
  readonly record: RecordView;
  /** The **say** mode's subject. */
  readonly say: SayView;
}

/** `--mode`, validated against the model's own list; `do` when unsaid. */
export function modeFrom(value: unknown): SessionMode {
  return SESSION_MODES.find((one) => one === value) ?? "do";
}

/** The half, without the envelope its loader put round it. */
const strip = <T extends Omit<ScreenStateBase, "screen">>(
  load: T,
): Omit<T, keyof ScreenStateBase> => {
  /*
   * Named with a leading underscore rather than `void`-ed.
   *
   * `void a, b, c` is the comma operator in an expression statement, which is a
   * construct that does nothing and reads like a mistake — `no-unused-expressions`
   * is right about it. The configuration already allows an unused binding whose
   * name begins with an underscore, which is what "destructured out on purpose"
   * has a spelling for.
   */
  const {
    title: _title,
    subtitle: _subtitle,
    status: _status,
    sources: _sources,
    error: _error,
    ...rest
  } = load;
  return rest as Omit<T, keyof ScreenStateBase>;
};

/**
 * What the **say** mode has written, from what the session already reports.
 *
 * A capture's sentences and a record session's steps are the same subject read
 * two ways, and neither is a REPL transcript — `yam repl` is a command and not
 * an endpoint. So this derives what the service knows and leaves `pending` and
 * `unbound` to the actions that set them: a state that invented a sentence
 * nobody said would be the model claiming something it cannot see.
 */
function sayFrom(record: RecordView): SayView {
  const sentences: SaidSentence[] = record.sentences.map((text) => ({
    text,
    outcome: { tone: "pass", label: "ok" } as Pill,
  }));
  const unbound = record.captured?.unbound ?? [];
  return {
    sentences,
    flow: record.sentences,
    ...(record.captured?.file === undefined ? {} : { file: record.captured.file }),
    bindings: record.captured?.bound ?? 0,
    unverified: unbound.length,
    written: record.captured !== undefined,
  };
}

/** What the status bar says, which is the mode and the session it is about. */
function subtitleFor(mode: SessionMode, surface: SurfaceView, record: RecordView): string {
  const session = surface.session?.sessionId ?? surface.selected;
  const where = session === undefined ? "nothing connected" : session;
  switch (mode) {
    case "record":
      return record.capturing ? `${where} · recording` : `${where} · record`;
    case "say":
      return `${where} · say`;
    default:
      return surface.element === undefined ? `${where} · do` : `${where} · ${surface.element.ref}`;
  }
}

export const sessionScreen: Screen<SessionState> = {
  id: "session",
  title: "Session",
  /*
   * The union of what the two screens declared, by id (TV-M02). Not a new list:
   * `surface.act` is the same action it was, run by the same registry entry,
   * and an action that changed id here would be an action the CLI and the SDK
   * could no longer name.
   */
  actions: actionsForScreen("session"),
  async load(service: ScreenService, params: ScreenParams = {}): Promise<SessionState> {
    const mode = modeFrom(params.mode);
    const [surface, record] = await Promise.all([
      loadSurface(service, params),
      loadRecord(service, params),
    ]);

    /*
     * One `sources` list and one `error`, in call order, because a person
     * reading `--json` is reading one screen's provenance and not two.
     */
    const sources = new Sources();
    for (const name of [...surface.sources, ...record.sources]) sources.note(name);
    const failure = surface.error ?? record.error;
    if (failure !== undefined) sources.fail(failure);

    const surfaceView = strip(surface);
    const recordView = strip(record);
    return {
      ...sources.base("session", "Session", subtitleFor(mode, surfaceView, recordView), surface.status),
      /* `base` types `screen` as any id; this screen is one of them. */
      screen: "session",
      mode,
      surface: surfaceView,
      record: recordView,
      say: sayFrom(recordView),
    };
  },
};
