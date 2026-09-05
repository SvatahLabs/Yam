/**
 * `.data` files as `data.yaml` (REQ-LANG-9, REQ-NFR-6).
 *
 * The old format is `key = value` lines. The migration is nearly a rename, with
 * one judgement in it: a value whose *key* names a secret becomes a `${ENV}`
 * indirection and is listed under `secrets:`, rather than being carried across
 * in plain text.
 *
 * That is a deliberate choice to break the migration rather than to preserve it.
 * A `.data` file with a password in it was already a password in a repository;
 * copying it into `data.yaml` would make the new file exactly as unsafe, and the
 * whole point of the `secrets:` list is that the file stops being unsafe. The
 * review report names every value that was turned into an indirection so nobody
 * discovers it at run time.
 */

/** Key fragments that make a value a secret. */
const SECRET_WORDS = ["password", "passwd", "secret", "token", "apikey", "api_key", "cvv", "card"];

export interface MigratedData {
  readonly values: Record<string, unknown>;
  readonly secrets: readonly string[];
  /** Keys turned into `${ENV}` indirections, and the variable each now reads. */
  readonly redacted: ReadonlyArray<{ key: string; variable: string }>;
}

export function looksSecret(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_WORDS.some((word) => lower.includes(word));
}

/** `user.password` → `SVATAH_USER_PASSWORD`. */
export function environmentName(key: string): string {
  return `SVATAH_${key.replace(/[^A-Za-z0-9]+/g, "_").toUpperCase()}`;
}

export function migrateData(text: string): MigratedData {
  const values: Record<string, unknown> = {};
  const secrets: string[] = [];
  const redacted: Array<{ key: string; variable: string }> = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#") || line.startsWith("//")) continue;
    const at = line.indexOf("=");
    if (at < 0) continue;

    const key = line.slice(0, at).trim();
    const value = line.slice(at + 1).trim();
    if (key === "") continue;

    if (looksSecret(key)) {
      const variable = environmentName(key);
      setPath(values, key, `\${${variable}}`);
      secrets.push(key);
      redacted.push({ key, variable });
      continue;
    }
    setPath(values, key, value);
  }

  return { values, secrets, redacted };
}

function setPath(tree: Record<string, unknown>, path: string, value: unknown): void {
  const segments = path.split(".");
  const last = segments.pop()!;
  let cursor = tree;
  for (const segment of segments) {
    const next = cursor[segment];
    if (typeof next !== "object" || next === null || Array.isArray(next)) cursor[segment] = {};
    cursor = cursor[segment] as Record<string, unknown>;
  }
  cursor[last] = value;
}
