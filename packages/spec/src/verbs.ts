/**
 * The verb trie (T2.2, LLD §4.3).
 *
 * A sentence starts with a verb phrase and the vocabulary has 200-odd of them,
 * several of which are prefixes of others: `select` and `select by visible
 * text`, `click` and `click and hold`, `scroll to top` and `scroll to top of the
 * page`. Matching has to take the **longest** one, or `select by index` would
 * compile as `select` with a stray "by index" and the step would silently do the
 * wrong thing.
 *
 * A word trie gives that in one pass over the sentence's words, and gives it
 * without the vocabulary having to be ordered by length — which is a thing
 * someone would eventually get wrong when adding a synonym.
 */
import { normaliseWords } from "./normalise.js";
import { VOCABULARY, type Verb } from "./vocabulary.js";

interface Node {
  readonly children: Map<string, Node>;
  /** Set when a synonym ends here. */
  verb?: Verb;
  /** The synonym that ended here, for diagnostics. */
  synonym?: string;
}

function emptyNode(): Node {
  return { children: new Map() };
}

export interface VerbMatch {
  readonly verb: Verb;
  /** The synonym that matched, normalised. */
  readonly synonym: string;
  /** How many words it consumed. */
  readonly words: number;
  /** What follows it in the sentence, trimmed. */
  readonly rest: string;
}

export class VerbTrie {
  private readonly root: Node = emptyNode();
  /** Synonym → the verb that claimed it, so a collision can be reported. */
  private readonly claimed = new Map<string, Verb>();

  constructor(verbs: readonly Verb[] = VOCABULARY) {
    for (const verb of verbs) this.add(verb);
  }

  /**
   * Add a verb's synonyms.
   *
   * Two verbs claiming one synonym is a mistake in the vocabulary, not something
   * to resolve at match time: whichever won would depend on declaration order,
   * and the loser's sentences would compile to the wrong action. It throws,
   * because the vocabulary is code and this is a build-time fault.
   */
  add(verb: Verb): void {
    for (const raw of verb.synonyms) {
      const synonym = normaliseWords(raw);
      const existing = this.claimed.get(synonym);
      if (existing !== undefined && existing !== verb) {
        throw new Error(
          `The synonym "${synonym}" is claimed by both "${existing.legacy}" and "${verb.legacy}". ` +
            "One phrase cannot mean two actions; give one of them a different wording.",
        );
      }
      this.claimed.set(synonym, verb);

      let node = this.root;
      for (const word of synonym.split(" ")) {
        let next = node.children.get(word);
        if (next === undefined) {
          next = emptyNode();
          node.children.set(word, next);
        }
        node = next;
      }
      node.verb = verb;
      node.synonym = synonym;
    }
  }

  /** The longest verb phrase at the start of `text`, or nothing. */
  match(text: string): VerbMatch | undefined {
    const words = normaliseWords(text).split(" ").filter((word) => word !== "");
    let node = this.root;
    let best: { verb: Verb; synonym: string; words: number } | undefined;

    for (let i = 0; i < words.length; i += 1) {
      const next = node.children.get(words[i]!);
      if (next === undefined) break;
      node = next;
      if (node.verb !== undefined) {
        best = { verb: node.verb, synonym: node.synonym!, words: i + 1 };
      }
    }
    if (best === undefined) return undefined;
    return { ...best, rest: words.slice(best.words).join(" ") };
  }

  /**
   * The longest verb phrase anywhere in `text`, with what came before it.
   *
   * The legacy sentences put the subject first — "user +clicks+ the ~sign in
   * button~" — and migrated prose keeps some of that shape, so a verb is not
   * always the first word. The *first* match is taken, not the longest overall:
   * a sentence's verb is the one that governs it, and a later word that happens
   * to also be a verb ("click the save text button") is part of a target phrase.
   */
  find(text: string): (VerbMatch & { before: string }) | undefined {
    const words = normaliseWords(text).split(" ").filter((word) => word !== "");
    for (let start = 0; start < words.length; start += 1) {
      const found = this.match(words.slice(start).join(" "));
      if (found !== undefined) return { ...found, before: words.slice(0, start).join(" ") };
    }
    return undefined;
  }

  /** Every synonym in the trie, sorted. For tests and for `svatah doctor`. */
  synonyms(): string[] {
    return [...this.claimed.keys()].sort();
  }

  /** The verb a synonym means, or nothing. */
  verbFor(synonym: string): Verb | undefined {
    return this.claimed.get(normaliseWords(synonym));
  }
}

/** The vocabulary as one trie, built once. */
export const VERBS = new VerbTrie();
