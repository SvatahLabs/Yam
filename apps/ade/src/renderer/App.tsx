/**
 * The ADE's shell: pick a project, then one of seven screens (T3.6, T3.7).
 *
 * ## Every interactive control has a role and an accessible name
 *
 * REQ-ADE-6 and ADR-17: the ADE is the desktop conformance target for the UIA
 * and AX adapters, and a Svatah flow against it has to be able to say "the
 * Compile button" and mean something. So every control here is a real `button`,
 * `tab`, `textbox` or `link` with a name a person would use — no clickable divs,
 * no icon-only controls without a label. That is also, and not by coincidence,
 * what makes it usable with a screen reader.
 */
import { useCallback, useEffect, useState } from "react";
import { bridge, type ServiceInfo } from "./bridge.js";
import { ServiceClient } from "./client.js";
import { ProjectScreen } from "./screens/Project.js";
import { FlowEditorScreen } from "./screens/FlowEditor.js";
import { PlanScreen } from "./screens/Plan.js";
import { RunScreen } from "./screens/Run.js";
import { ResultsScreen } from "./screens/Results.js";
import { ApiClientScreen } from "./screens/ApiClient.js";
import { DataScreen } from "./screens/Data.js";

const SCREENS = [
  { id: "project", label: "Project" },
  { id: "flows", label: "Flow editor" },
  { id: "plan", label: "Plan" },
  { id: "run", label: "Run" },
  { id: "results", label: "Results" },
  { id: "api", label: "API client" },
  { id: "data", label: "Data" },
] as const;

type ScreenId = (typeof SCREENS)[number]["id"];

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
    return bridge().onServiceLog((line) => setLog((lines) => [...lines.slice(-40), line]));
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

  return (
    <div className="app">
      <header className="app-header">
        <h1>Svatah ADE</h1>
        {info === null ? (
          <p className="muted">No project open.</p>
        ) : (
          <p className="muted">
            <span aria-label="Open project">{info.project}</span>
            {" · "}
            <span aria-label="Service URL">{info.url}</span>
            {info.adopted ? " · adopted a running service" : ""}
          </p>
        )}
      </header>

      {info !== null && client !== undefined ? (
        <nav aria-label="Screens" className="tabs" role="tablist">
          {SCREENS.map((one) => (
            <button
              key={one.id}
              type="button"
              role="tab"
              aria-selected={screen === one.id}
              className={screen === one.id ? "tab tab-current" : "tab"}
              onClick={() => setScreen(one.id)}
            >
              {one.label}
            </button>
          ))}
        </nav>
      ) : null}

      {error !== undefined ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      <main className="app-main">
        {info === null || client === undefined ? (
          <ProjectScreen client={undefined} onOpen={open} log={log} />
        ) : screen === "project" ? (
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
        ) : (
          <DataScreen client={client} />
        )}
      </main>
    </div>
  );
}
