/**
 * Results history (T3.7, REQ-ADE-3, LLD §13.6: "Results (`GET /runs`)").
 *
 * Every run in `runs/`, newest first, and one run's step results when a person
 * asks. The run directory is the record — `summary.json`, `results.jsonl`,
 * `audit.jsonl` — and this reads it back through the service rather than keeping
 * a history of its own. An ADE with its own run history would be a second
 * account of what happened, and the first time it disagreed with the files, the
 * files would be right.
 */
import { useCallback, useEffect, useState } from "react";
import { fromEndpoint, type ScreenData, type ServiceClient } from "../client.js";

interface Summary {
  runId: string;
  behavior: string;
  startedAt: string;
  endedAt: string;
  planHash: string;
  bindingsHash: string;
  totals: Record<string, number>;
  exitCode: number;
}

interface StepResult {
  story: string;
  stepId: string;
  text: string;
  status: string;
  durationMs: number;
  matched?: { by: string };
  failure?: { class: string; message: string };
}

export function ResultsScreen({ client }: { client: ServiceClient }): React.JSX.Element {
  const [runs, setRuns] = useState<ScreenData<Summary[]> | undefined>(undefined);
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [results, setResults] = useState<readonly StepResult[]>([]);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    setError(undefined);
    void client
      .getRuns()
      .then((value) => setRuns(fromEndpoint("getRuns", value as Summary[])))
      .catch((cause: unknown) => setError(String(cause)));
  }, [client]);

  const show = useCallback(
    async (runId: string) => {
      setOpen(runId);
      setResults((await client.getRunsByIdResults(runId)) as StepResult[]);
    },
    [client],
  );

  if (error !== undefined) {
    return (
      <p role="alert" className="error">
        {error}
      </p>
    );
  }
  if (runs === undefined) return <p className="muted">Loading…</p>;

  return (
    <section aria-label="Results">
      <h2>Runs ({runs.value.length})</h2>
      {runs.value.length === 0 ? (
        <p className="muted">
          No runs yet. The Run screen writes one, and so does <code>svatah run</code>; this reads
          whichever wrote last.
        </p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Run</th>
              <th>Started</th>
              <th>Totals</th>
              <th>Exit</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {runs.value.map((run) => (
              <tr key={run.runId}>
                <td>{run.runId}</td>
                <td>{run.startedAt}</td>
                <td>
                  {Object.entries(run.totals)
                    .filter(([, count]) => count > 0)
                    .map(([key, count]) => `${count} ${key}`)
                    .join(", ")}
                </td>
                <td className={run.exitCode === 0 ? "passed" : "failed"}>{run.exitCode}</td>
                <td>
                  <button type="button" onClick={() => void show(run.runId)}>
                    Open {run.runId}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open !== undefined ? (
        <>
          <h3>{open}</h3>
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
                  </td>
                  <td className={result.status}>{result.status}</td>
                  <td>{Math.round(result.durationMs)}</td>
                  <td>{result.matched?.by ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}

      <p className="source">Rendered from {runs.from} and getRunsByIdResults.</p>
    </section>
  );
}
