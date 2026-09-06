/**
 * Pattern 32 and pattern 19's API form, in the executor (T12.7, LLD §13.9).
 *
 * Draft 2.15 closes a third of the parity gate's one-sided list with two
 * sentences, and both of them are executed here rather than in an adapter:
 *
 * * **an assertion over a set** is read from one `snapshot()` and answered
 *   locally, because a set of two hundred controls asked through `check` is two
 *   hundred round trips to an accessibility API that costs milliseconds a node;
 * * **`Wait for the "<name>" API to answer <path> <predicate>`** polls a
 *   service, which no adapter's `waitFor` knows anything about.
 *
 * The one behaviour worth guarding hardest is the empty set. "Every button has
 * an id" over a screen with no buttons is vacuously true, and a green step that
 * asked about nothing looks exactly like a working one.
 */
import { describe, expect, it } from "vitest";
import type { StepResult } from "@svatah/yam-schema";
import { run, type RunOptions } from "../src/index.js";
import {
  config,
  node,
  plan,
  step,
  story,
  StubSurface,
  stubResolver,
  target,
  type StubOptions,
} from "./harness.js";

async function execute(
  steps: Parameters<typeof step>[0][],
  stub: StubOptions = {},
  overrides: Partial<RunOptions> = {},
): Promise<readonly StepResult[]> {
  const surface = new StubSurface(stub);
  const outcome = await run({
    config: config(),
    plan: plan([story("Story", steps.map((one) => step(one)))]),
    openSurface: async () => surface,
    resolve: stubResolver(stub),
    ...overrides,
  } as RunOptions);
  return outcome.results;
}

/** `Every|No <noun> … should <predicate>`, as the compiler emits it. */
function setStep(
  quantifier: "every" | "no",
  of: string,
  predicate: Record<string, unknown>,
  scope?: string,
): Parameters<typeof step>[0] {
  return {
    action: "expect",
    text: `${quantifier} ${of} should …`,
    ...(scope === undefined ? {} : { target: target(scope) }),
    expect: {
      subject: "set",
      predicate: predicate as never,
      set: { quantifier, of },
    },
  };
}

const named = { kind: "attribute", name: "name", value: { kind: "literal", value: "" }, negate: true };
const idd = { kind: "attribute", name: "id", value: { kind: "literal", value: "" }, negate: true };

describe("an assertion over a set (pattern 32, T12.7)", () => {
  it("passes when every member satisfies the predicate", async () => {
    const results = await execute([setStep("every", "button", idd)], {
      nodes: {
        "": [
          node({ ref: "r1", role: "button", name: "Save", native: { automationId: "action-save" } }),
          node({ ref: "r2", role: "button", name: "Run", native: { automationId: "action-run" } }),
        ],
      },
    });
    expect(results[0]!.status).toBe("passed");
  });

  it("fails naming the members that did not, and how many there were", async () => {
    const results = await execute([setStep("every", "button", idd)], {
      nodes: {
        "": [
          node({ ref: "r1", role: "button", name: "Save", native: { automationId: "action-save" } }),
          node({ ref: "r2", role: "button", name: "Run" }),
        ],
      },
    });
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.failure?.class).toBe("assertion");
    expect(results[0]!.failure?.message).toContain("1 of 2 button(s)");
    expect(results[0]!.failure?.message).toContain('button "Run" (r2)');
  });

  it("reads a name from the snapshot's own field, not from an HTML attribute", async () => {
    /*
     * `name` and `id` are the snapshot's fields (LLD §2.2), which is the only
     * thing that makes "every control is named" askable of a UIA tree, an AX
     * tree and a DOM alike.
     */
    const results = await execute([setStep("every", "control", named)], {
      nodes: {
        "": [
          node({ ref: "r1", role: "button", name: "Save" }),
          node({ ref: "r2", role: "textbox", name: "" }),
        ],
      },
    });
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.failure?.message).toContain("1 of 2 control(s)");
  });

  it("`No text … should contain` fails on the one line that does", async () => {
    const results = await execute(
      [
        setStep("no", "text", {
          kind: "textContains",
          value: { kind: "literal", value: "sk-live" },
        }),
      ],
      {
        nodes: {
          "": [
            node({ ref: "r1", role: "heading", name: "Settings" }),
            node({ ref: "r2", role: "text", name: "key: sk-live-abc" }),
          ],
        },
      },
    );
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.failure?.message).toContain("1 of 2 text(s)");
    expect(results[0]!.failure?.message).toContain("matched textContains");
  });

  it("`No text …` passes when nothing on the screen says it", async () => {
    const results = await execute(
      [
        setStep("no", "text", {
          kind: "textContains",
          value: { kind: "literal", value: "sk-live" },
        }),
      ],
      { nodes: { "": [node({ ref: "r1", role: "text", name: "YAM_SAMPLE_PASSWORD — set" })] } },
    );
    expect(results[0]!.status).toBe("passed");
  });

  it("scopes the set to the step's target, and resolves it like any other", async () => {
    const results = await execute(
      [setStep("every", "row", { kind: "visible" }, "headers-table")],
      {
        nodes: {
          "": [node({ ref: "r9", role: "row", name: "elsewhere", states: ["hidden"] })],
          "ref:headers-table": [
            node({ ref: "r1", role: "row", name: "Accept" }),
            node({ ref: "r2", role: "row", name: "Authorization" }),
          ],
        },
      },
    );
    expect(results[0]!.status).toBe("passed");
    expect(results[0]!.matched?.ref).toBe("ref:headers-table");
  });

  it("fails on an empty set rather than passing vacuously", async () => {
    /*
     * The behaviour this pattern most needs: "every button has an id" over a
     * screen with no buttons is true and means nothing, and a green step that
     * asked about nothing is indistinguishable from a working one until
     * somebody reads the tree.
     */
    const results = await execute([setStep("every", "button", idd)], {
      nodes: { "": [node({ ref: "r1", role: "heading", name: "Flows" })] },
    });
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.failure?.message).toContain("No button was found");
    expect(results[0]!.failure?.message).toContain("1 node(s)");
  });

  it("fails on an empty set for `No` too, where the trap is the same", async () => {
    const results = await execute(
      [setStep("no", "text", { kind: "textContains", value: { kind: "literal", value: "sk-" } })],
      { nodes: { "": [] } },
    );
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.failure?.message).toContain("No text was found");
  });

  it("refuses a predicate a snapshot cannot answer, rather than guessing", async () => {
    const results = await execute([
      setStep("every", "button", {
        kind: "css",
        name: "display",
        value: { kind: "literal", value: "block" },
      }),
    ], { nodes: { "": [node({ ref: "r1", role: "button", name: "Save" })] } });
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.failure?.message).toContain("needs the live element");
  });

  it("never asks the surface `check` about a set", async () => {
    const surface = new StubSurface({
      nodes: { "": [node({ ref: "r1", role: "button", name: "Save", native: { automationId: "a" } })] },
    });
    await run({
      config: config(),
      plan: plan([story("Story", [step(setStep("every", "button", idd))])]),
      openSurface: async () => surface,
      resolve: stubResolver(),
    } as RunOptions);
    expect(surface.calls.filter((one) => one.method === "check")).toEqual([]);
    expect(surface.calls.filter((one) => one.method === "snapshot")).toHaveLength(1);
  });
});

describe("`Wait for the API to answer` (pattern 19 extended, T12.7)", () => {
  it("passes as soon as the value at the path is what was asked for", async () => {
    let asked = 0;
    const results = await execute(
      [
        {
          action: "waitFor",
          text: 'Wait for the "run status" API to answer "$.status" to be "passed"',
          args: {
            request: { kind: "literal", value: "run status" },
            jsonPath: { kind: "literal", value: "$.status" },
          },
          expect: {
            subject: "api",
            predicate: { kind: "text", value: { kind: "literal", value: "passed" } },
          },
        },
      ],
      {},
      {
        api: async () => {
          asked += 1;
          return asked > 1 ? "passed" : "running";
        },
      } as Partial<RunOptions>,
    );
    expect(results[0]!.status).toBe("passed");
    expect(asked).toBeGreaterThan(1);
  });

  it("says what it waited for and what it got when the deadline passes", async () => {
    const results = await execute(
      [
        {
          action: "waitFor",
          timeoutMs: 1,
          text: 'Wait for the "run status" API to answer "$.status" to be "passed"',
          args: {
            request: { kind: "literal", value: "run status" },
            jsonPath: { kind: "literal", value: "$.status" },
          },
          expect: {
            subject: "api",
            predicate: { kind: "text", value: { kind: "literal", value: "passed" } },
          },
        },
      ],
      {},
      { api: async () => "running" } as Partial<RunOptions>,
    );
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.failure?.message).toContain('it answered "running"');
  });

  it("treats a request that throws as not-yet, not as a failure", async () => {
    let asked = 0;
    const results = await execute(
      [
        {
          action: "waitFor",
          text: 'Wait for the "run status" API to answer "$.status" to be "passed"',
          args: {
            request: { kind: "literal", value: "run status" },
            jsonPath: { kind: "literal", value: "$.status" },
          },
          expect: {
            subject: "api",
            predicate: { kind: "text", value: { kind: "literal", value: "passed" } },
          },
        },
      ],
      {},
      {
        api: async () => {
          asked += 1;
          if (asked === 1) throw new Error("connect ECONNREFUSED");
          return "passed";
        },
      } as Partial<RunOptions>,
    );
    expect(results[0]!.status).toBe("passed");
  });

  it("still hands an ordinary `Wait for … to be visible` to the adapter", async () => {
    const surface = new StubSurface();
    await run({
      config: config(),
      plan: plan([
        story("Story", [
          step({
            action: "waitFor",
            target: target("dashboard-link"),
            expect: { subject: "target", predicate: { kind: "visible" } },
          }),
        ]),
      ]),
      openSurface: async () => surface,
      resolve: stubResolver(),
    } as RunOptions);
    expect(surface.actions).toContain("waitFor:ref:dashboard-link");
  });
});

describe("`should be absent` means not there (T12.7)", () => {
  /*
   * The Surface explorer's alert is on the screen while the intent is empty and
   * gone once it is not, and "the intent required alert should be absent"
   * failed with "matched nothing" — which is the *answer*, reported as an
   * error. The one predicate whose whole meaning is "I could not find it" could
   * only pass when a stale reference happened to survive.
   */
  it("passes when the element cannot be resolved", async () => {
    const results = await execute(
      [
        {
          action: "expect",
          text: "The intent required alert should be absent",
          target: target("gone"),
          expect: { subject: "target", predicate: { kind: "absent" } },
        },
      ],
      { unresolvable: ["gone"] },
    );
    expect(results[0]!.status).toBe("passed");
  });

  it("does the same for `should be hidden`", async () => {
    const results = await execute(
      [
        {
          action: "expect",
          text: "The alert should be hidden",
          target: target("gone"),
          expect: { subject: "target", predicate: { kind: "hidden" } },
        },
      ],
      { unresolvable: ["gone"] },
    );
    expect(results[0]!.status).toBe("passed");
  });

  it("still fails a `should be visible` on an element nobody can find", async () => {
    const results = await execute(
      [
        {
          action: "expect",
          text: "The sign in button should be visible",
          target: target("gone"),
          expect: { subject: "target", predicate: { kind: "visible" } },
        },
      ],
      { unresolvable: ["gone"] },
    );
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.failure?.class).toBe("locator");
  });

  it("still fails `should not be absent`, which is the opposite claim", async () => {
    const results = await execute(
      [
        {
          action: "expect",
          text: "The alert should not be absent",
          target: target("gone"),
          expect: { subject: "target", predicate: { kind: "absent", negate: true } },
        },
      ],
      { unresolvable: ["gone"] },
    );
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.failure?.class).toBe("locator");
  });
});
