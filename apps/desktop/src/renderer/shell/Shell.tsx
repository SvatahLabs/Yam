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
import { Alert, AskOverlay, Button, CommandPalette, Kbd, RailItem, type PaletteRow } from "@svatah/yam-ui";
import {
  applyHealEvent,
  applyRecordEvent,
  SCREEN_IDS,
  type AgentsState,
  type ApiState,
  type BindingsState,
  type DataState,
  type FlowsState,
  type HealState,
  type ImportState,
  type RunState,
  type RunsState,
  type SettingsState,
  type SessionState,
  type SurfaceView,
} from "@svatah/yam-screens";
import { acceleratorFor, keysFor as appKeysFor } from "./keys.js";
import { SessionInspector, SessionScreen } from "./Session.js";
import { SurfacesScreen, SurfacesInspector } from "./Surfaces.js";
import type { ServiceClient } from "../client.js";
import { a11yVariant } from "../a11y-variant.js";
import { bridge } from "../bridge.js";
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
  /** Whether that directory is the private surfaces workspace, not a project. */
  readonly projectless?: boolean;
  readonly serviceUrl: string;
  /**
   * Open a project (T17).
   *
   * Surfaces needs none — the app starts projectless and connects to things.
   * Automations and Activity are *about* a project: its flows, its bindings,
   * its runs and the proposals a promotion writes. So the project is chosen
   * here rather than being the frame the whole application lives in.
   */
  readonly onOpenProject?: (directory: string) => void | Promise<void>;
}

type Showing = ScreenId;

export function Shell(props: ShellProps): React.JSX.Element {
  // Surfaces opens by default (SF-02, SF-16, T14): the app's first screen is
  // "connect to something", not a project's flows.
  const [showing, setShowing] = useState<Showing>("session");
  const [params, setParams] = useState<ScreenParams>({});
  const [state, setState] = useState<ScreenStateBase | undefined>(undefined);
  const [tab, setTab] = useState<"editor" | "plan" | "history">("editor");
  const [paletteOpen, setPaletteOpen] = useState(false);
  /** An action waiting on something it declared it `needs` (TV-06). */
  const [asking, setAsking] = useState<
    { action: string; field: string; label: string; placeholder?: string } | undefined
  >(undefined);
  const [message, setMessage] = useState<string | undefined>(undefined);
  /**
   * What the last action answered (T15).
   *
   * The status bar shows an action's *sentence*; a screen often has to show its
   * *result* — Surfaces draws dispatch and verification separately, and neither
   * is re-readable afterwards because a mutation's outcome is not a route. So
   * the shell keeps the last outcome and hands it to the screen, which turns it
   * into a view with a function from the model.
   *
   * This is the thing whose absence left `apiResponseView` exported and unused:
   * a shape the model knew and nothing could feed.
   */
  const [lastOutcome, setLastOutcome] = useState<
    { readonly id: string; readonly ok: boolean; readonly value: unknown } | undefined
  >(undefined);
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
  const showingRef = useRef<Showing>("session");
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
        /*
         * A capture's sentences arrive while Session is showing them, and the
         * half they belong to is `record` (REQ-ADE-14). Folding into the whole
         * state would put a sentence where the snapshot lives.
         */
        if (before.screen === "session") {
          const session = before as SessionState;
          return { ...session, record: applyRecordEvent(session.record, event) };
        }
        if (before.screen === "heal") return applyHealEvent(before as HealState, event);
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
      /*
       * What the action said it needs, asked for before it runs (TV-06).
       *
       * The same declaration the cockpit opens a line for. `surface.connect`
       * refused with "Enter a URL to connect to" in both renderers and neither
       * had a field for one; the action names it now, and neither view invents
       * the other's half.
       */
      const given = { ...(params as Record<string, unknown>), ...extra };
      const has = (name: string): boolean =>
        given[name] !== undefined && String(given[name]).trim() !== "";
      const missing = (action.needs ?? []).find(
        (one) => !has(one.name) && !(one.satisfiedBy ?? []).some(has),
      );
      if (missing !== undefined) {
        setAsking({ action: id, field: missing.name, label: missing.label, ...(missing.placeholder === undefined ? {} : { placeholder: missing.placeholder }) });
        return;
      }
      setAsking(undefined);
      try {
        /*
         * The screen's own argument, over the parameters (K6, K7).
         *
         * `flows.save` needs the text in the editor; `api.save` needs the
         * request in the form. Neither is a screen parameter — a parameter is
         * what a screen re-loads with — so the screen passes it here and every
         * other action is unaffected.
         */
        const outcome = await action.run(props.client, {
          ...params,
          ...extra,
          // Whether the service is on the app's private workspace rather than
          // a project (T14, T17): an action that writes into a project needs
          // to know, and the main process is the one that knows.
          projectless: props.projectless === true,
        });
        setMessage(outcome.message);
        setLastOutcome({ id, ok: outcome.ok, value: outcome.value });
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

  /*
   * Focus returns somewhere predictable when the control it was on goes away
   * (SF-18). Disconnect closes the session and the action that closed it is
   * no longer offered, so the button under the keyboard is removed and focus
   * fell to the document — the next Tab started over from the top of the
   * window. After every render that leaves nothing focused, the screen's own
   * title takes it: the start of the screen, one Tab from its first control.
   */
  useEffect(() => {
    if (typeof document === "undefined") return;
    const active = document.activeElement;
    if (active === null || active === document.body) {
      document.getElementById("toolbar-title")?.focus();
    }
  }, [state]);

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
        /*
         * The first *available* primary, not the first declared one (T15).
         *
         * A screen can offer two primaries for two moods of the same subject —
         * Surfaces has `surface.act` for an element surface and
         * `surface.request` for an HTTP one — and only one of them is available
         * at a time. Taking the first declared would press the one that is
         * greyed out, which is the dead end this task removes.
         */
        const primary = actionsForScreen(screen).find(
          (one) => acceleratorFor(one.id) === "⌘↵" && one.availableWhen(state),
        );
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
      const binding = appKeysFor(screen).find(
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

  /*
   * The appearance is the document root's (TV-18, TV-A06), set by `useThemeRoot`
   * in `App` — not this component's `<div>`, which is where it was and which
   * left every screen rendered outside Shell unthemed.
   */

  /* ── the palette's rows: the registry, filtered by this state ──────────── */

  const paletteRows = useMemo<PaletteRow[]>(
    () =>
      ACTIONS.map((action: Action) => ({
        id: action.id,
        label: action.label,
        group: action.group,
        area: action.id.split(".")[0]!,
        ...(acceleratorFor(action.id) === undefined ? {} : { key: acceleratorFor(action.id)! }),
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

  /*
   * The project's name, or nothing when the app is on its private surfaces
   * workspace — which is not a project and must not read like one (T14, T17).
   * The main process says which it is; the renderer does not sniff the path.
   */
  /*
   * The recent projects, read once. `preferences()` is the same store the
   * welcome screen read; nothing new is remembered.
   */
  const [recents, setRecents] = useState<readonly string[]>([]);
  useEffect(() => {
    void bridge()
      .preferences()
      .then((one) => setRecents(one.recentProjects ?? []))
      .catch(() => undefined);
  }, []);

  const projectLabel =
    props.projectless === true || props.project === ""
      ? undefined
      : (props.project.split(/[\\/]/).filter(Boolean).pop() ?? props.project);

  /**
   * The twelve screens, by id (T10.1, T10.2).
   *
   * One table rather than a chain of ternaries: a screen added later is one
   * entry, and `apps/desktop/test/screen-rule.test.ts` can read it to assert that
   * every id in `SCREEN_IDS` has a body. Each is handed the same five props,
   * because a screen that needed a sixth would be a screen the shell knows
   * something about.
   */
  /** Whether a screen is about a project rather than a surface (T17). */
  const needsProject = (screen: string): boolean => {
    const section = sectionOf(screen as Parameters<typeof sectionOf>[0]);
    return section === "automations" || section === "activity";
  };

  function screenBody(): React.ReactNode {
    if (state === undefined) return null;
    const shared = {
      params,
      actions,
      onAction: (id: string, args?: Readonly<Record<string, unknown>>) =>
        void runAction(id, args),
      onParams: setParams,
      ...(lastOutcome === undefined ? {} : { lastOutcome }),
    } as const;
    const evidenceProp = evidence === undefined ? {} : { evidence };

    /*
     * Automations and Activity are about a project (T17). With none open they
     * would show the app's private workspace: an empty Flows list whose
     * "New flow" writes into a directory nobody chose. Say what is needed
     * instead, and where to get it. Surfaces and Settings need no project.
     */
    if (props.projectless === true && needsProject(state.screen)) {
      return (
        <div className="sv-editor" id="project-needed" aria-label="A project is needed">
          <p className="sv-empty">
            {SECTIONS.find((one) => one.id === sectionOf(state.screen))?.label ?? "This section"} is
            about a project — its flows, bindings, runs and proposals — and none is open. Choose one
            with <b>Open a project</b> in the top bar. Surfaces needs no project.
          </p>
        </div>
      );
    }

    switch (state.screen) {
      case "session":
        return <SessionScreen state={state as SessionState} {...shared} />;
      case "run":
        return <RunScreen state={state as RunState} {...shared} {...evidenceProp} />;
      case "runs":
        return <RunsScreen state={state as RunsState} {...shared} {...evidenceProp} />;
      case "bindings":
        return <BindingsScreen state={state as BindingsState} {...shared} />;
      case "heal":
        return <HealScreen state={state as HealState} {...shared} />;
      case "agents":
        return <AgentsScreen state={state as AgentsState} {...shared} />;
      case "api":
        return <ApiScreen state={state as ApiState} {...shared} />;
      case "data":
        return <DataScreen state={state as DataState} {...shared} />;
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
    // A project screen with no project has nothing to inspect (T17).
    if (props.projectless === true && needsProject(state.screen)) return null;
    const shared = {
      params,
      actions,
      onAction: (id: string, args?: Readonly<Record<string, unknown>>) =>
        void runAction(id, args),
      onParams: setParams,
      ...(lastOutcome === undefined ? {} : { lastOutcome }),
    } as const;
    const evidenceProp = evidence === undefined ? {} : { evidence };

    switch (state.screen) {
      case "session":
        return <SessionInspector state={state as SessionState} {...shared} />;
      case "run":
        return <RunInspector state={state as RunState} {...shared} {...evidenceProp} />;
      case "runs":
        return <RunsInspector state={state as RunsState} {...shared} {...evidenceProp} />;
      case "bindings":
        return <BindingsInspector state={state as BindingsState} {...shared} />;
      case "heal":
        return <HealInspector state={state as HealState} {...shared} />;
      case "agents":
        return <AgentsInspector state={state as AgentsState} {...shared} />;
      case "api":
        return <ApiInspector state={state as ApiState} {...shared} />;
      case "data":
        return <DataInspector state={state as DataState} {...shared} />;
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
    <div className="sv-app">
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
            {SECTIONS.find((one) => one.id === sectionOf(showing))?.label ?? "Session"}
          </b>
          <span className="sv-crumb-sep" aria-hidden="true">
            /
          </span>
          <span id="crumb-screen">{state?.title ?? ""}</span>
        </nav>
        <span className="sv-spacer" />
        {/*
          The project, where Automations and Activity need one (T17). Surfaces
          works without it, so this says what is open rather than gating the app.
        */}
        <Button
          id="open-project"
          label={projectLabel === undefined ? "Open a project" : `Project: ${projectLabel}`}
          variant="ghost"
          title="Choose the project whose flows, bindings and runs Automations and Activity show"
          onPress={() => {
            void (async () => {
              const chosen = await bridge().pickFile("directory");
              if (chosen !== null) await props.onOpenProject?.(chosen);
            })();
          }}
        />
        {/*
          The projects you had open, while none is (T20).

          Making Surfaces the landing screen retired the welcome screen, and the
          list of recent projects went with it — so the *only* way to open one
          became a native directory dialog. That is a worse experience for
          anyone with two projects, and it took something else with it: a native
          file dialog is not part of the application, so `evals/self`'s flows
          could no longer open a project **through the app**, and Yam's
          verification of its own project screens collapsed from thirty checks
          to twelve. The parity gate said so the first time it was re-run.

          So the recents come back, where a project is chosen: beside the
          button, while nothing is open, and gone once something is. The ids are
          the ones the bindings store already knows.
        */}
        {props.projectless === true
          ? recents.slice(0, 3).map((directory, at) => (
              <Button
                key={directory}
                id={`project-recent-${at}`}
                label={directory.split("/").filter(Boolean).pop() ?? directory}
                variant="ghost"
                title={directory}
                onPress={() => void props.onOpenProject?.(directory)}
              />
            ))
          : null}
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
              /*
               * The section says it is a section (P-W2-F4).
               *
               * Session is a section *and* the screen under it, so the rail
               * carried two buttons both called "Session" — `yam surface
               * snapshot` of the app's own tree shows them adjacent:
               * `button "Session" [e27], button "Session" [e28]`. Two controls
               * with one name is a control a flow sentence cannot address and a
               * screen reader cannot distinguish, and it is the kind of defect
               * only something reading the accessibility tree can see: the
               * suite that checks names here looks for *missing* ones.
               */
              aria-label={`${section.label} section`}
              onClick={() => {
                setParams({});
                setLastOutcome(undefined);
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
                  setLastOutcome(undefined);
                  setShowing(one);
                }}
              />
            ))}
          </div>
        ))}
      </nav>

      {/* ── workspace ─────────────────────────────────────────────────────── */}
      {/*
        * `main`, not `section` (SF-18).
        *
        * Every window needs one main landmark, and the workspace is it: a
        * screen-reader user's "skip to the content" lands here. It was a
        * generic section with a label, which is a region and not the main one.
        * Found by the accessibility oracle over the packaged window in T18.
        */}
      <main className="sv-workspace" id="workspace" aria-label="Workspace">
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
      </main>

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

      {asking === undefined ? null : (
        <AskOverlay
          id="sv-ask"
          label={asking.label}
          {...(asking.placeholder === undefined ? {} : { placeholder: asking.placeholder })}
          onCancel={() => setAsking(undefined)}
          onSubmit={(value) => {
            const pending = asking;
            setAsking(undefined);
            void runAction(pending.action, { [pending.field]: value });
          }}
        />
      )}

      <CommandPalette
        open={paletteOpen}
        rows={paletteRows}
        onClose={() => setPaletteOpen(false)}
        onChoose={goTo}
      />
    </div>
  );
}
