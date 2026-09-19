/**
 * Turning calls into sentences (T5.5, REQ-BEH-4, LLD §13.4).
 *
 * The end-to-end proof — a real MCP client, a real browser, and the six-call
 * exploration from T4.6 — is `packages/cli/test/trajectory-compile.test.ts`.
 * What is here is the translation itself, which is where the design lives and
 * where a reviewer has to be able to check it by reading: which call becomes
 * which sentence, which element becomes which phrase, and what happens to the
 * ones that cannot be phrased at all.
 */
import { describe, expect, it } from "vitest";
import type { ElementDescription } from "@svatah/yam-schema";
import {
  captureNameFor,
  compileTrajectory,
  draftFor,
  phraseFor,
  sentenceForAct,
  sentenceForCheck,
  sentenceForRead,
  type TrajectoryLine,
} from "../src/index.js";

const describeOf = (parts: Partial<ElementDescription> = {}): ElementDescription => ({
  ref: "r1",
  role: "button",
  name: "Sign in",
  tag: "button",
  attrs: { "data-testid": "sign-in" },
  text: "Sign in",
  neighbours: { before: [], after: [] },
  rolePath: ["main"],
  box: [0, 0, 100, 30],
  index: 0,
  states: [],
  ...parts,
});

const line = (parts: Partial<TrajectoryLine> & { call: TrajectoryLine["call"] }): TrajectoryLine =>
  ({
    seq: 1,
    intent: "do the thing",
    at: "2026-09-04T00:00:00.000Z",
    ...parts,
  }) as TrajectoryLine;

describe("the noun phrase comes from `describe` (LLD §13.4)", () => {
  it("uses the accessible name and a role word a person would write", () => {
    expect(phraseFor(describeOf({ role: "button", name: "Sign in" }))).toBe("the Sign in button");
    expect(phraseFor(describeOf({ role: "link", name: "Docs" }))).toBe("the Docs link");
    expect(phraseFor(describeOf({ role: "textbox", name: "Username" }))).toBe(
      "the Username field",
    );
  });

  it("leaves out a role that has no word, rather than inventing one", () => {
    // "the Notice generic" is not a phrase anyone writes.
    expect(phraseFor(describeOf({ role: "generic", name: "Notice" }))).toBe("the Notice");
  });

  it("falls back to the test id, then the text, then the tag", () => {
    expect(
      phraseFor(describeOf({ name: undefined, attrs: { "data-testid": "book-now" } })),
    ).toBe("the book now button");
    expect(phraseFor(describeOf({ name: undefined, attrs: {}, text: "Slot booked." }))).toBe(
      "the Slot booked. button",
    );
    expect(
      phraseFor(describeOf({ name: undefined, attrs: {}, text: "", tag: "div", role: "generic", index: 3 })),
    ).toBe("the div 4");
  });
});

describe("a capture name is derived, not invented", () => {
  it("camel-cases the phrase and names the kind", () => {
    expect(captureNameFor("the Username field", "value")).toBe("usernameFieldValue");
    expect(captureNameFor("the schedule heading", "text")).toBe("scheduleHeadingText");
  });
});

describe("each call kind becomes its canonical sentence", () => {
  it("maps `act` kinds to the grammar's verbs", () => {
    const at = "the Sign in button";
    expect(sentenceForAct("click", {}, at)).toBe("Click the Sign in button");
    expect(sentenceForAct("type", { value: "alice" }, at)).toBe(
      'Type "alice" into the Sign in button',
    );
    expect(sentenceForAct("selectOption", { value: "08" }, at)).toBe(
      'Select "08" in the Sign in button',
    );
    expect(sentenceForAct("setChecked", { checked: false }, at)).toBe(
      "Uncheck the Sign in button",
    );
    expect(sentenceForAct("press", { key: "Enter" }, undefined)).toBe('Press the "Enter" key');
    expect(sentenceForAct("navigate", { url: "/login" }, undefined)).toBe('Open "/login"');
    expect(sentenceForAct("refresh", {}, undefined)).toBe("Refresh the page");
  });

  it("escapes a literal so the sentence still parses", () => {
    expect(sentenceForAct("type", { value: 'a "quoted" word' }, "the field")).toBe(
      'Type "a \\"quoted\\" word" into the field',
    );
  });

  it("has no sentence for an action it cannot phrase, rather than a wrong one", () => {
    // `evaluate` and `screenshot` have grammar forms and no useful *call*-driven
    // one: what script, and named what? A `// review:` is the honest answer.
    expect(sentenceForAct("evaluate", {}, "the field")).toBeUndefined();
    expect(sentenceForAct("click", {}, undefined)).toBeUndefined();
  });

  it("maps `read` to a capture and `check` to an expectation", () => {
    expect(sentenceForRead("value", "the Username field", "usernameFieldValue")).toBe(
      "Remember the value of the Username field as usernameFieldValue",
    );
    expect(sentenceForCheck({ kind: "visible" }, "ref", "the Sign in button")).toBe(
      "The Sign in button should be visible",
    );
    expect(sentenceForCheck({ kind: "visible", negate: true }, "ref", "the error")).toBe(
      "The error should not be visible",
    );
    expect(
      sentenceForCheck({ kind: "urlContains", value: { value: "/dashboard" } }, "page", undefined),
    ).toBe('The URL should contain "/dashboard"');
  });
});

describe("what is and is not a step", () => {
  it("does not make a step of a snapshot", () => {
    // An agent taking a snapshot is *looking*. A replay does not need to be told
    // to look; the resolver takes whatever snapshots it needs.
    expect(draftFor(line({ call: "snapshot" }))).toBeUndefined();
  });

  it("keeps a call that failed, as something to review", () => {
    const draft = draftFor(
      line({ call: "act", args: { action: "click" }, error: "no such reference r9999" }),
    );
    expect(draft?.sentence).toBeUndefined();
    expect(draft?.why).toContain("no such reference");
  });
});

describe("grouping and the proposal (LLD §13.4)", () => {
  const trajectory: TrajectoryLine[] = [
    line({ seq: 1, call: "snapshot", intent: "look at the page" }),
    line({
      seq: 2,
      call: "act",
      intent: "sign in as the enterprise user",
      url: "http://app.test/login",
      snapshotHash: "h1",
      args: { action: "type", args: { value: "alice" } },
      describe: describeOf({ role: "textbox", name: "Username", attrs: { "data-testid": "username" } }),
    }),
    line({
      seq: 3,
      call: "act",
      intent: "sign in as the enterprise user",
      url: "http://app.test/login",
      snapshotHash: "h1",
      args: { action: "click" },
      describe: describeOf({ name: "Sign In", attrs: { "data-testid": "login-submit" } }),
    }),
    line({
      seq: 4,
      call: "check",
      intent: "confirm the dashboard loaded",
      url: "http://app.test/dashboard",
      snapshotHash: "h2",
      args: { subject: "page", predicate: { kind: "urlContains", value: { value: "/dashboard" } } },
    }),
  ];

  it("makes consecutive calls with one intent into one step", () => {
    /*
     * "sign in as the enterprise user" over a type and a click is one thing the
     * agent meant. Two steps with one sentence between them would be that
     * sentence twice.
     */
    const compiled = compileTrajectory(trajectory, { now: "2026-09-04T00:00:00.000Z" });
    expect(compiled.steps.total).toBe(2);
    expect(compiled.proposal.flow).toContain("Click the Sign In button");
    expect(compiled.proposal.flow).toContain('The URL should contain "/dashboard"');
  });

  it("names the story after the first thing the agent did, not the first look", () => {
    const compiled = compileTrajectory(trajectory, { now: "2026-09-04T00:00:00.000Z" });
    expect(compiled.proposal.name).toBe("sign-in-as-the-enterprise-user");
  });

  it("keys a binding by the page the call was made on", () => {
    const compiled = compileTrajectory(trajectory, { now: "2026-09-04T00:00:00.000Z" });
    const login = compiled.proposal.bindings.find((one) => one.id.includes("login"));
    expect(login?.entries[0]?.context.pattern).toBe("/login");
    // The structural hash the trajectory recorded, not one invented here.
    expect(login?.entries[0]?.context.hash).toBe("h1");
    expect(login?.entries[0]?.verified).toBe(false);
  });

  it("is a function of the trajectory: two compiles are the same bytes", () => {
    // `now` fixed, as `--stable` fixes `generatedAt`. Without that property a
    // proposal could not be reviewed as a diff.
    const a = compileTrajectory(trajectory, { now: "2026-09-04T00:00:00.000Z" });
    const b = compileTrajectory(trajectory, { now: "2026-09-04T00:00:00.000Z" });
    expect(JSON.stringify(a.proposal)).toBe(JSON.stringify(b.proposal));
  });

  it("compiles nothing from an empty trajectory, and says so rather than throwing", () => {
    const compiled = compileTrajectory([], { now: "2026-09-04T00:00:00.000Z" });
    expect(compiled.steps).toEqual({ total: 0, compiled: 0, rate: 0 });
    expect(compiled.proposal.bindings).toEqual([]);
  });
});

describe("a withheld secret becomes an input, never text (SF-15)", () => {
  const signIn: TrajectoryLine[] = [
    line({
      seq: 1,
      call: "act",
      intent: "enter the email",
      url: "http://app.test/login",
      args: { action: "type", args: { value: "ada@example.test" } },
      describe: describeOf({ role: "textbox", name: "Email", attrs: { type: "email" } }),
    }),
    line({
      seq: 2,
      call: "act",
      intent: "enter the password",
      url: "http://app.test/login",
      args: { action: "type", args: { value: "[REDACTED]" } },
      describe: describeOf({ role: "textbox", name: "Password", attrs: { type: "password" } }),
    }),
  ];

  it("types the input rather than the placeholder", () => {
    expect(sentenceForAct("type", { value: "[REDACTED]" }, "the Password field")).toBe(
      "Type {input.passwordField} into the Password field",
    );
    expect(draftFor(signIn[1]!)?.secretInput).toBe("passwordField");
  });

  it("leaves a step that carries only part of a secret for a person to write", () => {
    const partial = draftFor(
      line({ seq: 3, call: "act", args: { action: "type", args: { value: "user:[REDACTED]" } }, describe: describeOf({ role: "textbox", name: "Token" }) }),
    );
    expect(partial?.sentence).toBeUndefined();
    expect(partial?.why).toContain("withheld as a secret");
    const checked = draftFor(
      line({ seq: 4, call: "check", args: { subject: "ref", predicate: { kind: "value", value: "[REDACTED]" } }, describe: describeOf({ role: "textbox", name: "Password" }) }),
    );
    expect(checked?.sentence).toBeUndefined();
  });

  it("declares the input on the story, and the step compiles", () => {
    const compiled = compileTrajectory(signIn, {
      now: "2026-09-04T00:00:00.000Z",
      storyName: "Sign in",
    });
    expect(compiled.review).toEqual([]);
    expect(compiled.steps.compiled).toBe(2);
    expect(compiled.proposal.flow).toContain("story: Sign in\ninputs: passwordField: secret\n");
    expect(compiled.proposal.flow).toContain("Type {input.passwordField} into the Password field");
    expect(compiled.proposal.flow).not.toContain("[REDACTED]");
    expect(compiled.proposal.story).toBeDefined();
  });
});
