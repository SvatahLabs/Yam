/**
 * A surface call, as a sentence (T5.5, REQ-BEH-4, LLD §13.4).
 *
 * "Map `act` kinds to IR actions; the intent becomes the sentence after
 * normalisation through the synonym vocabulary; targets get element ids from
 * `describe`."
 *
 * ## What the intent is for, and what it is not
 *
 * The intent is what the agent *said*: "go to the sign-in page". The call is
 * what it *did*: `act("click", <the Sign in link>)`. Those are not the same
 * claim, and only the second is a fact about the application. So the sentence is
 * built from the call — the verb from the action, the noun phrase from
 * `describe` — and the intent is kept verbatim as a comment above the step.
 *
 * Taking the intent as the sentence directly is the reading that fails: "go to
 * the sign-in page" normalises to `Go to "the sign-in page"`, which compiles to
 * a *navigation to a URL that does not exist*, from a call that was a click.
 * A proposal that plausible and that wrong is worse than one that says `//
 * review:`. What the vocabulary normalisation is for is the *verb*: the sentence
 * uses the canonical word for the action the call performed — `Click`, `Type … 
 * into`, `Remember the value of … as` — whichever synonym the agent reached for.
 * That is `sentenceForAct` and its two siblings below.
 *
 * ## The noun phrase
 *
 * From `describe`, in this order: the accessible name and the role
 * ("the Sign in link"), then the name alone, then a test id, then the tag and
 * the index. The first is what a person would write, and the rest are the
 * honest fallbacks for an element that has nothing to be called.
 */
import type { ElementDescription } from "@svatah/yam-schema";
import type { TrajectoryLine } from "./capture.js";

/** A step drafted from one or more calls. */
export interface DraftStep {
  /** The sentence, when one could be built. */
  readonly sentence?: string;
  /** The agent's own words, kept above the step. */
  readonly intent: string;
  /** Why no sentence could be built, for the `// review:` comment. */
  readonly why?: string;
  /** The element the step addresses, when it addresses one. */
  readonly element?: { readonly phrase: string; readonly describe: ElementDescription };
  /** The line numbers of the trajectory this came from, for the notes. */
  readonly seq: readonly number[];
  /** The URL the calls were made on, for the binding's context pattern. */
  readonly url?: string;
  /** The page's structural hash at the time, for the binding's context. */
  readonly snapshotHash?: string;
}

/**
 * The role words that read naturally after a noun phrase.
 *
 * "the Sign in link" and "the username field" are what a person writes;
 * "the Sign in generic" is not, so a role that has no word here contributes
 * nothing and the name stands alone.
 */
const ROLE_NOUN: Record<string, string> = {
  link: "link",
  button: "button",
  textbox: "field",
  searchbox: "field",
  combobox: "select",
  listbox: "select",
  checkbox: "checkbox",
  radio: "radio",
  tab: "tab",
  menuitem: "menu item",
  option: "option",
  heading: "heading",
  img: "image",
  table: "table",
  dialog: "dialog",
  alert: "alert",
  link_button: "button",
};

/** `the Sign in link`, `the username field`, `the booking-result element`. */
export function phraseFor(describe: ElementDescription): string {
  const noun = ROLE_NOUN[describe.role];
  const name = (describe.name ?? "").trim();

  if (name !== "") {
    return noun === undefined ? `the ${name}` : `the ${name} ${noun}`;
  }

  const testId =
    describe.attrs["data-testid"] ?? describe.attrs["data-test"] ?? describe.attrs["data-qa"];
  if (testId !== undefined && testId !== "") {
    return `the ${testId.replace(/[-_]+/g, " ")} ${noun ?? "element"}`;
  }

  const text = describe.text.trim().split(/\s+/).slice(0, 5).join(" ");
  if (text !== "") return noun === undefined ? `the ${text}` : `the ${text} ${noun}`;

  // Nothing to call it by. The index keeps two of them apart, and the reviewer
  // is going to rename it anyway — which is what a proposal is for.
  return `the ${describe.tag} ${describe.index + 1}`;
}

/** A capture name for a `read`: `usernameFieldValue`, from the phrase and kind. */
export function captureNameFor(phrase: string, kind: string): string {
  const words = phrase
    .replace(/^the\s+/i, "")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word !== "");
  const camel = words
    .map((word, index) =>
      index === 0
        ? word.toLowerCase()
        : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
    )
    .join("");
  const suffix = kind === "text" ? "Text" : kind.charAt(0).toUpperCase() + kind.slice(1);
  return camel === "" ? `captured${suffix}` : `${camel}${suffix}`;
}

/** The literal, quoted and escaped, as the grammar wants it. */
function quoted(value: unknown): string {
  return `"${String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * The canonical sentence for one action (LLD §13.4's "map `act` kinds to IR
 * actions", read backwards).
 *
 * One template per action, using the vocabulary's canonical verb rather than
 * whichever synonym the intent happened to use — which is the normalisation the
 * spec asks for, applied where it is meaningful.
 *
 * An action with no template returns `undefined` and its step becomes a
 * `// review:` comment. That is not a gap to be filled in later: `evaluate` and
 * `screenshot` have sentences and no useful *intent-driven* form, and an action
 * a proposal cannot phrase is one a person should write themselves.
 */
export function sentenceForAct(
  action: string,
  args: Record<string, unknown>,
  phrase: string | undefined,
): string | undefined {
  const at = phrase ?? "";
  switch (action) {
    case "click":
      return phrase === undefined ? undefined : `Click ${at}`;
    case "doubleClick":
      return phrase === undefined ? undefined : `Double-click ${at}`;
    case "rightClick":
      return phrase === undefined ? undefined : `Right-click ${at}`;
    case "hover":
      return phrase === undefined ? undefined : `Hover over ${at}`;
    case "type":
      return phrase === undefined ? undefined : `Type ${quoted(args["value"])} into ${at}`;
    case "clear":
      return phrase === undefined ? undefined : `Clear ${at}`;
    case "submit":
      return phrase === undefined ? undefined : `Submit ${at}`;
    case "selectOption":
      return phrase === undefined ? undefined : `Select ${quoted(args["value"])} in ${at}`;
    case "setChecked":
      return phrase === undefined
        ? undefined
        : `${args["checked"] === false ? "Uncheck" : "Check"} ${at}`;
    case "scrollIntoView":
      return phrase === undefined ? undefined : `Scroll ${at} into view`;
    case "scrollToTop":
      return "Scroll to the top of the page";
    case "scrollToBottom":
      return "Scroll to the bottom of the page";
    case "press":
      return `Press the ${quoted(args["key"])} key`;
    case "navigate":
      return args["url"] === undefined ? undefined : `Open ${quoted(args["url"])}`;
    case "back":
      return "Go back";
    case "forward":
      return "Go forward";
    case "refresh":
      return "Refresh the page";
    case "sleep":
      return args["ms"] === undefined
        ? undefined
        : `Wait ${Math.round(Number(args["ms"]) / 1000)} seconds`;
    default:
      return undefined;
  }
}

/** `Remember the value of the username field as usernameFieldValue`. */
export function sentenceForRead(
  kind: string,
  phrase: string | undefined,
  name: string,
): string | undefined {
  if (kind === "url") return undefined;
  if (kind === "title") return undefined;
  if (phrase === undefined) return undefined;
  const noun = kind === "value" ? "value" : kind === "attribute" ? undefined : "text";
  return noun === undefined ? undefined : `Remember the ${noun} of ${phrase} as ${name}`;
}

/** `The sign in button should be visible`, and the page and URL forms. */
export function sentenceForCheck(
  predicate: Record<string, unknown>,
  subject: string,
  phrase: string | undefined,
): string | undefined {
  const kind = String(predicate["kind"] ?? "");
  const negate = predicate["negate"] === true;
  const value = (predicate["value"] as { value?: unknown } | undefined)?.value ?? predicate["value"];

  const STATES = new Set([
    "visible",
    "hidden",
    "enabled",
    "disabled",
    "checked",
    "unchecked",
    "selected",
    "present",
    "absent",
  ]);

  if (subject === "page") {
    if (kind === "title") return `The page title should be ${quoted(value)}`;
    if (kind === "titleContains") return `The page title should contain ${quoted(value)}`;
    if (kind === "url") return `The URL should be ${quoted(value)}`;
    if (kind === "urlContains") return `The URL should contain ${quoted(value)}`;
    return undefined;
  }

  if (phrase === undefined) return undefined;
  const should = negate ? "should not be" : "should be";
  if (STATES.has(kind)) return `${capitalise(phrase)} ${should} ${kind}`;
  if (kind === "text") return `${capitalise(phrase)} should say ${quoted(value)}`;
  if (kind === "textContains") return `${capitalise(phrase)} should contain ${quoted(value)}`;
  if (kind === "value") return `${capitalise(phrase)} should have the value ${quoted(value)}`;
  return undefined;
}

/** `the sign in button` → `The sign in button`, so a sentence starts as one. */
function capitalise(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}

/**
 * Turn one trajectory line into a drafted step.
 *
 * `snapshot` calls are not steps. An agent taking a snapshot is *looking*, and a
 * replay does not need to be told to look — the resolver takes whatever
 * snapshots it needs. Recording them as steps would put a `screenshot` in the
 * flow for every glance the agent took.
 */
/** What a call with no intent is called while it waits for a person (SF-12). */
export const NO_INTENT = "(no intent recorded)";

export function draftFor(line: TrajectoryLine): DraftStep | undefined {
  if (line.call === "snapshot") return undefined;

  const base = {
    /*
     * A call nobody narrated still becomes a step, labelled rather than
     * dropped (Draft 2.25, SF-12). Direct control does not owe the compiler a
     * sentence; what it owes a person is an honest line saying so, which
     * `compile` turns into a `// review:` comment.
     */
    intent: line.intent ?? NO_INTENT,
    seq: [line.seq],
    ...(line.url === undefined ? {} : { url: line.url }),
    ...(line.snapshotHash === undefined ? {} : { snapshotHash: line.snapshotHash }),
    ...(line.describe === undefined
      ? {}
      : { element: { phrase: phraseFor(line.describe), describe: line.describe } }),
  } as const;

  /*
   * A call that threw is a step nobody should replay. It is kept as a comment
   * with the error, because a trajectory records what happened (LLD §13.4) and
   * the thing that went wrong is often the interesting part of an exploration.
   */
  if (line.error !== undefined) {
    return { ...base, why: `the call failed: ${line.error}` };
  }

  const args = (line.args ?? {}) as Record<string, unknown>;
  const phrase = base.element?.phrase;

  if (line.call === "act") {
    const action = String(args["action"] ?? "");
    const actArgs = (args["args"] ?? {}) as Record<string, unknown>;
    const sentence = sentenceForAct(action, actArgs, phrase);
    return sentence === undefined
      ? { ...base, why: `no sentence pattern for act("${action}")` }
      : { ...base, sentence };
  }

  if (line.call === "read") {
    const kind = String(args["kind"] ?? "text");
    const name = captureNameFor(phrase ?? "captured", kind);
    const sentence = sentenceForRead(kind, phrase, name);
    return sentence === undefined
      ? { ...base, why: `no sentence pattern for read("${kind}")` }
      : { ...base, sentence };
  }

  const predicate = (args["predicate"] ?? {}) as Record<string, unknown>;
  const sentence = sentenceForCheck(predicate, String(args["subject"] ?? "ref"), phrase);
  return sentence === undefined
    ? { ...base, why: `no sentence pattern for check(${String(predicate["kind"] ?? "?")})` }
    : { ...base, sentence };
}
