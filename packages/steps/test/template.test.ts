/**
 * T2.3 — the template compiler (REQ-LANG-15, LLD §5).
 *
 * The typed captures are the substance. A `number` placeholder that accepted
 * anything would let `Transfer everything from A to B` match and then fail at run
 * time about a value nobody thought of as a number; a type that only matches its
 * own values means the sentence simply does not match, and the grammar gets its
 * turn — which is the right outcome.
 */
import { describe, expect, it } from "vitest";
import { compileTemplate, matchTemplate, TemplateError } from "../src/index.js";

const match = (template: string, sentence: string) =>
  matchTemplate(compileTemplate(template), sentence)?.captures;

describe("compiling a template", () => {
  it("reads the placeholders, in order, with their types", () => {
    const compiled = compileTemplate("Transfer {amount:number} from {from:target} to {to:target}");
    expect(compiled.placeholders).toEqual([
      { name: "amount", type: "number" },
      { name: "from", type: "target" },
      { name: "to", type: "target" },
    ]);
  });

  it("rejects an unknown placeholder type", () => {
    expect(() => compileTemplate("Wait {n:duration}")).toThrow(TemplateError);
    expect(() => compileTemplate("Wait {n:duration}")).toThrow(/unknown type/);
  });

  it("rejects a repeated placeholder name", () => {
    // Two captures under one name: one silently wins, and which one depends on
    // the regex engine.
    expect(() => compileTemplate("Copy {x:target} to {x:target}")).toThrow(/appears twice/);
  });

  it("rejects two placeholders with nothing between them", () => {
    // There would be no way to tell where the first value ends.
    expect(() => compileTemplate("Do {a:target}{b:target}")).toThrow(/nothing between/);
    expect(() => compileTemplate("Do {a:target} {b:target}")).toThrow(/only by a space/);
  });
});

describe("matching", () => {
  it("matches the documented example", () => {
    expect(
      match(
        "Transfer {amount:number} from {from:target} to {to:target}",
        "Transfer 250 from the current account to the savings account",
      ),
    ).toEqual({
      amount: "250",
      from: "the current account",
      to: "the savings account",
    });
  });

  it("is case-insensitive and tolerant of spacing, because a step is prose", () => {
    expect(
      match("Transfer {amount:number} from {from:target} to {to:target}", "transfer  7   from A to B"),
    ).toEqual({ amount: "7", from: "A", to: "B" });
  });

  it("does not match when a number placeholder is given something else", () => {
    // And that is the point: the grammar then gets its turn.
    expect(
      match(
        "Transfer {amount:number} from {from:target} to {to:target}",
        "Transfer everything from A to B",
      ),
    ).toBeUndefined();
  });

  it("accepts a negative and a decimal number", () => {
    expect(match("Adjust by {n:number}", "Adjust by -2.5")).toEqual({ n: "-2.5" });
  });

  it("takes a quoted string without its quotes, and a bare word as it stands", () => {
    expect(match("Seed the database with {fixture:string}", 'Seed the database with "bookings"'))
      .toEqual({ fixture: "bookings" });
    expect(match("Seed the database with {fixture:string}", "Seed the database with bookings"))
      .toEqual({ fixture: "bookings" });
  });

  it("accepts only true or false for a boolean", () => {
    expect(match("Set flag to {on:boolean}", "Set flag to true")).toEqual({ on: "true" });
    expect(match("Set flag to {on:boolean}", "Set flag to yes")).toBeUndefined();
  });

  it("takes a quoted literal or a {…} reference for a value placeholder", () => {
    expect(match("Enter {v:value}", 'Enter "hello"')).toEqual({ v: '"hello"' });
    expect(match("Enter {v:value}", "Enter {data.user.email}")).toEqual({ v: "{data.user.email}" });
    expect(match("Enter {v:value}", "Enter {input.amount}")).toEqual({ v: "{input.amount}" });
  });

  it("lets the literal text after a target bound it, rather than swallowing the rest", () => {
    // A greedy target would take " to the savings account" with it.
    expect(match("Move {from:target} to {to:target}", "Move the inbox to the archive folder"))
      .toEqual({ from: "the inbox", to: "the archive folder" });
  });

  it("does not match a sentence with trailing words the template does not have", () => {
    expect(match("Click {x:target}", "Click the button twice slowly and then wait")).toEqual({
      x: "the button twice slowly and then wait",
    });
    expect(match("Refresh the page", "Refresh the page now")).toBeUndefined();
  });

  it("matches a template with no placeholders at all", () => {
    expect(match("Reset the fixtures", "reset the fixtures")).toEqual({});
    expect(match("Reset the fixtures", "reset")).toBeUndefined();
  });
});
