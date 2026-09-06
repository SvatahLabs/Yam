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
import { a11yVariant } from "../a11y-variant.js";
import { bridge } from "../bridge.js";
import { fromEndpoint, ServiceError, type ScreenData, type ServiceClient } from "../client.js";

/** What `POST /migrate` answers with (T6.6). */
interface ImportResult {
  project: string;
  files: string[];
  stories: Array<{ file: string; name: string; steps: number }>;
  unmapped: number;
  notes: Array<{ kind: string; message: string }>;
  review: string;
}

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

/**
 * What a Recent button says (P8-F3).
 *
 * The last path segment, which is the project directory's name and what someone
 * would call it. `"/a/b/".split("/").pop()` is the empty string, and a trailing
 * separator is exactly what a path pasted from a file manager carries — so a
 * button with no accessible name was one preference away, which is the class of
 * defect the Phase 8 verification found three of on this screen. The whole path
 * is the fallback: long, and a name.
 */
export function recentLabel(path: string): string {
  const segments = path.split(/[\\/]/).filter((one) => one !== "");
  return segments[segments.length - 1] ?? path;
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
  const [imported, setImported] = useState<ScreenData<ImportResult> | undefined>(undefined);
  const [importing, setImporting] = useState(false);

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

  /**
   * Import a Svatah ADE prototype's database into the open project (T6.6,
   * REQ-ADE-9).
   *
   * Into the *open* project, because that is the only directory the service
   * writes to (LLD §13.5) — so the flow is "open an empty directory, then
   * import into it", which is what `svatah migrate <dest> --from-ade <src>`
   * does from a terminal. The screen says so rather than leaving someone to
   * discover it by importing over a project they meant to keep.
   */
  const importPrototype = async (): Promise<void> => {
    setError(undefined);
    setImported(undefined);
    if (client === undefined) return;
    const source = await bridge().pickFile("directory");
    if (source === null) return;
    setImporting(true);
    try {
      const result = (await client.postMigrate({ source })) as ImportResult;
      setImported(fromEndpoint("postMigrate", result));
      // The project changed on disk, so what the screen shows must be re-read.
      setSummary(fromEndpoint("getProject", (await client.getProject()) as ProjectSummary));
    } catch (cause) {
      setError(cause instanceof ServiceError ? cause.message : String(cause));
    } finally {
      setImporting(false);
    }
  };

  return (
    <section aria-label="Project">
      <div className="row">
        {/*
          LLD §16's variant 1 renames this button and nothing else about it. The
          `id` is what survives — it is the `automationId` the desktop adapters
          read, and the healing case's ground-truth key, the desktop equivalent
          of `apps/sample-web`'s `data-svatah-eval`.
        */}
        <button id="project-open" type="button" onClick={() => void choose()}>
          {a11yVariant() === 1 ? "Choose a project…" : "Open a project…"}
        </button>
        <button
          id="project-import"
          type="button"
          onClick={() => void importPrototype()}
          disabled={client === undefined || importing}
          title="Read a Svatah ADE prototype's electron-db directory into the open project"
        >
          {importing ? "Importing…" : "Import prototype database…"}
        </button>
        {recent.length > 0 ? <span className="muted">Recent:</span> : null}
        {recent.slice(0, 3).map((one, at) => (
          <button
            key={one}
            id={`project-recent-${at}`}
            type="button"
            onClick={() => void onOpen(one)}
            title={one}
          >
            {recentLabel(one)}
          </button>
        ))}
      </div>

      {error !== undefined ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      {imported === undefined ? null : (
        <article aria-label="Prototype import" className="panel">
          <h2>Imported “{imported.value.project}”</h2>
          <p className="muted">
            {imported.value.stories.length} stories in {imported.value.files.length} file(s).
            Results and screenshots were not imported. Read{" "}
            <code>{imported.value.review}</code> before trusting the output
            {imported.value.unmapped === 0
              ? "."
              : `: ${imported.value.unmapped} step(s) could not be converted and are left as comments.`}
          </p>
          {imported.value.notes.length === 0 ? null : (
            <ul aria-label="Import notes">
              {imported.value.notes.slice(0, 20).map((note, at) => (
                <li key={`${note.kind}-${at}`}>
                  <code>{note.kind}</code> — {note.message}
                </li>
              ))}
            </ul>
          )}
          <p className="source">Rendered from {imported.from}.</p>
        </article>
      )}

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
