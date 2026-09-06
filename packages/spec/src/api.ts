/**
 * Named API requests (REQ-LANG-8, REQ-ADP-2, `docs/flow-language.md` pattern 26).
 *
 * `api/*.yaml` holds one request per file. A step says
 * `Call the "active count" API and remember the response as n`, and the name in
 * the sentence is the `name:` in the file — not the filename, so renaming a file
 * does not break a flow.
 *
 * The shape is `apiRequestSchema` from `@svatah/yam-schema`, which is the same shape
 * the HTTP adapter executes (T2.6) and the same shape the published JSON Schema
 * describes. Validating here rather than at run time means a typo in a header
 * name fails the compile, where the line number is known.
 */
import { parse } from "yaml";
import { apiRequestSchema, type ApiRequest } from "@svatah/yam-schema";
import { diagnostic, type Diagnostic } from "./diagnostics.js";

export interface ApiCatalogue {
  /** Request name → the request. */
  readonly requests: ReadonlyMap<string, ApiRequest>;
  /** Request name → the file it came from, for diagnostics. */
  readonly files: ReadonlyMap<string, string>;
}

export const EMPTY_APIS: ApiCatalogue = { requests: new Map(), files: new Map() };

/**
 * Read one `api/*.yaml`.
 *
 * `name` defaults to the file's basename when the file does not declare one, so
 * a one-request project need not repeat itself.
 */
export function readApiRequest(
  text: string,
  file: string,
  fallbackName: string,
): { request: ApiRequest | undefined; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];

  let parsed: unknown;
  try {
    parsed = parse(text) as unknown;
  } catch (error) {
    diagnostics.push(
      diagnostic("E_SYNTAX", `${file} is not valid YAML: ${(error as Error).message}`, {
        file,
        line: 0,
      }),
    );
    return { request: undefined, diagnostics };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    diagnostics.push(
      diagnostic("E_SYNTAX", `${file} must be a mapping describing one request.`, {
        file,
        line: 0,
      }),
    );
    return { request: undefined, diagnostics };
  }

  const record = parsed as Record<string, unknown>;
  const candidate = { name: fallbackName, ...record };

  const result = apiRequestSchema.safeParse(candidate);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const at = issue.path.length === 0 ? "" : ` at \`${issue.path.join(".")}\``;
      diagnostics.push(
        diagnostic("E_SYNTAX", `${file}${at}: ${issue.message}`, { file, line: 0 }),
      );
    }
    return { request: undefined, diagnostics };
  }

  return { request: result.data, diagnostics };
}

/** Build a catalogue from files already read, rejecting duplicate names. */
export function buildApiCatalogue(
  files: ReadonlyArray<{ file: string; text: string; fallbackName: string }>,
): { apis: ApiCatalogue; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const requests = new Map<string, ApiRequest>();
  const from = new Map<string, string>();

  for (const one of files) {
    const { request, diagnostics: read } = readApiRequest(one.text, one.file, one.fallbackName);
    diagnostics.push(...read);
    if (request === undefined) continue;

    const existing = from.get(request.name);
    if (existing !== undefined) {
      diagnostics.push(
        diagnostic(
          "E_DUP_API",
          `Two requests are named "${request.name}": ${existing} and ${one.file}. A step names a request, so the name has to say which one.`,
          { file: one.file, line: 0 },
        ),
      );
      continue;
    }
    requests.set(request.name, request);
    from.set(request.name, one.file);
  }

  return { apis: { requests, files: from }, diagnostics };
}
