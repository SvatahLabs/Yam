/**
 * The cockpit's key map (TV-M03, TV-07).
 *
 * Keys left the model in TV-M03, so "a screen binds no unknown action" became a
 * question about *this* renderer's table rather than about the shared one — and
 * it is asked here, of the table the footer, the `?` overlay and
 * `yam ui --keys --json` are all generated from.
 *
 * What is not asserted is that the app binds the same keys. It does not, and it
 * should not: a terminal cannot be sent a `⌘↵`. The two renderers agree about
 * *actions*, which `tools/repo-checks/test/action-parity.test.ts` holds them to.
 */
import { describe, expect, it } from "vitest";
import { ACTIONS, SCREEN_IDS, SESSION_MODES, actionsForScreen } from "@svatah/yam-screens";
import { ALL_KEYS, COMMAND_KEYS, actionForKey, keyMap, keysFor, unknownBindings } from "../src/keys.js";

describe("every key names an action that exists", () => {
  it("binds nothing the registry does not have", () => {
    expect(unknownBindings()).toEqual([]);
  });

  it("binds actions the screen offers, or navigation it deliberately reaches", () => {
    /*
     * A screen may bind an action another screen declares, and two do: `runs`
     * binds `go.run` and `heal.run`, which belong to navigation and to the Run
     * screen (Draft 2.12's D6). Inventing an action so that a screen would own
     * the key it binds would be a palette row nothing answers, so what is
     * required is that the action exists — not that this screen declared it.
     */
    const known = new Set(ACTIONS.map((one) => one.id));
    for (const screen of SCREEN_IDS) {
      for (const binding of keysFor(screen)) {
        expect(known.has(binding.action), `${screen} binds ${binding.key} to ${binding.action}`).toBe(true);
      }
    }
    /* And the screen that owns an action is usually the one that binds it. */
    const own = keysFor("run").filter((one) =>
      actionsForScreen("run").some((a) => a.id === one.action),
    );
    expect(own.length).toBeGreaterThan(0);
  });

  it("gives every binding a label, because the `?` overlay is this table", () => {
    for (const one of ALL_KEYS) expect(one.label.length, `${one.screen}/${one.key}`).toBeGreaterThan(0);
  });
});

describe("no screen binds one key to two actions", () => {
  it("has no duplicate within a screen, in any mode it can be in", () => {
    for (const screen of SCREEN_IDS) {
      /*
       * Per mode, not unfiltered: the unfiltered view is what the `?` overlay
       * lists, where `s` appearing twice with two modes beside it is the
       * information rather than the collision.
       */
      for (const mode of SESSION_MODES) {
        const keys = keysFor(screen, mode).map((one) => one.key);
        expect(
          new Set(keys).size,
          `${screen}${mode ? ` in ${mode}` : ""} binds a key twice: ${keys.join(" ")}`,
        ).toBe(keys.length);
      }
    }
  });

  it("declares keys a keypress can actually be", () => {
    /*
     * One character, or `^` and one. `^s` was declared and unreachable until the
     * cockpit learned to read the caret (Draft 2.24); the claim moved here with
     * the table it is about.
     */
    for (const one of ALL_KEYS) {
      expect(one.key, `${one.screen}: ${one.action}`).toMatch(/^\^?[\s\S]$/u);
    }
  });

  it("takes no key the cockpit has already spent (TV-T12)", () => {
    /*
     * `record.stop` was bound to `q`, and the cockpit has always quit on `q`, so
     * that action was reachable in the app and unreachable here — a parity
     * failure inside the file that claimed parity.
     *
     * The rule, rather than the instance: a screen may not bind a key the
     * cockpit itself has spent, because the cockpit's key wins and the screen's
     * is dead. The digits are `1-4` and `j k` is two keys, so the command table
     * is expanded before it is compared.
     */
    const spent = new Set(
      COMMAND_KEYS.flatMap((one) =>
        one.key === "1-4"
          ? ["1", "2", "3", "4"]
          : one.key === "[ ]"
            ? ["[", "]"]
            : one.key.split(" ").filter((part) => part.length === 1),
      ),
    );
    for (const one of ALL_KEYS) {
      expect(
        spent.has(one.key),
        `${one.screen} binds ${one.key} to ${one.action}, which the cockpit has already spent`,
      ).toBe(false);
    }
  });

  it("reaches every action the registry offers (TV-02, TV-T12)", () => {
    /*
     * Reachability is the parity claim: an action the model offers and the
     * cockpit cannot run is an action that exists in one renderer. Every action
     * is in the palette, which `^K` opens from every screen; a key is the
     * shortcut, never the only way.
     */
    const inPalette = new Set(ACTIONS.map((one) => one.id));
    for (const screen of SCREEN_IDS) {
      for (const action of actionsForScreen(screen)) {
        expect(inPalette.has(action.id), `${screen}: ${action.id} is reachable from nowhere`).toBe(true);
      }
    }
    expect(COMMAND_KEYS.some((one) => one.command === "palette.open")).toBe(true);
  });

  it("looks a key up by the screen it was pressed on", () => {
    expect(actionForKey("session", "c")).toBe("surface.connect");
    /* The same letter, two modes, two actions — and never both at once. */
    expect(actionForKey("session", "s", "do")).toBe("surface.refresh");
    expect(actionForKey("session", "s", "record")).toBe("capture.stop");
    expect(actionForKey("run", "s")).toBe("run.stop");
    /* The same letter, a different action, because the screen is different. */
    expect(actionForKey("flows", "h")).toBe("heal.run");
    expect(actionForKey("flows", "!")).toBeUndefined();
  });
});

describe("the key map is one table, with three readers (TV-07)", () => {
  it("prints the cockpit's own keys and the screens' together", () => {
    const map = keyMap();
    expect(map.commands.some((one) => one.key === "^K")).toBe(true);
    expect(map.commands.some((one) => one.key === "?")).toBe(true);
    expect(map.screens["session"]?.some((one) => one.action === "surface.connect")).toBe(true);
  });

  it("gives the mode a key that no region focus takes", () => {
    /*
     * The mock printed `1 record 2 say 3 do` on Session and `1-4 region` on
     * every other board: the same digits, two meanings, on the screen that has
     * both. The digits stayed with the regions.
     */
    const mode = COMMAND_KEYS.find((one) => one.command === "mode.next");
    expect(mode, "no key cycles the mode").toBeDefined();
    expect(mode!.key).not.toMatch(/^[0-9]$/);
    expect(COMMAND_KEYS.filter((one) => one.key === mode!.key)).toHaveLength(1);
  });

  it("advertises no command key twice", () => {
    const keys = COMMAND_KEYS.map((one) => one.key);
    expect(new Set(keys).size, keys.join(" ")).toBe(keys.length);
  });
});

describe("the session screen keeps what both halves bound (TV-M01)", () => {
  it("reaches the surface half and the record half from one screen", () => {
    const bound = keysFor("session").map((one) => one.action);
    expect(bound).toContain("surface.connect");
    expect(bound).toContain("record.accept");
  });

  it("names no action outside the registry, for any screen", () => {
    const known = new Set(ACTIONS.map((one) => one.id));
    for (const one of ALL_KEYS) expect(known.has(one.action), `${one.screen}/${one.action}`).toBe(true);
  });
});
