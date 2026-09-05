/**
 * The context hash (LLD §6.2).
 *
 * "Computed from the surface snapshot rather than the DOM so it is
 * adapter-neutral: take the nearest ancestor with a landmark, `form`, `dialog`, or
 * `window` role (fallback `main`, then root); render its subtree with names
 * replaced by length buckets; sha256."
 *
 * A binding is scoped by this hash plus a URL or window pattern (REQ-REC-6), so
 * the same element id can have a different entry on a page whose surrounding
 * shape differs — the login form on its own page and the same form inside a
 * modal are two entries, not one that flickers.
 *
 * The hash is also the drift signal: when resolution fails and the live hash no
 * longer matches the stored one, the page's shape changed, which is a different
 * story from "the element moved" (LLD §6.3).
 */
import type { Snapshot, SnapshotNode } from "@svatah/schema";
import { structuralHash } from "@svatah/surface";

/**
 * The roles that scope a context, in the order LLD §6.2 tries them: a landmark,
 * a form, a dialog or a window first; `main` as the fallback; then the root.
 */
export const LANDMARK_ROLES = [
  "banner",
  "complementary",
  "contentinfo",
  "form",
  "main",
  "navigation",
  "region",
  "search",
  "dialog",
  "alertdialog",
  "window",
] as const;

const LANDMARKS = new Set<string>(LANDMARK_ROLES);

/** Index a snapshot's nodes by reference, for walking the parent chain. */
function index(nodes: readonly SnapshotNode[]): Map<string, SnapshotNode> {
  return new Map(nodes.map((n) => [n.ref, n]));
}

/**
 * The node a context is scoped to: the nearest landmark ancestor of `ref`,
 * inclusive, else the first `main`, else the root.
 */
export function contextRoot(
  snapshot: Snapshot,
  ref?: string,
): SnapshotNode | undefined {
  const byRef = index(snapshot.nodes);

  if (ref !== undefined) {
    let cursor = byRef.get(ref);
    while (cursor !== undefined) {
      if (LANDMARKS.has(cursor.role)) return cursor;
      cursor = cursor.parent === undefined ? undefined : byRef.get(cursor.parent);
    }
  }

  return snapshot.nodes.find((n) => n.role === "main") ?? snapshot.nodes[0];
}

/**
 * The subtree under a node, in document order, with depths made relative to it.
 *
 * Relative depth is what makes the hash stable when a page gains a wrapper
 * *above* the context: the shape inside the form is the same form, and a binding
 * scoped to it should not be invalidated by a layout change three levels up.
 */
export function subtree(snapshot: Snapshot, root: SnapshotNode): SnapshotNode[] {
  const byRef = index(snapshot.nodes);
  const inside = new Set<string>([root.ref]);
  const out: SnapshotNode[] = [];

  for (const node of snapshot.nodes) {
    if (node.ref === root.ref) {
      out.push({ ...node, depth: 0 });
      continue;
    }
    // A node is inside when its parent chain reaches the root without leaving
    // the snapshot. The chain is walked rather than assumed from ordering,
    // because an adapter is only required to produce document order, not a
    // contiguous subtree.
    let cursor: SnapshotNode | undefined = node;
    let depth = 0;
    while (cursor?.parent !== undefined) {
      depth += 1;
      if (inside.has(cursor.parent)) {
        inside.add(node.ref);
        out.push({ ...node, depth });
        break;
      }
      cursor = byRef.get(cursor.parent);
    }
  }
  return out;
}

/**
 * The context hash for an element, or for the page when no element is named.
 *
 * Returns the hash and the root it was taken over, because the report a failing
 * resolution writes has to say *which* context drifted, not only that one did.
 */
export function contextHash(
  snapshot: Snapshot,
  ref?: string,
): { hash: string; root: SnapshotNode | undefined; nodes: SnapshotNode[] } {
  const root = contextRoot(snapshot, ref);
  if (root === undefined) return { hash: structuralHash([]), root: undefined, nodes: [] };
  const nodes = subtree(snapshot, root);
  return { hash: structuralHash(nodes), root, nodes };
}

/** Options for `contextPattern` (`config.bindings`, LLD §3.5). */
export interface ContextPatternOptions {
  /**
   * Keep the origin in the pattern. Default false — see below.
   */
  matchHost?: boolean;
}

/**
 * The URL or window pattern an entry is stored against (REQ-REC-6).
 *
 * The path with numeric and uuid-looking segments generalised, so
 * `/orders/10482` and `/orders/10483` are one context rather than two. Query and
 * fragment are dropped: they change what a page shows, not its shape.
 *
 * ## Why the host is dropped by default (Draft 2.3)
 *
 * A bindings store is committed to a repository and shared. An origin in the
 * pattern makes it unshareable: bindings recorded against `http://localhost:5173`
 * do not apply on `https://staging.example.com`, and bindings recorded against a
 * test server on an *ephemeral* port — which is how every fixture and example in
 * this repository runs — do not apply on the next run of the same test, because
 * the port is different. That is not a hypothetical: the example store shipped
 * in Phase 1 carried `http://127.0.0.1:65431/login`, a port that existed for one
 * process.
 *
 * So the pattern is the path. `bindings.matchHost` puts the origin back for a
 * project that really does bind different elements on different hosts.
 */
export function contextPattern(url: string, options: ContextPatternOptions = {}): string {
  let path: string;
  let origin = "";
  try {
    const parsed = new URL(url);
    if (options.matchHost === true) origin = parsed.origin;
    path = parsed.pathname;
  } catch {
    path = url;
  }
  const generalised = path
    .split("/")
    .map((segment) => {
      if (segment === "") return segment;
      if (/^\d+$/.test(segment)) return ":id";
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(segment))
        return ":uuid";
      if (/^[0-9a-f]{24,}$/i.test(segment)) return ":id";
      return segment;
    })
    .join("/");
  return `${origin}${generalised === "" ? "/" : generalised}`;
}

/**
 * Whether a stored pattern applies to a URL.
 *
 * Both sides are normalised, so a store written before `matchHost` defaulted to
 * false — one carrying a full origin — still resolves against a live URL. An old
 * store keeps working; only newly recorded entries are path-only.
 */
export function patternMatches(
  pattern: string,
  url: string,
  options: ContextPatternOptions = {},
): boolean {
  if (pattern === url) return true;
  const live = contextPattern(url, options);
  // Normalising the *stored* pattern too is what lets an old store — one written
  // when the origin was included — keep resolving: `http://127.0.0.1:65431/login`
  // reduces to `/login`, which is what a live URL reduces to as well. Under
  // `matchHost` both sides keep their origin, so a different host does not match.
  return live === pattern || live === contextPattern(pattern, options);
}
