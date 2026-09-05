/**
 * The data editor (T3.7, REQ-ADE-3, LLD §13.6).
 *
 * "Data (`GET/PUT /data`)", with secrets masked.
 *
 * ## The masking is not cosmetic
 *
 * `GET /data` replaces every value the project declared secret with `«redacted»`
 * before it leaves the service, so the renderer never holds one (REQ-NFR-6). The
 * editor therefore *cannot* show a secret, and a field that reads `«redacted»`
 * is not a hidden value — it is the absence of one.
 *
 * Which makes writing the interesting half: a naive save would store that marker
 * over the real value and quietly destroy it. `PUT /data` treats a value that
 * comes back still redacted as "unchanged", so the file keeps what it had. The
 * only way to change a secret is to change the environment it indirects to,
 * which is where a secret belongs.
 */
import { useCallback, useEffect, useState } from "react";
import { fromEndpoint, ServiceError, type ScreenData, type ServiceClient } from "../client.js";

const REDACTED = "«redacted»";

interface Data {
  values: Record<string, unknown>;
  secrets: string[];
}

interface Field {
  path: string;
  value: string;
  secret: boolean;
}

export function DataScreen({ client }: { client: ServiceClient }): React.JSX.Element {
  const [data, setData] = useState<ScreenData<Data> | undefined>(undefined);
  const [fields, setFields] = useState<readonly Field[]>([]);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  const reload = useCallback(async () => {
    const value = (await client.getData()) as Data;
    setData(fromEndpoint("getData", value));
    setFields(flatten(value.values, new Set(value.secrets)));
    setSaved(false);
  }, [client]);

  useEffect(() => {
    void reload().catch((cause: unknown) => setError(String(cause)));
  }, [reload]);

  const save = useCallback(async () => {
    setError(undefined);
    try {
      await client.putData({ values: unflatten(fields) });
      await reload();
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof ServiceError ? cause.body : String(cause));
    }
  }, [client, fields, reload]);

  if (data === undefined) return <p className="muted">Loading…</p>;

  return (
    <section aria-label="Data">
      <div className="row">
        <button type="button" onClick={() => void save()}>
          Save data.yaml
        </button>
        {saved ? <span className="passed">saved</span> : null}
      </div>

      {error !== undefined ? (
        <pre role="alert" className="error">
          {error}
        </pre>
      ) : null}

      <p className="muted">
        {data.value.secrets.length} value(s) are declared secret and never leave the service. A
        field showing <code>{REDACTED}</code> is not a hidden value; it is the absence of one, and
        saving it leaves the file&apos;s value alone.
      </p>

      <table>
        <thead>
          <tr>
            <th>Path</th>
            <th>Value</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field, at) => (
            <tr key={field.path}>
              <td>
                <label htmlFor={`data-${field.path}`}>{field.path}</label>
                {field.secret ? <span className="muted"> · secret</span> : null}
              </td>
              <td>
                <input
                  id={`data-${field.path}`}
                  type="text"
                  aria-label={field.path}
                  value={field.value}
                  onChange={(event) =>
                    setFields((current) =>
                      current.map((one, index) =>
                        index === at ? { ...one, value: event.target.value } : one,
                      ),
                    )
                  }
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="source">Rendered from {data.from}.</p>
    </section>
  );
}

/** `{ user: { email } }` → `user.email`, so a table can show a tree. */
function flatten(
  tree: Record<string, unknown>,
  secrets: ReadonlySet<string>,
  prefix = "",
): Field[] {
  const out: Field[] = [];
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      out.push(...flatten(value as Record<string, unknown>, secrets, path));
    } else {
      out.push({ path, value: value === null ? "" : String(value), secret: secrets.has(path) });
    }
  }
  return out;
}

/** And back, so what is saved has the shape the file had. */
function unflatten(fields: readonly Field[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const segments = field.path.split(".");
    let cursor = out;
    for (const segment of segments.slice(0, -1)) {
      if (typeof cursor[segment] !== "object" || cursor[segment] === null) cursor[segment] = {};
      cursor = cursor[segment] as Record<string, unknown>;
    }
    cursor[segments[segments.length - 1]!] = field.value;
  }
  return out;
}
