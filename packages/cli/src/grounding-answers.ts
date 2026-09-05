/**
 * Answers for `svatah record --gateway fake` (T3.3, T3.5).
 *
 * The grounding eval's committed cases (`evals/grounding/cases.jsonl`) say, for
 * one page and one phrase, which element is meant — by role and accessible name,
 * which is how a snapshot line names it. That is enough to answer a grounding
 * question without a model: find the case, find the line, return its reference.
 *
 * ## Why this exists at all
 *
 * The contract has to be green on a clean checkout with no credential. Recording
 * is the one part of the system that needs a model, so without something like
 * this the recorder would be untestable end to end, and "recording `simple.flow`
 * produces verified bindings" would be a claim nobody could check.
 *
 * ## Why it is never the default
 *
 * These answers are a fixture. A store recorded from them is a store whose
 * bindings were chosen by a script that already knew the answers, and it measures
 * nothing about a model. `svatah record` requires `--gateway fake` to be typed,
 * and the report says which gateway produced it, because "recorded with a model"
 * and "recorded from the eval's answers" are different claims about the same
 * files (REQ-PKG-4).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface GroundingCase {
  readonly id: string;
  readonly page: string;
  readonly variant?: number;
  readonly phrase: string;
  readonly expect: "present" | "absent";
  /** The ground-truth key, for the eval. Not used here. */
  readonly element?: string;
  readonly role?: string;
  readonly name?: string;
}

export interface GroundingAnswer {
  readonly ref: string | null;
  readonly why: string;
  readonly confidence: number;
}

export interface GroundingAnswers {
  readonly size: number;
  readonly cases: readonly GroundingCase[];
  /** Answer one rendered `g-1` question, or `undefined` when no case covers it. */
  answer(question: string): GroundingAnswer | undefined;
}

/** Where the cases live, relative to the repository this package is built in. */
export function defaultCasesPath(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "evals", "grounding", "cases.jsonl");
}

export function readCases(path = defaultCasesPath()): GroundingCase[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as GroundingCase);
}

export function groundingAnswers(path?: string): GroundingAnswers {
  const cases = readCases(path);

  /** page + phrase → the case. Variant cases are keyed on the page too. */
  const byKey = new Map<string, GroundingCase>();
  for (const one of cases) byKey.set(`${one.page}|${one.phrase.toLowerCase()}`, one);

  return {
    size: cases.length,
    cases,
    answer(question: string): GroundingAnswer | undefined {
      const phrase = /^Phrase: (.+)$/m.exec(question)?.[1]?.trim();
      const page = pagePathOf(/^Page: (.+)$/m.exec(question)?.[1]?.trim());
      if (phrase === undefined || page === undefined) return undefined;

      const found = byKey.get(`${page}|${phrase.toLowerCase()}`);
      if (found === undefined) return undefined;

      if (found.expect === "absent") {
        return { ref: null, why: `${found.id}: nothing on ${page} is that`, confidence: 1 };
      }

      /*
       * The reference is read out of the snapshot the question carries, not
       * remembered: references are per-snapshot, and a case that hard-coded one
       * would answer with a handle from a page that no longer exists.
       */
      const ref = refFor(question, found.role, found.name);
      return ref === undefined
        ? undefined
        : { ref, why: `${found.id}: the ${found.role} named "${found.name}"`, confidence: 1 };
    },
  };
}

/** `http://127.0.0.1:53321/login?x=1` → `/login`. Ports and queries move. */
function pagePathOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).pathname.replace(/(.)\/+$/, "$1");
  } catch {
    return url;
  }
}

/** The `[ref=…]` of the snapshot line naming that role and accessible name. */
function refFor(
  question: string,
  role: string | undefined,
  name: string | undefined,
): string | undefined {
  if (role === undefined || name === undefined) return undefined;
  const wanted = `- ${role} ${JSON.stringify(name)}`;
  for (const line of question.split("\n")) {
    if (!line.trimStart().startsWith(wanted)) continue;
    const ref = /\[ref=([^\]]+)\]/.exec(line)?.[1];
    if (ref !== undefined) return ref;
  }
  return undefined;
}
