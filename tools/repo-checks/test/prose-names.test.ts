/**
 * No sentence names a screen the model does not have (`EX-06`, `AX-14`, E3.4).
 *
 * `screen-ids.test.ts` does the *locator* half: a `#palette-go-record` that can
 * never match. This is the other half, and it is the one a person actually
 * reads. The walkthrough found it on the first screen it looked at: the wall
 * behind seven rail destinations ended *"Surfaces needs no project"*, and
 * Surfaces had been renamed Session in Draft 2.27 (`B4`). Nothing failed,
 * because a sentence is not a selector.
 *
 * The rule is a deny-list rather than a derivation, and deliberately. The set
 * of names the product *has* is derivable — `SCREEN_IDS` and their titles — but
 * "any capitalised word that is not a current screen" would flag Chromium,
 * Playwright, Accessibility and every other proper noun the copy legitimately
 * uses. What can be said precisely is the opposite: these names were retired,
 * on these dates, and nothing a person reads may still say them.
 *
 * Comments are exempt, by the same argument `screen-ids.test.ts` makes: this
 * file's own prose explains the defect by naming it, and a note about a retired
 * name is not a sentence anybody reads on a screen.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SCREEN_IDS, screenById, type ScreenId } from "@svatah/yam-screens";
import { fromRoot, REPO_ROOT, repoPath } from "../src/repo.js";

/**
 * The names that were retired, and what replaced each.
 *
 * The message is the point: a check that says "Surfaces is wrong" leaves the
 * next person to find out what is right.
 */
const RETIRED: Readonly<Record<string, string>> = {
  Surfaces: "Session (Draft 2.27 merged Surfaces and Record)",
  "Record review": "Session in record mode (Draft 2.27)",
  "Surfaces screen": "the Session screen (Draft 2.27)",
  Explorer: "Flows (Draft 2.11)",
  "Project screen": "Settings (Draft 2.11 removed the Project tabs)",
  /*
   * A command, not a screen — and the same defect one layer down.
   *
   * `yam mcp` was removed by PK-05 and the server it became still greeted every
   * agent host with it, and printed it in the handshake an HTTP client parses.
   * Both were rendered strings naming something that answers "it has moved".
   */
  "yam mcp": "`npx -y @svatah/yam-mcp` (PK-05 removed the subcommand)",
};

/** The directories whose strings reach a person. */
const RENDERED = [
  fromRoot("apps/desktop/src/renderer"),
  fromRoot("packages/ui/src"),
  fromRoot("packages/screens/src"),
  fromRoot("packages/tui/src"),
  /*
   * The command line says things to people as well.
   *
   * It was left out of the first cut on the reasoning that `EX-06` is about
   * screens — and `yam surface doctor`'s advice, `yam help`'s topics and every
   * diagnostic are prose a person reads and acts on. A stale screen name is as
   * wrong in a terminal as in a window.
   */
  fromRoot("packages/cli/src"),
  fromRoot("packages/mcp/src"),
];

/**
 * The code, without the prose that explains it or the modules it imports.
 *
 * Two exemptions, each found by this check reporting something that is not a
 * defect. A comment naming a retired screen is a note about history — this
 * file's own does it. And `from "./Surfaces.js"` is a *module*: the file is
 * still called that, and renaming files to satisfy a rule about sentences would
 * be the rule running the codebase.
 */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ")
    .replace(/from\s+"[^"]*"/g, " ")
    .replace(/import\("[^"]*"\)/g, " ");
}

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sources(path));
    else if (/\.tsx?$/.test(entry) && !entry.endsWith(".generated.ts")) out.push(path);
  }
  return out;
}

/**
 * The one place a retired name is the point.
 *
 * `yam mcp` prints where it went, and a message about a removed command has to
 * name the command that was removed — otherwise a person who typed it cannot
 * tell the message is for them. Enumerated by file, with the reason, rather
 * than inferred: "a sentence that explains a rename" is not something a regular
 * expression can be trusted to recognise, and an exemption nobody writes down
 * is an exemption that grows.
 */
const EXPLAINS_THE_MOVE: Readonly<Record<string, string>> = {
  "packages/cli/src/cli.ts": "`yam mcp` answers with where it moved to, and must say what you typed",
};

describe("no rendered sentence names a screen that is gone (EX-06)", () => {
  it("says nothing a person could go looking for and not find", () => {
    const found: string[] = [];
    for (const dir of RENDERED) {
      for (const file of sources(dir)) {
        const text = code(readFileSync(file, "utf8"));
        for (const [name, instead] of Object.entries(RETIRED)) {
          /*
           * A word, not a substring: `SurfacesScreen` is a React component and
           * `Surfaces.js` is a module, and neither is something anybody reads.
           * What is being looked for is the name in a sentence.
           */
          const said = new RegExp(`(^|[^A-Za-z.])${name}([^A-Za-z]|$)`);
          const where = repoPath(file);
          if (said.test(text) && EXPLAINS_THE_MOVE[where] === undefined) {
            found.push(`${where}: "${name}" — it is ${instead}`);
          }
        }
      }
    }
    expect(found, found.join("\n")).toEqual([]);
  });

  it("would have caught the sentence that was there: shown to bite (EX-N3)", () => {
    /*
     * The exact wall, as it read until `AX-04` replaced it. If the rule cannot
     * find this it is finding nothing, and a rule that passes on the text it
     * was written against is the thing `EX-N3` forbids counting.
     */
    const wall =
      'is about a project — its flows, bindings, runs and proposals — and none is open. ' +
      'Choose one with Open a project in the top bar. Surfaces needs no project.';
    const caught = Object.keys(RETIRED).filter((name) =>
      new RegExp(`(^|[^A-Za-z.])${name}([^A-Za-z]|$)`).test(wall),
    );
    expect(caught).toEqual(["Surfaces"]);
  });

  it("exempts only what explains the move, and only what is written down", () => {
    for (const [file, why] of Object.entries(EXPLAINS_THE_MOVE)) {
      expect(why, `${file} is exempt with no reason`).not.toBe("");
      expect(existsSync(join(REPO_ROOT, file)), `${file} is exempt and does not exist`).toBe(true);
    }
    expect(Object.keys(EXPLAINS_THE_MOVE).length, "the exemption list has grown").toBeLessThan(3);
  });

  it("does not flag a name the product still has", () => {
    const current = SCREEN_IDS.map((one: ScreenId) => screenById(one).title);
    for (const title of current) {
      expect(Object.keys(RETIRED), `${title} is a current screen and is on the retired list`)
        .not.toContain(title);
    }
  });
});
