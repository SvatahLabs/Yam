/**
 * The check catalogue covers what it claims to (T11.4, REQ-SELF-2, LLD §13.9).
 *
 * T11.4's Validate: "every Playwright case of `apps/desktop/test/shell.spec.ts` has
 * a self story with the same check id; every check has both implementations or
 * names why one is unreachable."
 *
 * The second half is the one worth guarding. A catalogue where an unreachable
 * side says "not done yet" is a catalogue that has stopped being a to-do list
 * and become an excuse; LLD §13.9 asks every one to name "the adapter or step
 * Yam lacks", and this is what holds it to that.
 *
 * Nothing here runs a check. `yam eval self` does that, and it takes
 * minutes; what this asserts is that the *catalogue* and the suites it names
 * have not drifted apart — which is the failure that would make a green gate
 * meaningless.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { vitestCaseNames } from "@svatah/yam";
import { fromRoot } from "../src/repo.js";

interface Side {
  readonly source?: string;
  readonly name?: string;
  readonly project?: string;
  readonly unreachable?: string;
}
interface Check {
  readonly id: string;
  readonly says: string;
  readonly yam?: Side;
  readonly external?: Side;
  readonly externalByDesign?: string;
}

const catalogue = parseYaml(readFileSync(fromRoot("evals/self/checks.yaml"), "utf8")) as {
  checks: Check[];
};
const checks = catalogue.checks;

/** Every `test("…")` title in the app's Playwright spec. */
function playwrightTitles(): string[] {
  const source = readFileSync(fromRoot("apps/desktop/test/shell.spec.ts"), "utf8");
  const out: string[] = [];
  for (const match of source.matchAll(/^\s*test(?:\.each\([^)]*\))?\(\s*(["'`])((?:[^\\]|\\.)*?)\1/gm)) {
    const title = match[2]!;
    /*
     * A parameterised title is not a case name. `test.each` carries `%s` and a
     * `for` loop over screens carries `${screen}`; the runner expands both, and
     * the catalogue names the expansions — which the next case checks.
     */
    if (title.includes("%s") || title.includes("${")) continue;
    out.push(title);
  }
  return out;
}

describe("the catalogue and the suites agree (T11.4)", () => {
  it("has a check for every Playwright case of the app's spec", () => {
    const named = new Set(
      checks
        .filter((one) => one.external?.source === "app-playwright")
        .map((one) => one.external!.name),
    );
    const missing = playwrightTitles().filter((one) => !named.has(one));
    expect(
      missing,
      `these Playwright cases have no check in evals/self/checks.yaml:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("names no Playwright case the spec does not have", () => {
    /*
     * The other direction, and it is the one that rots: a case renamed in the
     * spec leaves the catalogue naming a title nothing answers to, and the gate
     * would report it `unreachable` — a shortcoming of Yam's, which it is
     * not. `yam eval self` says so at run time; this says so in a second.
     */
    const titles = new Set([
      ...playwrightTitles(),
      // `test.each` expansions: twelve screens, one title each.
      ...[
        "flows", "runs", "bindings", "agents", "api", "data", "import",
        "settings", "record", "run", "heal", "explorer",
      ].map((one) => `${one} opens and every control on it is named and id'd`),
    ]);
    const invented = checks
      .filter((one) => one.external?.source === "app-playwright")
      .map((one) => one.external!.name!)
      .filter((one) => !titles.has(one));
    expect(invented, `the catalogue names cases the spec does not have: ${invented.join("; ")}`)
      .toEqual([]);
  });

  it("gives every check both sides, or says why one is missing", () => {
    const silent = checks.filter((one) => {
      for (const side of [one.yam, one.external]) {
        if (side === undefined) return true;
        const has = side.source !== undefined && side.name !== undefined;
        if (!has && (side.unreachable ?? "").trim() === "") return true;
      }
      return false;
    });
    expect(
      silent.map((one) => one.id),
      "a check with a side that neither runs nor says why",
    ).toEqual([]);
  });

  it("makes every `unreachable` name what Yam lacks, not how it feels", () => {
    /*
     * LLD §13.9: "every one names the adapter or step Yam lacks". A reason
     * is a sentence somebody could implement from; "not yet" is not one.
     */
    const weak = checks
      .filter((one) => one.yam?.unreachable !== undefined)
      .filter((one) => {
        const why = one.yam!.unreachable!;
        /*
         * An oracle REQ-SELF-3 keeps external says so in three words, and the
         * paragraph explaining it is `externalByDesign` — where a reader looks
         * for it, and where the report prints it from.
         */
        if (one.externalByDesign !== undefined) return !/REQ-SELF-3/.test(why);
        if (why.length < 60) return true;
        return !/adapter|sentence|language|action|step|pattern|surface|command|resize|set|program/i.test(
          why,
        );
      });
    expect(
      weak.map((one) => one.id),
      "an `unreachable` that does not name the adapter or the step Yam lacks",
    ).toEqual([]);
  });

  it("has the three oracles REQ-SELF-3 keeps external, and only those", () => {
    const byDesign = checks
      .filter((one) => one.externalByDesign !== undefined)
      .map((one) => one.id)
      .sort();
    expect(byDesign).toEqual([
      "oracle.axe-sheet",
      "oracle.healing-ground-truth",
      "oracle.tree-agreement",
    ]);
    // Each says why, in the requirement's own terms.
    for (const one of checks.filter((check) => check.externalByDesign !== undefined)) {
      expect(one.externalByDesign, one.id).toContain("REQ-SELF-3");
    }
  });

  it("has an id for every check, and no two the same", () => {
    const ids = checks.map((one) => one.id);
    expect(new Set(ids).size, `duplicate check ids: ${ids.join(", ")}`).toBe(ids.length);
    for (const one of checks) {
      expect(one.id, "a check with no id").toBeTruthy();
      expect(one.says.length, `${one.id} says nothing`).toBeGreaterThan(10);
    }
  });

  it("names only sources the gate has", () => {
    /*
     * A source in the catalogue that the gate does not know is every check it
     * carries reported `unreachable` for a reason that is a typo. The gate says
     * so at run time; this says so in a second, which is where a typo belongs.
     */
    const gate = readFileSync(fromRoot("packages/cli/src/commands/eval-self.ts"), "utf8");
    const known = new Set(
      [...gate.matchAll(/^\s{4}"?([a-z-]+)"?:\s*(?:yamSource|playwrightSource|vitestSource|commandSource)/gm)].map(
        (one) => one[1]!,
      ),
    );
    expect(known.size, "no sources found in the gate").toBeGreaterThan(5);
    const used = new Set(
      checks.flatMap((one) => [one.yam?.source, one.external?.source]).filter(Boolean),
    );
    const unknown = [...used].filter((one) => !known.has(one as string));
    expect(unknown, `the catalogue names sources the gate has not: ${unknown.join(", ")}`).toEqual([]);
  });
});

/* ── every external name is one its source reports (P11-F2) ───────────────── */

/**
 * The nested case names one vitest file reports, read from its source.
 *
 * The Phase 11 verification found two checks the gate said "neither side could
 * look" about, when the external side had run and passed: the catalogue named
 * them `describe > it` and the gate matched on vitest's `fullName`, which joins
 * the same parts with a space. The runner matches on the parts now
 * (`vitestCaseNames`), and this is the half that says so in a second rather
 * than in the eight minutes the gate takes — a renamed `it` is a one-sided row
 * in a published report otherwise, and reads as a shortcoming of Yam's.
 *
 * Read from the source rather than by running it, because running
 * `tui-pty.test.ts` spawns pseudo-terminals. A `describe` block opens at column
 * zero and its `it`s are indented, which is what `prettier` guarantees here.
 */
function vitestTitles(file: string): string[] {
  const source = readFileSync(fromRoot(file), "utf8");
  const out: string[] = [];
  let ancestor: string | undefined;
  for (const line of source.split("\n")) {
    const block = /^describe(?:\.\w+\([^)]*\))?\(\s*(["'`])((?:[^\\]|\\.)*?)\1/.exec(line);
    if (block !== null) {
      ancestor = block[2];
      continue;
    }
    const test = /^\s+it(?:\.\w+\([^)]*\))?\(\s*(["'`])((?:[^\\]|\\.)*?)\1/.exec(line);
    if (test !== null) {
      out.push(...vitestCaseNames({ ancestorTitles: ancestor === undefined ? [] : [ancestor], title: test[2]! }));
    }
  }
  return out;
}

/**
 * Every story the self project declares, read from every flow it has.
 *
 * Read from the directory rather than from a list of file names: T12.7 added
 * two flows, and a list would have to be edited for a third — which is the kind
 * of check that goes quietly out of date and then passes for the wrong reason.
 */
function storyNames(): string[] {
  const dir = fromRoot("evals/self/flows");
  const out: string[] = [];
  for (const file of readdirSync(dir).filter((one) => one.endsWith(".flow"))) {
    const source = readFileSync(join(dir, file), "utf8");
    for (const match of source.matchAll(/^\s*(?:story|scenario)\s*(?:\([^)]*\))?\s*:\s*(.+)$/gm)) {
      out.push(match[1]!.trim());
    }
  }
  return out;
}

/** The single name each `commandSource` in the gate answers to. */
function commandSourceNames(): Map<string, string> {
  const gate = readFileSync(fromRoot("packages/cli/src/commands/eval-self.ts"), "utf8");
  const out = new Map<string, string>();
  for (const match of gate.matchAll(
    /^\s{4}"?([a-z-]+)"?:\s*commandSource\(\s*\n\s*"([^"]+)"/gm,
  )) {
    out.set(match[1]!, match[2]!);
  }
  return out;
}

describe("every external name is one its source reports (P11-F2)", () => {
  it("names two pseudo-terminal cases the cockpit's spec actually has", () => {
    const titles = new Set(vitestTitles("tools/repo-checks/test/tui-pty.test.ts"));
    const named = checks
      .filter((one) => one.external?.source === "tui-pty")
      .map((one) => one.external!.name!);
    expect(named.length, "the two cockpit checks are gone from the catalogue").toBe(2);
    const invented = named.filter((one) => !titles.has(one));
    expect(
      invented,
      "the catalogue names cockpit cases `tui-pty.test.ts` does not have — " +
        `it reports:\n  ${[...titles].filter((one) => one.includes(" > ")).join("\n  ")}`,
    ).toEqual([]);
  });

  it("names a story the self project has, on every `yam` side", () => {
    const stories = new Set(storyNames());
    // Only the flow sources name stories; a command source on the `yam` side
    // (the front door, T14.6) answers to its own one name, checked below.
    const invented = checks
      .filter((one) => one.yam?.source === "yam" || one.yam?.source === "yam-cdp")
      .map((one) => one.yam!.name!)
      .filter((one) => !stories.has(one));
    expect(invented, `the catalogue names stories the self flows do not have: ${invented.join("; ")}`)
      .toEqual([]);
  });

  it("names each command source by the one name that source answers to", () => {
    const byName = commandSourceNames();
    expect(byName.size, "no command sources found in the gate").toBeGreaterThan(3);
    const wrong: string[] = [];
    for (const one of checks) {
      for (const side of [one.yam, one.external]) {
        const expected = side?.source === undefined ? undefined : byName.get(side.source);
        if (expected === undefined) continue;
        if (side!.name !== expected) wrong.push(`${one.id}: "${side!.name}" ≠ "${expected}"`);
      }
    }
    expect(wrong, "a command source named by something it does not answer to").toEqual([]);
  });
});
