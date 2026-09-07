import type { AgentSurface } from "@svatah/yam-surface";
import type { ReadKind, CheckSubject, Ref, ActArgs } from "@svatah/yam-schema";
import { SurfaceError } from "@svatah/yam-surface";
import { ACTION_FORMS } from "@svatah/yam-schema";
import { makeRequestId, successEnvelope, failedEnvelope, refusedEnvelope } from "./envelope.js";
import type { SessionStore } from "./sessions.js";
import type { ErrorCode } from "./catalogue.js";
import {
  discoverTargets,
  probeAdapters,
  checkAdapterReadiness,
} from "./discovery.js";
import type { ReferenceStore } from "./references.js";
import type { CoordinationStore } from "./coordination.js";
import { hashInput } from "./coordination.js";
import type { EventStore } from "./events.js";
import type { RedactionPolicy } from "./redaction.js";
import type { PromotionStore } from "./promotion.js";
import { addSecretLiteral, redactObject } from "./redaction.js";


/**
 * No such session — and the two things that mean (T00, SF-05, SF-14).
 *
 * A session id that nothing recognises is either one that has been closed, or
 * one that was opened on a *different broker*. The second used to be invisible:
 * a machine could end up with two brokers, the descriptor named one of them,
 * and every command about a session on the other answered "Session s_… not
 * found" with nothing to say which had happened. Wave 4 spent a verification
 * pass on that sentence and could not root-cause it from the message.
 *
 * The message now names both, and `yam surface sessions` is the inspection
 * route SF-14 asks a caller to be given rather than a retry.
 */
function sessionNotFound(requestId: string, session: string) {
  return failedEnvelope(
    requestId,
    session,
    "SESSION_NOT_FOUND",
    `No session ${session} here. It has either been closed, or it was opened against a ` +
      "different session holder than the one answering now. `yam surface sessions` lists the " +
      "ones this holder has.",
  );
}


export interface DispatchContext {
  sessions: SessionStore;
  references?: ReferenceStore;
  coordination?: CoordinationStore;
  events?: EventStore;
  redaction?: RedactionPolicy;
  /** What a session did, in a shape that compiles into a proposal (T17). */
  promotion?: PromotionStore;
}

function maybeRedact(ctx: DispatchContext, result: Record<string, unknown>): Record<string, unknown> {
  if (!ctx.redaction) return result;
  return redactObject(ctx.redaction, result) as Record<string, unknown>;
}

/**
 * Who a caller is when it does not say (SF-13).
 *
 * One default for taking control and for acting on it. The first cut used this
 * name when control was taken and the request id when a mutation came in, so a
 * client that took a target without naming itself was refused by its own hold
 * on its very next action — `yam surface control --take` followed by `yam
 * surface act` answered CONTROL_BUSY naming "this client". Every transport
 * supplies a name of its own by default (the terminal, the agent, the desktop);
 * this is what the broker assumes when none of them did.
 */
export const DEFAULT_HOLDER = "this client";

/**
 * Take the target for one mutation (SF-13, SF-14).
 *
 * Every mutation goes through here — `act` and `request` alike — so the rules
 * are applied once: refused while somebody else holds control, refused while
 * another mutation is in flight, and on the operation record from dispatch to
 * outcome so a caller that lost its connection can ask what became of it. The
 * first cut had `request` check control and nothing else, which left the lease
 * and the record to `act` alone.
 */
function beginMutation(
  ctx: DispatchContext,
  input: { session: string; holder?: string; deadlineMs?: number },
  requestId: string,
  operationName: string,
): { refusal: Record<string, unknown> } | { mutation: { end(outcome: "succeeded" | "failed"): void } } {
  const coordination = ctx.coordination;
  if (!coordination) return { mutation: { end: () => undefined } };
  const targetKey = `${input.session}:target`;
  const me = input.holder ?? DEFAULT_HOLDER;
  const held = heldByAnother(ctx, input.session, input.holder, requestId, operationName);
  if (held !== undefined) return { refusal: held };
  const lease = coordination.acquireLease(input.session, targetKey, me, input.deadlineMs);
  if (!lease.acquired) {
    ctx.events?.emit({
      sessionId: input.session,
      kind: "lease.refused",
      operationName,
      data: { holder: lease.holder, operationId: lease.operationId },
    });
    return {
      refusal: refusedEnvelope(
        requestId,
        input.session,
        "CONTROL_BUSY",
        `Target is held by "${lease.holder}" (operation ${lease.operationId}). Wait or request handoff.`,
        { holder: lease.holder, operationId: lease.operationId },
      ),
    };
  }
  ctx.events?.emit({
    sessionId: input.session,
    kind: "lease.acquired",
    operationName,
    data: { holder: me, targetKey },
  });
  const record = coordination.recordDispatch(input.session, operationName);
  return {
    mutation: {
      end(outcome) {
        coordination.releaseLease(targetKey, outcome);
        coordination.completeOperation(record.operationId, outcome);
      },
    },
  };
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
  const me = holder ?? DEFAULT_HOLDER;
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
  /*
   * Asked, not looked up (T23, SF-09).
   *
   * `discoverAdapters` answers from a platform table, which is a claim about a
   * `Record<string, string[]>` — `appium: available` on a machine with no
   * Appium server. `targets` is the operation a caller asks *before* it
   * connects, so it is the one that should cost a probe and answer with the
   * version the host said and the reason it could not be asked.
   */
  const adapters = await probeAdapters(input.registeredAdapters ?? []);
  const elapsed = Date.now() - start;
  return successEnvelope(requestId, undefined, { targets, adapters }, elapsed);
}

export async function dispatchConnect(
  ctx: DispatchContext,
  input: {
    url?: string;
    app?: string;
    attach?: string;
    /** Adapter-specific launch details (design.md; T22). */
    launch?: {
      bundle?: string;
      path?: string;
      args?: string[];
      env?: Record<string, string>;
      timeoutMs?: number;
      size?: [number, number];
    };
    adapter?: string;
    headed?: boolean;
    adapterFactory: (name: string, options?: { headed?: boolean }) => Promise<AgentSurface>;
    registeredAdapters?: string[];
  },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const start = Date.now();
  try {
    /*
     * One target, named once (SF-04, T18).
     *
     * The catalogue's schema refuses two of these together, and so does this:
     * the broker is reached over HTTP by clients the catalogue does not
     * validate for, and "no silent switch to another adapter, tab or foreground
     * application" has to hold at the place the session is actually made.
     */
    const named = [input.url, input.app, input.attach].filter((one) => one !== undefined);
    if (named.length > 1) {
      return refusedEnvelope(
        requestId,
        undefined,
        "INVALID_ARGUMENT",
        "Name one target: a URL launches a browser, an endpoint joins one that is already " +
          "running, and an application name drives an application that is already running.",
      );
    }
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
    /*
     * Who owns the target this session drives (T00, SF-05).
     *
     * "Closing an attached session detaches without closing the user's
     * application; closing a launched target follows its documented ownership
     * policy" — so the store has to be told which of the two this is, and it was
     * not: every session was created with the default, `launch`. A session
     * opened with `--attach <endpoint>` on somebody's running application was
     * recorded, listed and reported as one Yam had launched, and both
     * `closeAll` and the TTL sweep read that field to decide whether to close
     * the target. The adapter's own `close` happens to detach rather than quit,
     * so nothing had yet quit an application that was not ours — but the
     * broker's record of what it owns was wrong, which is the fact SF-05 asks
     * it to publish.
     *
     * `attach` is the mode whenever the caller named an endpoint or an
     * application that already exists; `launch` is when Yam started the target.
     */
    const mode = input.attach !== undefined || input.app !== undefined ? "attach" : "launch";
    const sessionId = ctx.sessions.create(surface, adapterName, { mode });

    /*
     * `SessionInit` already carried all three of these; nothing but the
     * catalogue's own vocabulary was missing (T18). `processName` is how a
     * native adapter addresses a window that exists, and `attach.cdpUrl` how a
     * web adapter joins a browser somebody else started — which is what makes
     * a packaged application's renderer reachable through the same operation
     * as any other web target.
     */
    await surface.open({
      ...(input.url === undefined ? {} : { baseUrl: input.url }),
      ...(input.app === undefined ? {} : { processName: input.app }),
      ...(input.attach === undefined ? {} : { attach: { cdpUrl: input.attach } }),
      /*
       * How to start it, when the caller said (T22). The adapter decides what
       * each field means for its own kind of target — a bundle to a desktop
       * adapter, a program's arguments and its readable root to a terminal.
       */
      ...(input.launch === undefined ? {} : { launch: input.launch }),
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
      data: { adapter: adapterName, url: input.url, app: input.app, attach: input.attach },
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
    return sessionNotFound(requestId, input.session);
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
    /** Optional metadata, never a gate (SF-12); it becomes the step's sentence. */
    intent?: string;
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
    return sessionNotFound(requestId, input.session);
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

  /*
   * The action's own arguments, checked before dispatch (SF-11, T18).
   *
   * > Act validates an action-specific schema, reference scope, capability and
   * > precondition **before dispatch**.
   *
   * Reference scope was checked here and the arguments were not, so a missing
   * one reached the adapter — which threw `ActionabilityError`, which this file
   * maps to `TIMEOUT`. `yam surface act --action type` with no value therefore
   * answered *"the type action needs an argument value"* under the code for a
   * deadline, and exited 75. An agent reads `TIMEOUT` as "try it again", and no
   * number of retries supplies an argument nobody sent.
   *
   * `ACTION_FORMS` already says which arguments each action takes — T15 put it
   * beside the catalogue precisely so no client would have to know — so the
   * check is the table, not a second list that could disagree with it.
   */
  const form = ACTION_FORMS.find((one) => one.action === input.action);
  if (form !== undefined) {
    const supplied = (input.args ?? {}) as Record<string, unknown>;
    const given = (field: (typeof form.fields)[number]): boolean =>
      [field.name, ...(field.alsoAccepts ?? [])].some(
        (name) => supplied[name] !== undefined && supplied[name] !== "",
      );
    const missing = form.fields
      .filter((field) => field.required)
      .filter((field) => !given(field))
      .map((field) => field.name);
    if (missing.length > 0) {
      ctx.events?.emit({
        sessionId: input.session,
        kind: "operation.refused",
        operationName: input.action,
        data: { code: "INVALID_ARGUMENT", missing },
      });
      return refusedEnvelope(
        requestId,
        input.session,
        "INVALID_ARGUMENT",
        `The "${input.action}" action needs ${missing.map((one) => `"${one}"`).join(" and ")}. ` +
          `Nothing was dispatched.`,
        { action: input.action, missing },
      );
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

  const begun = beginMutation(ctx, input, requestId, input.action);
  if ("refusal" in begun) return begun.refusal;
  const { mutation } = begun;

  ctx.events?.emit({
    sessionId: input.session,
    kind: "operation.dispatched",
    operationName: input.action,
    data: { ref: input.ref, action: input.action },
  });

  /*
   * The evidence a promotion needs, read *before* the call (T17, SF-19).
   *
   * After a click that navigates there is nothing left to describe, which is
   * exactly when the step is worth recording. One element and one URL — not the
   * page read wave 1 rightly removed — and only for a mutation.
   */
  let evidence: { url?: string; describe?: unknown } = {};
  if (ctx.promotion) {
    const url = await entry.surface.read("url").catch(() => undefined);
    const described =
      input.ref === undefined
        ? undefined
        : await entry.surface.describe(input.ref as Ref).catch(() => undefined);
    evidence = {
      ...(typeof url === "string" ? { url } : {}),
      ...(described === undefined ? {} : { describe: described }),
    };
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

    mutation.end("succeeded");

    /*
     * The shape the compiler reads (T17): `{ action, args, ref2 }`, with the
     * action's own arguments *nested*. Flattening them cost the typed value —
     * a promoted "type" step compiled to `Type "" into the Username field`,
     * which is a proposal that would type nothing. The MCP path records the
     * same shape, so one trajectory reads the same whoever wrote it.
     */
    ctx.promotion?.record(input.session, {
      call: "act",
      ...(input.intent === undefined ? {} : { intent: input.intent }),
      args: {
        action: input.action,
        ...(input.args === undefined ? {} : { args: input.args }),
        ...(input.ref2 === undefined ? {} : { ref2: input.ref2 }),
      },
      ...(input.ref === undefined ? {} : { ref: input.ref }),
      ...evidence,
      result,
    });

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
    mutation.end("failed");
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
    return sessionNotFound(requestId, input.session);
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
    return sessionNotFound(requestId, input.session);
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
    return sessionNotFound(requestId, input.session);
  }
  try {
    await entry.surface.close();
    ctx.sessions.remove(input.session);
    ctx.references?.invalidateSession(input.session);
    const elapsed = Date.now() - start;
    ctx.promotion?.clear(input.session);
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
/**
 * What this session did, and what of it would compile (T17, SF-19).
 *
 * `events` is the redacted record a person reads in Activity; `steps` is the
 * same session in the shape a proposal is compiled from. Both are the broker's,
 * so a client promotes what actually happened rather than what it believes it
 * asked for.
 */
export async function dispatchEvents(
  ctx: DispatchContext,
  input: { session: string },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const entry = ctx.sessions.get(input.session);
  if (!entry) {
    return sessionNotFound(requestId, input.session);
  }
  const events = ctx.events?.list(input.session) ?? [];
  const steps = ctx.promotion?.list(input.session) ?? [];
  const envelope = successEnvelope(requestId, input.session, { events, steps }, 0);
  return maybeRedact(ctx, envelope);
}

export async function dispatchControl(
  ctx: DispatchContext,
  input: { session: string; action?: "take" | "release" | "status"; holder?: string; force?: boolean },
): Promise<Record<string, unknown>> {
  const requestId = makeRequestId();
  const entry = ctx.sessions.get(input.session);
  if (!entry) {
    return sessionNotFound(requestId, input.session);
  }
  if (!ctx.coordination) {
    return refusedEnvelope(requestId, input.session, "UNSUPPORTED_OPERATION", "This broker does not arbitrate control.");
  }

  const targetKey = `${input.session}:target`;
  const me = input.holder ?? DEFAULT_HOLDER;
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
    return sessionNotFound(requestId, input.session);
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
    return sessionNotFound(requestId, input.session);
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
    return sessionNotFound(requestId, input.session);
  }
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
  // A request is a mutation, and takes the target like one (SF-13, SF-14).
  const begun = beginMutation(ctx, input, requestId, "request");
  if ("refusal" in begun) return begun.refusal;
  const { mutation } = begun;
  try {
    const response = await surface.request(input.request, {
      withSessionCookies: input.withSessionCookies === true,
      scope: { read: () => undefined },
    });
    const elapsed = Date.now() - start;
    mutation.end("succeeded");
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
    mutation.end("failed");
    ctx.events?.emit({
      sessionId: input.session,
      kind: "operation.failed",
      operationName: "request",
      data: { error: err instanceof Error ? err.message : String(err) },
    });
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
    return sessionNotFound(requestId, input.session);
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
    /*
     * A `DataError` is by definition about what the caller supplied — a missing
     * argument, a value the surface has no meaning for, a path outside the root
     * it was told about. `OUTCOME_UNKNOWN` said "nobody can tell whether this
     * took effect", which is the opposite of true: nothing was dispatched.
     */
    case "DataError":
      return "INVALID_ARGUMENT";
    case "SessionError":
      return "SESSION_CLOSED";
    case "NavigationError":
      return "CONNECT_FAILED";
    default:
      return "OUTCOME_UNKNOWN";
  }
}
