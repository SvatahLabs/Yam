/**
 * T2.4 — the rest of the Validate list (REQ-COMP-2, REQ-LANG-4).
 *
 * "Every sigil form rejected; fixtures parse with zero errors; 1,000 steps under
 * 1 s."
 *
 * The golden set (`golden.test.ts`) checks what the grammar *produces*. This
 * checks what it *refuses*, what it manages on the real fixtures, and that it is
 * fast enough to run on every keystroke in an editor.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { formatDiagnostic, isStoryBlock, readFlow, TargetDictionary } from "@svatah/yam-spec";
import { lowerStep, parseGuard, parseSentence, RETIRED_FORMS } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const FLOWS = join(ROOT, "evals", "fixtures", "flows");

const where = { file: "f.flow", line: 1 };

describe("v1 and v2 syntax is refused, and says what to run (REQ-LANG-4)", () => {
  /** One sentence per retired form, from the migration table. */
  const CASES: Array<[string, string]> = [
    ["the +action+ sigil", "user +clicks+ the sign in button"],
    ["the ~locator~ sigil", "Click the login button using ~xpath://input[@value='Sign In']~"],
    ["the *data* sigil", "Type the username as *connected2atul@gmail.com*"],
    ["the $[key:value]$ sigil", "Type $[user:atul]$ into the username field"],
    ["a #var# reference", "The schedule heading should say #enterprise#"],
    ["a $key data reference", "Type $email into the username field"],
    ["a `var : name` capture", "Save text as var : enterprise for the heading"],
    ["an inline locator", "Click the login button with xpath://input[@value='Sign In']"],
    ["a bare locator prefix", "Click xpath://li[4]/a/p"],
  ];

  /*
   * Each sentence carries exactly one retired form. A real v2 line carries three
   * or four, and only the first is reported — one message per line, saying "this
   * is v2, run migrate" — so isolating them here is what makes each pattern
   * individually checked rather than shadowed by the one above it.
   */
  it.each(CASES)("rejects %s", (form, sentence) => {
    const { raw, diagnostics } = parseSentence(sentence, where);
    expect(raw, `"${sentence}" parsed instead of being refused`).toBeUndefined();
    expect(diagnostics.map((d) => d.code)).toEqual(["E_SIGIL"]);
    expect(diagnostics[0]!.message).toContain(form);
  });

  it("points at migrate rather than at the grammar", () => {
    // Someone with a directory of v2 flows needs to be told the file is v2 and
    // that there is a command for it — not "no pattern matched this sentence",
    // which is true and useless.
    const { diagnostics } = parseSentence("user +clicks+ the ~button~", where);
    expect(diagnostics[0]!.message).toContain("yam migrate");
  });

  it("checks the sigils before the grammar, so a v2 line reads as v2", () => {
    // `+clicks+ the ~x~` would also fail to parse. The order decides which
    // message the author gets, and E_SIGIL is the one that helps.
    const { diagnostics } = parseSentence("+click+ on ~logout~", where);
    expect(diagnostics[0]!.code).toBe("E_SIGIL");
  });

  it("covers every form the migration table lists", () => {
    expect(RETIRED_FORMS.map((f) => f.name).sort()).toEqual(CASES.map(([name]) => name).sort());
  });

  it("does not refuse a sentence that merely contains a quoted asterisk or hash", () => {
    // The sigil patterns must not fire on ordinary prose, or a valid flow would
    // be told to run `migrate`.
    expect(parseSentence('Type "2 * 3" into the location field', where).raw).toBeDefined();
    expect(parseSentence('Type "#1 result" into the location field', where).raw).toBeDefined();
  });
});

describe("a sentence with no pattern (REQ-COMP-1)", () => {
  it("is E_NO_MATCH, naming where it stopped making sense", () => {
    const { raw, diagnostics } = parseSentence("Frobnicate the widget vigorously", where);
    expect(raw).toBeUndefined();
    expect(diagnostics.map((d) => d.code)).toEqual(["E_NO_MATCH"]);
    expect(diagnostics[0]!.message).toContain("column");
    expect(diagnostics[0]!.message).toContain("docs/flow-language.md");
  });
});

describe("guards written on their own line (REQ-LANG-14)", () => {
  it("parses the same predicates as the prefix form", () => {
    const line = parseGuard("the login error is hidden", "onlyIf", where);
    expect(line.diagnostics).toEqual([]);
    expect(line.guard).toEqual({
      subject: "target",
      predicate: { kind: "hidden" },
      mode: "onlyIf",
      /*
       * The phrase is carried out of the grammar (T5.4) so the compiler can
       * refuse a guard about a different element from the one the step acts on.
       * It never reaches the IR: `lowerStep` builds the guard field by field.
       */
      phrase: "the login error",
    });

    const prefixed = parseSentence(
      "Only if the login error is hidden, click the login error",
      where,
    );
    expect(prefixed.raw?.guard).toEqual(line.guard);
  });

  it("reports a predicate it cannot read", () => {
    expect(parseGuard("the moon is in gemini", "unless", where).diagnostics.map((d) => d.code))
      .toEqual(["E_NO_MATCH"]);
  });
});

describe("the fixture flows parse with zero errors (REQ-NFR-8, T2.4 Validate)", () => {
  const files = readdirSync(FLOWS).filter((name) => name.endsWith(".flow")).sort();

  it("finds them all, so this is not vacuous", () => {
    // Five migrated fixtures, plus the workflow and the guard-and-compensation
    // showcases Phase 5 added.
    expect(files.length).toBeGreaterThanOrEqual(7);
  });

  it.each(files)("%s: every step matches a pattern", (name) => {
    const { flow, diagnostics } = readFlow(readFileSync(join(FLOWS, name), "utf8"), `flows/${name}`);
    expect(diagnostics.filter((d) => d.severity === "error").map(formatDiagnostic)).toEqual([]);

    const failures: string[] = [];
    let steps = 0;
    for (const block of flow.blocks) {
      if (!isStoryBlock(block)) continue;
      for (const step of block.steps) {
        steps += 1;
        const parsed = parseSentence(step.text, { file: `flows/${name}`, line: step.line });
        if (parsed.raw === undefined) failures.push(...parsed.diagnostics.map(formatDiagnostic));
      }
    }
    expect(steps, `${name} has no steps`).toBeGreaterThan(0);
    expect(failures).toEqual([]);
  });

  it("compiles every fixture step to a step the IR accepts", () => {
    // Parsing is half of it; a raw step that cannot be lowered is a step the
    // runtime could not run.
    const dictionary = new TargetDictionary();
    let compiled = 0;
    for (const name of files) {
      const { flow } = readFlow(readFileSync(join(FLOWS, name), "utf8"), `flows/${name}`);
      for (const block of flow.blocks) {
        if (!isStoryBlock(block)) continue;
        for (const step of block.steps) {
          const parsed = parseSentence(step.text, { file: name, line: step.line });
          expect(parsed.raw, `${name}:${step.line} ${step.text}`).toBeDefined();
          const lowered = lowerStep(
            parsed.raw!,
            { id: `s${compiled}`, storyName: block.name, line: step.line, text: step.text, rule: "?" },
            {
              targets: dictionary,
              secrets: new Set(),
              file: name,
              line: step.line,
              stepTimeoutMs: 10_000,
            },
          );
          expect(lowered.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
          compiled += 1;
        }
      }
    }
    expect(compiled).toBeGreaterThan(80);
  });
});

describe("performance (REQ-COMP-2: 1,000 steps in under 1 s)", () => {
  it("parses and lowers 1,000 steps well inside the budget", () => {
    // Not a microbenchmark: the number in the requirement is about a person
    // editing a flow and about `yam lint` in a pre-commit hook, so what is
    // measured is the whole path a step takes — sigil check, parse, lower.
    const sentences = [
      "Click the sign in button",
      'Type "connected2atul@gmail.com" into the username field',
      "The schedule heading should say {enterprise}",
      "Only if the login error is hidden, click the sign in button",
      'Call the "active count" API and remember the response as activeCount',
      "Wait for the dashboard link to be visible",
      'Select "Adapters" in the project select',
      "Remember the text of the schedule heading as enterprise",
      'Run the "Book a slot" story with date={data.date}',
      "The sign in button should occupy 40, 180, 100, 36",
    ];
    const dictionary = new TargetDictionary();

    const started = performance.now();
    for (let i = 0; i < 1000; i += 1) {
      const text = sentences[i % sentences.length]!;
      const parsed = parseSentence(text, { file: "f.flow", line: i });
      lowerStep(
        parsed.raw!,
        { id: `s${i}`, storyName: "perf", line: i, text, rule: "?" },
        {
          targets: dictionary,
          secrets: new Set(),
          file: "f.flow",
          line: i,
          stepTimeoutMs: 10_000,
        },
      );
    }
    const elapsed = performance.now() - started;

    /*
     * The budget is three times the requirement (LLD §16, Draft 2.4).
     *
     * REQ-COMP-2 asks for 1,000 steps in under a second. This suite runs beside
     * every other package's, several browsers among them, on whatever the CI
     * runner has left — and a wall-clock assertion sized exactly to its
     * requirement measures the machine's load as much as the grammar. "A timing
     * test that fails only under parallel load is a defect in the test, not in
     * the code."
     *
     * What keeps the requirement honest is the number itself: it is printed
     * every run, and it is a tenth of the budget on an idle machine, so a
     * regression that stays inside the budget is still there to be read.
     */
    const REQUIREMENT_MS = 1000;
    const BUDGET_MS = REQUIREMENT_MS * 3;

    console.log(
      `1,000 steps parsed and lowered in ${elapsed.toFixed(0)} ms ` +
        `(REQ-COMP-2: ${REQUIREMENT_MS} ms; budget under load: ${BUDGET_MS} ms)`,
    );
    if (elapsed >= REQUIREMENT_MS) {
      console.warn(
        `over the ${REQUIREMENT_MS} ms REQ-COMP-2 asks for — either the machine is busy ` +
          "or the grammar got slower; measure it on its own before deciding which.",
      );
    }
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });
});

/**
 * The assertion aliases (P4-F4, Draft 2.6, LLD §4.2).
 *
 * "The grammar accepts `Expect <subject> to …` and the `Verify / Check that /
 * Assert that / Ensure / Make sure / Confirm` prefixes for target, page-title
 * and URL predicates, lowering to the same IR as the canonical `should` forms."
 *
 * Phase 4's verifier typed `Expect the sign in button to be visible` at the REPL
 * and got `E_NO_MATCH`, although the synonym vocabulary had listed those verbs
 * for `expect` since Draft 1. The golden set has an entry per alias; what is
 * asserted here is the property that makes the aliases safe — that the surface a
 * person chose leaves no trace in the step.
 */
describe("assertion aliases lower to the canonical IR (P4-F4, LLD §4.2)", () => {
  const same = (canonical: string, ...aliases: string[]): void => {
    const parse = (text: string): unknown => {
      const result = parseSentence(text, { file: "aliases", line: 1 });
      expect(result.raw, `${text}: ${result.diagnostics.map((d) => d.code).join(", ")}`).toBeDefined();
      return result.raw;
    };
    const expected = JSON.stringify(parse(canonical));
    for (const alias of aliases) expect(JSON.stringify(parse(alias)), alias).toBe(expected);
  };

  it("says the same thing about an element's state, six ways", () => {
    same(
      "The sign in button should be visible",
      "Expect the sign in button to be visible",
      "Verify the sign in button is visible",
      "Verify that the sign in button is visible",
      "Check that the sign in button is visible",
      "Assert that the sign in button is visible",
      "Ensure the sign in button is visible",
      "Make sure the sign in button is visible",
      "Confirm the sign in button is visible",
    );
  });

  it("negates the same way", () => {
    same(
      "The login error should not be visible",
      "Expect the login error to not be visible",
      "Verify the login error is not visible",
      "Ensure that the login error is not visible",
    );
  });

  it("carries text, value, attribute, tag and geometry predicates through", () => {
    same(
      'The schedule heading should say "Enterprise"',
      'Expect the schedule heading to say "Enterprise"',
      'Verify the schedule heading says "Enterprise"',
      'Confirm the schedule heading reads "Enterprise"',
    );
    same(
      'The username field should have the value "atul"',
      'Expect the username field to have the value "atul"',
      'Check that the username field has the value "atul"',
    );
    same(
      'The docs link should have the "target" attribute "_blank"',
      'Ensure the docs link has the "target" attribute "_blank"',
    );
    same(
      'The schedule heading should be an "h1"',
      'Confirm the schedule heading is an "h1"',
    );
    same(
      "The sign in button should occupy 40, 180, 100, 36",
      "Make sure the sign in button occupies 40, 180, 100, 36",
    );
    same(
      "The sign in button should be 100 by 36",
      "Expect the sign in button to be 100 by 36",
    );
  });

  it("covers the page title and the URL, not only elements", () => {
    same(
      'The page title should contain "Yam"',
      'Expect the page title to contain "Yam"',
      'Verify the page title contains "Yam"',
    );
    same(
      'The page title should be "Dashboard"',
      'Expect the page title to be "Dashboard"',
      'Check that the page title is "Dashboard"',
    );
    same(
      'The URL should contain "/dashboard"',
      'Expect the URL to contain "/dashboard"',
      'Ensure the URL contains "/dashboard"',
    );
    same(
      'The URL should be "/dashboard"',
      'Expect the URL to be "/dashboard"',
      'Make sure the URL is "/dashboard"',
    );
  });

  it("leaves `Check the remember me box` a checkbox", () => {
    /*
     * The one collision the aliases create: `check` is pattern 17's verb. LLD
     * §4.2 spells the alias `Check that`, and the `that` is what tells them
     * apart — so the checkbox sentence has to keep working unchanged.
     */
    const checkbox = parseSentence("Check the remember me box", { file: "a", line: 1 }).raw;
    expect(checkbox?.action).toBe("setChecked");
    expect(checkbox?.args?.["checked"]).toBe(true);

    const assertion = parseSentence("Check that the remember me box is checked", {
      file: "a",
      line: 1,
    }).raw;
    expect(assertion?.action).toBe("expect");
  });

  it("leaves `Confirm the alert` alone, since it has no predicate", () => {
    // `confirm` is an alias verb and `Confirm the alert` is not an assertion.
    // With nothing for the predicate rules to match, the alternative fails and
    // the sentence falls through exactly as it did before (golden g-183).
    expect(parseSentence("Confirm the alert", { file: "a", line: 1 }).raw).toBeUndefined();
  });
});

/* ── patterns 32 and 33, and the three extensions (T12.7) ─────────────────── */

/** The raw step one sentence parses to, or `undefined` when nothing matched. */
const raw = (text: string) => parseSentence(text, where).raw;

describe("an assertion over a set (pattern 32, T12.7, LLD §13.9 Draft 2.15)", () => {
  it("reads the quantifier, the noun and the predicate", () => {
    expect(raw("Every button on this screen should have an id")).toEqual({
      action: "expect",
      expect: {
        subject: "set",
        predicate: { kind: "attribute", name: "id", value: { literal: "" }, negate: true },
        set: { quantifier: "every", of: "button" },
      },
    });
  });

  it("carries the scope as the step's own target, so the resolver resolves it", () => {
    const step = raw("Every row of the headers table should be visible");
    expect(step?.target).toEqual({ phrase: "the headers table" });
    expect(step?.expect?.set).toEqual({ quantifier: "every", of: "row" });
  });

  it("takes `on this screen` as no target at all — the whole window", () => {
    expect(raw("No text on this screen should contain \"sk-\"")?.target).toBeUndefined();
    expect(raw("No text on the window should contain \"sk-\"")?.target).toBeUndefined();
  });

  it("normalises `each` and `all` to `every`, and the noun to the singular", () => {
    for (const text of [
      "Each control on this screen should have a name",
      "All controls on this screen should have a name",
      "Every control on this screen should have a name",
    ]) {
      expect(raw(text)?.expect?.set, text).toEqual({ quantifier: "every", of: "control" });
    }
  });

  it("refuses a noun the executor could not map, rather than asserting about nothing", () => {
    /*
     * A set the executor cannot build is a step that quietly asserts about an
     * empty set — and passes. The noun list is closed for exactly that reason,
     * and a sentence outside it is `E_NO_MATCH` at compile time, where a typo
     * belongs.
     */
    expect(raw("Every widget on this screen should have an id")).toBeUndefined();
  });

  it("leaves an ordinary one-element assertion alone", () => {
    // "Every" is not a word that starts a target phrase, but "No" could begin
    // one — and pattern 32 must not swallow a sentence about one element.
    const one = raw("The sign in button should be visible");
    expect(one?.expect?.subject).toBe("target");
    expect(one?.expect?.set).toBeUndefined();
  });
});

describe("resizing the window (pattern 33, T12.7)", () => {
  it("reads a bare size, the way pattern 24's `should be 800 by 600` does", () => {
    expect(raw("Resize the window to 1440 by 900")).toEqual({
      action: "resizeWindow",
      args: { width: 1440, height: 900 },
    });
    expect(raw("Set the window to 640 by 480")).toEqual({
      action: "resizeWindow",
      args: { width: 640, height: 480 },
    });
  });

  it("does not shadow pattern 20's window sentences", () => {
    expect(raw("Switch to the new window")?.action).toBe("switchWindow");
    expect(raw("Close the other windows")?.action).toBe("closeOtherWindows");
  });
});

describe("waiting on a service's answer (pattern 19 extended, T12.7)", () => {
  it("names the request, the path and the predicate", () => {
    expect(raw('Wait for the "run status" API to answer "$.status" to be "passed"')).toEqual({
      action: "waitFor",
      args: { request: { literal: "run status" }, jsonPath: { literal: "$.status" } },
      expect: { subject: "api", predicate: { kind: "text", value: { literal: "passed" } } },
    });
  });

  it("leaves `Wait for the <target> to be <state>` as the adapter's wait", () => {
    const step = raw("Wait for the dashboard link to be visible");
    expect(step?.expect?.subject).toBe("target");
    expect(step?.target).toEqual({ phrase: "the dashboard link" });
  });
});

describe("a multi-line value (pattern 9 extended, T12.7)", () => {
  it("reads `\\n`, `\\t`, `\\\"` and `\\\\` and nothing else", () => {
    const value = (text: string) =>
      (raw(text)?.args?.["value"] as { literal?: string } | undefined)?.literal;
    expect(value('Type "one\\ntwo" into the flow editor')).toBe("one\ntwo");
    expect(value('Type "one\\ttwo" into the flow editor')).toBe("one\ttwo");
    expect(value('Type "say \\"hi\\"" into the flow editor')).toBe('say "hi"');
    expect(value('Type "a\\\\b" into the flow editor')).toBe("a\\b");
  });

  it("leaves an unknown escape exactly as it was written", () => {
    /*
     * A Windows path in a value must not silently lose its separators: `\\d` is
     * a backslash and a `d`, not an escape this grammar invented a meaning for.
     */
    const value = (raw('Type "C:\\docs\\report" into the path field')?.args?.["value"] as {
      literal?: string;
    }).literal;
    expect(value).toBe("C:\\docs\\report");
  });
});
