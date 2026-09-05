/**
 * `.locator` and `.properties` files as a seed bindings store (REQ-LANG-11).
 *
 * ```
 * login button = xpath://input[@value='Sign In'] & link text : Sign In & css selector : input.btn
 * ```
 *
 * Each `&`-separated alternative becomes one candidate, **in the order it was
 * written**, because that order is the only signal the old file carries about
 * which locator its author trusted. The count is preserved exactly, which is
 * what T2.9's "candidate counts equal `&` alternatives" checks: a migration that
 * quietly dropped one would be a migration that lost a fallback.
 *
 * The entries are `verified: false`. Nothing has been resolved against a live
 * page — these are what the *old* tool believed, carried across so a first run
 * has something to try, and the recorder replaces them (REQ-REC-1).
 */
import { elementId } from "@svatah/spec";
import type { BindingEntry, BindingFile, Candidate } from "@svatah/schema";
import { SCHEMA_VERSION } from "@svatah/schema";

/** How a legacy `by:` maps onto a v3 candidate kind (LLD §3.3). */
const KINDS: Record<string, Candidate["by"]> = {
  id: "id",
  name: "name",
  xpath: "xpath",
  css: "css",
  "css selector": "css",
  cssselector: "css",
  "link text": "text",
  linktext: "text",
  link: "text",
  "partial link text": "text",
  partiallinktext: "text",
  "tag name": "css",
  tagname: "css",
  classname: "css",
  "class name": "css",
};

/**
 * The score a migrated candidate carries.
 *
 * Position, not kind. Synthesis scores by *how much has to change to break a
 * candidate* (REQ-REC-3), and a migrated locator has no evidence behind it — it
 * is what someone wrote once. Scoring it as though it had been synthesised would
 * make an old xpath outrank a freshly recorded test id.
 */
function scoreFor(index: number): number {
  return Math.max(0.1, 0.5 - index * 0.05);
}

export interface MigratedLocator {
  readonly id: string;
  readonly phrase: string;
  readonly candidates: readonly Candidate[];
  /** Alternatives the file listed that could not be mapped. */
  readonly unmapped: readonly string[];
}

/** Parse one `name = a & b & c` line. */
export function parseLocatorLine(line: string): MigratedLocator | undefined {
  const at = line.indexOf("=");
  if (at < 0) return undefined;

  const phrase = line.slice(0, at).trim().replace(/[_]+/g, " ").replace(/\s+/g, " ");
  if (phrase === "") return undefined;

  const candidates: Candidate[] = [];
  const unmapped: string[] = [];

  const alternatives = line
    .slice(at + 1)
    .split("&")
    .map((part) => part.trim())
    .filter((part) => part !== "");

  alternatives.forEach((alternative, index) => {
    const colon = alternative.indexOf(":");
    if (colon < 0) {
      unmapped.push(alternative);
      return;
    }
    const by = alternative.slice(0, colon).trim().toLowerCase();
    const value = alternative.slice(colon + 1).trim();
    const kind = KINDS[by];
    if (kind === undefined || value === "") {
      unmapped.push(alternative);
      return;
    }
    candidates.push({ by: kind, value, score: scoreFor(index) });
  });

  return { id: elementId(phrase), phrase: `the ${phrase}`, candidates, unmapped };
}

/** Parse a whole `.locator` / `.properties` file. */
export function parseLocatorFile(text: string): MigratedLocator[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#") && !line.startsWith("//"))
    .map(parseLocatorLine)
    .filter((one): one is MigratedLocator => one !== undefined);
}

/** One migrated locator as a `BindingFile` (LLD §3.3). */
export function seedBinding(locator: MigratedLocator, at: string): BindingFile {
  const entry: BindingEntry = {
    context: { pattern: "/", hash: "0".repeat(64), platform: "web" },
    candidates: [...locator.candidates],
    fingerprint: {
      tag: "",
      attrs: {},
      text: "",
      neighbours: { before: [], after: [] },
      rolePath: [],
      box: [0, 0, 0, 0],
      index: 0,
    },
    recordedAt: at,
    provenance: {
      model: "migrate",
      promptVersion: "v2-locator-file",
      at,
      tokensIn: 0,
      tokensOut: 0,
    },
    // Nothing has been resolved against a live page: these are what the old tool
    // believed, not what this one has seen (REQ-REC-1).
    verified: false,
  };

  return {
    schemaVersion: SCHEMA_VERSION,
    id: locator.id,
    phrases: [locator.phrase],
    entries: [entry],
  };
}
