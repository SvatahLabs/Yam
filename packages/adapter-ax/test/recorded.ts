/**
 * The recorded ADE trees, and a bridge that replays one (T6.2).
 *
 * ## Where these came from, exactly
 *
 * `node scripts/record-desktop-tree.mjs --shape ax --screen <name>` launches the real ADE with
 * `YAM_A11Y=1`, opens `evals/fixtures` **through the ADE's own Recent-project
 * button**, clicks the screen's tab, and reads Chromium's accessibility tree
 * over the DevTools protocol — roles, names, values, DOM ids, boxes — mapping it
 * into the `AxNode` shape this adapter consumes.
 *
 * They are therefore a real application's real accessibility tree, not an
 * invention. What they are *not* is the output of `AXUIElement`: reading that
 * needs the macOS Accessibility permission, which could not be granted in the
 * session these were made in (the prompt blocks and the Apple event times out at
 * `-1712`). The tree recorded here is the one Chromium's macOS AX bridge
 * serialises *from* — which is why the roles and the names are right, and why it
 * is not proof that `osascriptBridge` reads them correctly.
 *
 * `docs/spec/progress/phase-6.md` states the live gate that remains and the
 * command that closes it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  AxBridge,
  AxCommand,
  AxNode,
  AxPermission,
  AxSession,
  AxWindow,
} from "../src/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** The five screens LLD §16's desktop conformance flows visit, plus Record. */
export type AdeScreen =
  | "project"
  | "flows"
  | "run"
  | "results"
  | "api"
  | "record"
  | "explorer"
  | "palette"
  | "bindings";

export const ADE_SCREENS: readonly AdeScreen[] = [
  "project",
  "flows",
  "run",
  "results",
  "api",
  "record",
  "explorer",
  "palette",
  "bindings",
];

export function recordedWindow(screen: AdeScreen): AxWindow {
  const text = readFileSync(join(FIXTURES, `ade-${screen}.json`), "utf8");
  const window = JSON.parse(text) as Omit<AxWindow, "cost">;
  /*
   * A recorded tree has a node count and no wall time, and says so:
   * `invocations: 0` is the flag the conformance report reads to write
   * "recorded tree" instead of publishing a bridge cost that nothing paid
   * (Draft 2.8 §7.5). Filling in a plausible number here is exactly the thing
   * the Phase 6 verification caught the desktop suite doing.
   */
  return {
    ...window,
    cost: {
      nodes: window.nodes.length,
      wallMs: 0,
      msPerNode: 0,
      invocations: 0,
      axCalls: 0,
      /*
       * And no load either (P8-F2). The load average beside a cost says what the
       * machine was doing while the read happened; a recording had no read, so
       * the honest number is zero beside `invocations: 0`, which is what the
       * report keys on to say "recorded tree".
       */
      loadAverage1m: 0,
      cpus: 0,
    },
  };
}

export interface RecordedBridgeOptions {
  /** The screen the window starts on. */
  readonly screen?: AdeScreen;
  readonly permission?: AxPermission;
  /** What `session()` answers; the default is a session with a window on it. */
  readonly session?: AxSession;
  /**
   * What a command does to the window.
   *
   * A desktop application answers an action by changing; a bridge that always
   * replayed the same tree could not test `act` at all. The handler is how a
   * test says "pressing the Run tab shows the Run screen" without needing the
   * application.
   */
  readonly onCommand?: (command: AxCommand, current: AdeScreen) => AdeScreen | void;
}

export interface RecordedBridge extends AxBridge {
  /** Every command the adapter sent, in order. */
  readonly commands: AxCommand[];
  /** Which screen the window is showing now. */
  screen(): AdeScreen;
  /** Put the bridge on a screen, for a test that has to learn two trees. */
  setScreen(screen: AdeScreen): void;
  /** Files `screenshot()` was asked to write. */
  readonly screenshots: string[];
}

/**
 * The child index of every node, so a command's path can be resolved back.
 *
 * A command addresses an element by the child index at each level from the
 * window down (`AxCommand.path`), because an AppleScript specifier does not
 * survive between `osascript` processes. Replaying one means walking the same
 * way.
 */
function indexOfPath(nodes: readonly AxNode[], path: readonly number[]): number | undefined {
  const children = new Map<number, number[]>();
  nodes.forEach((node, index) => {
    if (node.parent < 0) return;
    const list = children.get(node.parent) ?? [];
    list.push(index);
    children.set(node.parent, list);
  });
  let at = 0;
  for (const step of path) {
    const among = children.get(at) ?? [];
    const next = among[step];
    if (next === undefined) return undefined;
    at = next;
  }
  return at;
}

/**
 * A bridge that replays a recorded tree, and records what was asked of it.
 *
 * It replays, and it also **remembers a value that was set**. A window that
 * never changed could not test `type` at all: the adapter sets `AXValue`, takes
 * a new snapshot and reads it back, and a bridge that served the same tree
 * either way would make that round trip untestable. macOS does change the value;
 * so does this.
 */
export function recordedBridge(options: RecordedBridgeOptions = {}): RecordedBridge {
  let screen: AdeScreen = options.screen ?? "record";
  const commands: AxCommand[] = [];
  const screenshots: string[] = [];
  /** `screen:pathIndex` → the value set on it. */
  const values = new Map<string, string>();

  return {
    commands,
    screenshots,
    screen: () => screen,
    setScreen: (one: AdeScreen) => {
      screen = one;
    },
    async permission(): Promise<AxPermission> {
      return options.permission ?? { state: "granted", advice: "granted (recorded)" };
    },
    /*
     * A recorded session is a usable one: these fixtures are of an ADE with a
     * window on screen (Draft 2.12 §7.5). `options.session` overrides it, which
     * is how a test can be about a locked display.
     */
    async session(): Promise<AxSession> {
      return (
        options.session ?? {
          usable: true,
          state: "usable",
          owners: ["Yam ADE"],
          detail: "1 application(s) own a window: Yam ADE",
          advice: "This session has a WindowServer and applications can show windows.",
        }
      );
    },
    async window({ maxNodes }): Promise<AxWindow> {
      const window = recordedWindow(screen);
      const nodes: AxNode[] = window.nodes.slice(0, maxNodes).map((node, index) => {
        const set = values.get(`${screen}:${index}`);
        return set === undefined ? node : { ...node, value: set };
      });
      return { ...window, nodes, truncated: nodes.length < window.nodes.length };
    },
    async perform(command): Promise<void> {
      commands.push(command);
      if (command.kind === "setValue") {
        const at = indexOfPath(recordedWindow(screen).nodes, command.path);
        if (at !== undefined) values.set(`${screen}:${at}`, command.value);
      }
      const next = options.onCommand?.(command, screen);
      if (next !== undefined) screen = next;
    },
    async screenshot(path): Promise<void> {
      screenshots.push(path);
    },
  };
}
