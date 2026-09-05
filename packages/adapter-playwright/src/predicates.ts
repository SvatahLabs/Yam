/**
 * `Predicate` → a `CheckResult` (LLD §2.3, ADR-7).
 *
 * ADR-7 collapsed the Java framework's 22 assert and validate actions into one
 * `expect` action over a predicate set, and the same predicates serve as guards.
 * That makes this file the whole of the adapter's assertion surface: every row
 * below is one of those 22 actions.
 *
 * A check never throws for a false predicate — it returns `{ ok: false }` with
 * the actual and expected values, so the executor decides whether that is a
 * failed expectation or a guard that skips the step (LLD §8.2, §8.3).
 */
import type { ElementHandle, Frame, Page } from "playwright";
import type { CheckResult, CheckSubject, Predicate } from "@svatah/schema";
import { CheckError, DialogError } from "@svatah/surface";
import { literalValue } from "./values.js";

export interface CheckContext {
  page: Page;
  frame: Frame;
  /** Resolved when `subject === "ref"`; absent for page and dialog predicates. */
  handle?: ElementHandle<Element> | undefined;
  /** The dialog most recently seen, for `subject === "dialog"`. */
  dialog?: { type: string; message: string } | undefined;
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

async function textOf(handle: ElementHandle<Element>): Promise<string> {
  return ((await handle.textContent()) ?? "").replace(/\s+/g, " ").trim();
}

async function valueOf(handle: ElementHandle<Element>): Promise<string> {
  return await handle.evaluate((el) => {
    const tag = el.tagName.toLowerCase();
    if (tag === "select") {
      const select = el as HTMLSelectElement;
      return Array.from(select.selectedOptions)
        .map((o) => o.value)
        .join(", ");
    }
    if (tag === "input" || tag === "textarea") return (el as HTMLInputElement).value;
    return (el.textContent ?? "").replace(/\s+/g, " ").trim();
  });
}

function requireHandle(context: CheckContext, kind: string): ElementHandle<Element> {
  if (context.handle === undefined) {
    throw new CheckError(`The "${kind}" predicate needs a reference to check.`, {
      adapter: "playwright",
    });
  }
  return context.handle;
}

export async function evaluatePredicate(
  predicate: Predicate,
  subject: CheckSubject,
  context: CheckContext,
): Promise<CheckResult> {
  /* ── dialog predicates ──────────────────────────────────────────────────── */
  if (subject === "dialog") {
    const dialog = context.dialog;
    if (predicate.kind === "present") return applyNegate(result(dialog !== undefined, dialog, "a dialog"), predicate.negate);
    if (predicate.kind === "absent") return applyNegate(result(dialog === undefined, dialog, "no dialog"), predicate.negate);
    if (dialog === undefined) {
      throw new DialogError("No dialog has been seen in this session.", { adapter: "playwright" });
    }
    if (predicate.kind === "text" || predicate.kind === "textContains") {
      const expected = literalValue(predicate.value);
      const ok =
        predicate.kind === "text" ? dialog.message === expected : dialog.message.includes(expected);
      return applyNegate(result(ok, dialog.message, expected), predicate.negate);
    }
    throw new DialogError(`The "${predicate.kind}" predicate does not apply to a dialog.`, {
      adapter: "playwright",
    });
  }

  switch (predicate.kind) {
    /* ── element state ────────────────────────────────────────────────────── */
    case "visible": {
      const handle = requireHandle(context, "visible");
      const ok = await handle.isVisible();
      return applyNegate(result(ok, ok, true), predicate.negate);
    }
    case "hidden": {
      const handle = requireHandle(context, "hidden");
      const ok = await handle.isHidden();
      return applyNegate(result(ok, ok, true), predicate.negate);
    }
    case "enabled": {
      const handle = requireHandle(context, "enabled");
      const ok = await handle.isEnabled();
      return applyNegate(result(ok, ok, true), predicate.negate);
    }
    case "disabled": {
      const handle = requireHandle(context, "disabled");
      const ok = await handle.isDisabled();
      return applyNegate(result(ok, ok, true), predicate.negate);
    }
    case "checked": {
      const handle = requireHandle(context, "checked");
      const ok = await handle.isChecked();
      return applyNegate(result(ok, ok, true), predicate.negate);
    }
    case "unchecked": {
      const handle = requireHandle(context, "unchecked");
      const ok = !(await handle.isChecked());
      return applyNegate(result(ok, ok, true), predicate.negate);
    }
    case "selected": {
      const handle = requireHandle(context, "selected");
      const ok = await handle.evaluate((el) => {
        if (el instanceof HTMLOptionElement) return el.selected;
        return el.getAttribute("aria-selected") === "true";
      });
      return applyNegate(result(ok, ok, true), predicate.negate);
    }
    case "present": {
      const ok = context.handle !== undefined;
      return applyNegate(result(ok, ok, true), predicate.negate);
    }
    case "absent": {
      const ok = context.handle === undefined;
      return applyNegate(result(ok, ok, true), predicate.negate);
    }
    case "multiSelect": {
      const handle = requireHandle(context, "multiSelect");
      const ok = await handle.evaluate(
        (el) => el instanceof HTMLSelectElement && el.multiple,
      );
      return applyNegate(result(ok, ok, true), predicate.negate);
    }

    /* ── values ───────────────────────────────────────────────────────────── */
    case "text":
    case "textContains": {
      const expected = literalValue(predicate.value);
      const actual =
        subject === "page"
          ? ((await context.frame.locator("body").textContent()) ?? "").replace(/\s+/g, " ").trim()
          : await textOf(requireHandle(context, predicate.kind));
      const ok = predicate.kind === "text" ? actual === expected : actual.includes(expected);
      return applyNegate(result(ok, actual, expected), predicate.negate);
    }
    case "value": {
      const expected = literalValue(predicate.value);
      const actual = await valueOf(requireHandle(context, "value"));
      return applyNegate(result(actual === expected, actual, expected), predicate.negate);
    }
    case "title":
    case "titleContains": {
      const expected = literalValue(predicate.value);
      const actual = await context.page.title();
      const ok = predicate.kind === "title" ? actual === expected : actual.includes(expected);
      return applyNegate(result(ok, actual, expected), predicate.negate);
    }
    case "url":
    case "urlContains": {
      const expected = literalValue(predicate.value);
      const actual = context.page.url();
      const ok = predicate.kind === "url" ? actual === expected : actual.includes(expected);
      return applyNegate(result(ok, actual, expected), predicate.negate);
    }
    case "tag": {
      const expected = literalValue(predicate.value).toLowerCase();
      const actual = await requireHandle(context, "tag").evaluate((el) =>
        el.tagName.toLowerCase(),
      );
      return applyNegate(result(actual === expected, actual, expected), predicate.negate);
    }

    /* ── named values ─────────────────────────────────────────────────────── */
    case "attribute": {
      const expected = literalValue(predicate.value);
      const actual = await requireHandle(context, "attribute").getAttribute(predicate.name);
      return applyNegate(result(actual === expected, actual, expected), predicate.negate);
    }
    case "css": {
      const expected = literalValue(predicate.value);
      const actual = await requireHandle(context, "css").evaluate(
        (el, property) => getComputedStyle(el).getPropertyValue(property).trim(),
        predicate.name,
      );
      return applyNegate(result(actual === expected, actual, expected), predicate.negate);
    }

    /* ── geometry ─────────────────────────────────────────────────────────── */
    case "location":
    case "size":
    case "box": {
      const box = await requireHandle(context, predicate.kind).boundingBox();
      if (box === null) {
        return result(false, null, predicate.numbers, "The element has no bounding box.");
      }
      const actual =
        predicate.kind === "location"
          ? [box.x, box.y]
          : predicate.kind === "size"
            ? [box.width, box.height]
            : [box.x, box.y, box.width, box.height];
      const ok =
        actual.length === predicate.numbers.length &&
        actual.every((n, i) => Math.abs(n - predicate.numbers[i]!) <= 1);
      return result(ok, actual, predicate.numbers);
    }

    /* ── scope expressions ────────────────────────────────────────────────── */
    case "expr": {
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

    default: {
      const exhaustive: never = predicate;
      throw new CheckError(`Unknown predicate ${JSON.stringify(exhaustive)}.`, {
        adapter: "playwright",
      });
    }
  }
}
