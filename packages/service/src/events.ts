/**
 * The event stream (REQ-ADE-1, LLD §13.5).
 *
 * "`GET /events` (WebSocket) or `GET /events/sse` — Stream: `step.result`,
 * `record.decision`, `record.candidates`, `heal.proposal`, `run.summary`, `log`."
 *
 * A run is the reason this exists: a client that had to poll `GET /runs/:id`
 * would show a run that finished three seconds ago, and the ADE's whole point is
 * watching one happen (REQ-ADE-3).
 *
 * Both transports carry the same JSON. WebSocket is the primary because it is
 * bidirectional and the ADE will eventually send as well as receive; SSE is
 * there because it survives proxies that eat upgrades, and because `curl` can
 * read it.
 */
import type { StepResult, Summary } from "@svatah/yam-schema";

export type ServiceEvent =
  | { readonly kind: "step.result"; readonly runId: string; readonly result: StepResult }
  | { readonly kind: "run.summary"; readonly runId: string; readonly summary: Summary }
  | { readonly kind: "run.started"; readonly runId: string; readonly flows: readonly string[] }
  | { readonly kind: "run.failed"; readonly runId: string; readonly message: string }
  /* ── record with review (T5.7, REQ-ADE-4) ──────────────────────────────── */
  | { readonly kind: "record.started"; readonly sessionId: string }
  | { readonly kind: "record.step"; readonly sessionId: string; readonly step: unknown }
  /**
   * One grounding, waiting on a reviewer.
   *
   * Emitted *before* the binding is written, and the session is blocked until
   * `POST /record/:sessionId/decision` answers. That is what makes "accept,
   * re-pick, or reject, before bindings are written" true rather than a label on
   * an undo.
   */
  | {
      readonly kind: "record.decision";
      readonly sessionId: string;
      readonly proposal: unknown;
    }
  /** The candidate bundle for that grounding, so a reviewer can read it. */
  | {
      readonly kind: "record.candidates";
      readonly sessionId: string;
      readonly elementId: string;
      readonly candidates: readonly unknown[];
      readonly fingerprint: unknown;
    }
  /**
   * A grounding nobody decided in time (LLD §13.5, Draft 2.7).
   *
   * `record.decisionDeadlineMs` passed, so the pending grounding was rejected
   * and the session stopped. A client shows this rather than a session that
   * simply never says anything again, and a reviewer who came back to a closed
   * window learns why it closed.
   */
  | {
      readonly kind: "record.decision.expired";
      readonly sessionId: string;
      readonly elementId: string;
      readonly afterMs: number;
    }
  | { readonly kind: "record.finished"; readonly sessionId: string; readonly report: unknown }
  | { readonly kind: "record.failed"; readonly sessionId: string; readonly message: string }
  /* ── heal review (T5.7, REQ-ADE-5) ─────────────────────────────────────── */
  | { readonly kind: "heal.proposal"; readonly healId: string; readonly proposal: unknown }
  | { readonly kind: "heal.finished"; readonly healId: string; readonly report: unknown }
  | { readonly kind: "heal.failed"; readonly healId: string; readonly message: string }
  /* ── the tool panel (T5.8, REQ-ADE-8) ──────────────────────────────────── */
  | { readonly kind: "tool.invocation"; readonly invocation: unknown }
  | { readonly kind: "log"; readonly at: string; readonly level: string; readonly message: string };

export const SERVICE_EVENT_KINDS = [
  "step.result",
  "run.summary",
  "run.started",
  "run.failed",
  "record.started",
  "record.step",
  "record.decision",
  "record.candidates",
  "record.decision.expired",
  "record.finished",
  "record.failed",
  "heal.proposal",
  "heal.finished",
  "heal.failed",
  "tool.invocation",
  "log",
] as const;

type Listener = (event: ServiceEvent) => void;

/**
 * Fan-out to whoever is listening.
 *
 * Deliberately without a buffer: a client that connects after a run started sees
 * the rest of it, and reads the run directory for what it missed. Buffering
 * would make the service hold state, and REQ-ADE-2 says the project directory is
 * the only source of truth.
 */
export class EventBus {
  private readonly listeners = new Set<Listener>();

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: ServiceEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch {
        // A listener that throws is a client whose socket died mid-write. It
        // must not take the run down with it.
      }
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}
