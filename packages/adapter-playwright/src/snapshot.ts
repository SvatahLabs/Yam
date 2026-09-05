/**
 * The two snapshot mechanisms, isolated (LLD §7.1).
 *
 * HLD §14 names "Playwright internal snapshot API changes" as a risk and the
 * mitigation as "isolated in the adapter; public `ariaSnapshot()` fallback with
 * own refs". This file is that isolation: nothing else in the adapter, and
 * nothing above the surface, knows which mechanism produced a `Ref`.
 *
 *   `playwright` — Playwright's ref-producing ARIA snapshot, the mechanism
 *                  Playwright MCP uses. Refs are Playwright's own `eN` and
 *                  resolve through the public `aria-ref=` selector engine.
 *   `own`        — a walker injected into the page assigns `rN` in document
 *                  order and registers the elements in an in-page array, so a
 *                  ref resolves without any Playwright internal.
 *
 * `SVATAH_PW_SNAPSHOT=own|playwright|auto` picks. `auto`, the default, uses the
 * Playwright mechanism when the internal call answers and falls back to `own`
 * when it does not — which is what will happen by itself if Playwright removes
 * it. Both paths produce the same `Snapshot` shape and both are exercised by the
 * adapter tests and by the conformance suite.
 *
 * A third ref space exists alongside those two: `hN`, minted by `locate()` for
 * an element found from a stored `Candidate`. Playwright issues `eN` only from
 * its own snapshot, so a located element could not otherwise be named. All three
 * resolve to an `ElementHandle` through `handleForRef`, which is the only thing
 * the rest of the adapter uses.
 */
import type { ElementHandle, Frame } from "playwright";
import type { Ref, Snapshot, SnapshotNode } from "@svatah/schema";
import { buildSnapshot } from "@svatah/surface";
import { walkDocument, type RawNode } from "./page-script.js";
import { structuralHash } from "./structural-hash.js";

export type SnapshotMechanism = "playwright" | "own";

export interface SnapshotOptions {
  root?: Ref;
  maxNodes?: number;
  interactiveOnly?: boolean;
}

/** The in-page array `walkDocument` fills; see `page-script.ts`. */
export const REGISTRY = "__svatahRefs__";

/** Default cap on nodes; a larger page is truncated in document order. */
export const DEFAULT_MAX_NODES = 2000;

/** How long a reference is given to resolve before it is called stale. */
const STALE_REF_TIMEOUT_MS = 1000;

const INTERACTIVE_ROLES = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "spinbutton",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "slider",
  "menuitem",
  "tab",
  "switch",
]);

/* ── mechanism selection ──────────────────────────────────────────────────── */

/**
 * Playwright's ref-producing snapshot is reached through the frame's protocol
 * channel. It is internal, so its presence is a feature test rather than an
 * assumption.
 */
interface AriaSnapshotChannel {
  ariaSnapshot(params: { selector: string; mode: string }): Promise<{ snapshot: string }>;
}

function channelOf(frame: Frame): AriaSnapshotChannel | null {
  const candidate = (frame as unknown as { _channel?: unknown })._channel;
  if (
    candidate !== null &&
    typeof candidate === "object" &&
    typeof (candidate as AriaSnapshotChannel).ariaSnapshot === "function"
  ) {
    return candidate as AriaSnapshotChannel;
  }
  return null;
}

/** Whether the Playwright mechanism answers on this frame. */
export async function playwrightMechanismAvailable(frame: Frame): Promise<boolean> {
  const channel = channelOf(frame);
  if (channel === null) return false;
  try {
    const result = await channel.ariaSnapshot({ selector: "body", mode: "ai" });
    return typeof result.snapshot === "string" && /\[ref=/.test(result.snapshot);
  } catch {
    return false;
  }
}

/** Resolve `SVATAH_PW_SNAPSHOT` into a mechanism, probing the frame for `auto`. */
export async function chooseMechanism(
  frame: Frame,
  requested: string | undefined,
): Promise<SnapshotMechanism> {
  const wanted = (requested ?? "auto").trim().toLowerCase();
  if (wanted === "own") return "own";
  if (wanted === "playwright") return "playwright";
  return (await playwrightMechanismAvailable(frame)) ? "playwright" : "own";
}

/* ── parsing Playwright's AI snapshot ─────────────────────────────────────── */

/**
 * One line of Playwright's AI snapshot:
 *
 * ```
 *   - button "Sign in" [disabled] [ref=e12]
 *   - textbox "Username": you@example.com [ref=e13]
 * ```
 *
 * Two spaces of indentation per level, which gives `depth` and `parent`.
 */
const AI_LINE =
  /^(?<indent>\s*)-\s+(?<role>[a-zA-Z][\w-]*)(?:\s+"(?<name>(?:[^"\\]|\\.)*)")?(?<rest>.*)$/;

/** The bracketed states Playwright renders that map onto `NodeState`. */
const AI_STATE_KEYS: Record<string, SnapshotNode["states"][number]> = {
  disabled: "disabled",
  checked: "checked",
  selected: "selected",
  expanded: "expanded",
  focused: "focused",
  required: "required",
  readonly: "readonly",
  hidden: "hidden",
};

export function parseAiSnapshot(text: string): SnapshotNode[] {
  const nodes: SnapshotNode[] = [];
  /** Depth → the ref of the node open at that depth. */
  const openAt = new Map<number, string>();

  for (const rawLine of text.split("\n")) {
    if (rawLine.trim() === "") continue;
    const match = AI_LINE.exec(rawLine);
    if (match?.groups === undefined) continue;
    const groups = match.groups as { indent: string; role: string; name?: string; rest: string };

    const refMatch = /\[ref=([a-z0-9]+)\]/i.exec(groups.rest);
    if (refMatch === null) continue; // A node Playwright issued no reference for.

    const depth = Math.floor(groups.indent.length / 2);

    const states: SnapshotNode["states"] = [];
    for (const bracket of groups.rest.matchAll(/\[([a-zA-Z]+)(?:=([^\]]*))?\]/g)) {
      const key = bracket[1]!.toLowerCase();
      if (key === "ref" || key === "level") continue;
      const mapped = AI_STATE_KEYS[key];
      if (mapped === undefined) continue;
      if (bracket[2] === "false") {
        if (mapped === "checked") states.push("unchecked");
        else if (mapped === "expanded") states.push("collapsed");
        continue;
      }
      states.push(mapped);
    }

    // `- textbox "Username": value [ref=e13]` — the value follows the colon.
    let value: string | undefined;
    const afterName = groups.rest.trimStart();
    if (afterName.startsWith(":")) {
      value = afterName
        .slice(1)
        .replace(/\[[a-zA-Z]+(?:=[^\]]*)?\]/g, "")
        .trim();
      if (value === "") value = undefined;
    }

    const node: SnapshotNode = { ref: refMatch[1]!, role: groups.role, states, depth };
    if (groups.name !== undefined) node.name = groups.name.replace(/\\(.)/g, "$1");
    if (value !== undefined) node.value = value;
    const parent = openAt.get(depth - 1);
    if (parent !== undefined) node.parent = parent;

    openAt.set(depth, node.ref);
    for (const level of [...openAt.keys()]) if (level > depth) openAt.delete(level);

    nodes.push(node);
  }
  return nodes;
}

/* ── the session-scoped ref space ─────────────────────────────────────────── */

/**
 * Everything `snapshot`, `locate`, `describe` and `act` need in order to turn a
 * `Ref` back into an element. One of these lives per session and is reset when
 * the session navigates.
 */
export class RefSpace {
  /** Handles minted by `locate()`, keyed `h0`, `h1`, … */
  private readonly handles = new Map<Ref, ElementHandle<Element>>();
  private next = 0;

  constructor(
    public frame: Frame,
    public mechanism: SnapshotMechanism,
    public readonly testIdAttributes: readonly string[],
  ) {}

  /** Mint a ref for a handle found from a stored candidate. */
  mint(handle: ElementHandle<Element>): Ref {
    const ref = `h${this.next++}`;
    this.handles.set(ref, handle);
    return ref;
  }

  /** Drop every minted handle. Called on navigation and on close. */
  async reset(): Promise<void> {
    const held = [...this.handles.values()];
    this.handles.clear();
    this.next = 0;
    await Promise.all(held.map((h) => h.dispose().catch(() => undefined)));
  }

  /**
   * The element a ref names.
   *
   * `hN` is a handle this session minted; `eN` is Playwright's, resolved through
   * the public `aria-ref=` selector engine; `rN` is an index into the in-page
   * registry the own-refs walker filled.
   */
  async handleFor(ref: Ref): Promise<ElementHandle<Element>> {
    if (ref.startsWith("h")) {
      const held = this.handles.get(ref);
      if (held === undefined) throw new Error(staleRef(ref));
      return held;
    }
    if (ref.startsWith("e")) {
      // A short timeout: a reference either resolves against the current tree or
      // it is stale, and waiting out the step timeout to say so would turn a
      // clear "take a new snapshot" into an opaque hang.
      const handle = await this.frame
        .locator(`aria-ref=${ref}`)
        .elementHandle({ timeout: STALE_REF_TIMEOUT_MS })
        .catch(() => null);
      if (handle === null) throw new Error(staleRef(ref));
      return handle as ElementHandle<Element>;
    }
    const index = Number(ref.slice(1));
    if (!ref.startsWith("r") || !Number.isInteger(index) || index < 0) {
      throw new Error(`"${ref}" is not a reference this adapter issued.`);
    }
    const handle = await this.frame.evaluateHandle(
      ({ registry, i }: { registry: string; i: number }) => {
        const win = window as unknown as Record<string, unknown>;
        const entries = win[registry] as Element[] | undefined;
        return entries?.[i] ?? null;
      },
      { registry: REGISTRY, i: index },
    );
    const element = handle.asElement();
    if (element === null) {
      await handle.dispose();
      throw new Error(staleRef(ref));
    }
    return element as ElementHandle<Element>;
  }

  /** Whether a handle for this ref must be disposed by the caller. */
  ownsHandle(ref: Ref): boolean {
    return ref.startsWith("h");
  }
}

function staleRef(ref: string): string {
  return (
    `Reference "${ref}" no longer resolves to an element. References are stable within a ` +
    "snapshot and are lost on navigation — take a new snapshot (LLD §2.2)."
  );
}

/* ── taking a snapshot ────────────────────────────────────────────────────── */

async function viaPlaywright(
  space: RefSpace,
  options: SnapshotOptions,
): Promise<SnapshotNode[]> {
  const channel = channelOf(space.frame);
  if (channel === null) {
    throw new Error("Playwright's ref-producing snapshot is not available on this frame.");
  }
  const selector = options.root === undefined ? "body" : `aria-ref=${options.root}`;
  const { snapshot } = await channel.ariaSnapshot({ selector, mode: "ai" });
  let nodes = parseAiSnapshot(snapshot);
  if (options.interactiveOnly === true) nodes = nodes.filter((n) => INTERACTIVE_ROLES.has(n.role));
  return nodes.slice(0, options.maxNodes ?? DEFAULT_MAX_NODES);
}

async function viaOwnRefs(space: RefSpace, options: SnapshotOptions): Promise<SnapshotNode[]> {
  const raw = (await space.frame.evaluate(walkDocument, {
    registry: REGISTRY,
    maxNodes: options.maxNodes ?? DEFAULT_MAX_NODES,
    interactiveOnly: options.interactiveOnly === true,
    testIdAttributes: [...space.testIdAttributes],
    rootIndex: options.root === undefined ? null : refIndex(options.root),
  })) as RawNode[];
  return raw as SnapshotNode[];
}

function refIndex(ref: Ref): number | null {
  if (!ref.startsWith("r")) return null;
  const index = Number(ref.slice(1));
  return Number.isInteger(index) && index >= 0 ? index : null;
}

/** Take a snapshot through the session's mechanism (LLD §2.2). */
export async function takeSnapshot(
  space: RefSpace,
  options: SnapshotOptions = {},
): Promise<Snapshot> {
  const nodes =
    space.mechanism === "playwright" ? await viaPlaywright(space, options) : await viaOwnRefs(space, options);
  const root = options.root ?? nodes[0]?.ref ?? (space.mechanism === "playwright" ? "e1" : "r0");
  return buildSnapshot(root, nodes, structuralHash(nodes));
}

/**
 * The public `ariaSnapshot()` text for the frame.
 *
 * Not used to build `Snapshot` — it carries no element identity, so there is
 * nothing to attach a `Ref` to — but it is the independent account of the
 * accessibility tree that the adapter tests check both mechanisms against, which
 * is what keeps the own-refs walker honest about roles and names.
 */
export async function ariaSnapshotText(frame: Frame): Promise<string> {
  return await frame.locator("body").ariaSnapshot();
}

export { structuralHash };
