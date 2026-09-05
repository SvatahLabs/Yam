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
import type { StepResult, Summary } from "@svatah/schema";

export type ServiceEvent =
  | { readonly kind: "step.result"; readonly runId: string; readonly result: StepResult }
  | { readonly kind: "run.summary"; readonly runId: string; readonly summary: Summary }
  | { readonly kind: "run.started"; readonly runId: string; readonly flows: readonly string[] }
  | { readonly kind: "run.failed"; readonly runId: string; readonly message: string }
  | { readonly kind: "log"; readonly at: string; readonly level: string; readonly message: string };

export const SERVICE_EVENT_KINDS = [
  "step.result",
  "run.summary",
  "run.started",
  "run.failed",
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
