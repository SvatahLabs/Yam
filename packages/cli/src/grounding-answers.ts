/**
 * Answers for `yam record --gateway fake` (T3.3, T3.5).
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
 * nothing about a model. `yam record` requires `--gateway fake` to be typed,
 * and the report says which gateway produced it, because "recorded with a model"
 * and "recorded from the eval's answers" are different claims about the same
 * files (REQ-PKG-4).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export interface GroundingCase {
  readonly id: string;
  /** The page a web case is said on. Absent for a desktop one. */
  readonly page?: string;
  /**
   * The window a desktop case is said in (T11.3, LLD §3.3, §13.9).
   *
   * A desktop snapshot is grounded the way a web one is, and what says *which
   * screen* is the window title rather than a URL. `scripts/desktop-grounding-cases.mjs`
   * records them from the real ADE.
   */
  readonly window?: string;
  /** Which ADE screen a desktop case was recorded on. For a reader, not a key. */
  readonly screen?: string;
  readonly variant?: number;
  readonly phrase: string;
  readonly expect: "present" | "absent";
  /** The ground-truth key, for the eval. Not used here. */
  readonly element?: string;
  readonly role?: string;
  readonly name?: string;
  /** Position among same-role nodes, for an element with no accessible name. */
  readonly nth?: number;
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
  /*
   * The cases, plus the phrases the eval cannot score.
   *
   * `fixture-answers.jsonl` holds the fixture phrases whose element carries no
   * ground-truth key — two headings the flows bind, and the WebMCP page's
   * controls (T6.3), which exist to test a *declaration* rather than grounding.
   * The eval never reads it, because a case it cannot check would sit in
   * REQ-REC-10's denominator for ever; recording does, because the fixtures
   * cannot be recorded without a credential otherwise.
   */
  const cases = [
    ...readCases(path),
    ...readCases(unscoredPath(path)),
    /*
     * The desktop set, recorded from the ADE (T11.3), and the phrases the self
     * flows use that a *generated* case cannot cover.
     *
     * The generated phrase for a control comes from its accessible name — "the
     * fixtures button" for the Recent list's first entry, whose name is a
     * directory on one machine, and "the Flows heading" for a toolbar title
     * that is named after whichever screen is open. A flow says "the first
     * recent project" and "the toolbar title", which are what the control *is*
     * rather than what it happens to say. `desktop-answers.jsonl` is those, the
     * same way `fixture-answers.jsonl` is the web's.
     */
    ...readCases(desktopPath(path)),
    ...readCases(desktopAnswersPath(path)),
  ];

  /** page-or-window + phrase → the case. Variant cases are keyed on it too. */
  const byKey = new Map<string, GroundingCase>();
  for (const one of cases) {
    byKey.set(`${one.window ?? one.page}|${one.phrase.toLowerCase()}`, one);
  }

  return {
    size: cases.length,
    cases,
    answer(question: string): GroundingAnswer | undefined {
      const phrase = /^Phrase: (.+)$/m.exec(question)?.[1]?.trim();
      /*
       * `Page:` for a web session, `Window:` for a desktop one (T11.3).
       *
       * A desktop snapshot is grounded the way a web one is, and the thing that
       * says *which screen* is the window title rather than a URL. A window
       * title is a name and not a path, so it is matched as it is — there is
       * nothing in "Yam ADE" to generalise.
       */
      const url = /^Page: (.+)$/m.exec(question)?.[1]?.trim();
      const window = /^Window: (.+)$/m.exec(question)?.[1]?.trim();
      const page = url === undefined ? window : pagePathOf(url);
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
      const ref = refFor(question, found);
      return ref === undefined
        ? undefined
        : { ref, why: `${found.id}: the ${found.role} named "${found.name}"`, confidence: 1 };
    },
  };
}

/** `…/cases.jsonl` → `…/fixture-answers.jsonl`. */
function unscoredPath(casesPath: string | undefined): string {
  const base = casesPath ?? defaultCasesPath();
  return join(dirname(base), "fixture-answers.jsonl");
}

/** `…/cases.jsonl` → `…/desktop-cases.jsonl` (T11.3). */
function desktopPath(casesPath: string | undefined): string {
  const base = casesPath ?? defaultCasesPath();
  return join(dirname(base), "desktop-cases.jsonl");
}

/** `…/cases.jsonl` → `…/desktop-answers.jsonl` (T11.3). */
function desktopAnswersPath(casesPath: string | undefined): string {
  const base = casesPath ?? defaultCasesPath();
  return join(dirname(base), "desktop-answers.jsonl");
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

/**
 * The `[ref=…]` of the snapshot line the case names.
 *
 * By role and accessible name, which is how a rendered snapshot line reads. An
 * element with no name — a nameless select, an option inside a `datalist` — is
 * found by its position among the same role instead, which is the only thing
 * that distinguishes it and is what a person means by "the expiry year select".
 */
function refFor(question: string, found: GroundingCase): string | undefined {
  if (found.role === undefined) return undefined;

  const lines = question.split("\n");
  if (found.name !== undefined) {
    const wanted = `- ${found.role} ${JSON.stringify(found.name)}`;
    for (const line of lines) {
      if (!line.trimStart().startsWith(wanted)) continue;
      const ref = /\[ref=([^\]]+)\]/.exec(line)?.[1];
      if (ref !== undefined) return ref;
    }
    return undefined;
  }

  if (found.nth === undefined) return undefined;
  const sameRole = lines.filter((line) => line.trimStart().startsWith(`- ${found.role}`));
  return /\[ref=([^\]]+)\]/.exec(sameRole[found.nth] ?? "")?.[1];
}
