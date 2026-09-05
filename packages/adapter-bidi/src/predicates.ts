/**
 * `Predicate` → a `CheckResult`, over BiDi (LLD §2.3, ADR-7).
 *
 * ADR-7 collapsed the Java framework's 22 assert and validate actions into one
 * `expect` action over a predicate set, and the same predicates serve as guards.
 * This is the BiDi half of that: every row is the same question the Playwright
 * adapter answers, asked of the DOM through one injected function instead of
 * through Playwright's element API.
 *
 * A check never throws for a false predicate — it returns `{ ok: false }` with
 * the actual and expected values, so the executor decides whether that is a
 * failed expectation or a guard that skips the step (LLD §8.2, §8.3).
 */
import type { CheckResult, CheckSubject, Predicate, Ref, ValueRef } from "@svatah/schema";
import { CheckError, DataError, DialogError } from "@svatah/surface";
import type { BidiSession } from "./session.js";

/** Run a self-contained function against one element and get JSON back. */
export type WithElement = <T>(ref: Ref, fn: (el: Element, extra: never) => T, extra?: unknown) => Promise<T>;

/**
 * The literal a `ValueRef` names.
 *
 * LLD §8.2 has the executor resolve a step's arguments against the scope before
 * it calls the surface, so by the time a predicate reaches an adapter every
 * reference in it should already be a literal. An adapter has no scope; if an
 * unresolved one arrives, saying so beats comparing against the string
 * "{data.x}".
 */
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
        { adapter: "bidi" },
      );
    default: {
      const exhaustive: never = ref;
      throw new DataError(`Unknown value reference ${JSON.stringify(exhaustive)}.`, {
        adapter: "bidi",
      });
    }
  }
}

function result(ok: boolean, actual: unknown, expected: unknown, message?: string): CheckResult {
  const out: CheckResult = { ok, actual, expected };
  if (message !== undefined) out.message = message;
  return out;
}

/** Apply `negate` last, so every row below reads positively. */
function applyNegate(check: CheckResult, negate: boolean | undefined): CheckResult {
  if (negate !== true) return check;
  return { ...check, ok: !check.ok };
}

/**
 * Everything a predicate might read from one element, in one round trip.
 *
 * One call rather than one per question: a BiDi round trip is a WebSocket
 * message and a browser event-loop turn, and a `box` predicate that made four of
 * them would be four chances for the page to move underneath it.
 */
interface ElementFacts {
  visible: boolean;
  enabled: boolean;
  checked: boolean;
  selected: boolean;
  multiSelect: boolean;
  text: string;
  value: string;
  tag: string;
  box: [number, number, number, number];
}

function factsOf(el: Element): ElementFacts {
  const tag = el.tagName.toLowerCase();
  const style = el.ownerDocument.defaultView!.getComputedStyle(el);
  const rect = el.getBoundingClientRect();
  const visible =
    el.isConnected &&
    !el.hasAttribute("hidden") &&
    el.getAttribute("aria-hidden") !== "true" &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    (rect.width > 0 || rect.height > 0);

  const value =
    tag === "select"
      ? Array.from((el as HTMLSelectElement).selectedOptions)
          .map((o) => o.value)
          .join(", ")
      : tag === "input" || tag === "textarea"
        ? (el as HTMLInputElement).value
        : (el.textContent ?? "").replace(/\s+/g, " ").trim();

  return {
    visible,
    enabled:
      !("disabled" in el && (el as HTMLInputElement).disabled) &&
      el.getAttribute("aria-disabled") !== "true",
    checked:
      "checked" in el
        ? (el as HTMLInputElement).checked === true
        : el.getAttribute("aria-checked") === "true",
    selected:
      tag === "option"
        ? (el as HTMLOptionElement).selected
        : el.getAttribute("aria-selected") === "true",
    multiSelect: tag === "select" && (el as HTMLSelectElement).multiple,
    text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
    value,
    tag,
    box: [
      Math.round(rect.x * 100) / 100,
      Math.round(rect.y * 100) / 100,
      Math.round(rect.width * 100) / 100,
      Math.round(rect.height * 100) / 100,
    ],
  };
}

export async function evaluateBidiPredicate(
  session: BidiSession,
  predicate: Predicate,
  subject: CheckSubject,
  ref: Ref | undefined,
  withElement: WithElement,
): Promise<CheckResult> {
  /* ── dialog predicates ──────────────────────────────────────────────────── */
  if (subject === "dialog") {
    const dialog = session.dialogs[session.dialogs.length - 1];
    if (predicate.kind === "present") {
      return applyNegate(result(dialog !== undefined, dialog, "a dialog"), predicate.negate);
    }
    if (predicate.kind === "absent") {
      return applyNegate(result(dialog === undefined, dialog, "no dialog"), predicate.negate);
    }
    if (dialog === undefined) {
      throw new DialogError("No dialog has been seen in this session.", { adapter: "bidi" });
    }
    if (predicate.kind === "text" || predicate.kind === "textContains") {
      const expected = literalValue(predicate.value);
      const ok =
        predicate.kind === "text" ? dialog.message === expected : dialog.message.includes(expected);
      return applyNegate(result(ok, dialog.message, expected), predicate.negate);
    }
    throw new DialogError(`The "${predicate.kind}" predicate does not apply to a dialog.`, {
      adapter: "bidi",
    });
  }

  /*
   * `present` and `absent` ask whether the caller *has* a reference at all, so
   * they are answered before anything is read from the page — a stale reference
   * is exactly what `absent` asserts.
   */
  if (predicate.kind === "present" || predicate.kind === "absent") {
    let alive = false;
    if (ref !== undefined) {
      alive = await session
        .actionability(ref)
        .then((state) => state.attached)
        .catch(() => false);
    }
    const ok = predicate.kind === "present" ? alive : !alive;
    return applyNegate(result(ok, alive, true), predicate.negate);
  }

  /* ── page-wide predicates ───────────────────────────────────────────────── */
  if (predicate.kind === "title" || predicate.kind === "titleContains") {
    const expected = literalValue(predicate.value);
    const actual = String(await session.evaluate("document.title"));
    const ok = predicate.kind === "title" ? actual === expected : actual.includes(expected);
    return applyNegate(result(ok, actual, expected), predicate.negate);
  }
  if (predicate.kind === "url" || predicate.kind === "urlContains") {
    const expected = literalValue(predicate.value);
    const actual = String(await session.evaluate("location.href"));
    const ok = predicate.kind === "url" ? actual === expected : actual.includes(expected);
    return applyNegate(result(ok, actual, expected), predicate.negate);
  }
  if (subject === "page" && (predicate.kind === "text" || predicate.kind === "textContains")) {
    const expected = literalValue(predicate.value);
    const actual = String(
      await session.evaluate("(document.body.textContent || '').replace(/\\s+/g, ' ').trim()"),
    );
    const ok = predicate.kind === "text" ? actual === expected : actual.includes(expected);
    return applyNegate(result(ok, actual, expected), predicate.negate);
  }

  /* ── scope expressions, which read nothing from the page ────────────────── */
  if (predicate.kind === "expr") {
    const left = literalValue(predicate.left);
    const right = literalValue(predicate.right);
    let ok: boolean;
    switch (predicate.op) {
      case "eq":
        ok = left === right;
        break;
      case "ne":
        ok = left !== right;
        break;
      case "gt":
        ok = Number(left) > Number(right);
        break;
      case "lt":
        ok = Number(left) < Number(right);
        break;
      case "matches":
        ok = new RegExp(right).test(left);
        break;
    }
    return applyNegate(result(ok, left, right), predicate.negate);
  }

  /* ── element predicates ─────────────────────────────────────────────────── */
  if (ref === undefined) {
    throw new CheckError(`The "${predicate.kind}" predicate needs a reference to check.`, {
      adapter: "bidi",
    });
  }

  switch (predicate.kind) {
    case "attribute": {
      const expected = literalValue(predicate.value);
      const actual = await withElement(ref, (el, name: string) => el.getAttribute(name), predicate.name);
      return applyNegate(result(actual === expected, actual, expected), predicate.negate);
    }
    case "css": {
      const expected = literalValue(predicate.value);
      const actual = await withElement(
        ref,
        (el, property: string) =>
          el
            .ownerDocument!.defaultView!.getComputedStyle(el)
            .getPropertyValue(property)
            .trim(),
        predicate.name,
      );
      return applyNegate(result(actual === expected, actual, expected), predicate.negate);
    }
    default:
      break;
  }

  const facts = await withElement<ElementFacts>(ref, factsOf as never);

  switch (predicate.kind) {
    case "visible":
      return applyNegate(result(facts.visible, facts.visible, true), predicate.negate);
    case "hidden":
      return applyNegate(result(!facts.visible, !facts.visible, true), predicate.negate);
    case "enabled":
      return applyNegate(result(facts.enabled, facts.enabled, true), predicate.negate);
    case "disabled":
      return applyNegate(result(!facts.enabled, !facts.enabled, true), predicate.negate);
    case "checked":
      return applyNegate(result(facts.checked, facts.checked, true), predicate.negate);
    case "unchecked":
      return applyNegate(result(!facts.checked, !facts.checked, true), predicate.negate);
    case "selected":
      return applyNegate(result(facts.selected, facts.selected, true), predicate.negate);
    case "multiSelect":
      return applyNegate(result(facts.multiSelect, facts.multiSelect, true), predicate.negate);

    case "text":
    case "textContains": {
      const expected = literalValue(predicate.value);
      const ok =
        predicate.kind === "text" ? facts.text === expected : facts.text.includes(expected);
      return applyNegate(result(ok, facts.text, expected), predicate.negate);
    }
    case "value": {
      const expected = literalValue(predicate.value);
      return applyNegate(result(facts.value === expected, facts.value, expected), predicate.negate);
    }
    case "tag": {
      const expected = literalValue(predicate.value).toLowerCase();
      return applyNegate(result(facts.tag === expected, facts.tag, expected), predicate.negate);
    }

    case "location":
    case "size":
    case "box": {
      const [x, y, width, height] = facts.box;
      const actual =
        predicate.kind === "location" ? [x, y] : predicate.kind === "size" ? [width, height] : facts.box;
      const ok =
        actual.length === predicate.numbers.length &&
        // A pixel of slack: a box read twice on a page with a scrollbar or a
        // sub-pixel layout is not the same number twice, and a predicate that
        // failed on that would be measuring the renderer, not the page.
        actual.every((n, i) => Math.abs(n - predicate.numbers[i]!) <= 1);
      return result(ok, actual, predicate.numbers);
    }

    default: {
      throw new CheckError(`Unknown predicate ${JSON.stringify(predicate)}.`, { adapter: "bidi" });
    }
  }
}
