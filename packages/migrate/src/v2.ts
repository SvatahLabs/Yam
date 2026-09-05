/**
 * Reading a v1 / v2 flow (REQ-LANG-11, LLD §11 of Draft 1).
 *
 * The old syntax marked every part of a sentence with a sigil, and this pulls
 * those parts back out:
 *
 * ```
 * user +types+ the ~username~ as *connected2atul@gmail.com*
 *      \_____/     \________/    \_______________________/
 *       action      locator            data
 * ```
 *
 * What is left over after the sigils are removed is *prose*, and the prose is
 * the most useful thing in the line: `+click+ on the next button defined by
 * ~xpath://button~ to go to date page` says "the next button", which is the
 * phrase a v3 target wants. The locator is thrown away — that is the point of
 * v3 — but it is kept here so the review report can say what was discarded and
 * the seed bindings can be matched up.
 */

/** A locator, as v2 wrote it: `xpath://button`, `link text : Sign In`. */
export interface LegacyLocator {
  /** `xpath`, `id`, `css selector`, `linkText`, … as written. */
  readonly by: string;
  readonly value: string;
  /** The whole thing, for the report. */
  readonly raw: string;
}

export interface LegacyStep {
  /** 1-based line in the source file. */
  readonly line: number;
  readonly raw: string;
  /** The text between `+`s, lower-cased and collapsed. */
  readonly action?: string;
  /** Every `~…~`, in order. */
  readonly locators: readonly LegacyLocator[];
  /** Every `*…*`, in order. */
  readonly data: readonly string[];
  /** `var : name` or `var(type) : name`. */
  readonly capture?: string;
  /** Everything that was not a sigil, collapsed. */
  readonly prose: string;
  /** True when the line was commented out in the original. */
  readonly commented: boolean;
}

export interface LegacyBlock {
  readonly kind: "story" | "scenario" | "compose" | "test";
  readonly name: string;
  readonly line: number;
  /** For `compose`: the names it lists. For a story: its steps. */
  readonly steps: readonly LegacyStep[];
  readonly names: readonly string[];
}

export interface LegacyFlow {
  readonly file: string;
  readonly blocks: readonly LegacyBlock[];
}

const HEADER = /^(story|scenario|compose|test)\s*(?:\([^)]*\))?\s*:\s*(.*)$/i;
const ACTION = /\+([^+]+)\+/;
const LOCATOR = /~([^~]*)~/g;
const DATA = /\*([^*]*)\*/g;
const CAPTURE = /\bvar\s*(?:\([^)]*\))?\s*:\s*([A-Za-z_][A-Za-z0-9_]*)/;

/** `xpath://button`, `link text : Sign In`, `css selector : #a` → by + value. */
export function parseLocator(raw: string): LegacyLocator {
  const text = raw.trim();
  const at = text.indexOf(":");
  if (at < 0) return { by: "phrase", value: text, raw: text };
  return { by: text.slice(0, at).trim(), value: text.slice(at + 1).trim(), raw: text };
}

/** Read a v1/v2 flow file. */
export function readLegacyFlow(text: string, file: string): LegacyFlow {
  const blocks: LegacyBlock[] = [];
  let current: { kind: LegacyBlock["kind"]; name: string; line: number; steps: LegacyStep[]; names: string[] } | undefined;

  const finish = (): void => {
    if (current !== undefined) blocks.push({ ...current });
    current = undefined;
  };

  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (line === "") {
      finish();
      return;
    }

    const header = HEADER.exec(line);
    if (header !== null) {
      finish();
      current = {
        kind: header[1]!.toLowerCase() as LegacyBlock["kind"],
        name: header[2]!.trim().replace(/\s+/g, " "),
        line: index + 1,
        steps: [],
        names: [],
      };
      return;
    }

    if (current === undefined) return;

    if (current.kind === "compose") {
      current.names.push(line);
      return;
    }
    if (current.kind === "test") return;

    current.steps.push(parseLegacyStep(line, index + 1));
  });

  finish();
  return { file, blocks };
}

/** One legacy line, taken apart. */
export function parseLegacyStep(raw: string, line: number): LegacyStep {
  const commented = raw.startsWith("//") || raw.startsWith("#");
  const body = commented ? raw.replace(/^(\/\/|#)\s*/, "") : raw;

  const action = ACTION.exec(body)?.[1]?.trim().toLowerCase().replace(/\s+/g, " ");
  const locators = [...body.matchAll(LOCATOR)].map((m) => parseLocator(m[1] ?? ""));
  const data = [...body.matchAll(DATA)].map((m) => (m[1] ?? "").trim());
  const capture = CAPTURE.exec(body)?.[1];

  const prose = body
    .replace(ACTION, " ")
    .replace(LOCATOR, " ")
    .replace(DATA, " ")
    .replace(CAPTURE, " ")
    .replace(/\s+/g, " ")
    .trim();

  return {
    line,
    raw,
    ...(action === undefined ? {} : { action }),
    locators,
    data,
    ...(capture === undefined ? {} : { capture }),
    prose,
    commented,
  };
}
