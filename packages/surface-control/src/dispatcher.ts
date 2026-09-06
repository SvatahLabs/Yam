import type { AgentSurface } from "@svatah/yam-surface";
import type { ReadKind, CheckSubject, Ref, ActArgs, Capabilities } from "@svatah/yam-schema";
import { SurfaceError } from "@svatah/yam-surface";
import { makeRequestId, successEnvelope, failedEnvelope, refusedEnvelope } from "./envelope.js";
import type { SessionStore } from "./sessions.js";
import type { ErrorCode } from "./catalogue.js";

export interface DispatchContext {
  sessions: SessionStore;
}

export async function dispatchConnect(
  ctx: DispatchContext,
  input: {
    url?: string;
    adapter?: string;
    headed?: boolean;
    adapterFactory: (name: string, options?: { headed?: boolean }) => Promise<AgentSurface>;
  },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const start = Date.now();
  try {
    const adapterName = input.adapter ?? "playwright";
    const surface = await input.adapterFactory(adapterName, { headed: input.headed });
    const sessionId = ctx.sessions.create(surface, adapterName);

    await surface.open({
      baseUrl: input.url,
    });

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
    return successEnvelope(requestId, input.session, snap, elapsed);
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
  },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const start = Date.now();
  const entry = ctx.sessions.get(input.session);
  if (!entry) {
    return failedEnvelope(requestId, input.session, "SESSION_NOT_FOUND", `Session ${input.session} not found`);
  }
  try {
    const result = await entry.surface.act(
      input.action as Parameters<AgentSurface["act"]>[0],
      input.ref as Ref | undefined,
      input.args,
      input.ref2 as Ref | undefined,
    );
    const elapsed = Date.now() - start;
    return successEnvelope(requestId, input.session, result, elapsed);
  } catch (err) {
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
      input.predicate as Parameters<AgentSurface["check"]>[0],
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
    const elapsed = Date.now() - start;
    return successEnvelope(requestId, input.session, { closed: true }, elapsed);
  } catch (err) {
    ctx.sessions.remove(input.session);
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
  input: { session: string; ref: string },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const start = Date.now();
  const entry = ctx.sessions.get(input.session);
  if (!entry) {
    return failedEnvelope(requestId, input.session, "SESSION_NOT_FOUND", `Session ${input.session} not found`);
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
