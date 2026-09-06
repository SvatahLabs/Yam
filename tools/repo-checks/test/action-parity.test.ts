/**
 * T9.1 Validate — the action parity check (REQ-ADE-10, LLD §13.7).
 *
 * > A repository check reads the registry, the CLI's command table, and the
 * > palette fixture and fails when an action's id, label, or CLI command differs
 * > between them.
 *
 * > the same list is what the command palette shows, what the SDK exposes as
 * > `actions`, and what the CLI has a command for; the repository check asserts
 * > the three agree by id.
 *
 * ## The three sources, and why none of them is generated from another
 *
 * 1. **The registry** — `@svatah/screens`'s `ACTIONS`. The thing itself.
 * 2. **The CLI's command table** — `packages/cli/src/cli.ts`'s `USAGE` block and
 *    its dispatch, read from the source. Not a copy of the registry: it is the
 *    list of commands the CLI *has*, which existed before the registry did. An
 *    action whose `cli` names a command the CLI does not dispatch is a palette
 *    row promising something nobody can type.
 * 3. **The palette fixture** — `packages/screens/fixtures/palette.json`,
 *    maintained by hand. This is the copy that catches a *rename*: a check that
 *    generated the fixture from the registry would compare the registry with
 *    itself and pass whatever anyone called anything.
 *
 * The Validate item also asks that "a deliberately renamed action makes it
 * fail". That is not a claim about a file on disk, so it is exercised here
 * against a renamed copy of the real data rather than by editing the repository
 * and hoping the test runs before the edit is undone.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { ACTIONS, SCREEN_IDS, type Action } from "@svatah/screens";
import { fromRoot } from "../src/repo.js";

/* ── source 2: the CLI's own command table ────────────────────────────────── */

const CLI_SOURCE = readFileSync(fromRoot("packages/cli/src/cli.ts"), "utf8");
const BINDINGS_CLI_SOURCE = readFileSync(
  fromRoot("packages/bindings-cli/src/cli.ts"),
  "utf8",
);

/**
 * Every `svatah <command>` line in the usage block.
 *
 * The usage block is the CLI's table (LLD §15) as a person reads it, and the
 * dispatch below is the same table as the program reads it. A command has to be
 * in both to count: one without the other is either an undocumented command or
 * a documented one that answers "unknown command".
 */
const documented = new Set(
  [...CLI_SOURCE.matchAll(/^\s{2}svatah ([a-z-]+)/gm)].map((match) => match[1]!),
);

/**
 * Every command the program actually dispatches.
 *
 * Module (b)'s `switch` in `runModuleB`, the three `eval` subcommands and
 * `surface doctor` intercepted before it, and module (a)'s own table in
 * `@svatah/bindings-cli` — which is where `bindings`, `heal`, `surface` and
 * `eval healing` live, because `svatah-bindings` is a second executable over the
 * same functions.
 */
const dispatched = new Set([
  ...[...CLI_SOURCE.matchAll(/^\s{4}case "([a-z-]+)":/gm)].map((match) => match[1]!),
  ...[...CLI_SOURCE.matchAll(/command === "([a-z-]+)"/g)].map((match) => match[1]!),
  ...[...BINDINGS_CLI_SOURCE.matchAll(/case "([a-z-]+)":/g)].map((match) => match[1]!),
  ...[...BINDINGS_CLI_SOURCE.matchAll(/command === "([a-z-]+)"/g)].map((match) => match[1]!),
]);

/* ── source 3: the palette fixture ────────────────────────────────────────── */

interface PaletteRow {
  id: string;
  label: string;
  group: string;
  screen: string;
  key?: string;
  cli?: string;
}

const PALETTE = (
  JSON.parse(readFileSync(fromRoot("packages/screens/fixtures/palette.json"), "utf8")) as {
    actions: PaletteRow[];
  }
).actions;

/** The comparable projection of an action: what the check is about. */
const shapeOf = (one: Action | PaletteRow): string =>
  JSON.stringify({
    id: one.id,
    label: one.label,
    group: one.group,
    screen: one.screen,
    key: one.key ?? null,
    cli: one.cli ?? null,
  });

/**
 * The parity check itself, as a function, so the renamed-action case can run it
 * against altered data instead of against the repository.
 */
export function parityFailures(
  registry: ReadonlyArray<Action | PaletteRow>,
  palette: readonly PaletteRow[],
): string[] {
  const failures: string[] = [];
  const byId = new Map(palette.map((one) => [one.id, one]));

  for (const action of registry) {
    const row = byId.get(action.id);
    if (row === undefined) {
      failures.push(`${action.id} is in the registry and not in the palette fixture`);
      continue;
    }
    if (shapeOf(action) !== shapeOf(row)) {
      failures.push(`${action.id} differs: registry ${shapeOf(action)} vs palette ${shapeOf(row)}`);
    }
  }
  for (const row of palette) {
    if (!registry.some((action) => action.id === row.id)) {
      failures.push(`${row.id} is in the palette fixture and not in the registry`);
    }
  }
  return failures;
}

describe("the action registry, the palette fixture and the CLI agree (T9.1)", () => {
  it("has the same actions, with the same ids, labels, keys and CLI commands", () => {
    expect(parityFailures(ACTIONS, PALETTE)).toEqual([]);
  });

  it("names, for every CLI-backed action, a command the CLI documents and dispatches", () => {
    for (const action of ACTIONS) {
      if (action.cli === undefined) continue;
      const words = action.cli.split(/\s+/);
      expect(words[0], `${action.id}: "${action.cli}" does not start with svatah`).toBe("svatah");
      const command = words[1]!;
      expect(
        documented.has(command),
        `${action.id}: \`svatah ${command}\` is not in the CLI's usage block`,
      ).toBe(true);
      expect(
        dispatched.has(command),
        `${action.id}: \`svatah ${command}\` is not dispatched by the CLI`,
      ).toBe(true);
    }
  });

  it("gives every action a screen that exists, and a label a person would say", () => {
    for (const action of ACTIONS) {
      expect(SCREEN_IDS, `${action.id}`).toContain(action.screen);
      expect(action.label.length, `${action.id} has no label`).toBeGreaterThan(1);
      // "Same list, same names, everywhere": a label is a sentence fragment a
      // person reads, not an id with the dots taken out.
      expect(action.label, `${action.id}`).not.toMatch(/^[a-z]+\.[a-z]/);
      expect(action.id, `${action.id} is not <area>.<name>`).toMatch(/^[a-z]+\.[a-z][a-z-]*$/);
    }
  });

  it("has one entry per id in each source", () => {
    expect(new Set(ACTIONS.map((one) => one.id)).size).toBe(ACTIONS.length);
    expect(new Set(PALETTE.map((one) => one.id)).size).toBe(PALETTE.length);
  });

  it("gives every screen a Go to row, so no screen is unreachable from the palette", () => {
    for (const id of SCREEN_IDS) {
      expect(
        ACTIONS.some((one) => one.id === `go.${id}` && one.group === "Go to"),
        `no palette row goes to ${id}`,
      ).toBe(true);
    }
  });
});

describe("a deliberately renamed action fails the check (T9.1 Validate)", () => {
  it("fails on a renamed id", () => {
    const renamed = ACTIONS.map((one) =>
      one.id === "heal.run" ? { ...one, id: "heal.repair" } : one,
    );
    const failures = parityFailures(renamed, PALETTE);
    expect(failures.join("\n")).toContain("heal.repair is in the registry");
    expect(failures.join("\n")).toContain("heal.run is in the palette fixture");
  });

  it("fails on a renamed label, which is the rename a reader would not notice", () => {
    const renamed = ACTIONS.map((one) =>
      one.id === "bindings.verify" ? { ...one, label: "Check bindings" } : one,
    );
    const failures = parityFailures(renamed, PALETTE);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("bindings.verify differs");
    expect(failures[0]).toContain("Check bindings");
  });

  it("fails on a changed CLI command", () => {
    const renamed = ACTIONS.map((one) =>
      one.id === "run.flow" ? { ...one, cli: "svatah execute --flow <file>" } : one,
    );
    const failures = parityFailures(renamed, PALETTE);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain("run.flow differs");
  });

  it("fails on an action added to one source and not the others", () => {
    const failures = parityFailures(ACTIONS, [
      ...PALETTE,
      { id: "flows.publish", label: "Publish", group: "Actions", screen: "flows" },
    ]);
    expect(failures).toEqual(["flows.publish is in the palette fixture and not in the registry"]);
  });

  it("fails when an action names a CLI command the CLI does not have", () => {
    // The same rule the second test above applies, shown to bite.
    expect(documented.has("execute")).toBe(false);
    expect(dispatched.has("execute")).toBe(false);
  });
});
