/**
 * The structural hash of LLD §6.2.
 *
 * "Render its subtree with names replaced by length buckets, sha256." Names are
 * replaced by buckets so the hash tracks the *shape* of a page and not its
 * content: a different user's name in a greeting is not a page-shape change, but
 * a wrapper div, a reordered sidebar or a moved form is.
 *
 * `Snapshot.hash` is this function over the whole snapshot. `@svatah/bindings`
 * applies the same function to the subtree under the nearest landmark, `form`,
 * `dialog` or `window` ancestor to get `BindingContext.hash`. Both need it, and
 * `surface` is the only package both depend on — but the adapter is where the
 * snapshot is produced, so the primitive lives here and `@svatah/bindings`
 * re-implements the *scoping*, not the hash. Keeping one implementation is what
 * the drift test in `packages/bindings/test` asserts.
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
