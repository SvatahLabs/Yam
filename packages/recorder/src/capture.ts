/**
 * Capture (Draft 2.23, REQ-REC-13): a person drives; Yam writes the flow.
 *
 * `yam record` with no flow named means "I want to make a flow, and I am
 * making it by doing it". The surface reports each thing the person does
 * (`observe`); this turns each into a sentence of the flow language and a
 * binding for the element it was done to — synthesised by `entryFor`, the same
 * path a grounded or picked element takes, with provenance `human`/`capture`.
 *
 * What a sentence says about an element is its phrase: the role and the
 * accessible name, as a person would say it — *the sign in button*, *the
 * username field*. The phrase is what the flow reads; the binding is what the
 * replay finds. A password is never written into a flow: the story declares a
 * `secret` input and the sentence types it.
 */
import { elementIdFromPhrase, Dictionary, type BindingsStore } from "@svatah/yam-bindings";
import type { ElementDescription, Ref } from "@svatah/yam-schema";
import type { AgentSurface, ObservedEvent } from "@svatah/yam-surface";
import { entryFor } from "./ground.js";

export interface CaptureOptions {
  readonly surface: AgentSurface;
  readonly store: BindingsStore;
  /** The story's name; also the test block's. */
  readonly name: string;
  /** Where the session started; the first step goes there. */
  readonly startUrl?: string;
  readonly testIdAttributes?: readonly string[];
  readonly ignoreAttributes?: readonly string[];
  readonly matchHost?: boolean;
  /** Ends the capture; what Enter at the terminal does. */
  readonly signal?: AbortSignal;
  /** A navigation this long after the last action is one the person typed. */
  readonly navigationGapMs?: number;
  readonly log?: (message: string) => void;
  /** Each sentence as it is written. */
  readonly onStep?: (text: string) => void;
}

export interface CaptureOutcome {
  readonly story: string;
  readonly steps: readonly string[];
  /** Input name → kind, for the story's `inputs:` line. */
  readonly inputs: Readonly<Record<string, "string" | "secret">>;
  /** Element ids written to the store. */
  readonly bound: readonly string[];
  /** Phrases a step names that could not be bound; `yam record --flow` binds them. */
  readonly unbound: readonly string[];
  /** The flow file's text. */
  readonly flow: string;
  readonly finalUrl?: string;
}

/** The noun a person uses for a role. */
const NOUN: Readonly<Record<string, string>> = {
  button: "button",
  link: "link",
  textbox: "field",
  searchbox: "field",
  spinbutton: "field",
  combobox: "select",
  listbox: "list",
  checkbox: "checkbox",
  radio: "option",
  switch: "switch",
  tab: "tab",
  menuitem: "menu item",
  option: "option",
  slider: "slider",
  heading: "heading",
  img: "image",
};

/** The target phrase for an element, as a person would say it. */
export function phraseFor(description: ElementDescription): string {
  const noun = NOUN[description.role] ?? (description.role.replace(/[^A-Za-z]+/g, " ").trim().toLowerCase() || description.tag.toLowerCase());
  const raw =
    description.name?.trim() ||
    description.attrs["placeholder"] ||
    description.attrs["aria-label"] ||
    description.text.trim() ||
    description.attrs["data-testid"] ||
    description.attrs["name"] ||
    description.attrs["id"] ||
    "";
  const words = raw
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((one) => one !== "")
    .slice(0, 6);
  const nounWords = noun.split(" ");
  if (words.length >= nounWords.length && nounWords.every((one, i) => words[words.length - nounWords.length + i] === one)) {
    words.splice(words.length - nounWords.length, nounWords.length);
  }
  return words.length === 0 ? `the ${noun}` : `the ${words.join(" ")} ${noun}`;
}

/** An input name for a phrase: `the password field` → `password`. */
export function inputNameFor(phrase: string): string {
  const id = elementIdFromPhrase(phrase).replace(/-(field|input|box)$/, "");
  const name = id.replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^[a-z_]/.test(name) ? name : `value_${name}`;
}

/** The page segment of an element id, from where the element was: `/login` → `login`, `/` → `home`. */
export function segmentOf(url: string | undefined): string {
  if (url === undefined) return "home";
  let path = "/";
  try {
    path = new URL(url).pathname;
  } catch {
    path = url;
  }
  const first = path.split("/").filter((one) => one !== "")[0];
  const segment = (first ?? "home").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return segment === "" ? "home" : segment;
}

const quote = (value: string): string => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/** The flow file for a captured story. */
export function renderCapturedFlow(outcome: Pick<CaptureOutcome, "story" | "steps" | "inputs">, about: { readonly baseUrl?: string; readonly at?: Date }): string {
  const when = (about.at ?? new Date()).toISOString().slice(0, 10);
  const inputs = Object.entries(outcome.inputs);
  return [
    `// Recorded by a person on ${when}${about.baseUrl === undefined ? "" : ` at ${about.baseUrl}`}.`,
    "// Each sentence is what was done; edit it freely. Bindings live under bindings/.",
    "",
    `story: ${outcome.story}`,
    ...(inputs.length === 0 ? [] : [`inputs: ${inputs.map(([name, kind]) => `${name}: ${kind}`).join(", ")}`]),
    ...outcome.steps.map((one) => `  ${one}`),
    "",
    `test: ${outcome.story}`,
    "",
  ].join("\n");
}

/** Run a capture on an open session until the signal aborts or the session closes. */
export async function capture(options: CaptureOptions): Promise<CaptureOutcome> {
  const { surface, store } = options;
  if (surface.observe === undefined || surface.capabilities().observe !== true) {
    throw new Error(`The ${surface.kind} adapter cannot observe a person; capture needs the observe capability.`);
  }
  /*
   * Sentences are slots in the order the events arrived; each is filled when
   * its element has been described and bound, which happens while the person
   * carries on. A slot that comes to nothing — an element gone before it could
   * be described — is dropped.
   */
  type Slot = { readonly ref?: Ref; readonly kind: ObservedEvent["kind"]; readonly text: Promise<string | undefined> };
  const slots: Slot[] = [];
  const inputs: Record<string, "string" | "secret"> = {};
  const bound: string[] = [];
  const unbound: string[] = [];
  const phraseToId = new Map<string, string>();
  const usedPhrases = new Map<string, Ref>();
  const bindings = new Map<Ref, Promise<string>>();
  const dictionary = Dictionary.fromStore(store);
  const gap = options.navigationGapMs ?? 2500;
  let lastActionAt = Date.now();
  let lastUrl = options.startUrl;

  const say = (kind: ObservedEvent["kind"], text: Promise<string | undefined>, ref?: Ref): void => {
    slots.push({ ...(ref === undefined ? {} : { ref }), kind, text });
    void text.then((one) => {
      if (one !== undefined) options.onStep?.(one);
    });
  };
  const now = (text: string): Promise<string> => Promise.resolve(text);

  if (options.startUrl !== undefined) say("navigate", now(`Go to ${quote(pathOf(options.startUrl))}`));

  /** The phrase and the element id for a reference, binding it when it is new; once per element. */
  const bind = (ref: Ref): Promise<string> => {
    let one = bindings.get(ref);
    if (one === undefined) {
      one = bindNow(ref);
      bindings.set(ref, one);
    }
    return one;
  };
  const bindNow = async (ref: Ref): Promise<string> => {
    const description = await surface.describe(ref);
    let phrase = phraseFor(description);
    const seenAs = usedPhrases.get(phrase);
    if (seenAs !== undefined && seenAs !== ref) {
      let n = 2;
      while (usedPhrases.has(`${phrase} ${n}`)) n += 1;
      phrase = `${phrase} ${n}`;
    }
    usedPhrases.set(phrase, ref);
    let id = phraseToId.get(phrase);
    if (id === undefined) {
      const known = dictionary.lookup(phrase);
      id = known.status === "bound" ? known.ids[0]! : `${segmentOf(lastUrl)}.${elementIdFromPhrase(phrase)}`;
      phraseToId.set(phrase, id);
      try {
        const entry = await entryFor(surface, ref, {
          promptVersion: "capture",
          ...(options.testIdAttributes === undefined ? {} : { testIdAttributes: options.testIdAttributes }),
          ...(options.ignoreAttributes === undefined ? {} : { ignoreAttributes: options.ignoreAttributes }),
          ...(options.matchHost === undefined ? {} : { matchHost: options.matchHost }),
        });
        store.put(id, entry, phrase);
        bound.push(id);
        options.log?.(`${id}: bound from what you did`);
      } catch (error) {
        unbound.push(phrase);
        options.log?.(`${id}: not bound — ${error instanceof Error ? error.message : String(error)} Bind it later with yam record --flow.`);
      }
    }
    return phrase;
  };

  /** A sentence about an element, or nothing when the element could not be described. */
  const sentence = (ref: Ref, words: (phrase: string) => string): Promise<string | undefined> =>
    bind(ref).then(words, (error: unknown) => {
      options.log?.(`a step was lost: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    });

  await surface.observe(
    (event) => {
      const at = Date.now();
      let work: Promise<string | undefined> | undefined;
      switch (event.kind) {
        case "navigate": {
          const typed = event.typed === true || at - lastActionAt >= gap;
          if (typed && event.url !== lastUrl) say("navigate", now(`Go to ${quote(pathOf(event.url))}`));
          lastUrl = event.url;
          if (typed) lastActionAt = at;
          return;
        }
        case "click":
          work = sentence(event.ref, (phrase) => `Click ${phrase}`);
          break;
        case "type":
          work = sentence(event.ref, (phrase) => {
            if (!event.secret) return `Type ${quote(event.value)} into ${phrase}`;
            const name = inputNameFor(phrase);
            inputs[name] = "secret";
            return `Type {input.${name}} into ${phrase}`;
          });
          break;
        case "select":
          work = sentence(event.ref, (phrase) => `Select ${quote(event.label)} from ${phrase}`);
          break;
        case "check":
          work = sentence(event.ref, (phrase) => `${event.checked ? "Check" : "Uncheck"} ${phrase}`);
          break;
        case "press":
          work = sentence(event.ref, (phrase) => `Press ${quote(event.key)} in ${phrase}`);
          break;
        default:
          return;
      }
      say(event.kind, work, event.ref);
      lastActionAt = at;
      // Returned so the surface knows the observation is still in flight (the navigation hold);
      // and the action's moment is when it settled, since the navigation it causes waits for that.
      return work.then(() => {
        lastActionAt = Date.now();
      });
    },
    { ...(options.signal === undefined ? {} : { signal: options.signal }) },
  );

  if (lastUrl !== undefined) say("navigate", now(`The URL should contain ${quote(pathOf(lastUrl))}`));

  const texts = await Promise.all(slots.map((one) => one.text));
  const steps: string[] = [];
  for (const [i, text] of texts.entries()) {
    if (text === undefined) continue;
    const slot = slots[i]!;
    const previous = slots[i - 1];
    // A value typed again into the same field is a correction: the later sentence replaces the earlier.
    if (slot.kind === "type" && previous?.kind === "type" && previous.ref === slot.ref && texts[i - 1] !== undefined) {
      steps[steps.length - 1] = text;
      continue;
    }
    steps.push(text);
  }
  const outcome = { story: options.name, steps, inputs, bound, unbound, ...(lastUrl === undefined ? {} : { finalUrl: lastUrl }) };
  return { ...outcome, flow: renderCapturedFlow(outcome, { ...(options.startUrl === undefined ? {} : { baseUrl: new URL(options.startUrl).origin }) }) };
}

/** The path a person would write: `http://host/login?x=1` → `/login`. */
export function pathOf(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || "/";
  } catch {
    return url;
  }
}
