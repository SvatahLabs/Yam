import { describe, expect, it } from "vitest";
import { createCoordinationStore, hashInput } from "../src/coordination.js";

describe("coordination store (T08, SF-13, SF-14)", () => {
  describe("lease arbitration", () => {
    it("grants a lease when the target is free", () => {
      const store = createCoordinationStore();
      const result = store.acquireLease("s1", "t1", "client-a");
      expect(result.acquired).toBe(true);
      if (result.acquired) {
        expect(result.lease.holder).toBe("client-a");
        expect(result.lease.operationId).toMatch(/^op_/);
      }
    });

    it("refuses a lease when the target is held", () => {
      const store = createCoordinationStore();
      store.acquireLease("s1", "t1", "client-a");
      const result = store.acquireLease("s1", "t1", "client-b");
      expect(result.acquired).toBe(false);
      if (!result.acquired) {
        expect(result.holder).toBe("client-a");
      }
    });

    it("grants a lease after the previous one is released", () => {
      const store = createCoordinationStore();
      store.acquireLease("s1", "t1", "client-a");
      store.releaseLease("t1", "succeeded");
      const result = store.acquireLease("s1", "t1", "client-b");
      expect(result.acquired).toBe(true);
    });

    it("reports the holder when refusing", () => {
      const store = createCoordinationStore();
      const first = store.acquireLease("s1", "t1", "client-a");
      expect(first.acquired).toBe(true);
      const second = store.acquireLease("s1", "t1", "client-b");
      expect(second.acquired).toBe(false);
      if (!second.acquired) {
        expect(second.holder).toBe("client-a");
        expect(second.operationId).toBeTruthy();
      }
    });
  });

  describe("idempotency keys", () => {
    it("returns new for a fresh key", () => {
      const store = createCoordinationStore();
      const result = store.checkIdempotency("k1", "click", "h_abc");
      expect(result.status).toBe("new");
    });

    it("returns duplicate for a reused key with same input", () => {
      const store = createCoordinationStore();
      const envelope = { status: "succeeded" };
      store.recordIdempotency("k1", "click", "h_abc", envelope, "succeeded");
      const result = store.checkIdempotency("k1", "click", "h_abc");
      expect(result.status).toBe("duplicate");
      if (result.status === "duplicate") {
        expect(result.result).toEqual(envelope);
      }
    });

    it("refuses a reused key with different input", () => {
      const store = createCoordinationStore();
      store.recordIdempotency("k1", "click", "h_abc", {}, "succeeded");
      const result = store.checkIdempotency("k1", "click", "h_xyz");
      expect(result.status).toBe("conflict");
    });

    it("refuses a reused key with different operation", () => {
      const store = createCoordinationStore();
      store.recordIdempotency("k1", "click", "h_abc", {}, "succeeded");
      const result = store.checkIdempotency("k1", "type", "h_abc");
      expect(result.status).toBe("conflict");
    });
  });

  describe("operation tracking", () => {
    it("records and completes an operation", () => {
      const store = createCoordinationStore();
      const op = store.recordDispatch("s1", "click");
      expect(op.outcome).toBe("unknown");
      store.completeOperation(op.operationId, "succeeded");
      const updated = store.getOperation(op.operationId);
      expect(updated?.outcome).toBe("succeeded");
      expect(updated?.completedAt).toBeDefined();
    });

    it("dispatch before completion records unknown outcome", () => {
      const store = createCoordinationStore();
      const op = store.recordDispatch("s1", "click");
      expect(op.outcome).toBe("unknown");
      expect(op.dispatchedAt).toBeDefined();
    });
  });

  describe("hashInput", () => {
    it("produces consistent hashes for the same input", () => {
      const h1 = hashInput({ a: 1, b: "x" });
      const h2 = hashInput({ a: 1, b: "x" });
      expect(h1).toBe(h2);
    });

    it("produces different hashes for different input", () => {
      const h1 = hashInput({ a: 1 });
      const h2 = hashInput({ a: 2 });
      expect(h1).not.toBe(h2);
    });
  });
});
