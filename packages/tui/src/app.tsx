/**
 * The `svatah ui` cockpit (T9.4, REQ-TUI-1, LLD §13.7; the `TUI` artboard).
 *
 * > Full authoring cockpit: four numbered panes (tree, main, inspector, audit),
 * > `1–4` focus a pane, `Tab` cycles, `j/k` move, the same actions and keys as
 * > the ADE, the same palette. It opens or adopts a service exactly as the ADE
 * > does. `--json` prints screen state and audit lines as JSON and draws
 * > nothing. No tmux dependency; it runs in any terminal.
 *
 * Everything a person reads here is a `ScreenState` from `@svatah/screens`,
 * loaded by the same `load()` the ADE calls; every key runs an `Action` from
 * the same registry the ADE's palette shows. This file is the *terminal* half
 * and nothing else: panes, keys, and a palette drawn with Ink.
 */
import { Box, Text, useApp, useInput } from "ink";
import { useCallback, useEffect, useState } from "react";
import {
  ACTIONS,
  actionById,
  actionsForScreen,
  screenById,
  type FlowsState,
  type RunState,
  type ScreenId,
  type ScreenParams,
  type ScreenService,
} from "@svatah/screens";
import { AuditPane, InspectorPane, MainPane, TreePane, colourOf, rowsIn } from "./panes.js";
import {
  PANES,
  focusPane,
  loadUi,
  moveCursor,
  nextPane,
  type Pane,
  type UiState,
} from "./model.js";

export interface AppProps {
  readonly service: ScreenService;
  readonly connection: { url: string; project: string };
  readonly screen?: ScreenId;
  readonly params?: ScreenParams;
  /** For tests: exit after this many keystrokes rather than waiting for `q`. */
  readonly onState?: (ui: UiState) => void;
}

/** The palette's rows, from the registry — the same list the ADE's ⌘K shows. */
function paletteRows(ui: UiState): Array<{ id: string; label: string; area: string; cli?: string }> {
  const query = ui.paletteQuery.trim().toLowerCase();
  return ACTIONS.filter((action) => {
    if (query === "") return true;
    return [action.id, action.label, action.cli ?? ""].some((one) =>
      one.toLowerCase().includes(query),
    );
  }).map((action) => ({
    id: action.id,
    label: action.label,
    area: action.id.split(".")[0]!,
    ...(action.cli === undefined ? {} : { cli: action.cli }),
  }));
}

export function App(props: AppProps): React.JSX.Element {
  const { exit } = useApp();
  const [ui, setUi] = useState<UiState | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadUi(
      props.service,
      props.screen ?? "flows",
      props.params ?? {},
      props.connection,
    ).then(setUi);
  }, [props.service, props.screen, props.params, props.connection]);

  useEffect(() => {
    if (ui !== undefined) props.onState?.(ui);
  }, [ui, props]);

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
        setUi({ ...ui, paletteOpen: false, paletteQuery: "" });
        return;
      }
      if (key.return) {
        const first = paletteRows(ui)[0];
        if (first !== undefined) void run(first.id);
        return;
      }
      if (key.backspace || key.delete) {
        setUi({ ...ui, paletteQuery: ui.paletteQuery.slice(0, -1) });
        return;
      }
      if (input !== "" && !key.ctrl && !key.meta) {
        setUi({ ...ui, paletteQuery: ui.paletteQuery + input });
      }
      return;
    }

    if (key.ctrl && input === "k") {
      setUi({ ...ui, paletteOpen: true, paletteQuery: "" });
      return;
    }
    if (input === "q") {
      exit();
      return;
    }

    /* ── panes: `1`–`4` and `Tab` ────────────────────────────────────────── */
    const number = Number(input);
    if (Number.isInteger(number) && number >= 1 && number <= PANES.length) {
      setUi(focusPane(ui, PANES[number - 1] as Pane));
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
     * `Enter` opens what the cursor is on: a flow in the tree, a step in the
     * main pane. Selection is a *screen parameter*, so opening a row is
     * re-loading the screen — which is how the ADE does it too, and why the two
     * cannot disagree about what a selected row shows.
     */
    if (key.return) {
      if (ui.state.screen === "flows" && ui.focus === "tree") {
        const file = (ui.state as FlowsState).files[ui.cursor.tree];
        if (file !== undefined) void reload("flows", { ...ui.params, file: file.file });
        return;
      }
      if (ui.state.screen === "flows" && ui.focus === "main") {
        const line = (ui.state as FlowsState).lines[ui.cursor.main];
        if (line !== undefined) {
          void reload("flows", { ...ui.params, selected: `line:${line.line}` });
        }
        return;
      }
      if (ui.state.screen === "run" && ui.focus === "main") {
        const step = (ui.state as RunState).steps[ui.cursor.main];
        if (step !== undefined) void reload("run", { ...ui.params, selected: step.stepId });
      }
      return;
    }

    /*
     * Single letters run actions, and *which* letter is the screen's own key
     * binding — the same table the ADE draws on its buttons (LLD §13.7's
     * "single-letter accelerators shown on buttons"). A letter defined here
     * rather than in the model would be a key the two renderers disagreed on.
     */
    const binding = screenById(ui.screen).keys.find(
      (one) => (one.terminal ?? one.key.toLowerCase()) === input,
    );
    if (binding !== undefined) void run(binding.action);
  });

  if (ui === undefined) {
    return (
      <Box>
        <Text color="gray">loading…</Text>
      </Box>
    );
  }

  const actions = actionsForScreen(ui.screen);

  return (
    <Box flexDirection="column">
      {/* the header: project, service, and what the screen is about */}
      <Box>
        <Text color="magenta">svatah ui</Text>
        <Text color="gray">
          {"  "}
          {ui.connection.project} {"  "}
          {ui.connection.url} {"  "}
          {ui.state.title} · {ui.state.subtitle}
        </Text>
      </Box>

      <Box>
        <Box width={34} flexDirection="column">
          <TreePane ui={ui} />
        </Box>
        <Box flexGrow={1} flexDirection="column">
          <MainPane ui={ui} />
        </Box>
        <Box width={40} flexDirection="column">
          <InspectorPane ui={ui} />
        </Box>
      </Box>

      <AuditPane ui={ui} />

      {/* the footer: the keys, exactly as the artboard prints them */}
      <Box>
        <Text color="gray">
          <Text color="white">^K</Text> commands {"  "}
          <Text color="white">1-4</Text> pane {"  "}
          <Text color="white">Tab</Text> next {"  "}
          <Text color="white">j k</Text> move {"  "}
          <Text color="white">Enter</Text> open{" "}
          {actions
            .filter((one) => one.key !== undefined && one.key.length === 1)
            .map((one) => `  ${one.key!.toLowerCase()} ${one.label.toLowerCase()}`)
            .join("")}
          {"  "}
          <Text color="white">q</Text> quit
        </Text>
      </Box>
      {ui.message === undefined && !busy ? null : (
        <Text color={busy ? colourOf("info") : colourOf("neutral")}>
          {busy ? "working…" : ui.message}
        </Text>
      )}

      {/* the palette: the same rows the ADE's ⌘K shows */}
      {ui.paletteOpen ? (
        <Box flexDirection="column" borderStyle="single" borderColor="magenta" paddingX={1}>
          <Text>
            <Text color="magenta">›</Text> {ui.paletteQuery}
            <Text inverse> </Text>
          </Text>
          {paletteRows(ui)
            .slice(0, 8)
            .map((row, at) => (
              <Text key={row.id} inverse={at === 0}>
                {row.area.padEnd(10)}
                {row.label.padEnd(34)}
                <Text color="gray">{row.cli ?? ""}</Text>
              </Text>
            ))}
          <Text color="gray">same list as the ADE&apos;s ⌘K and the SDK&apos;s actions</Text>
        </Box>
      ) : null}
    </Box>
  );
}
