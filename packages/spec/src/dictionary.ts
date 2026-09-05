/**
 * The target dictionary (REQ-COMP-5, LLD §4.3, `docs/flow-language.md` §4).
 *
 * A target is a noun phrase — *the username field* — carrying no locator. It
 * resolves to an element id, and the element id is what the bindings store is
 * keyed on. Three things feed the dictionary:
 *
 * * **The bindings store.** Every binding already knows the phrases it was
 *   recorded for; those are the authoritative entries, because a phrase that
 *   resolved to a real element once is a phrase that means that element.
 * * **`targets.yaml`.** A project may name ids and their phrases by hand, which
 *   is how you say "the login button" and "the sign in button" are one control
 *   before either has been recorded.
 * * **Phrases the compiler meets and cannot place.** Those become `unbound`
 *   entries with an id derived from the phrase, and the recorder grounds them
 *   (REQ-REC-1). Adding them to the dictionary as they are seen is what makes
 *   the *same* phrase in two steps produce the *same* id, and therefore one
 *   binding rather than two.
 *
 * The dictionary does not import the bindings store: `@svatah/spec` is module
 * (b) and the store is module (a) (LLD §1). It takes ids and phrases as data,
 * which also means the service and the ADE can build one from anything.
 */
import { elementId, phraseKey } from "./normalise.js";
import { diagnostic, type Diagnostic } from "./diagnostics.js";

export type TargetStatus = "bound" | "unbound" | "ambiguous";

export interface TargetResolution {
  readonly id: string;
  readonly status: TargetStatus;
  /** Every id the phrase could mean, when it means more than one. */
  readonly candidates?: readonly string[];
}

export interface DictionaryEntry {
  readonly id: string;
  readonly phrases: readonly string[];
  /** Where the entry came from, for `svatah bindings list` and diagnostics. */
  readonly source: "bindings" | "targets" | "inferred";
}

export class TargetDictionary {
  /** Element id → entry. */
  private readonly entries = new Map<string, { phrases: Set<string>; source: DictionaryEntry["source"] }>();
  /** Normalised phrase → the ids that claim it. */
  private readonly byPhrase = new Map<string, Set<string>>();

  /**
   * Declare that `phrase` names `id`.
   *
   * A phrase claimed by two ids is not resolved here: it is reported when it is
   * *used*, because an unused ambiguity is not a problem anyone has.
   */
  add(id: string, phrase: string, source: DictionaryEntry["source"] = "targets"): void {
    const key = phraseKey(phrase);
    if (key === "") return;

    const entry = this.entries.get(id) ?? { phrases: new Set<string>(), source };
    entry.phrases.add(phrase.trim());
    // A hand-written or recorded entry outranks an inferred one, so a phrase
    // first met unbound and later recorded stops reading as inferred.
    if (source !== "inferred") entry.source = source;
    this.entries.set(id, entry);

    const ids = this.byPhrase.get(key) ?? new Set<string>();
    ids.add(id);
    this.byPhrase.set(key, ids);
  }

  /** Bindings: each id with the phrases it was recorded for. */
  addBindings(bindings: ReadonlyArray<{ id: string; phrases: readonly string[] }>): void {
    for (const binding of bindings) {
      // A binding with no phrase still exists; it is addressable by id alone,
      // which is what `bind("login.username-field")` does (LLD §6.5).
      if (binding.phrases.length === 0) {
        if (!this.entries.has(binding.id)) {
          this.entries.set(binding.id, { phrases: new Set(), source: "bindings" });
        }
        continue;
      }
      for (const phrase of binding.phrases) this.add(binding.id, phrase, "bindings");
    }
  }

  /** `targets.yaml`: id → phrases. */
  addTargets(targets: Readonly<Record<string, readonly string[]>>): void {
    for (const [id, phrases] of Object.entries(targets)) {
      if (phrases.length === 0) {
        if (!this.entries.has(id)) this.entries.set(id, { phrases: new Set(), source: "targets" });
        continue;
      }
      for (const phrase of phrases) this.add(id, phrase, "targets");
    }
  }

  /**
   * Resolve a phrase to an element id.
   *
   * `unbound` is not a failure: it is the normal state of a phrase before the
   * recorder has seen it, and the id is derived from the phrase so the same
   * phrase always produces the same id (REQ-COMP-5). `remember` records it, so
   * a second use of the same phrase resolves to the same id even if the first
   * one is never recorded.
   */
  resolve(phrase: string, options: { remember?: boolean } = {}): TargetResolution {
    const key = phraseKey(phrase);
    const ids = this.byPhrase.get(key);

    if (ids !== undefined && ids.size === 1) {
      return { id: [...ids][0]!, status: "bound" };
    }
    if (ids !== undefined && ids.size > 1) {
      const candidates = [...ids].sort();
      // The id is still the first one, so the step is compilable and the
      // ambiguity is a warning a person resolves rather than a wall.
      return { id: candidates[0]!, status: "ambiguous", candidates };
    }

    const id = elementId(phrase);
    if (options.remember !== false) this.add(id, phrase, "inferred");
    return { id, status: "unbound" };
  }

  /**
   * Resolve, and produce the diagnostic the resolution deserves.
   *
   * `W_AMBIGUOUS_TARGET` is a warning: the compile succeeds, the plan names one
   * of the ids, and `svatah lint` says which phrase needs a decision
   * (REQ-COMP-8).
   */
  resolveWithDiagnostic(
    phrase: string,
    where: { file: string; line: number },
  ): { resolution: TargetResolution; diagnostic?: Diagnostic } {
    const resolution = this.resolve(phrase);
    if (resolution.status !== "ambiguous") return { resolution };
    return {
      resolution,
      diagnostic: diagnostic(
        "W_AMBIGUOUS_TARGET",
        `"${phrase}" names more than one element: ${resolution.candidates!.join(", ")}. ` +
          `Compiling it as "${resolution.id}"; give the phrases different wording, or say which in targets.yaml.`,
        where,
      ),
    };
  }

  /** Every entry, sorted by id — the `targets` map a plan carries (LLD §3.2). */
  list(): DictionaryEntry[] {
    return [...this.entries.entries()]
      .map(([id, entry]) => ({ id, phrases: [...entry.phrases].sort(), source: entry.source }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  /** The shape `Plan.targets` takes. */
  toPlanTargets(): Record<string, { phrases: string[] }> {
    const out: Record<string, { phrases: string[] }> = {};
    for (const entry of this.list()) out[entry.id] = { phrases: [...entry.phrases] };
    return out;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }
}

/** Read a `targets.yaml` body into `id → phrases`. */
export function parseTargets(
  parsed: unknown,
  file: string,
): { targets: Record<string, string[]>; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const targets: Record<string, string[]> = {};

  if (parsed === null || parsed === undefined) return { targets, diagnostics };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    diagnostics.push(
      diagnostic("E_SYNTAX", `${file} must map element ids to lists of phrases.`, { file, line: 0 }),
    );
    return { targets, diagnostics };
  }

  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") {
      targets[id] = [value];
      continue;
    }
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      targets[id] = value as string[];
      continue;
    }
    diagnostics.push(
      diagnostic(
        "E_SYNTAX",
        `${file}: "${id}" must be a phrase or a list of phrases.`,
        { file, line: 0 },
      ),
    );
  }
  return { targets, diagnostics };
}
