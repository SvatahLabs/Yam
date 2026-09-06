/**
 * T8.3 Validate — the dialog lint's golden entries (Draft 2.9 LLD §3.2, §4.2).
 *
 * `evals/compiler/lint.jsonl` is the compiler golden set's counterpart for the
 * warnings that need a whole *story* rather than a sentence: the codes
 * `W_DIALOG_UNARMED` and `W_DIALOG_NEVER_OPENED` are about the order two steps
 * are written in, and no sentence-to-`Step` pair can express an order.
 *
 * The last test is the Validate item that matters most — "the reference's own
 * examples lint clean" — and it reads them out of `docs/flow-language.md`
 * rather than repeating them here. Pattern 21 was wrong in the reference for
 * two phases while every test in the repository passed (P7-F3); a check that
 * quoted the doc instead of reading it would have kept passing through that.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { compile, lintPlan } from "@svatah/compiler";
import { readProject } from "@svatah/spec";
import { fromRoot } from "../src/repo.js";

interface LintEntry {
  readonly id: string;
  readonly codes: readonly string[];
  readonly why: string;
  readonly flow: string;
}

const entries: LintEntry[] = readFileSync(fromRoot("evals", "compiler", "lint.jsonl"), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "")
  .map((line) => JSON.parse(line) as LintEntry);

/** The warnings `svatah lint` reports for one flow file. */
function warnings(flow: string): string[] {
  const { project } = readProject({ flows: [{ file: "flows/a.flow", text: flow }], env: {} });
  const { plan, diagnostics } = compile({ project, projectName: "lint-golden", stable: true });
  const errors = diagnostics.filter((one) => one.severity === "error");
  expect(errors.map((one) => `${one.code}: ${one.message}`)).toEqual([]);
  return lintPlan(plan).map((one) => one.code);
}

describe("evals/compiler/lint.jsonl", () => {
  it("has unique, sequential ids", () => {
    const ids = entries.map((one) => one.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual([...ids].sort());
  });

  it("covers both dialog codes, in both directions", () => {
    const all = entries.flatMap((one) => one.codes);
    expect(all).toContain("W_DIALOG_UNARMED");
    expect(all).toContain("W_DIALOG_NEVER_OPENED");
    expect(entries.some((one) => one.codes.length === 0)).toBe(true);
  });

  it.each(entries.map((one) => [one.id, one.why] as const))(
    "%s — %s",
    (id) => {
      const entry = entries.find((one) => one.id === id)!;
      expect(warnings(entry.flow).sort()).toEqual([...entry.codes].sort());
    },
  );
});

describe("the reference's own pattern 21 examples (T8.3)", () => {
  const doc = readFileSync(fromRoot("docs", "flow-language.md"), "utf8");
  const section = doc.slice(
    doc.indexOf("### Pattern 21 — Dialogs"),
    doc.indexOf("### Pattern 22 — Read and capture"),
  );

  /** Every fenced block in the section that is a flow rather than JSON. */
  const flows = [...section.matchAll(/```\n([\s\S]*?)```/g)]
    .map((match) => match[1]!)
    .filter((block) => block.startsWith("story:") || block.startsWith("//"));

  it("says a dialog step arms the next dialog, and shows the order", () => {
    expect(section).toContain("arms the answer\nfor the next one the page opens");
    expect(section).toContain("W_DIALOG_UNARMED");
    expect(section).toContain("W_DIALOG_NEVER_OPENED");
    expect(section).toContain('"armed": false');
  });

  it("shows at least two correct examples and one wrong one", () => {
    expect(flows.length).toBeGreaterThanOrEqual(3);
  });

  it.each(flows.map((flow, at) => [at, flow] as const))(
    "example %i lints clean unless it is the one labelled wrong",
    (_at, flow) => {
      const wrong = flow.startsWith("//");
      const codes = warnings(flow);
      if (wrong) {
        // The reference's counter-example is the defect, and it must lint as
        // one — otherwise the paragraph explaining it is not about anything.
        expect(codes).toContain("W_DIALOG_UNARMED");
      } else {
        expect(codes).toEqual([]);
      }
    },
  );
});
