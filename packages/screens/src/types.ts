/**
 * The screen model's types (T9.1, LLD §13.7).
 *
 * > A screen is `{ id, title, load(service): State, actions: Action[], keys:
 * > Binding[] }`; an `Action` is `{ id, label, run(service, args),
 * > availableWhen(state), cli? }` and the same list is what the command palette
 * > shows, what the SDK exposes as `actions`, and what the CLI has a command
 * > for; the repository check asserts the three agree by id.
 *
 * No DOM, no terminal, no `process`: this file and everything under `screens/`
 * is what both renderers agree about, and a type that mentioned an element or a
 * key code would make one of them the definition and the other a copy.
 */
import type { ScreenService } from "./service.js";

/**
 * The twelve screens (LLD §13.7).
 *
 * > Screens: `flows` (list, editor with lint, plan), `record` (session and
 * > decisions), `runs` (list and evidence), `run` (one run, live), `heal`
 * > (proposals), `bindings`, `agents` (tool server, invocations, trajectories),
 * > `api`, `data`, `explorer`, `import`, `settings`.
 *
 * The eleven tabs of the old app map onto these; `runs` and `run` are two
 * screens because a list of runs and one run happening are different subjects
 * with different actions, which the mockups draw as two artboards.
 */
export const SCREEN_IDS = [
  "flows",
  "record",
  "runs",
  "run",
  "heal",
  "bindings",
  "agents",
  "api",
  "data",
  "explorer",
  "import",
  "settings",
] as const;

export type ScreenId = (typeof SCREEN_IDS)[number];

/**
 * What a screen was asked to show: which flow, which run, which binding.
 *
 * A screen is a function of the service and this, and of nothing else — which
 * is what makes `yam ui --json` able to print "exactly the model's state"
 * (T9.1 Validate) and the app able to render the same thing from the same two
 * arguments.
 */
export interface ScreenParams {
  /** `flows`: the flow file the editor holds, project-relative. */
  readonly file?: string;
  /** `flows`, `run`: the story in focus. */
  readonly story?: string;
  /** `run`, `heal`: the run id. */
  readonly runId?: string;
  /** `bindings`: the element id. */
  readonly bindingId?: string;
  /** `record`: the open session. */
  readonly sessionId?: string;
  /** `record`: whether that session is a capture rather than a binding run (Draft 2.23). */
  readonly capturing?: boolean;
  /** Which row the inspector is describing, when a screen has rows. */
  readonly selected?: string;

  /* ── the filters and choices the screens of T10.1 and T10.2 carry ───────── */

  /** `runs`: the behaviour chip. `"all"` or one of `test|workflow|tool`. */
  readonly behavior?: string;
  /** `runs`: the invoker chip. `"all"` or one of `user|ci|agent`. */
  readonly invoker?: string;
  /** `runs`: the status chip. `"all"` or a status word. */
  readonly status?: string;
  /** `record`: which gateway the session would use (REQ-ADE-4, Draft 2.7). */
  readonly gateway?: string;
  /** `explorer`: which adapter a session opens on. */
  readonly adapter?: string;
  /**
   * `explorer`: the surface action the next call performs (SF-11, SF-17).
   *
   * A screen parameter rather than renderer state, for the reason `intent` is
   * one: the action is what the screen re-loads with, and `explorer.act` reads
   * it from the parameters. Without it here the Act button had nothing to send
   * and refused every press with "Choose an action."
   */
  readonly action?: string;
  /**
   * `explorer`: what the next surface call is *for* (REQ-BEH-4).
   *
   * A parameter rather than renderer state, because the model refuses a call
   * without one and `yam ui --json` has to be able to show that refusal.
   */
  readonly intent?: string;
  /** `import`: the prototype's electron-db directory somebody chose. */
  readonly source?: string;
}

/**
 * Every screen's state carries these, so a renderer's chrome is written once.
 *
 * `title` and `subtitle` are the toolbar of the mockups; `status` is the status
 * bar's left-hand side. `sources` is the screen rule made visible (T3.7, §13.6:
 * "every screen renders a service response or a project file and nothing the
 * CLI cannot produce") — every screen says which endpoints it was built from,
 * and `yam ui --json` prints them.
 */
export interface ScreenStateBase {
  readonly screen: ScreenId;
  readonly title: string;
  readonly subtitle: string;
  /** The status bar's context, left-hand side. */
  readonly status: string;
  /** The endpoints this state was assembled from, in call order. */
  readonly sources: readonly string[];
  /** What went wrong loading it, when something did. Never a thrown error. */
  readonly error?: string;
}

/** A status word with the colour token beside it (LLD §13.7: never colour alone). */
export type StatusTone = "pass" | "fail" | "skip" | "healed" | "abort" | "info" | "neutral";

/** A pill: a word, and the tone that colours it. The word is never omitted. */
export interface Pill {
  readonly tone: StatusTone;
  readonly label: string;
}

/**
 * One key binding, as both renderers read it (LLD §13.7).
 *
 * `key` is written the way the mockups write it — `⌘↵`, `R`, `^K` — and each
 * renderer maps it to its own event. The app reads `mac`/`win`; the TUI reads
 * `terminal`, because a terminal has no ⌘.
 */
export interface Binding {
  /** The action this key runs, or a navigation intent for `Go to` rows. */
  readonly action: string;
  /** How the app prints it: `⌘↵`, `R`, `⌘K`. */
  readonly key: string;
  /** How the terminal prints it: `^K`, `r`. Defaults to `key` lower-cased. */
  readonly terminal?: string;
  /** What it does, for the `?` sheet both renderers show. */
  readonly description: string;
}

/** What an action was given: the screen's params, plus whatever the row supplied. */
export interface ActionArgs extends ScreenParams {
  readonly [key: string]: unknown;
}

/** What an action answered with. Renderers show `message`; agents read the rest. */
export interface ActionOutcome {
  readonly ok: boolean;
  /** One sentence for a person: "Started run comp." */
  readonly message: string;
  /** The screen to go to afterwards, when the action navigates. */
  readonly goTo?: ScreenId;
  /** Params for that screen: a started run's id, a chosen flow's file. */
  readonly params?: ScreenParams;
  /** Whatever the service answered, unchanged. */
  readonly value?: unknown;
}

/**
 * One action (LLD §13.7).
 *
 * The same object is in the app's palette, the TUI's palette, the SDK's
 * `actions`, and — through `cli` — the command line.
 * `tools/repo-checks/test/action-parity.test.ts` fails when the three disagree.
 */
export interface Action {
  /** `run.flow`, `heal.run`, `bindings.verify`. Stable; the parity check keys on it. */
  readonly id: string;
  /** What every surface calls it. One label, four places. */
  readonly label: string;
  /**
   * The palette's group, as the mockup draws it: `Actions` then `Go to`.
   */
  readonly group: "Actions" | "Go to";
  /** The screen this action belongs to; the palette shows it in the left column. */
  readonly screen: ScreenId;
  /** The accelerator shown on the button and in the palette row, when it has one. */
  readonly key?: string;
  /**
   * The CLI command that does the same thing, as the palette prints it.
   *
   * `undefined` for an action that is navigation only — "Go to run comp" is not
   * a command, and pretending it were would put a row in the CLI's table that
   * no one can type.
   */
  readonly cli?: string;
  /** Whether this action can run against this state. The palette greys the rest. */
  availableWhen(state: ScreenStateBase): boolean;
  run(service: ScreenService, args: ActionArgs): Promise<ActionOutcome>;
}

/** One screen (LLD §13.7). */
export interface Screen<S extends ScreenStateBase = ScreenStateBase> {
  readonly id: ScreenId;
  readonly title: string;
  load(service: ScreenService, params?: ScreenParams): Promise<S>;
  /** The registry entries this screen offers, resolved rather than copied. */
  readonly actions: readonly Action[];
  readonly keys: readonly Binding[];
}
