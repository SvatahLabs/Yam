/**
 * The flow editor, with inline lint (T3.7, REQ-ADE-3, LLD §13.6).
 *
 * "Flow editor (`GET/PUT /flows/:file`, `POST /compile` for inline lint, custom
 * step list from `GET /project`)."
 *
 * A textarea, a Save button, and the compiler's own diagnostics beside it. There
 * is no editor here worth the name — no syntax highlighting, no completion — and
 * that is deliberate for this phase: the thing that makes a prose flow editable
 * is that someone can see what the compiler thinks of it as they type, and every
 * hour spent on a highlighter is an hour not spent on the diagnostics being
 * right.
 *
 * ## Where the lint comes from
 *
 * `POST /compile`, which is the same function `svatah lint --json` calls. Not a
 * client-side re-implementation of the grammar, however tempting for latency: two
 * grammars is how an editor starts underlining things a build does not mind, and
 * T3.7's Validate item — "lint warnings in the editor match `svatah lint --json`"
 * — would be a coincidence rather than a consequence.
 *
 * The cost is that lint is per-save rather than per-keystroke. `Compile` is a
 * button, and it says what it is doing.
 */
import { useCallback, useEffect, useState } from "react";
import { fromEndpoint, ServiceError, type ScreenData, type ServiceClient } from "../client.js";

interface Diagnostic {
  severity: string;
  code?: string;
  message?: string;
  file?: string;
  line?: number;
}

interface CompileResult {
  ok: boolean;
  plan: { hash: string; stories: number };
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

export function FlowEditorScreen({ client }: { client: ServiceClient }): React.JSX.Element {
  const [flows, setFlows] = useState<readonly string[]>([]);
  const [customSteps, setCustomSteps] = useState<readonly string[]>([]);
  const [file, setFile] = useState<string | undefined>(undefined);
  const [text, setText] = useState("");
  const [dirty, setDirty] = useState(false);
  const [compiled, setCompiled] = useState<ScreenData<CompileResult> | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    void client.getProject().then((value) => {
      const summary = value as { flows: string[]; customSteps: string[] };
      setFlows(summary.flows);
      setCustomSteps(summary.customSteps);
      setFile((current) => current ?? summary.flows[0]);
    });
  }, [client]);

  useEffect(() => {
    if (file === undefined) return;
    setError(undefined);
    // `flows/simple.flow` is addressed as `/flows/simple.flow`: the route's
    // parameter is the path under the flows directory, not the whole path.
    void client
      .getFlowsByFile(file.replace(/^flows\//, ""))
      .then((value) => {
        setText(String(value));
        setDirty(false);
      })
      .catch((cause: unknown) => setError(String(cause)));
  }, [client, file]);

  const compile = useCallback(async () => {
    setBusy(true);
    setError(undefined);
    try {
      const value = (await client.postCompile()) as CompileResult;
      setCompiled(fromEndpoint("postCompile", value));
    } catch (cause) {
      setError(cause instanceof ServiceError ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [client]);

  const save = useCallback(async () => {
    if (file === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await client.putFlowsByFile(file.replace(/^flows\//, ""), text);
      setDirty(false);
      // Saving and compiling are one gesture: an editor that lets a person save
      // and then wonder is an editor that makes them run the CLI to find out.
      await compile();
    } catch (cause) {
      setError(cause instanceof ServiceError ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, [client, compile, file, text]);

  const diagnosticsFor = (line: number): Diagnostic[] =>
    [...(compiled?.value.errors ?? []), ...(compiled?.value.warnings ?? [])].filter(
      (one) => one.line === line,
    );

  return (
    <section aria-label="Flow editor">
      <div className="row">
        <label htmlFor="flow-file">Flow</label>
        <select
          id="flow-file"
          value={file ?? ""}
          onChange={(event) => setFile(event.target.value)}
          style={{ width: "auto" }}
        >
          {flows.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>
        <button type="button" onClick={() => void save()} disabled={busy || !dirty}>
          Save and compile
        </button>
        <button type="button" onClick={() => void compile()} disabled={busy}>
          Compile
        </button>
        {dirty ? <span className="muted">unsaved</span> : null}
      </div>

      {error !== undefined ? (
        <p role="alert" className="error">
          {error}
        </p>
      ) : null}

      <div className="split">
        <div>
          <label htmlFor="flow-text" className="muted">
            {file ?? "no flow selected"}
          </label>
          <textarea
            id="flow-text"
            aria-label="Flow source"
            rows={26}
            spellCheck={false}
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setDirty(true);
            }}
          />
          {customSteps.length > 0 ? (
            <>
              <h3>Custom steps in this project</h3>
              <ul className="muted">
                {customSteps.map((one) => (
                  <li key={one}>{one}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>

        <div>
          <h3>Lint</h3>
          {compiled === undefined ? (
            <p className="muted">Compile to see diagnostics.</p>
          ) : (
            <>
              <p className={compiled.value.ok ? "passed" : "failed"}>
                {compiled.value.ok ? "Compiles" : "Does not compile"} · plan{" "}
                {compiled.value.plan.hash.slice(0, 12)} · {compiled.value.plan.stories} story(ies)
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Line</th>
                    <th>Severity</th>
                    <th>Code</th>
                    <th>Message</th>
                  </tr>
                </thead>
                <tbody>
                  {[...compiled.value.errors, ...compiled.value.warnings].map((one, at) => (
                    <tr key={at}>
                      <td>{one.line ?? ""}</td>
                      <td className={one.severity === "error" ? "failed" : ""}>{one.severity}</td>
                      <td>{one.code ?? ""}</td>
                      <td>{one.message ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {text.split("\n").some((_, at) => diagnosticsFor(at + 1).length > 0) ? (
                <>
                  <h3>Inline</h3>
                  <pre aria-label="Flow with diagnostics">
                    {text
                      .split("\n")
                      .map((line, at) => {
                        const here = diagnosticsFor(at + 1);
                        return here.length === 0
                          ? `${String(at + 1).padStart(3)} │ ${line}`
                          : `${String(at + 1).padStart(3)} │ ${line}\n    │ ↑ ${here
                              .map((one) => `${one.severity}: ${one.message ?? one.code ?? ""}`)
                              .join("; ")}`;
                      })
                      .join("\n")}
                  </pre>
                </>
              ) : null}
              <p className="source">Rendered from {compiled.from}.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
