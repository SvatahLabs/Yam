/**
 * Compile diagnostics (LLD §4, `docs/flow-language.md` §9).
 *
 * A diagnostic carries a stable code, a file and a line, and a message written
 * for the person who wrote the flow rather than for the person who wrote the
 * compiler. The code is what tests and tooling match on; the message is what
 * someone reads at 6pm when a build is red.
 *
 * Errors fail the compile. Warnings are reported by `svatah lint` and do not.
 */

/** Codes that fail a compile. */
export const ERROR_CODES = [
  "E_SYNTAX",
  "E_META",
  "E_SIGNATURE",
  "E_GUARD_ORPHAN",
  "E_DUP_STORY",
  "E_TEST_EMPTY",
  "E_SIGIL",
  "E_VAR_UNDEFINED",
  "E_VAR_REDEFINED",
  "E_OUTPUT_UNCAPTURED",
  "E_INPUT_REQUIRED",
  "E_STEP_AMBIGUOUS",
  "E_UNKNOWN_STORY",
  "E_UNKNOWN_API",
  "E_DUP_API",
  "E_NO_MATCH",
  "E_DATA",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Codes `svatah lint` reports without failing. */
export const WARNING_CODES = [
  "W_AMBIGUOUS_TARGET",
  "W_TIER2",
  "W_TIER3",
  "W_LOW_CONFIDENCE",
  "W_UNUSED_CAPTURE",
  "W_LONG_SLEEP",
  "W_CUSTOM",
  "W_SIDE_EFFECT_TOOL",
  "W_SECRET_UNSET",
  // Draft 2.5, LLD §4.3: a binding file that declares no phrases. The element
  // is still addressable by id — that is what `bind("login.username-field")`
  // does — but no sentence can name it, so a flow project almost always meant
  // to record one.
  "W_BINDING_NO_PHRASES",
] as const;
export type WarningCode = (typeof WARNING_CODES)[number];

export type DiagnosticCode = ErrorCode | WarningCode;

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly severity: "error" | "warning";
  readonly message: string;
  /** Path of the file, relative to the project root. */
  readonly file: string;
  /** 1-based. 0 when the diagnostic is about the file as a whole. */
  readonly line: number;
  /** The source line, when there is one, so a report can show it. */
  readonly source?: string;
}

const ERRORS = new Set<string>(ERROR_CODES);

export function isError(code: DiagnosticCode): boolean {
  return ERRORS.has(code);
}

export function diagnostic(
  code: DiagnosticCode,
  message: string,
  where: { file: string; line: number; source?: string },
): Diagnostic {
  return {
    code,
    severity: isError(code) ? "error" : "warning",
    message,
    file: where.file,
    line: where.line,
    ...(where.source === undefined ? {} : { source: where.source }),
  };
}

/** The errors among a set of diagnostics. */
export function errorsIn(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((d) => d.severity === "error");
}

/** One line per diagnostic, in the shape editors and terminals both parse. */
export function formatDiagnostic(diagnostic: Diagnostic): string {
  const at = diagnostic.line === 0 ? diagnostic.file : `${diagnostic.file}:${diagnostic.line}`;
  return `${at}: ${diagnostic.severity} ${diagnostic.code}: ${diagnostic.message}`;
}
