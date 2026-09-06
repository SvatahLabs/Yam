/**
 * The ADE (T3.6, T3.7, T9.4, T10.3, REQ-ADE-2, REQ-ADE-11, LLD §13.6, §13.7).
 *
 * Two things live here: opening a project, and the shell that everything else
 * is inside.
 *
 * ## What Phase 10 finished
 *
 * Phase 9 rebuilt the shell and two of the twelve screens and left the other ten
 * behind a **Legacy** rail item — the Phase 3–5 tabs, with their own stylesheet
 * and their own idea of a table. T10.3 deleted them: all twelve screens are
 * `@svatah/screens` rendered by `shell/`, and there is nowhere else in this
 * application for a screen to be.
 *
 * ## Every interactive control has a name and an id
 *
 * REQ-ADE-6 and LLD §13.7: the ADE is the desktop conformance target, and a
 * Svatah flow against it has to be able to say "the Run button" and mean
 * something. That is enforced by `@svatah/ui`, whose components throw in
 * development without a visible label and an id in the `automationId` form, and
 * checked by the desktop suite's snapshot case and by
 * `apps/ade/test/shell.spec.ts`.
 */
import { useCallback, useEffect, useState } from "react";
import { bridge, type ServiceInfo } from "./bridge.js";
import { ServiceClient } from "./client.js";
import { Shell } from "./shell/Shell.js";
import { Welcome } from "./shell/Welcome.js";

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
     * A project the main process opened from `SVATAH_ADE_PROJECT` (T8.1).
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

  const client = info === null ? undefined : new ServiceClient(info);

  /*
   * No project: the welcome screen, which is not the shell. A rail over an empty
   * window would be eight rows that all say "open a project first".
   */
  if (info === null || client === undefined) {
    return <Welcome onOpen={open} log={log} {...(error === undefined ? {} : { error })} />;
  }

  return <Shell client={client} project={info.project} serviceUrl={info.url} />;
}
