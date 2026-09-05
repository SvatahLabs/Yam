/**
 * The diagnostics Tier 0 produces.
 *
 * `@svatah/spec` owns the diagnostic type for the language as a whole, but
 * `@svatah/steps` cannot import it: LLD §1 draws `steps ─► schema, surface`, and
 * a dependency on `spec` would put the authoring API behind the flow reader for
 * no reason. So the shape is repeated here, structurally identical, and the
 * compiler — which depends on both — passes them through unchanged.
 */
export interface Diagnostic {
  readonly code: "E_STEP_AMBIGUOUS" | "E_STEP_LOAD" | "W_CUSTOM";
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly file: string;
  readonly line: number;
}

export function customDiagnostic(
  code: Diagnostic["code"],
  message: string,
  file: string,
  line = 0,
): Diagnostic {
  return { code, severity: code === "W_CUSTOM" ? "warning" : "error", message, file, line };
}
