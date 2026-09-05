/**
 * `Predicate` → a `CheckResult`, over Appium (LLD §2.3, ADR-7).
 *
 * The same predicate set every adapter answers, asked of a device. Most of it is
 * one WebDriver call; the differences are where a phone has no equivalent of a
 * page-level idea — a native screen has no title and no URL — and there the
 * answer is the nearest honest one rather than a guess.
 *
 * A check never throws for a false predicate; it returns `{ ok: false }` with
 * the actual and expected values, and the executor decides whether that is a
 * failed expectation or a guard that skips the step (LLD §8.2, §8.3).
 */
import type { CheckResult, CheckSubject, Predicate, Ref, ValueRef } from "@svatah/schema";
import { CheckError, DataError, DialogError } from "@svatah/surface";
import type { AppiumClient, ElementId } from "./client.js";

export interface AppiumCheckContext {
  readonly client: AppiumClient;
  readonly native: boolean;
  /** The driver-side element a reference means. */
  element(ref: Ref): Promise<ElementId>;
  /** Every name and value on the screen, for a page-level text predicate. */
  snapshotText(): Promise<string>;
}

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
        { adapter: "appium" },
      );
    default: {
      const exhaustive: never = ref;
      throw new DataError(`Unknown value reference ${JSON.stringify(exhaustive)}.`, {
        adapter: "appium",
      });
    }
  }
}

function result(ok: boolean, actual: unknown, expected: unknown, message?: string): CheckResult {
  const out: CheckResult = { ok, actual, expected };
  if (message !== undefined) out.message = message;
  return out;
}

function applyNegate(check: CheckResult, negate: boolean | undefined): CheckResult {
  if (negate !== true) return check;
  return { ...check, ok: !check.ok };
}

export async function evaluateAppiumPredicate(
  predicate: Predicate,
  subject: CheckSubject,
  ref: Ref | undefined,
  context: AppiumCheckContext,
): Promise<CheckResult> {
  if (subject === "dialog") {
    /*
     * A phone has no native dialog the surface can see: a permission prompt is
     * another app's window and an in-app modal is just more of the page source.
     * The capability descriptor says `dialogs: false`, so the executor refuses
     * a plan needing one at start (LLD §2.4); a `check` that got here anyway is
     * told plainly rather than answered with a guess.
     */
    throw new DialogError(
      "The Appium adapter has no dialog surface: `capabilities().dialogs` is false, and a " +
        "permission prompt belongs to another application (LLD §2.4).",
      { adapter: "appium" },
    );
  }

  /* ── the screen as a whole ──────────────────────────────────────────────── */
  if (predicate.kind === "url" || predicate.kind === "urlContains") {
    const expected = literalValue(predicate.value);
    const actual = context.native ? "" : await context.client.getUrl();
    const ok = predicate.kind === "url" ? actual === expected : actual.includes(expected);
    return applyNegate(
      result(
        ok,
        actual,
        expected,
        context.native ? "A native context has no URL; switch to a webview first." : undefined,
      ),
      predicate.negate,
    );
  }
  if (predicate.kind === "title" || predicate.kind === "titleContains") {
    const expected = literalValue(predicate.value);
    const actual = context.native ? "" : await context.client.getTitle();
    const ok = predicate.kind === "title" ? actual === expected : actual.includes(expected);
    return applyNegate(result(ok, actual, expected), predicate.negate);
  }
  if (subject === "page" && (predicate.kind === "text" || predicate.kind === "textContains")) {
    // Everything named on the screen, which for a native app *is* the page text.
    const actual = await context.snapshotText();
    const expected = literalValue(predicate.value);
    const ok = predicate.kind === "text" ? actual === expected : actual.includes(expected);
    return applyNegate(result(ok, actual, expected), predicate.negate);
  }

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

  /* ── one element ────────────────────────────────────────────────────────── */
  if (predicate.kind === "present" || predicate.kind === "absent") {
    const alive =
      ref === undefined
        ? false
        : await context
            .element(ref)
            .then(() => true)
            .catch(() => false);
    const ok = predicate.kind === "present" ? alive : !alive;
    return applyNegate(result(ok, alive, true), predicate.negate);
  }

  if (ref === undefined) {
    throw new CheckError(`The "${predicate.kind}" predicate needs a reference to check.`, {
      adapter: "appium",
    });
  }
  const id = await context.element(ref);
  const { client } = context;

  switch (predicate.kind) {
    case "visible":
    case "hidden": {
      const shown = await client.isDisplayed(id);
      const ok = predicate.kind === "visible" ? shown : !shown;
      return applyNegate(result(ok, shown, predicate.kind === "visible"), predicate.negate);
    }
    case "enabled":
    case "disabled": {
      const on = await client.isEnabled(id);
      const ok = predicate.kind === "enabled" ? on : !on;
      return applyNegate(result(ok, on, predicate.kind === "enabled"), predicate.negate);
    }
    case "checked":
    case "unchecked":
    case "selected": {
      // Appium reports checked, selected and "on" through one call, because on a
      // phone they are one idea: the control is in its second state.
      const on = await client.isSelected(id);
      const ok = predicate.kind === "unchecked" ? !on : on;
      return applyNegate(result(ok, on, predicate.kind !== "unchecked"), predicate.negate);
    }
    case "multiSelect": {
      // Nothing on a phone is a multiple-select; a picker is a picker.
      return applyNegate(result(false, false, true), predicate.negate);
    }

    case "text":
    case "textContains": {
      const expected = literalValue(predicate.value);
      const actual = (await client.getText(id)).replace(/\s+/g, " ").trim();
      const ok = predicate.kind === "text" ? actual === expected : actual.includes(expected);
      return applyNegate(result(ok, actual, expected), predicate.negate);
    }
    case "value": {
      const expected = literalValue(predicate.value);
      const actual =
        (await client.getAttribute(id, context.native ? "text" : "value")) ??
        (await client.getText(id));
      return applyNegate(result(actual === expected, actual, expected), predicate.negate);
    }
    case "tag": {
      const expected = literalValue(predicate.value).toLowerCase();
      const actual = ((await client.getAttribute(id, "class")) ?? "").toLowerCase();
      // A native "tag" is a class name, and the comparison a flow author means is
      // "is it a button", not "is it android.widget.Button".
      const ok = actual === expected || actual.endsWith(`.${expected}`);
      return applyNegate(result(ok, actual, expected), predicate.negate);
    }
    case "attribute": {
      const expected = literalValue(predicate.value);
      const actual = await client.getAttribute(id, predicate.name);
      return applyNegate(result(actual === expected, actual, expected), predicate.negate);
    }
    case "css": {
      if (context.native) {
        throw new CheckError(
          'A native context has no computed style, so the "css" predicate cannot be answered.',
          { adapter: "appium" },
        );
      }
      const expected = literalValue(predicate.value);
      const actual = String(
        await client.execute<string>(
          "return getComputedStyle(arguments[0]).getPropertyValue(arguments[1]).trim()",
          [{ "element-6066-11e4-a52e-4f735466cecf": id }, predicate.name],
        ),
      );
      return applyNegate(result(actual === expected, actual, expected), predicate.negate);
    }

    case "location":
    case "size":
    case "box": {
      const rect = await client.getRect(id);
      const actual =
        predicate.kind === "location"
          ? [rect.x, rect.y]
          : predicate.kind === "size"
            ? [rect.width, rect.height]
            : [rect.x, rect.y, rect.width, rect.height];
      const ok =
        actual.length === predicate.numbers.length &&
        actual.every((n, i) => Math.abs(n - predicate.numbers[i]!) <= 1);
      return result(ok, actual, predicate.numbers);
    }

    default:
      throw new CheckError(`Unknown predicate ${JSON.stringify(predicate)}.`, { adapter: "appium" });
  }
}
