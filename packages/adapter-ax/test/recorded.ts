/**
 * The recorded APP_DIR trees, and a bridge that replays one (T6.2).
 *
 * ## Where these came from, exactly
 *
 * `node scripts/record-desktop-tree.mjs --shape ax --screen <name>` launches the real app with
 * `YAM_A11Y=1`, opens `evals/fixtures` **through the app's own Recent-project
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
  AxIdentity,
  AxNode,
  AxPermission,
  AxSession,
  AxWindow,
} from "../src/index.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

/** The five screens LLD §16's desktop conformance flows visit, plus Record. */
export type AppScreen =
  | "project"
  | "flows"
  | "run"
  | "results"
  | "api"
  | "record"
  | "explorer"
  | "palette"
  | "bindings";

export const ADE_SCREENS: readonly AppScreen[] = [
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

export function recordedWindow(screen: AppScreen): AxWindow {
  const text = readFileSync(join(FIXTURES, `app-${screen}.json`), "utf8");
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
  readonly screen?: AppScreen;
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
  readonly onCommand?: (command: AxCommand, current: AppScreen) => AppScreen | void;
  /**
   * Whether a `setSize` moves the window.
   *
   * The default is a window that obeys, because that is what a resizable one
   * does. `false` is Calculator: the write succeeds and the frame does not
   * change, which is the case the adapter has to notice rather than report as
   * a resize.
   */
  readonly resizable?: boolean;
  /** What `identify()` answers; `null` is a bridge that cannot tell. */
  readonly identity?: AxIdentity | null;
  /** What `screenshot()` does; the default writes nothing and says so. */
  readonly onScreenshot?: (path: string) => void;
}

export interface RecordedBridge extends AxBridge {
  /** Every command the adapter sent, in order. */
  readonly commands: AxCommand[];
  /** Which screen the window is showing now. */
  screen(): AppScreen;
  /** Put the bridge on a screen, for a test that has to learn two trees. */
  setScreen(screen: AppScreen): void;
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
  let screen: AppScreen = options.screen ?? "record";
  const commands: AxCommand[] = [];
  const screenshots: string[] = [];
  /** `screen:pathIndex` → the value set on it. */
  const values = new Map<string, string>();
  /** The window's size, once a `setSize` a resizable window obeyed changed it. */
  let size: readonly [number, number] | undefined;

  return {
    commands,
    screenshots,
    screen: () => screen,
    setScreen: (one: AppScreen) => {
      screen = one;
    },
    async permission(): Promise<AxPermission> {
      return options.permission ?? { state: "granted", advice: "granted (recorded)" };
    },
    /*
     * A recorded session is a usable one: these fixtures are of an app with a
     * window on screen (Draft 2.12 §7.5). `options.session` overrides it, which
     * is how a test can be about a locked display.
     */
    async session(): Promise<AxSession> {
      return (
        options.session ?? {
          usable: true,
          state: "usable",
          owners: ["Yam"],
          detail: "1 application(s) own a window: Yam",
          advice: "This session has a WindowServer and applications can show windows.",
        }
      );
    },
    async window({ maxNodes }): Promise<AxWindow> {
      const window = recordedWindow(screen);
      const nodes: AxNode[] = window.nodes.slice(0, maxNodes).map((node, index) => {
        const set = values.get(`${screen}:${index}`);
        const withValue = set === undefined ? node : { ...node, value: set };
        /*
         * The window's own box follows a resize it accepted, for the same
         * reason a set value is remembered: the adapter proves a resize by
         * re-reading the frame, and a bridge whose frame never moved could not
         * tell the proof from the defect it was written for.
         */
        if (index !== 0 || size === undefined || withValue.box === undefined) return withValue;
        const [x, y] = withValue.box;
        return { ...withValue, box: [x, y, size[0], size[1]] as const };
      });
      return { ...window, nodes, truncated: nodes.length < window.nodes.length };
    },
    async perform(command): Promise<void> {
      commands.push(command);
      if (command.kind === "setValue") {
        const at = indexOfPath(recordedWindow(screen).nodes, command.path);
        if (at !== undefined) values.set(`${screen}:${at}`, command.value);
      }
      if (command.kind === "setSize" && options.resizable !== false) {
        size = [command.size[0], command.size[1]];
      }
      const next = options.onCommand?.(command, screen);
      if (next !== undefined) screen = next;
    },
    async screenshot(path): Promise<void> {
      screenshots.push(path);
      options.onScreenshot?.(path);
    },
    async identify(): Promise<AxIdentity | undefined> {
      const answer = options.identity;
      if (answer === null) return undefined;
      return answer ?? { bundleId: "com.svatah.yam", bundlePath: "/Applications/Yam.app", pid: 4242 };
    },
  };
}
