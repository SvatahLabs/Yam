/**
 * Rewriting one legacy step as a v3 sentence (REQ-LANG-11).
 *
 * ## What can be derived, and what cannot
 *
 * Three of the four parts of a legacy line carry across mechanically:
 *
 * * the **action** — `+clicks+` is `click`, through the ported vocabulary
 *   (`@svatah/spec`'s `VOCABULARY`, which is `ActionSynonyms.java` verb for
 *   verb), so no mapping is invented here;
 * * the **data** — `*qwerty123*` becomes `"qwerty123"`, and `*#var#*` becomes
 *   `{var}`;
 * * the **capture** — `var : enterprise` becomes `… as enterprise`.
 *
 * The fourth, the **target phrase**, is where a migration stops being mechanical.
 * `~xpath://li[4]/a/p~` says nothing about what the element *is*. Sometimes the
 * prose beside it does — "on the Schedule Build using ~xpath://li[4]/a/p~" — and
 * that is what is used. When it does not, the phrase is derived from the locator
 * itself (`~id:username~` → "the username field") and the step is flagged in the
 * review report, because that is a name a person has to look at.
 *
 * This is why migration output is *reviewed*, not trusted: REQ-LANG-11 asks for
 * a converter, and the report is what tells the reviewer where to look.
 */
import { VERBS, elementId, type Verb } from "@svatah/spec";
import type { LegacyLocator, LegacyStep } from "./v2.js";

export interface RewriteResult {
  /** The v3 sentence, or nothing when the step could not be rewritten. */
  readonly sentence?: string;
  /** Element ids the sentence's targets resolve to, for the seed bindings. */
  readonly targets: readonly { id: string; phrase: string; locators: readonly LegacyLocator[] }[];
  /** Why a reviewer should look at this step. */
  readonly notes: readonly string[];
}

/**
 * Turning the leftover prose into a target phrase.
 *
 * The pipeline is ordered, and the order is the whole of it. A legacy line puts
 * the subject first, the element in the middle, and a locator and a purpose at
 * the end:
 *
 * ```
 * user +clicks+ on the login button using ~xpath://input[@value='Sign In']~
 * \__/          \_/ \______________/ \___/
 * subject        prep    the element   locator connector
 *
 * +click+ on the next button defined by ~xpath://button~ to go to date page
 *                                                        \__________________/
 *                                                              purpose
 * ```
 *
 * Each stage removes one of those, and each is anchored (`^` or `$`) so that a
 * word appearing legitimately inside a name — "the sign in button" contains
 * "in" — is not mistaken for a connector.
 */

/** "user", "she", "then she", … — who is doing it, which v3 does not say. */
const SUBJECT = /^(?:user|she|he|and|then|user then|then she|she then|user's)\b\s*/i;

/** What introduces a locator. Everything from here on described *how*, not *what*. */
const LOCATOR_CONNECTOR =
  /\s+\b(?:using|via|defined\s+by|identified\s+by(?:\s+the\s+locator)?|located\s+by|with\s+the\s+locator|in\s+the\s+locator\s+identified\s+by|in\s+the\s+element\s+identified\s+by(?:\s+the\s+locator)?)\b.*$/i;

/** A trailing purpose clause: "to go to date page", "to select the end date". */
const PURPOSE = /\s+\bto\s+(?:go|open|select|choose|check\s?out|log\s?out|see|view|reach)\b.*$/i;

/** A trailing page reference: "on the home page", "on the Schedule Build Page". */
const PAGE = /(?:^|\s+)\bon\s+the\s+.*\bpage\b\s*$/i;

/**
 * A connector left dangling where a sigil used to be.
 *
 * `+types+ the ~username~ as *x*` leaves "the as": the word that introduced the
 * data is still there, and the data is not.
 */
const DANGLING = /(?:^|\s+)\b(?:as|with|for|in|into|of|to|and|enter|is)\b\s*$/i;

/** A leading preposition left once the subject is gone, with or without a tail. */
const PREPOSITION = /^(?:on|in|of|for|to|from|at|onto|into)(?:\s+|$)/i;

/**
 * A phrase that still has a preposition inside it, which usually means the
 * sigils left a seam: "the username in field" was "the username *…* in field".
 * Reported rather than repaired — see `phraseFor`.
 */
export function hasInteriorPreposition(phrase: string): boolean {
  return /\S\s+\b(?:in|on|as|of|into|with|for)\b\s+\S/i.test(phrase.replace(/^the\s+/i, ""));
}

/** A leading article, so exactly one "the" is put back. */
const ARTICLE = /^(?:the|a|an)\s+/i;

/** Words that are the *action*, not the element; the sigil already took them. */
const RESIDUAL_VERB =
  /^(?:clicks?|types?|enters?|selects?|waits?(?:\s+for)?|moves?(?:\s+to)?|saves?(?:\s+text)?|validates?(?:\s+text)?|verif(?:y|ies)|checks?)\b\s*/i;

/**
 * A phrase for an element, from the prose beside it or from the locator.
 *
 * The prose wins every time it says anything, because it is what a person wrote
 * about the element and the locator is what a tool wrote about the page.
 */
export function phraseFor(
  prose: string,
  locator: LegacyLocator | undefined,
): { phrase: string; derived: boolean } {
  let text = prose.replace(/\s+/g, " ").trim();

  text = text.replace(SUBJECT, "");
  text = text.replace(LOCATOR_CONNECTOR, "");
  text = text.replace(PURPOSE, "");
  text = text.replace(PAGE, "");
  text = text.replace(RESIDUAL_VERB, "");
  // Repeatedly, because a line can leave two: "the username as in".
  for (let i = 0; i < 3 && DANGLING.test(text); i += 1) text = text.replace(DANGLING, "");
  text = text.replace(PREPOSITION, "");
  text = text.replace(ARTICLE, "");
  text = text.replace(/[.,;:]+$/, "").replace(/\s+/g, " ").trim();

  /*
   * A phrase that ends "… in the X" is naming X. `+type+ the partial starting
   * point as *indra* in the search bar` leaves "partial starting point as in the
   * search bar", where the element is the search bar and the rest describes the
   * value. Only taken when the tail is more than one word, because "the username
   * in field" leaves "field", which names less than what it replaced.
   */
  const tail = /\b(?:into|in|on)\s+the\s+(.+)$/i.exec(text);
  if (tail !== null && tail[1]!.trim().split(/\s+/).length >= 2) text = tail[1]!.trim();

  /*
   * There is no rule here that removes an interior preposition.
   *
   * "the username in field" would read better as "the username field", and
   * "the sign in button" must not become "the sign button". Both are
   * `<word> in <element noun>` and nothing in the text tells them apart, so the
   * choice is between leaving one slightly clumsy and making the other wrong.
   * Clumsy wins, and `hasInteriorPreposition` flags it for the reviewer, who can
   * see the page.
   */

  // "element", "locator" and their friends name nothing: the original said
  // "the element defined by ~xpath://div[3]~", which is the locator talking. A
  // bare article is the same case with the noun already gone.
  if (/^(?:element|locator|field|box|button|link|the|a|an)?$/i.test(text)) text = "";

  if (text !== "" && /[a-z]/i.test(text)) {
    return { phrase: `the ${text}`, derived: false };
  }

  if (locator === undefined) return { phrase: "the element", derived: true };

  /*
   * Nothing usable in the prose, so the phrase comes from the locator — and is
   * flagged. `id:username` gives a name a person would recognise;
   * `xpath://li[4]/a/p` gives one nobody would, and the report says so.
   */
  const value = locator.value;
  if (/^(?:id|name|linktext|link text|link|partiallinktext|partial link text)$/i.test(locator.by)) {
    return { phrase: `the ${humanise(value)}`, derived: true };
  }

  const readable = /([A-Za-z][A-Za-z0-9 _-]{2,})/.exec(value.replace(/[^A-Za-z0-9 _-]+/g, " "));
  return { phrase: `the ${humanise(readable?.[1] ?? "element")}`, derived: true };
}

/** `sign-in_button` → `sign in button`. */
function humanise(value: string): string {
  return value.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
}

/** A `*…*` value as a v3 value: a quoted literal or a `{…}` reference. */
export function valueFor(raw: string): string {
  const text = raw.trim();
  // `#var#`, and the malformed `#var` the legacy files also contain.
  const variable = /^#([A-Za-z_][A-Za-z0-9_. ]*)#?$/.exec(text);
  if (variable !== null) return `{${variable[1]!.trim()}}`;
  const data = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(text);
  if (data !== null) return `{data.${data[1]!}}`;
  return `"${text.replace(/"/g, '\\"')}"`;
}

/** The v3 verb a legacy action means, through the ported vocabulary. */
export function verbFor(action: string | undefined): Verb | undefined {
  if (action === undefined) return undefined;
  return VERBS.verbFor(action) ?? VERBS.match(action)?.verb;
}

/**
 * A v1 "natural language" line, which has no sigils at all.
 *
 * ```
 * Click the login button with xpath://input[@value='Sign In']
 * Verify the Schedule Build page appears
 * ```
 *
 * These are already prose. The migration is to find the verb, drop the trailing
 * inline locator (REQ-LANG-4 forbids it), and quote the value — not to invent
 * anything. `Verify … appears` is handled by name because it is the one v1 form
 * with no verb the vocabulary knows.
 */
function rewriteNaturalLanguage(step: LegacyStep): RewriteResult | undefined {
  // The inline locator suffix: `with xpath:…`, `using id:…`.
  const INLINE = /\s+\b(?:with|using|by|via)\s+(?:xpath|css|cssSelector|id|name|className|linkText|partialLinkText|tagName)\s*:\s*\S.*$/i;
  const text = step.raw.trim().replace(INLINE, "").replace(/\s+/g, " ");
  if (text === "") return undefined;

  const dropped = INLINE.test(step.raw.trim());
  const notes: string[] = dropped
    ? ["The inline locator was removed; it belongs in the bindings store, not in the flow (REQ-LANG-4)."]
    : [];

  // `Verify <phrase> appears` / `<phrase> appears`.
  const appears = /^(?:verify|check|validate)?\s*(.+?)\s+appears?\s*$/i.exec(text);
  if (appears !== null && /^(?:verify|check|validate)/i.test(text)) {
    const phrase = appears[1]!.replace(/^the\s+/i, "").replace(/\s+page$/i, "");
    return {
      sentence: `The ${phrase} should be visible`,
      targets: [{ id: elementId(phrase), phrase: `the ${phrase}`, locators: [] }],
      notes: [
        ...notes,
        `"${text}" became an expectation on "the ${phrase}". The original asserted a *page*; ` +
          "name the element that proves the page is there.",
      ],
    };
  }

  const found = VERBS.find(text);
  if (found === undefined) return undefined;

  const verb = found.verb;
  const rest = found.rest.trim();

  if (verb.action === "type") {
    // `Type <value> into <target>` — v1 wrote the value unquoted.
    const split = /^(.*?)\s+\b(?:into|in)\b\s+(.+)$/i.exec(rest);
    if (split === null) return undefined;
    const phrase = split[2]!.replace(/^the\s+/i, "");
    return {
      sentence: `Type "${split[1]!.trim()}" into the ${phrase}`,
      targets: [{ id: elementId(phrase), phrase: `the ${phrase}`, locators: step.locators }],
      notes,
    };
  }

  const phrase = rest
    .replace(PAGE, "")
    .replace(/^(?:on|the|to)\s+/i, "")
    .replace(/^the\s+/i, "")
    .trim();
  const sentence = sentenceFor(
    verb,
    { ...step, prose: "", data: [] },
    phrase === "" ? "the element" : `the ${phrase}`,
    notes,
  );
  if (sentence === undefined) return undefined;

  return {
    sentence,
    targets:
      phrase === ""
        ? []
        : [{ id: elementId(phrase), phrase: `the ${phrase}`, locators: step.locators }],
    notes,
  };
}

/** Rewrite one step. */
export function rewriteStep(step: LegacyStep): RewriteResult {
  const notes: string[] = [];
  const verb = verbFor(step.action);

  if (verb === undefined) {
    // No `+action+` at all: a v1 "natural language" flow, which is prose already.
    const natural = step.action === undefined ? rewriteNaturalLanguage(step) : undefined;
    if (natural !== undefined) return natural;

    return {
      targets: [],
      notes: [
        step.action === undefined
          ? "No `+action+` and no sentence the vocabulary recognises; write this step by hand."
          : `No v3 action for "+${step.action}+".`,
      ],
    };
  }

  const locator = step.locators[0];
  const { phrase, derived } = phraseFor(step.prose, locator);
  if (derived && locator !== undefined) {
    notes.push(
      `The target phrase "${phrase}" was derived from the locator \`${locator.raw}\`, ` +
        "because the original said nothing about what the element is. Rename it.",
    );
  } else if (hasInteriorPreposition(phrase)) {
    notes.push(
      `The target phrase "${phrase}" has a preposition inside it, which usually means the ` +
        "sigils left a seam — the original wrote the value between the two halves of the name. " +
        "It is left as it stands because removing it would turn \"the sign in button\" into " +
        "\"the sign button\"; read the page and rename it.",
    );
  }

  const targets =
    needsTarget(verb) && locator !== undefined
      ? [{ id: elementId(phrase), phrase, locators: step.locators }]
      : [];

  const sentence = sentenceFor(verb, step, phrase, notes);
  if (sentence === undefined) {
    notes.push(`"+${step.action!}+" has no sentence form yet; the step needs writing by hand.`);
    return { targets, notes };
  }

  for (const extra of step.locators.slice(1)) {
    notes.push(`A second locator, \`${extra.raw}\`, was dropped: a v3 step names one target.`);
  }

  return { sentence, targets, notes };
}

/** Whether the action addresses an element. */
function needsTarget(verb: Verb): boolean {
  return ![
    "navigate",
    "back",
    "forward",
    "refresh",
    "sleep",
    "switchWindow",
    "closeOtherWindows",
    "dialog",
    "api",
    "evaluate",
  ].includes(verb.action);
}

/**
 * The sentence for a verb.
 *
 * One case per v3 pattern, written out rather than assembled from a table: the
 * patterns differ in shape (`Type X into Y`, `Select X in Y`, `The X should …`)
 * and a table that could express all of them would be a second grammar.
 */
function sentenceFor(
  verb: Verb,
  step: LegacyStep,
  phrase: string,
  notes: string[],
): string | undefined {
  const value = step.data[0] === undefined ? undefined : valueFor(step.data[0]);

  switch (verb.action) {
    case "click":
      return `Click ${phrase}`;
    case "doubleClick":
      return `Double-click ${phrase}`;
    case "rightClick":
      return `Right-click ${phrase}`;
    case "hover":
      return `Hover over ${phrase}`;
    case "hoverAndClick":
      return `Move to ${phrase} and click it`;
    case "pressAndHold":
      return `Press and hold ${phrase}`;
    case "release":
      return `Release ${phrase}`;
    case "clear":
      return `Clear ${phrase}`;
    case "submit":
      return `Submit ${phrase}`;
    case "scrollIntoView":
      return `Scroll to ${phrase}`;
    case "scrollToTop":
      return "Scroll to the top of the page";
    case "scrollToBottom":
      return "Scroll to the bottom of the page";
    case "back":
      return "Go back";
    case "forward":
      return "Go forward";
    case "refresh":
      return "Refresh the page";

    case "type":
      if (value === undefined) {
        notes.push("A type step with no value; the original had no `*data*`.");
        return undefined;
      }
      return `Type ${value} into ${phrase}`;

    case "navigate":
      return `Open ${value ?? '"/"'}`;

    case "sleep": {
      const seconds = Number(step.data[0] ?? "1");
      return `Wait ${Number.isFinite(seconds) ? seconds : 1} seconds`;
    }

    case "waitFor":
      return `Wait for ${phrase} to be ${verb.args?.["until"] === "visible" ? "visible" : "present"}`;

    case "switchWindow":
      return verb.args?.["to"] === "main" ? "Switch back to the main tab" : "Switch to the new tab";

    case "closeOtherWindows":
      return "Close the other tabs";

    case "switchFrame":
      return `Switch to the ${phrase.replace(/^the /, "")} frame`;

    case "selectOption":
      if (value === undefined) return undefined;
      return `Select ${value} in ${phrase}`;
    case "deselectOption":
      if (value === undefined) return undefined;
      return `Deselect ${value} in ${phrase}`;
    case "deselectAll":
      return `Deselect everything in ${phrase}`;

    case "dialog":
      return verb.args?.["action"] === "accept" ? "Accept the dialog" : "Dismiss the dialog";

    case "read": {
      const name = step.capture;
      if (name === undefined) {
        notes.push("A read step with no `var : name`, so there is nothing to remember it as.");
        return undefined;
      }
      return `Remember the text of ${phrase} as ${name}`;
    }

    case "api": {
      const name = step.locators[0]?.raw ?? step.prose.replace(/^api\s*/i, "").trim();
      const remembered = step.capture;
      const call = `Call the "${name}" API`;
      return remembered === undefined
        ? call
        : `${call} and remember the response as ${remembered}`;
    }

    case "expect":
      return expectationFor(verb, phrase, value, notes);

    case "evaluate":
      return value === undefined ? undefined : `Run the script ${value}`;

    case "keyDown":
      return value === undefined ? undefined : `Hold down the ${value} key`;
    case "keyUp":
      return value === undefined ? undefined : `Let go of the ${value} key`;

    default:
      return undefined;
  }
}

/** The assertion mapping: a legacy `assert*` / `validate*` verb as a sentence. */
function expectationFor(
  verb: Verb,
  phrase: string,
  value: string | undefined,
  notes: string[],
): string | undefined {
  const subject = verb.subject ?? "target";
  const not = verb.negate === true ? "not " : "";

  switch (verb.predicate) {
    case "visible":
      return `${capitalise(phrase)} should ${not}be visible`;
    case "hidden":
      return `${capitalise(phrase)} should be hidden`;
    case "enabled":
      return `${capitalise(phrase)} should be enabled`;
    case "disabled":
      return `${capitalise(phrase)} should be disabled`;
    case "selected":
      return `${capitalise(phrase)} should ${not}be selected`;
    case "present":
      return subject === "dialog"
        ? "The dialog should be present"
        : `${capitalise(phrase)} should be present`;
    case "absent":
      return subject === "dialog"
        ? "The dialog should be absent"
        : `${capitalise(phrase)} should be absent`;
    case "multiSelect":
      return `${capitalise(phrase)} should ${not}support multiple selection`;
    case "text":
      if (value === undefined) return undefined;
      return `${capitalise(phrase)} should say ${value}`;
    case "textContains":
      if (value === undefined) return undefined;
      return `${capitalise(phrase)} should contain ${value}`;
    case "title":
      if (value === undefined) return undefined;
      return `The page title should be ${value}`;
    case "tag":
      if (value === undefined) return undefined;
      return `${capitalise(phrase)} should be an ${value}`;
    case "attribute":
    case "css":
      notes.push(
        `"${verb.legacy}" needs the attribute or property name, which the original did not ` +
          "separate from its value. Write this step by hand.",
      );
      return undefined;
    default:
      return undefined;
  }
}

function capitalise(phrase: string): string {
  return phrase.charAt(0).toUpperCase() + phrase.slice(1);
}
