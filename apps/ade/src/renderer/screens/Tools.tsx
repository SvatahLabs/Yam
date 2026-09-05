/**
 * The tool panel (T5.8, REQ-ADE-8, REQ-BEH-3, LLD §13.6).
 *
 * "A tool panel that exposes stories over MCP from the ADE and shows tool
 * invocations with their audit records."
 *
 * ## The invocations come from the run directories
 *
 * Not from a register the ADE or the service keeps. A tool call *is* a run
 * (`behavior: "tool"`), and its account is `runs/<id>/summary.json` and
 * `audit.jsonl` — so this panel shows invocations served by a `svatah tool
 * serve` running in another terminal, or by a CI job, exactly as it shows its
 * own. REQ-ADE-2: the project directory is the only source of truth, and
 * anything the ADE shows is a file the CLI also reads.
 *
 * ## Which stories become tools, and which do not
 *
 * The panel lists both, because the refusals are the interesting half:
 * REQ-AUTO-8 keeps a story that is not `idempotent` out of an agent's reach, and
 * an operator who cannot see *why* a story is missing will conclude the tool
 * server is broken.
 *
 * ## Starting the server
 *
 * The command is `svatah tool serve --expose "…"`, and this panel shows it
 * rather than spawning it. An MCP server speaks over stdio to the client that
 * launched it; a server the ADE spawned would have the ADE as its client and no
 * way to hand the pipe to anyone else. What the panel is for is deciding *what*
 * to expose and watching what happens — and the invocations below are the
 * watching, whoever started the server.
 */
import { useCallback, useEffect, useState } from "react";
import { fromEndpoint, type ScreenData, type ServiceClient } from "../client.js";

interface Tool {
  name: string;
  story: string;
  description: string;
  inputSchema: { properties: Record<string, { type: string }>; required: string[] };
}

interface AuditLine {
  kind: string;
  at: string;
  seq: number;
  story?: string;
  stepId?: string;
  call?: { method: string; action?: string; ref?: string };
  outcome?: string;
  detail?: unknown;
}

interface Invocation {
  runId: string;
  startedAt: string;
  exitCode: number;
  invoker?: { kind: string; id: string; via: string };
  outputs?: Record<string, unknown>;
  audit: AuditLine[];
}

export function ToolsScreen({ client }: { client: ServiceClient }): React.JSX.Element {
  const [tools, setTools] = useState<
    ScreenData<{ tools: Tool[]; refused: Array<{ name: string; why: string }> }> | undefined
  >(undefined);
  const [invocations, setInvocations] = useState<ScreenData<Invocation[]> | undefined>(undefined);
  const [open, setOpen] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    setError(undefined);
    try {
      const answer = (await client.getTools()) as {
        tools: { tools: Tool[]; refused: Array<{ name: string; why: string }> };
        invocations: Invocation[];
      };
      setTools(fromEndpoint("getTools", answer.tools));
      setInvocations(fromEndpoint("getTools", answer.invocations));
    } catch (cause) {
      setError(String(cause));
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  /*
   * A tool call is a run, and a run announces itself on the stream. Re-reading
   * the directories when one finishes is what makes the panel live without the
   * service keeping a register of its own.
   */
  useEffect(() => {
    return client.subscribe((event) => {
      if (event.kind === "run.summary") void load();
    });
  }, [client, load]);

  const exposed = tools?.value.tools ?? [];
  const command =
    exposed.length === 0
      ? 'svatah tool serve --expose "Story one,Story two"'
      : `svatah tool serve --expose "${exposed.map((one) => one.story).join(",")}"`;

  return (
    <section aria-label="Tool panel">
      <div className="row">
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
        <span className="muted">
          {exposed.length} tool(s) · {invocations?.value.length ?? 0} invocation(s)
        </span>
      </div>

      {error !== undefined ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      <h2>Tools</h2>
      {exposed.length === 0 ? (
        <p className="muted">
          Nothing is exposed. Name the stories in <code>tool.expose</code> in{" "}
          <code>svatah.config.yaml</code>, or pass <code>--expose</code>.
        </p>
      ) : (
        <table aria-label="Exposed tools">
          <thead>
            <tr>
              <th>Tool</th>
              <th>Story</th>
              <th>Inputs</th>
            </tr>
          </thead>
          <tbody>
            {exposed.map((one) => (
              <tr key={one.name}>
                <td>
                  <code>{one.name}</code>
                </td>
                <td>{one.story}</td>
                <td>
                  {Object.entries(one.inputSchema.properties)
                    .map(
                      ([name, property]) =>
                        `${name}: ${property.type}${
                          one.inputSchema.required.includes(name) ? "" : "?"
                        }`,
                    )
                    .join(", ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {(tools?.value.refused ?? []).length === 0 ? null : (
        <>
          <h3>Not exposed</h3>
          <ul aria-label="Refused stories">
            {(tools?.value.refused ?? []).map((one) => (
              <li key={one.name}>
                <strong>{one.name}</strong>: {one.why}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3>Serving them</h3>
      <p className="muted">
        An MCP server speaks over stdio to the client that launched it, so the client starts it:
      </p>
      <pre aria-label="Tool server command">{command}</pre>

      <h2>Invocations</h2>
      {invocations === undefined || invocations.value.length === 0 ? (
        <p className="muted">
          No tool has been called yet. An invocation is a run with{" "}
          <code>behavior: &quot;tool&quot;</code>, so anything served from another terminal appears
          here too.
        </p>
      ) : (
        <table aria-label="Tool invocations">
          <thead>
            <tr>
              <th>Run</th>
              <th>When</th>
              <th>Invoker</th>
              <th>Exit</th>
              <th>Audit</th>
            </tr>
          </thead>
          <tbody>
            {invocations.value.map((one) => (
              <tr key={one.runId}>
                <td>{one.runId}</td>
                <td>{one.startedAt}</td>
                <td>
                  {one.invoker === undefined
                    ? ""
                    : `${one.invoker.kind} ${one.invoker.id} via ${one.invoker.via}`}
                </td>
                <td className={one.exitCode === 0 ? "passed" : "failed"}>{one.exitCode}</td>
                <td>
                  <button
                    type="button"
                    onClick={() => setOpen((current) => (current === one.runId ? undefined : one.runId))}
                  >
                    {one.audit.length} line(s)
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {open === undefined ? null : (
        <article aria-label="Audit record" className="panel">
          <h3>Audit · {open}</h3>
          <table>
            <thead>
              <tr>
                <th>Seq</th>
                <th>Kind</th>
                <th>Step</th>
                <th>Call</th>
                <th>Outcome</th>
              </tr>
            </thead>
            <tbody>
              {(invocations?.value.find((one) => one.runId === open)?.audit ?? []).map((line) => (
                <tr key={line.seq}>
                  <td>{line.seq}</td>
                  <td>{line.kind}</td>
                  <td>{line.stepId ?? line.story ?? ""}</td>
                  <td>
                    {line.call === undefined
                      ? ""
                      : `${line.call.method}${line.call.action === undefined ? "" : ` ${line.call.action}`}`}
                  </td>
                  <td>{line.outcome ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted">
            Inputs are redacted by value before a line is written, so a <code>secret</code> the
            agent passed is not in this file (REQ-NFR-6).
          </p>
        </article>
      )}

      <p className="source">Rendered from {tools?.from ?? "getTools"}.</p>
    </section>
  );
}
