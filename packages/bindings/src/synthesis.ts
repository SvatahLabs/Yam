/**
 * Candidate synthesis and fingerprinting (REQ-REC-3, REQ-REC-4, LLD §3.3, §7.4).
 *
 * Both work over `surface.describe()`, so they are the same code for every
 * adapter: web, mobile or desktop. Neither uses a model — REQ-REC-3 says
 * "candidate synthesis is model-free" — and neither knows what a DOM is.
 *
 * The ordering below is the ranking, and the ranking is the whole of what makes
 * replay survive a front-end change: a test id survives a restyle, a role and
 * name survive a restructure, a positional path survives neither. So the strategy
 * is tried in the order of how much of the application has to change before it
 * stops being true, and a candidate that matches more than one element is dropped
 * outright (REQ-REC-3) rather than guessed at.
 */
import { DEFAULT_IGNORE_ATTRIBUTES, type Candidate, type ElementDescription, type Fingerprint, type Ref } from "@svatah/yam-schema";
import type { AgentSurface } from "@svatah/yam-surface";

export interface SynthesisOptions {
  /** Attributes treated as test ids, most preferred first. */
  testIdAttributes?: readonly string[];
  /**
   * Attributes nothing may bind to (`config.bindings.ignoreAttributes`, LLD
   * §3.5). Removed from candidates and from fingerprints alike.
   *
   * The adapter strips these before `describe()` returns, so in the normal case
   * they are gone before this code runs. It is enforced here as well because
   * synthesis is adapter-neutral: an adapter that has not implemented the option
   * must not be able to leak one of these into a candidate.
   */
  ignoreAttributes?: readonly string[];
  /**
   * Verify each candidate against the live surface and drop the ones that match
   * more than one element (REQ-REC-3). On by default: an unverified bundle is a
   * guess, and the resolver will refuse a multi-match at replay anyway.
   */
  verify?: boolean;
  /** Keep at most this many candidates. */
  max?: number;
}

const DEFAULT_TEST_ID_ATTRIBUTES = ["data-testid", "data-test-id", "data-test", "data-qa"];

/** Lower-cased, so a caller's casing cannot get a value past the filter. */
function ignoreSet(ignore: readonly string[] | undefined): Set<string> {
  return new Set((ignore ?? DEFAULT_IGNORE_ATTRIBUTES).map((a) => a.toLowerCase()));
}

/** `attrs` and `native` with the ignored names removed. */
function withoutIgnored(
  description: ElementDescription,
  ignore: readonly string[] | undefined,
): ElementDescription {
  const drop = ignoreSet(ignore);
  const strip = (record: Record<string, string> | undefined): Record<string, string> | undefined => {
    if (record === undefined) return undefined;
    const kept = Object.entries(record).filter(([key]) => !drop.has(key.toLowerCase()));
    return kept.length === Object.keys(record).length ? record : Object.fromEntries(kept);
  };
  const attrs = strip(description.attrs)!;
  const native = strip(description.native);
  if (attrs === description.attrs && native === description.native) return description;
  return { ...description, attrs, ...(native === undefined ? {} : { native }) };
}

/** Roles whose text is their label, so a `text` candidate means something. */
const TEXT_BEARING_ROLES = new Set([
  "button",
  "link",
  "heading",
  "option",
  "tab",
  "menuitem",
  "listitem",
  "cell",
  "columnheader",
  "status",
]);

/**
 * Attributes that are worth keeping in a fingerprint (LLD §3.3: "tag or control
 * type, *selected attributes*, own text, …").
 *
 * Selected, not all: `style`, `class` and framework-generated attributes change
 * for reasons that have nothing to do with which element this is, and a
 * fingerprint that included them would score two versions of the same button as
 * different elements.
 */
const FINGERPRINT_ATTRIBUTES = [
  "id",
  "name",
  "type",
  "role",
  "aria-label",
  "aria-labelledby",
  "placeholder",
  "alt",
  "title",
  "href",
  "value",
  "for",
  "data-testid",
  "data-test-id",
  "data-test",
  "data-qa",
  "automationid",
  "resource-id",
  "content-desc",
];

/**
 * Whether a value looks machine-generated and so is not worth binding to.
 *
 * The adapter flags what it can see (`native.idIsGenerated`), but the heuristic
 * lives here too because it applies to any adapter's values, and because a
 * binding built on `:r3:` or `css-1x2y3z` breaks on the next build for no reason
 * a person would recognise.
 */
export function looksGenerated(value: string): boolean {
  return (
    /^:r[0-9a-z]+:$/i.test(value) ||
    /^ember\d+$/i.test(value) ||
    /^(mui|radix|headlessui|reach|aria)[-_][:a-z0-9]+$/i.test(value) ||
    /^sc-[a-zA-Z]{6,}$/.test(value) ||
    /^(css|jsx|emotion)-[a-z0-9]{5,}$/i.test(value) ||
    /^_[a-zA-Z0-9]{5,}$/.test(value) ||
    /^[0-9a-f]{8,}$/i.test(value) ||
    /\d{5,}$/.test(value)
  );
}

/**
 * The ranked candidates for one element, before uniqueness filtering.
 *
 * Scores are the ranking made explicit rather than left to array order, because
 * the healer re-synthesises and has to merge two bundles (LLD §6.4).
 */
export function candidatesFor(
  raw: ElementDescription,
  options: SynthesisOptions = {},
): Candidate[] {
  const description = withoutIgnored(raw, options.ignoreAttributes);
  const drop = ignoreSet(options.ignoreAttributes);
  const testIdAttributes = (options.testIdAttributes ?? DEFAULT_TEST_ID_ATTRIBUTES).filter(
    (a) => !drop.has(a.toLowerCase()),
  );
  const attrs = description.attrs;
  const native = description.native ?? {};
  const out: Candidate[] = [];

  /* 1. A test id. Put there so this element could be found; nothing survives a
        front-end change better, because changing it is a deliberate act. */
  for (const attribute of testIdAttributes) {
    const value = attrs[attribute] ?? native[attribute];
    if (value !== undefined && value !== "" && !looksGenerated(value)) {
      out.push({ by: "testid", value, attribute, score: 0.98 });
      break;
    }
  }

  /*
   * 1b. A desktop `automationId` (T11.3, LLD §6.2, §7.5, REQ-REC-3).
   *
   * REQ-REC-3 asks for "a ranked list **per adapter kind**", and this list had
   * only the web's kinds — so a desktop recording came out with `role` and
   * `text` and nothing that survives a rewording, which is the one thing a
   * desktop binding has that a web one often does not. `AXDOMIdentifier` on
   * macOS, `AutomationId` on Windows; LLD §13.7's accessibility contract
   * requires one on every control of the app, and the desktop snapshot case
   * fails a live gate when one is missing.
   *
   * Ranked just under a test id and above a role-and-name, for the same reason
   * a test id outranks one: changing it is a deliberate act, and a name is
   * rewritten every time somebody improves the wording.
   */
  const automationId = native["automationId"];
  if (automationId !== undefined && automationId !== "" && !looksGenerated(automationId)) {
    out.push({ by: "automationId", value: automationId, score: 0.96 });
  }

  /* 2. An id, unless the framework made it up. */
  const id = attrs["id"];
  if (id !== undefined && id !== "" && !looksGenerated(id) && native["idIsGenerated"] !== "true") {
    out.push({ by: "id", value: id, score: 0.95 });
  }

  /* 3. Role and accessible name — what a person and a screen reader both use,
        and what survives a restructure. */
  if (description.name !== undefined && description.name !== "" && description.role !== "generic") {
    out.push({
      by: "role",
      role: description.role,
      name: description.name,
      exact: true,
      score: 0.92,
    });
  }

  /* 4. A label, for a form control. */
  const labelled = attrs["aria-label"] ?? labelFromName(description);
  if (labelled !== undefined && labelled !== "" && isFormControl(description)) {
    out.push({ by: "label", value: labelled, exact: true, score: 0.9 });
  }

  /* 5. A placeholder. Weaker than a label: it is guidance text, and guidance
        text is rewritten more often than a label. */
  const placeholder = attrs["placeholder"];
  if (placeholder !== undefined && placeholder !== "") {
    out.push({ by: "placeholder", value: placeholder, exact: true, score: 0.85 });
  }

  /* 6. The form field's name, which the server already depends on. */
  const name = attrs["name"];
  if (name !== undefined && name !== "" && !looksGenerated(name)) {
    out.push({ by: "name", value: name, score: 0.82 });
  }

  /* 7. Alt text and title. */
  const alt = attrs["alt"];
  if (alt !== undefined && alt !== "") out.push({ by: "altText", value: alt, exact: true, score: 0.78 });
  const title = attrs["title"];
  if (title !== undefined && title !== "") out.push({ by: "title", value: title, exact: true, score: 0.76 });

  /* 8. Visible text, where the text is the element's label. */
  if (TEXT_BEARING_ROLES.has(description.role) && description.text !== "") {
    out.push({ by: "text", value: description.text, exact: true, score: 0.75 });
  }

  /* 9. A stable CSS path, anchored at the nearest identified ancestor. */
  const cssPath = native["cssPath"];
  if (cssPath !== undefined && cssPath !== "") {
    out.push({ by: "css", value: cssPath, score: positional(cssPath) ? 0.55 : 0.68 });
  }

  /* 10. A relative XPath, same anchoring. Last of the locators, because an index
         in a path is the first thing a layout change invalidates. */
  const xpath = native["xpath"];
  if (xpath !== undefined && xpath !== "") {
    out.push({ by: "xpath", value: xpath, score: positional(xpath) ? 0.45 : 0.6 });
  }

  /*
   * 11. The desktop's own path (T11.3, LLD §7.5).
   *
   * `Window[Yam]/AXGroup[0]/…/AXButton[Flows]` — the accessibility
   * ancestry, which is what a desktop adapter can address an element by when
   * nothing else identifies it. Scored where a CSS path is, and for the same
   * reason: it is a route rather than an identity, and a panel inserted above
   * the element invalidates it.
   */
  const controlPath = native["controlPath"];
  if (controlPath !== undefined && controlPath !== "") {
    out.push({ by: "controlPath", value: controlPath, score: positional(controlPath) ? 0.45 : 0.55 });
  }

  return dedupe(out).sort((a, b) => b.score - a.score);
}

/** A path that leans on sibling position rather than on identity. */
function positional(path: string): boolean {
  return /:nth-of-type\(|\[\d+\]/.test(path);
}

function isFormControl(description: ElementDescription): boolean {
  return ["textbox", "searchbox", "spinbutton", "checkbox", "radio", "combobox", "listbox", "slider"].includes(
    description.role,
  );
}

/** A control's accessible name doubles as its label when it came from one. */
function labelFromName(description: ElementDescription): string | undefined {
  if (!isFormControl(description)) return undefined;
  return description.name;
}

function dedupe(candidates: readonly Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const candidate of candidates) {
    const key = `${candidate.by}:${candidate.role ?? ""}:${candidate.name ?? ""}:${candidate.value ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

/**
 * The ranked, verified candidate bundle for one element (REQ-REC-3).
 *
 * "Candidate synthesis is model-free and produces a ranked list per adapter kind;
 * candidates matching more than one element are dropped."
 *
 * A `coords` candidate is added only when the bundle would otherwise be empty —
 * an element with no accessibility node, such as a control painted on a canvas.
 * It is a last resort and scored as one: coordinates stop being true the moment
 * the page reflows.
 */
export async function synthesise(
  surface: AgentSurface,
  ref: Ref,
  options: SynthesisOptions = {},
): Promise<Candidate[]> {
  const description = await surface.describe(ref);
  const proposed = candidatesFor(description, options);

  if (options.verify === false) {
    return proposed.slice(0, options.max ?? proposed.length);
  }

  const kept: Candidate[] = [];
  for (const candidate of proposed) {
    const refs = await surface.locate(candidate).catch(() => [] as Ref[]);
    // Exactly one, and it must be *this* element: a candidate that uniquely
    // matches something else is worse than one that matches nothing, because it
    // would resolve at replay and act on the wrong thing.
    if (refs.length !== 1) continue;
    if (!(await sameElement(surface, refs[0]!, ref, description))) continue;
    kept.push(candidate);
    if (options.max !== undefined && kept.length >= options.max) break;
  }

  if (kept.length === 0) {
    const [x, y, width, height] = description.box;
    if (width > 0 && height > 0) {
      kept.push({
        by: "coords",
        value: `${Math.round(x + width / 2)},${Math.round(y + height / 2)}`,
        score: 0.2,
      });
    }
  }

  return kept;
}

/**
 * Whether two references name the same element.
 *
 * References are opaque above the surface, and two references to one element are
 * not required to be equal — `locate` mints its own (LLD §7.1) — so identity is
 * established from what `describe` says rather than from the strings.
 */
async function sameElement(
  surface: AgentSurface,
  found: Ref,
  original: Ref,
  description: ElementDescription,
): Promise<boolean> {
  if (found === original) return true;
  const other = await surface.describe(found).catch(() => undefined);
  if (other === undefined) return false;
  return (
    other.tag === description.tag &&
    other.role === description.role &&
    other.index === description.index &&
    other.box[0] === description.box[0] &&
    other.box[1] === description.box[1] &&
    other.box[2] === description.box[2] &&
    other.box[3] === description.box[3]
  );
}

/**
 * The structural fingerprint of one element (REQ-REC-4, LLD §3.3).
 *
 * "tag or control type, selected attributes, own text, neighbour text, ancestor
 * role path, bounding box, sibling index."
 *
 * It is what relocalization scores against (LLD §6.4), so what goes in is chosen
 * for one property: it should change when the element changes and stay when only
 * the page around it does. That is why the attributes are a selected list rather
 * than everything, and why generated ids and hashed classes are left out.
 */
export function fingerprintOf(
  raw: ElementDescription,
  options: Pick<SynthesisOptions, "ignoreAttributes"> = {},
): Fingerprint {
  const description = withoutIgnored(raw, options.ignoreAttributes);
  const drop = ignoreSet(options.ignoreAttributes);
  const attrs: Record<string, string> = {};
  for (const key of FINGERPRINT_ATTRIBUTES) {
    if (drop.has(key.toLowerCase())) continue;
    const value = description.attrs[key] ?? description.native?.[key];
    if (value === undefined || value === "") continue;
    if (looksGenerated(value)) continue;
    attrs[key] = value;
  }
  // Stable classes, when the adapter separated them from generated ones.
  const stable = description.native?.["stableClasses"];
  if (stable !== undefined && stable !== "") attrs["class"] = stable;

  return {
    tag: description.tag,
    attrs,
    text: description.text,
    neighbours: {
      before: [...description.neighbours.before],
      after: [...description.neighbours.after],
    },
    rolePath: [...description.rolePath],
    box: [...description.box] as Fingerprint["box"],
    index: description.index,
  };
}

/** The fingerprint of a live element. */
export async function fingerprint(
  surface: AgentSurface,
  ref: Ref,
  options: Pick<SynthesisOptions, "ignoreAttributes"> = {},
): Promise<Fingerprint> {
  return fingerprintOf(await surface.describe(ref), options);
}

/** Candidates and fingerprint in one pass, which is what the recorder wants. */
export async function synthesiseBundle(
  surface: AgentSurface,
  ref: Ref,
  options: SynthesisOptions = {},
): Promise<{ candidates: Candidate[]; fingerprint: Fingerprint; description: ElementDescription }> {
  const description = await surface.describe(ref);
  const candidates = await synthesise(surface, ref, options);
  return { candidates, fingerprint: fingerprintOf(description, options), description };
}

/* ── WebMCP (T6.3, REQ-ADP-9, LLD §6.3) ───────────────────────────────────── */

/**
 * The site tool a target phrase names, if it names one.
 *
 * `docs/flow-language.md` pattern 30 is `Use the "<tool>" site tool`, and the
 * compiler turns it into a target whose phrase is `the <tool> site tool`. That
 * phrase is the *only* deterministic link between a flow and a declared tool:
 * for an ordinary target — "the Book now button" — nothing but a model could say
 * which tool corresponds, and REQ-REC-3 requires synthesis to be model-free.
 *
 * So a `webmcp` candidate is synthesised exactly when the author asked for one
 * by name. That is narrower than "whenever the page declares something useful",
 * and it is the part that can be got right without guessing.
 */
export function siteToolOf(phrase: string): string | undefined {
  const match = /^\s*(?:the\s+)?["']?(.+?)["']?\s+site\s+tool\s*$/i.exec(phrase);
  const name = match?.[1]?.trim();
  return name === undefined || name === "" ? undefined : name;
}

/** Control nouns an element id ends with, which a tool name will not. */
const CONTROL_NOUNS = [
  "button",
  "link",
  "field",
  "input",
  "box",
  "checkbox",
  "select",
  "control",
  "tab",
];

/**
 * The tool names a target might be, best first.
 *
 * Two ways a flow can reach a declared tool, and both are deterministic:
 *
 * 1. **The author named it** — `Use the "book-slot" site tool`, pattern 30,
 *    whose target phrase is `the book-slot site tool`. This is exact.
 * 2. **The element id is the tool name**, with or without the control noun the
 *    dictionary appended: "Click the Book the slot button" becomes
 *    `book-the-slot-button`, and a page declaring `book-the-slot` is declaring
 *    that control.
 *
 * The second is a guess in the sense that a page *could* name a tool after an
 * unrelated control — which is why every candidate is confirmed against the
 * live declaration before it is written, and why nothing looser is tried. A
 * fuzzy match would put a tool in a binding on the strength of a shared word.
 */
export function siteToolCandidatesFor(phrase: string, elementId?: string): string[] {
  const named = siteToolOf(phrase);
  if (named !== undefined) return [named];
  if (elementId === undefined || elementId === "") return [];

  // The dictionary namespaces ids as `page.element`; the tool is the element.
  const local = elementId.split(".").pop()!;
  const out = [local];
  for (const noun of CONTROL_NOUNS) {
    if (local.endsWith(`-${noun}`)) out.push(local.slice(0, -(noun.length + 1)));
  }
  return out;
}

/**
 * The `webmcp` candidate for a target, when the page declares the tool.
 *
 * Score 1.0, above every locator, because the resolver's preference is not a
 * ranking — it is a separate branch (LLD §6.3) — and a bundle whose first entry
 * were a locator would read as though the tool came second.
 *
 * `paramMap` is deliberately absent. It exists for a tool whose parameter names
 * differ from the step's argument names, and nothing model-free can discover
 * that mapping; identity is what the sentence says and what the page's
 * `inputSchema` will confirm or reject.
 */
export async function synthesiseSiteTool(
  surface: AgentSurface,
  phrase: string,
  elementId?: string,
): Promise<Candidate | undefined> {
  if (surface.capabilities().webmcp !== true) return undefined;

  for (const tool of siteToolCandidatesFor(phrase, elementId)) {
    const candidate: Candidate = { by: "webmcp", tool, score: 1 };
    const refs = await surface.locate(candidate).catch(() => [] as Ref[]);
    // Exactly as for a locator: a candidate that does not resolve is not
    // written. A page that does not declare the tool leaves the binding to its
    // locators, which is the fall-through of LLD §6.3 seen from record time.
    if (refs.length === 1) return candidate;
  }
  return undefined;
}
