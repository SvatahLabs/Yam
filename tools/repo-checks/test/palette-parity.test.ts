/**
 * T9.4 Validate — "the same action ids appear in both palettes" (REQ-ADE-10,
 * REQ-TUI-1, LLD §13.7).
 *
 * Both palettes are built from `ACTIONS`, so the claim is really "neither
 * renderer filters the list, and neither adds to it". That is a property of two
 * source files, and it is checked by reading them: the app's `Shell.tsx` and the
 * TUI's `app.tsx`.
 *
 * A test that rendered both and compared the visible rows would compare two
 * *viewports* — the app's palette scrolls and the TUI's shows eight rows — so it
 * would pass with a renderer that silently dropped everything below the fold.
 * `packages/tui/test/cockpit.test.tsx` and `apps/desktop/test/shell.spec.ts` are
 * where each palette is opened and its rows read; this is where the two are held
 * to the same source.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ACTIONS } from "@svatah/yam-screens";
import { EVENT_KINDS } from "@svatah/yam-sdk";
import { fromRoot } from "../src/repo.js";

const APP_DIR = readFileSync(fromRoot("apps/desktop/src/renderer/shell/Shell.tsx"), "utf8");
const TUI = readFileSync(fromRoot("packages/tui/src/app.tsx"), "utf8");

describe("both palettes are the one registry (T9.4)", () => {
  it("builds its rows from ACTIONS, in each renderer", () => {
    // The app maps the whole list; the TUI filters it by the typed query only.
    expect(APP_DIR).toMatch(/ACTIONS\.map\(/);
    expect(TUI).toMatch(/ACTIONS\.filter\(/);
  });

  it("neither renderer writes an action id of its own", () => {
    /*
     * Every `"<area>.<name>"` string literal in a renderer must be an id the
     * registry has — or an event kind. A renderer that invented
     * `"run.everything"` would put a row in one palette and not the other, which
     * is the failure mode REQ-ADE-10 exists to stop and the one a rendering test
     * cannot see. The event kinds share the shape and are not actions:
     * `run.summary` and `step.result` are what the *stream* carries, and a
     * renderer folding one is doing its job.
     */
    const known = new Set<string>([...ACTIONS.map((one) => one.id), ...EVENT_KINDS]);
    for (const [name, source] of [
      ["the app", APP_DIR],
      ["yam ui", TUI],
    ] as const) {
      const mentioned = [...source.matchAll(/"([a-z]+\.[a-z][a-z-]*)"/g)].map((match) => match[1]!);
      const invented = [...new Set(mentioned)].filter((one) => !known.has(one));
      expect(invented, `${name} names ${invented.join(", ")}, which the registry does not have`).toEqual(
        [],
      );
    }
  });

  it("neither renderer hides a group", () => {
    /*
     * `Actions` then `Go to` (§13.7). The app draws the headings, because it has
     * the room; `yam ui` lists the same rows in the same order without them,
     * which is what the `TUI` artboard shows. What neither may do is *filter* on
     * the group — that would make every screen but its own unreachable from the
     * palette.
     */
    expect(APP_DIR).toContain("group: action.group");
    expect(TUI).not.toMatch(/\.group\s*[=!]==?\s*"(Actions|Go to)"/);
    expect(TUI).toMatch(/ACTIONS\.filter\(\(action\) => \{\s*if \(query === ""\) return true;/);
  });

  it("shows the CLI command beside a CLI-backed row, in both", () => {
    // "each row showing the action's key and, for CLI-backed actions, the CLI
    // command" (§13.7). It is what makes the palette teach the command line.
    expect(APP_DIR).toMatch(/cli: action\.cli/);
    expect(TUI).toMatch(/cli: action\.cli/);
  });

  it("opens on ⌘K in the app and ^K in the terminal", () => {
    expect(APP_DIR).toMatch(/event\.key\.toLowerCase\(\) === "k"/);
    expect(APP_DIR).toMatch(/metaKey \|\| event\.ctrlKey/);
    expect(TUI).toMatch(/key\.ctrl && input === "k"/);
  });

  it("runs an action through the registry rather than through a switch", () => {
    for (const [name, source] of [
      ["the app", APP_DIR],
      ["yam ui", TUI],
    ] as const) {
      expect(source, `${name} does not resolve actions by id`).toContain("actionById(");
      expect(source, `${name} does not ask whether an action is available`).toContain(
        "availableWhen(",
      );
    }
  });

  it("opens on the same screen in both renderers (TV-14)", () => {
    /*
     * Draft 2.25 made Session the default destination; the app honoured it and
     * the cockpit did not, and nothing noticed because nothing compared them.
     * The default is read out of each renderer's own source here, so the two
     * cannot drift again without this failing.
     */
    const app = /useState<Showing>\("(\w+)"\)/.exec(APP_DIR)?.[1];
    const cockpit = /DEFAULT_SCREEN: ScreenId = "(\w+)"/.exec(
      readFileSync(fromRoot("packages/tui/src/keys.ts"), "utf8"),
    )?.[1];
    expect(app, "the app declares no default screen").toBeDefined();
    expect(cockpit, "the cockpit declares no default screen").toBeDefined();
    expect(cockpit, `the app opens on ${app ?? "?"} and the cockpit on ${cockpit ?? "?"}`).toBe(app);
  });

  it("binds its keys from its own table, and names actions from the one registry", () => {
    /*
     * TV-M03 reversed this check's premise, deliberately. A key used to be
     * attached to an action in the shared model, and both renderers read that
     * one table — which meant a terminal was reading the app's `⌘↵`, a
     * keystroke it cannot be sent. Each renderer decides its own keys now, so
     * what is required is the opposite: neither may reach into the model for a
     * key table, and both must bind actions the registry declares.
     */
    for (const [name, source] of [
      ["the app", APP_DIR],
      ["the cockpit", TUI],
    ] as const) {
      expect(source, `${name} still reads a key table off the model`).not.toMatch(
        /screenById\([\w.]+\)\.keys/,
      );
      expect(source, `${name} does not use its own key table`).toMatch(/from "\.\/keys\.js"/);
    }
  });
});
