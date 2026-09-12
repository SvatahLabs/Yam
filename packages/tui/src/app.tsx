/**
 * The `yam ui` cockpit (T9.4, REQ-TUI-1, LLD §13.7; the `TUI` artboard).
 *
 * > `yam ui` is a full authoring cockpit in the terminal, sharing the app's
 * > screen model and action registry and owning its own view layer — its own
 * > layout, key map, palette behaviour and colour (Draft 2.26, REQ-TUI-1).
 *
 * Everything a person reads here is a `ScreenState` from `@svatah/yam-screens`,
 * loaded by the same `load()` the app calls, and every key runs an `Action` from
 * the same registry. What this file decides is the terminal's: which regions
 * there are (`views.tsx`), which key runs what (`keys.ts`), how tall a thing is
 * drawn (`widgets.tsx`), and how much colour the terminal will take
 * (`theme.ts`).
 *
 * It is live: `subscribe()` folds events through the model's own reducers, so a
 * run arriving here and the same run arriving in the app reach one state.
 */
import { Box, Text, useApp, useInput, useStdout } from "ink";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { useCallback, useEffect, useState } from "react";
import {
  ACTIONS,
  RAIL,
  SESSION_MODES,
  actionById,
  modeFrom,
  screenById,
  type ScreenId,
  type ScreenParams,
  type ScreenService,
} from "@svatah/yam-screens";
import {
  colourOf,
  rowsIn,
  selectionAt,
} from "./panes.js";
import {
  PANES,
  applyToScreen,
  focusPane,
  loadUi,
  moveCursor,
  nextPane,
  resize,
  type Pane,
  type UiState,
} from "./model.js";
import { INSPECTOR_MIN_COLUMNS, footerFor, sizeOf } from "./layout.js";
import { Regions, viewFor } from "./views.js";
import { StatusBar } from "./widgets.js";
import { COMMAND_KEYS, DEFAULT_SCREEN, actionForKey, keysFor } from "./keys.js";
import { moveSelection, rowsFor, type PaletteRow } from "./palette.js";

export interface AppProps {
  readonly service: ScreenService;
  /**
   * Drawing into the normal buffer rather than the alternate screen (TV-03).
   *
   * `--capture` does not take the screen, because a capture of the alternate
   * buffer is a capture of something the shell discards — and a frame that is
   * exactly as tall as the terminal, plus the newline every frame ends with,
   * scrolls it by one. So an inline cockpit leaves the last row to the newline.
   * On the alternate screen it fills every row, which is what TV-04 asks for.
   */
  readonly inline?: boolean;
  readonly connection: { url: string; project: string };
  readonly screen?: ScreenId;
  readonly params?: ScreenParams;
  /** For tests: exit after this many keystrokes rather than waiting for `q`. */
  readonly onState?: (ui: UiState) => void;
}

/** The palette's rows: the registry, scored and ordered for what was typed. */
const paletteRows = (ui: UiState): PaletteRow[] =>
  rowsFor(ACTIONS, { query: ui.paletteQuery, state: ui.state, recents: ui.recents });

export function App(props: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [ui, setUi] = useState<UiState | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  /** Bumped by the retry key, which is what re-runs the subscription. */
  const [retries, setRetries] = useState(0);
  /*
   * Whether the stream is arriving (TV-09). The renderer's, not the loaded
   * state's: the subscription outlives any one screen, and `--json` prints the
   * model rather than the cockpit's connection.
   */
  const [stream, setStream] = useState<"live" | "reconnecting" | "offline">("offline");

  /**
   * The terminal, as it is now (T10.4, P9-F4).
   *
   * The caller's size when it gave one, then the stream's, then `COLUMNS` and
   * `LINES` — which is what `script(1)` sets for a captured run — then a
   * conservative default. A cockpit that guessed 200 columns on an 80-column
   * terminal is how the Phase 9 capture came out with half an inspector.
   */
  const measure = useCallback((): { columns: number; rows: number } => {
    const columns = stdout?.columns ?? Number(process.env["COLUMNS"] ?? "0");
    const rows = stdout?.rows ?? Number(process.env["LINES"] ?? "0");
    return {
      columns: Number.isFinite(columns) && columns > 0 ? columns : 100,
      rows: Number.isFinite(rows) && rows > 0 ? rows : 30,
    };
  }, [stdout]);

  useEffect(() => {
    void loadUi(
      props.service,
      props.screen ?? DEFAULT_SCREEN,
      props.params ?? {},
      props.connection,
      measure(),
    ).then(setUi);
  }, [props.service, props.screen, props.params, props.connection, measure]);

  /* The panes follow the terminal when someone drags its corner. */
  useEffect(() => {
    if (stdout === undefined) return undefined;
    const onResize = (): void => {
      const size = measure();
      setUi((before) => (before === undefined ? before : resize(before, size.columns, size.rows)));
    };
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [measure, stdout]);

  useEffect(() => {
    if (ui !== undefined) props.onState?.(ui);
  }, [ui, props]);

  /*
   * The event stream (TV-09, TV-T14).
   *
   * The cockpit re-read only when a key was pressed, in a product whose subject
   * is runs — so a run finished and the screen did not know until somebody
   * touched it. Every event is folded by the *model's* own reducer, so a run
   * arriving here and the same run arriving in the app reach the same state.
   *
   * A stream that drops says so and offers the key that retries it. It does not
   * reload behind a person's back: a screen that reloaded itself while a cursor
   * was on a row is a screen that moved the row.
   */
  useEffect(() => {
    let stopped = false;
    let unsubscribe: (() => void) | undefined;
    try {
      unsubscribe = props.service.subscribe((event) => {
        if (stopped) return;
        setStream("live");
        setUi((before) => (before === undefined ? before : applyToScreen(before, event)));
      });
      setStream("live");
    } catch {
      setStream("offline");
    }
    return () => {
      stopped = true;
      unsubscribe?.();
    };
  }, [props.service, retries]);

  /** Re-load the current screen, keeping where the cursor is. */
  const reload = useCallback(
    async (screen: ScreenId, params: ScreenParams, message?: string): Promise<void> => {
      setBusy(true);
      try {
        const state = await screenById(screen).load(props.service, params);
        setUi((before) =>
          before === undefined
            ? before
            : { ...before, screen, params, state, paletteOpen: false, paletteQuery: "", ...(message === undefined ? {} : { message }) },
        );
      } finally {
        setBusy(false);
      }
    },
    [props.service],
  );

  /**
   * Open the flow in `$EDITOR`, and save what comes back (K6, T11.1).
   *
   * Ink owns the terminal, so it is *unmounted* for the duration: an editor
   * drawing into a screen another program is also drawing into is a screen
   * neither of them owns. `clear()` and a fresh render afterwards put the
   * cockpit back.
   *
   * Nothing is saved when the text comes back unchanged — an editor opened and
   * closed is not an edit, and a `PUT` for it would put a new mtime on a file
   * nobody touched.
   */
  const editOpenFlow = useCallback(async (): Promise<void> => {
    if (ui === undefined) return;
    const file = ui.params["file"] ?? (ui.state as { file?: string }).file;
    const before = (ui.state as { text?: string }).text;
    if (typeof file !== "string" || typeof before !== "string") {
      setUi((one) => (one === undefined ? one : { ...one, message: "No flow file is open." }));
      return;
    }

    const editor = process.env["VISUAL"] ?? process.env["EDITOR"] ?? "vi";
    const scratch = join(mkdtempSync(join(tmpdir(), "yam-ui-")), file.split("/").pop() ?? "flow");
    writeFileSync(scratch, before, "utf8");

    setBusy(true);
    try {
      const code = await new Promise<number>((done) => {
        const child = spawn(editor, [scratch], { stdio: "inherit", shell: false });
        child.on("error", () => done(-1));
        child.on("exit", (status) => done(status ?? -1));
      });
      if (code !== 0) {
        setUi((one) =>
          one === undefined ? one : { ...one, message: `${editor} exited with ${code}.` },
        );
        return;
      }
      const after = readFileSync(scratch, "utf8");
      if (after === before) {
        setUi((one) => (one === undefined ? one : { ...one, message: `${file} is unchanged.` }));
        return;
      }
      const action = actionById("flows.save");
      if (action === undefined) return;
      const outcome = await action.run(props.service, { ...ui.params, file, text: after });
      await reload(ui.screen, ui.params, outcome.message);
    } finally {
      setBusy(false);
      rmSync(dirname(scratch), { recursive: true, force: true });
    }
  }, [props.service, reload, ui]);

  /** Run one action by id, then show the screen it points at. */
  const run = useCallback(
    async (actionId: string): Promise<void> => {
      if (ui === undefined) return;
      const action = actionById(actionId);
      if (action === undefined) return;
      if (!action.availableWhen(ui.state)) {
        setUi((before) =>
          before === undefined
            ? before
            : { ...before, paletteOpen: false, message: `${action.label} is not available here.` },
        );
        return;
      }
      setBusy(true);
      /* What was just run is what a person reaches for next (TV-08). */
      setUi((before) =>
        before === undefined
          ? before
          : { ...before, recents: [actionId, ...before.recents.filter((one) => one !== actionId)].slice(0, 8) },
      );
      try {
        const outcome = await action.run(props.service, { ...ui.params });
        await reload(outcome.goTo ?? ui.screen, { ...ui.params, ...outcome.params }, outcome.message);
      } catch (cause) {
        setUi((before) =>
          before === undefined
            ? before
            : {
                ...before,
                paletteOpen: false,
                message: cause instanceof Error ? cause.message : String(cause),
              },
        );
      } finally {
        setBusy(false);
      }
    },
    [props.service, reload, ui],
  );

  useInput((input, key) => {
    if (ui === undefined) return;

    /* ── the palette (`^K`, LLD §13.7) ───────────────────────────────────── */
    if (ui.paletteOpen) {
      if (key.escape) {
        setUi({ ...ui, paletteOpen: false, paletteQuery: "", paletteAt: 0 });
        return;
      }
      /* The selection moves (TV-08): `Enter` used to run the first row, always. */
      if (key.downArrow || (key.ctrl && input === "n")) {
        setUi({ ...ui, paletteAt: moveSelection(ui.paletteAt, 1, paletteRows(ui).length) });
        return;
      }
      if (key.upArrow || (key.ctrl && input === "p")) {
        setUi({ ...ui, paletteAt: moveSelection(ui.paletteAt, -1, paletteRows(ui).length) });
        return;
      }
      if (key.return) {
        const chosen = paletteRows(ui)[ui.paletteAt];
        if (chosen !== undefined) void run(chosen.id);
        return;
      }
      if (key.backspace || key.delete) {
        setUi({ ...ui, paletteQuery: ui.paletteQuery.slice(0, -1), paletteAt: 0 });
        return;
      }
      if (input !== "" && !key.ctrl && !key.meta) {
        setUi({ ...ui, paletteQuery: ui.paletteQuery + input, paletteAt: 0 });
      }
      return;
    }

    if (key.ctrl && input === "k") {
      setUi({ ...ui, paletteOpen: true, paletteQuery: "", paletteAt: 0 });
      return;
    }
    /* The key map, drawn from the table the footer is drawn from (TV-07). */
    /* `R` retries a dropped stream: a stated state with a way back (TV-09). */
    if (input === "R") {
      setRetries((was) => was + 1);
      setStream("reconnecting");
      setUi({ ...ui, message: "Reconnecting to the event stream…" });
      return;
    }
    if (input === "?") {
      setHelpOpen((was) => !was);
      return;
    }
    if (helpOpen) {
      if (key.escape || input === "q") setHelpOpen(false);
      return;
    }
    /*
     * The mode, on one key (TV-15). Only where there are modes: `m` on a screen
     * without them would be a key that does nothing, which the footer would
     * have to advertise anyway.
     */
    if (input === "m" && SESSION_MODES.length > 0 && ui.screen === "session") {
      const now = modeFrom(ui.params["mode"]);
      const next = SESSION_MODES[(SESSION_MODES.indexOf(now) + 1) % SESSION_MODES.length]!;
      void reload(ui.screen, { ...ui.params, mode: next });
      return;
    }
    if (input === "q") {
      exit();
      return;
    }

    /* ── panes: `1`–`4` and `Tab` ────────────────────────────────────────── */
    const number = Number(input);
    if (Number.isInteger(number) && number >= 1 && number <= PANES.length) {
      const pane = PANES[number - 1] as Pane;
      /*
       * Pane 3 on a narrow terminal (T10.4, P9-F4). The inspector is collapsed
       * out of the row of columns rather than clipped, and focusing it draws it
       * full width under the main pane — so nothing is unreachable at 100
       * columns, and nothing is half off the screen either.
       */
      setUi({
        ...focusPane(ui, pane),
        ...(pane === "inspector" && ui.layout.inspectorCollapsed
          ? {
              message:
                `The inspector is drawn below the main pane: this terminal is ` +
                `${ui.layout.columns} columns and three panes need ${INSPECTOR_MIN_COLUMNS}.`,
            }
          : {}),
      });
      return;
    }
    if (key.tab) {
      setUi(nextPane(ui));
      return;
    }

    /* ── the cursor: `j`/`k` and the arrows ──────────────────────────────── */
    if (input === "j" || key.downArrow) {
      setUi(moveCursor(ui, 1, rowsIn(ui, ui.focus)));
      return;
    }
    if (input === "k" || key.upArrow) {
      setUi(moveCursor(ui, -1, rowsIn(ui, ui.focus)));
      return;
    }

    /*
     * `Enter` opens what the cursor is on — a flow, a run, a binding, a filter,
     * a snapshot node — and *what* that means is the pane model's, not this
     * file's (T10.1, T10.2). Selection is a screen parameter in both renderers
     * (§13.7), so opening a row here and clicking it in the app reach the same
     * state, and a screen added later needs no arm in this switch because there
     * is no switch.
     */
    if (key.return) {
      const select = selectionAt(ui, ui.focus);
      if (select !== undefined) void reload(ui.screen, { ...ui.params, ...select });
      return;
    }

    /*
     * `g` then a rail letter is not a thing; the palette's Go-to rows are how a
     * screen is reached, and `^K` opens it. What `[` and `]` do is walk the rail
     * in order, which is the terminal's equivalent of clicking the next item —
     * conventional, and one keystroke rather than four.
     */
    if (input === "[" || input === "]") {
      const order = RAIL.map((one) => one.screen);
      const at = order.indexOf(ui.screen);
      const next =
        at < 0
          ? order[0]
          : order[(at + (input === "]" ? 1 : order.length - 1)) % order.length];
      if (next !== undefined) void reload(next, {});
      return;
    }

    /*
     * Single letters run actions, and *which* letter is the screen's own key
     * binding — the same table the app draws on its buttons (LLD §13.7's
     * "single-letter accelerators shown on buttons"). A letter defined here
     * rather than in the model would be a key the two renderers disagreed on.
     */
    /*
     * `^s` is a binding, not two characters.
     *
     * A screen writes a control key as `^s` (the Data screen's save), and Ink
     * delivers it as `input === "s"` with `key.ctrl`. Comparing the declaration
     * against `input` alone could never match, so that action was unreachable
     * from the cockpit while the app's ⌘S worked — one action, two renderers,
     * and only one of them could run it.
     */
    const pressed = key.ctrl ? `^${input}` : input;
    /* The mode is a screen parameter, so the key map is scoped by it (TV-15). */
    const bound = actionForKey(ui.screen, pressed, modeFrom(ui.params["mode"]));
    if (bound === undefined) return;
    /*
     * `flows.save` in a terminal means "open this in my editor" (K6, T11.1).
     *
     * The action is the same one the app's Save button runs and it writes
     * through the same `PUT /flows/:file`; what differs is where the text comes
     * from. A cockpit that built a modal text editor inside Ink would be a
     * worse `vi` that nobody asked this project to write.
     */
    if (bound === "flows.save") {
      void editOpenFlow();
      return;
    }
    void run(bound);
  });

  if (ui === undefined) {
    return (
      <Box>
        <Text color="gray">loading…</Text>
      </Box>
    );
  }

  const keys = keysFor(ui.screen, modeFrom(ui.params["mode"]));
  const view = viewFor(ui.state);

  /*
   * The frame is exactly the terminal (TV-04). One row for the status bar, one
   * for the footer, one for a message when there is one, and everything else is
   * the regions — which fill it, rather than being as tall as they happen to be.
   */
  const messageRows = ui.message === undefined && !busy ? 0 : 1;
  /*
   * The palette takes its rows from the body, not from beyond the bottom of the
   * terminal: a frame that is exactly the terminal has no "beyond" (TV-04).
   */
  const paletteRowCount = ui.paletteOpen ? Math.min(12, Math.max(6, Math.floor(ui.layout.rows / 3))) : 0;
  const helpRowCount = helpOpen ? Math.min(ui.layout.rows - 6, COMMAND_KEYS.length + keysFor(ui.screen).length + 3) : 0;
  /*
   * Inline, the last row belongs to the newline every frame ends with; on the
   * alternate screen there is no newline to make room for. The *size* is the
   * terminal's either way, because that is the fact a capture is read with.
   */
  const drawnRows = ui.layout.rows - (props.inline === true ? 1 : 0);
  const bodyRows = Math.max(3, drawnRows - 2 - messageRows - paletteRowCount - helpRowCount);

  return (
    <Box flexDirection="column" width={ui.layout.columns} height={drawnRows}>
      <StatusBar
        width={ui.layout.columns}
        /*
         * The screen's title before the project's path: the left is what gets
         * cut when a terminal is narrow, and a hundred-column capture that had
         * dropped "Agents and tools" for a temporary directory's name is a
         * capture of a screen nobody can identify.
         */
        left={["yam", ui.state.title, ui.connection.project, ui.connection.url]}
        right={[
          ui.state.subtitle,
          stream === "live" ? "live" : stream === "reconnecting" ? "reconnecting…" : "offline · R",
          sizeOf(ui.layout),
        ]}
      />

      <Regions
        view={view}
        screen={ui.screen}
        columns={ui.layout.columns}
        rows={bodyRows}
        focus={ui.focus}
        cursor={ui.cursor}
      />

      {messageRows === 0 ? null : (
        <Text color={busy ? colourOf("info") : colourOf("neutral")} wrap="truncate-end">
          {busy ? "working…" : ui.message}
        </Text>
      )}

      <Box width={ui.layout.columns}>
        <Text color="gray" wrap="truncate-end">
          {footerFor(ui.layout.columns, keys).map((one, at) => (
            <Text key={one.key}>
              {at === 0 ? "" : "  "}
              <Text color="white">{one.key}</Text> {one.label}
            </Text>
          ))}
        </Text>
      </Box>

      {helpOpen ? (
        <Box flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1} width={ui.layout.columns}>
          <Text color="magenta">Keys · generated from the key map · yam ui --keys --json</Text>
          {COMMAND_KEYS.map((one) => (
            <Text key={one.key} wrap="truncate-end">
              <Text color="magenta">{one.key.padEnd(6)}</Text> {one.label}
            </Text>
          ))}
          {keys.map((one) => (
            <Text key={`s-${one.key}`} wrap="truncate-end">
              <Text color="magenta">{one.key.padEnd(6)}</Text> {one.label}
              {one.modes === undefined ? "" : <Text color="gray">{`  · ${one.modes.join(", ")}`}</Text>}
            </Text>
          ))}
        </Box>
      ) : null}

      {/* the palette: the same rows the app's ⌘K shows */}
      {ui.paletteOpen ? (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="magenta"
          paddingX={1}
          width={ui.layout.columns}
        >
          <Text>
            <Text color="magenta">›</Text> {ui.paletteQuery}
            <Text inverse> </Text>
          </Text>
          {paletteRows(ui)
            .slice(Math.max(0, ui.paletteAt - 6), Math.max(0, ui.paletteAt - 6) + 8)
            .map((row, at) => {
              const chosen = Math.max(0, ui.paletteAt - 6) + at === ui.paletteAt;
              return (
                <Text
                  key={row.id}
                  {...(chosen ? { backgroundColor: "#231d3a", bold: true } : {})}
                  wrap="truncate-end"
                >
                  <Text color={row.available ? "gray" : "#5f6a78"}>{row.area.padEnd(10)}</Text>
                  <Text color={row.available ? undefined : "#5f6a78"}>{row.label.padEnd(34)}</Text>
                  <Text color={row.available ? "gray" : "yellow"}>{row.why ?? row.cli ?? ""}</Text>
                </Text>
              );
            })}
          <Text color="gray">
            ↑↓ move · ↵ run · esc close · greyed rows say why
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}
