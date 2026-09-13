/**
 * A zero state may not name a key the screen does not have (`CX-01`, `CX-04`,
 * E4.1).
 *
 * `TV-02` already requires that every action be reachable. `CX-01` adds the
 * other half: **a key that can only ever refuse is not reachability** — and a
 * zero state that says "press R to record what you do" on a screen where `R` is
 * bound to nothing is worse than one that says nothing at all, because a person
 * presses it and concludes the product is broken.
 *
 * This was written after doing exactly that. Giving every cockpit zero state a
 * next step (E3.1) produced fourteen sentences naming keys, and five of them
 * named a key bound on a *different* screen: `g` for the gateway, `s` for
 * serving tools, `n` for a new request, `i` on Data, `r` on Runs. Every one
 * read plausibly. Nothing would have caught them.
 *
 * The attribution is the part worth explaining. A zero state is a property of a
 * *pane*, and a pane belongs to a screen — so the check loads each screen, asks
 * `paneModel` for its panes, and holds the sentences in them to `keysFor` of
 * that same screen. Scanning the source for `empty:` would find the same
 * strings and have nothing to check them against.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  SCREEN_IDS,
  fakeService,
  screenById,
  type FakeResponses,
  type ScreenId,
  type ScreenStateBase,
} from "@svatah/yam-screens";
import { paneModel } from "../src/rows.js";
import { keysFor } from "../src/keys.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = JSON.parse(
  readFileSync(join(HERE, "..", "..", "screens", "test", "fixtures", "fixtures-project.json"), "utf8"),
) as FakeResponses;

const PARAMS: Partial<Record<ScreenId, Record<string, string>>> = {
  run: { runId: "comp" },
  flows: { file: "flows/guards-and-compensation.flow" },
};

/**
 * The keys that are always there, on every screen.
 *
 * Pane navigation is the cockpit's own chrome — the arrows move the cursor in
 * whichever pane has focus, `?` opens the key map, `Enter` runs what is under
 * the cursor. `keysFor` lists a screen's *actions*, which is a different table.
 */
const EVERYWHERE = new Set(["↑↓", "↑", "↓", "?", "Enter", "Tab", "esc", "^k"]);

/**
 * Every key a sentence tells you to press.
 *
 * A *key*, not a control: "Press Recheck targets to ask again" names a button,
 * and the model writes that sentence for both renderers. So what counts is one
 * character, or `^` and one character, or one of the keys that has a word for a
 * name. Anything longer is something with a label, and a label is checked by
 * `EX-06` rather than here.
 */
function keysNamed(text: string): string[] {
  const named = /^(\^?[A-Za-z0-9?↑↓]|esc|Enter|Tab|Space)$/;
  const out: string[] = [];
  for (const match of text.matchAll(/press ([^\s,.;·]+)/gi)) {
    if (named.test(match[1]!)) out.push(match[1]!);
  }
  /* "press a to accept one, x to reject it" — the second key has no verb. */
  for (const match of text.matchAll(/,\s*(\^?[A-Za-z0-9]) to /g)) out.push(match[1]!);
  return out;
}

describe("a cockpit zero state names only keys the screen has (CX-01)", () => {
  for (const screen of SCREEN_IDS) {
    it(`${screen}`, async () => {
      const state = (await screenById(screen).load(
        fakeService(FIXTURES),
        PARAMS[screen] ?? {},
      )) as ScreenStateBase;
      const panes = paneModel(state);
      const bound = new Set(keysFor(screen).map((one) => one.key));

      const wrong: string[] = [];
      for (const [where, pane] of Object.entries(panes)) {
        const empty = (pane as { empty?: string }).empty ?? "";
        for (const key of keysNamed(empty)) {
          if (EVERYWHERE.has(key) || bound.has(key)) continue;
          wrong.push(`${screen}/${where}: "${empty}" names ${key}, which is bound to nothing here`);
        }
      }
      expect(wrong, wrong.join("\n")).toEqual([]);
    });
  }

  it("finds the keys a sentence names, or it is checking nothing", () => {
    expect(keysNamed("press c to connect something")).toEqual(["c"]);
    expect(keysNamed("press a to accept one, x to reject it")).toEqual(["a", "x"]);
    expect(keysNamed("press ^s to save")).toEqual(["^s"]);
    expect(keysNamed("run a flow and it lands here")).toEqual([]);
    /* A control, not a key: the model writes this sentence for both renderers. */
    expect(keysNamed("Press Recheck targets to ask again")).toEqual([]);
  });

  it("would have caught the five that were written: shown to bite (EX-N3)", () => {
    /*
     * The sentences as E3.1 first produced them, each naming a key bound on
     * another screen. If the rule cannot find these it found nothing, and the
     * fourteen it did find were luck.
     */
    const wrong = [
      { screen: "session" as ScreenId, text: "no gateway · press g to choose one" },
      { screen: "agents" as ScreenId, text: "no agent has called a tool yet · press s to serve them over MCP" },
      { screen: "api" as ScreenId, text: "no request in api/ · press n to name one" },
      { screen: "data" as ScreenId, text: "data.yaml is empty · press i to add a value" },
      { screen: "runs" as ScreenId, text: "no runs yet · press r to run a flow" },
    ];
    for (const one of wrong) {
      const bound = new Set(keysFor(one.screen).map((each) => each.key));
      const named = keysNamed(one.text).filter((key) => !EVERYWHERE.has(key) && !bound.has(key));
      expect(named, `"${one.text}" would have passed on ${one.screen}`).not.toEqual([]);
    }
  });
});
