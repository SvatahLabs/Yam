/**
 * What both model tiers have to know (T4.3, T4.4).
 *
 * The action set is in the schema the model is constrained to, so it cannot
 * choose one that does not exist. What the schema cannot say is which *argument*
 * each action takes, or which of two plausible actions a sentence means — and
 * those are exactly the two things a model gets wrong when it is not told.
 *
 * One module, used by Tier 2 and Tier 3 alike, because the conventions are the
 * project's rather than the model's: a rule that held for one tier and not the
 * other would mean the same sentence compiled to two different steps depending
 * on which model happened to be available.
 *
 * Derived from the grammar where it can be. `docs/flow-language.md` is the
 * reference, `tier1.ts` is the implementation, and this is the summary a model
 * reads — so a test compares this list against the golden set rather than
 * against a copy of the grammar, and drift shows up as a failing eval.
 */

/** One action, with the arguments the project's IR expects it to carry. */
export interface ActionConvention {
  readonly action: string;
  /** The argument names, in the order a reader finds them useful. */
  readonly args: readonly string[];
  /** One line: when this action, rather than the one beside it. */
  readonly when: string;
}

/**
 * The argument conventions, action by action.
 *
 * Only the actions whose arguments are not obvious from their name. An action
 * with no row takes a target and nothing else, which is the common case and the
 * one a model already gets right.
 */
export const ACTION_CONVENTIONS: readonly ActionConvention[] = [
  { action: "navigate", args: ["url"], when: "the sentence names a page or an address to go to" },
  { action: "back", args: [], when: "the sentence means the browser's back button" },
  { action: "forward", args: [], when: "the sentence means the browser's forward button" },
  { action: "refresh", args: [], when: "the sentence means reloading the current page" },
  { action: "click", args: [], when: "a single press on an element: click, tap, hit, push" },
  { action: "doubleClick", args: [], when: "explicitly twice" },
  { action: "rightClick", args: [], when: "a context menu" },
  { action: "hover", args: [], when: "pointing at something without pressing: hover, point at" },
  { action: "type", args: ["value"], when: "text goes into a field: type, enter, put, fill, write, key" },
  { action: "clear", args: [], when: "a field is emptied: clear, empty, erase" },
  { action: "press", args: ["key"], when: "a named keyboard key is pressed" },
  { action: "keyDown", args: ["key"], when: "a key is held down and not released" },
  { action: "keyUp", args: ["key"], when: "a held key is released" },
  { action: "submit", args: [], when: "a form is submitted or sent" },
  { action: "upload", args: ["path"], when: "a file is attached" },
  {
    action: "selectOption",
    args: ["label", "value"],
    when: 'a choice is made in a select: use "label" for visible text, "value" for the underlying value',
  },
  { action: "deselectOption", args: ["label"], when: "one choice is unmade" },
  { action: "deselectAll", args: [], when: "every choice is unmade" },
  {
    action: "setChecked",
    args: ["checked"],
    when: 'a checkbox or switch: "checked" is true for check/tick/turn on, false for uncheck/untick/turn off',
  },
  { action: "scrollIntoView", args: [], when: "an element is scrolled to" },
  { action: "scrollToTop", args: [], when: "the page is scrolled to the top" },
  { action: "scrollToBottom", args: [], when: "the page is scrolled to the bottom" },
  { action: "sleep", args: ["seconds", "ms"], when: "an unconditional wait for a duration" },
  {
    action: "waitFor",
    args: [],
    when: 'waiting **until** a condition holds; the condition goes in "expect"',
  },
  {
    action: "switchWindow",
    args: ["index", "which"],
    when: 'another tab or window: "index" is 0-based, so "the second tab" is 1; "which" is "new" or "main"',
  },
  { action: "closeOtherWindows", args: [], when: "every other tab is closed" },
  { action: "switchFrame", args: [], when: "an iframe is entered or left" },
  {
    action: "dialog",
    // Draft 2.8 §3.2: the args are `{ action, text? }`, and `text` is the one
    // the adapters read. `promptText` is still *accepted* by the raw schema as a
    // synonym, but a convention that taught the model the synonym would keep
    // producing steps that need lowering to rescue them.
    args: ["action", "text"],
    when: 'a native alert, confirm or prompt: "action" is "accept" for accept/confirm/ok, "dismiss" for dismiss/cancel; "text" is what a prompt is answered with',
  },
  {
    action: "read",
    args: [],
    when: 'a value is remembered under a name; the name and the source go in "capture", never in "expect"',
  },
  {
    action: "expect",
    args: [],
    when: 'an assertion about what is already true; the assertion goes in "expect"',
  },
  { action: "evaluate", args: ["script"], when: "a script is run in the page" },
  { action: "screenshot", args: ["name"], when: "a screenshot is taken" },
  { action: "api", args: ["request"], when: "a named API request is called" },
];

/**
 * The distinctions a model gets wrong when it is not told, each with the reason.
 *
 * Every one of these was an actual failure on the `tier: 2` golden subset before
 * it was written down, which is what a golden set is for.
 */
export const DISAMBIGUATIONS: readonly string[] = [
  'A negated assertion keeps the positive predicate and sets "negate": true: ' +
    '"should not be visible" is {"kind":"visible","negate":true}, never {"kind":"hidden"}.',
  'In "expect", "subject" is "target" whenever the step has a target, and "page" only for a ' +
    "claim about the page itself — its title, its URL, or its whole text.",
  "These actions take no target at all, and inventing one for them is always wrong: navigate, " +
    "back, forward, refresh, scrollToTop, scrollToBottom, switchWindow, closeOtherWindows, " +
    "dialog, screenshot, evaluate, api.",
  '"expect" is an assertion about what is already true — "make sure", "verify", "ensure", ' +
    '"should", "must". "waitFor" is for a sentence with "until" or "wait" in it. A sentence ' +
    "that asserts without waiting is never waitFor.",
  '"read" remembers a value: "remember", "save", "note down", "grab … as x". The name goes in ' +
    '"capture", with "from" saying which of text, value, attribute, title, result, response or ' +
    'output it came from. A "read" step never has an "expect".',
  '"dialog" is a native alert, confirm or prompt — a browser dialog with no element to click. ' +
    "A sentence about accepting, confirming, dismissing or cancelling *an alert* is a dialog " +
    "step, not a click on a button.",
  '"back" is the browser\'s back button: "go back", "return to the previous page", "step back ' +
    'in the history". It is never a navigate to a remembered URL.',
  'A target phrase is copied from the sentence character for character, including its case: ' +
    '"the book now button", not "the Book now button". The project resolves phrases to ' +
    "elements and a phrase that does not match the sentence resolves to a different element.",
  "Every field is omitted unless the sentence determines it. A step with an invented capture, " +
    "an invented argument or an invented variable is worse than a step with fewer fields.",
];

/** The conventions, as the block a prompt carries. */
export function conventionsBlock(): string {
  const rows = ACTION_CONVENTIONS.map((one) => {
    const args = one.args.length === 0 ? "no arguments" : one.args.map((a) => `"${a}"`).join(", ");
    return `- ${one.action} (${args}) — ${one.when}`;
  });
  return [
    "Argument conventions, by action. An action not listed takes a target and nothing else:",
    "",
    ...rows,
    "",
    "Distinctions that matter:",
    "",
    ...DISAMBIGUATIONS.map((one) => `- ${one}`),
  ].join("\n");
}
