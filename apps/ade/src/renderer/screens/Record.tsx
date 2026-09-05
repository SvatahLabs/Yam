/**
 * The Record review screen (T5.7, REQ-ADE-4, LLD §13.6).
 *
 * "A record session streams grounding decisions; the ADE shows the snapshot
 * excerpt, chosen reference, candidate bundle, and fingerprint per target, with
 * accept, re-pick by clicking in the driven session, or reject, **before
 * bindings are written**."
 *
 * ## Before is the whole point
 *
 * The service blocks the recording session on each grounding and waits for
 * `POST /record/{id}/decision`. Nothing is written to the store until this
 * screen answers. A review that ran afterwards would be showing a person a
 * decision already made, and "reject" would mean "undo" — a much weaker promise,
 * and one a store cannot always keep.
 *
 * ## Re-pick reads the driven session
 *
 * `POST /surface/{session}/snapshot` is the live page the recorder is on. The
 * reviewer picks a reference out of it and the recorder re-synthesises the entry
 * from *that* element — the same candidate ranking and fingerprint a grounded
 * one gets, so the store never holds a locator nothing else knows how to make.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { fromEndpoint, type ScreenData, type ServiceClient } from "../client.js";

interface Candidate {
  by: string;
  value?: string;
  name?: string;
  role?: string;
  score: number;
}

interface Fingerprint {
  tag: string;
  text: string;
  attrs: Record<string, string>;
  rolePath: string[];
}

interface Proposal {
  story: string;
  stepId: string;
  text: string;
  elementId: string;
  phrase: string;
  url?: string;
  snapshot: string;
  decision: { outcome: string; ref?: string; confidence?: number; why?: string };
  entry: { candidates: Candidate[]; fingerprint: Fingerprint; context: { pattern: string } };
}

interface SnapshotNode {
  ref: string;
  role: string;
  name?: string;
}

export function RecordScreen({ client }: { client: ServiceClient }): React.JSX.Element {
  const [session, setSession] = useState<ScreenData<string> | undefined>(undefined);
  const [proposal, setProposal] = useState<ScreenData<Proposal> | undefined>(undefined);
  const [steps, setSteps] = useState<ReadonlyArray<{ text: string; status: string }>>([]);
  const [picking, setPicking] = useState<ScreenData<SnapshotNode[]> | undefined>(undefined);
  const [report, setReport] = useState<unknown>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const sessionRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    return client.subscribe((event) => {
      if (event.kind === "record.started") {
        sessionRef.current = String(event["sessionId"]);
        setSession(fromEndpoint("subscribe", String(event["sessionId"])));
        setSteps([]);
        setReport(undefined);
      } else if (event.kind === "record.step") {
        const step = event["step"] as { text: string; status: string };
        setSteps((all) => [...all, { text: step.text, status: step.status }]);
      } else if (event.kind === "record.decision") {
        setProposal(fromEndpoint("subscribe", event["proposal"] as Proposal));
        setPicking(undefined);
      } else if (event.kind === "record.finished") {
        setProposal(undefined);
        setReport(event["report"]);
      } else if (event.kind === "record.failed") {
        setProposal(undefined);
        setError(String(event["message"]));
      }
    });
  }, [client]);

  const start = useCallback(async () => {
    setError(undefined);
    setBusy(true);
    try {
      await client.postRecord({ rebind: true });
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }, [client]);

  const decide = useCallback(
    async (body: { accept?: boolean; repick?: string; why?: string }) => {
      const id = sessionRef.current;
      if (id === undefined) return;
      setProposal(undefined);
      setPicking(undefined);
      try {
        await client.postRecordByIdDecision(id, body);
      } catch (cause) {
        setError(String(cause));
      }
    },
    [client],
  );

  /** The page the recorder is on, so the reviewer can pick a different element. */
  const repick = useCallback(async () => {
    const id = sessionRef.current;
    if (id === undefined) return;
    try {
      const snapshot = (await client.postSurfaceBySessionSnapshot(id, {
        interactiveOnly: true,
      })) as { nodes: SnapshotNode[] };
      setPicking(fromEndpoint("postSurfaceBySessionSnapshot", snapshot.nodes));
    } catch (cause) {
      setError(String(cause));
    }
  }, [client]);

  return (
    <section aria-label="Record review">
      <div className="row">
        <button type="button" onClick={() => void start()} disabled={busy || proposal !== undefined}>
          Start recording
        </button>
        {session === undefined ? (
          <span className="muted">No session.</span>
        ) : (
          <span className="muted">session {session.value}</span>
        )}
      </div>

      {error !== undefined ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      {proposal === undefined ? null : (
        <article aria-label="Grounding decision" className="panel">
          <h2>
            {proposal.value.phrase} <span className="muted">({proposal.value.elementId})</span>
          </h2>
          <p className="muted">
            {proposal.value.story} · {proposal.value.text}
            {proposal.value.url === undefined ? "" : ` · ${proposal.value.url}`}
          </p>
          <p>
            The model chose <code>{proposal.value.decision.ref ?? "nothing"}</code> —{" "}
            {proposal.value.decision.outcome}
            {proposal.value.decision.confidence === undefined
              ? ""
              : ` at ${proposal.value.decision.confidence.toFixed(2)}`}
            {proposal.value.decision.why === undefined ? "" : `. ${proposal.value.decision.why}`}
          </p>

          <h3>Candidates</h3>
          <table>
            <thead>
              <tr>
                <th>By</th>
                <th>Value</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {proposal.value.entry.candidates.map((one, index) => (
                <tr key={`${one.by}-${index}`}>
                  <td>{one.by}</td>
                  <td>{one.value ?? [one.role, one.name].filter(Boolean).join(" ")}</td>
                  <td>{one.score.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3>Fingerprint</h3>
          <p className="muted">
            {proposal.value.entry.fingerprint.tag} · {proposal.value.entry.fingerprint.text} ·{" "}
            {proposal.value.entry.fingerprint.rolePath.join(" / ")}
          </p>

          <h3>Snapshot excerpt</h3>
          <pre aria-label="Snapshot excerpt">{proposal.value.snapshot.slice(0, 2000)}</pre>

          <div className="row">
            <button type="button" onClick={() => void decide({ accept: true })}>
              Accept
            </button>
            <button type="button" onClick={() => void repick()}>
              Re-pick
            </button>
            <button type="button" onClick={() => void decide({ accept: false, why: "rejected in the ADE" })}>
              Reject
            </button>
          </div>

          {picking === undefined ? null : (
            <div aria-label="Pick an element">
              <h3>Pick an element in the driven session</h3>
              <ul>
                {picking.value.slice(0, 60).map((node) => (
                  <li key={node.ref}>
                    <button type="button" onClick={() => void decide({ repick: node.ref })}>
                      {node.role}
                      {node.name === undefined ? "" : ` "${node.name}"`} ({node.ref})
                    </button>
                  </li>
                ))}
              </ul>
              <p className="source">Rendered from {picking.from}.</p>
            </div>
          )}
        </article>
      )}

      {steps.length === 0 ? null : (
        <table aria-label="Recorded steps">
          <thead>
            <tr>
              <th>Status</th>
              <th>Step</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step, index) => (
              <tr key={`${step.text}-${index}`}>
                <td className={step.status === "failed" ? "failed" : "passed"}>{step.status}</td>
                <td>{step.text}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {report === undefined ? null : (
        <p aria-label="Record report" className="muted">
          Session finished. The record report is in the project.
        </p>
      )}

      <p className="source">
        Rendered from {session?.from ?? "subscribe"} and postRecord. Bindings are written only
        after a decision.
      </p>
    </section>
  );
}
