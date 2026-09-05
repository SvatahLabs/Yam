/**
 * T2.1 — the flow reader (REQ-LANG-1, 2, 3, 9, 10, 13, 14 (parse), LLD §4.1).
 *
 * Validate: "Unit tests per rule; `E_DUP_STORY`, `E_TEST_EMPTY`, signature type
 * errors, `onFailure` value validation."
 *
 * Every test here is about the *file*, never about what a sentence means: the
 * reader's contract stops at the sentence, and the grammar (T2.4) starts there.
 */
import { describe, expect, it } from "vitest";
import { isStoryBlock, readFlow, type StoryBlock } from "../src/index.js";

/** The blocks of a flow, or the diagnostics if it did not read cleanly. */
function read(text: string, file = "flows/test.flow") {
  return readFlow(text, file);
}

const codes = (text: string): string[] => read(text).diagnostics.map((d) => d.code);

const story = (text: string, name?: string): StoryBlock => {
  const blocks = read(text).flow.blocks.filter(isStoryBlock);
  const found = name === undefined ? blocks[0] : blocks.find((b) => b.name === name);
  expect(found, `no story ${name ?? "at all"} was read`).toBeDefined();
  return found!;
};

describe("blocks (REQ-LANG-1)", () => {
  it("reads a story, its name and its steps in order", () => {
    const block = story(`story: Validate login
  Click the sign in button
  Type "atul" into the username field
`);
    expect(block.kind).toBe("story");
    expect(block.name).toBe("Validate login");
    expect(block.line).toBe(1);
    expect(block.steps.map((s) => s.text)).toEqual([
      "Click the sign in button",
      'Type "atul" into the username field',
    ]);
    expect(block.steps.map((s) => s.line)).toEqual([2, 3]);
  });

  it("treats `scenario:` as a synonym of `story:`", () => {
    expect(story("scenario: book a slot\n  Click the Book now button\n").kind).toBe("scenario");
  });

  it("ends a block at a blank line", () => {
    const { flow } = read(`story: One
  Click the first button

story: Two
  Click the second button
`);
    expect(flow.blocks.map((b) => b.name)).toEqual(["One", "Two"]);
    expect((flow.blocks[0] as StoryBlock).steps).toHaveLength(1);
  });

  it("ends a block at the next header, blank line or not", () => {
    const { flow } = read(`story: One
  Click the first button
story: Two
  Click the second button
`);
    expect(flow.blocks).toHaveLength(2);
    expect((flow.blocks[0] as StoryBlock).steps).toHaveLength(1);
  });

  it("ignores indentation (REQ-LANG-3)", () => {
    const block = story("story: One\n\t\t   Click the button   \n");
    expect(block.steps[0]!.text).toBe("Click the button");
  });

  it("collapses runs of whitespace inside a sentence", () => {
    expect(story("story: One\n  Click    the     button\n").steps[0]!.text).toBe(
      "Click the button",
    );
  });

  it("skips `//` and `#` comment lines (REQ-LANG-3)", () => {
    const block = story(`// a comment
story: One
  # another
  Click the button
  // Click the other button
`);
    expect(block.steps.map((s) => s.text)).toEqual(["Click the button"]);
  });

  it("reports a step outside any block rather than guessing where it belongs", () => {
    expect(codes("Click the button\n")).toEqual(["E_SYNTAX"]);
  });

  it("reports a header with no name", () => {
    expect(codes("story:\n  Click the button\n")).toContain("E_SYNTAX");
  });
});

describe("compose and run blocks (REQ-LANG-10)", () => {
  const flow = `story: One
  Click a

story: Two
  Click b

compose: Both
  One
  Two

test: Both
`;

  it("reads a composition as an ordered list of names", () => {
    const { flow: read } = readFlow(flow, "f.flow");
    const composition = read.blocks.find((b) => b.kind === "compose");
    expect(composition).toBeDefined();
    expect("names" in composition! ? composition.names.map((n) => n.name) : []).toEqual([
      "One",
      "Two",
    ]);
  });

  it("treats `run:` as a synonym of `test:`", () => {
    const { flow: read } = readFlow(flow.replace("test: Both", "run: Both"), "f.flow");
    expect(read.blocks.some((b) => b.kind === "run")).toBe(true);
  });

  it("takes a bare run block's own name as the thing to run", () => {
    // Every legacy flow is written this way — `test : Validate Text` — and the
    // migrated fixtures keep it, so this is the common form rather than a
    // fallback. Whether that name exists is a project-level question; see
    // project.test.ts.
    const { flow: read } = readFlow("story: One\n  Click a\n\ntest: One\n", "f.flow");
    const run = read.blocks.find((b) => b.kind === "test")!;
    expect("names" in run ? run.names.map((n) => n.name) : []).toEqual(["One"]);
    expect("fromHeader" in run ? run.fromHeader : undefined).toBe(true);
  });

  it("takes the listed names when a run block lists any, and the header is then a label", () => {
    const { flow: read } = readFlow(
      "story: One\n  Click a\n\nstory: Two\n  Click b\n\ntest: everything\n  One\n  Two\n",
      "f.flow",
    );
    const run = read.blocks.find((b) => b.kind === "test")!;
    expect("names" in run ? run.names.map((n) => n.name) : []).toEqual(["One", "Two"]);
    expect("fromHeader" in run ? run.fromHeader : undefined).toBeUndefined();
  });

  it("reports a compose block that lists nothing", () => {
    expect(codes("story: One\n  Click a\n\ncompose: Nothing\n")).toContain("E_SYNTAX");
  });

  it("does not accept metadata on a compose or run header", () => {
    expect(codes("compose (tags=smoke): Both\n  One\n")).toContain("E_META");
  });
});

describe("header metadata (REQ-LANG-2)", () => {
  it("reads every key", () => {
    const block = story(
      'story (enabled=false, dataProvider=rows, filePath=data/rows.csv, idempotent=true, tags=smoke,slow): One\n  Click a\n',
    );
    expect(block.meta).toEqual({
      enabled: false,
      dataProvider: "rows",
      filePath: "data/rows.csv",
      idempotent: true,
      onFailure: "stop",
      tags: ["smoke", "slow"],
    });
  });

  it("defaults to enabled, stop, no tags", () => {
    expect(story("story: One\n  Click a\n").meta).toEqual({
      enabled: true,
      onFailure: "stop",
      tags: [],
    });
  });

  it("rejects an unknown key rather than ignoring it", () => {
    // A silently ignored `onFailer=continue` would change what a failing flow
    // does, invisibly.
    const diagnostics = read("story (onFailer=continue): One\n  Click a\n").diagnostics;
    expect(diagnostics.map((d) => d.code)).toEqual(["E_META"]);
    expect(diagnostics[0]!.message).toContain("onFailer");
    expect(diagnostics[0]!.message).toContain("onFailure");
  });

  it("rejects a non-boolean where a boolean belongs", () => {
    expect(codes("story (enabled=yes): One\n  Click a\n")).toEqual(["E_META"]);
  });

  it("accepts a boolean key written bare, meaning true", () => {
    // `scenario (idempotent): cancel booking` reads better than
    // `idempotent=true`, and is what the fixtures are written with.
    expect(story("scenario (idempotent): One\n  Click a\n").meta.idempotent).toBe(true);
    expect(story("story (continueOnFailure): One\n  Click a\n").meta.onFailure).toBe("continue");
  });

  it("does not let a non-boolean key be written bare", () => {
    // A bare `tags` is a value someone forgot, not a flag someone set.
    const diagnostics = read("story (tags): One\n  Click a\n").diagnostics;
    expect(diagnostics.map((d) => d.code)).toEqual(["E_META"]);
    expect(diagnostics[0]!.message).toContain("needs a value");
  });
});

describe("onFailure (REQ-AUTO-4)", () => {
  it.each([
    ["stop", "stop"],
    ["continue", "continue"],
  ] as const)("accepts %s", (value, expected) => {
    expect(story(`story (onFailure=${value}): One\n  Click a\n`).meta.onFailure).toBe(expected);
  });

  it("accepts compensate with a story name, spaces and all", () => {
    expect(
      story("story (onFailure=compensate:cancel booking): One\n  Click a\n").meta.onFailure,
    ).toEqual({ compensate: "cancel booking" });
  });

  it("rejects anything else", () => {
    const diagnostics = read("story (onFailure=rollback): One\n  Click a\n").diagnostics;
    expect(diagnostics.map((d) => d.code)).toEqual(["E_META"]);
    expect(diagnostics[0]!.message).toContain("compensate:<story>");
  });

  it("rejects compensate with no story after the colon", () => {
    expect(codes("story (onFailure=compensate:): One\n  Click a\n")).toEqual(["E_META"]);
  });

  it("treats continueOnFailure=true as onFailure=continue", () => {
    expect(story("story (continueOnFailure=true): One\n  Click a\n").meta.onFailure).toBe(
      "continue",
    );
  });

  it("leaves the default alone for continueOnFailure=false", () => {
    // `false` is not a third policy; it is the absence of the alias.
    expect(story("story (continueOnFailure=false): One\n  Click a\n").meta.onFailure).toBe("stop");
  });

  it("refuses to guess when both spellings set a policy", () => {
    const diagnostics = read(
      "story (continueOnFailure=true, onFailure=stop): One\n  Click a\n",
    ).diagnostics;
    expect(diagnostics.map((d) => d.code)).toEqual(["E_META"]);
  });
});

describe("signatures (REQ-LANG-13)", () => {
  it("reads inputs and outputs with types and defaults", () => {
    const block = story(`story: Book a slot
inputs: date: string, seats: number = 2, token: secret
outputs: bookingId: string, total: number
  Click the Book now button
`);
    expect(block.signature).toEqual({
      inputs: {
        date: { type: "string" },
        seats: { type: "number", default: 2 },
        token: { type: "secret" },
      },
      outputs: { bookingId: { type: "string" }, total: { type: "number" } },
    });
  });

  it("leaves the signature off a story that declares none", () => {
    expect(story("story: One\n  Click a\n").signature).toBeUndefined();
  });

  it("rejects an unknown input type", () => {
    const diagnostics = read("story: One\ninputs: n: integer\n  Click a\n").diagnostics;
    expect(diagnostics.map((d) => d.code)).toEqual(["E_SIGNATURE"]);
    expect(diagnostics[0]!.message).toContain("integer");
  });

  it("rejects `secret` as an output type: a story returns values, not secrets", () => {
    expect(codes("story: One\noutputs: token: secret\n  Click a\n")).toEqual(["E_SIGNATURE"]);
  });

  it("rejects a default whose type is not the declared one", () => {
    const diagnostics = read('story: One\ninputs: n: number = "two"\n  Click a\n').diagnostics;
    expect(diagnostics.map((d) => d.code)).toEqual(["E_SIGNATURE"]);
    expect(diagnostics[0]!.message).toContain("declared number");
  });

  it("rejects a default on a secret, because that default would be the secret", () => {
    const diagnostics = read('story: One\ninputs: token: secret = "hunter2"\n  Click a\n').diagnostics;
    expect(diagnostics.map((d) => d.code)).toEqual(["E_SIGNATURE"]);
    expect(diagnostics[0]!.message).toContain("REQ-NFR-6");
  });

  it("rejects a default that is not a literal", () => {
    expect(codes("story: One\ninputs: date: string = {data.date}\n  Click a\n")).toEqual([
      "E_SIGNATURE",
    ]);
  });

  it("rejects a parameter with no type", () => {
    expect(codes("story: One\ninputs: date\n  Click a\n")).toEqual(["E_SIGNATURE"]);
  });

  it("rejects the same name twice", () => {
    expect(codes("story: One\ninputs: a: string, a: number\n  Click a\n")).toEqual(["E_SIGNATURE"]);
  });

  it("rejects a default on an output", () => {
    expect(codes('story: One\noutputs: total: number = 0\n  Click a\n')).toEqual(["E_SIGNATURE"]);
  });

  it("requires the signature to come before any step", () => {
    const diagnostics = read("story: One\n  Click a\ninputs: n: number\n").diagnostics;
    expect(diagnostics.map((d) => d.code)).toEqual(["E_SIGNATURE"]);
    expect(diagnostics[0]!.message).toContain("directly under the header");
  });

  it("keeps a comma inside a quoted default out of the parameter split", () => {
    const block = story('story: One\ninputs: greeting: string = "hello, world"\n  Click a\n');
    expect(block.signature?.inputs["greeting"]?.default).toBe("hello, world");
  });
});

describe("guards (REQ-LANG-14, pattern 28)", () => {
  it("attaches a guard line to the step below it", () => {
    const block = story(`story: One
  Only if the banner is visible
  Click the dismiss button
`);
    expect(block.steps).toHaveLength(1);
    expect(block.steps[0]!.text).toBe("Click the dismiss button");
    expect(block.steps[0]!.guard).toEqual({
      mode: "onlyIf",
      text: "the banner is visible",
      line: 2,
    });
  });

  it("reads a guard prefix on the step's own line", () => {
    const block = story('story: One\n  Unless the cart is empty, Click the checkout button\n');
    expect(block.steps[0]!.text).toBe("Click the checkout button");
    expect(block.steps[0]!.guard).toEqual({ mode: "unless", text: "the cart is empty", line: 2 });
  });

  it("splits the prefix at the first comma outside quotes", () => {
    // A predicate may legitimately contain a comma inside a literal, and
    // REQ-LANG-5 makes every literal double-quoted, so quotes are what decides.
    const block = story('story: One\n  Only if {plan} matches "free,basic", Click the upgrade button\n');
    expect(block.steps[0]!.guard?.text).toBe('{plan} matches "free,basic"');
    expect(block.steps[0]!.text).toBe("Click the upgrade button");
  });

  it("treats a guard with no comma as a guard line, comma-free predicate and all", () => {
    const block = story('story: One\n  Only if {plan} is "free"\n  Click the upgrade button\n');
    expect(block.steps).toHaveLength(1);
    expect(block.steps[0]!.guard?.text).toBe('{plan} is "free"');
  });

  it("reports a guard line that guards nothing", () => {
    // Silently dropping it would mean a step ran unguarded — the failure mode a
    // guard exists to prevent (REQ-AUTO-1: "never performs the action").
    expect(codes("story: One\n  Click a\n  Only if the banner is visible\n")).toEqual([
      "E_GUARD_ORPHAN",
    ]);
  });

  it("reports two guard lines in a row", () => {
    expect(
      codes("story: One\n  Only if a is visible\n  Unless b is visible\n  Click a\n"),
    ).toEqual(["E_GUARD_ORPHAN"]);
  });

  it("reports a guard line above a step that carries its own guard", () => {
    expect(
      codes("story: One\n  Only if a is visible\n  Unless b is visible, Click a\n"),
    ).toEqual(["E_GUARD_ORPHAN"]);
  });

  it("reports a guard with no predicate", () => {
    expect(codes("story: One\n  Only if\n  Click a\n")).toContain("E_SYNTAX");
  });

  it("reports a guard prefix with no step after the comma", () => {
    expect(codes("story: One\n  Only if a is visible,\n")).toContain("E_SYNTAX");
  });
});

describe("reporting", () => {
  it("keeps going after a diagnostic, so three mistakes report as three", () => {
    const diagnostics = read(`story (bogus=1): One
inputs: n: integer
  Click a

compose: Nothing
`).diagnostics;
    expect(diagnostics.map((d) => d.code).sort()).toEqual([
      "E_META",
      "E_SIGNATURE",
      "E_SYNTAX",
    ]);
  });

  it("names the file and the line", () => {
    const [first] = read("Click a\n", "flows/login.flow").diagnostics;
    expect(first?.file).toBe("flows/login.flow");
    expect(first?.line).toBe(1);
  });
});
