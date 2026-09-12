/**
 * `yam completion` (TV-C01, TV-17).
 *
 * The command table's third reader, after `yam help` and `yam help <command>`.
 * A command that is documented can be completed and one that is not cannot, by
 * construction rather than by somebody remembering both places.
 */
import { describe, expect, it } from "vitest";
import { COMMANDS, completionScript } from "../src/help.js";

describe("the script is generated from the table a person reads", () => {
  it("offers every verb the table documents", () => {
    const script = completionScript();
    const verbs = new Set(COMMANDS.map((one) => one.name.split(" ")[0]!));
    for (const verb of verbs) {
      expect(script, `${verb} cannot be completed`).toContain(verb);
    }
  });

  it("offers a two-word command's second word under its first", () => {
    /*
     * `bindings list` is one command with two words. Completing the first word
     * with "bindings list" would offer a thing nobody can type in one go.
     */
    const script = completionScript();
    const first = script.slice(script.indexOf('local commands="'), script.indexOf("\n", script.indexOf('local commands="')));
    expect(first).toContain("bindings");
    expect(first).not.toContain("bindings list");
    expect(script).toMatch(/bindings\) opts="[^"]*\blist\b/);
  });

  it("offers a command's own flags", () => {
    expect(completionScript()).toMatch(/lint\) opts="[^"]*--json/);
  });

  it("writes both shells, and says it is generated", () => {
    expect(completionScript("bash")).toContain("complete -F _yam yam");
    expect(completionScript("zsh")).toContain("#compdef yam");
    for (const shell of ["bash", "zsh"] as const) {
      expect(completionScript(shell)).toContain("Do not edit");
    }
  });
});
