/**
 * The four panes (T9.4, REQ-TUI-1, LLD §13.7; the `TUI` artboard).
 *
 * > four numbered panes (tree, main, inspector, audit), `1–4` focus a pane,
 * > `Tab` cycles, `j/k` move, the same actions and keys as the ADE, the same
 * > palette.
 *
 * Each pane is a pure function of a `ScreenState` and a cursor. There is no
 * fetching, no formatting decision and no arithmetic here that the ADE does
 * differently — the numbers, the words and the status labels are the model's,
 * and the only thing this file knows is how to draw a box in a terminal.
 *
 * Colour comes from `@svatah/ui-tokens`'s `STATUS` table, by the same names the
 * browser uses. A terminal has no CSS variables; it has the same seven tones.
 */
import { Box, Text } from "ink";
import { STATUS, type StatusTone } from "@svatah/ui-tokens";
import { ago } from "@svatah/screens";
import type { FlowsState, RunState, ScreenStateBase } from "@svatah/screens";
import type { Pane, UiState } from "./model.js";

/** A tone's ANSI colour, from the one table both renderers read. */
export const colourOf = (tone: StatusTone): string => STATUS[tone].ansi;
export const glyphOf = (tone: StatusTone): string => STATUS[tone].glyph;

/** A bordered pane with its number in the title, as the artboard draws it. */
export function Panel({
  number,
  title,
  focused,
  children,
  grow,
}: {
  readonly number: number;
  readonly title: string;
  readonly focused: boolean;
  readonly children: React.ReactNode;
  readonly grow?: boolean;
}): React.JSX.Element {
  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={focused ? "magenta" : "gray"}
      paddingX={1}
      flexGrow={grow === true ? 1 : 0}
      overflow="hidden"
    >
      <Text color="gray">
        <Text color="magenta">{number}</Text> {title}
      </Text>
      {children}
    </Box>
  );
}

/** One row, highlighted when the cursor is on it and the pane has focus. */
function Row({
  children,
  current,
}: {
  readonly children: React.ReactNode;
  readonly current: boolean;
}): React.JSX.Element {
  return <Text inverse={current}>{children}</Text>;
}

/** `"a string"` cut to `width`, so a narrow terminal does not wrap a table. */
const fit = (text: string, width: number): string =>
  text.length <= width ? text.padEnd(width) : `${text.slice(0, Math.max(0, width - 1))}…`;

/* ────────────────────────────────────────────────────────────────────────────
 * 1 · tree
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * What the tree pane lists for a screen: the rows `j`/`k` walk.
 *
 * `note` is where the relative time goes (P9-F4, Draft 2.12 §13.7). The model
 * carries `lastRunAt`, an instant; "run 4 min ago" is computed here with the
 * same `ago()` the ADE calls, so the two renderers agree without the state
 * changing every second.
 */
export function treeRows(
  state: ScreenStateBase,
  now: number = Date.now(),
): Array<{ label: string; tone?: StatusTone; note?: string }> {
  if (state.screen === "flows") {
    const flows = state as FlowsState;
    return flows.files.map((file) => ({
      label: file.name,
      tone: file.status.tone,
      ...(ago(file.lastRunAt, now) === undefined ? {} : { note: ago(file.lastRunAt, now)! }),
    }));
  }
  if (state.screen === "run") {
    const run = state as RunState;
    return run.stories.map((story) => ({ label: story.story, tone: story.status.tone }));
  }
  return [];
}

export function TreePane({ ui }: { readonly ui: UiState }): React.JSX.Element {
  const rows = treeRows(ui.state);
  const cursor = ui.cursor.tree;
  /*
   * Every width is the layout's (T10.4, P9-F4). `- 4` is the pane's border and
   * its one column of padding on each side; a row cut to the terminal is a row
   * that cannot push the pane beside it off the screen.
   */
  const inner = Math.max(8, ui.layout.tree - 4);
  const start = window(cursor, rows.length, ui.layout.listRows);
  return (
    <Panel
      number={1}
      title={ui.state.screen === "flows" ? "Flows" : "Stories"}
      focused={ui.focus === "tree"}
    >
      {rows.length === 0 ? (
        <Text color="gray">nothing here</Text>
      ) : (
        rows.slice(start, start + ui.layout.listRows).map((row, at) => (
          <Row key={row.label} current={ui.focus === "tree" && start + at === cursor}>
            {fit(row.label, Math.max(6, inner - 12))}{" "}
            {row.tone === undefined ? (
              ""
            ) : (
              <Text color={colourOf(row.tone)}>
                {glyphOf(row.tone)} {statusWord(ui.state, row.label)}
              </Text>
            )}
          </Row>
        ))
      )}
      {/*
        The relative time, computed here from the model's instant (P9-F4). It is
        on its own line rather than beside the name because a narrow tree has no
        room for both, and the tree is the pane that narrows first.
      */}
      {rows[cursor]?.note === undefined ? null : (
        <Text color="gray">{fit(rows[cursor]!.note!, inner)}</Text>
      )}
    </Panel>
  );
}

/**
 * Which slice of a list to draw so the cursor is on screen.
 *
 * Kept in one place because all four panes scroll the same way, and a pane that
 * scrolled differently would be a pane where `j` did something else.
 */
export function window(cursor: number, total: number, height: number): number {
  if (total <= height) return 0;
  return Math.max(0, Math.min(cursor - Math.floor(height / 2), total - height));
}

/** The word beside the glyph. Never a colour alone, in a terminal either. */
function statusWord(state: ScreenStateBase, label: string): string {
  if (state.screen === "flows") {
    return (state as FlowsState).files.find((one) => one.name === label)?.status.label ?? "";
  }
  if (state.screen === "run") {
    return (state as RunState).stories.find((one) => one.story === label)?.status.label ?? "";
  }
  return "";
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2 · main
 * ──────────────────────────────────────────────────────────────────────────── */

/** The rows of the main pane: the editor's lines, or the run's steps. */
export function mainRows(state: ScreenStateBase): number {
  if (state.screen === "flows") return (state as FlowsState).lines.length;
  if (state.screen === "run") return (state as RunState).steps.length;
  return 0;
}

export function MainPane({ ui }: { readonly ui: UiState }): React.JSX.Element {
  const focused = ui.focus === "main";
  const inner = Math.max(20, ui.layout.main - 4);
  if (ui.state.screen === "run") {
    const run = ui.state as RunState;
    const start = window(ui.cursor.main, run.steps.length, ui.layout.listRows);
    return (
      <Panel
        number={2}
        title={fit(`Run ${run.runId ?? "—"} · ${run.outcome.label}`, inner).trimEnd()}
        focused={focused}
        grow
      >
        {run.steps.length === 0 ? (
          <Text color="gray">{run.subtitle}</Text>
        ) : (
          run.steps.slice(start, start + ui.layout.listRows).map((step, at) => (
            <Row key={step.stepId} current={focused && start + at === ui.cursor.main}>
              <Text color={colourOf(step.status.tone)}>{glyphOf(step.status.tone)}</Text>{" "}
              {String(step.index).padStart(2)} {fit(step.text, Math.max(12, inner - 24))}{" "}
              <Text color="gray">
                {fit(step.detail ?? "", 12)}
                {step.durationMs === undefined ? "" : `${step.durationMs} ms`}
              </Text>
            </Row>
          ))
        )}
        {run.steps.some((one) => one.failure !== undefined) ? (
          <Text color="gray">
            {fit(run.steps.find((one) => one.failure !== undefined)!.failure!, inner)}
          </Text>
        ) : null}
        {run.exitCode === undefined ? null : (
          <Text color={colourOf(run.outcome.tone)}>
            flow {run.outcome.label} · exit {run.exitCode}
          </Text>
        )}
      </Panel>
    );
  }

  const flows = ui.state as FlowsState;
  const start = window(ui.cursor.main, flows.lines.length, ui.layout.listRows);
  const text = Math.max(12, inner - (ui.layout.inspectorCollapsed ? 8 : 22));
  return (
    <Panel number={2} title={fit(flows.file ?? "Flows", inner).trimEnd()} focused={focused} grow>
      {flows.lines.slice(start, start + ui.layout.listRows).map((line, at) => (
        <Row key={line.line} current={focused && start + at === ui.cursor.main}>
          <Text color="gray">{String(line.line).padStart(3)}</Text>{" "}
          {line.outcome === undefined ? (
            " "
          ) : (
            <Text color={colourOf(line.outcome.tone)}>{glyphOf(line.outcome.tone)}</Text>
          )}{" "}
          {fit(line.text, text)}
          {line.note === undefined ? "" : <Text color="gray"> {fit(line.note, 16)}</Text>}
        </Row>
      ))}
      {flows.lint.length === 0 ? null : (
        <Text color={colourOf("abort")}>
          {fit(
            `lint: ${flows.lint.length} — ${flows.lint[0]?.code ?? ""} ${flows.lint[0]?.message ?? ""}`,
            inner,
          )}
        </Text>
      )}
    </Panel>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3 · inspector
 * ──────────────────────────────────────────────────────────────────────────── */

export function InspectorPane({ ui }: { readonly ui: UiState }): React.JSX.Element {
  const focused = ui.focus === "inspector";
  /*
   * Beside the others when there is room, full width under them when there is
   * not (T10.4, P9-F4). Either way it is drawn whole: the defect this replaces
   * was a forty-column pane on a hundred-column terminal, half of it past the
   * right edge.
   */
  const inner = Math.max(
    16,
    (ui.layout.inspector ?? ui.layout.main + ui.layout.tree) - 4,
  );

  if (ui.state.screen === "run") {
    const run = ui.state as RunState;
    const inspector = run.inspector;
    return (
      <Panel
        number={3}
        title={fit(inspector === undefined ? "Inspect" : inspector.title, inner).trimEnd()}
        focused={focused}
      >
        {inspector === undefined ? (
          <Text color="gray">no step selected</Text>
        ) : (
          <>
            <Text color="gray">
              failure {"  "}
              <Text color={colourOf(inspector.failureClass?.tone ?? "neutral")}>
                {inspector.failureClass?.label ?? "none"}
              </Text>
            </Text>
            <Text color="gray">session {"  "}{fit(inspector.session ?? "—", inner - 10)}</Text>
            <Text color="gray">policy {"   "}{fit(inspector.policy ?? "—", inner - 10)}</Text>
            <Text color="gray">candidates tried</Text>
            {inspector.candidatesTried.map((candidate) => (
              <Text key={`${candidate.by}-${candidate.value}`}>
                {"  "}
                {fit(candidate.by, 7)} {fit(candidate.value, Math.max(8, inner - 22))}{" "}
                <Text color={colourOf("fail")}>{candidate.matched}</Text>
              </Text>
            ))}
            {inspector.screenshot === undefined ? null : (
              <Text color="gray">screenshot {inspector.screenshot}</Text>
            )}
          </>
        )}
      </Panel>
    );
  }

  const flows = ui.state as FlowsState;
  const inspector = flows.inspector;
  return (
    <Panel number={3} title="Inspect" focused={focused}>
      {inspector === undefined ? (
        <Text color="gray">no step selected</Text>
      ) : (
        <>
          <Text>{fit(inspector.text, inner)}</Text>
          <Text color="gray">tier {"     "}{inspector.tier ?? "—"}</Text>
          <Text color="gray">target {"   "}{fit(inspector.target ?? "—", inner - 10)}</Text>
          <Text color="gray">
            binding {"  "}
            {inspector.binding === undefined ? (
              "—"
            ) : (
              <Text color={colourOf(inspector.binding.verified ? "pass" : "abort")}>
                {inspector.binding.verified ? "verified" : "unverified"}
              </Text>
            )}
          </Text>
          {(inspector.binding?.candidates ?? []).map((candidate) => (
            <Text key={`${candidate.by}-${candidate.value}`}>
              {"  "}
              {fit(candidate.by, 7)} {fit(candidate.value, Math.max(8, inner - 22))}{" "}
              <Text color="gray">{candidate.score ?? ""}</Text>
            </Text>
          ))}
        </>
      )}
    </Panel>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4 · audit
 * ──────────────────────────────────────────────────────────────────────────── */

export function AuditPane({ ui }: { readonly ui: UiState }): React.JSX.Element {
  const rows = ui.state.screen === "run" ? (ui.state as RunState).audit : [];
  const inner = Math.max(20, ui.layout.columns - 4);
  return (
    <Panel number={4} title="Audit · follow" focused={ui.focus === "audit"}>
      {rows.length === 0 ? (
        <Text color="gray">no audit lines on this screen</Text>
      ) : (
        rows.slice(-ui.layout.auditRows).map((line) => (
          <Text key={line.seq}>
            <Text color="gray">{line.at}</Text> <Text color="gray">{fit(line.kind, 7)}</Text>{" "}
            <Text color={line.tone === "neutral" ? undefined : colourOf(line.tone)}>
              {fit(line.text, Math.max(20, inner - 18))}
            </Text>
          </Text>
        ))
      )}
      <Text color="gray">
        {fit("─ svatah ui --json streams these same lines to stdout for an agent ─", inner)}
      </Text>
    </Panel>
  );
}

/** How many rows the focused pane has, so `j`/`k` can be clamped. */
export function rowsIn(ui: UiState, pane: Pane): number {
  if (pane === "tree") return treeRows(ui.state).length;
  if (pane === "main") return mainRows(ui.state);
  if (pane === "audit") return ui.state.screen === "run" ? (ui.state as RunState).audit.length : 0;
  return 0;
}
