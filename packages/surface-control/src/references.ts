import { randomUUID } from "node:crypto";

export interface SnapshotRecord {
  snapshotId: string;
  sessionId: string;
  generation: number;
  refs: Set<string>;
  url?: string;
  targetFingerprint?: string;
  createdAt: number;
  truncated: boolean;
  totalNodes: number;
  returnedNodes: number;
}

export interface RefScope {
  sessionId: string;
  snapshotId: string;
  generation: number;
}

export interface ReferenceStore {
  recordSnapshot(
    sessionId: string,
    refs: string[],
    meta: {
      url?: string;
      targetFingerprint?: string;
      truncated?: boolean;
      totalNodes?: number;
      returnedNodes?: number;
    },
  ): SnapshotRecord;

  validateRef(
    sessionId: string,
    ref: string,
    snapshotId?: string,
  ): { valid: true; scope: RefScope } | { valid: false; code: string; message: string };

  invalidateSession(sessionId: string): void;

  incrementGeneration(sessionId: string): number;

  getGeneration(sessionId: string): number;

  getSnapshot(snapshotId: string): SnapshotRecord | undefined;
}

export function createReferenceStore(): ReferenceStore {
  const snapshots = new Map<string, SnapshotRecord>();
  const generations = new Map<string, number>();
  const sessionSnapshots = new Map<string, Set<string>>();

  return {
    recordSnapshot(sessionId, refs, meta) {
      const gen = generations.get(sessionId) ?? 0;
      const snapshotId = `snap_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const record: SnapshotRecord = {
        snapshotId,
        sessionId,
        generation: gen,
        refs: new Set(refs),
        url: meta.url,
        targetFingerprint: meta.targetFingerprint,
        createdAt: Date.now(),
        truncated: meta.truncated ?? false,
        totalNodes: meta.totalNodes ?? refs.length,
        returnedNodes: meta.returnedNodes ?? refs.length,
      };
      snapshots.set(snapshotId, record);
      let set = sessionSnapshots.get(sessionId);
      if (!set) {
        set = new Set();
        sessionSnapshots.set(sessionId, set);
      }
      set.add(snapshotId);
      return record;
    },

    validateRef(sessionId, ref, snapshotId) {
      if (snapshotId) {
        const snap = snapshots.get(snapshotId);
        if (!snap) {
          return {
            valid: false,
            code: "STALE_REFERENCE",
            message: `Snapshot ${snapshotId} does not exist.`,
          };
        }
        if (snap.sessionId !== sessionId) {
          return {
            valid: false,
            code: "STALE_REFERENCE",
            message: "This reference belongs to a different session.",
          };
        }
        const currentGen = generations.get(sessionId) ?? 0;
        if (snap.generation !== currentGen) {
          return {
            valid: false,
            code: "STALE_REFERENCE",
            message: `Reference is from generation ${snap.generation}; current is ${currentGen}. The target has changed (navigation, reload or tab switch). Take a new snapshot.`,
          };
        }
        if (!snap.refs.has(ref)) {
          return {
            valid: false,
            code: "STALE_REFERENCE",
            message: `Reference "${ref}" was not in snapshot ${snapshotId}.`,
          };
        }
        return {
          valid: true,
          scope: { sessionId, snapshotId, generation: snap.generation },
        };
      }

      const sessionSnaps = sessionSnapshots.get(sessionId);
      if (!sessionSnaps || sessionSnaps.size === 0) {
        return {
          valid: false,
          code: "STALE_REFERENCE",
          message: "No snapshots exist for this session. Take a snapshot first.",
        };
      }
      const currentGen = generations.get(sessionId) ?? 0;
      for (const snapId of sessionSnaps) {
        const snap = snapshots.get(snapId);
        if (snap && snap.generation === currentGen && snap.refs.has(ref)) {
          return {
            valid: true,
            scope: { sessionId, snapshotId: snapId, generation: snap.generation },
          };
        }
      }
      return {
        valid: false,
        code: "STALE_REFERENCE",
        message: `Reference "${ref}" not found in any current-generation snapshot. Take a new snapshot.`,
      };
    },

    invalidateSession(sessionId) {
      const snaps = sessionSnapshots.get(sessionId);
      if (snaps) {
        for (const id of snaps) snapshots.delete(id);
        snaps.clear();
      }
      generations.delete(sessionId);
    },

    incrementGeneration(sessionId) {
      const current = generations.get(sessionId) ?? 0;
      const next = current + 1;
      generations.set(sessionId, next);
      return next;
    },

    getGeneration(sessionId) {
      return generations.get(sessionId) ?? 0;
    },

    getSnapshot(snapshotId) {
      return snapshots.get(snapshotId);
    },
  };
}
