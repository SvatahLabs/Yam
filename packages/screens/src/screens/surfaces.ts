/**
 * Surfaces — connect to something, then inspect and act on it (T14, T15).
 *
 * This is the screen the desktop opens into, and it has two moods. With no
 * session chosen it is the connect flow of T14: discovery grouped by platform
 * with the exact prerequisite shown for anything unavailable, and the sessions
 * that are open now — an agent's as much as a person's.
 *
 * With a session chosen it is T15's **action inspector**: the surface's semantic
 * tree, a selected control, and a form built from what the *catalogue* says that
 * action needs (`ACTION_FORMS`). Fill takes a value, click takes the control,
 * drag takes two, navigate takes a URL — and an HTTP surface, whose `act`
 * refuses everything and whose tree is empty, gets the request form instead.
 *
 * It is a client of the broker and of nothing else. Everything here is a
 * `GET /targets`, `GET /sessions`, `…/capabilities`, `…/snapshot` or
 * `…/describe` answer — the catalogue's own routes, the same sessions the CLI
 * and a generic MCP client address (SF-03). The screen holds no session store,
 * no operation list, and no idea of what an action needs beyond what the
 * contract publishes.
 */
/*
 * The action vocabulary from the browser-safe entry (T18).
 *
 * `@svatah/yam-schema`'s barrel is one bundled file that carries
 * `canonical.ts`'s `node:crypto` import, so a renderer that pulled
 * `offeredActions` from it could not be built at all — the shipped desktop
 * bundle failed on `"createHash" is not exported by "__vite-browser-external"`.
 * The names are identical and the barrel still re-exports them; this import
 * only says which *file* the browser gets.
 */
import { offeredActions, defaultActionForRole, type ActionForm } from "@svatah/yam-schema/action-forms";
import type { CapabilityFlag, SurfaceKind } from "@svatah/yam-schema";
import { DESKTOP_HOLDER } from "../holder.js";
import { Sources, dotted, plural } from "../load.js";
import { actionsForScreen } from "../registry.js";
import type { Pill, Screen, ScreenParams, ScreenStateBase } from "../types.js";

/** How a person reads an adapter's home: "a browser, an app, a device or an API". */
const FAMILY: Readonly<Record<string, string>> = {
  playwright: "Browser",
  bidi: "Browser",
  ax: "Native app",
  uia: "Native app",
  appium: "Device",
  http: "API",
};
const OTHER_FAMILY = "Other";

/** The order the families are drawn in, so a browser is always the first offer. */
const FAMILY_ORDER = ["Browser", "API", "Native app", "Device", OTHER_FAMILY];

/** How many nodes the inspector's tree asks for. Bounded, and it says when it truncated. */
export const TREE_MAX_NODES = 200;

/** One adapter the service reported, with its readiness and, when not, why. */
export interface SurfaceAdapterRow {
  readonly adapter: string;
  readonly family: string;
  readonly registered: boolean;
  readonly available: boolean;
  readonly platform: readonly string[];
  /** The exact reason it is unavailable, from the service — never inferred here. */
  readonly reason?: string;
  /** What a person would have to install or grant to make it available. */
  readonly prerequisites: readonly string[];
  readonly pill: Pill;
}

/** One target the service discovered — an adapter, or a URL through one. */
export interface SurfaceTargetRow {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly adapter: string;
  readonly url?: string;
  readonly application?: string;
  readonly ready: boolean;
  readonly reason?: string;
}

/** A platform family, with its adapters and any targets discovered under it. */
export interface SurfacePlatformGroup {
  readonly family: string;
  readonly adapters: readonly SurfaceAdapterRow[];
  readonly targets: readonly SurfaceTargetRow[];
}

/** One open session, an agent's or a person's (SF-05, SF-13). */
export interface SurfaceSessionRow {
  readonly sessionId: string;
  readonly adapter: string;
  readonly kind: string;
  readonly status: string;
  readonly targetId?: string;
  readonly createdAt?: string;
  readonly pill: Pill;
  readonly selected: boolean;
  /** Who holds this target, when anyone does (SF-13, T16). */
  readonly controller?: string;
  /** Whether that is this desktop. */
  readonly heldByYou: boolean;
  /** "You control" / "agent-1 controls" / "Nobody" — never a bare colour. */
  readonly control: string;
}

/* ── T15: the connected surface ────────────────────────────────────────────── */

/** One line of the semantic tree, as the inspector draws it. */
export interface SurfaceTreeLine {
  readonly ref: string;
  readonly role: string;
  readonly name?: string;
  readonly value?: string;
  readonly depth: number;
  readonly states: readonly string[];
  readonly selected: boolean;
}

/** What `describe` said about the selected control. */
export interface SurfaceElementView {
  readonly ref: string;
  readonly role: string;
  readonly name?: string;
  readonly value?: string;
  readonly description?: string;
  readonly states: readonly string[];
  /** "Text field · Enabled", the subtitle the mockup puts under the name. */
  readonly summary: string;
}

/** One field of an action's form, as the catalogue describes it. */
export interface SurfaceActionField {
  readonly name: string;
  readonly type: string;
  readonly required: boolean;
  readonly label: string;
  readonly placeholder?: string;
}

/** One action this surface can perform, with what it needs. */
export interface SurfaceActionOffer {
  readonly action: string;
  readonly label: string;
  readonly needsRef: boolean;
  readonly needsRef2: boolean;
  readonly fields: readonly SurfaceActionField[];
  readonly chosen: boolean;
}

/** The session the inspector is about. */
export interface SurfaceSessionView {
  readonly sessionId: string;
  readonly adapter: string;
  readonly kind: string;
  readonly status: string;
  readonly pill: Pill;
  readonly capabilities: Readonly<Record<string, boolean>>;
  /** Who holds this target (SF-13, T16). */
  readonly controller?: string;
  readonly heldByYou: boolean;
  readonly control: string;
}

/** What a generic MCP client needs to reach the same sessions (SF-07, T16). */
export interface SurfaceAgentSetup {
  /** The configuration, ready to copy into a client. */
  readonly config: string;
  /** Whether the broker an agent would share answered just now. */
  readonly brokerReady: boolean;
  /** Exactly what a connection test checked, so the panel claims no more. */
  readonly checks: readonly string[];
}

/**
 * A state the inspector is in that is not "ready" (SF-17).
 *
 * Every one names what to do next, because a state with no next action is the
 * dead end this task exists to remove.
 */
export type SurfaceProblemKind =
  | "stale"
  | "busy"
  | "unsupported"
  | "permission"
  | "unknown"
  | "disconnected";

export interface SurfaceProblem {
  readonly kind: SurfaceProblemKind;
  /** The service's own words. */
  readonly message: string;
  /** What a person does about it. */
  readonly nextAction: string;
  /** The action id that does it, when an action does. */
  readonly nextActionId?: string;
}

/** What an act (and its optional postcondition) came to (SF-11). */
export interface SurfaceOutcomeView {
  /** The action reached the target. Never "it worked". */
  readonly dispatched: boolean;
  /**
   * The envelope's own word for what happened (SF-11). `unknown` is the one
   * that matters: a mutation that timed out may have reached the target, and
   * calling it "refused" — as the first cut's pill did — told a person it had
   * not been sent at all.
   */
  readonly outcome: "succeeded" | "failed" | "refused" | "unknown" | "cancelled";
  /** True only when an explicit postcondition passed (SF-11). */
  readonly verified: boolean;
  readonly verification: "none" | "passed" | "failed";
  /** One line for a person: "Field filled · Value verified". */
  readonly summary: string;
  readonly actual?: string;
  readonly expected?: string;
  readonly requestId?: string;
  readonly errorCode?: string;
  readonly problem?: SurfaceProblem;
  /** The envelopes, for the Details disclosure. */
  readonly raw: string;
}

export interface SurfacesState extends ScreenStateBase {
  readonly screen: "surfaces";
  /** Discovery, grouped by platform family (SF-04). */
  readonly groups: readonly SurfacePlatformGroup[];
  /** The sessions the broker holds (SF-05). */
  readonly sessions: readonly SurfaceSessionRow[];
  /** The selected session, when one is chosen. */
  readonly selected?: string;
  /** Whether discovery itself answered, or the broker could not be reached. */
  readonly discovery: "ready" | "error";
  /**
   * What to say when discovery could not answer (SF-17).
   *
   * Inline, not the base `error`: a broker that is briefly unreachable must not
   * blank the whole screen — the connect form still works and starts the broker
   * lazily — so this is drawn as an alert *within* Surfaces with a Recheck.
   */
  readonly discoveryMessage?: string;
  /**
   * What the discovery pane says when it has nothing to list (SF-17).
   *
   * There are two ways to have nothing, and they are not the same statement.
   * *Nothing is installed* is a claim about the machine; *nothing could be
   * asked* is a claim about Yam. The pane said the first in both cases, so a
   * broker that was briefly unreachable produced "No adapter is installed" on a
   * machine with eight — directly contradicting the alert above it, which was
   * saying the broker could not be reached.
   *
   * A screen that reports its own inability as a fact about the user's system
   * is the failure this project keeps finding in its own harnesses; it is no
   * better in the product.
   */
  readonly discoveryEmpty: string;
  /** Whether anything can be connected to at all — false is the empty state. */
  readonly anyConnectable: boolean;

  /* ── the connected surface (T15), present when a session is chosen ───────── */

  readonly session?: SurfaceSessionView;
  /** The semantic tree. Always available, including where screenshots are not. */
  readonly tree: readonly SurfaceTreeLine[];
  readonly snapshotId?: string;
  /** The tree was cut off at `TREE_MAX_NODES`; the screen says so. */
  readonly truncated: boolean;
  /** The selected control. */
  readonly ref?: string;
  readonly element?: SurfaceElementView;
  /** The actions this surface can perform, from the catalogue (SF-09). */
  readonly offers: readonly SurfaceActionOffer[];
  /** The action the form is showing. Never undefined once a surface is chosen. */
  readonly action?: string;
  /**
   * An HTTP surface has no elements: its form is `request`, not `act`.
   */
  readonly httpSurface: boolean;
  /** The SF-17 state, when the surface is in one. */
  readonly problem?: SurfaceProblem;
  /** What a generic MCP client needs to share these sessions (SF-07, T16). */
  readonly agent: SurfaceAgentSetup;
}

const NEUTRAL: Pill = { tone: "neutral", label: "—" };

/** A session status → the pill the mockup draws beside it (SF-17). */
function sessionPill(status: string): Pill {
  switch (status) {
    case "ready":
      return { tone: "pass", label: "ready" };
    case "busy":
      return { tone: "info", label: "busy" };
    case "connecting":
      return { tone: "info", label: "connecting" };
    case "disconnected":
      return { tone: "abort", label: "disconnected" };
    case "closed":
      return { tone: "neutral", label: "closed" };
    default:
      return NEUTRAL;
  }
}

/** An adapter's readiness → its pill: ready, or the honest unavailable word. */
function adapterPill(available: boolean, registered: boolean): Pill {
  if (available) return { tone: "pass", label: "ready" };
  if (!registered) return { tone: "skip", label: "not installed" };
  return { tone: "abort", label: "unavailable" };
}

/** The `result` of a succeeded envelope, or `undefined` for a failure/refusal. */
function succeededResult(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const env = value as Record<string, unknown>;
  if (env["status"] !== "succeeded") return undefined;
  const result = env["result"];
  return typeof result === "object" && result !== null
    ? (result as Record<string, unknown>)
    : undefined;
}

/** The `error.message` of a failed/refused envelope, when it carries one. */
export function envelopeError(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const env = value as Record<string, unknown>;
  if (env["status"] === "succeeded") return undefined;
  const error = env["error"];
  if (typeof error === "object" && error !== null) {
    const message = (error as Record<string, unknown>)["message"];
    if (typeof message === "string") return message;
  }
  return undefined;
}

/** The `error.code` of a failed/refused envelope. */
function envelopeCode(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const error = (value as Record<string, unknown>)["error"];
  if (typeof error === "object" && error !== null) {
    const code = (error as Record<string, unknown>)["code"];
    if (typeof code === "string") return code;
  }
  return undefined;
}

/**
 * A domain error code → the state it puts the inspector in, and the way out.
 *
 * This is SF-17's table. Every row names a next action; none of them is an
 * unqualified Retry, because a mutation whose outcome is unknown must never be
 * repeated on a guess (SF-14).
 */
export function problemFor(code: string | undefined, message: string): SurfaceProblem | undefined {
  switch (code) {
    case "STALE_REFERENCE":
      return {
        kind: "stale",
        message,
        nextAction: "Refresh and select again",
        nextActionId: "surface.refresh",
      };
    case "CONTROL_BUSY":
      return {
        kind: "busy",
        message,
        nextAction: "Another client holds control of this target",
      };
    case "UNSUPPORTED_OPERATION":
    case "ADAPTER_UNAVAILABLE":
    case "ADAPTER_NOT_REGISTERED":
      return { kind: "unsupported", message, nextAction: "Choose an action this surface supports" };
    case "PERMISSION_REQUIRED":
      return { kind: "permission", message, nextAction: "Grant the permission, then Recheck", nextActionId: "surface.discover" };
    case "OUTCOME_UNKNOWN":
    case "TIMEOUT":
      return {
        kind: "unknown",
        message,
        // Never "Retry": the mutation may have reached the target (SF-14).
        nextAction: "Inspect the current state before doing anything again",
        nextActionId: "surface.refresh",
      };
    case "SESSION_NOT_FOUND":
    case "SESSION_CLOSED":
      return { kind: "disconnected", message, nextAction: "The session is gone; connect again" };
    default:
      return undefined;
  }
}

function adapterRows(result: Record<string, unknown> | undefined): SurfaceAdapterRow[] {
  const adapters = result?.["adapters"];
  if (!Array.isArray(adapters)) return [];
  return adapters.map((one) => {
    const row = (typeof one === "object" && one !== null ? one : {}) as Record<string, unknown>;
    const adapter = String(row["adapter"] ?? "");
    const registered = row["registered"] === true;
    const available = row["available"] === true;
    return {
      adapter,
      family: FAMILY[adapter] ?? OTHER_FAMILY,
      registered,
      available,
      platform: Array.isArray(row["platform"]) ? (row["platform"] as string[]) : [],
      ...(typeof row["reason"] === "string" ? { reason: row["reason"] } : {}),
      prerequisites: Array.isArray(row["prerequisites"]) ? (row["prerequisites"] as string[]) : [],
      pill: adapterPill(available, registered),
    };
  });
}

function targetRows(result: Record<string, unknown> | undefined): SurfaceTargetRow[] {
  const targets = result?.["targets"];
  if (!Array.isArray(targets)) return [];
  return targets.map((one) => {
    const row = (typeof one === "object" && one !== null ? one : {}) as Record<string, unknown>;
    return {
      id: String(row["id"] ?? ""),
      name: String(row["name"] ?? ""),
      kind: String(row["kind"] ?? ""),
      adapter: String(row["adapter"] ?? ""),
      ...(typeof row["url"] === "string" ? { url: row["url"] } : {}),
      ...(typeof row["application"] === "string" ? { application: row["application"] } : {}),
      ready: row["ready"] === true,
      ...(typeof row["reason"] === "string" ? { reason: row["reason"] } : {}),
    };
  });
}

function sessionRows(
  result: Record<string, unknown> | undefined,
  selected?: string,
): SurfaceSessionRow[] {
  const sessions = result?.["sessions"];
  if (!Array.isArray(sessions)) return [];
  return sessions.map((one) => {
    const row = (typeof one === "object" && one !== null ? one : {}) as Record<string, unknown>;
    const sessionId = String(row["sessionId"] ?? "");
    const status = String(row["status"] ?? "");
    return {
      sessionId,
      adapter: String(row["adapter"] ?? ""),
      kind: String(row["kind"] ?? ""),
      status,
      ...(typeof row["targetId"] === "string" ? { targetId: row["targetId"] } : {}),
      ...(typeof row["createdAt"] === "string" ? { createdAt: row["createdAt"] } : {}),
      pill: sessionPill(status),
      selected: sessionId === selected,
      ...(typeof row["controller"] === "string" ? { controller: row["controller"] } : {}),
      heldByYou: row["controller"] === DESKTOP_HOLDER,
      control:
        typeof row["controller"] !== "string"
          ? "Nobody"
          : row["controller"] === DESKTOP_HOLDER
            ? "You control"
            : `${row["controller"]} controls`,
    };
  });
}

/** A snapshot's flat nodes → the indented lines the tree pane draws. */
export function treeLines(
  result: Record<string, unknown> | undefined,
  selectedRef?: string,
): SurfaceTreeLine[] {
  const nodes = result?.["nodes"];
  if (!Array.isArray(nodes)) return [];
  return nodes.map((one) => {
    const node = (typeof one === "object" && one !== null ? one : {}) as Record<string, unknown>;
    const ref = String(node["ref"] ?? "");
    return {
      ref,
      role: String(node["role"] ?? "node"),
      ...(typeof node["name"] === "string" && node["name"] !== "" ? { name: node["name"] } : {}),
      ...(typeof node["value"] === "string" && node["value"] !== "" ? { value: node["value"] } : {}),
      depth: typeof node["depth"] === "number" ? node["depth"] : 0,
      states: Array.isArray(node["states"]) ? (node["states"] as string[]) : [],
      selected: ref === selectedRef,
    };
  });
}

/** "Text field · Enabled" — the role and states in the words the mockup uses. */
function elementSummary(role: string, states: readonly string[]): string {
  const ROLE_WORDS: Readonly<Record<string, string>> = {
    textbox: "Text field",
    searchbox: "Search field",
    button: "Button",
    link: "Link",
    checkbox: "Checkbox",
    radio: "Radio button",
    combobox: "Dropdown",
    heading: "Heading",
  };
  const word = ROLE_WORDS[role] ?? role;
  const state = states.includes("disabled") ? "Disabled" : "Enabled";
  return dotted(word, state);
}

function elementView(
  result: Record<string, unknown> | undefined,
): SurfaceElementView | undefined {
  if (result === undefined) return undefined;
  const ref = typeof result["ref"] === "string" ? result["ref"] : undefined;
  if (ref === undefined) return undefined;
  const role = String(result["role"] ?? "");
  const states = Array.isArray(result["states"]) ? (result["states"] as string[]) : [];
  return {
    ref,
    role,
    ...(typeof result["name"] === "string" ? { name: result["name"] } : {}),
    ...(typeof result["value"] === "string" ? { value: result["value"] } : {}),
    ...(typeof result["description"] === "string" ? { description: result["description"] } : {}),
    states,
    summary: elementSummary(role, states),
  };
}

/** The catalogue's action forms → what the inspector offers, with one chosen. */
function offerViews(
  forms: readonly ActionForm[],
  chosen: string | undefined,
): SurfaceActionOffer[] {
  return forms.map((form) => ({
    action: form.action,
    label: form.label,
    needsRef: form.needsRef,
    needsRef2: form.needsRef2,
    fields: form.fields.map((field) => ({
      name: field.name,
      type: field.type,
      required: field.required,
      label: field.label,
      ...(field.placeholder === undefined ? {} : { placeholder: field.placeholder }),
    })),
    chosen: form.action === chosen,
  }));
}

/**
 * What an act and its postcondition came to (SF-11, T15).
 *
 * The value an action hands back is `{ act, check? }` — two envelopes, because
 * dispatch and verification are two things. **`verified` is true only when an
 * explicit postcondition passed**: an action that reached the target and was
 * never checked is dispatched and unverified, and the screen says exactly that
 * rather than drawing a tick.
 */
export function surfaceOutcomeView(value: unknown): SurfaceOutcomeView | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const both = value as { act?: unknown; check?: unknown };
  if (both.act === undefined) return undefined;

  const act = both.act;
  const actResult = succeededResult(act);
  const dispatched = actResult !== undefined && actResult["ok"] !== false;
  const actCode = envelopeCode(act);
  const actMessage = envelopeError(act);

  const check = both.check;
  const checkResult = check === undefined ? undefined : succeededResult(check);
  const checkRan = check !== undefined;
  // A check that answered `ok: false` is a *failed verification*, not an error:
  // the postcondition did not hold, and that is information (SF-11).
  const checkOk = checkResult !== undefined && checkResult["ok"] === true;
  const verification: SurfaceOutcomeView["verification"] = !checkRan
    ? "none"
    : checkOk
      ? "passed"
      : "failed";

  const problem =
    actCode === undefined ? undefined : problemFor(actCode, actMessage ?? "The action was refused.");
  const status = String((act as Record<string, unknown>)["status"] ?? "");
  const outcome: SurfaceOutcomeView["outcome"] = dispatched
    ? "succeeded"
    : actCode === "OUTCOME_UNKNOWN" || actCode === "TIMEOUT"
      ? "unknown"
      : status === "refused"
        ? "refused"
        : status === "cancelled"
          ? "cancelled"
          : "failed";

  const summary = !dispatched
    ? (actMessage ?? "The action was refused.")
    : verification === "none"
      ? "Dispatched. Not verified — no postcondition was given."
      : verification === "passed"
        ? "Dispatched and verified."
        : "Dispatched, but the postcondition did not hold.";

  const actual = checkResult?.["actual"];
  const expected = checkResult?.["expected"];

  return {
    dispatched,
    outcome,
    // The whole point: only a postcondition that passed makes this true.
    verified: verification === "passed",
    verification,
    summary,
    ...(actual === undefined ? {} : { actual: String(actual) }),
    ...(expected === undefined ? {} : { expected: String(expected) }),
    ...(typeof (act as Record<string, unknown>)["requestId"] === "string"
      ? { requestId: (act as Record<string, unknown>)["requestId"] as string }
      : {}),
    ...(actCode === undefined ? {} : { errorCode: actCode }),
    ...(problem === undefined ? {} : { problem }),
    raw: JSON.stringify(value, null, 2),
  };
}

/** Adapters and targets → the platform-family groups the screen draws. */
export function platformGroups(
  adapters: readonly SurfaceAdapterRow[],
  targets: readonly SurfaceTargetRow[],
): SurfacePlatformGroup[] {
  const families = new Map<string, { adapters: SurfaceAdapterRow[]; targets: SurfaceTargetRow[] }>();
  const ensure = (family: string): { adapters: SurfaceAdapterRow[]; targets: SurfaceTargetRow[] } => {
    const found = families.get(family);
    if (found !== undefined) return found;
    const made = { adapters: [] as SurfaceAdapterRow[], targets: [] as SurfaceTargetRow[] };
    families.set(family, made);
    return made;
  };
  for (const adapter of adapters) ensure(adapter.family).adapters.push(adapter);
  for (const target of targets) {
    ensure(FAMILY[target.adapter] ?? OTHER_FAMILY).targets.push(target);
  }
  return [...families.entries()]
    .sort(([a], [b]) => {
      const ai = FAMILY_ORDER.indexOf(a);
      const bi = FAMILY_ORDER.indexOf(b);
      return (ai === -1 ? FAMILY_ORDER.length : ai) - (bi === -1 ? FAMILY_ORDER.length : bi);
    })
    .map(([family, { adapters: as, targets: ts }]) => ({ family, adapters: as, targets: ts }));
}

const surfacesScreen: Screen<SurfacesState> = {
  id: "surfaces",
  title: "Surfaces",
  actions: actionsForScreen("surfaces"),
  keys: [
    { action: "surface.connect", key: "C", terminal: "c", description: "Connect a surface" },
    { action: "surface.refresh", key: "S", terminal: "s", description: "Refresh the surface tree" },
    { action: "surface.discover", key: "R", terminal: "r", description: "Recheck available targets" },
  ],
  async load(service, params: ScreenParams = {}): Promise<SurfacesState> {
    const sources = new Sources();
    // Both are `optional`: a broker that is briefly unreachable is a state the
    // screen draws inline and recovers from, not a thrown load that blanks it.
    const targets = await sources.optional<unknown>(
      "GET /targets",
      () => service.getTargets(),
      undefined,
    );
    // No open session is an ordinary answer, not a failure.
    const sessions = await sources.optional<unknown>(
      "GET /sessions",
      () => service.getSessions(),
      undefined,
    );

    const targetsResult = succeededResult(targets);
    const discovery: SurfacesState["discovery"] =
      targets === undefined || targetsResult === undefined ? "error" : "ready";
    const adapters = adapterRows(targetsResult);
    const found = targetRows(targetsResult);
    const groups = platformGroups(adapters, found);
    const rows = sessionRows(succeededResult(sessions), params.selected);
    const anyConnectable = adapters.some((one) => one.available);

    const discoveryError =
      discovery === "error"
        ? (envelopeError(targets) ??
          "Could not reach the surface broker. `yam surface targets` shows the same list from a terminal.")
        : undefined;

    /*
     * An empty list is either an answer or the absence of one, and the sentence
     * has to say which (SF-17). Only the second is a claim about the machine.
     */
    const discoveryEmpty =
      discovery === "error"
        ? "Nothing could be listed, because Yam could not ask. This is not a statement about what you have installed. Press Recheck targets to ask again; the connect form works either way and starts the broker when you use it."
        : "No adapter is installed. `yam surface targets` shows the same list from a terminal.";

    /* ── the connected surface (T15) ─────────────────────────────────────── */

    const chosen = rows.find((one) => one.selected);
    let session: SurfaceSessionView | undefined;
    let tree: SurfaceTreeLine[] = [];
    let snapshotId: string | undefined;
    let truncated = false;
    let element: SurfaceElementView | undefined;
    let offers: SurfaceActionOffer[] = [];
    let action: string | undefined;
    let httpSurface = false;
    let problem: SurfaceProblem | undefined;

    if (params.selected !== undefined && chosen !== undefined) {
      const caps = await sources.optional<unknown>(
        "GET /sessions/:session/capabilities",
        () => service.getSessionsBySessionCapabilities(params.selected!),
        undefined,
      );
      const capsResult = succeededResult(caps);
      const capabilities =
        typeof capsResult?.["capabilities"] === "object" && capsResult["capabilities"] !== null
          ? (capsResult["capabilities"] as Record<string, boolean>)
          : {};
      const kind = String(capsResult?.["kind"] ?? chosen.kind);
      httpSurface = kind === "http";

      session = {
        sessionId: chosen.sessionId,
        adapter: String(capsResult?.["adapter"] ?? chosen.adapter),
        kind,
        status: chosen.status,
        pill: chosen.pill,
        capabilities,
        ...(chosen.controller === undefined ? {} : { controller: chosen.controller }),
        heldByYou: chosen.heldByYou,
        control: chosen.control,
      };
      /*
       * A target somebody else holds is the busy state (SF-13, SF-17): it names
       * the holder and offers the handoff, rather than letting a person press
       * Act and be refused.
       */
      if (chosen.controller !== undefined && !chosen.heldByYou) {
        problem ??= {
          kind: "busy",
          message: `${chosen.controller} holds this target.`,
          nextAction: "Take control to act on it",
          nextActionId: "surface.take-control",
        };
      }
      problem ??= problemFor(envelopeCode(caps), envelopeError(caps) ?? "");

      /*
       * A bounded snapshot on open (the design's "Open automatically takes a
       * bounded initial snapshot"). An HTTP surface has an empty tree by
       * definition, so it is not asked for one.
       */
      if (!httpSurface) {
        const snap = await sources.optional<unknown>(
          "POST /sessions/:session/snapshot",
          () =>
            service.postSessionsBySessionSnapshot(params.selected!, {
              maxNodes: TREE_MAX_NODES,
              interactiveOnly: true,
            }),
          undefined,
        );
        const snapResult = succeededResult(snap);
        tree = treeLines(snapResult, params.ref);
        snapshotId =
          typeof snapResult?.["snapshotId"] === "string" ? snapResult["snapshotId"] : undefined;
        truncated = snapResult?.["truncated"] === true;
        problem ??= problemFor(envelopeCode(snap), envelopeError(snap) ?? "");
      }

      if (params.ref !== undefined && !httpSurface) {
        const described = await sources.optional<unknown>(
          "POST /sessions/:session/describe",
          () =>
            service.postSessionsBySessionDescribe(params.selected!, {
              ref: params.ref,
              // Scoped to the snapshot it was chosen from, so a navigation
              // since makes it stale rather than somebody else's control.
              ...(params.snapshot === undefined ? {} : { snapshot: params.snapshot }),
            }),
          undefined,
        );
        element = elementView(succeededResult(described));
        // A ref that no longer describes is the stale state, and it says so
        // with the way out rather than showing an empty inspector (SF-17).
        problem ??= problemFor(envelopeCode(described), envelopeError(described) ?? "");
        if (element === undefined && problem === undefined && params.ref !== "") {
          problem = {
            kind: "stale",
            message: `The control ${params.ref} is not on the surface any more.`,
            nextAction: "Refresh and select again",
            nextActionId: "surface.refresh",
          };
        }
      }

      const forms = httpSurface
        ? []
        : offeredActions(kind as SurfaceKind, capabilities as Partial<Record<CapabilityFlag, boolean>>);
      // The chosen action: what was asked for, else what suits the selected
      // control. Never undefined — "Choose an action" is not a state (T15).
      action =
        typeof params.action === "string" && forms.some((one) => one.action === params.action)
          ? params.action
          : (forms.find((one) => one.action === defaultActionForRole(element?.role))?.action ??
            forms[0]?.action);
      offers = offerViews(forms, action);
    }

    const subtitle =
      session === undefined
        ? dotted(
            plural(rows.length, "session"),
            `${adapters.filter((one) => one.available).length} of ${adapters.length} adapters ready`,
          )
        : dotted(session.adapter, session.kind, `${tree.length} controls`);

    return {
      ...sources.base(
        "surfaces",
        "Surfaces",
        subtitle,
        session === undefined
          ? rows.length === 0
            ? "Choose a browser, app, device or API to control."
            : `${plural(rows.length, "open session")}`
          : (element?.name ?? "Click a control, or search its name."),
      ),
      screen: "surfaces",
      groups,
      sessions: rows,
      ...(params.selected === undefined ? {} : { selected: params.selected }),
      discovery,
      ...(discoveryError === undefined ? {} : { discoveryMessage: discoveryError }),
      discoveryEmpty,
      anyConnectable,
      agent: {
        /*
         * The generic configuration, not a Yam-specific one (SF-07): any
         * compatible client takes this shape, and the command is the published
         * package rather than a path out of this checkout.
         */
        config: JSON.stringify(
          { mcpServers: { yam: { command: "npx", args: ["-y", "@svatah/yam", "mcp"] } } },
          null,
          2,
        ),
        brokerReady: discovery === "ready",
        checks: [
          discovery === "ready"
            ? "The surface broker answered, so an agent using this configuration reaches the same sessions."
            : "The surface broker did not answer; an agent would start one on its first call.",
        ],
      },
      ...(session === undefined ? {} : { session }),
      tree,
      ...(snapshotId === undefined ? {} : { snapshotId }),
      truncated,
      ...(params.ref === undefined ? {} : { ref: params.ref }),
      ...(element === undefined ? {} : { element }),
      offers,
      ...(action === undefined ? {} : { action }),
      httpSurface,
      ...(problem === undefined ? {} : { problem }),
    };
  },
};

export const SURFACES_SCREENS = [surfacesScreen] as const satisfies readonly Screen[];
