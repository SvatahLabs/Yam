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
import type { EventStore } from "./events.js";
import type { RedactionPolicy } from "./redaction.js";
import { addSecretLiteral, redactObject } from "./redaction.js";

export interface DispatchContext {
  sessions: SessionStore;
  references?: ReferenceStore;
  coordination?: CoordinationStore;
  events?: EventStore;
  redaction?: RedactionPolicy;
}

function maybeRedact(ctx: DispatchContext, result: Record<string, unknown>): Record<string, unknown> {
  if (!ctx.redaction) return result;
  return redactObject(ctx.redaction, result) as Record<string, unknown>;
}

/**
 * Refuse a mutation on a target somebody else holds (SF-13, T16).
 *
 * Every mutation, not only `act`. Driving T16 found `request` going through
 * while an agent held the target: the check lived in one dispatcher rather than
 * in one place, which is how a rule with two callers gets applied by one.
 * Refused and told who has it — never queued, never retried.
 */
function heldByAnother(
  ctx: DispatchContext,
  session: string,
  holder: string | undefined,
  requestId: string,
  operationName: string,
): Record<string, unknown> | undefined {
  const held = ctx.coordination?.getControl(`${session}:target`);
  const me = holder ?? requestId;
  if (held === undefined || held.holder === me) return undefined;
  ctx.events?.emit({
    sessionId: session,
    kind: "lease.refused",
    operationName,
    data: { holder: held.holder },
  });
  return refusedEnvelope(
    requestId,
    session,
    "CONTROL_BUSY",
    `"${held.holder}" holds this target. Take control to act on it.`,
    { holder: held.holder, since: new Date(held.since).toISOString() },
  );
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
    ctx.events?.emit({
      sessionId,
      kind: "session.created",
      operationName: "connect",
      data: { adapter: adapterName, url: input.url },
    });
    const envelope = successEnvelope(requestId, sessionId, {
      sessionId,
      adapter: adapterName,
      kind: surface.kind,
      capabilities: caps,
    }, elapsed);
    return maybeRedact(ctx, envelope);
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

    const envelope = successEnvelope(requestId, input.session, {
      ...snap,
      ...(snapshotId ? { snapshotId } : {}),
      ...(generation !== undefined ? { generation } : {}),
      truncated,
    }, elapsed);
    return maybeRedact(ctx, envelope);
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
    /**
     * Values that must never be echoed back (SF-15).
     *
     * The redaction policy existed and was wired into every result, and nothing
     * could put anything in it: no flag, no argument, no option. A password
     * typed through `act` came back in the result, the event and the trajectory
     * because there was no way for the caller to say it was one.
     */
    secrets?: readonly string[];
  },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const start = Date.now();
  if (ctx.redaction) for (const secret of input.secrets ?? []) addSecretLiteral(ctx.redaction, secret);
  const entry = ctx.sessions.get(input.session);
  if (!entry) {
    return failedEnvelope(requestId, input.session, "SESSION_NOT_FOUND", `Session ${input.session} not found`);
  }

  if (ctx.references && input.ref) {
    const check = ctx.references.validateRef(input.session, input.ref, input.snapshot);
    if (!check.valid) {
      ctx.events?.emit({
        sessionId: input.session,
        kind: "operation.refused",
        operationName: input.action,
        data: { code: check.code, ref: input.ref },
      });
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
      ctx.events?.emit({
        sessionId: input.session,
        kind: "operation.refused",
        operationName: input.action,
        data: { code: "INVALID_ARGUMENT", idempotencyKey: input.idempotencyKey },
      });
      return refusedEnvelope(requestId, input.session, "INVALID_ARGUMENT", idemCheck.message);
    }
  }

  const targetKey = `${input.session}:target`;
  if (ctx.coordination) {
    const refusal = heldByAnother(ctx, input.session, input.holder, requestId, input.action);
    if (refusal !== undefined) return refusal;
    const leaseResult = ctx.coordination.acquireLease(
      input.session,
      targetKey,
      input.holder ?? requestId,
      input.deadlineMs,
    );
    if (!leaseResult.acquired) {
      ctx.events?.emit({
        sessionId: input.session,
        kind: "lease.refused",
        operationName: input.action,
        data: { holder: leaseResult.holder, operationId: leaseResult.operationId },
      });
      return refusedEnvelope(requestId, input.session, "CONTROL_BUSY", `Target is held by "${leaseResult.holder}" (operation ${leaseResult.operationId}). Wait or request handoff.`, {
        holder: leaseResult.holder,
        operationId: leaseResult.operationId,
      });
    }
    ctx.events?.emit({
      sessionId: input.session,
      kind: "lease.acquired",
      operationName: input.action,
      data: { holder: input.holder ?? requestId, targetKey },
    });
  }

  let opRecord: ReturnType<CoordinationStore["recordDispatch"]> | undefined;
  if (ctx.coordination) {
    opRecord = ctx.coordination.recordDispatch(input.session, input.action);
  }

  ctx.events?.emit({
    sessionId: input.session,
    kind: "operation.dispatched",
    operationName: input.action,
    data: { ref: input.ref, action: input.action },
  });

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
    ctx.events?.emit({
      sessionId: input.session,
      kind: "operation.succeeded",
      operationName: input.action,
      data: { ref: input.ref },
    });
    return maybeRedact(ctx, envelope);
  } catch (err) {
    if (ctx.coordination) {
      ctx.coordination.releaseLease(targetKey, "failed");
      if (opRecord) ctx.coordination.completeOperation(opRecord.operationId, "failed");
    }
    ctx.events?.emit({
      sessionId: input.session,
      kind: "operation.failed",
      operationName: input.action,
      data: { ref: input.ref, error: err instanceof Error ? err.message : String(err) },
    });
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
  /*
   * Every session, with who holds it (SF-13, T16). Ownership is what makes a
   * shared target safe to look at: a client that cannot see who is driving
   * cannot hand over, and the desktop shows it beside each session.
   */
  const sessions = ctx.sessions.list().map((one) => {
    const held = ctx.coordination?.getControl(`${one.sessionId}:target`);
    return {
      ...one,
      ...(held === undefined
        ? {}
        : { controller: held.holder, controlledSince: new Date(held.since).toISOString() }),
    };
  });
  return successEnvelope(requestId, undefined, { sessions });
}

/**
 * Take, release, or report who holds a target (SF-13, T16).
 *
 * The explicit handoff. `force` takes a target its holder has not given up —
 * what a person does from the UI when an agent has walked away — and it is
 * reported as the holder changing rather than as the target having been free.
 */
export async function dispatchControl(
  ctx: DispatchContext,
  input: { session: string; action?: "take" | "release" | "status"; holder?: string; force?: boolean },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const entry = ctx.sessions.get(input.session);
  if (!entry) {
    return failedEnvelope(requestId, input.session, "SESSION_NOT_FOUND", `Session ${input.session} not found`);
  }
  if (!ctx.coordination) {
    return refusedEnvelope(requestId, input.session, "UNSUPPORTED_OPERATION", "This broker does not arbitrate control.");
  }

  const targetKey = `${input.session}:target`;
  const me = input.holder ?? "this client";
  const action = input.action ?? "status";

  if (action === "take") {
    const taken = ctx.coordination.takeControl(targetKey, me);
    if (!taken.taken) {
      if (input.force !== true) {
        return refusedEnvelope(
          requestId,
          input.session,
          "CONTROL_BUSY",
          `"${taken.holder}" holds this target. Ask for a handoff, or take it explicitly.`,
          { holder: taken.holder, since: new Date(taken.since).toISOString() },
        );
      }
      // An explicit handoff: the previous holder is released and told so.
      ctx.coordination.releaseControl(targetKey, taken.holder, true);
      ctx.coordination.takeControl(targetKey, me);
      ctx.events?.emit({
        sessionId: input.session,
        kind: "lease.acquired",
        operationName: "control",
        data: { holder: me, from: taken.holder, forced: true },
      });
    }
    const held = ctx.coordination.getControl(targetKey)!;
    return successEnvelope(requestId, input.session, {
      holder: held.holder,
      since: new Date(held.since).toISOString(),
      heldByYou: held.holder === me,
    });
  }

  if (action === "release") {
    const released = ctx.coordination.releaseControl(targetKey, me, input.force);
    if (!released.released && released.holder !== undefined) {
      return refusedEnvelope(
        requestId,
        input.session,
        "CONTROL_BUSY",
        `"${released.holder}" holds this target; only its holder can give it up.`,
        { holder: released.holder },
      );
    }
    ctx.events?.emit({
      sessionId: input.session,
      kind: "lease.released",
      operationName: "control",
      data: { holder: me },
    });
    return successEnvelope(requestId, input.session, { heldByYou: false });
  }

  const held = ctx.coordination.getControl(targetKey);
  return successEnvelope(requestId, input.session, {
    ...(held === undefined ? {} : { holder: held.holder, since: new Date(held.since).toISOString() }),
    heldByYou: held?.holder === me,
  });
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

/**
 * Send an HTTP request on an HTTP surface (T15, SF-04).
 *
 * `AgentSurface.request` is optional — a browser does not have one — so an
 * adapter without it is refused with `UNSUPPORTED_OPERATION` rather than
 * failing somewhere inside. The response is returned whole; a caller reads a
 * field from it with `read`, exactly as an `api` step does.
 */
export async function dispatchRequest(
  ctx: DispatchContext,
  input: {
    session: string;
    request: Record<string, unknown>;
    withSessionCookies?: boolean;
    holder?: string;
  },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const start = Date.now();
  const entry = ctx.sessions.get(input.session);
  if (!entry) {
    return failedEnvelope(requestId, input.session, "SESSION_NOT_FOUND", `Session ${input.session} not found`);
  }
  // Sending a request is a mutation, so it waits for the target like any other.
  const refusal = heldByAnother(ctx, input.session, input.holder, requestId, "request");
  if (refusal !== undefined) return refusal;
  const surface = entry.surface as {
    request?: (req: unknown, options: unknown) => Promise<unknown>;
  };
  if (typeof surface.request !== "function") {
    return refusedEnvelope(
      requestId,
      input.session,
      "UNSUPPORTED_OPERATION",
      `The ${entry.adapter} adapter does not send HTTP requests.`,
      { adapter: entry.adapter },
    );
  }
  try {
    const response = await surface.request(input.request, {
      withSessionCookies: input.withSessionCookies === true,
      scope: { read: () => undefined },
    });
    const elapsed = Date.now() - start;
    ctx.events?.emit({
      sessionId: input.session,
      kind: "operation.succeeded",
      operationName: "request",
      data: { method: input.request["method"], url: input.request["url"] },
    });
    // Redacted like every other result: a response body is page text, and a
    // declared secret must not come back in one (SF-15).
    const envelope = successEnvelope(requestId, input.session, { response }, elapsed);
    return maybeRedact(ctx, envelope);
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
