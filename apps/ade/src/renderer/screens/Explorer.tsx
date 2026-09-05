/**
 * The surface explorer (T5.8, REQ-ADE-8, LLD §13.6).
 *
 * "A surface explorer that drives any adapter session step by step with `intent`
 * recorded, and offers 'compile to proposal'."
 *
 * ## The intent is required, and the button says so
 *
 * Every call carries what the person was trying to do. That is not decoration:
 * the intent is what the trajectory compiler reads (LLD §13.4), and an
 * exploration whose calls do not say what they were for is a log rather than
 * something that can become a deterministic tool. The service refuses a call
 * without one; this disables the buttons, which is the same rule said earlier.
 *
 * ## What it is not
 *
 * Not a recorder. A recording drives a *plan* and grounds its targets; this
 * drives nothing but what the person clicks, and what comes out is a proposal to
 * read rather than a store to run. They meet at `proposals/`, where a person
 * decides which is which.
 */
import { useCallback, useState } from "react";
import { fromEndpoint, type ScreenData, type ServiceClient } from "../client.js";

interface SnapshotNode {
  ref: string;
  role: string;
  name?: string;
  depth: number;
}

interface Snapshot {
  nodes: SnapshotNode[];
  hash: string;
}

interface CompileReport {
  dir: string;
  files: string[];
  steps: { total: number; compiled: number; rate: number };
  review: Array<{ intent: string; why: string }>;
  flow: string;
}

const SESSION = "explorer";

export function ExplorerScreen({ client }: { client: ServiceClient }): React.JSX.Element {
  const [open, setOpen] = useState<ScreenData<{ trajectory: string }> | undefined>(undefined);
  const [snapshot, setSnapshot] = useState<ScreenData<Snapshot> | undefined>(undefined);
  const [intent, setIntent] = useState("");
  const [calls, setCalls] = useState<ReadonlyArray<{ intent: string; what: string }>>([]);
  const [proposal, setProposal] = useState<ScreenData<CompileReport> | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  const note = (what: string): void => {
    setCalls((all) => [...all, { intent, what }]);
    // Cleared after each call, so the next one cannot inherit the last one's
    // words — an intent copied from the step before is worse than none.
    setIntent("");
  };

  const start = useCallback(async () => {
    setError(undefined);
    setBusy(true);
    try {
      const opened = (await client.postSurfaceBySessionOpen(SESSION, {})) as {
        trajectory: string;
      };
      setOpen(fromEndpoint("postSurfaceBySessionOpen", opened));
      const taken = (await client.postSurfaceBySessionSnapshot(SESSION, {
        intent: "open the session",
        interactiveOnly: true,
      })) as Snapshot;
      setSnapshot(fromEndpoint("postSurfaceBySessionSnapshot", taken));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }, [client]);

  const refresh = useCallback(async () => {
    if (intent.trim() === "") return;
    setBusy(true);
    try {
      const taken = (await client.postSurfaceBySessionSnapshot(SESSION, {
        intent,
        interactiveOnly: true,
      })) as Snapshot;
      setSnapshot(fromEndpoint("postSurfaceBySessionSnapshot", taken));
      note("snapshot");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }, [client, intent]);

  const act = useCallback(
    async (node: SnapshotNode) => {
      if (intent.trim() === "") return;
      setBusy(true);
      try {
        await client.postSurfaceBySessionAct(SESSION, {
          intent,
          action: "click",
          ref: node.ref,
        });
        note(`click ${node.role}${node.name === undefined ? "" : ` "${node.name}"`}`);
        const taken = (await client.postSurfaceBySessionSnapshot(SESSION, {
          intent: "see what changed",
          interactiveOnly: true,
        })) as Snapshot;
        setSnapshot(fromEndpoint("postSurfaceBySessionSnapshot", taken));
      } catch (cause) {
        setError(String(cause));
      } finally {
        setBusy(false);
      }
    },
    // `note` closes over `intent`, which is the value being read.
    [client, intent],
  );

  const read = useCallback(
    async (node: SnapshotNode) => {
      if (intent.trim() === "") return;
      setBusy(true);
      try {
        const value = await client.postSurfaceBySessionRead(SESSION, {
          intent,
          kind: "text",
          ref: node.ref,
        });
        note(`read ${node.ref} → ${String(value)}`);
      } catch (cause) {
        setError(String(cause));
      } finally {
        setBusy(false);
      }
    },
    [client, intent],
  );

  const compile = useCallback(async () => {
    if (open === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const report = (await client.postTrajectoryCompile({
        path: open.value.trajectory,
      })) as CompileReport;
      setProposal(fromEndpoint("postTrajectoryCompile", report));
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }, [client, open]);

  const close = useCallback(async () => {
    try {
      await client.postSurfaceBySessionClose(SESSION);
    } catch {
      // A session that is already gone is the state we wanted.
    }
    setOpen(undefined);
    setSnapshot(undefined);
  }, [client]);

  return (
    <section aria-label="Surface explorer">
      <div className="row">
        <button type="button" onClick={() => void start()} disabled={busy || open !== undefined}>
          Open a session
        </button>
        <button type="button" onClick={() => void close()} disabled={open === undefined}>
          Close
        </button>
        <button
          type="button"
          onClick={() => void compile()}
          disabled={busy || open === undefined || calls.length === 0}
        >
          Compile to proposal
        </button>
        {open === undefined ? (
          <span className="muted">No session.</span>
        ) : (
          <span className="muted">trajectory {open.value.trajectory}</span>
        )}
      </div>

      <div className="row">
        <label htmlFor="explorer-intent">Intent</label>
        <input
          id="explorer-intent"
          type="text"
          value={intent}
          placeholder="what you are trying to do — the sentence this call compiles into"
          onChange={(event) => setIntent(event.target.value)}
        />
        <button type="button" onClick={() => void refresh()} disabled={busy || open === undefined || intent.trim() === ""}>
          Snapshot
        </button>
      </div>
      {intent.trim() === "" && open !== undefined ? (
        <p className="muted">
          Every call needs an intent. It is the sentence the step compiles into (LLD §13.4), so a
          call without one cannot become part of a tool.
        </p>
      ) : null}

      {error !== undefined ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      {snapshot === undefined ? null : (
        <table aria-label="Snapshot">
          <thead>
            <tr>
              <th>Role</th>
              <th>Name</th>
              <th>Reference</th>
              <th>Act</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.value.nodes.slice(0, 80).map((node) => (
              <tr key={node.ref}>
                <td>{node.role}</td>
                <td>{node.name ?? ""}</td>
                <td>{node.ref}</td>
                <td>
                  <button type="button" onClick={() => void act(node)} disabled={intent.trim() === ""}>
                    Click
                  </button>{" "}
                  <button type="button" onClick={() => void read(node)} disabled={intent.trim() === ""}>
                    Read
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {calls.length === 0 ? null : (
        <table aria-label="Trajectory">
          <thead>
            <tr>
              <th>Intent</th>
              <th>Call</th>
            </tr>
          </thead>
          <tbody>
            {calls.map((one, index) => (
              <tr key={`${one.what}-${index}`}>
                <td>{one.intent}</td>
                <td>{one.what}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {proposal === undefined ? null : (
        <article aria-label="Proposal" className="panel">
          <h2>Proposal</h2>
          <p className="muted">
            {proposal.value.steps.compiled} of {proposal.value.steps.total} step(s) compile at
            Tier 1 → {proposal.value.dir}
          </p>
          <pre>{proposal.value.flow}</pre>
          {proposal.value.review.length === 0 ? null : (
            <ul>
              {proposal.value.review.map((one) => (
                <li key={one.intent}>
                  {one.intent}: {one.why}
                </li>
              ))}
            </ul>
          )}
          <p className="source">Rendered from {proposal.from}.</p>
        </article>
      )}

      <p className="source">
        Rendered from {open?.from ?? "postSurfaceBySessionOpen"} and{" "}
        {snapshot?.from ?? "postSurfaceBySessionSnapshot"}. Every call is written to
        trajectory.jsonl with its intent.
      </p>
    </section>
  );
}
