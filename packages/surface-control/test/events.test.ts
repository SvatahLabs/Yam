import { describe, expect, it } from "vitest";
import { createEventStore } from "../src/events.js";

describe("event store (T09, SF-12, SF-15)", () => {
  it("emits events with auto-generated ids and timestamps", () => {
    const store = createEventStore();
    const event = store.emit({
      sessionId: "s1",
      kind: "operation.dispatched",
      operationName: "click",
      data: { ref: "r0" },
    });
    expect(event.eventId).toMatch(/^evt_/);
    expect(event.timestamp).toBeTruthy();
    expect(event.kind).toBe("operation.dispatched");
  });

  it("lists events for a session", () => {
    const store = createEventStore();
    store.emit({ sessionId: "s1", kind: "session.created", data: {} });
    store.emit({ sessionId: "s2", kind: "session.created", data: {} });
    store.emit({ sessionId: "s1", kind: "operation.dispatched", data: {} });

    const s1Events = store.list("s1");
    expect(s1Events).toHaveLength(2);
    expect(s1Events.every((e) => e.sessionId === "s1")).toBe(true);
  });

  it("lists all events without a session filter", () => {
    const store = createEventStore();
    store.emit({ sessionId: "s1", kind: "session.created", data: {} });
    store.emit({ sessionId: "s2", kind: "session.created", data: {} });
    expect(store.list()).toHaveLength(2);
  });

  it("clears events for a session", () => {
    const store = createEventStore();
    store.emit({ sessionId: "s1", kind: "session.created", data: {} });
    store.emit({ sessionId: "s2", kind: "session.created", data: {} });
    store.clear("s1");
    expect(store.list("s1")).toHaveLength(0);
    expect(store.list("s2")).toHaveLength(1);
  });

  it("records refused and failed operations without executing them", () => {
    const store = createEventStore();
    store.emit({
      sessionId: "s1",
      kind: "operation.refused",
      operationName: "click",
      data: { code: "STALE_REFERENCE", ref: "r0" },
    });
    store.emit({
      sessionId: "s1",
      kind: "operation.failed",
      operationName: "type",
      data: { error: "timeout" },
    });
    const events = store.list("s1");
    expect(events).toHaveLength(2);
    expect(events[0]!.kind).toBe("operation.refused");
    expect(events[1]!.kind).toBe("operation.failed");
  });
});
