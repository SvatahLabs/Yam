/**
 * The ADE (T3.6, T3.7, T9.4, REQ-ADE-2, REQ-ADE-11, LLD §13.6, §13.7).
 *
 * Two things live here: opening a project, and choosing between the rebuilt
 * shell and the eleven screens it has not replaced yet.
 *
 * ## What Phase 9 rebuilt, and what it did not
 *
 * `Shell` is the redesign: top bar, rail, workspace, inspector, status bar and
 * a command palette on `@svatah/ui`, rendering the `flows` and `run` screens
 * from `@svatah/screens`. The other ten screens are still the Phase 3–5 tabs,
 * reachable behind a **Legacy** rail item until Phase 10 replaces them (T9.4's
 * scope, stated as a rail item so nobody has to remember it).
 *
 * ## Every interactive control has a name and an id
 *
 * REQ-ADE-6 and LLD §13.7: the ADE is the desktop conformance target, and a
 * Svatah flow against it has to be able to say "the Run button" and mean
 * something. In the rebuilt screens that is enforced by `@svatah/ui`, whose
 * components throw in development without a visible label and an id in the
 * `automationId` form; in the legacy screens it is the convention Phase 3 set,
 * and the desktop suite's snapshot case is what checks it (P8-F3).
 */
import { useCallback, useEffect, useState } from "react";
import { a11yVariant } from "./a11y-variant.js";
import { bridge, type ServiceInfo } from "./bridge.js";
import { ServiceClient } from "./client.js";
import { Shell } from "./shell/Shell.js";
import { ProjectScreen } from "./screens/Project.js";
import { FlowEditorScreen } from "./screens/FlowEditor.js";
import { PlanScreen } from "./screens/Plan.js";
import { RunScreen } from "./screens/Run.js";
import { ResultsScreen } from "./screens/Results.js";
import { ApiClientScreen } from "./screens/ApiClient.js";
import { DataScreen } from "./screens/Data.js";
import { RecordScreen } from "./screens/Record.js";
import { BindingsScreen } from "./screens/Bindings.js";
import { ExplorerScreen } from "./screens/Explorer.js";
import { ToolsScreen } from "./screens/Tools.js";

const SCREENS = [
  { id: "project", label: "Project" },
  { id: "flows", label: "Flow editor" },
  { id: "plan", label: "Plan" },
  { id: "run", label: "Run" },
  { id: "results", label: "Results" },
  { id: "api", label: "API client" },
  { id: "data", label: "Data" },
  // T5.7: review what the model decided, before it is written.
  { id: "record", label: "Record review" },
  { id: "bindings", label: "Bindings" },
  // T5.8: the agent workbench (REQ-ADE-8).
  { id: "explorer", label: "Surface explorer" },
  { id: "tools", label: "Tool panel" },
] as const;

type ScreenId = (typeof SCREENS)[number]["id"];

/**
 * The tab this window shows for a screen (LLD §16's variant 1).
 *
 * One tab, renamed and nothing else: a binding that matched `tab "Flow editor"`
 * stops matching, while the tab keeps its id, its position and its neighbours,
 * so relocalization has everything except the thing it matched on. Renaming two
 * would make it a different test.
 */
function tabLabel(id: ScreenId, label: string): string {
  return a11yVariant() === 1 && id === "flows" ? "Editor" : label;
}

export function App(): React.JSX.Element {
  const [info, setInfo] = useState<ServiceInfo | null>(null);
  const [screen, setScreen] = useState<ScreenId>("project");
  const [error, setError] = useState<string | undefined>(undefined);
  const [log, setLog] = useState<readonly string[]>([]);

  useEffect(() => {
    void bridge()
      .serviceInfo()
      .then(setInfo)
      .catch(() => undefined);
    const offLog = bridge().onServiceLog((line) => setLog((lines) => [...lines.slice(-40), line]));
    /*
     * A project the main process opened from `SVATAH_ADE_PROJECT` (T8.1).
     *
     * The same two outcomes the Recent list has — the window opens on the Flows
     * screen, or the alert does — for a launch nobody clicked. §13.6: "the
     * desktop conformance gate passes the fixtures project this way, so its
     * cases read a project screen rather than the welcome screen."
     */
    const offOpened = bridge().onServiceOpened((event) => {
      if (event.connection !== undefined) {
        setInfo(event.connection);
        setScreen("project");
        setError(undefined);
        return;
      }
      setError(event.error ?? "The project could not be opened.");
    });
    return () => {
      offLog();
      offOpened();
    };
  }, []);

  const open = useCallback(async (directory: string) => {
    setError(undefined);
    try {
      setInfo(await bridge().openProject(directory));
      setScreen("project");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  const client = info === null ? undefined : new ServiceClient(info);

  /*
   * No project: the welcome screen, which is the Project screen with nothing to
   * show. It is *not* the shell — a rail over an empty window would be eleven
   * rows that all say "open a project first".
   */
  if (info === null || client === undefined) {
    return (
      <div className="app">
        <header className="app-header">
          <h1>Svatah ADE</h1>
          <p className="muted">No project open.</p>
        </header>
        {error === undefined ? null : (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <main className="app-main">
          <ProjectScreen client={undefined} onOpen={open} log={log} />
        </main>
      </div>
    );
  }

  return (
    <Shell
      client={client}
      project={info.project}
      serviceUrl={info.url}
      legacy={
        <div className="app sv-legacy">
          {error === undefined ? null : (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <nav aria-label="Screens" className="tabs" role="tablist">
            {SCREENS.map((one) => (
              <button
                key={one.id}
                id={`screen-${one.id}`}
                type="button"
                role="tab"
                aria-selected={screen === one.id}
                className={screen === one.id ? "tab tab-current" : "tab"}
                onClick={() => setScreen(one.id)}
              >
                {tabLabel(one.id, one.label)}
              </button>
            ))}
          </nav>

          <main className="app-main">
            {screen === "project" ? (
              <ProjectScreen client={client} onOpen={open} log={log} />
            ) : screen === "flows" ? (
              <FlowEditorScreen client={client} />
            ) : screen === "plan" ? (
              <PlanScreen client={client} />
            ) : screen === "run" ? (
              <RunScreen client={client} />
            ) : screen === "results" ? (
              <ResultsScreen client={client} />
            ) : screen === "api" ? (
              <ApiClientScreen client={client} />
            ) : screen === "data" ? (
              <DataScreen client={client} />
            ) : screen === "record" ? (
              <RecordScreen client={client} />
            ) : screen === "bindings" ? (
              <BindingsScreen client={client} />
            ) : screen === "explorer" ? (
              <ExplorerScreen client={client} />
            ) : (
              <ToolsScreen client={client} />
            )}
          </main>
        </div>
      }
    />
  );
}
