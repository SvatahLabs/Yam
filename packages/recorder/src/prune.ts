/**
 * Fitting a page into a prompt (T3.2, REQ-REC-2, REQ-NFR-2, LLD §11).
 *
 * `config.record.maxSnapshotTokens` is a budget, and a dashboard with a
 * thousand-row table blows through it on its first step. Pruning is what makes
 * grounding affordable on a real application rather than only on a sample one.
 *
 * ## What survives, and why in that order
 *
 * The rule is that pruning may cost the model *context*, never *candidates*. So
 * the tiers are:
 *
 * 1. **Interactive elements.** The answer is one of these, essentially always.
 *    Dropping one is dropping the right answer, which no amount of surrounding
 *    prose makes up for.
 * 2. **Landmarks and headings.** How a person says which of four "Edit" buttons
 *    they mean is by naming the region it is in, so the structure that gives an
 *    element its address is worth more than the paragraphs inside it.
 * 3. **Everything else**, nearest-first around the interactive elements, until
 *    the budget runs out.
 *
 * A snapshot that still does not fit after tier 1 is over budget and says so —
 * `pruned` travels with the result and into the prompt, so the model is told the
 * page it is looking at is incomplete and can answer null instead of picking the
 * closest surviving line.
 */
import type { Snapshot, SnapshotNode } from "@svatah/yam-schema";
import { estimateTokens, isInteractiveRole, renderSnapshot } from "@svatah/yam-surface";

/** Roles that give an element its address rather than being the answer. */
export const STRUCTURAL_ROLES: ReadonlySet<string> = new Set([
  "main",
  "navigation",
  "banner",
  "contentinfo",
  "complementary",
  "form",
  "search",
  "region",
  "dialog",
  "alertdialog",
  "heading",
  "table",
  "grid",
  "row",
  "list",
  "listitem",
  "tablist",
  "menu",
  "menubar",
  "toolbar",
  "group",
]);

export interface PruneOptions {
  /** `config.record.maxSnapshotTokens`. */
  readonly maxTokens: number;
  /** Never drop this reference, whatever the budget. */
  readonly keep?: string;
}

export interface PrunedSnapshot {
  readonly text: string;
  readonly nodes: readonly SnapshotNode[];
  readonly tokensEstimate: number;
  /** True when anything was dropped, so the prompt can say so. */
  readonly pruned: boolean;
  /** True when even the interactive elements alone are over budget. */
  readonly overBudget: boolean;
}

/**
 * Prune a snapshot to a token budget.
 *
 * Hidden nodes are dropped by the renderer already; this works on what the
 * renderer would emit. The output keeps document order, because the model is
 * told to read indentation and order as structure, and a reordered snapshot
 * would make "the first result" mean something else.
 */
export function prune(snapshot: Snapshot, options: PruneOptions): PrunedSnapshot {
  const all = snapshot.nodes.filter((node) => !node.states.includes("hidden"));

  const whole = renderSnapshot(all);
  if (estimateTokens(whole) <= options.maxTokens) {
    return {
      text: whole,
      nodes: all,
      tokensEstimate: estimateTokens(whole),
      pruned: all.length !== snapshot.nodes.length,
      overBudget: false,
    };
  }

  const kept = new Set<string>();
  for (const node of all) {
    if (isInteractiveRole(node.role) || node.ref === options.keep) kept.add(node.ref);
  }

  // The ancestors of everything kept, so indentation still reads as containment
  // rather than as a random staircase.
  const byRef = new Map(all.map((node) => [node.ref, node]));
  for (const ref of [...kept]) {
    let cursor = byRef.get(ref)?.parent;
    while (cursor !== undefined && !kept.has(cursor)) {
      kept.add(cursor);
      cursor = byRef.get(cursor)?.parent;
    }
  }

  /*
   * The floor: every interactive element, and the ancestors that hold them.
   *
   * If that alone does not fit, it is still what is sent — a snapshot without
   * the controls is a snapshot without the answer — and `overBudget` says so
   * rather than pretending otherwise. The recorder logs it and the prompt is
   * told the page was cut, because a page this large is a fact about the
   * application and hiding it makes the report less useful, not the page smaller.
   */
  const floor = render(all, kept);
  if (estimateTokens(floor) > options.maxTokens) {
    return {
      text: floor,
      nodes: all.filter((node) => kept.has(node.ref)),
      tokensEstimate: estimateTokens(floor),
      pruned: true,
      overBudget: true,
    };
  }

  /*
   * Then structure, then everything else, each in document order and each only
   * while it fits. Structure first because that is how a person says which of
   * four "Edit" buttons they mean; the prose comes after, if there is room.
   */
  const grown = new Set(kept);
  const structural = all.filter(
    (node) => STRUCTURAL_ROLES.has(node.role) || node.role === "heading",
  );
  for (const node of [...structural, ...all]) {
    if (grown.has(node.ref)) continue;
    grown.add(node.ref);
    if (estimateTokens(render(all, grown)) > options.maxTokens) grown.delete(node.ref);
  }

  const text = render(all, grown);
  return {
    text,
    nodes: all.filter((node) => grown.has(node.ref)),
    tokensEstimate: estimateTokens(text),
    pruned: grown.size !== all.length,
    overBudget: false,
  };
}

function render(nodes: readonly SnapshotNode[], keep: ReadonlySet<string>): string {
  return renderSnapshot(nodes.filter((node) => keep.has(node.ref)));
}
