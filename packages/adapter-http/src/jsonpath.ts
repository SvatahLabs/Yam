/**
 * The JSON-path subset a capture uses (REQ-ADP-2: "responses are JSON-path
 * addressable"; `Step.capture.jsonPath`).
 *
 * Deliberately a subset, and deliberately hand-written rather than a dependency:
 *
 * ```
 * $.activeCount          a field
 * $.items[0].id          an index
 * $.items[-1].id         from the end
 * $["odd key"].value     a field whose name is not an identifier
 * $.items.length         how many
 * ```
 *
 * There is no filtering, no wildcard, no recursive descent and no expression
 * language. A capture reads one value out of one response; the moment it needs a
 * predicate, what it actually needs is a custom step (Tier 0), where the logic is
 * TypeScript that a person can read and a reviewer can review. Putting a query
 * language in the flow file would move logic into a place with no types and no
 * tests.
 */

export class JsonPathError extends Error {}

interface Segment {
  readonly kind: "field" | "index";
  readonly name?: string;
  readonly index?: number;
}

/** Parse `$.a.b[0]` into segments. Throws on anything outside the subset. */
export function parseJsonPath(path: string): Segment[] {
  const text = path.trim();
  if (text === "$") return [];
  if (!text.startsWith("$")) {
    throw new JsonPathError(`"${path}" must start with "$" — the response itself.`);
  }

  const segments: Segment[] = [];
  let at = 1;

  while (at < text.length) {
    const char = text[at];

    if (char === ".") {
      at += 1;
      const start = at;
      while (at < text.length && /[A-Za-z0-9_$-]/.test(text[at]!)) at += 1;
      if (at === start) throw new JsonPathError(`"${path}" has an empty field name.`);
      segments.push({ kind: "field", name: text.slice(start, at) });
      continue;
    }

    if (char === "[") {
      const close = text.indexOf("]", at);
      if (close < 0) throw new JsonPathError(`"${path}" has an unclosed "[".`);
      const inner = text.slice(at + 1, close).trim();
      at = close + 1;

      if (/^-?\d+$/.test(inner)) {
        segments.push({ kind: "index", index: Number(inner) });
        continue;
      }
      const quoted = /^"(.*)"$|^'(.*)'$/.exec(inner);
      if (quoted !== null) {
        segments.push({ kind: "field", name: quoted[1] ?? quoted[2] ?? "" });
        continue;
      }
      throw new JsonPathError(
        `"${path}": "[${inner}]" is not an index or a quoted field name. ` +
          "This is a small subset of JSON-path on purpose; a query needs a custom step.",
      );
    }

    throw new JsonPathError(`"${path}" has an unexpected character at position ${at}.`);
  }

  return segments;
}

/** Read a path out of a parsed body. `undefined` when it is not there. */
export function readJsonPath(body: unknown, path: string): unknown {
  let cursor: unknown = body;

  for (const segment of parseJsonPath(path)) {
    if (cursor === null || cursor === undefined) return undefined;

    if (segment.kind === "index") {
      if (!Array.isArray(cursor)) return undefined;
      const index = segment.index! < 0 ? cursor.length + segment.index! : segment.index!;
      cursor = cursor[index];
      continue;
    }

    // `length` on an array reads its length, which is what someone means by
    // `$.items.length` and is not a field lookup.
    if (segment.name === "length" && Array.isArray(cursor)) {
      cursor = cursor.length;
      continue;
    }
    if (typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[segment.name!];
  }

  return cursor;
}
