/**
 * The words on the screens (`AX-07`, `AX-16`, `EX-05`, `CX-04`, wave E3).
 *
 * Three rules about copy. The two that are about a *screen* are checked against
 * the model — the layer both renderers read, so a sentence that is wrong is
 * wrong in the app and in the cockpit at once. The one that is about a *zero
 * state* is checked against the renderers' source, because a zero state is what
 * a screen says when there is nothing, and loading every screen into every one
 * of its empty conditions would be a fixture set larger than the rule.
 *
 * ## Why `AX-07` is stated the way it is
 *
 * It took three formulations and the first two were worse than nothing.
 *
 * The first read every node's value out of a semantic snapshot and asked for
 * prose. The snapshot is interactive-only, so there was never any prose in it:
 * the rule passed on every screen by measuring an empty set.
 *
 * The second required *every* sentence to end in an imperative and failed seven
 * boards on copy that was correct — "an unverified binding is never used
 * without saying so" is a guarantee, and rewriting it into an instruction would
 * make the product worse.
 *
 * The third is here, and it is scoped to the thing E3.1 actually names: **every
 * zero state names an action**. A screen full of content does not need to tell
 * you what to do; a pane with nothing in it does, because otherwise it is a
 * dead end with a sentence in it.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  SCREEN_IDS,
  actionsForScreen,
  fakeService,
  screenById,
  type FakeResponses,
  type ScreenId,
} from "@svatah/yam-screens";
import { fromRoot, REPO_ROOT } from "../src/repo.js";

const FIXTURES = JSON.parse(
  readFileSync(fromRoot("packages/screens/test/fixtures/fixtures-project.json"), "utf8"),
) as FakeResponses;

/** The parameters that make a screen show something rather than its zero state. */
const PARAMS: Partial<Record<ScreenId, Record<string, string>>> = {
  run: { runId: "comp" },
  flows: { file: "flows/guards-and-compensation.flow" },
};

const loaded = new Map<ScreenId, Record<string, unknown>>();
for (const id of SCREEN_IDS) {
  loaded.set(
    id,
    (await screenById(id).load(fakeService(FIXTURES), PARAMS[id] ?? {})) as unknown as Record<
      string,
      unknown
    >,
  );
}

/** Every sentence the model produced for a screen: title, subtitle, status. */
function sentences(id: ScreenId): string[] {
  const state = loaded.get(id)!;
  return ["title", "subtitle", "status"]
    .map((key) => String(state[key] ?? "").trim())
    .filter((one) => one !== "");
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(entry)) out.push(path);
  }
  return out;
}

/**
 * Every zero state, from both renderers' source: `empty="…"` in the app and
 * `empty: "…"` in the cockpit's row models. The same sentence a person reads.
 */
function zeroStates(): Array<{ where: string; text: string }> {
  const out: Array<{ where: string; text: string }> = [];
  for (const file of [
    ...sources(fromRoot("apps/desktop/src/renderer")),
    ...sources(fromRoot("packages/tui/src")),
  ]) {
    const text = readFileSync(file, "utf8");
    for (const match of text.matchAll(/\bempty[=:]\s*"([^"]{8,})"/g)) {
      out.push({ where: file.replace(`${REPO_ROOT}/`, ""), text: match[1]! });
    }
  }
  return out;
}

/**
 * A sentence that names something to do.
 *
 * Either an imperative the product actually has — the verbs its own actions are
 * labelled with — or a key to press. "Press Connect surface" qualifies on both
 * counts; "an unverified binding is never used without saying so" qualifies on
 * neither, and is a guarantee rather than an instruction.
 */
const instructs = (text: string): boolean =>
  /\b(press|choose|enter|open|connect|run|record|select|pick|type|start|save|add|import|bind|use|watch)\b/i.test(
    text,
  );

/**
 * The zero states that are **good news**, and say so without an instruction.
 *
 * Found by this rule demanding one. "This project compiles clean" is a list
 * that is empty because nothing is wrong, and appending "press ? for the keys"
 * to it makes the product worse — which is precisely the failure `AX-07`'s
 * second formulation committed at scale. A dead end needs a way out; a clean
 * bill of health does not.
 *
 * Enumerated rather than inferred, because "is this good news" is not something
 * a regular expression can be trusted with, and an exemption nobody has to
 * write down is an exemption that grows.
 */
const GOOD_NEWS: Readonly<Record<string, string>> = {
  "this project compiles clean": "an empty diagnostics list is the outcome, not a dead end",
  "every exposed story is idempotent": "an empty warnings list, likewise",
};

describe("every zero state names an action (AX-07, CX-04)", () => {
  const states = zeroStates().filter((one) => !(one.text.toLowerCase() in GOOD_NEWS));

  it("finds zero states at all, or it is measuring nothing", () => {
    expect(states.length, "no zero state was found to check").toBeGreaterThan(10);
  });

  it("exempts only good news, and only what is written down", () => {
    /* An exemption for a real dead end would be the rule quietly switched off. */
    for (const [text, why] of Object.entries(GOOD_NEWS)) {
      expect(why, `${text} is exempt with no reason`).not.toBe("");
      expect(instructs(text), `${text} is exempt and did not need to be`).toBe(false);
    }
    expect(Object.keys(GOOD_NEWS).length, "the exemption list has grown past a handful")
      .toBeLessThan(5);
  });

  it("ends every one of them in something to do", () => {
    const silent = states
      .filter((one) => !instructs(one.text))
      .map((one) => `${one.where}: "${one.text}"`);
    expect(silent, silent.join("\n")).toEqual([]);
  });

  it("does not accept a guarantee as an instruction: shown to bite (EX-N3)", () => {
    /*
     * The sentences the second formulation failed, which are correct copy — and
     * which this rule must not count as instructions either, or it is satisfied
     * by any screen that says anything at all.
     */
    expect(instructs("An unverified binding is never used without saying so.")).toBe(false);
    expect(instructs("Nothing is written until a proposal is applied.")).toBe(false);
    expect(instructs("Nothing here yet.")).toBe(false);
    expect(instructs("Enter a URL above and press Connect surface.")).toBe(true);
  });
});

describe("a screen says where its work goes (AX-16)", () => {
  /**
   * A place the product has, or the artifact the work produces.
   *
   * There is no journey diagram and deliberately: a stepper across the top is
   * what you print when the screens are not producing one, and it lies on every
   * screen that is a place rather than a step. What replaces it is each screen
   * naming its own destination — in its own words *or* on the controls it
   * offers, because a button called "New flow" says where the work goes as
   * plainly as a sentence would.
   */
  const places = [
    "flow",
    "binding",
    "run",
    "proposal",
    "session",
    "project",
    "request",
    "data",
    "tool",
    "step",
    "report",
    "surface",
    "value",
    "database",
    "target",
  ];

  const words = (id: ScreenId): string =>
    [...sentences(id), ...actionsForScreen(id).map((one) => `${one.label} ${one.cli}`)]
      .join(" ")
      .toLowerCase();

  for (const id of SCREEN_IDS) {
    it(`${id} names what it produces or where it lands`, () => {
      expect(
        places.some((one) => words(id).includes(one)),
        `${id} says only: ${sentences(id).join(" | ")}`,
      ).toBe(true);
    });
  }

  it("is not satisfied by a screen that says nothing: shown to bite (EX-N3)", () => {
    const nothing = "settings · 12 things · ready";
    expect(places.some((one) => nothing.includes(one))).toBe(false);
  });
});

describe("no sentence twice on one screen (EX-05)", () => {
  for (const id of SCREEN_IDS) {
    it(`${id} says each thing once`, () => {
      const said = sentences(id).map((one) => one.replace(/\s+/g, " ").toLowerCase());
      expect(new Set(said).size, `${id} repeats itself: ${said.join(" | ")}`).toBe(said.length);
    });
  }

  it("is not the copy it replaced", () => {
    /*
     * `EX-N3`. "Choose a browser, app, device or API to control" was on the
     * Session screen four times and promised a device this machine has no
     * driver for. Its absence is what separates the designs; the rule above
     * would pass on the old copy too, because the four occurrences were in four
     * different places rather than in these three fields.
     */
    const everything = [
      ...SCREEN_IDS.flatMap((id) => sentences(id)),
      ...zeroStates().map((one) => one.text),
    ].join(" ");
    expect(everything).not.toContain("browser, app, device or API");
  });
});
