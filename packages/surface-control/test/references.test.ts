import { describe, expect, it } from "vitest";
import { createReferenceStore } from "../src/references.js";

describe("reference store (T07, SF-10)", () => {
  it("records a snapshot and validates its refs", () => {
    const store = createReferenceStore();
    const record = store.recordSnapshot("s1", ["r0", "r1", "r2"], {
      url: "http://localhost:3000",
    });
    expect(record.snapshotId).toMatch(/^snap_/);
    expect(record.generation).toBe(0);

    const valid = store.validateRef("s1", "r0", record.snapshotId);
    expect(valid.valid).toBe(true);
  });

  it("refuses a ref from a different session", () => {
    const store = createReferenceStore();
    const record = store.recordSnapshot("s1", ["r0"], {});
    const result = store.validateRef("s2", "r0", record.snapshotId);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("STALE_REFERENCE");
      expect(result.message).toContain("different session");
    }
  });

  it("refuses a ref after generation increment (navigation)", () => {
    const store = createReferenceStore();
    const record = store.recordSnapshot("s1", ["r0"], {});
    store.incrementGeneration("s1");
    const result = store.validateRef("s1", "r0", record.snapshotId);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("STALE_REFERENCE");
      expect(result.message).toContain("generation");
    }
  });

  it("refuses a ref not present in the snapshot", () => {
    const store = createReferenceStore();
    const record = store.recordSnapshot("s1", ["r0", "r1"], {});
    const result = store.validateRef("s1", "r99", record.snapshotId);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.code).toBe("STALE_REFERENCE");
      expect(result.message).toContain("r99");
    }
  });

  it("accepts a ref without a snapshotId if it exists in the current generation", () => {
    const store = createReferenceStore();
    store.recordSnapshot("s1", ["r0", "r1"], {});
    const result = store.validateRef("s1", "r0");
    expect(result.valid).toBe(true);
  });

  it("refuses a ref without a snapshotId after generation change", () => {
    const store = createReferenceStore();
    store.recordSnapshot("s1", ["r0"], {});
    store.incrementGeneration("s1");
    const result = store.validateRef("s1", "r0");
    expect(result.valid).toBe(false);
  });

  it("invalidateSession clears everything for that session", () => {
    const store = createReferenceStore();
    const record = store.recordSnapshot("s1", ["r0"], {});
    store.invalidateSession("s1");
    expect(store.getSnapshot(record.snapshotId)).toBeUndefined();
    expect(store.getGeneration("s1")).toBe(0);
  });

  it("records truncation metadata", () => {
    const store = createReferenceStore();
    const record = store.recordSnapshot("s1", ["r0"], {
      truncated: true,
      totalNodes: 500,
      returnedNodes: 100,
    });
    expect(record.truncated).toBe(true);
    expect(record.totalNodes).toBe(500);
    expect(record.returnedNodes).toBe(100);
  });

  it("new snapshot in same generation is valid alongside old one", () => {
    const store = createReferenceStore();
    const first = store.recordSnapshot("s1", ["r0"], {});
    const second = store.recordSnapshot("s1", ["r1"], {});
    expect(store.validateRef("s1", "r0", first.snapshotId).valid).toBe(true);
    expect(store.validateRef("s1", "r1", second.snapshotId).valid).toBe(true);
  });
});
