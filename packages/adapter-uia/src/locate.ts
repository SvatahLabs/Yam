/**
 * `Candidate` → elements of a UI Automation tree (T6.1, LLD §7.5, §3.3).
 *
 * The sibling of `@svatah/adapter-ax`'s `locate.ts`. UIA does have a query
 * language — `AutomationElement.FindAll` with a `PropertyCondition` — and it is
 * deliberately not used: a `FindAll` is another marshalled round trip per
 * candidate, and matching against the snapshot the adapter already took means a
 * `describe()` and a `locate()` can never disagree about what is on screen.
 *
 * A candidate kind this tree cannot express is refused with the reason, not
 * matched against nothing (LLD §6.3).
 */
import type { Candidate } from "@svatah/schema";
import { LocateError } from "@svatah/surface";
import type { UiaSnapshotNode } from "./tree.js";

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

function requireValue(candidate: Candidate): string {
  if (candidate.value === undefined || candidate.value === "") {
    throw new LocateError(`A "${candidate.by}" candidate must carry a value.`, { adapter: "uia" });
  }
  return candidate.value;
}

const norm = (text: string | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

/** Every node the candidate matches, in snapshot order. */
export function matchNodes(
  candidate: Candidate,
  nodes: readonly UiaSnapshotNode[],
): UiaSnapshotNode[] {
  const foreign = FOREIGN_KINDS[candidate.by];
  if (foreign !== undefined) {
    throw new LocateError(
      `A "${candidate.by}" candidate belongs to ${foreign}; a UI Automation tree has no such ` +
        "addressing. The UIA adapter resolves automationId, controlPath, role, name, text, " +
        "title, value and coords.",
      { adapter: "uia" },
    );
  }

  switch (candidate.by) {
    case "automationId":
    case "id": {
      // On Windows the DOM `id` *is* the `AutomationId` (LLD §7.5), so a web
      // binding's `id` resolves here without a second rule.
      const wanted = requireValue(candidate);
      return nodes.filter((node) => node.native?.["automationId"] === wanted);
    }

    case "controlPath": {
      const wanted = requireValue(candidate);
      return nodes.filter((node) => node.controlPath === wanted);
    }

    case "role": {
      const role = candidate.role;
      if (role === undefined || role === "") {
        throw new LocateError('A "role" candidate must carry a role.', { adapter: "uia" });
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
      return nodes.filter((node) => norm(node.source.helpText) === norm(wanted));
    }

    case "coords": {
      const [x, y] = requireValue(candidate).split(",").map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        throw new LocateError('A "coords" candidate must be "x,y".', { adapter: "uia" });
      }
      const hits = nodes.filter((node) => contains(node, x!, y!));
      const deepest = hits.reduce<UiaSnapshotNode | undefined>(
        (best, node) => (best === undefined || node.depth > best.depth ? node : best),
        undefined,
      );
      return deepest === undefined ? [] : [deepest];
    }

    default:
      throw new LocateError(`The UIA adapter has no rule for a "${candidate.by}" candidate.`, {
        adapter: "uia",
      });
  }
}

function contains(node: UiaSnapshotNode, x: number, y: number): boolean {
  if (node.box === undefined) return false;
  const [left, top, width, height] = node.box;
  return x >= left && y >= top && x <= left + width && y <= top + height;
}

/**
 * The candidate bundle for one element, best first (REQ-REC-3, LLD §3.3).
 *
 * The same order and the same scores as the AX adapter, so a bindings store
 * written on one platform ranks consistently against one written on the other.
 * A candidate matching more than one element is dropped, except `coords`, which
 * is the pointer fallback and has nothing below it.
 */
export function synthesise(
  node: UiaSnapshotNode,
  nodes: readonly UiaSnapshotNode[],
): Candidate[] {
  const out: Candidate[] = [];
  const push = (candidate: Candidate): void => {
    if (matchNodes(candidate, nodes).length === 1) out.push(candidate);
  };

  const automationId = node.native?.["automationId"];
  if (automationId !== undefined && automationId !== "") {
    push({ by: "automationId", value: automationId, score: 0.95 });
  }

  const name = norm(node.name);
  if (name !== "") push({ by: "role", role: node.role, name, exact: true, score: 0.85 });

  const value = norm(node.value);
  if (value !== "" && value !== name) push({ by: "text", value, exact: true, score: 0.6 });

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
