/**
 * The ADE's shell (T9.4, REQ-ADE-11, REQ-ADE-12, LLD §13.7; the `Main`,
 * `Run` and `Palette` artboards).
 *
 * > Top bar: project crumb, command palette field, environment and service
 * > chips. Left rail: Flows, Runs, Bindings, Agents and tools; Resources: API,
 * > Data; bottom: Import prototype database, Settings. Centre: the selected
 * > screen […] Right: a contextual inspector […] Status bar: context on the
 * > left, keys on the right.
 *
 * Phase 9 renders two of the twelve screens — Flows and Run (T9.4) — and the
 * other ten are reachable through the old tabs behind a **Legacy** rail item
 * until Phase 10 replaces them. That is T9.4's scope, stated as a rail item so
 * nobody has to remember it.
 *
 * ## What this file may and may not do
 *
 * It may lay out a page, hold which screen is showing, and turn a key into an
 * action id. It may not decide what a number means: every value comes from a
 * `ScreenState` the model loaded, and every action is an `Action` from the one
 * registry. A shell that formatted a duration would be a shell that formats it
 * differently from `svatah ui`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIONS,
  RAIL,
  actionById,
  actionsForScreen,
  applyEvent,
  screenById,
  type Action,
  type ScreenId,
  type ScreenParams,
  type ScreenStateBase,
} from "@svatah/screens";
import { Alert, Button, CommandPalette, Kbd, RailItem, type PaletteRow } from "@svatah/ui";
import type { FlowsState, RunState } from "@svatah/screens";
import type { ServiceClient } from "../client.js";
import { FlowsInspector, FlowsScreen } from "./Flows.js";
import { RunInspector, RunScreen } from "./Run.js";

/** The screens Phase 9 renders. Everything else is behind the Legacy rail item. */
export const RENDERED: readonly ScreenId[] = ["flows", "run"];

export interface ShellProps {
  readonly client: ServiceClient;
  readonly project: string;
  readonly serviceUrl: string;
  /** The old eleven-tab application, rendered when the Legacy rail item is on. */
  readonly legacy: React.ReactNode;
}

type Showing = ScreenId | "legacy";

export function Shell(props: ShellProps): React.JSX.Element {
  const [showing, setShowing] = useState<Showing>("flows");
  const [params, setParams] = useState<ScreenParams>({});
  const [state, setState] = useState<ScreenStateBase | undefined>(undefined);
  const [tab, setTab] = useState<"editor" | "plan" | "history">("editor");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [evidence, setEvidence] = useState<string | undefined>(undefined);
  const latest = useRef(0);

  const screen: ScreenId = showing === "legacy" ? "flows" : showing;

  /* ── load ──────────────────────────────────────────────────────────────── */

  const load = useCallback(
    async (which: ScreenId, next: ScreenParams): Promise<void> => {
      const token = ++latest.current;
      const loaded = await screenById(which).load(props.client, next);
      // A screen the user has already left must not overwrite the one they are
      // on: two loads in flight is the ordinary case when someone clicks twice.
      if (token === latest.current) setState(loaded);
    },
    [props.client],
  );

  useEffect(() => {
    if (showing === "legacy") return;
    void load(showing, params);
  }, [showing, params, load]);

  /* ── the live run (LLD §13.5's stream) ─────────────────────────────────── */

  /*
   * Subscribed for as long as the window is open, not only while the Run screen
   * is showing.
   *
   * A run is *started from the Flows screen*: `POST /run` answers 202 and the
   * first `step.result` can arrive before the shell has finished switching
   * screens. A subscription that came up with the Run screen therefore missed
   * the beginning of every short run — and `run.summary` with it, so the screen
   * sat on a live run that had already ended and an empty audit pane.
   *
   * `paramsRef` rather than `params` in the dependency list: re-subscribing on
   * every selection change would drop the stream between two frames, which is
   * the same defect with a smaller window.
   */
  const paramsRef = useRef<ScreenParams>({});
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    return props.client.subscribe((event) => {
      setState((before) =>
        before === undefined || before.screen !== "run"
          ? before
          : applyEvent(before as RunState, event),
      );
      /*
       * When the run ends, load the screen again from the files it wrote.
       *
       * The stream carries `step.result` and `run.summary` and no audit lines —
       * `audit.jsonl` is written as the run goes and read by
       * `GET /runs/:id/audit`. A screen that only folded events would show a
       * finished run with an empty audit pane, which is a different screen from
       * the one someone opening the same run tomorrow sees. One re-load makes
       * the live screen and the historical screen the same object.
       */
      if (event.kind === "run.summary" || event.kind === "run.failed") {
        const runId = typeof event["runId"] === "string" ? event["runId"] : undefined;
        const next = runId === undefined ? paramsRef.current : { ...paramsRef.current, runId };
        if (runId !== undefined) setParams(next);
        void load("run", next);
      }
    });
  }, [load, props.client]);

  /* ── the failing step's screenshot ─────────────────────────────────────── */

  useEffect(() => {
    const run = state?.screen === "run" ? (state as RunState) : undefined;
    const shot = run?.inspector?.screenshot;
    if (run?.runId === undefined || shot === undefined) {
      setEvidence(undefined);
      return undefined;
    }
    let url: string | undefined;
    void props.client
      .screenshot(run.runId, shot)
      .then((blob) => {
        url = URL.createObjectURL(blob);
        setEvidence(url);
      })
      .catch(() => setEvidence(undefined));
    return () => {
      if (url !== undefined) URL.revokeObjectURL(url);
    };
  }, [props.client, state]);

  /* ── actions ───────────────────────────────────────────────────────────── */

  const runAction = useCallback(
    async (id: string): Promise<void> => {
      const action = actionById(id);
      if (action === undefined || state === undefined) return;
      setPaletteOpen(false);
      try {
        const outcome = await action.run(props.client, { ...params });
        setMessage(outcome.message);
        const goTo = outcome.goTo;
        if (goTo !== undefined) {
          setParams({ ...params, ...outcome.params });
          setShowing(RENDERED.includes(goTo) ? goTo : "legacy");
        } else {
          // Re-load, because the action changed something on disk.
          void load(screen, params);
        }
      } catch (cause) {
        setMessage(cause instanceof Error ? cause.message : String(cause));
      }
    },
    [load, params, props.client, screen, state],
  );

  /* ── keys (LLD §13.7: ⌘K, and the accelerators on the buttons) ─────────── */

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (paletteOpen || state === undefined) return;
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        const primary = actionsForScreen(screen).find((one) => one.key === "⌘↵");
        if (primary !== undefined) void runAction(primary.id);
        return;
      }
      /*
       * A single letter runs the screen's action with that accelerator — and
       * only when nothing is being typed into, which is the difference between
       * an accelerator and a lost keystroke.
       */
      const target = event.target as HTMLElement | null;
      if (target !== null && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
      const binding = screenById(screen).keys.find(
        (one) => one.key.toLowerCase() === event.key.toLowerCase() && one.key.length === 1,
      );
      if (binding !== undefined) {
        event.preventDefault();
        void runAction(binding.action);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [paletteOpen, runAction, screen, state]);

  /* ── the palette's rows: the registry, filtered by this state ──────────── */

  const paletteRows = useMemo<PaletteRow[]>(
    () =>
      ACTIONS.map((action: Action) => ({
        id: action.id,
        label: action.label,
        group: action.group,
        area: action.id.split(".")[0]!,
        ...(action.key === undefined ? {} : { key: action.key }),
        ...(action.cli === undefined ? {} : { cli: action.cli }),
        available: state === undefined ? action.group === "Go to" : action.availableWhen(state),
      })),
    [state],
  );

  const goTo = useCallback(
    (id: string): void => {
      const action = actionById(id);
      if (action?.group === "Go to") {
        setPaletteOpen(false);
        setShowing(RENDERED.includes(action.screen) ? action.screen : "legacy");
        return;
      }
      void runAction(id);
    },
    [runAction],
  );

  const actions = actionsForScreen(screen);

  return (
    <div className="sv-app sv-root">
      {/* ── top bar ───────────────────────────────────────────────────────── */}
      <header className="sv-topbar">
        <span className="sv-brand">
          <span className="sv-brand-mark" aria-hidden="true" />
          Svatah
        </span>
        <nav className="sv-crumb" aria-label="Project">
          <span className="sv-crumb-sep">/</span>
          <b id="crumb-project">{props.project.split(/[\\/]/).filter(Boolean).pop() ?? props.project}</b>
          <span className="sv-crumb-sep">/</span>
          <span id="crumb-screen">{state?.title ?? ""}</span>
        </nav>
        <span className="sv-spacer" />
        <Button
          id="open-command-palette"
          label="Search or run a command"
          variant="ghost"
          accelerator="⌘K"
          onPress={() => setPaletteOpen(true)}
        />
        <span className="sv-chip" id="service-chip">
          <span className="sv-dot sv-tone-pass" aria-hidden="true" />
          service {props.serviceUrl.replace(/^https?:\/\//, "")}
        </span>
      </header>

      {/* ── rail ──────────────────────────────────────────────────────────── */}
      <nav className="sv-rail" aria-label="Sections">
        {(["Project", "Resources", "Bottom"] as const).map((group) => (
          <div key={group} className={group === "Bottom" ? "sv-rail-group sv-rail-bottom" : "sv-rail-group"}>
            {group === "Bottom" ? null : <p className="sv-rail-heading">{group}</p>}
            {RAIL.filter((one) => one.group === group).map((one) => (
              <RailItem
                key={one.screen}
                id={`rail-${one.screen}`}
                label={one.label}
                active={showing === one.screen}
                onPress={() =>
                  setShowing(RENDERED.includes(one.screen) ? one.screen : "legacy")
                }
              />
            ))}
          </div>
        ))}
        {/*
          T9.4: "the other screens still reachable through the old tabs behind a
          'Legacy' rail item until Phase 10". A rail item rather than a note in a
          progress file, so it is obvious what is and is not rebuilt.
        */}
        <div className="sv-rail-group sv-rail-legacy">
          <RailItem
            id="rail-legacy"
            label="Legacy"
            active={showing === "legacy"}
            count={11}
            onPress={() => setShowing("legacy")}
          />
        </div>
      </nav>

      {/* ── workspace ─────────────────────────────────────────────────────── */}
      <section className="sv-workspace" aria-label="Workspace">
        {showing === "legacy" ? (
          props.legacy
        ) : state === undefined ? (
          <p className="sv-empty">Loading…</p>
        ) : state.error !== undefined ? (
          <Alert id="screen-error" tone="fail">
            {state.error} The service is at{" "}
            <span className="sv-mono">{props.serviceUrl}</span>; `svatah serve --project{" "}
            {props.project}` starts one by hand.
          </Alert>
        ) : state.screen === "run" ? (
          <RunScreen
            state={state as RunState}
            params={params}
            actions={actions}
            onAction={(id) => void runAction(id)}
            onParams={setParams}
            {...(evidence === undefined ? {} : { evidence })}
          />
        ) : (
          <FlowsScreen
            state={state as FlowsState}
            params={params}
            actions={actions}
            onAction={(id) => void runAction(id)}
            onParams={setParams}
            tab={tab}
            onTab={setTab}
          />
        )}
      </section>

      {/* ── inspector ─────────────────────────────────────────────────────── */}
      <aside className="sv-inspector" aria-label="Inspector">
        {showing === "legacy" || state === undefined ? (
          <p className="sv-empty">The legacy screens carry their own detail.</p>
        ) : state.screen === "run" ? (
          <RunInspector
            state={state as RunState}
            params={params}
            actions={actions}
            onAction={(id) => void runAction(id)}
            onParams={setParams}
            {...(evidence === undefined ? {} : { evidence })}
          />
        ) : (
          <FlowsInspector state={state as FlowsState} onAction={(id) => void runAction(id)} />
        )}
      </aside>

      {/* ── status bar ────────────────────────────────────────────────────── */}
      <footer className="sv-statusbar">
        <span id="status-context">{message ?? state?.status ?? ""}</span>
        <span className="sv-spacer" />
        <span>
          <Kbd>⌘K</Kbd> commands
        </span>
        <span>
          <Kbd>?</Kbd> keys
        </span>
      </footer>

      <CommandPalette
        open={paletteOpen}
        rows={paletteRows}
        onClose={() => setPaletteOpen(false)}
        onChoose={goTo}
      />
    </div>
  );
}
