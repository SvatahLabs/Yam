import { randomUUID } from "node:crypto";

export type OperationOutcome = "succeeded" | "failed" | "refused" | "cancelled" | "unknown";

export interface Lease {
  sessionId: string;
  targetKey: string;
  holder: string;
  operationId: string;
  acquiredAt: number;
  deadlineMs: number;
  outcome?: OperationOutcome;
  completedAt?: number;
}

export interface IdempotencyRecord {
  key: string;
  operationName: string;
  inputHash: string;
  result?: unknown;
  outcome?: OperationOutcome;
  createdAt: number;
  expiresAt: number;
}

export interface OperationRecord {
  operationId: string;
  sessionId: string;
  operationName: string;
  dispatchedAt: number;
  outcome: OperationOutcome;
  completedAt?: number;
}

export interface CoordinationStore {
  acquireLease(
    sessionId: string,
    targetKey: string,
    holder: string,
    deadlineMs?: number,
  ): { acquired: true; lease: Lease } | { acquired: false; holder: string; operationId: string };

  releaseLease(targetKey: string, outcome: OperationOutcome): void;

  getLease(targetKey: string): Lease | undefined;

  recordDispatch(sessionId: string, operationName: string): OperationRecord;

  completeOperation(operationId: string, outcome: OperationOutcome, result?: unknown): void;

  getOperation(operationId: string): OperationRecord | undefined;

  checkIdempotency(
    key: string,
    operationName: string,
    inputHash: string,
  ): { status: "new" } | { status: "duplicate"; result: unknown } | { status: "conflict"; message: string };

  recordIdempotency(key: string, operationName: string, inputHash: string, result: unknown, outcome: OperationOutcome): void;

  expireIdempotencyRecords(): number;
}

const DEFAULT_DEADLINE_MS = 30_000;
const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;

/**
 * A stable hash of a request, for idempotency (SF-14).
 *
 * The keys are sorted so that argument order cannot change the hash. It is
 * done by *building* a sorted structure rather than by passing an array to
 * `JSON.stringify`: that array is a replacer, and a replacer array is an
 * allowlist applied at **every** depth. With the top-level keys as the list,
 * `args: { url: … }` lost its `url`, so navigating to two different pages
 * hashed identically — a key reused with different input was accepted as a
 * duplicate, the second navigation was swallowed, and the caller was told it
 * succeeded while the browser had not moved.
 */
function sortedForHash(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortedForHash);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortedForHash(source[key]);
    return out;
  }
  return value;
}

function hashInput(input: unknown): string {
  const json = JSON.stringify(sortedForHash(input));
  let h = 0;
  for (let i = 0; i < json.length; i++) {
    h = ((h << 5) - h + json.charCodeAt(i)) | 0;
  }
  return `h_${(h >>> 0).toString(16)}`;
}

export { hashInput };

export function createCoordinationStore(): CoordinationStore {
  const leases = new Map<string, Lease>();
  const operations = new Map<string, OperationRecord>();
  const idempotency = new Map<string, IdempotencyRecord>();

  return {
    acquireLease(sessionId, targetKey, holder, deadlineMs) {
      const existing = leases.get(targetKey);
      if (existing && existing.outcome === undefined) {
        if (Date.now() - existing.acquiredAt < existing.deadlineMs) {
          return { acquired: false, holder: existing.holder, operationId: existing.operationId };
        }
        existing.outcome = "unknown";
        existing.completedAt = Date.now();
      }

      const operationId = `op_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const lease: Lease = {
        sessionId,
        targetKey,
        holder,
        operationId,
        acquiredAt: Date.now(),
        deadlineMs: deadlineMs ?? DEFAULT_DEADLINE_MS,
      };
      leases.set(targetKey, lease);
      return { acquired: true, lease };
    },

    releaseLease(targetKey, outcome) {
      const lease = leases.get(targetKey);
      if (lease && lease.outcome === undefined) {
        lease.outcome = outcome;
        lease.completedAt = Date.now();
      }
    },

    getLease(targetKey) {
      return leases.get(targetKey);
    },

    recordDispatch(sessionId, operationName) {
      const operationId = `op_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const record: OperationRecord = {
        operationId,
        sessionId,
        operationName,
        dispatchedAt: Date.now(),
        outcome: "unknown",
      };
      operations.set(operationId, record);
      return record;
    },

    completeOperation(operationId, outcome, _result?) {
      const record = operations.get(operationId);
      if (record) {
        record.outcome = outcome;
        record.completedAt = Date.now();
      }
    },

    getOperation(operationId) {
      return operations.get(operationId);
    },

    checkIdempotency(key, operationName, inputHash) {
      const record = idempotency.get(key);
      if (!record) return { status: "new" };
      if (Date.now() > record.expiresAt) {
        idempotency.delete(key);
        return { status: "new" };
      }
      if (record.inputHash !== inputHash || record.operationName !== operationName) {
        return {
          status: "conflict",
          message: `Idempotency key "${key}" was used with different input or operation. Keys are single-use within ${IDEMPOTENCY_TTL_MS / 60000} minutes.`,
        };
      }
      return { status: "duplicate", result: record.result };
    },

    recordIdempotency(key, operationName, inputHash, result, _outcome) {
      idempotency.set(key, {
        key,
        operationName,
        inputHash,
        result,
        outcome: _outcome,
        createdAt: Date.now(),
        expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
      });
    },

    expireIdempotencyRecords() {
      const now = Date.now();
      let count = 0;
      for (const [key, record] of idempotency) {
        if (now > record.expiresAt) {
          idempotency.delete(key);
          count++;
        }
      }
      return count;
    },
  };
}
