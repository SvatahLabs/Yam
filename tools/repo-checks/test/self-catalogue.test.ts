/**
 * The check catalogue covers what it claims to (T11.4, REQ-SELF-2, LLD §13.9).
 *
 * T11.4's Validate: "every Playwright case of `apps/ade/test/shell.spec.ts` has
 * a self story with the same check id; every check has both implementations or
 * names why one is unreachable."
 *
 * The second half is the one worth guarding. A catalogue where an unreachable
 * side says "not done yet" is a catalogue that has stopped being a to-do list
 * and become an excuse; LLD §13.9 asks every one to name "the adapter or step
 * Svatah lacks", and this is what holds it to that.
 *
 * Nothing here runs a check. `svatah eval self` does that, and it takes
 * minutes; what this asserts is that the *catalogue* and the suites it names
 * have not drifted apart — which is the failure that would make a green gate
 * meaningless.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
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
  readonly svatah?: Side;
  readonly external?: Side;
  readonly externalByDesign?: string;
}

const catalogue = parseYaml(readFileSync(fromRoot("evals/self/checks.yaml"), "utf8")) as {
  checks: Check[];
};
const checks = catalogue.checks;

/** Every `test("…")` title in the ADE's Playwright spec. */
function playwrightTitles(): string[] {
  const source = readFileSync(fromRoot("apps/ade/test/shell.spec.ts"), "utf8");
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
  it("has a check for every Playwright case of the ADE's spec", () => {
    const named = new Set(
      checks
        .filter((one) => one.external?.source === "ade-playwright")
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
     * would report it `unreachable` — a shortcoming of Svatah's, which it is
     * not. `svatah eval self` says so at run time; this says so in a second.
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
      .filter((one) => one.external?.source === "ade-playwright")
      .map((one) => one.external!.name!)
      .filter((one) => !titles.has(one));
    expect(invented, `the catalogue names cases the spec does not have: ${invented.join("; ")}`)
      .toEqual([]);
  });

  it("gives every check both sides, or says why one is missing", () => {
    const silent = checks.filter((one) => {
      for (const side of [one.svatah, one.external]) {
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

  it("makes every `unreachable` name what Svatah lacks, not how it feels", () => {
    /*
     * LLD §13.9: "every one names the adapter or step Svatah lacks". A reason
     * is a sentence somebody could implement from; "not yet" is not one.
     */
    const weak = checks
      .filter((one) => one.svatah?.unreachable !== undefined)
      .filter((one) => {
        const why = one.svatah!.unreachable!;
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
      "an `unreachable` that does not name the adapter or the step Svatah lacks",
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
      [...gate.matchAll(/^\s{4}"?([a-z-]+)"?:\s*(?:svatahSource|playwrightSource|vitestSource|commandSource)/gm)].map(
        (one) => one[1]!,
      ),
    );
    expect(known.size, "no sources found in the gate").toBeGreaterThan(5);
    const used = new Set(
      checks.flatMap((one) => [one.svatah?.source, one.external?.source]).filter(Boolean),
    );
    const unknown = [...used].filter((one) => !known.has(one as string));
    expect(unknown, `the catalogue names sources the gate has not: ${unknown.join(", ")}`).toEqual([]);
  });
});
