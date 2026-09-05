/**
 * The API client (T3.7, REQ-ADE-3, LLD §13.6).
 *
 * "API client (`POST /api/request`, `GET/PUT /api/:name`)."
 *
 * The prototype's API client is one of the jobs ADR-17 says a desktop client
 * must do, and this is it around the new artifacts: a request is an `ApiRequest`,
 * the same object a flow's `Call the "active count" API` step names, saved to
 * `api/<name>.yaml` where the flow will find it.
 *
 * ## Why it goes through the service
 *
 * `POST /api/request` executes it with the HTTP adapter a run uses. An ADE with
 * its own `fetch` would have its own idea of a header, a redirect and a cookie,
 * and "it worked in the API client" would stop meaning "it will work in the
 * flow" — which is the only reason to have an API client in an automation tool
 * at all.
 */
import { useCallback, useEffect, useState } from "react";
import { fromEndpoint, ServiceError, type ScreenData, type ServiceClient } from "../client.js";

interface ApiRequest {
  name: string;
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}

interface ApiResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
  json?: unknown;
  durationMs?: number;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"];

export function ApiClientScreen({ client }: { client: ServiceClient }): React.JSX.Element {
  const [saved, setSaved] = useState<ScreenData<ApiRequest[]> | undefined>(undefined);
  const [request, setRequest] = useState<ApiRequest>({ name: "new request", method: "GET", url: "/" });
  const [headers, setHeaders] = useState("");
  const [body, setBody] = useState("");
  const [response, setResponse] = useState<ScreenData<ApiResponse> | undefined>(undefined);
  const [withCookies, setWithCookies] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const reload = useCallback(async () => {
    setSaved(fromEndpoint("getApi", (await client.getApi()) as ApiRequest[]));
  }, [client]);

  useEffect(() => {
    void reload().catch((cause: unknown) => setError(String(cause)));
  }, [reload]);

  const load = (one: ApiRequest): void => {
    setRequest(one);
    setHeaders(
      Object.entries(one.headers ?? {})
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n"),
    );
    setBody(one.body === undefined ? "" : typeof one.body === "string" ? one.body : JSON.stringify(one.body, null, 2));
    setResponse(undefined);
  };

  const assembled = (): ApiRequest => ({
    ...request,
    headers: Object.fromEntries(
      headers
        .split("\n")
        .map((line) => line.split(/:(.*)/s))
        .filter((parts) => parts.length > 1 && parts[0]!.trim() !== "")
        .map((parts) => [parts[0]!.trim(), (parts[1] ?? "").trim()]),
    ),
    ...(body.trim() === "" ? {} : { body }),
  });

  const send = async (): Promise<void> => {
    setError(undefined);
    setResponse(undefined);
    try {
      const value = (await client.postApiRequest({
        request: assembled(),
        withSessionCookies: withCookies,
      })) as ApiResponse;
      setResponse(fromEndpoint("postApiRequest", value));
    } catch (cause) {
      setError(cause instanceof ServiceError ? cause.body : String(cause));
    }
  };

  const save = async (): Promise<void> => {
    setError(undefined);
    try {
      await client.putApiByName(request.name, assembled());
      await reload();
    } catch (cause) {
      setError(cause instanceof ServiceError ? cause.body : String(cause));
    }
  };

  return (
    <section aria-label="API client">
      <div className="row">
        <label htmlFor="api-saved">Saved requests</label>
        <select
          id="api-saved"
          value=""
          onChange={(event) => {
            const found = saved?.value.find((one) => one.name === event.target.value);
            if (found !== undefined) load(found);
          }}
          style={{ width: "auto" }}
        >
          <option value="">choose…</option>
          {(saved?.value ?? []).map((one) => (
            <option key={one.name} value={one.name}>
              {one.name}
            </option>
          ))}
        </select>
      </div>

      <div className="row">
        <label htmlFor="api-method" className="muted">
          Method
        </label>
        <select
          id="api-method"
          value={request.method}
          onChange={(event) => setRequest({ ...request, method: event.target.value })}
          style={{ width: "auto" }}
        >
          {METHODS.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>
        <input
          type="text"
          aria-label="Request URL"
          className="grow"
          value={request.url}
          onChange={(event) => setRequest({ ...request, url: event.target.value })}
        />
        <button type="button" onClick={() => void send()}>
          Send
        </button>
      </div>

      <div className="row">
        <label htmlFor="api-name" className="muted">
          Name
        </label>
        <input
          id="api-name"
          type="text"
          value={request.name}
          onChange={(event) => setRequest({ ...request, name: event.target.value })}
          style={{ maxWidth: 260 }}
        />
        <button type="button" onClick={() => void save()}>
          Save to api/{request.name}.yaml
        </button>
        <label>
          <input
            type="checkbox"
            checked={withCookies}
            onChange={(event) => setWithCookies(event.target.checked)}
          />{" "}
          Share the session&apos;s cookies (REQ-ADP-3)
        </label>
      </div>

      <div className="split">
        <div>
          <label htmlFor="api-headers" className="muted">
            Headers, one per line
          </label>
          <textarea
            id="api-headers"
            rows={6}
            value={headers}
            onChange={(event) => setHeaders(event.target.value)}
          />
          <label htmlFor="api-body" className="muted">
            Body
          </label>
          <textarea
            id="api-body"
            rows={10}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </div>

        <div>
          <h3>Response</h3>
          {error !== undefined ? (
            <pre role="alert" className="error">
              {error}
            </pre>
          ) : response === undefined ? (
            <p className="muted">Send a request to see one.</p>
          ) : (
            <>
              <p className={response.value.status < 400 ? "passed" : "failed"}>
                {response.value.status}
                {response.value.durationMs === undefined
                  ? ""
                  : ` · ${Math.round(response.value.durationMs)} ms`}
              </p>
              <pre aria-label="Response body">
                {response.value.json === undefined
                  ? (response.value.body ?? "")
                  : JSON.stringify(response.value.json, null, 2)}
              </pre>
              <p className="source">Rendered from {response.from}.</p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
