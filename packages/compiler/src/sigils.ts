/**
 * Rejecting v1 and v2 syntax (REQ-LANG-4, `docs/flow-language.md` §8).
 *
 * "A step is one plain-language sentence with no sigils, locator strings, or
 * locator-type prefixes; any such pattern is a compile error pointing at
 * `migrate`."
 *
 * This runs *before* the grammar, and that ordering is the whole point. A v2
 * sentence would otherwise fail to parse and be reported as "no pattern matched
 * this sentence" — technically true, and useless. Someone with a directory of v2
 * flows needs to be told that the file is v2 and that `yam migrate` converts
 * it, in one message, on the first line that shows it.
 *
 * Each form is matched separately so the message can name the form and show what
 * it becomes.
 */
import { diagnostic, type Diagnostic } from "@svatah/yam-spec";

interface Form {
  readonly name: string;
  readonly pattern: RegExp;
  readonly becomes: string;
}

/**
 * The retired forms, from the migration table.
 *
 * Order matters only for which one is reported first when a sentence carries
 * several, and a v2 sentence usually carries several.
 */
export const RETIRED_FORMS: readonly Form[] = [
  {
    name: "the +action+ sigil",
    pattern: /\+[a-zA-Z][a-zA-Z ]*\+/,
    becomes: "a plain verb: `+clicks+ the ~button~` is `Click the button`",
  },
  {
    name: "the ~locator~ sigil",
    pattern: /~[^~\n]+~/,
    becomes: "a target phrase with no locator: `~id:username~` is `the username field`",
  },
  {
    name: "the *data* sigil",
    pattern: /\*[^*\n]+\*/,
    becomes: 'a quoted literal or a reference: `*qwerty*` is `"qwerty"`',
  },
  {
    name: "the $[key:value]$ sigil",
    pattern: /\$\[[^\]\n]*\]\$/,
    becomes: "run data in `data.yaml`, read as `{data.key}`",
  },
  {
    name: "a #var# reference",
    pattern: /#[A-Za-z_][A-Za-z0-9_. ]*#/,
    becomes: "braces: `#enterprise#` is `{enterprise}`, `#Story.var#` is `{Story.var}`",
  },
  {
    name: "a $key data reference",
    pattern: /(^|\s)\$[A-Za-z_][A-Za-z0-9_]*/,
    becomes: "`{data.key}`",
  },
  {
    name: "a `var : name` capture",
    pattern: /\bvar\s*(\([^)]*\))?\s*:\s*[A-Za-z_]/,
    becomes: "`… as name`, or `Remember the text of the heading as name`",
  },
  {
    name: "an inline locator",
    pattern: /\b(?:using|with|by|via)\s+(?:xpath|css|id|name|className|linkText|partialLinkText|tagName)\s*:/i,
    becomes: "nothing: the locator is recorded into the bindings store, not written in the flow",
  },
  {
    name: "a bare locator prefix",
    pattern: /(^|\s)(?:xpath|css|linkText|partialLinkText|tagName)\s*:\s*\S/i,
    becomes: "a target phrase; the locator belongs in the bindings store",
  },
];

/**
 * The first retired form in a sentence, as a diagnostic.
 *
 * One diagnostic per sentence rather than one per form: a v2 line carries three
 * or four of them and reporting each would bury the one thing the reader needs
 * to do, which is run `migrate`.
 */
export function checkSigils(
  text: string,
  where: { file: string; line: number },
): Diagnostic | undefined {
  for (const form of RETIRED_FORMS) {
    if (!form.pattern.test(text)) continue;
    return diagnostic(
      "E_SIGIL",
      `This step uses ${form.name}, which v3 does not have. It becomes ${form.becomes}. ` +
        "Run `yam migrate <src> <dest>` to convert v1 and v2 flows.",
      { ...where, source: text },
    );
  }
  return undefined;
}
