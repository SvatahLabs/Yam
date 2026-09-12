/**
 * The cockpit's key map (TV-M03, TV-07, LLD §13.7).
 *
 * Keys left the model in TV-M03. `@svatah/yam-screens` says which actions a screen
 * has; *which key runs which action* is a property of the terminal, and the app
 * answers it differently — `⌘↵` is not a keystroke a terminal can be sent.
 * Two tables over one registry, which is what "the model shares, the view owns"
 * means when it is written down rather than asserted.
 *
 * The table is data so that three things are generated from it and cannot
 * disagree: the footer, the `?` overlay, and `yam ui --keys --json`. A key that
 * is advertised and unbound is not a mistake this file can make.
 */
import { SCREEN_IDS, actionById, type ScreenId, type SessionMode } from "@svatah/yam-screens";

/**
 * Where the cockpit opens (TV-14, `REQ-ADE-11`).
 *
 * The app opens on Session and the cockpit opened on Flows — a divergence that
 * outlived Draft 2.25 because nothing checked it. One constant, read by both
 * entry points, and `tools/repo-checks/test/palette-parity.test.ts` holds the
 * two renderers to one default.
 */
export const DEFAULT_SCREEN: ScreenId = "session";

/** One key, and the action it runs. */
export interface KeyBinding {
  /** As a person presses it and as the footer prints it. */
  readonly key: string;
  /** The registry's action id. Never a label; never a second name for one. */
  readonly action: string;
  /** What the `?` overlay says it does. */
  readonly label: string;
  /**
   * The Session modes this key belongs to (REQ-ADE-14, TV-15).
   *
   * Absent means every mode. The merge of Surfaces and Record put `s` on two
   * actions — refresh the snapshot, and stop recording — which were unambiguous
   * only while they lived on two screens. A mode-scoped table is how one screen
   * keeps both without asking a person which `s` they meant.
   */
  readonly modes?: readonly SessionMode[];
}

/**
 * The screen-specific keys. The keys every screen has — `^K`, `?`, `1`–`4`,
 * `Tab`, `j`/`k`, `q` — are the cockpit's own and live with the input layer that
 * owns them (TV-T11), because they run commands rather than actions.
 */
/**
 * The keys the cockpit itself has, which run commands rather than actions.
 *
 * They are here so that the `?` overlay and `yam ui --keys --json` are one table
 * with the screens' keys, rather than a list somebody keeps in step by hand —
 * which is what TV-07 means by "the key map is data".
 */
export interface CommandKey {
  readonly key: string;
  readonly command: string;
  readonly label: string;
  /**
   * The word the footer prints, for the keys the footer always draws.
   *
   * The footer kept its own list of these in `layout.ts` — a third copy of this
   * table, free to drift from it, and it did: `g` was spent and advertised
   * nowhere. One flag here, and the footer is derived rather than maintained.
   */
  readonly footer?: string;
}

export const COMMAND_KEYS: readonly CommandKey[] = [
  { key: "^K", command: "palette.open", label: "every action" , footer: "commands" },
  { key: "?", command: "help.open", label: "this list" },
  { key: "1-4", command: "region.focus", label: "focus a region" , footer: "pane" },
  { key: "Tab", command: "region.next", label: "next region" , footer: "next" },
  { key: "j k", command: "cursor.move", label: "row down / up" , footer: "move" },
  { key: "Enter", command: "row.open", label: "open what the cursor is on" , footer: "open" },
  { key: "[ ]", command: "screen.walk", label: "previous / next screen" , footer: "screen" },
  { key: "g", command: "screen.jump", label: "go to a screen by its rail letter" },
  /*
   * `m`, and not `1`/`2`/`3` — a deviation from the `TUI-Session` board, on
   * purpose (TV-15).
   *
   * That board printed `1 record 2 say 3 do` in the mode strip while every other
   * board printed `1-4 region` in the footer: the same digits, two meanings, on
   * the one screen that has both. A person cannot be asked which they meant.
   * Regions keep the digits because they are the navigation every screen has,
   * and the mode cycles on a key that collides with nothing.
   */
  { key: "m", command: "mode.next", label: "record · say · do" },
  { key: "i", command: "say.open", label: "type a sentence (say mode)" },
  { key: "^r", command: "stream.retry", label: "retry the event stream" },
  { key: "q", command: "quit", label: "quit" , footer: "quit" },
];

/**
 * The keys a screen may not bind, expanded from `COMMAND_KEYS`.
 *
 * `1-4` and `j k` are one row in the footer and several keys in the terminal, so
 * the footer's spelling is not the collision test. This is.
 *
 * A screen *may* bind a key on this list where the cockpit's use of it is scoped
 * — `i` and `m` are Session's alone, `Enter` opens a row only where no screen
 * claims it — and the input handler consults the screen's table first, so the
 * screen wins. What no screen may bind is a key the cockpit spends
 * unconditionally, because that binding could never run.
 */
export const COCKPIT_ONLY: readonly string[] = ["^k", "?", "1", "2", "3", "4", "\t", "j", "k", "[", "]", "g", "^r", "q"];

const SCREEN_KEYS: Partial<Record<ScreenId, readonly KeyBinding[]>> = {
  session: [
    /*
     * `do` only, as the model says (P-W2-F9). Connecting from Record opened a
     * browser and left the pane saying "No session", because the session it
     * makes is the surface half's and the record half reads a different key.
     */
    { key: "c", action: "surface.connect", label: "Connect a surface", modes: ["do"] },
    { key: "s", action: "surface.refresh", label: "Refresh the surface tree", modes: ["do", "say"] },
    /*
     * `do` only, as the model says. It was every mode, so `r` in Record ran an
     * action `availableWhen` then refused — a key that could only ever report
     * "not available here". `tools/repo-checks/test/action-modes.test.ts` found
     * it the first time it ran.
     */
    { key: "r", action: "surface.discover", label: "Recheck available targets", modes: ["do"] },
    /*
     * One key takes the target back (TV-13, SF-13). Seeing that an agent is
     * driving is half of a handoff; the other half is being able to do something
     * about it without opening a palette and reading.
     */
    { key: "t", action: "surface.take-control", label: "Take control" },
    { key: "T", action: "surface.release-control", label: "Give up control" },
    { key: "a", action: "record.accept", label: "Accept the grounding", modes: ["record"] },
    { key: "p", action: "record.repick", label: "Re-pick in the session", modes: ["record"] },
    { key: "x", action: "record.reject", label: "Reject the grounding", modes: ["record"] },
    /*
     * `Q`, not `q`. The cockpit quits on `q` and always has, so the model's
     * `record.stop` binding was a key the terminal could never deliver — an
     * action reachable in the app and not here, which is the defect TV-02 is
     * about. Shifted, it works.
     */
    { key: "Q", action: "record.stop", label: "Stop the session", modes: ["record"] },
    { key: "s", action: "capture.stop", label: "Stop recording and write the flow", modes: ["record"] },
  ],
  flows: [
    { key: "r", action: "run.flow", label: "Run the selected flow" },
    { key: "R", action: "capture.start", label: "Record a flow from what you do" },
    { key: "b", action: "record.start", label: "Bind the selected flow's targets" },
    { key: "h", action: "heal.run", label: "Heal the last run" },
    { key: "e", action: "flows.save", label: "Edit the open flow" },
    { key: "c", action: "flows.compile", label: "Compile and lint" },
  ],
  run: [
    { key: "r", action: "run.again", label: "Run the same thing again" },
    { key: "R", action: "run.resume", label: "Resume from the failing step" },
    { key: "s", action: "run.stop", label: "Stop this run between steps" },
    { key: "h", action: "heal.run", label: "Heal this run" },
  ],
  runs: [
    { key: "\r", action: "go.run", label: "Open the selected run" },
    { key: "h", action: "heal.run", label: "Heal the selected run" },
  ],
  bindings: [
    { key: "v", action: "bindings.verify", label: "Dry-resolve every binding" },
  ],
  heal: [
    { key: "a", action: "heal.apply", label: "Apply the proposal" },
    { key: "h", action: "heal.run", label: "Heal the selected run" },
  ],
  agents: [
    { key: "\r", action: "go.run", label: "Open the invocation's run" },
  ],
  api: [
    { key: "\r", action: "api.send", label: "Send the request" },
  ],
  data: [
    { key: "^s", action: "data.save", label: "Save data.yaml" },
  ],
};

/**
 * The keys this screen binds in this mode, in the order the footer prints them.
 *
 * A screen with no modes ignores the argument; a mode-scoped key is dropped when
 * its mode is not the one showing, which is what stops one letter meaning two
 * things on the one screen that has three modes.
 */
export const keysFor = (screen: ScreenId, mode?: SessionMode): readonly KeyBinding[] =>
  (SCREEN_KEYS[screen] ?? []).filter(
    (one) => one.modes === undefined || mode === undefined || one.modes.includes(mode),
  );

/** The action a key runs on this screen in this mode, if any binds it. */
export const actionForKey = (
  screen: ScreenId,
  pressed: string,
  mode?: SessionMode,
): string | undefined => keysFor(screen, mode).find((one) => one.key === pressed)?.action;

/**
 * The whole key map, as `yam ui --keys --json` prints it and the `?` overlay
 * draws it (TV-07).
 *
 * One table, three readers. A key advertised and unbound is not a mistake this
 * can make.
 */
export function keyMap(): {
  readonly commands: readonly CommandKey[];
  readonly screens: Record<string, ReadonlyArray<KeyBinding>>;
} {
  const screens: Record<string, ReadonlyArray<KeyBinding>> = {};
  for (const screen of SCREEN_IDS) {
    const bound = keysFor(screen);
    if (bound.length > 0) screens[screen] = bound;
  }
  return { commands: COMMAND_KEYS, screens };
}

/**
 * Every binding, for the check that no key names an action the registry does
 * not have (TV-T12).
 */
export const ALL_KEYS: ReadonlyArray<KeyBinding & { readonly screen: ScreenId }> = SCREEN_IDS.flatMap(
  (screen) => keysFor(screen).map((one) => ({ ...one, screen })),
);

/** Every key that names an action nobody declared. Empty, and checked. */
export const unknownBindings = (): readonly string[] =>
  ALL_KEYS.filter((one) => actionById(one.action) === undefined).map(
    (one) => `${one.screen} binds ${one.key} to ${one.action}, which is not an action`,
  );

/**
 * The keys the footer always draws, in the order the `TUI` artboard prints them.
 *
 * Always drawn: a cockpit whose `q` scrolled off is a cockpit a person cannot
 * leave. Everything else competes for the room that is left.
 */
export const FOOTER_KEYS: ReadonlyArray<{ key: string; label: string }> = COMMAND_KEYS.filter(
  (one) => one.footer !== undefined,
).map((one) => ({ key: one.key, label: one.footer as string }));
