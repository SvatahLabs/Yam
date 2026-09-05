/**
 * The target dictionary (REQ-COMP-5, LLD §4.3).
 *
 * A phrase resolves to an element id through the project's dictionary. The
 * bindings store is one of its three sources — the other two, `targets.yaml` and
 * the unbound phrases a compile produces, belong to module (b) — so what lives
 * here is the part module (a) can build on its own: the phrases already recorded
 * against each element.
 *
 * A phrase that resolves to more than one element is ambiguous, and the
 * dictionary says so rather than picking one (`W_AMBIGUOUS_TARGET`).
 */
import { elementIdFromPhrase } from "./ids.js";
import type { BindingsStore } from "./store.js";

export interface Lookup {
  /** The element ids this phrase could mean. Empty when the phrase is unknown. */
  readonly ids: readonly string[];
  readonly status: "bound" | "unbound" | "ambiguous";
}

export class Dictionary {
  /** Normalised phrase → the ids that claim it. */
  private readonly byPhrase = new Map<string, Set<string>>();

  private constructor() {}

  /** Build from a store: every recorded phrase, plus each id's own normal form. */
  static fromStore(store: BindingsStore): Dictionary {
    const dictionary = new Dictionary();
    for (const id of store.ids()) {
      // The id itself is always a way to name the element, so `bind("login.username-field")`
      // works before any phrase has been recorded.
      dictionary.add(id, id);
      for (const phrase of store.phrases(id)) dictionary.add(phrase, id);
    }
    return dictionary;
  }

  /** Record that a phrase can mean an element. */
  add(phrase: string, id: string): void {
    const key = normalise(phrase);
    if (key === "") return;
    const ids = this.byPhrase.get(key) ?? new Set<string>();
    ids.add(id);
    this.byPhrase.set(key, ids);
  }

  /**
   * What a phrase means.
   *
   * Tried in order: the phrase as recorded, then the element id the phrase
   * normalises to (docs/flow-language.md §4). An unknown phrase is `unbound`,
   * which is what the recorder grounds (REQ-COMP-5).
   */
  lookup(phrase: string): Lookup {
    const direct = this.byPhrase.get(normalise(phrase));
    if (direct !== undefined && direct.size > 0) {
      const ids = [...direct].sort();
      return { ids, status: ids.length === 1 ? "bound" : "ambiguous" };
    }

    const derived = elementIdFromPhrase(phrase);
    const byId = this.byPhrase.get(normalise(derived));
    if (byId !== undefined && byId.size > 0) {
      const ids = [...byId].sort();
      return { ids, status: ids.length === 1 ? "bound" : "ambiguous" };
    }

    return { ids: [], status: "unbound" };
  }

  /**
   * Every phrase the dictionary knows, in its normalised form, sorted.
   *
   * Normalised rather than as written, because that is the key a lookup uses:
   * listing the raw phrases would show two entries where a lookup sees one.
   */
  phrases(): string[] {
    return [...this.byPhrase.keys()].sort();
  }

  /** Every phrase that means more than one element (`W_AMBIGUOUS_TARGET`). */
  ambiguous(): Array<{ phrase: string; ids: string[] }> {
    const out: Array<{ phrase: string; ids: string[] }> = [];
    for (const [phrase, ids] of this.byPhrase) {
      if (ids.size > 1) out.push({ phrase, ids: [...ids].sort() });
    }
    return out.sort((a, b) => (a.phrase < b.phrase ? -1 : 1));
  }
}

/** Case, articles and punctuation do not distinguish two phrases. */
function normalise(phrase: string): string {
  return phrase
    .trim()
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/[^a-z0-9.]+/g, " ")
    .trim();
}
