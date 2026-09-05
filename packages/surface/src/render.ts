import type { Snapshot, SnapshotNode } from "@svatah/schema";

/**
 * The snapshot text renderer (LLD §2.2).
 *
 * `Snapshot.text` is the YAML-like rendering used in grounding prompts, laid out
 * like Playwright's ARIA snapshot with `[ref=…]` annotations. Every adapter
 * produces the same layout, so a prompt written against one adapter reads the
 * same against another.
 *
 * One node per line:
 *
 * ```
 * - role "name" [state, state] [ref=r12]
 *   - textbox "Username": current value [required] [ref=r13]
 * ```
 *
 * The name is quoted, the value follows a colon, states appear in a bracketed
 * list, and the reference is always last so a model can find it by suffix.
 */

/** Quote a name the way the renderer does, escaping quotes and newlines. */
function quote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
}

export interface RenderOptions {
  /** Drop nodes with the `hidden` state. Default true — hidden nodes cannot be acted on. */
  omitHidden?: boolean;
  /** Truncate names and values to this many characters. Default 120. */
  maxTextLength?: number;
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

/** Render one node, without its children. */
export function renderNode(node: SnapshotNode, options: RenderOptions = {}): string {
  const max = options.maxTextLength ?? 120;
  const indent = "  ".repeat(node.depth);

  let line = `${indent}- ${node.role}`;
  if (node.name !== undefined && node.name !== "") line += ` ${quote(truncate(node.name, max))}`;
  if (node.value !== undefined && node.value !== "") line += `: ${truncate(node.value, max)}`;
  if (node.states.length > 0) line += ` [${[...node.states].sort().join(", ")}]`;
  line += ` [ref=${node.ref}]`;
  return line;
}

/**
 * Render a whole snapshot. Nodes are emitted in the order the adapter produced
 * them, which is document order, so the rendering is deterministic.
 */
export function renderSnapshot(
  nodes: readonly SnapshotNode[],
  options: RenderOptions = {},
): string {
  const omitHidden = options.omitHidden ?? true;
  const lines: string[] = [];
  for (const node of nodes) {
    if (omitHidden && node.states.includes("hidden")) continue;
    lines.push(renderNode(node, options));
  }
  return lines.join("\n");
}

/**
 * A rough token estimate for `Snapshot.tokensEstimate`, used to keep grounding
 * prompts under `record.maxSnapshotTokens` (REQ-NFR-2). Four characters per token
 * is the usual approximation for English-plus-markup text; it is deliberately an
 * estimate, not a tokeniser, so it stays adapter- and model-independent.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Assemble a `Snapshot` from its nodes: renders the text and fills in the estimate.
 * Adapters call this so the rendering cannot drift between them. `hash` is the
 * structural hash of LLD §6.2, which the adapter computes and passes in.
 */
export function buildSnapshot(
  root: string,
  nodes: readonly SnapshotNode[],
  hash: string,
  options: RenderOptions = {},
): Snapshot {
  const text = renderSnapshot(nodes, options);
  return {
    ref: root,
    nodes: [...nodes],
    text,
    tokensEstimate: estimateTokens(text),
    hash,
  };
}
