import { randomUUID } from "node:crypto";
import type { ErrorCode, ResultEnvelope } from "./catalogue.js";

export function makeRequestId(): string {
  return `req_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function successEnvelope(
  requestId: string,
  sessionId: string | undefined,
  result: unknown,
  timingMs?: number,
  adapterMs?: number,
): ResultEnvelope & { result: unknown } {
  return {
    schemaVersion: "1.0" as const,
    requestId,
    ...(sessionId ? { sessionId } : {}),
    status: "succeeded" as const,
    result,
    timing: timingMs != null ? { totalMs: timingMs, adapterMs } : undefined,
  };
}

export function failedEnvelope(
  requestId: string,
  sessionId: string | undefined,
  code: ErrorCode,
  message: string,
  retryable: boolean = false,
  details?: Record<string, unknown>,
): ResultEnvelope {
  return {
    schemaVersion: "1.0" as const,
    requestId,
    ...(sessionId ? { sessionId } : {}),
    status: "failed" as const,
    error: { code, message, retryable, ...(details ? { details } : {}) },
  };
}

export function refusedEnvelope(
  requestId: string,
  sessionId: string | undefined,
  code: ErrorCode,
  message: string,
  details?: Record<string, unknown>,
): ResultEnvelope {
  return {
    schemaVersion: "1.0" as const,
    requestId,
    ...(sessionId ? { sessionId } : {}),
    status: "refused" as const,
    error: { code, message, retryable: false, ...(details ? { details } : {}) },
  };
}
