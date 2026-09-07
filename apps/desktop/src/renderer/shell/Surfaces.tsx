/**
 * Surfaces — the connect flow, and the sessions that are open (T14, SF-02,
 * SF-04, SF-05, SF-16, SF-17).
 *
 * The screen the app opens into. Everything on it is the model's
 * (`@svatah/yam-screens`'s `SurfacesState`), which is a `GET /targets` and
 * `GET /sessions` answer from the broker; this file decides only where each
 * thing goes on the page. The connect form sends a URL to `POST /sessions`
 * through the one action registry, and the session that comes back shows the
 * adapter the service *used*, not the one that was asked for.
 *
 * The selected-target action inspector — filling a field, checking it, the
 * dispatch-and-verification of an action — is T15. This screen gets a person to
 * a connected session and shows what is connected.
 */
import { useState } from "react";
import { Alert, Button, Chooser, Field, InspectorSection, KeyValues, Pill, Table } from "@svatah/yam-ui";
import type { SurfacesState, SurfaceAdapterRow } from "@svatah/yam-screens";
import { Toolbar, EmptyInspector } from "./parts.js";
import type { ScreenProps } from "./Secondary.js";

/** `Browser` → `browser`, for an `automationId` a desktop flow can address. */
const slug = (text: string): string => text.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();

export function SurfacesScreen(props: ScreenProps<SurfacesState>): React.JSX.Element {
  const { state } = props;

  /*
   * The URL and the chosen adapter are the window's, not screen parameters
   * (K7's pattern, the API screen's `draft`): what a person is typing before
   * they connect is not what the screen re-loads with. Holding them as
   * parameters made the model re-load on every keystroke — a reload storm that
   * raced selection — so they live here and are handed to the connect action
   * the way `api.send` hands over the request in the form.
   */
  const [url, setUrl] = useState("");
  const [adapter, setAdapter] = useState("");

  // Every adapter the service reported, so the Advanced chooser can offer them —
  // unavailable ones disabled, so a person cannot ask for one that cannot run.
  const adapterOptions = [
    { value: "", label: "Automatic" },
    ...state.groups.flatMap((group) =>
      group.adapters.map((one) => ({
        value: one.adapter,
        label: one.available ? one.adapter : `${one.adapter} (unavailable)`,
        disabled: !one.available,
      })),
    ),
  ];

  const connect = props.actions.find((one) => one.id === "surface.connect");
  // Connect is the connect *bar*'s primary, not a toolbar button (T14): a URL
  // field is too wide for the 40px toolbar and overlapped the buttons there at
  // 1440×1000. The toolbar keeps the secondary actions; the connect form is its
  // own row, which is also the design's "one primary button Connect surface".
  const toolbarActions = props.actions.filter((one) => one.id !== "surface.connect");
  // The URL and adapter in the form, not the parameters, are what a connect sends.
  const doConnect = (): void => props.onAction("surface.connect", { url, adapter });

  return (
    <>
      <Toolbar state={state} actions={toolbarActions} onAction={props.onAction} />

      <div className="sv-surfaces-connect" role="group" aria-label="Connect a surface">
        <Field
          id="surfaces-url"
          label="URL"
          value={url}
          placeholder="http://127.0.0.1:4173"
          monospace
          onChange={setUrl}
          onSubmit={doConnect}
        />
        <Chooser
          id="surfaces-adapter"
          label="Adapter"
          value={adapter}
          options={adapterOptions}
          onChange={setAdapter}
        />
        <Button
          id="action-surface-connect"
          label="Connect surface"
          variant="primary"
          {...(connect?.key === undefined ? {} : { accelerator: connect.key })}
          disabled={connect === undefined ? false : !connect.availableWhen(state as never)}
          onPress={doConnect}
        />
      </div>

      {state.discoveryMessage === undefined ? null : (
        <Alert id="surfaces-discovery-error" tone="abort">
          {state.discoveryMessage} Press <b>Recheck targets</b> to try again — the connect form still
          works and starts the broker when you use it.
        </Alert>
      )}

      <div className="sv-main">
        <aside className="sv-list" id="surfaces-sessions-pane" aria-label="Open sessions">
          <Table<SurfacesState["sessions"][number]>
            id="surfaces-sessions"
            label="Open sessions"
            rows={[...state.sessions]}
            rowKey={(row) => row.sessionId}
            selected={state.selected ?? ""}
            onSelect={(selected) => props.onParams({ ...props.params, selected })}
            empty="Choose a browser, app, device or API to control. Enter a URL above and press Connect surface."
            columns={[
              {
                key: "session",
                header: "session",
                cell: (row) => (
                  <span className="sv-flow-row">
                    <span className="sv-flow-name sv-mono">{row.sessionId}</span>
                    <span className="sv-flow-meta">
                      {row.adapter}
                      {row.kind === "" ? "" : ` · ${row.kind}`}
                    </span>
                  </span>
                ),
              },
              {
                key: "status",
                header: "status",
                cell: (row) => <Pill tone={row.pill.tone} label={row.pill.label} />,
              },
            ]}
          />
        </aside>

        <div className="sv-editor" id="surfaces-discovery" aria-label="What you can connect to">
          {state.groups.length === 0 ? (
            <p className="sv-empty">
              No adapter is installed. `yam surface targets` shows the same list from a terminal.
            </p>
          ) : (
            state.groups.map((group) => (
              <section
                key={group.family}
                className="sv-surface-group"
                id={`surfaces-group-${slug(group.family)}`}
                aria-labelledby={`surfaces-group-${slug(group.family)}-heading`}
              >
                <h3
                  className="sv-inspector-heading"
                  id={`surfaces-group-${slug(group.family)}-heading`}
                >
                  {group.family}
                </h3>
                <Table<SurfaceAdapterRow>
                  id={`surfaces-adapters-${slug(group.family)}`}
                  label={`${group.family} adapters`}
                  rows={[...group.adapters]}
                  rowKey={(row) => row.adapter}
                  empty="No adapter here."
                  columns={[
                    { key: "adapter", header: "adapter", monospace: true, cell: (row) => row.adapter },
                    {
                      key: "status",
                      header: "status",
                      cell: (row) => <Pill tone={row.pill.tone} label={row.pill.label} />,
                    },
                    {
                      key: "requires",
                      header: "requires",
                      // The exact reason it is unavailable, or the prerequisite —
                      // never hidden (SF-04, SF-17).
                      cell: (row) =>
                        row.available ? (
                          <span className="sv-muted">ready</span>
                        ) : (
                          <span className="sv-tone-abort">
                            {row.reason ?? row.prerequisites.join(", ") ?? "unavailable"}
                          </span>
                        ),
                    },
                  ]}
                />
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}

export function SurfacesInspector(props: ScreenProps<SurfacesState>): React.JSX.Element {
  const { state } = props;
  const session = state.sessions.find((one) => one.selected);

  if (session === undefined) {
    return (
      <EmptyInspector id="inspector-empty" title="Inspector">
        Choose an open session to inspect it, or connect a new surface. Nothing here needs a
        project.
      </EmptyInspector>
    );
  }

  return (
    <>
      <InspectorSection id="inspector-session" title="Session">
        <KeyValues
          rows={[
            { key: "Session", value: <span className="sv-mono">{session.sessionId}</span> },
            { key: "Adapter", value: <span className="sv-mono">{session.adapter}</span> },
            { key: "Kind", value: session.kind === "" ? "—" : session.kind },
            { key: "Status", value: <Pill tone={session.pill.tone} label={session.pill.label} /> },
            ...(session.targetId === undefined
              ? []
              : [{ key: "Target", value: <span className="sv-mono">{session.targetId}</span> }]),
          ]}
        />
        <p className="sv-card">
          One session, whoever opened it — a person here or an agent over MCP. Disconnecting a
          session you attached to leaves the application it is driving open.
        </p>
      </InspectorSection>
    </>
  );
}
