/**
 * The action vocabulary (REQ-COMP-2, REQ-RUN-10, LLD §4.3, T2.2).
 *
 * A port of the legacy `ActionSynonyms.java`, verb for verb, onto the v3 IR
 * `Action` set. Every synonym the Java project accepted is here, so a flow that
 * `migrate` produces uses words the grammar already knows, and so REQ-RUN-10 —
 * "every action in the existing Selenium vocabulary has an implementation" — can
 * be checked rather than asserted. `test/vocabulary.test.ts` reads the Java file
 * and fails if a synonym went missing.
 *
 * The legacy names are kept on each entry. They are not used at run time; they
 * exist so the port is auditable, so `migrate` can map an old verb to a new one
 * by name, and so a reviewer can see that `contextClick` became `rightClick`
 * rather than being dropped.
 *
 * ## Where a verb goes in the IR
 *
 * Most map to an `Action`. Three groups do not map one-to-one, and the shape
 * they take is the interesting part of the port:
 *
 * * **The `assert*` and `validate*` verbs** become `expect` with a predicate.
 *   The legacy had forty of them because each assertion was its own method; the
 *   IR has one action and a predicate set, which is the same information with
 *   the combinations that were missing filled in.
 * * **`acceptAndValidateAlertText`** becomes one step that *both* acts and
 *   expects: `action: "dialog"` with `expect` on the dialog. `Step` carries both
 *   fields, so this stays one sentence and one step (REQ-COMP-1).
 * * **The `select*` / `deselect*` family** collapses into `selectOption` /
 *   `deselectOption` with a `by` argument, because "by visible text", "by value"
 *   and "by index" are three arguments to one action, not three actions.
 *
 * The android and desktop lists in the Java file are identical apart from the
 * mapper class they name, so this is one list.
 */
import type { Action } from "@svatah/yam-schema";

export interface Verb {
  /**
   * The legacy `ActionSynonyms.java` name. Kept for auditability and for
   * `migrate`; never consulted at run time.
   */
  readonly legacy: string;
  /** The IR action this verb compiles to. */
  readonly action: Action;
  /** For `expect`: the predicate kind the expectation carries. */
  readonly predicate?: string;
  /** For `expect`: whether the predicate is negated. */
  readonly negate?: boolean;
  /** For `expect`: what the predicate is about. Default `target`. */
  readonly subject?: "target" | "page" | "dialog";
  /** Arguments the verb fixes, whatever the sentence says. */
  readonly args?: Readonly<Record<string, string | number | boolean>>;
  /** What `read` captures, for the capture verbs. */
  readonly readKind?: "text" | "value" | "attribute" | "title" | "url" | "result";
  /** Every phrase that means this verb, lower-cased. */
  readonly synonyms: readonly string[];
}

export const VOCABULARY: readonly Verb[] = [
  /* ── navigation ─────────────────────────────────────────────────────────── */
  { legacy: "navigate", action: "navigate", synonyms: ["open", "opens", "navigate", "navigates"] },
  { legacy: "forward", action: "forward", synonyms: ["forward", "go forward", "clicks on forward button"] },
  { legacy: "back", action: "back", synonyms: ["back", "go back", "clicks on back button"] },
  { legacy: "refresh", action: "refresh", synonyms: ["refresh", "refreshes", "reload", "reloads"] },

  /* ── windows and frames ─────────────────────────────────────────────────── */
  {
    legacy: "switchToChildWindow",
    action: "switchWindow",
    args: { to: "new" },
    synonyms: [
      "switchtowindow",
      "switch to new window",
      "switches to new window",
      "switch to new tab",
      "switches to new tab",
    ],
  },
  {
    legacy: "switchToMainWindow",
    action: "switchWindow",
    args: { to: "main" },
    synonyms: [
      "switchtomainwindow",
      "switch to main window",
      "switches to main window",
      "switch to main tab",
      "switches to main tab",
    ],
  },
  {
    legacy: "switchToFrame",
    action: "switchFrame",
    synonyms: ["switchtoframe", "switch to frame", "switches to frame"],
  },
  {
    legacy: "closeOtherWindows",
    action: "closeOtherWindows",
    synonyms: ["closeotherwindows", "close other windows", "closes other windows"],
  },

  /* ── pointer ────────────────────────────────────────────────────────────── */
  { legacy: "click", action: "click", synonyms: ["click", "clicks"] },
  {
    legacy: "clickAndHold",
    action: "pressAndHold",
    synonyms: ["clickandhold", "clicks and holds", "click and hold"],
  },
  { legacy: "release", action: "release", synonyms: ["release", "releases"] },
  {
    legacy: "contextClick",
    action: "rightClick",
    synonyms: ["contextclick", "context click", "context clicks"],
  },
  {
    legacy: "doubleClick",
    action: "doubleClick",
    synonyms: ["doubleclick", "double click", "double clicks"],
  },
  {
    legacy: "moveToElement",
    action: "hover",
    synonyms: [
      "movetoelement",
      "movestoelement",
      "move to element",
      "moves to element",
      "move over element",
      "moves over element",
      "move to element center",
      "moves to element center",
    ],
  },
  {
    legacy: "moveToElementAndClick",
    action: "hoverAndClick",
    synonyms: [
      "movetoelementandclick",
      "movestoelementandclick",
      "move to element and click",
      "moves to element and click",
      "move over element and click",
      "moves over element and click",
    ],
  },

  /* ── keyboard and input ─────────────────────────────────────────────────── */
  { legacy: "keyUp", action: "keyUp", synonyms: ["keyup", "key up", "keys up"] },
  { legacy: "keyDown", action: "keyDown", synonyms: ["keydown", "key down", "keys down"] },
  { legacy: "clear", action: "clear", synonyms: ["clear", "clears"] },
  { legacy: "type", action: "type", synonyms: ["type", "types"] },
  { legacy: "submit", action: "submit", synonyms: ["submit", "submits", "click enter"] },

  /* ── reading ────────────────────────────────────────────────────────────── */
  {
    legacy: "getText",
    action: "read",
    readKind: "text",
    synonyms: ["gettext", "get text", "gets text", "copy text", "save text", "saves text"],
  },

  /* ── dialogs ────────────────────────────────────────────────────────────── */
  {
    legacy: "dismissAlert",
    action: "dialog",
    args: { action: "dismiss" },
    synonyms: ["dismissalert", "dismiss alert", "dismisses alert"],
  },
  {
    legacy: "acceptAlert",
    action: "dialog",
    args: { action: "accept" },
    synonyms: ["acceptalert", "accept alert", "accepts alert"],
  },
  {
    // One sentence, one step: `dialog` with an expectation attached (LLD §3.2).
    legacy: "acceptAndValidateAlertText",
    action: "dialog",
    args: { action: "accept" },
    predicate: "text",
    subject: "dialog",
    synonyms: [
      "acceptandvalidatealerttext",
      "accept the alert and validate alert text",
      "accept the alert and validate displayed text",
    ],
  },
  {
    legacy: "rejectAndValidateAlertText",
    action: "dialog",
    args: { action: "dismiss" },
    predicate: "text",
    subject: "dialog",
    synonyms: [
      "rejectandvalidatealerttext",
      "reject the alert and validate alert text",
      "reject the alert and validate displayed text",
    ],
  },

  /* ── waiting ────────────────────────────────────────────────────────────── */
  { legacy: "wait", action: "sleep", synonyms: ["wait", "waits", "sleep", "sleeps", "waiting"] },
  {
    legacy: "explicitWaitForElementPresence",
    action: "waitFor",
    args: { until: "present" },
    synonyms: ["explicitwaitforelementpresence", "wait for the presence", "waits for the presence"],
  },
  {
    legacy: "explicitWaitForElementVisibility",
    action: "waitFor",
    args: { until: "visible" },
    synonyms: [
      "explicitwaitforelementvisibility",
      "wait for the visibility",
      "waits for the visibility",
    ],
  },

  /* ── expectations ───────────────────────────────────────────────────────── */
  {
    legacy: "assertSelected",
    action: "expect",
    predicate: "selected",
    synonyms: ["assertselected", "assert selected", "check selected", "is selected"],
  },
  {
    legacy: "assertNotSelected",
    action: "expect",
    predicate: "selected",
    negate: true,
    synonyms: ["assertnotselected", "assert not selected", "is not selected"],
  },
  {
    legacy: "assertDisplayed",
    action: "expect",
    predicate: "visible",
    synonyms: ["assertdisplayed", "assert displayed", "isdisplayed", "is displayed"],
  },
  {
    legacy: "assertNotDisplayed",
    action: "expect",
    predicate: "hidden",
    synonyms: ["assertnotdisplayed", "assert not displayed", "is not displayed"],
  },
  {
    legacy: "assertEnabled",
    action: "expect",
    predicate: "enabled",
    synonyms: ["assertenabled", "assert enabled", "is enabled", "is not disabled"],
  },
  {
    legacy: "assertDisabled",
    action: "expect",
    predicate: "disabled",
    synonyms: ["assertdisabled", "assert disabled", "is disabled", "is not enabled"],
  },
  {
    legacy: "assertElementPresent",
    action: "expect",
    predicate: "present",
    synonyms: ["assertelementpresent", "assert element present", "is element present"],
  },
  {
    legacy: "assertAlertPresent",
    action: "expect",
    predicate: "present",
    subject: "dialog",
    synonyms: ["assertalertpresent", "assert alert present", "is alert present"],
  },
  {
    legacy: "assertAlertNotPresent",
    action: "expect",
    predicate: "absent",
    subject: "dialog",
    synonyms: ["assertalertnotpresent", "assert alert not present", "is alert not present"],
  },
  {
    legacy: "validateTitle",
    action: "expect",
    predicate: "title",
    subject: "page",
    synonyms: ["validatetitle", "validate title", "validates title", "verifytitle", "verify title"],
  },
  {
    legacy: "validateText",
    action: "expect",
    predicate: "text",
    synonyms: ["validatetext", "validate text", "validates text", "verifytext", "verify text"],
  },
  {
    legacy: "validateContainsText",
    action: "expect",
    predicate: "textContains",
    synonyms: [
      "validatecontainstext",
      "validate contains text",
      "contains text",
      "verifycontainstext",
      "verify contains text",
    ],
  },
  {
    legacy: "validateTagName",
    action: "expect",
    predicate: "tag",
    synonyms: ["validatetagname", "validate tag name", "verifytagname", "verify tag name"],
  },
  {
    legacy: "validateAttributeValue",
    action: "expect",
    predicate: "attribute",
    synonyms: [
      "validateattributevalue",
      "validate attribute value",
      "verifyattributevalue",
      "verify attribute value",
    ],
  },
  {
    legacy: "validateCssValue",
    action: "expect",
    predicate: "css",
    synonyms: ["validatecssvalue", "validate css value", "verifycssvalue", "verify css value"],
  },
  {
    legacy: "validateLocation",
    action: "expect",
    predicate: "location",
    synonyms: ["validatelocation", "validate location", "verifylocation", "verify location"],
  },
  {
    legacy: "validateDimension",
    action: "expect",
    predicate: "size",
    synonyms: ["validatedimension", "validate dimension", "verifydimension", "verify dimension"],
  },
  {
    legacy: "validateRectangle",
    action: "expect",
    predicate: "box",
    synonyms: ["validaterectangle", "validate rectangle", "verifyrectangle", "verify rectangle"],
  },

  /* ── selects ────────────────────────────────────────────────────────────── */
  {
    legacy: "selectByVisibleText",
    action: "selectOption",
    args: { by: "label" },
    synonyms: ["selectbyvisibletext", "select by visible text", "select by shown text", "select"],
  },
  {
    legacy: "selectByIndex",
    action: "selectOption",
    args: { by: "index" },
    synonyms: ["selectbyindex", "select by index"],
  },
  {
    legacy: "selectByValue",
    action: "selectOption",
    args: { by: "value" },
    synonyms: ["selectbyvalue", "select by value", "select by sent value"],
  },
  {
    legacy: "deselectAll",
    action: "deselectAll",
    synonyms: ["deselectall", "deselect all", "remove all selections"],
  },
  {
    legacy: "deselectByVisibleText",
    action: "deselectOption",
    args: { by: "label" },
    synonyms: [
      "deselectbyvisibletext",
      "deselect by visible text",
      "deselect by shown text",
      "deselect",
    ],
  },
  {
    legacy: "deselectByIndex",
    action: "deselectOption",
    args: { by: "index" },
    synonyms: ["deselectbyindex", "deselect by index"],
  },
  {
    legacy: "deselectByValue",
    action: "deselectOption",
    args: { by: "value" },
    synonyms: ["deselectbyvalue", "deselect by value", "deselect by sent value"],
  },
  {
    legacy: "isMultipleSelectionSupported",
    action: "expect",
    predicate: "multiSelect",
    synonyms: ["ismultipleselectionsupported", "is multiple selection supported"],
  },
  {
    legacy: "assertMultipleSelectionSupported",
    action: "expect",
    predicate: "multiSelect",
    synonyms: [
      "assertmultipleselectionsupported",
      "assert multiple selection is supported",
      "validate multiple selection is supported",
    ],
  },
  {
    legacy: "assertMultipleSelectionNotSupported",
    action: "expect",
    predicate: "multiSelect",
    negate: true,
    synonyms: [
      "assertmultipleselectionnotsupported",
      "assert multiple selection is not supported",
      "validate multiple selection is not supported",
    ],
  },

  /* ── scrolling ──────────────────────────────────────────────────────────── */
  {
    legacy: "scrollIntoView",
    action: "scrollIntoView",
    synonyms: ["scrollintoview", "scroll into view", "scroll to view"],
  },
  {
    legacy: "scrollToBottom",
    action: "scrollToBottom",
    synonyms: [
      "scrolltobottom",
      "scroll to bottom",
      "scrolls to bottom",
      "scroll to page bottom",
      "scrolls to page bottom",
      "scroll to bottom of the page",
    ],
  },
  {
    legacy: "scrollToTop",
    action: "scrollToTop",
    synonyms: [
      "scrolltotop",
      "scroll to top",
      "scrolls to top",
      "scroll to page top",
      "scrolls to page top",
      "scroll to top of the page",
    ],
  },

  /* ── scripts ────────────────────────────────────────────────────────────── */
  { legacy: "executeScript", action: "evaluate", synonyms: ["executescript", "execute script"] },
  {
    legacy: "executeAsyncScript",
    action: "evaluate",
    args: { async: true },
    synonyms: ["executeasyncscript", "execute async script"],
  },

  /* ── API (REQ-ADP-3: with the session's cookies, or without) ────────────── */
  {
    legacy: "INVOKE",
    action: "api",
    args: { withSessionCookies: true },
    synonyms: ["invoke", "call", "hit"],
  },
  {
    legacy: "INVOKE_WITHOUT_COOKIE",
    action: "api",
    args: { withSessionCookies: false },
    synonyms: ["invoke without cookies", "call without cookies", "hit without cookies"],
  },
];
