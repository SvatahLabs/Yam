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

/** What the tree pane lists for a screen: the rows `j`/`k` walk. */
export function treeRows(state: ScreenStateBase): Array<{ label: string; tone?: StatusTone }> {
  if (state.screen === "flows") {
    const flows = state as FlowsState;
    return flows.files.map((file) => ({ label: file.name, tone: file.status.tone }));
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
  return (
    <Panel
      number={1}
      title={ui.state.screen === "flows" ? "Flows" : "Stories"}
      focused={ui.focus === "tree"}
    >
      {rows.length === 0 ? (
        <Text color="gray">nothing here</Text>
      ) : (
        rows.slice(0, 16).map((row, at) => (
          <Row key={row.label} current={ui.focus === "tree" && at === cursor}>
            {fit(row.label, 26)}{" "}
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
    </Panel>
  );
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
  if (ui.state.screen === "run") {
    const run = ui.state as RunState;
    return (
      <Panel
        number={2}
        title={`Run ${run.runId ?? "—"} · ${run.outcome.label}`}
        focused={focused}
        grow
      >
        {run.steps.length === 0 ? (
          <Text color="gray">{run.subtitle}</Text>
        ) : (
          run.steps.map((step, at) => (
            <Row key={step.stepId} current={focused && at === ui.cursor.main}>
              <Text color={colourOf(step.status.tone)}>{glyphOf(step.status.tone)}</Text>{" "}
              {String(step.index).padStart(2)} {fit(step.text, 48)}{" "}
              <Text color="gray">
                {fit(step.detail ?? "", 12)}
                {step.durationMs === undefined ? "" : `${step.durationMs} ms`}
              </Text>
            </Row>
          ))
        )}
        {run.steps.some((one) => one.failure !== undefined) ? (
          <Text color="gray">
            {run.steps.find((one) => one.failure !== undefined)!.failure}
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
  const start = Math.max(0, Math.min(ui.cursor.main - 6, flows.lines.length - 14));
  return (
    <Panel number={2} title={flows.file ?? "Flows"} focused={focused} grow>
      {flows.lines.slice(start, start + 14).map((line, at) => (
        <Row key={line.line} current={focused && start + at === ui.cursor.main}>
          <Text color="gray">{String(line.line).padStart(3)}</Text>{" "}
          {line.outcome === undefined ? (
            " "
          ) : (
            <Text color={colourOf(line.outcome.tone)}>{glyphOf(line.outcome.tone)}</Text>
          )}{" "}
          {fit(line.text, 56)}
          {line.note === undefined ? "" : <Text color="gray"> {line.note}</Text>}
        </Row>
      ))}
      {flows.lint.length === 0 ? null : (
        <Text color={colourOf("abort")}>
          lint: {flows.lint.length} — {flows.lint[0]?.code ?? ""} {flows.lint[0]?.message ?? ""}
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

  if (ui.state.screen === "run") {
    const run = ui.state as RunState;
    const inspector = run.inspector;
    return (
      <Panel number={3} title={inspector === undefined ? "Inspect" : inspector.title} focused={focused}>
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
            <Text color="gray">session {"  "}{inspector.session ?? "—"}</Text>
            <Text color="gray">policy {"   "}{inspector.policy ?? "—"}</Text>
            <Text color="gray">candidates tried</Text>
            {inspector.candidatesTried.map((candidate) => (
              <Text key={`${candidate.by}-${candidate.value}`}>
                {"  "}
                {fit(candidate.by, 7)} {fit(candidate.value, 20)}{" "}
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
          <Text>{fit(inspector.text, 30)}</Text>
          <Text color="gray">tier {"     "}{inspector.tier ?? "—"}</Text>
          <Text color="gray">target {"   "}{inspector.target ?? "—"}</Text>
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
              {fit(candidate.by, 7)} {fit(candidate.value, 20)}{" "}
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
  return (
    <Panel number={4} title="Audit · follow" focused={ui.focus === "audit"}>
      {rows.length === 0 ? (
        <Text color="gray">no audit lines on this screen</Text>
      ) : (
        rows.slice(-8).map((line) => (
          <Text key={line.seq}>
            <Text color="gray">{line.at}</Text> <Text color="gray">{fit(line.kind, 7)}</Text>{" "}
            <Text color={line.tone === "neutral" ? undefined : colourOf(line.tone)}>
              {fit(line.text, 70)}
            </Text>
          </Text>
        ))
      )}
      <Text color="gray">─ svatah ui --json streams these same lines to stdout for an agent ─</Text>
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
