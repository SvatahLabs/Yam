/**
 * Surfaces — connect to something, and see what is connected (T14, SF-02, SF-04,
 * SF-05, SF-16, SF-17).
 *
 * This is the screen the desktop opens into. It is the connect flow the design's
 * "Desktop interaction design" specifies: one primary **Connect surface**
 * action, discovery grouped by platform with the exact prerequisite shown for
 * anything unavailable, and the sessions that are open now — an agent's as much
 * as a person's.
 *
 * It is a client of the broker and of nothing else. Everything on it is a
 * `GET /targets` and `GET /sessions` answer — the catalogue's own routes, the
 * same sessions the CLI and a generic MCP client address (SF-03). The screen
 * holds no session store, no adapter list and no idea of what connecting needs
 * beyond what the service returned; the platform families below are a display
 * grouping of the adapters the service reported, not a second source of truth.
 *
 * The adapter a row shows is the one the service reported ready, and after a
 * connect the session row shows the adapter the service actually used
 * (`result.adapter`) — never the one that was asked for (SF-04, SF-17).
 */
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
}

export interface SurfacesState extends ScreenStateBase {
  readonly screen: "surfaces";
  /** Discovery, grouped by platform family (SF-04). */
  readonly groups: readonly SurfacePlatformGroup[];
  /** The sessions the broker holds (SF-05). */
  readonly sessions: readonly SurfaceSessionRow[];
  /** The selected session, when one is chosen; T15's inspector reads it. */
  readonly selected?: string;
  /** Whether discovery itself answered, or the broker could not be reached. */
  readonly discovery: "ready" | "error";
  /**
   * What to say when discovery could not answer (SF-17).
   *
   * Inline, not the base `error`: a broker that is briefly unreachable must not
   * blank the whole screen — the connect form still works and starts the broker
   * lazily — so this is drawn as an alert *within* Surfaces with a Recheck, the
   * "disconnected → offer inspection, never a blank" shape the design asks for.
   */
  readonly discoveryMessage?: string;
  /** Whether anything can be connected to at all — false is the empty state. */
  readonly anyConnectable: boolean;
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
    };
  });
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

    return {
      ...sources.base(
        "surfaces",
        "Surfaces",
        dotted(
          plural(rows.length, "session"),
          `${adapters.filter((one) => one.available).length} of ${adapters.length} adapters ready`,
        ),
        rows.length === 0
          ? "Choose a browser, app, device or API to control."
          : `${plural(rows.length, "open session")}`,
      ),
      screen: "surfaces",
      groups,
      sessions: rows,
      ...(params.selected === undefined ? {} : { selected: params.selected }),
      discovery,
      ...(discoveryError === undefined ? {} : { discoveryMessage: discoveryError }),
      anyConnectable,
    };
  },
};

export const SURFACES_SCREENS = [surfacesScreen] as const satisfies readonly Screen[];
