/**
 * The app's shell (T9.4, T10.1, T10.2, T10.3, REQ-ADE-11, REQ-ADE-12,
 * LLD §13.7; the `Main`, `Run` and `Palette` artboards).
 *
 * > Top bar: project crumb, command palette field, environment and service
 * > chips. Left rail: Flows, Runs, Bindings, Agents and tools; Resources: API,
 * > Data; bottom: Import prototype database, Settings. Centre: the selected
 * > screen […] Right: a contextual inspector […] Status bar: context on the
 * > left, keys on the right.
 *
 * All twelve screens of LLD §13.7 render here (T10.1, T10.2). Phase 9 had two
 * and put the other ten behind a **Legacy** rail item; T10.3 deleted them, so
 * this is now the whole application and there is nowhere else for a screen to
 * be.
 *
 * ## What this file may and may not do
 *
 * It may lay out a page, hold which screen is showing, and turn a key into an
 * action id. It may not decide what a number means: every value comes from a
 * `ScreenState` the model loaded, and every action is an `Action` from the one
 * registry. A shell that formatted a duration would be a shell that formats it
 * differently from `yam ui`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ACTIONS,
  SECTIONS,
  sectionOf,
  defaultScreenOf,
  actionById,
  actionsForScreen,
  applyEvent,
  screenById,
  type Action,
  type ScreenId,
  type ScreenParams,
  type ScreenStateBase,
} from "@svatah/yam-screens";
import { Alert, Button, CommandPalette, Kbd, RailItem, type PaletteRow } from "@svatah/yam-ui";
import {
  applyExplorerEvent,
  applyHealEvent,
  applyRecordEvent,
  SCREEN_IDS,
  type AgentsState,
  type ApiState,
  type BindingsState,
  type DataState,
  type ExplorerState,
  type FlowsState,
  type HealState,
  type ImportState,
  type RecordState,
  type RunState,
  type RunsState,
  type SettingsState,
  type SurfacesState,
} from "@svatah/yam-screens";
import { SurfacesScreen, SurfacesInspector } from "./Surfaces.js";
import type { ServiceClient } from "../client.js";
import { a11yVariant } from "../a11y-variant.js";
import { FlowsInspector, FlowsScreen } from "./Flows.js";
import { RunInspector, RunScreen } from "./Run.js";
import { RunsInspector, RunsScreen } from "./Runs.js";
import { BindingsInspector, BindingsScreen } from "./Bindings.js";
import { HealInspector, HealScreen } from "./Heal.js";
import { RecordInspector, RecordScreen } from "./Record.js";
import {
  AgentsInspector,
  AgentsScreen,
  ApiInspector,
  ApiScreen,
  DataInspector,
  DataScreen,
  ExplorerInspector,
  ExplorerScreen,
  ImportInspector,
  ImportScreen,
  SettingsInspector,
  SettingsScreen,
} from "./Secondary.js";

/**
 * Every screen renders (T10.1, T10.2, T10.3).
 *
 * Phase 9 rendered two and sent the rest to a Legacy rail item; the list is kept
 * as a *constant* rather than deleted because `apps/desktop/test/screen-rule.test.ts`
 * and the desktop cases read it, and because "every screen id has a renderer" is
 * a claim worth being able to make in one line.
 */
export const RENDERED: readonly ScreenId[] = SCREEN_IDS;

export interface ShellProps {
  readonly client: ServiceClient;
  readonly project: string;
  readonly serviceUrl: string;
}

type Showing = ScreenId;

export function Shell(props: ShellProps): React.JSX.Element {
  // Surfaces opens by default (SF-02, SF-16, T14): the app's first screen is
  // "connect to something", not a project's flows.
  const [showing, setShowing] = useState<Showing>("surfaces");
  const [params, setParams] = useState<ScreenParams>({});
  const [state, setState] = useState<ScreenStateBase | undefined>(undefined);
  const [tab, setTab] = useState<"editor" | "plan" | "history">("editor");
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [message, setMessage] = useState<string | undefined>(undefined);
  const [evidence, setEvidence] = useState<string | undefined>(undefined);
  const latest = useRef(0);

  const screen: ScreenId = showing;

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

  /*
   * Which screen is showing, for the subscription (T10.1).
   *
   * A ref and not the state, for the same reason `paramsRef` is one: the
   * subscription is set up once and must not be torn down on every navigation.
   */
  const showingRef = useRef<Showing>("surfaces");
  useEffect(() => {
    showingRef.current = showing;
  }, [showing]);

  useEffect(() => {
    return props.client.subscribe((event) => {
      /*
       * One subscription, four screens (T10.1). Which fold applies is the
       * *state's* screen and not the event's kind: an event for a screen nobody
       * is looking at is dropped, and a screen that is showing folds every event
       * it understands. The model decides what each means — a renderer that had
       * built a decision itself would be a renderer that could disagree with
       * `yam ui` about what the recorder chose.
       */
      setState((before) => {
        if (before === undefined) return before;
        if (before.screen === "run") return applyEvent(before as RunState, event);
        if (before.screen === "record") return applyRecordEvent(before as RecordState, event);
        if (before.screen === "heal") return applyHealEvent(before as HealState, event);
        if (before.screen === "explorer") return applyExplorerEvent(before as ExplorerState, event);
        return before;
      });
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
      /*
       * …but only while the Run screen is the one showing.
       *
       * A run that finishes after someone has walked away used to pull them
       * back: `load("run", …)` replaced the state whatever screen was on it, so
       * the rail said Bindings and the workspace drew a run. Phase 9 had two
       * screens and nowhere to walk to; with twelve it is the first thing a
       * second click finds.
       */
      if (
        showingRef.current === "run" &&
        (event.kind === "run.summary" || event.kind === "run.failed")
      ) {
        const runId = typeof event["runId"] === "string" ? event["runId"] : undefined;
        const next = runId === undefined ? paramsRef.current : { ...paramsRef.current, runId };
        if (runId !== undefined) setParams(next);
        void load("run", next);
      }
    });
  }, [load, props.client]);

  /* ── the failing step's screenshot ─────────────────────────────────────── */

  useEffect(() => {
    /*
     * Two screens show a failing step's picture: the Run screen's inspector and
     * the Runs screen's (T10.1). Same fetch, same object URL, revoked the same
     * way — a second copy of this effect on the other screen would be a second
     * place to forget `revokeObjectURL`.
     */
    const evidenceOf = ():
      | { runId: string; screenshot: string }
      | undefined => {
      if (state?.screen === "run") {
        const run = state as RunState;
        return run.runId === undefined || run.inspector?.screenshot === undefined
          ? undefined
          : { runId: run.runId, screenshot: run.inspector.screenshot };
      }
      if (state?.screen === "runs") {
        const runs = state as RunsState;
        return runs.inspector?.failure?.screenshot === undefined
          ? undefined
          : { runId: runs.inspector.runId, screenshot: runs.inspector.failure.screenshot };
      }
      return undefined;
    };
    const run = evidenceOf();
    const shot = run?.screenshot;
    if (run === undefined || shot === undefined) {
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
    async (id: string, extra: Readonly<Record<string, unknown>> = {}): Promise<void> => {
      const action = actionById(id);
      if (action === undefined || state === undefined) return;
      setPaletteOpen(false);
      try {
        /*
         * The screen's own argument, over the parameters (K6, K7).
         *
         * `flows.save` needs the text in the editor; `api.save` needs the
         * request in the form. Neither is a screen parameter — a parameter is
         * what a screen re-loads with — so the screen passes it here and every
         * other action is unaffected.
         */
        const outcome = await action.run(props.client, { ...params, ...extra });
        setMessage(outcome.message);
        const goTo = outcome.goTo;
        if (goTo !== undefined) {
          setParams({ ...params, ...outcome.params });
          setShowing(goTo);
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
        setParams({});
        setShowing(action.screen);
        return;
      }
      void runAction(id);
    },
    [runAction],
  );

  const actions = actionsForScreen(screen);

  /**
   * The twelve screens, by id (T10.1, T10.2).
   *
   * One table rather than a chain of ternaries: a screen added later is one
   * entry, and `apps/desktop/test/screen-rule.test.ts` can read it to assert that
   * every id in `SCREEN_IDS` has a body. Each is handed the same five props,
   * because a screen that needed a sixth would be a screen the shell knows
   * something about.
   */
  function screenBody(): React.ReactNode {
    if (state === undefined) return null;
    const shared = {
      params,
      actions,
      onAction: (id: string, args?: Readonly<Record<string, unknown>>) =>
        void runAction(id, args),
      onParams: setParams,
    } as const;
    const evidenceProp = evidence === undefined ? {} : { evidence };

    switch (state.screen) {
      case "surfaces":
        return <SurfacesScreen state={state as SurfacesState} {...shared} />;
      case "run":
        return <RunScreen state={state as RunState} {...shared} {...evidenceProp} />;
      case "runs":
        return <RunsScreen state={state as RunsState} {...shared} {...evidenceProp} />;
      case "bindings":
        return <BindingsScreen state={state as BindingsState} {...shared} />;
      case "record":
        return <RecordScreen state={state as RecordState} {...shared} />;
      case "heal":
        return <HealScreen state={state as HealState} {...shared} />;
      case "agents":
        return <AgentsScreen state={state as AgentsState} {...shared} />;
      case "api":
        return <ApiScreen state={state as ApiState} {...shared} />;
      case "data":
        return <DataScreen state={state as DataState} {...shared} />;
      case "explorer":
        return <ExplorerScreen state={state as ExplorerState} {...shared} />;
      case "import":
        return <ImportScreen state={state as ImportState} {...shared} />;
      case "settings":
        return <SettingsScreen state={state as SettingsState} {...shared} />;
      default:
        return (
          <FlowsScreen state={state as FlowsState} {...shared} tab={tab} onTab={setTab} />
        );
    }
  }

  /** The right inspector, per screen. Same table, same rule. */
  function inspectorBody(): React.ReactNode {
    if (state === undefined) return null;
    const shared = {
      params,
      actions,
      onAction: (id: string, args?: Readonly<Record<string, unknown>>) =>
        void runAction(id, args),
      onParams: setParams,
    } as const;
    const evidenceProp = evidence === undefined ? {} : { evidence };

    switch (state.screen) {
      case "surfaces":
        return <SurfacesInspector state={state as SurfacesState} {...shared} />;
      case "run":
        return <RunInspector state={state as RunState} {...shared} {...evidenceProp} />;
      case "runs":
        return <RunsInspector state={state as RunsState} {...shared} {...evidenceProp} />;
      case "bindings":
        return <BindingsInspector state={state as BindingsState} {...shared} />;
      case "record":
        return <RecordInspector state={state as RecordState} {...shared} />;
      case "heal":
        return <HealInspector state={state as HealState} {...shared} />;
      case "agents":
        return <AgentsInspector state={state as AgentsState} {...shared} />;
      case "api":
        return <ApiInspector state={state as ApiState} {...shared} />;
      case "data":
        return <DataInspector state={state as DataState} {...shared} />;
      case "explorer":
        return <ExplorerInspector state={state as ExplorerState} {...shared} />;
      case "import":
        return <ImportInspector state={state as ImportState} {...shared} />;
      case "settings":
        return <SettingsInspector state={state as SettingsState} {...shared} />;
      default:
        return (
          <FlowsInspector state={state as FlowsState} onAction={(id) => void runAction(id)} />
        );
    }
  }

  return (
    <div className="sv-app sv-root">
      {/* ── top bar ───────────────────────────────────────────────────────── */}
      <header className="sv-topbar">
        <span className="sv-brand">
          <span className="sv-brand-mark" aria-hidden="true" />
          Yam
        </span>
        <nav className="sv-crumb" id="topbar-crumb" aria-label="Location">
          {/*
            Section then screen, surface-first (T14): "Surfaces", "Automations ·
            Flows". The project is no longer the top crumb — it is one thing
            Automations and Settings show, not the frame the whole app lives in.
            The separators are decoration and are hidden from the tree (T10.3).
          */}
          <span className="sv-crumb-sep" aria-hidden="true">
            /
          </span>
          <b id="crumb-section">
            {SECTIONS.find((one) => one.id === sectionOf(showing))?.label ?? "Surfaces"}
          </b>
          <span className="sv-crumb-sep" aria-hidden="true">
            /
          </span>
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
      {/*
        Primary navigation, surface-first (T14, SF-02, SF-16): Surfaces,
        Automations, Activity, Settings, each a section header that goes to the
        section's default screen, with the section's own screens beneath it. The
        old Project/Resources/Bottom grouping (Draft 2.11) is gone; the screens
        are the same, only regrouped and reached from here.
      */}
      <nav className="sv-rail" id="rail" aria-label="Sections">
        {SECTIONS.map((section) => (
          <div
            key={section.id}
            className={section.id === "settings" ? "sv-rail-group sv-rail-bottom" : "sv-rail-group"}
          >
            <button
              id={`section-${section.id}`}
              type="button"
              className={
                sectionOf(showing) === section.id
                  ? "sv-rail-heading sv-rail-section sv-rail-section-active"
                  : "sv-rail-heading sv-rail-section"
              }
              {...(sectionOf(showing) === section.id ? { "aria-current": "page" as const } : {})}
              onClick={() => {
                setParams({});
                setShowing(defaultScreenOf(section.id));
              }}
            >
              {section.label}
            </button>
            {section.rail.map((one) => (
              <RailItem
                key={one}
                id={`rail-${one}`}
                /*
                 * Variant 1 renames one rail item and nothing else (Draft 2.8
                 * §16, T7.1): the id, the position and the neighbours stay, so a
                 * binding that matched on the *name* stops matching and
                 * relocalization has everything except the thing it matched on.
                 */
                label={a11yVariant() === 1 && one === "flows" ? "Editor" : screenById(one).title}
                active={showing === one}
                onPress={() => {
                  // A rail click is a fresh screen, not the last one's selection.
                  setParams({});
                  setShowing(one);
                }}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* ── workspace ─────────────────────────────────────────────────────── */}
      <section className="sv-workspace" id="workspace" aria-label="Workspace">
        {state === undefined ? (
          <p className="sv-empty">Loading…</p>
        ) : state.error !== undefined ? (
          <Alert id="screen-error" tone="fail">
            {state.error} The service is at{" "}
            <span className="sv-mono">{props.serviceUrl}</span>; `yam serve --project{" "}
            {props.project}` starts one by hand.
          </Alert>
        ) : (
          screenBody()
        )}
      </section>

      {/* ── inspector ─────────────────────────────────────────────────────── */}
      <aside className="sv-inspector" id="inspector" aria-label="Inspector">
        {state === undefined ? <p className="sv-empty">Loading…</p> : inspectorBody()}
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
