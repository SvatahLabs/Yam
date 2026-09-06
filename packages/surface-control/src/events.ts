export type EventKind =
  | "operation.dispatched"
  | "operation.succeeded"
  | "operation.failed"
  | "operation.refused"
  | "operation.cancelled"
  | "session.created"
  | "session.closed"
  | "snapshot.taken"
  | "lease.acquired"
  | "lease.released"
  | "lease.refused";

export interface SessionEvent {
  eventId: string;
  sessionId?: string;
  kind: EventKind;
  operationName?: string;
  timestamp: string;
  data: Record<string, unknown>;
}

export interface EventStore {
  emit(event: Omit<SessionEvent, "eventId" | "timestamp">): SessionEvent;
  list(sessionId?: string, since?: string): SessionEvent[];
  clear(sessionId: string): void;
}

let eventCounter = 0;

export function createEventStore(): EventStore {
  const events: SessionEvent[] = [];

  return {
    emit(partial) {
      const event: SessionEvent = {
        eventId: `evt_${++eventCounter}`,
        timestamp: new Date().toISOString(),
        ...partial,
      };
      events.push(event);
      return event;
    },

    list(sessionId, since) {
      let result = events;
      if (sessionId) {
        result = result.filter((e) => e.sessionId === sessionId);
      }
      if (since) {
        result = result.filter((e) => e.timestamp > since);
      }
      return result;
    },

    clear(sessionId) {
      const keep = events.filter((e) => e.sessionId !== sessionId);
      events.length = 0;
      events.push(...keep);
    },
  };
}
