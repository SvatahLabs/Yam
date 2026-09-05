/**
 * The structural hash of LLD §6.2.
 *
 * "Render its subtree with names replaced by length buckets, sha256." Names
 * become buckets so the hash tracks the *shape* of a page and not its content: a
 * different user's name in a greeting is not a page-shape change, but a wrapper
 * element, a reordered sidebar or a moved form is.
 *
 * Two callers need it and they are in different modules — an adapter, which fills
 * in `Snapshot.hash`, and `@svatah/bindings`, which hashes the subtree under an
 * element to get `BindingContext.hash`. `@svatah/surface` is the one package both
 * depend on (LLD §1), so the primitive lives here and each caller supplies the
 * nodes. That way there is one implementation and the two hashes cannot drift.
 */
import { createHash } from "node:crypto";
import type { SnapshotNode } from "@svatah/schema";

/**
 * Names collapse to a length bucket: `0`, `1-8`, `9-32`, `33+` (LLD §6.2).
 */
export function lengthBucket(value: string | undefined): string {
  const length = value === undefined ? 0 : value.length;
  if (length === 0) return "0";
  if (length <= 8) return "1-8";
  if (length <= 32) return "9-32";
  return "33+";
}

/**
 * The canonical rendering the hash is taken over: one line per node, indented by
 * depth, carrying the role, the name's length bucket and the sorted states.
 * Values, boxes, references and native attributes are deliberately absent — they
 * change without the page's shape changing.
 */
export function renderForHash(nodes: readonly SnapshotNode[]): string {
  return nodes
    .map(
      (node) =>
        `${"  ".repeat(node.depth)}${node.role} ${lengthBucket(node.name)}` +
        (node.states.length > 0 ? ` [${[...node.states].sort().join(",")}]` : ""),
    )
    .join("\n");
}

/** sha256 of `renderForHash`, hex encoded. */
export function structuralHash(nodes: readonly SnapshotNode[]): string {
  return createHash("sha256").update(renderForHash(nodes), "utf8").digest("hex");
}
