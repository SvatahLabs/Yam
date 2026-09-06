/**
 * The welcome screen: the app with no project open (T10.3, LLD §13.6).
 *
 * Not one of the twelve. Every screen of LLD §13.7 is a view over a project's
 * service, and with no project there is no service to view — a rail over an
 * empty window would be eight rows that all say "open a project first". So this
 * is the one thing the app draws that is not `@svatah/yam-screens`, and it does
 * exactly two things: open a directory, and say why the last attempt did not.
 *
 * It replaces the Phase 3 Project screen, whose *other* job — showing what
 * `GET /project` says is in the open project — is now the Settings screen's
 * (T10.2). Both of the Phase 8 verification's findings on that screen are kept:
 * every button is named and id'd (P8-F3), and a packaged app that cannot resolve
 * a Node runtime renders an alert naming the three places it looked (§13.6).
 */
import { Alert, Button } from "@svatah/yam-ui";
import { useEffect, useState } from "react";
import { bridge } from "../bridge.js";
import { a11yVariant } from "../a11y-variant.js";

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

export function Welcome({
  onOpen,
  log,
  error,
}: {
  readonly onOpen: (directory: string) => Promise<void>;
  readonly log: readonly string[];
  readonly error?: string;
}): React.JSX.Element {
  const [recent, setRecent] = useState<readonly string[]>([]);

  useEffect(() => {
    void bridge()
      .preferences()
      .then((one) => setRecent(one.recentProjects))
      .catch(() => undefined);
  }, []);

  const choose = async (): Promise<void> => {
    const directory = await bridge().pickFile("directory");
    if (directory !== null) await onOpen(directory);
  };

  return (
    <div className="sv-welcome" id="screen-welcome">
      <header className="sv-welcome-head">
        <span className="sv-brand">
          <span className="sv-brand-mark" aria-hidden="true" />
          Yam
        </span>
        <p className="sv-empty">
          A project directory is the only source of truth. Everything this window shows is a file
          the CLI also reads or writes.
        </p>
      </header>

      <div className="sv-welcome-actions">
        {/*
          Variant 1 renames this button and nothing else about it (Draft 2.8
          §16). The `id` is what survives — it is the `automationId` the desktop
          adapters read, and the healing case's ground-truth key.
        */}
        <Button
          id="project-open"
          label={a11yVariant() === 1 ? "Choose a project…" : "Open a project…"}
          variant="primary"
          onPress={() => void choose()}
        />
        {recent.slice(0, 3).map((one, at) => (
          <Button
            key={one}
            id={`project-recent-${at}`}
            label={recentLabel(one)}
            title={one}
            onPress={() => void onOpen(one)}
          />
        ))}
      </div>

      {error === undefined ? null : (
        <Alert id="project-error" tone="fail">
          {error}
        </Alert>
      )}

      {log.length === 0 ? null : (
        <details className="sv-welcome-log">
          <summary>Service log</summary>
          <pre className="sv-block">{log.join("\n")}</pre>
        </details>
      )}
    </div>
  );
}
