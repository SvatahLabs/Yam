/**
 * Templating inside an `ApiRequest` (REQ-ADP-2, LLD §7.2).
 *
 * A request file is written once and run against whatever the project's data
 * says: `url: "{data.baseUrl}/api/active-count"`. Every string field is expanded
 * — url, headers, query, path params, form fields, the body — from the same
 * scope a step reads (LLD §8.5), so a request is not a second, weaker variable
 * system beside the one a flow already has.
 *
 * ## Path parameters are separate, and substituted separately
 *
 * `pathParams` fills `:name` and `{name}` in the URL *path*, which is a different
 * thing from a `{data.…}` reference and is why both exist. `:id` in a path is
 * REST; `{data.id}` is a reference to the run's data. Doing them in one pass
 * would make `{id}` ambiguous.
 */

/** What a template can read. `{data.x}`, `{input.x}`, `{x}` and `{Story.x}`. */
export interface TemplateScope {
  read(reference: string): unknown;
}

/** `{…}` — anything that is not a path parameter placeholder. */
const REFERENCE = /\{([^}]+)\}/g;

/** Expand every `{…}` in a string. A reference with no value becomes empty. */
export function expand(text: string, scope: TemplateScope): string {
  return text.replace(REFERENCE, (whole, reference: string) => {
    const value = scope.read(reference.trim());
    return value === undefined || value === null ? whole : String(value);
  });
}

/** Expand every string in a record. */
export function expandRecord(
  record: Readonly<Record<string, string>> | undefined,
  scope: TemplateScope,
): Record<string, string> | undefined {
  if (record === undefined) return undefined;
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, expand(value, scope)]),
  );
}

/**
 * Substitute `:name` and `{name}` in a URL path from `pathParams`.
 *
 * Values are percent-encoded: a path parameter is one segment, and a value
 * containing `/` that was pasted in raw would change the route rather than fill
 * a slot in it.
 */
export function fillPathParams(
  url: string,
  params: Readonly<Record<string, string>> | undefined,
): string {
  if (params === undefined) return url;
  let out = url;
  for (const [name, value] of Object.entries(params)) {
    const encoded = encodeURIComponent(value);
    out = out.split(`:${name}`).join(encoded).split(`{${name}}`).join(encoded);
  }
  return out;
}
