/**
 * What the service's answers look like, as far as a screen reads them.
 *
 * Structural and partial on purpose. The authoritative shapes are
 * `@svatah/schema`'s (`StepResult`, `Summary`, `BindingFile`) and the service's
 * OpenAPI description; re-declaring them in full here would make a second,
 * subtly different set of the same types — the mistake
 * `scripts/generate-ade-client.mjs` avoids by returning `unknown`.
 *
 * So these are read-shapes: the fields a screen actually renders, every one of
 * them optional, so a response that grew a field still parses and a response
 * that lost one produces an empty cell rather than a crash.
 */

export interface ProjectResponse {
  root?: string;
  config?: {
    project?: string;
    environment?: string;
    adapter?: string;
    app?: { baseUrl?: string };
    flows?: { dir?: string };
    bindings?: { dir?: string };
    run?: { outputDir?: string; workers?: number; headless?: boolean };
  };
  flows?: string[];
  stories?: Array<{
    name?: string;
    file?: string;
    kind?: string;
    steps?: number;
    signature?: { inputs?: Record<string, { type?: string; default?: unknown }> };
  }>;
  compositions?: Record<string, string[]>;
  runs?: Record<string, string[]>;
  apis?: string[];
  customSteps?: string[];
  diagnostics?: Array<{ severity?: string; code?: string; message?: string; line?: number; file?: string }>;
  gateway?: { credential?: boolean };
}

export interface CompileResponse {
  ok?: boolean;
  plan?: { hash?: string; stories?: number };
  errors?: Diagnostic[];
  warnings?: Diagnostic[];
}

export interface Diagnostic {
  severity?: string;
  code?: string;
  message?: string;
  line?: number;
  file?: string;
  story?: string;
}

/** One compiled step, as the Plan tab and the editor's gutter read it. */
export interface PlanStep {
  id?: string;
  storyName?: string;
  line?: number;
  text?: string;
  action?: string;
  /** `{ ref, phrase, status }` — `ref` is the element id the binding is keyed on. */
  target?: { ref?: string; status?: string; phrase?: string };
  /** `{ tier, rule, confidence }` — where the step came from (REQ-COMP-1). */
  origin?: { tier?: number; rule?: string; confidence?: number };
  guard?: { kind?: string; subject?: string; predicate?: string; value?: unknown };
}

export interface PlanStory {
  name?: string;
  kind?: string;
  file?: string;
  meta?: Record<string, unknown>;
  steps?: PlanStep[];
}

export interface PlanResponse {
  hash?: string;
  stories?: PlanStory[];
}

export interface SummaryResponse {
  runId?: string;
  behavior?: string;
  planHash?: string;
  bindingsHash?: string;
  startedAt?: string;
  endedAt?: string;
  exitCode?: number;
  invoker?: { kind?: string; id?: string; via?: string };
  flows?: Record<string, { status?: string; passed?: number; failed?: number; skipped?: number }>;
  totals?: { passed?: number; failed?: number; skipped?: number; healed?: number; aborted?: number };
}

export interface StepResultResponse {
  runId?: string;
  flow?: string;
  story?: string;
  stepId?: string;
  line?: number;
  text?: string;
  status?: string;
  durationMs?: number;
  matched?: { by?: string; candidateIndex?: number; ref?: string };
  captured?: Record<string, unknown>;
  failure?: {
    class?: string;
    message?: string;
    screenshot?: string;
    /**
     * The `onFailure` policy the executor applied (LLD §3.4, REQ-AUTO-4).
     *
     * `"stop"` and `"continue"` are strings; `compensate` carries the flow it
     * ran, so the whole field is a union rather than a name.
     */
    policyApplied?: string | { compensate?: string };
    candidatesTried?: Array<Record<string, unknown>>;
    session?: {
      kind?: string;
      url?: string;
      windowTitle?: string;
      windowIndex?: number;
      dialog?: unknown;
    };
  };
}

/**
 * One `audit.jsonl` line (LLD §3.4, REQ-AUTO-6).
 *
 * `detail` is an object, not a string: a `run` line carries the invoker and the
 * inputs, a `surface` line carries the call and its outcome. The Run screen
 * renders a line rather than a field, so `AuditRow.text` is built from whatever
 * the line has.
 */
export interface AuditResponse {
  runId?: string;
  seq?: number;
  at?: string;
  kind?: string;
  story?: string;
  stepId?: string;
  /**
   * The surface call, not a string.
   *
   * `{ method: "act", action: "click", ref: "h0", args: [{ value: "…" }, null] }`
   * — `args` is the call's *argument list*, so it is an array whose entries are
   * whatever that method takes.
   */
  call?: {
    method?: string;
    action?: string;
    ref?: string;
    args?: unknown;
  };
  ref?: string;
  outcome?: string;
  durationMs?: number;
  detail?: unknown;
  message?: string;
  policy?: unknown;
  [key: string]: unknown;
}

/** `GET /bindings` — the list, which is ids and file paths and nothing else. */
export interface BindingListRow {
  id?: string;
  file?: string;
}

/** `GET /bindings/:id`, parsed: the YAML `svatah bindings show` prints. */
export interface BindingFileResponse {
  id?: string;
  phrases?: string[];
  entries?: Array<{
    /** `{ pattern, hash, platform }` — the URL or window pattern and its hash. */
    context?: { pattern?: string; hash?: string; platform?: string };
    verified?: boolean;
    candidates?: Array<{
      by?: string;
      value?: string;
      role?: string;
      name?: string;
      score?: number;
      attribute?: string;
    }>;
    fingerprint?: Record<string, unknown>;
    provenance?: {
      model?: string;
      promptVersion?: string;
      at?: string;
      tokensIn?: number;
      tokensOut?: number;
      costUsd?: number;
    };
    recordedAt?: string;
  }>;
}

export interface DataResponse {
  values?: Record<string, unknown>;
  secrets?: string[];
}

/**
 * `GET /tools` — `{ tools: { tools, refused }, invocations }`.
 *
 * The nesting is the service's: `toolsFor()` answers with what is exposed *and*
 * what was refused (a non-idempotent story exposed as a tool, REQ-AUTO-8), and
 * the route carries that object under `tools` beside the invocations.
 */
export interface ToolsResponse {
  tools?: {
    tools?: Array<{
      name?: string;
      story?: string;
      idempotent?: boolean;
      inputs?: Record<string, unknown>;
    }>;
    refused?: Array<{ story?: string; reason?: string }>;
  };
  invocations?: Array<{
    at?: string;
    tool?: string;
    invoker?: { kind?: string; id?: string };
    runId?: string;
    status?: string;
  }>;
}

export interface ApiRequestResponse {
  name?: string;
  method?: string;
  url?: string;
  headers?: Record<string, string>;
  body?: unknown;
}
