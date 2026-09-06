/**
 * `Candidate` → elements of an accessibility tree (T6.2, LLD §7.5, §3.3).
 *
 * > UIA: […] `AutomationId` → `automationId` candidate; `controlPath` built
 * > from the ancestor chain with names and sibling indices. AX: […] the same
 * > candidate kinds.
 *
 * A desktop tree has no query language — no CSS, no XPath engine, no
 * `findElements`. Matching is therefore a scan of the snapshot the adapter
 * already took, which is a property rather than a limitation: the elements a
 * candidate matches are exactly the elements the snapshot showed, so a
 * `describe()` and a `locate()` can never disagree about what is on screen.
 *
 * A candidate kind this tree cannot express is **refused with the reason**, not
 * matched against nothing. "No element found" and "that kind of candidate does
 * not exist here" send whoever reads the failure to different places, and only
 * the first one means the window changed (LLD §6.3).
 */
import type { Candidate } from "@svatah/yam-schema";
import { LocateError } from "@svatah/yam-surface";
import type { AxSnapshotNode } from "./tree.js";

/** Candidate kinds that belong to a web or mobile adapter. */
const FOREIGN_KINDS: Readonly<Record<string, string>> = {
  css: "the web adapters",
  xpath: "the web and Appium adapters",
  testid: "the web adapters",
  altText: "the web adapters",
  placeholder: "the web adapters",
  label: "the web adapters",
  resourceId: "the Appium adapter",
  accessibilityId: "the Appium adapter",
  webmcp: "the Playwright adapter",
};

function requireValue(candidate: Candidate, field: "value" | "name" = "value"): string {
  const value = field === "name" ? candidate.name : candidate.value;
  if (value === undefined || value === "") {
    throw new LocateError(`A "${candidate.by}" candidate must carry a ${field}.`, { adapter: "ax" });
  }
  return value;
}

const norm = (text: string | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

/**
 * Every node the candidate matches, in snapshot order.
 *
 * Order is snapshot order and not "best first" on purpose: the resolver's rule
 * is *exactly one match* (LLD §6.3), and a candidate that matches three
 * elements must report three whatever their quality, so that `nth` is a
 * decision the binding recorded rather than one the adapter took.
 */
export function matchNodes(
  candidate: Candidate,
  nodes: readonly AxSnapshotNode[],
): AxSnapshotNode[] {
  const foreign = FOREIGN_KINDS[candidate.by];
  if (foreign !== undefined) {
    throw new LocateError(
      `A "${candidate.by}" candidate belongs to ${foreign}; an accessibility tree has no ` +
        "such addressing. The AX adapter resolves automationId, controlPath, role, name, " +
        "text, title, value and coords.",
      { adapter: "ax" },
    );
  }

  switch (candidate.by) {
    case "automationId": {
      const wanted = requireValue(candidate);
      return nodes.filter((node) => node.native?.["automationId"] === wanted);
    }

    case "controlPath": {
      const wanted = requireValue(candidate);
      return nodes.filter((node) => node.controlPath === wanted);
    }

    case "role": {
      /*
       * Role plus name, and `exact` decides which comparison. A role-only
       * candidate is legal and will usually match many elements — the resolver
       * refuses that, which is the right answer for a binding that was never
       * specific enough.
       */
      const role = candidate.role;
      if (role === undefined || role === "") {
        throw new LocateError('A "role" candidate must carry a role.', { adapter: "ax" });
      }
      const name = candidate.name;
      return nodes.filter((node) => {
        if (node.role !== role) return false;
        if (name === undefined) return true;
        return candidate.exact === false
          ? norm(node.name).toLowerCase().includes(norm(name).toLowerCase())
          : norm(node.name) === norm(name);
      });
    }

    case "name": {
      const wanted = requireValue(candidate);
      return nodes.filter((node) => norm(node.name) === norm(wanted));
    }

    case "text": {
      const wanted = norm(requireValue(candidate));
      return nodes.filter((node) => {
        const haystack = `${norm(node.name)} ${norm(node.value)}`.trim();
        return candidate.exact === false
          ? haystack.toLowerCase().includes(wanted.toLowerCase())
          : norm(node.name) === wanted || norm(node.value) === wanted;
      });
    }

    case "title": {
      const wanted = requireValue(candidate);
      return nodes.filter((node) => norm(node.source.help) === norm(wanted));
    }

    case "id": {
      // A web binding's `id` and an `AXIdentifier` are the same idea: Chromium
      // publishes an element's `id` attribute as its `AXIdentifier` on macOS
      // (LLD §7.5), so a binding recorded in the browser still resolves in the
      // Electron shell around it.
      const wanted = requireValue(candidate);
      return nodes.filter((node) => node.native?.["automationId"] === wanted);
    }

    case "coords": {
      /*
       * The last resort, and it is a *point*, not a box: the candidate carries
       * `x,y` and the match is the deepest element whose box contains it. The
       * deepest, because every ancestor's box contains the point too and a
       * click on the window is not a click on the button inside it.
       */
      const [x, y] = requireValue(candidate).split(",").map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new LocateError('A "coords" candidate must be "x,y".', { adapter: "ax" });
      }
      const hits = nodes.filter((node) => contains(node, x!, y!));
      const deepest = hits.reduce<AxSnapshotNode | undefined>(
        (best, node) => (best === undefined || node.depth > best.depth ? node : best),
        undefined,
      );
      return deepest === undefined ? [] : [deepest];
    }

    default:
      throw new LocateError(
        `The AX adapter has no rule for a "${candidate.by}" candidate.`,
        { adapter: "ax" },
      );
  }
}

function contains(node: AxSnapshotNode, x: number, y: number): boolean {
  if (node.box === undefined) return false;
  const [left, top, width, height] = node.box;
  return x >= left && y >= top && x <= left + width && y <= top + height;
}

/**
 * The candidate bundle for one element, best first (REQ-REC-3, LLD §3.3).
 *
 * > desktop (UIA/AX): `controlPath = "Window[name]/Pane[2]/Button[name]"`
 *
 * The order is the order of how much of the window has to stay the same for the
 * candidate to keep working:
 *
 * 1. **`automationId`** — an `AXIdentifier`, which on the web is an `id`
 *    attribute and in a native app is whatever the developer set. Survives a
 *    re-layout, a rename, and a translation.
 * 2. **role + name** — survives a re-layout but not a rename.
 * 3. **`text`** — a value rather than a name; for controls whose identity is
 *    what they display.
 * 4. **`controlPath`** — survives a rename but not a re-layout.
 * 5. **`coords`** — survives nothing, and is what a canvas leaves.
 *
 * Scores are the same 0..1 scale the web synthesis uses so a mixed store ranks
 * consistently; a candidate that matches more than one element is dropped by
 * the caller (REQ-REC-3), not here.
 */
export function synthesise(
  node: AxSnapshotNode,
  nodes: readonly AxSnapshotNode[],
): Candidate[] {
  const out: Candidate[] = [];
  const unique = (candidate: Candidate): boolean => matchNodes(candidate, nodes).length === 1;
  const push = (candidate: Candidate): void => {
    if (unique(candidate)) out.push(candidate);
  };

  const automationId = node.native?.["automationId"];
  if (automationId !== undefined && automationId !== "") {
    push({ by: "automationId", value: automationId, score: 0.95 });
  }

  const name = norm(node.name);
  if (name !== "") {
    push({ by: "role", role: node.role, name, exact: true, score: 0.85 });
  }

  const value = norm(node.value);
  if (value !== "" && value !== name) {
    push({ by: "text", value, exact: true, score: 0.6 });
  }

  push({ by: "controlPath", value: node.controlPath, score: 0.55 });

  if (node.box !== undefined) {
    const [x, y, width, height] = node.box;
    out.push({
      by: "coords",
      value: `${Math.round(x + width / 2)},${Math.round(y + height / 2)}`,
      score: 0.2,
    });
  }

  return out;
}
