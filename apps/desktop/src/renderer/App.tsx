/**
 * The app (T3.6, T3.7, T9.4, T10.3, REQ-ADE-2, REQ-ADE-11, LLD §13.6, §13.7).
 *
 * Two things live here: opening a project, and the shell that everything else
 * is inside.
 *
 * ## What Phase 10 finished
 *
 * Phase 9 rebuilt the shell and two of the twelve screens and left the other ten
 * behind a **Legacy** rail item — the Phase 3–5 tabs, with their own stylesheet
 * and their own idea of a table. T10.3 deleted them: all twelve screens are
 * `@svatah/yam-screens` rendered by `shell/`, and there is nowhere else in this
 * application for a screen to be.
 *
 * ## Every interactive control has a name and an id
 *
 * REQ-ADE-6 and LLD §13.7: the app is the desktop conformance target, and a
 * Yam flow against it has to be able to say "the Run button" and mean
 * something. That is enforced by `@svatah/yam-ui`, whose components throw in
 * development without a visible label and an id in the `automationId` form, and
 * checked by the desktop suite's snapshot case and by
 * `apps/desktop/test/shell.spec.ts`.
 */
import { useCallback, useEffect, useState } from "react";
import { bridge, type ServiceInfo } from "./bridge.js";
import { ServiceClient } from "./client.js";
import { Shell } from "./shell/Shell.js";
import { Welcome } from "./shell/Welcome.js";
import { useThemeRoot } from "./theme.js";

/**
 * The window while the service is opening (SF-17's `loading`).
 *
 * Deliberately plain, and deliberately not a chooser: nothing here asks for a
 * decision, because nothing has failed and the answer is a moment away.
 */
function Starting(props: { log: readonly string[] }): React.JSX.Element {
  return (
    <div className="sv-welcome" id="screen-starting">
      <header className="sv-welcome-head">
        <span className="sv-brand">
          <span className="sv-brand-mark" aria-hidden="true" />
          Yam
        </span>
        <p className="sv-empty" role="status">
          Starting…
        </p>
      </header>
      {props.log.length === 0 ? null : (
        <pre className="sv-block" aria-label="Startup log">
          {props.log.slice(-8).join("\n")}
        </pre>
      )}
    </div>
  );
}

export function App(): React.JSX.Element {
  const [info, setInfo] = useState<ServiceInfo | null>(null);
  const [error, setError] = useState<string | undefined>(undefined);
  const [log, setLog] = useState<readonly string[]>([]);

  useEffect(() => {
    void bridge()
      .serviceInfo()
      .then(setInfo)
      .catch(() => undefined);
    const offLog = bridge().onServiceLog((line) => setLog((lines) => [...lines.slice(-40), line]));
    /*
     * A project the main process opened from `YAM_APP_PROJECT` (T8.1).
     *
     * The same two outcomes the Recent list has — the window opens on the Flows
     * screen, or the alert does — for a launch nobody clicked. §13.6: "the
     * desktop conformance gate passes the fixtures project this way, so its
     * cases read a project screen rather than the welcome screen."
     */
    const offOpened = bridge().onServiceOpened((event) => {
      if (event.connection !== undefined) {
        setInfo(event.connection);
        setError(undefined);
        return;
      }
      setError(event.error ?? "The project could not be opened.");
    });
    return () => {
      offLog();
      offOpened();
    };
  }, []);

  const open = useCallback(async (directory: string) => {
    setError(undefined);
    try {
      setInfo(await bridge().openProject(directory));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, []);

  /*
   * The appearance, before any branch below returns (TV-18).
   *
   * It used to be `Shell`'s, which left `Starting` and `Welcome` — the first two
   * screens anybody sees — with no theme, no font and no brand mark.
   */
  const theme = useThemeRoot();

  const client = info === null ? undefined : new ServiceClient(info);

  /*
   * Starting up is a **loading** state, not a project chooser (T18, SF-02,
   * SF-16, SF-17).
   *
   * The main process opens a projectless service on ready and announces it over
   * `service:opened`; until that lands, `info` is null. This branch used to
   * render the welcome screen for that moment — so on any machine that has ever
   * opened a project, the first thing a person saw was the old project chooser
   * with their recents on it, and Surfaces arrived a second later. "Surfaces is
   * the default screen" was true of the second second and not the first.
   *
   * It survived three waves because the browser-hosted harness stubs the
   * preload bridge with `recentProjects: []` and answers `serviceInfo()`
   * immediately, so it never saw the state that exists on a real machine. The
   * packaged application, launched cold in T18, opened straight onto it.
   *
   * The welcome screen still exists and is still where a failure lands: an
   * error means the service did not open, and a person needs the chooser and
   * the log.
   */
  if ((info === null || client === undefined) && error === undefined) {
    return <Starting log={log} />;
  }
  if (info === null || client === undefined) {
    return <Welcome onOpen={open} log={log} {...(error === undefined ? {} : { error })} />;
  }

  return (
    <Shell
      theme={theme}
      client={client}
      project={info.project}
      projectless={info.projectless === true}
      serviceUrl={info.url}
      onOpenProject={open}
    />
  );
}
