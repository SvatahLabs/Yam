/**
 * `@svatah/yam-tui` — `yam ui`, the terminal cockpit (T9.4, REQ-TUI-1,
 * LLD §13.7).
 *
 * The second renderer of the screen model. It opens or adopts a service exactly
 * as the ADE does, loads the same screens, runs the same actions from the same
 * registry, and draws them with Ink.
 *
 * ```console
 * $ yam ui                      # the cockpit
 * $ yam ui --screen run --run comp
 * $ yam ui --json               # the model's state, and nothing drawn
 * ```
 */
import { render } from "ink";
import { createElement } from "react";
import { SCREEN_IDS, screenById, type ScreenId, type ScreenParams } from "@svatah/yam-screens";
import type { ScreenService } from "@svatah/yam-screens";
import { App } from "./app.js";
import { asJson, loadUi } from "./model.js";

export { App } from "./app.js";
export { PANES, asJson, loadUi, focusPane, moveCursor, nextPane, resize } from "./model.js";
export type { Pane, UiState } from "./model.js";
export {
  AuditPane,
  InspectorPane,
  MainPane,
  TreePane,
  treeRows,
  mainRows,
  rowsIn,
  selectionAt,
  paneModel,
  GLYPH,
  fit,
  window as listWindow,
} from "./panes.js";
export type { Cell, Line, PaneContent, PaneModel } from "./panes.js";
export { layoutFor, sizeOf, INSPECTOR_MIN_COLUMNS } from "./layout.js";
export type { Layout } from "./layout.js";

export interface UiOptions {
  readonly service: ScreenService;
  readonly connection: { url: string; project: string };
  readonly screen?: ScreenId;
  readonly params?: ScreenParams;
  /** Print the model's state and draw nothing (REQ-TUI-1, REQ-ADE-13). */
  readonly json?: boolean;
  /** Where `--json` writes. `process.stdout` unless a test says otherwise. */
  readonly out?: (text: string) => void;
  readonly stdin?: NodeJS.ReadStream;
  readonly stdout?: NodeJS.WriteStream;
  /**
   * Draw for this many milliseconds and then quit (T9.4, T9.5).
   *
   * `yam ui --capture 4000 > panes.txt` in a terminal writes what the
   * cockpit drew and gives the terminal back — which is how the progress
   * record's "capture of its panes" is taken, and how
   * `tools/repo-checks/test/tui-pty.test.ts` proves the cockpit draws in a real
   * pseudo-terminal rather than into a pipe.
   *
   * It is not a test hook bolted on: a cockpit that can only be left by pressing
   * a key cannot be captured by anything that is not a person, and REQ-ADE-13's
   * whole point is that an agent gets what a person gets.
   */
  readonly captureMs?: number;
}

/**
 * `--json`: the model's state, and the audit lines, as JSON.
 *
 * > `--json` prints screen state and audit lines as JSON and draws nothing.
 *
 * `asJson` of a freshly loaded screen — no Ink, no terminal, no cursor. That is
 * what makes T9.4's Validate checkable: "its `--json` output equals the model's
 * state", and a cockpit that had massaged a number for the terminal would fail
 * the comparison.
 */
export async function printJson(options: UiOptions): Promise<void> {
  const out = options.out ?? ((text: string) => process.stdout.write(`${text}\n`));
  const ui = await loadUi(
    options.service,
    options.screen ?? "flows",
    options.params ?? {},
    options.connection,
  );
  out(JSON.stringify(asJson(ui), null, 2));
}

/** Draw the cockpit, and answer when it exits. */
export async function runUi(options: UiOptions): Promise<void> {
  if (options.json === true) {
    await printJson(options);
    return;
  }

  const instance = render(
    createElement(App, {
      service: options.service,
      connection: options.connection,
      ...(options.screen === undefined ? {} : { screen: options.screen }),
      ...(options.params === undefined ? {} : { params: options.params }),
    }),
    {
      ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
      ...(options.stdout === undefined ? {} : { stdout: options.stdout }),
      // The cockpit owns the screen while it runs, and gives it back on exit.
      exitOnCtrlC: true,
    },
  );

  const capture =
    options.captureMs === undefined
      ? undefined
      : setTimeout(() => instance.unmount(), options.captureMs);
  try {
    await instance.waitUntilExit();
  } finally {
    if (capture !== undefined) clearTimeout(capture);
  }
}

/** `--screen <id>`, validated against the model's own list. */
export function screenFrom(value: string | undefined): ScreenId | undefined {
  if (value === undefined) return undefined;
  const found = SCREEN_IDS.find((one) => one === value);
  if (found === undefined) {
    throw new Error(
      `No screen "${value}". The model has ${SCREEN_IDS.length}: ${SCREEN_IDS.join(", ")}.`,
    );
  }
  // A screen id that exists but has no screen would be a model defect, not a
  // usage error — `screenById` throws for it, and it is checked here so the
  // message names the right thing.
  screenById(found);
  return found;
}
