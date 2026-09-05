/**
 * The Project screen (T3.7, REQ-ADE-3, LLD §13.6: "Project (`GET /project`)").
 *
 * Open a directory, then look at what `GET /project` says is in it: the config,
 * the flows, the stories with their signatures, the compositions, the run blocks,
 * the named API requests, the custom steps, and any diagnostics the load
 * produced.
 *
 * Everything on it is one response. That is the screen rule (T3.7) at its
 * simplest, and the reason this screen has no logic worth speaking of: a project
 * summary the ADE assembled from several calls would be a summary only the ADE
 * has, and `svatah lint --json` could not be compared with it.
 */
import { useEffect, useState } from "react";
import { bridge } from "../bridge.js";
import { fromEndpoint, ServiceError, type ScreenData, type ServiceClient } from "../client.js";

interface ProjectSummary {
  root: string;
  config: { project?: string; environment?: string; adapter?: string; app?: { baseUrl?: string } };
  flows: string[];
  stories: Array<{
    name: string;
    file: string;
    kind: string;
    steps: number;
    signature?: { inputs: Record<string, { type: string; default?: unknown }> };
  }>;
  compositions: Record<string, string[]>;
  runs: Record<string, string[]>;
  apis: string[];
  customSteps: string[];
  diagnostics: Array<{ severity: string; message?: string; code?: string }>;
}

export function ProjectScreen({
  client,
  onOpen,
  log,
}: {
  client: ServiceClient | undefined;
  onOpen: (directory: string) => Promise<void>;
  log: readonly string[];
}): React.JSX.Element {
  const [summary, setSummary] = useState<ScreenData<ProjectSummary> | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [recent, setRecent] = useState<readonly string[]>([]);

  useEffect(() => {
    void bridge()
      .preferences()
      .then((p) => setRecent(p.recentProjects))
      .catch(() => undefined);
  }, [client]);

  useEffect(() => {
    if (client === undefined) return;
    setError(undefined);
    void client
      .getProject()
      .then((value) => setSummary(fromEndpoint("getProject", value as ProjectSummary)))
      .catch((cause: unknown) =>
        setError(cause instanceof ServiceError ? cause.message : String(cause)),
      );
  }, [client]);

  const choose = async (): Promise<void> => {
    const directory = await bridge().pickFile("directory");
    if (directory !== null) await onOpen(directory);
  };

  return (
    <section aria-label="Project">
      <div className="row">
        <button type="button" onClick={() => void choose()}>
          Open a project…
        </button>
        {recent.length > 0 ? <span className="muted">Recent:</span> : null}
        {recent.slice(0, 3).map((one) => (
          <button key={one} type="button" onClick={() => void onOpen(one)}>
            {one.split(/[\\/]/).pop()}
          </button>
        ))}
      </div>

      {error !== undefined ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      {client === undefined ? (
        <>
          <p className="muted">
            Choose a directory holding a <code>svatah.config.yaml</code>. The ADE starts{" "}
            <code>svatah serve</code> for it and shows nothing the CLI could not.
          </p>
          {log.length > 0 ? <pre aria-label="Service log">{log.join("\n")}</pre> : null}
        </>
      ) : summary === undefined ? (
        <p className="muted">Loading…</p>
      ) : (
        <ProjectDetail data={summary} />
      )}
    </section>
  );
}

function ProjectDetail({ data }: { data: ScreenData<ProjectSummary> }): React.JSX.Element {
  const summary = data.value;
  return (
    <>
      <h2>{summary.config.project ?? "(unnamed project)"}</h2>
      <p className="muted">
        {summary.root} · environment {summary.config.environment ?? "test"} · adapter{" "}
        {summary.config.adapter ?? "playwright"}
        {summary.config.app?.baseUrl === undefined ? "" : ` · ${summary.config.app.baseUrl}`}
      </p>

      {summary.diagnostics.length > 0 ? (
        <>
          <h3>Diagnostics</h3>
          <table>
            <thead>
              <tr>
                <th>Severity</th>
                <th>Code</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {summary.diagnostics.map((one, at) => (
                <tr key={at}>
                  <td className={one.severity === "error" ? "failed" : ""}>{one.severity}</td>
                  <td>{one.code ?? ""}</td>
                  <td>{one.message ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <h3>Stories ({summary.stories.length})</h3>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>File</th>
            <th>Steps</th>
            <th>Inputs</th>
          </tr>
        </thead>
        <tbody>
          {summary.stories.map((story) => (
            <tr key={story.name}>
              <td>{story.name}</td>
              <td>{story.file}</td>
              <td>{story.steps}</td>
              <td>
                {Object.entries(story.signature?.inputs ?? {})
                  .map(([name, spec]) => `${name}: ${spec.type}${spec.default === undefined ? "" : " ="}`)
                  .join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Run blocks</h3>
      <table>
        <thead>
          <tr>
            <th>Flow</th>
            <th>Runs, in order</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(summary.runs).map(([flow, names]) => (
            <tr key={flow}>
              <td>{flow}</td>
              <td>{names.join(" → ")}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3>Also in this project</h3>
      <p className="muted">
        {summary.flows.length} flow file(s) · {Object.keys(summary.compositions).length}{" "}
        composition(s) · {summary.apis.length} named API request(s) ·{" "}
        {summary.customSteps.length} custom step(s)
      </p>

      <p className="source">Rendered from {data.from}.</p>
    </>
  );
}
