import type { AgentSurface } from "@svatah/yam-surface";
import type { ReadKind, CheckSubject, Ref, ActArgs } from "@svatah/yam-schema";
import { SurfaceError } from "@svatah/yam-surface";
import { makeRequestId, successEnvelope, failedEnvelope, refusedEnvelope } from "./envelope.js";
import type { SessionStore } from "./sessions.js";
import type { ErrorCode } from "./catalogue.js";
import { discoverTargets, discoverAdapters, checkAdapterReadiness } from "./discovery.js";
import type { ReferenceStore } from "./references.js";
import type { CoordinationStore } from "./coordination.js";
import { hashInput } from "./coordination.js";

export interface DispatchContext {
  sessions: SessionStore;
  references?: ReferenceStore;
  coordination?: CoordinationStore;
}

export async function dispatchTargets(
  _ctx: DispatchContext,
  input: {
    url?: string;
    adapter?: string;
    registeredAdapters: string[];
  },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const start = Date.now();
  const targets = discoverTargets(input.registeredAdapters, {
    url: input.url,
    adapter: input.adapter,
  });
  const adapters = discoverAdapters(input.registeredAdapters);
  const elapsed = Date.now() - start;
  return successEnvelope(requestId, undefined, { targets, adapters }, elapsed);
}

export async function dispatchConnect(
  ctx: DispatchContext,
  input: {
    url?: string;
    adapter?: string;
    headed?: boolean;
    adapterFactory: (name: string, options?: { headed?: boolean }) => Promise<AgentSurface>;
    registeredAdapters?: string[];
  },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const start = Date.now();
  try {
    const adapterName = input.adapter ?? "playwright";
    if (input.registeredAdapters) {
      const readiness = checkAdapterReadiness(adapterName, input.registeredAdapters);
      if (!readiness.available) {
        return refusedEnvelope(
          requestId,
          undefined,
          readiness.registered ? "ADAPTER_UNAVAILABLE" : "ADAPTER_NOT_REGISTERED",
          readiness.reason ?? `Adapter "${adapterName}" is not available.`,
          {
            adapter: adapterName,
            prerequisites: readiness.prerequisites,
            platform: readiness.platform,
          },
        );
      }
    }
    const surface = await input.adapterFactory(adapterName, { headed: input.headed });
    const sessionId = ctx.sessions.create(surface, adapterName);

    await surface.open({
      ...(input.url === undefined ? {} : { baseUrl: input.url }),
    });
    /*
     * A session is not a page (LLD §8, Draft 2.4).
     *
     * `open` gives the session its base URL; it does not go there. Without
     * this, `yam surface connect --url …` returned a session id for a blank
     * tab and every snapshot, read and check after it saw nothing — the
     * journey ran green against an empty page. The executor and the recorder
     * both perform this navigation for the same reason.
     */
    if (input.url !== undefined && surface.kind === "web") {
      await surface.act("navigate", undefined, { url: input.url });
    }

    const caps = surface.capabilities();
    const elapsed = Date.now() - start;
    return successEnvelope(requestId, sessionId, {
      sessionId,
      adapter: adapterName,
      kind: surface.kind,
      capabilities: caps,
    }, elapsed);
  } catch (err) {
    const elapsed = Date.now() - start;
    return handleError(requestId, undefined, err, elapsed);
  }
}

export async function dispatchSnapshot(
  ctx: DispatchContext,
  input: {
    session: string;
    root?: string;
    maxNodes?: number;
    interactiveOnly?: boolean;
  },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const start = Date.now();
  const entry = ctx.sessions.get(input.session);
  if (!entry) {
    return failedEnvelope(requestId, input.session, "SESSION_NOT_FOUND", `Session ${input.session} not found`);
  }
  try {
    const snap = await entry.surface.snapshot({
      root: input.root as Ref | undefined,
      maxNodes: input.maxNodes,
      interactiveOnly: input.interactiveOnly,
    });
    const elapsed = Date.now() - start;

    let snapshotId: string | undefined;
    let truncated = false;
    let generation: number | undefined;
    if (ctx.references) {
      const refs = (snap.nodes as Array<{ ref: string }>).map((n) => n.ref);
      let url: string | undefined;
      try {
        url = (await entry.surface.read("url")) as string | undefined;
      } catch { /* adapters that lack url reading */ }
      const record = ctx.references.recordSnapshot(input.session, refs, {
        url,
        truncated: input.maxNodes !== undefined && snap.nodes.length >= input.maxNodes,
        totalNodes: snap.nodes.length,
        returnedNodes: snap.nodes.length,
      });
      snapshotId = record.snapshotId;
      truncated = record.truncated;
      generation = record.generation;
    }

    return successEnvelope(requestId, input.session, {
      ...snap,
      ...(snapshotId ? { snapshotId } : {}),
      ...(generation !== undefined ? { generation } : {}),
      truncated,
    }, elapsed);
  } catch (err) {
    return handleError(requestId, input.session, err, Date.now() - start);
  }
}

export async function dispatchAct(
  ctx: DispatchContext,
  input: {
    session: string;
    action: string;
    ref?: string;
    args?: ActArgs;
    ref2?: string;
    snapshot?: string;
    idempotencyKey?: string;
    holder?: string;
    deadlineMs?: number;
  },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const start = Date.now();
  const entry = ctx.sessions.get(input.session);
  if (!entry) {
    return failedEnvelope(requestId, input.session, "SESSION_NOT_FOUND", `Session ${input.session} not found`);
  }

  if (ctx.references && input.ref) {
    const check = ctx.references.validateRef(input.session, input.ref, input.snapshot);
    if (!check.valid) {
      return refusedEnvelope(requestId, input.session, check.code as ErrorCode, check.message);
    }
  }

  if (ctx.coordination && input.idempotencyKey) {
    const idemCheck = ctx.coordination.checkIdempotency(
      input.idempotencyKey,
      input.action,
      hashInput({ session: input.session, action: input.action, ref: input.ref, args: input.args }),
    );
    if (idemCheck.status === "duplicate") {
      return idemCheck.result as Record<string, unknown>;
    }
    if (idemCheck.status === "conflict") {
      return refusedEnvelope(requestId, input.session, "INVALID_ARGUMENT", idemCheck.message);
    }
  }

  const targetKey = `${input.session}:target`;
  if (ctx.coordination) {
    const leaseResult = ctx.coordination.acquireLease(
      input.session,
      targetKey,
      input.holder ?? requestId,
      input.deadlineMs,
    );
    if (!leaseResult.acquired) {
      return refusedEnvelope(requestId, input.session, "CONTROL_BUSY", `Target is held by "${leaseResult.holder}" (operation ${leaseResult.operationId}). Wait or request handoff.`, {
        holder: leaseResult.holder,
        operationId: leaseResult.operationId,
      });
    }
  }

  let opRecord: ReturnType<CoordinationStore["recordDispatch"]> | undefined;
  if (ctx.coordination) {
    opRecord = ctx.coordination.recordDispatch(input.session, input.action);
  }

  try {
    const result = await entry.surface.act(
      input.action as Parameters<AgentSurface["act"]>[0],
      input.ref as Ref | undefined,
      input.args,
      input.ref2 as Ref | undefined,
    );
    const elapsed = Date.now() - start;

    const navigating = input.action === "navigate" || input.action === "goBack" || input.action === "goForward";
    if (navigating && ctx.references) {
      ctx.references.incrementGeneration(input.session);
    }

    if (ctx.coordination) {
      ctx.coordination.releaseLease(targetKey, "succeeded");
      if (opRecord) ctx.coordination.completeOperation(opRecord.operationId, "succeeded");
    }

    const envelope = successEnvelope(requestId, input.session, result, elapsed);
    if (ctx.coordination && input.idempotencyKey) {
      ctx.coordination.recordIdempotency(
        input.idempotencyKey,
        input.action,
        hashInput({ session: input.session, action: input.action, ref: input.ref, args: input.args }),
        envelope,
        "succeeded",
      );
    }
    return envelope;
  } catch (err) {
    if (ctx.coordination) {
      ctx.coordination.releaseLease(targetKey, "failed");
      if (opRecord) ctx.coordination.completeOperation(opRecord.operationId, "failed");
    }
    return handleError(requestId, input.session, err, Date.now() - start);
  }
}

export async function dispatchRead(
  ctx: DispatchContext,
  input: {
    session: string;
    kind: ReadKind;
    ref?: string;
    name?: string;
  },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const start = Date.now();
  const entry = ctx.sessions.get(input.session);
  if (!entry) {
    return failedEnvelope(requestId, input.session, "SESSION_NOT_FOUND", `Session ${input.session} not found`);
  }
  try {
    const value = await entry.surface.read(
      input.kind,
      input.ref as Ref | undefined,
      input.name,
    );
    const elapsed = Date.now() - start;
    return successEnvelope(requestId, input.session, { value }, elapsed);
  } catch (err) {
    return handleError(requestId, input.session, err, Date.now() - start);
  }
}

/**
 * A predicate a person can write (SF-06, SF-16).
 *
 * A predicate's `value` is a `ValueRef` — `{kind: "literal", value: "Yam"}` —
 * because a compiled step's value may come from data, an input or a template.
 * Direct control has none of those: there is no project to hold them. So a bare
 * string means what it says, and the shape a flow needs is still accepted.
 *
 * Without this, `--input` files carried protocol payload, and the plain reading
 * — `{"kind":"titleContains","value":"Yam"}` — failed with "Unknown value
 * reference", which tells a person nothing about what to write instead.
 */
function literalValues(predicate: Record<string, unknown>): Record<string, unknown> {
  const value = predicate["value"];
  if (typeof value !== "string") return predicate;
  return { ...predicate, value: { kind: "literal", value } };
}

export async function dispatchCheck(
  ctx: DispatchContext,
  input: {
    session: string;
    predicate: { kind: string; value?: string; name?: string; negate?: boolean };
    subject: CheckSubject;
    ref?: string;
  },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const start = Date.now();
  const entry = ctx.sessions.get(input.session);
  if (!entry) {
    return failedEnvelope(requestId, input.session, "SESSION_NOT_FOUND", `Session ${input.session} not found`);
  }
  try {
    const result = await entry.surface.check(
      literalValues(input.predicate) as Parameters<AgentSurface["check"]>[0],
      input.subject,
      input.ref as Ref | undefined,
    );
    const elapsed = Date.now() - start;
    if (!result.ok) {
      return {
        ...failedEnvelope(requestId, input.session, "CHECK_FAILED", result.message ?? "Check failed"),
        result,
        timing: { totalMs: elapsed },
      };
    }
    return successEnvelope(requestId, input.session, result, elapsed);
  } catch (err) {
    return handleError(requestId, input.session, err, Date.now() - start);
  }
}

export async function dispatchClose(
  ctx: DispatchContext,
  input: { session: string },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const start = Date.now();
  const entry = ctx.sessions.get(input.session);
  if (!entry) {
    return failedEnvelope(requestId, input.session, "SESSION_NOT_FOUND", `Session ${input.session} not found`);
  }
  try {
    await entry.surface.close();
    ctx.sessions.remove(input.session);
    ctx.references?.invalidateSession(input.session);
    const elapsed = Date.now() - start;
    return successEnvelope(requestId, input.session, { closed: true }, elapsed);
  } catch (err) {
    ctx.sessions.remove(input.session);
    ctx.references?.invalidateSession(input.session);
    return handleError(requestId, input.session, err, Date.now() - start);
  }
}

export async function dispatchSessions(
  ctx: DispatchContext,
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const sessions = ctx.sessions.list();
  return successEnvelope(requestId, undefined, { sessions });
}

export async function dispatchCapabilities(
  ctx: DispatchContext,
  input: { session: string },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const entry = ctx.sessions.get(input.session);
  if (!entry) {
    return failedEnvelope(requestId, input.session, "SESSION_NOT_FOUND", `Session ${input.session} not found`);
  }
  return successEnvelope(requestId, input.session, {
    capabilities: entry.surface.capabilities(),
    adapter: entry.adapter,
    kind: entry.surface.kind,
  });
}

export async function dispatchDescribe(
  ctx: DispatchContext,
  input: { session: string; ref: string; snapshot?: string },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const start = Date.now();
  const entry = ctx.sessions.get(input.session);
  if (!entry) {
    return failedEnvelope(requestId, input.session, "SESSION_NOT_FOUND", `Session ${input.session} not found`);
  }
  if (ctx.references) {
    const check = ctx.references.validateRef(input.session, input.ref, input.snapshot);
    if (!check.valid) {
      return refusedEnvelope(requestId, input.session, check.code as ErrorCode, check.message);
    }
  }
  try {
    const desc = await entry.surface.describe(input.ref as Ref);
    const elapsed = Date.now() - start;
    return successEnvelope(requestId, input.session, desc, elapsed);
  } catch (err) {
    return handleError(requestId, input.session, err, Date.now() - start);
  }
}

export async function dispatchScreenshot(
  ctx: DispatchContext,
  input: { session: string; path?: string },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const start = Date.now();
  const entry = ctx.sessions.get(input.session);
  if (!entry) {
    return failedEnvelope(requestId, input.session, "SESSION_NOT_FOUND", `Session ${input.session} not found`);
  }
  try {
    const outPath = input.path ?? `screenshot-${Date.now()}.png`;
    await entry.surface.screenshot(outPath);
    const elapsed = Date.now() - start;
    return successEnvelope(requestId, input.session, { path: outPath }, elapsed);
  } catch (err) {
    return handleError(requestId, input.session, err, Date.now() - start);
  }
}

function handleError(
  requestId: string,
  sessionId: string | undefined,
  err: unknown,
  elapsedMs: number,
): Record<string, unknown> {
  if (err instanceof SurfaceError) {
    const code = surfaceErrorToCode(err);
    return {
      ...failedEnvelope(requestId, sessionId, code, err.message),
      timing: { totalMs: elapsedMs },
    };
  }
  const message = err instanceof Error ? err.message : String(err);
  return {
    ...failedEnvelope(requestId, sessionId, "OUTCOME_UNKNOWN", message),
    timing: { totalMs: elapsedMs },
  };
}

function surfaceErrorToCode(err: SurfaceError): ErrorCode {
  switch (err.constructor.name) {
    case "LocateError":
      return "STALE_REFERENCE";
    case "ActionabilityError":
    case "TimeoutError":
      return "TIMEOUT";
    case "CheckError":
      return "CHECK_FAILED";
    case "SessionError":
      return "SESSION_CLOSED";
    case "NavigationError":
      return "CONNECT_FAILED";
    default:
      return "OUTCOME_UNKNOWN";
  }
}
