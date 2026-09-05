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

/** Where an element lives, when it is not on the page itself (LLD §3.2). */
export type TargetScope = "page" | "dialog" | "frame" | "desktop" | "window";

export interface DictionaryEntry {
  readonly id: string;
  readonly phrases: readonly string[];
  /** Where the entry came from, for `svatah bindings list` and diagnostics. */
  readonly source: "bindings" | "targets" | "inferred";
  /**
   * The element's scope, when the project declared one.
   *
   * A property of the *element*, not of the sentence: "click the frame button"
   * says nothing about frames, and it should not have to. `targets.yaml` is
   * where a project says that a control lives inside an iframe or a dialog, and
   * every sentence naming it then compiles with the right scope.
   */
  readonly scope?: TargetScope;
}

function isPhraseList(declaration: TargetDeclaration): declaration is readonly string[] {
  return Array.isArray(declaration);
}

export class TargetDictionary {
  /** Element id → entry. */
  private readonly entries = new Map<
    string,
    { phrases: Set<string>; source: DictionaryEntry["source"]; scope?: TargetScope }
  >();
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

  /** `targets.yaml`: id → phrases, and optionally a scope. */
  addTargets(targets: Readonly<Record<string, TargetDeclaration>>): void {
    for (const [id, declaration] of Object.entries(targets)) {
      // `Array.isArray` narrows to `any[]`, which leaves the union intact on
      // the other branch; a written-out guard is what actually narrows here.
      const listed: readonly string[] | undefined = isPhraseList(declaration)
        ? declaration
        : undefined;
      const phrases: readonly string[] = listed ?? (declaration as { phrases: readonly string[] }).phrases;
      const scope: TargetScope | undefined =
        listed === undefined ? (declaration as { scope?: TargetScope }).scope : undefined;

      if (phrases.length === 0) {
        this.entries.set(id, {
          ...(this.entries.get(id) ?? { phrases: new Set<string>(), source: "targets" }),
          source: "targets",
          ...(scope === undefined ? {} : { scope }),
        });
        continue;
      }
      for (const phrase of phrases) this.add(id, phrase, "targets");
      if (scope !== undefined) {
        const entry = this.entries.get(id)!;
        this.entries.set(id, { ...entry, scope });
      }
    }
  }

  /** The scope declared for an element, if any. */
  scopeOf(id: string): TargetScope | undefined {
    return this.entries.get(id)?.scope;
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
      const id = [...ids][0]!;
      /*
       * `bound` means *a binding exists*, not merely that the dictionary knows
       * an id for the phrase. `targets.yaml` names ids and groups phrases; it
       * says nothing about whether the element has ever been located. Calling
       * that `bound` would tell the recorder there is nothing to ground and the
       * step would fail at replay with no binding to resolve (REQ-COMP-5,
       * REQ-REC-1).
       */
      const source = this.entries.get(id)?.source;
      return { id, status: source === "bindings" ? "bound" : "unbound" };
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
      .map(([id, entry]) => ({
        id,
        phrases: [...entry.phrases].sort(),
        source: entry.source,
        ...(entry.scope === undefined ? {} : { scope: entry.scope }),
      }))
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

/** What `targets.yaml` may say about one element. */
export type TargetDeclaration =
  | readonly string[]
  | { readonly phrases: readonly string[]; readonly scope?: TargetScope };

const SCOPES: readonly string[] = ["page", "dialog", "frame", "desktop", "window"];

/**
 * Read a `targets.yaml` body.
 *
 * Three forms, in increasing verbosity:
 *
 * ```yaml
 * sign-in-button: "the sign in button"          # one phrase
 * username-field: ["the username field", "…"]   # several
 * frame-button:                                  # with a scope
 *   phrases: ["the frame button"]
 *   scope: frame
 * ```
 */
export function parseTargets(
  parsed: unknown,
  file: string,
): { targets: Record<string, TargetDeclaration>; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const targets: Record<string, TargetDeclaration> = {};

  if (parsed === null || parsed === undefined) return { targets, diagnostics };
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    diagnostics.push(
      diagnostic("E_SYNTAX", `${file} must map element ids to phrases.`, { file, line: 0 }),
    );
    return { targets, diagnostics };
  }

  const bad = (id: string, why: string): void => {
    diagnostics.push(diagnostic("E_SYNTAX", `${file}: "${id}" ${why}`, { file, line: 0 }));
  };

  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === "string") {
      targets[id] = [value];
      continue;
    }
    if (Array.isArray(value)) {
      if (!value.every((v) => typeof v === "string")) {
        bad(id, "lists something that is not a phrase.");
        continue;
      }
      targets[id] = value as string[];
      continue;
    }
    if (typeof value === "object" && value !== null) {
      const record = value as Record<string, unknown>;
      const phrases = record["phrases"];
      const scope = record["scope"];
      if (!Array.isArray(phrases) || !phrases.every((v) => typeof v === "string")) {
        bad(id, "has no `phrases` list.");
        continue;
      }
      if (scope !== undefined && (typeof scope !== "string" || !SCOPES.includes(scope))) {
        bad(id, `has scope "${String(scope)}"; use one of: ${SCOPES.join(", ")}.`);
        continue;
      }
      targets[id] = {
        phrases: phrases as string[],
        ...(scope === undefined ? {} : { scope: scope as TargetScope }),
      };
      continue;
    }
    bad(id, "must be a phrase, a list of phrases, or { phrases, scope }.");
  }
  return { targets, diagnostics };
}
