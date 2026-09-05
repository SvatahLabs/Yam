/**
 * The Bindings browser and the Heal review (T5.7, REQ-ADE-5, LLD §13.6).
 *
 * "A bindings browser with context entries and dry-resolve status; a heal review
 * that shows a proposed diff with before and after candidates and applies it on
 * accept."
 *
 * ## Dry-resolve, not a re-reading of the YAML
 *
 * `POST /bindings/verify` opens a session and asks the *resolver* — the same one
 * a run uses — whether each binding still finds exactly one element. A green
 * status here means a run would find it; a status derived from the file's shape
 * would mean the file parses, which nobody was ever in doubt about.
 *
 * ## Apply is a second decision
 *
 * A heal proposes and a person accepts (REQ-HEAL-2: "repairs are a diff to the
 * bindings store plus a report"). So the screen runs the heal without `apply`,
 * shows each proposal's before and after candidates, and applies only when asked
 * — which re-runs the heal with `apply: true`, deterministically producing the
 * same repairs, rather than writing a diff the ADE assembled itself.
 */
import { useCallback, useEffect, useState } from "react";
import { fromEndpoint, type ScreenData, type ServiceClient } from "../client.js";

interface Candidate {
  by: string;
  value?: string;
  name?: string;
  role?: string;
  score: number;
}

interface BindingEntry {
  context: { pattern: string; hash: string; platform: string };
  candidates: Candidate[];
  verified: boolean;
  recordedAt: string;
}

interface BindingFile {
  id: string;
  phrases: string[];
  entries: BindingEntry[];
}

interface VerifyResult {
  id: string;
  status: "resolved" | "unresolved";
  by?: string;
  message?: string;
  entries: number;
  phrases: string[];
}

interface HealProposal {
  id: string;
  outcome: string;
  score?: number;
  message?: string;
  before: BindingFile | null;
  after: BindingFile | null;
}

interface RunSummary {
  runId: string;
  exitCode: number;
  startedAt: string;
}

const kinds = (file: BindingFile | null): string =>
  file?.entries[0]?.candidates.map((one) => one.by).join(", ") ?? "(none)";

export function BindingsScreen({ client }: { client: ServiceClient }): React.JSX.Element {
  const [store, setStore] = useState<ScreenData<BindingFile[]> | undefined>(undefined);
  const [verified, setVerified] = useState<ScreenData<VerifyResult[]> | undefined>(undefined);
  const [runs, setRuns] = useState<ScreenData<RunSummary[]> | undefined>(undefined);
  const [runId, setRunId] = useState<string | undefined>(undefined);
  const [proposals, setProposals] = useState<HealProposal[]>([]);
  const [healed, setHealed] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void client
      .getBindings()
      .then((value) => setStore(fromEndpoint("getBindings", value as BindingFile[])))
      .catch((cause: unknown) => setError(String(cause)));
    void client
      .getRuns()
      .then((value) => {
        const all = value as RunSummary[];
        setRuns(fromEndpoint("getRuns", all));
        setRunId((current) => current ?? all.find((one) => one.exitCode !== 0)?.runId ?? all[0]?.runId);
      })
      .catch(() => undefined);
  }, [client]);

  useEffect(() => {
    return client.subscribe((event) => {
      if (event.kind === "heal.proposal") {
        setProposals((all) => [...all, event["proposal"] as HealProposal]);
      } else if (event.kind === "heal.finished") {
        setHealed("finished");
        setBusy(false);
        void client
          .getBindings()
          .then((value) => setStore(fromEndpoint("getBindings", value as BindingFile[])))
          .catch(() => undefined);
      } else if (event.kind === "heal.failed") {
        setError(String(event["message"]));
        setBusy(false);
      }
    });
  }, [client]);

  const verify = useCallback(async () => {
    setError(undefined);
    setBusy(true);
    try {
      const report = (await client.postBindingsVerify({})) as { results: VerifyResult[] };
      setVerified(fromEndpoint("postBindingsVerify", report.results));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }, [client]);

  const heal = useCallback(
    async (apply: boolean) => {
      if (runId === undefined) return;
      setError(undefined);
      setProposals([]);
      setHealed(undefined);
      setBusy(true);
      try {
        await client.postHeal({ runId, apply });
      } catch (cause) {
        setError(String(cause));
        setBusy(false);
      }
    },
    [client, runId],
  );

  const statusOf = (id: string): VerifyResult | undefined =>
    verified?.value.find((one) => one.id === id);

  return (
    <section aria-label="Bindings">
      <div className="row">
        <button type="button" onClick={() => void verify()} disabled={busy}>
          Dry-resolve every binding
        </button>
        {verified === undefined ? (
          <span className="muted">Not verified in this session.</span>
        ) : (
          <span className="muted">
            {verified.value.filter((one) => one.status === "resolved").length} of{" "}
            {verified.value.length} resolve
          </span>
        )}
      </div>

      {error !== undefined ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      {store === undefined ? (
        <p className="muted">Reading the store…</p>
      ) : (
        <table aria-label="Bindings store">
          <thead>
            <tr>
              <th>Element</th>
              <th>Phrases</th>
              <th>Contexts</th>
              <th>Candidates</th>
              <th>Dry resolve</th>
            </tr>
          </thead>
          <tbody>
            {store.value.map((file) => {
              const status = statusOf(file.id);
              return (
                <tr key={file.id}>
                  <td>{file.id}</td>
                  <td>{file.phrases.join(", ")}</td>
                  <td>{file.entries.map((one) => one.context.pattern).join(", ")}</td>
                  <td>{kinds(file)}</td>
                  <td className={status?.status === "unresolved" ? "failed" : "passed"}>
                    {status === undefined
                      ? "—"
                      : status.status === "resolved"
                        ? `by ${status.by}`
                        : (status.message ?? "unresolved")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <h2>Heal review</h2>
      <div className="row">
        <label htmlFor="heal-run">Run</label>
        <select
          id="heal-run"
          value={runId ?? ""}
          onChange={(event) => setRunId(event.target.value)}
          style={{ width: "auto" }}
        >
          {(runs?.value ?? []).map((one) => (
            <option key={one.runId} value={one.runId}>
              {one.runId} (exit {one.exitCode})
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void heal(false)} disabled={busy || runId === undefined}>
          Propose repairs
        </button>
        <button
          type="button"
          onClick={() => void heal(true)}
          disabled={busy || proposals.length === 0}
        >
          Apply
        </button>
        {healed === undefined ? null : <span className="muted">heal {healed}</span>}
      </div>

      {proposals.length === 0 ? (
        <p className="muted">
          No proposals. A heal reads a run&apos;s <code>locator</code> failures and proposes a diff
          to the store; nothing is written until you apply it.
        </p>
      ) : (
        <table aria-label="Heal proposals">
          <thead>
            <tr>
              <th>Element</th>
              <th>Outcome</th>
              <th>Before</th>
              <th>After</th>
              <th>Score</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map((one) => (
              <tr key={one.id}>
                <td>{one.id}</td>
                <td className={one.outcome === "repaired" ? "passed" : "failed"}>{one.outcome}</td>
                <td>{kinds(one.before)}</td>
                <td>{kinds(one.after)}</td>
                <td>{one.score === undefined ? "" : one.score.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p className="source">
        Rendered from {store?.from ?? "getBindings"}, {verified?.from ?? "postBindingsVerify"},{" "}
        {runs?.from ?? "getRuns"} and the heal.proposal stream.
      </p>
    </section>
  );
}
