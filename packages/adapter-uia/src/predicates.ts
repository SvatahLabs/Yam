/**
 * `Predicate` → a `CheckResult`, over a UI Automation tree (T6.1, LLD §2.3).
 *
 * The same predicate set every adapter answers, asked of a window. Pure, like
 * `tree.ts`: the snapshot is the input, so every rule here is testable against a
 * recorded tree.
 *
 * A predicate a desktop tree cannot answer is **refused**, never answered
 * `false`. `the URL should contain "/booking"` against a native window is not a
 * failed assertion, it is a question with no meaning here — and reporting it as
 * a failure would send whoever reads the run looking at the application.
 */
import type { CheckResult, CheckSubject, Predicate, Ref, ValueRef } from "@svatah/schema";
import { CheckError, DataError, NavigationError } from "@svatah/surface";
import type { UiaSnapshotNode } from "./tree.js";

/** The literal a `ValueRef` names; an unresolved one is a caller mistake (LLD §8.2). */
export function literalValue(ref: ValueRef): string {
  switch (ref.kind) {
    case "literal":
      return ref.value;
    case "template":
      return ref.parts.map(literalValue).join("");
    case "var":
    case "data":
    case "input":
      throw new DataError(
        `A predicate reached the adapter with an unresolved ${ref.kind} reference. ` +
          "The executor resolves values against the scope before calling the surface (LLD §8.2).",
        { adapter: "uia" },
      );
    default: {
      const exhaustive: never = ref;
      throw new DataError(`Unknown value reference ${JSON.stringify(exhaustive)}.`, {
        adapter: "uia",
      });
    }
  }
}

export interface UiaCheckContext {
  /** The nodes of the current snapshot. */
  readonly nodes: readonly UiaSnapshotNode[];
  /** The front window's title, which is the nearest thing to a page title. */
  readonly windowTitle: string;
  node(ref: Ref): UiaSnapshotNode | undefined;
}

const norm = (text: string | undefined): string => (text ?? "").replace(/\s+/g, " ").trim();

/**
 * The words an element puts on the screen, its descendants included (T12.7).
 *
 * The same normalisation the AX adapter makes, and for the same reason
 * (REQ-SURF-4): "the panel should contain X" is a sentence about a panel, and a
 * panel's own name is its heading — the words are on what is inside it. A web
 * adapter walks the subtree, so an adapter that answered from the node alone
 * made one sentence true on one side of the parity gate and false on the other.
 *
 * A descendant is a node whose `path` starts with this node's. Only
 * `textContains` reads it: `text` is an equality about one element.
 */
function subtreeText(node: UiaSnapshotNode, nodes: readonly UiaSnapshotNode[]): string {
  const inside = (one: UiaSnapshotNode): boolean =>
    one.path.length >= node.path.length &&
    node.path.every((step, at) => one.path[at] === step);
  return nodes
    .filter(inside)
    .map((one) => `${norm(one.name)} ${norm(one.value)}`.trim())
    .filter((text) => text !== "")
    .join(" ");
}

function result(ok: boolean, actual: unknown, expected: unknown, message?: string): CheckResult {
  const out: CheckResult = { ok, actual, expected };
  if (message !== undefined) out.message = message;
  return out;
}

function negated(check: CheckResult, negate: boolean | undefined): CheckResult {
  return negate === true ? { ...check, ok: !check.ok } : check;
}

export function evaluateUiaPredicate(
  predicate: Predicate,
  subject: CheckSubject,
  ref: Ref | undefined,
  context: UiaCheckContext,
): CheckResult {
  if (subject === "dialog") {
    /*
     * A Windows dialog is another *window* — its own top-level `Window` element
     * with `IsDialog` set — not something the driver hands over separately, and
     * this adapter reads one window at a time. `capabilities().dialogs` is
     * false for that reason, and a check that got here anyway is told plainly.
     */
    throw new CheckError(
      "The UIA adapter has no separate dialog surface: a Windows dialog is a top-level " +
        "window of its own, so drive it as one (LLD §2.4).",
      { adapter: "uia" },
    );
  }

  if (predicate.kind === "url" || predicate.kind === "urlContains") {
    throw new NavigationError(
      "A desktop window has no URL. Check the window title instead " +
        '(`the page title should contain "…"`), which the UIA adapter answers from the ' +
        "window's `Name`.",
      { adapter: "uia" },
    );
  }

  if (predicate.kind === "title" || predicate.kind === "titleContains") {
    const expected = literalValue(predicate.value);
    const actual = context.windowTitle;
    const ok = predicate.kind === "title" ? actual === expected : actual.includes(expected);
    return negated(result(ok, actual, expected), predicate.negate);
  }

  if (subject === "page" && (predicate.kind === "text" || predicate.kind === "textContains")) {
    // Every name and value in the window, which for a desktop app is its text.
    const actual = context.nodes
      .map((node) => `${norm(node.name)} ${norm(node.value)}`.trim())
      .filter((text) => text !== "")
      .join(" ");
    const expected = literalValue(predicate.value);
    const ok = predicate.kind === "text" ? actual === expected : actual.includes(expected);
    return negated(result(ok, actual, expected), predicate.negate);
  }

  if (predicate.kind === "expr") {
    const left = literalValue(predicate.left);
    const right = literalValue(predicate.right);
    const ok =
      predicate.op === "eq"
        ? left === right
        : predicate.op === "ne"
          ? left !== right
          : predicate.op === "gt"
            ? Number(left) > Number(right)
            : predicate.op === "lt"
              ? Number(left) < Number(right)
              : new RegExp(right).test(left);
    return negated(result(ok, left, right), predicate.negate);
  }

  /* ── one element ────────────────────────────────────────────────────────── */

  if (predicate.kind === "present" || predicate.kind === "absent") {
    const alive = ref !== undefined && context.node(ref) !== undefined;
    const ok = predicate.kind === "present" ? alive : !alive;
    return negated(result(ok, alive, true), predicate.negate);
  }

  if (ref === undefined) {
    throw new CheckError(`The "${predicate.kind}" predicate needs a reference to check.`, {
      adapter: "uia",
    });
  }
  const node = context.node(ref);
  if (node === undefined) {
    throw new CheckError(
      `Reference ${ref} is not in the current snapshot. A window that changed invalidates ` +
        "every reference (LLD §2.2); take a new snapshot.",
      { adapter: "uia" },
    );
  }

  const has = (state: string): boolean => node.states.includes(state as never);

  switch (predicate.kind) {
    case "visible":
    case "hidden": {
      const shown = !has("hidden");
      return negated(
        result(predicate.kind === "visible" ? shown : !shown, shown, true),
        predicate.negate,
      );
    }
    case "enabled":
    case "disabled": {
      const enabled = !has("disabled");
      return negated(
        result(predicate.kind === "enabled" ? enabled : !enabled, enabled, true),
        predicate.negate,
      );
    }
    case "checked":
    case "unchecked": {
      const checked = has("checked");
      return negated(
        result(predicate.kind === "checked" ? checked : !checked, checked, true),
        predicate.negate,
      );
    }
    case "selected":
      return negated(result(has("selected"), has("selected"), true), predicate.negate);
    case "multiSelect":
      /*
       * UIA answers this properly — `SelectionPattern.CanSelectMultiple` — and
       * the walk does not read it: it is a per-pattern marshalled call on every
       * container, and the snapshot pays for every property it takes. Refused
       * rather than answered `false`, which would read as "this list is
       * single-select" and is a claim the snapshot cannot support.
       */
      throw new CheckError(
        "The UIA adapter does not read `SelectionPattern.CanSelectMultiple`: it is a " +
          "per-element pattern call the snapshot walk does not make.",
        { adapter: "uia" },
      );
    case "text": {
      const expected = literalValue(predicate.value);
      const actual = norm(node.name) || norm(node.value);
      return negated(result(actual === expected, actual, expected), predicate.negate);
    }
    case "textContains": {
      const expected = literalValue(predicate.value);
      const own = norm(node.name) || norm(node.value);
      const actual = own.includes(expected) ? own : subtreeText(node, context.nodes);
      return negated(result(actual.includes(expected), actual, expected), predicate.negate);
    }
    case "value": {
      const expected = literalValue(predicate.value);
      const actual = norm(node.value);
      return negated(result(actual === expected, actual, expected), predicate.negate);
    }
    case "tag": {
      // The nearest thing a desktop element has to a tag is its `ControlType`.
      const expected = literalValue(predicate.value);
      const actual = node.source.controlType;
      return negated(result(actual === expected, actual, expected), predicate.negate);
    }
    case "attribute": {
      const expected = literalValue(predicate.value);
      const actual = node.native?.[predicate.name];
      return negated(result(actual === expected, actual ?? null, expected), predicate.negate);
    }
    case "css":
      throw new CheckError(
        "A desktop element has no CSS. Ask about a state, a value, or the role instead.",
        { adapter: "uia" },
      );
    case "location":
    case "size":
    case "box": {
      const box = node.box ?? [0, 0, 0, 0];
      const actual =
        predicate.kind === "location"
          ? [box[0], box[1]]
          : predicate.kind === "size"
            ? [box[2], box[3]]
            : [...box];
      const ok =
        actual.length === predicate.numbers.length &&
        actual.every((value, at) => Math.round(value) === Math.round(predicate.numbers[at]!));
      // A geometry predicate has no `negate` in the IR (LLD §3.2).
      return result(ok, actual, [...predicate.numbers]);
    }
    default: {
      const exhaustive = predicate as { kind: string };
      throw new CheckError(`The UIA adapter has no rule for "${exhaustive.kind}".`, {
        adapter: "uia",
      });
    }
  }
}
