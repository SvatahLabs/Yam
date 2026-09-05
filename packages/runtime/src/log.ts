/**
 * JSON-lines logging, and the OpenTelemetry hook (REQ-NFR-5).
 *
 * "JSON-lines logs with run, flow, story, step ids; optional OpenTelemetry."
 *
 * One line per event, with the ids that let a line be joined to a result, a
 * checkpoint or an audit entry. It is JSON because these are read by machines
 * more often than by people — and when a person does read them, `jq` is a better
 * reader than a regular expression over a prose format.
 *
 * OpenTelemetry is a *hook*, not a dependency. A tracing library in the runtime
 * would be a second network client inside a component whose whole contract is
 * that replay has no network dependency beyond the target platform (REQ-NFR-1).
 * A project that wants spans registers a `Tracer` and gets them; a project that
 * does not pays nothing, and neither does the dependency graph.
 */

export interface LogLine {
  readonly at: string;
  readonly level: "debug" | "info" | "warn" | "error";
  readonly message: string;
  readonly runId?: string;
  readonly flow?: string;
  readonly story?: string;
  readonly stepId?: string;
  readonly [key: string]: unknown;
}

export interface Logger {
  log(line: LogLine): void;
}

/** Writes one JSON object per line to a stream. The default. */
export class JsonLinesLogger implements Logger {
  constructor(private readonly write: (text: string) => void = (t) => process.stderr.write(t)) {}
  log(line: LogLine): void {
    this.write(`${JSON.stringify(line)}\n`);
  }
}

/** Discards everything. What a library-mode caller wants. */
export const SILENT: Logger = { log: () => undefined };

/**
 * A span, as much of OpenTelemetry as the runtime needs to know about.
 *
 * Deliberately structural: anything with these three members satisfies it,
 * including a real OTel span wrapped in four lines by the CLI.
 */
export interface Span {
  setAttribute(key: string, value: string | number | boolean): void;
  recordError(error: unknown): void;
  end(): void;
}

export interface Tracer {
  startSpan(name: string, attributes?: Record<string, string | number | boolean>): Span;
}

const NO_SPAN: Span = {
  setAttribute: () => undefined,
  recordError: () => undefined,
  end: () => undefined,
};

/** The tracer that does nothing, which is the default. */
export const NO_TRACER: Tracer = { startSpan: () => NO_SPAN };

let tracer: Tracer = NO_TRACER;

/** Register a tracer (REQ-NFR-5, "optional OpenTelemetry"). */
export function setTracer(next: Tracer): void {
  tracer = next;
}

export function clearTracer(): void {
  tracer = NO_TRACER;
}

export function currentTracer(): Tracer {
  return tracer;
}
