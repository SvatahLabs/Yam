/**
 * The recorded APP_DIR trees, and a bridge that replays one (T6.1).
 *
 * ## Where these came from, exactly
 *
 * `node scripts/record-desktop-tree.mjs --shape uia --screen <name>` launches the real app with
 * `YAM_A11Y=1`, opens `evals/fixtures` **through the app's own Recent-project
 * button**, clicks the screen's tab, and reads Chromium's accessibility tree
 * over the DevTools protocol — roles, names, values, DOM ids, boxes — mapping it
 * into the `UiaNode` shape this adapter consumes: `ControlType`, `Name`,
 * `AutomationId`, the control patterns, the bounding rectangles.
 *
 * They are therefore a real application's real accessibility tree, not an
 * invention — which matters, because the alternative offered was to hand-author
 * them. What they are *not* is the output of `UIAutomationClient`: reading that
 * needs Windows, and this was written on macOS. The tree recorded here is the
 * one Chromium's UIA provider serialises *from* — which is why the control
 * types, the names and the automation ids are right, and why it is not proof
 * that `powershellBridge` reads them correctly.
 *
 * `docs/spec/progress/phase-6.md` states the live gate that remains and the
 * command that closes it.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { UiaAvailability, UiaBridge, UiaCommand, UiaNode, UiaWindow } from "../src/index.js";

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

export function recordedWindow(screen: AppScreen): UiaWindow {
  const text = readFileSync(join(FIXTURES, `app-${screen}.json`), "utf8");
  const window = JSON.parse(text) as Omit<UiaWindow, "cost">;
  /*
   * A recorded tree has a node count and no wall time, and says so:
   * `invocations: 0` is the flag the conformance report reads to write
   * "recorded tree" instead of publishing a bridge cost that nothing paid
   * (Draft 2.8 §7.5). Filling in a plausible number here is exactly the thing
   * the Phase 6 verification caught the desktop suite doing.
   */
  return { ...window, cost: {
      nodes: window.nodes.length,
      wallMs: 0,
      msPerNode: 0,
      invocations: 0,
      /*
       * And no load either (P8-F2). The load average beside a cost says what the
       * machine was doing while the read happened; a recording had no read, so
       * the honest number is zero beside `invocations: 0`, which is what the
       * report keys on to say "recorded tree".
       */
      loadAverage1m: 0,
      cpus: 0,
    } };
}

export interface RecordedBridgeOptions {
  /** The screen the window starts on. */
  readonly screen?: AppScreen;
  readonly availability?: UiaAvailability;
  /**
   * What a command does to the window.
   *
   * A desktop application answers an action by changing; a bridge that always
   * replayed the same tree could not test `act` at all. The handler is how a
   * test says "pressing the Run tab shows the Run screen" without needing the
   * application.
   */
  readonly onCommand?: (command: UiaCommand, current: AppScreen) => AppScreen | void;
}

export interface RecordedBridge extends UiaBridge {
  /** Every command the adapter sent, in order. */
  readonly commands: UiaCommand[];
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
 * window down (`UiaCommand.path`), because an AppleScript specifier does not
 * survive between `osascript` processes. Replaying one means walking the same
 * way.
 */
function indexOfPath(nodes: readonly UiaNode[], path: readonly number[]): number | undefined {
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
 * never changed could not test `type` at all: the adapter calls
 * `ValuePattern.SetValue`, takes a new snapshot and reads it back, and a bridge
 * that served the same tree either way would make that round trip untestable.
 * Windows does change the value; so does this.
 */
export function recordedBridge(options: RecordedBridgeOptions = {}): RecordedBridge {
  let screen: AppScreen = options.screen ?? "record";
  const commands: UiaCommand[] = [];
  const screenshots: string[] = [];
  /** `screen:pathIndex` → the value set on it. */
  const values = new Map<string, string>();

  return {
    commands,
    screenshots,
    screen: () => screen,
    setScreen: (one: AppScreen) => {
      screen = one;
    },
    async availability(): Promise<UiaAvailability> {
      return options.availability ?? { state: "available", advice: "available (recorded)" };
    },
    async window({ maxNodes }): Promise<UiaWindow> {
      const window = recordedWindow(screen);
      const nodes: UiaNode[] = window.nodes.slice(0, maxNodes).map((node, index) => {
        const set = values.get(`${screen}:${index}`);
        return set === undefined ? node : { ...node, value: set };
      });
      return { ...window, nodes, truncated: nodes.length < window.nodes.length };
    },
    async perform(command): Promise<void> {
      commands.push(command);
      if (command.kind === "pattern" && command.pattern === "Value" && command.method === "SetValue") {
        const at = indexOfPath(recordedWindow(screen).nodes, command.path);
        if (at !== undefined) values.set(`${screen}:${at}`, command.argument ?? "");
      }
      const next = options.onCommand?.(command, screen);
      if (next !== undefined) screen = next;
    },
    async screenshot(path): Promise<void> {
      screenshots.push(path);
    },
  };
}
