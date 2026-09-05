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
 *
 * ## The gateway is the screen's to choose (REQ-ADE-4, Draft 2.7)
 *
 * This screen used to post `{ rebind: true }` and nothing else, so a person
 * with no `ANTHROPIC_API_KEY` pressed "Start recording" and got a failure whose
 * advice was "pass --gateway fake" — a command-line flag the window has no way
 * to pass. Every path out of that message led back to a terminal, which makes
 * the screen a worse way to do the thing than not having it.
 *
 * So the choice is on the screen. `GET /project` says whether the service has a
 * credential — the boolean, never the key — and the control defaults to
 * `anthropic` when it does and `fake` when it does not. Both are labelled for
 * what they are: one is a model, the other is `evals/grounding/cases` read back,
 * and a reviewer accepting a decision has a right to know which of the two
 * produced it. The choice goes to `POST /record` as `gateway`.
 *
 * `record.failed` is an alert with advice written for this window: which
 * gateway was asked for, and what to do about it here.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { a11yVariant } from "../a11y-variant.js";
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

/** The two gateways a record session can run against (LLD §13.5, §13.6). */
type GatewayChoice = "anthropic" | "fake";

/**
 * What `GET /project` says about the service's model credential (REQ-ADE-4).
 *
 * A boolean, because that is all the service sends and all the screen needs.
 */
interface ProjectGateway {
  gateway?: { credential?: boolean };
}

/**
 * Advice a person at this window can act on (REQ-ADE-4, LLD §13.6).
 *
 * The service's message is written for whoever called it, and for the missing
 * credential it names a CLI flag. Everything the flag would do is a control on
 * this screen, so the advice says so; anything else is passed through, because
 * an invented explanation of an unfamiliar failure is worse than the real one.
 */
export function adviseOnFailure(message: string, gateway: GatewayChoice): string {
  if (/needs a model|ANTHROPIC_API_KEY|GatewayUnavailable/i.test(message)) {
    return gateway === "anthropic"
      ? "Recording needs a model, and this service has no credential. Choose the " +
          "fake gateway above to record from the committed grounding answers, or " +
          "restart the service with ANTHROPIC_API_KEY set."
      : "Recording needs a gateway, and none answered. Choose one above and start again.";
  }
  return message;
}

export function RecordScreen({ client }: { client: ServiceClient }): React.JSX.Element {
  const [session, setSession] = useState<ScreenData<string> | undefined>(undefined);
  const [proposal, setProposal] = useState<ScreenData<Proposal> | undefined>(undefined);
  const [steps, setSteps] = useState<ReadonlyArray<{ text: string; status: string }>>([]);
  const [picking, setPicking] = useState<ScreenData<SnapshotNode[]> | undefined>(undefined);
  const [report, setReport] = useState<unknown>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [credential, setCredential] = useState<ScreenData<boolean> | undefined>(undefined);
  const [gateway, setGateway] = useState<GatewayChoice | undefined>(undefined);
  const sessionRef = useRef<string | undefined>(undefined);
  /* Which gateway the *running* session was started with, so the alert can
     advise about the choice that failed rather than the one now selected. */
  const startedWith = useRef<GatewayChoice>("fake");

  /*
   * The default follows the service, not a preference (REQ-ADE-4): `anthropic`
   * when `GET /project` reports a credential, `fake` when it does not. Choosing
   * `anthropic` by default on a machine with no key is how the old screen
   * produced a failure on the first press of the button.
   */
  useEffect(() => {
    let live = true;
    void client
      .getProject()
      .then((value) => {
        if (!live) return;
        const present = (value as ProjectGateway).gateway?.credential === true;
        setCredential(fromEndpoint("getProject", present));
        setGateway((chosen) => chosen ?? (present ? "anthropic" : "fake"));
      })
      .catch(() => {
        if (!live) return;
        // A project that will not load is the Project screen's problem to
        // report. Here it only means the safe default: the gateway that needs
        // nothing.
        setCredential(fromEndpoint("getProject", false));
        setGateway((chosen) => chosen ?? "fake");
      });
    return () => {
      live = false;
    };
  }, [client]);

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
      } else if (event.kind === "record.decision.expired") {
        /*
         * Nobody decided in time (LLD §13.5, Draft 2.7). The session has
         * stopped, so the screen says why rather than leaving a decision panel
         * that will never be answered on the screen.
         */
        setProposal(undefined);
        setError(
          `No decision within ${Math.round(Number(event["afterMs"]) / 1000)} s, so the ` +
            "recording session stopped and wrote its report. Nothing was written to the " +
            "bindings store. Start recording again to review the same grounding.",
        );
      } else if (event.kind === "record.failed") {
        setProposal(undefined);
        setError(adviseOnFailure(String(event["message"]), startedWith.current));
      }
    });
  }, [client]);

  const start = useCallback(async () => {
    setError(undefined);
    setBusy(true);
    const chosen: GatewayChoice = gateway ?? "fake";
    startedWith.current = chosen;
    try {
      // The gateway goes with the request (LLD §13.5's `POST /record`). Without
      // it the service falls back to whatever the environment happens to hold,
      // which is exactly the guess this control exists to remove.
      await client.postRecord({ rebind: true, gateway: chosen });
    } catch (cause) {
      setError(adviseOnFailure(String(cause), chosen));
    } finally {
      setBusy(false);
    }
  }, [client, gateway]);

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

  /*
   * The gateway control, which LLD §16's variant 2 moves.
   *
   * Identical markup in both variants — same role, same accessible name, same
   * id — placed in a different container. That is the whole point of the
   * variant: a binding that matched on where the control *was* breaks, and one
   * that matched on what it *is* does not, so the desktop healing case measures
   * the structural half of relocalization on its own.
   */
  const gatewayControl = (
    <>
      <label htmlFor="record-gateway">Gateway</label>
      <select
        id="record-gateway"
        aria-label="Gateway"
        value={gateway ?? "fake"}
        onChange={(event) => setGateway(event.target.value as GatewayChoice)}
        disabled={busy || proposal !== undefined}
      >
        {/*
          Both labelled for what they are (REQ-ADE-4). A reviewer accepting a
          grounding decision is entitled to know whether a model made it or a
          committed fixture did, and the label is the only place on this
          screen that can say so before the decision arrives.
        */}
        <option value="anthropic" disabled={credential?.value !== true}>
          {credential?.value === true
            ? "anthropic — a model, through the service's credential"
            : "anthropic — no credential on this service"}
        </option>
        <option value="fake">fake — committed answers from evals/grounding/cases</option>
      </select>
    </>
  );
  const movedGateway = a11yVariant() === 2;

  return (
    <section aria-label="Record review">
      {movedGateway ? (
        /*
         * A *panel*, and one the accessibility tree can see: a plain `<div>` is
         * not published as a node, so moving the control into one would change
         * nothing a desktop adapter could read and the healing case would be
         * measuring nothing. `role="group"` with a name is the smallest
         * container that actually moves the control in the tree.
         */
        <div className="panel row" role="group" aria-label="Session settings">
          {gatewayControl}
          {session === undefined ? (
            <span className="muted">No session.</span>
          ) : (
            <span className="muted">session {session.value}</span>
          )}
        </div>
      ) : null}
      <div className="row">
        {movedGateway ? null : gatewayControl}
        <button type="button" onClick={() => void start()} disabled={busy || proposal !== undefined}>
          Start recording
        </button>
        {movedGateway ? null : session === undefined ? (
          <span className="muted">No session.</span>
        ) : (
          <span className="muted">session {session.value}</span>
        )}
      </div>

      {gateway === "fake" ? (
        <p className="muted" aria-label="Gateway notice">
          The fake gateway answers from <code>evals/grounding/cases</code>. Nothing recorded in
          this session measures a model, and its provenance says so.
        </p>
      ) : null}

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
        Rendered from {session?.from ?? "subscribe"}, {credential?.from ?? "getProject"} and
        postRecord. Bindings are written only after a decision.
      </p>
    </section>
  );
}
