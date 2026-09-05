/**
 * The Run screen (T3.7, REQ-ADE-3, LLD §13.6).
 *
 * "Run (`POST /run`, `step.result` and `run.summary` events, screenshots by URL,
 * `GET /runs/:id/audit`)."
 *
 * `POST /run` answers with a run id immediately and the steps arrive on the
 * stream, which is why this is a screen rather than a spinner. What it shows is
 * what the run wrote: the same `results.jsonl` lines, in the same order, before
 * the file is closed.
 *
 * ## Inputs come from the signatures
 *
 * A story with a signature is a function (REQ-AUTO-5), and `POST /run` answers
 * 400 with the missing names rather than starting a run that will fail on its
 * first step (Draft 2.4, LLD §13.5). So the screen reads the signatures out of
 * `GET /project` and asks for them up front — which is the whole reason the
 * signatures are in that response.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fromEndpoint, ServiceError, type ScreenData, type ServiceClient, type StreamedEvent } from "../client.js";

interface StepResult {
  runId: string;
  story: string;
  stepId: string;
  line: number;
  text: string;
  status: "passed" | "failed" | "skipped" | "healed" | "aborted";
  durationMs: number;
  matched?: { by: string };
  failure?: { class: string; message: string; screenshot?: string };
}

interface Summary {
  runId: string;
  totals: Record<string, number>;
  exitCode: number;
}

interface ProjectSummary {
  flows: string[];
  runs: Record<string, string[]>;
  stories: Array<{
    name: string;
    signature?: { inputs: Record<string, { type: string; default?: unknown }> };
  }>;
}

export function RunScreen({ client }: { client: ServiceClient }): React.JSX.Element {
  const [project, setProject] = useState<ProjectSummary | undefined>(undefined);
  const [flow, setFlow] = useState<string>("");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [results, setResults] = useState<readonly StepResult[]>([]);
  const [summary, setSummary] = useState<ScreenData<Summary> | undefined>(undefined);
  const [runId, setRunId] = useState<string | undefined>(undefined);
  const [audit, setAudit] = useState<readonly unknown[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const unsubscribe = useRef<(() => void) | undefined>(undefined);

  useEffect(() => {
    void client.getProject().then((value) => setProject(value as ProjectSummary));
    return () => unsubscribe.current?.();
  }, [client]);

  /** The inputs the stories this run invokes declare, and have no default for. */
  const needed = useMemo(() => {
    if (project === undefined) return [];
    const names =
      flow === ""
        ? Object.values(project.runs).flat()
        : (project.runs[flow] ?? []);
    const out: Array<{ story: string; name: string; type: string }> = [];
    for (const story of project.stories) {
      if (!names.includes(story.name)) continue;
      for (const [name, spec] of Object.entries(story.signature?.inputs ?? {})) {
        if (spec.default !== undefined) continue;
        out.push({ story: story.name, name, type: spec.type });
      }
    }
    return out;
  }, [flow, project]);

  const start = useCallback(async () => {
    setError(undefined);
    setResults([]);
    setSummary(undefined);
    setAudit([]);
    setRunning(true);

    unsubscribe.current?.();
    unsubscribe.current = client.subscribe((event: StreamedEvent) => {
      if (event.kind === "step.result") {
        setResults((current) => [...current, event["result"] as StepResult]);
      } else if (event.kind === "run.summary") {
        setSummary(fromEndpoint("postRun", event["summary"] as Summary));
        setRunning(false);
      } else if (event.kind === "run.failed") {
        setError(String(event["message"] ?? "the run failed to start"));
        setRunning(false);
      }
    });

    try {
      const started = (await client.postRun({
        ...(flow === "" ? {} : { flows: [flow] }),
        ...(Object.keys(inputs).length === 0 ? {} : { inputs }),
      })) as { runId: string };
      setRunId(started.runId);
    } catch (cause) {
      setRunning(false);
      unsubscribe.current?.();
      // A 400 here is the service refusing a call, not a run that failed: it
      // lists the inputs nothing supplied (Draft 2.4, LLD §13.5).
      setError(cause instanceof ServiceError ? cause.body : String(cause));
    }
  }, [client, flow, inputs]);

  const showAudit = useCallback(async () => {
    if (runId === undefined) return;
    setAudit((await client.getRunsByIdAudit(runId)) as unknown[]);
  }, [client, runId]);

  return (
    <section aria-label="Run">
      <div className="row">
        <label htmlFor="run-flow">Flow</label>
        <select
          id="run-flow"
          value={flow}
          onChange={(event) => setFlow(event.target.value)}
          style={{ width: "auto" }}
        >
          <option value="">every flow with a run block</option>
          {(project?.flows ?? []).map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void start()} disabled={running}>
          {running ? "Running…" : "Run"}
        </button>
        {runId !== undefined ? <span className="muted">run {runId}</span> : null}
      </div>

      {needed.length > 0 ? (
        <div className="row" role="group" aria-label="Story inputs">
          {needed.map((one) => (
            <label key={`${one.story}.${one.name}`} className="grow">
              <span className="muted">
                {one.story} · {one.name} ({one.type})
              </span>
              <input
                type="text"
                aria-label={`${one.name} for ${one.story}`}
                value={inputs[one.name] ?? ""}
                onChange={(event) =>
                  setInputs((current) => ({ ...current, [one.name]: event.target.value }))
                }
              />
            </label>
          ))}
        </div>
      ) : null}

      {error !== undefined ? (
        <pre role="alert" className="error">
          {error}
        </pre>
      ) : null}

      <table>
        <thead>
          <tr>
            <th>Story</th>
            <th>Step</th>
            <th>Status</th>
            <th>ms</th>
            <th>Matched by</th>
          </tr>
        </thead>
        <tbody>
          {results.map((result) => (
            <tr key={`${result.story}#${result.stepId}`}>
              <td>{result.story}</td>
              <td>
                {result.text}
                {result.failure === undefined ? null : (
                  <div className="failed">
                    {result.failure.class}: {result.failure.message.split("\n")[0]}
                  </div>
                )}
                {result.failure?.screenshot === undefined || runId === undefined ? null : (
                  <Screenshot
                    client={client}
                    runId={runId}
                    name={result.failure.screenshot}
                    alt={`Screenshot of the failure at ${result.text}`}
                  />
                )}
              </td>
              <td className={result.status}>{result.status}</td>
              <td>{Math.round(result.durationMs)}</td>
              <td>{result.matched?.by ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {summary !== undefined ? (
        <>
          <h3>Summary</h3>
          <p className={summary.value.exitCode === 0 ? "passed" : "failed"}>
            {Object.entries(summary.value.totals)
              .map(([key, count]) => `${count} ${key}`)
              .join(", ")}{" "}
            · exit {summary.value.exitCode}
          </p>
          <button type="button" onClick={() => void showAudit()}>
            Show the audit log
          </button>
          {audit.length > 0 ? (
            <pre aria-label="Audit log">
              {audit.map((line) => JSON.stringify(line)).join("\n")}
            </pre>
          ) : null}
          <p className="source">
            Rendered from the {summary.from} event stream; the audit from getRunsByIdAudit.
          </p>
        </>
      ) : null}
    </section>
  );
}

/**
 * One screenshot, fetched with the token in a header.
 *
 * An `<img src>` cannot send a header, so the obvious shortcut is a `?token=`
 * query — and a credential in a URL is a credential in every log and every
 * referrer that URL ever touches. Fetching the bytes and holding a blob URL is
 * more code for a strictly better property, and the URL is revoked when the row
 * goes away.
 */
function Screenshot({
  client,
  runId,
  name,
  alt,
}: {
  client: ServiceClient;
  runId: string;
  name: string;
  alt: string;
}): React.JSX.Element | null {
  const [href, setHref] = useState<string | undefined>(undefined);

  useEffect(() => {
    let url: string | undefined;
    let cancelled = false;

    void client
      .screenshot(runId, name.split(/[\\/]/).pop() ?? name)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setHref(url);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      if (url !== undefined) URL.revokeObjectURL(url);
    };
  }, [client, name, runId]);

  return href === undefined ? null : (
    <img alt={alt} src={href} style={{ maxWidth: 420, marginTop: 6 }} />
  );
}
