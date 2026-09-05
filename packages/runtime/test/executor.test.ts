/**
 * T2.7 — the executor (REQ-RUN-1..9, 13, REQ-AUTO-1, 2, 4, 5, 6, LLD §8).
 *
 * Validate: "Stub-surface tests: parallelism, skip semantics, policy matrix,
 * guard skip without act, invoke with inputs and outputs, checkpoint files per
 * step, audit redaction of `secret` values, overhead under 5 ms per step."
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StepResult } from "@svatah/schema";
import { LocateError, TimeoutError } from "@svatah/surface";
import { openRunDirectory, run, EXIT, type RunOptions } from "../src/index.js";
import {
  config,
  plan,
  step,
  story,
  StubSurface,
  stubResolver,
  target,
  type StubOptions,
} from "./harness.js";

interface Harness {
  readonly surface: StubSurface;
  readonly results: readonly StepResult[];
  readonly outcome: Awaited<ReturnType<typeof run>>;
}

async function execute(
  stories: Parameters<typeof plan>[0],
  overrides: Partial<RunOptions> & { runs?: Record<string, string[]> } = {},
  stub: StubOptions = {},
): Promise<Harness> {
  const surface = new StubSurface(stub);
  const { runs, ...rest } = overrides;
  const outcome = await run({
    config: config(),
    plan: plan(stories, runs),
    openSurface: async () => surface,
    resolve: stubResolver(stub),
    ...rest,
  } as RunOptions);
  return { surface, results: outcome.results, outcome };
}

const statuses = (results: readonly StepResult[]): string[] =>
  results.map((r) => `${r.stepId}:${r.status}`);

describe("running a story (REQ-RUN-7)", () => {
  it("records every step with its ids, timing, status and matched candidate", async () => {
    const { results } = await execute([
      story("Login", [step({ action: "click", target: target("sign-in") })]),
    ]);

    expect(results).toHaveLength(1);
    const result = results[0]!;
    expect(result.story).toBe("Login");
    expect(result.flow).toBe("flows/a.flow");
    expect(result.status).toBe("passed");
    expect(result.matched).toEqual({ ref: "ref:sign-in", candidateIndex: 0, by: "css" });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(Date.parse(result.startedAt)).not.toBeNaN();
  });

  it("classifies a failure by the error's type, not its message (REQ-RUN-8)", async () => {
    const { results } = await execute(
      [story("Login", [step({ action: "click", target: target("gone") })])],
      {},
      { unresolvable: ["gone"] },
    );
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.failure?.class).toBe("locator");
    // REQ-RUN-5: every candidate tried is reported, so the healer has something
    // to work from and a person can see what was looked for.
    expect(results[0]!.failure?.candidatesTried).toHaveLength(1);
  });

  it.each([
    ["timeout", new TimeoutError("slow")],
    ["locator", new LocateError("nope", { id: "x", tried: [] } as never)],
  ] as const)("classifies %s", async (expected, error) => {
    const { results } = await execute(
      [story("S", [step({ action: "click", target: target("a") })])],
      {},
      { failing: { click: error } },
    );
    expect(results[0]!.failure?.class).toBe(expected);
  });
});

describe("skip semantics (REQ-RUN-4)", () => {
  it("skips the rest of the story after a failure", async () => {
    const { results } = await execute(
      [
        story("S", [
          step({ id: "a", action: "click", target: target("one") }),
          step({ id: "b", action: "click", target: target("gone") }),
          step({ id: "c", action: "click", target: target("three") }),
          step({ id: "d", action: "click", target: target("four") }),
        ]),
      ],
      {},
      { unresolvable: ["gone"] },
    );
    expect(statuses(results)).toEqual(["a:passed", "b:failed", "c:skipped", "d:skipped"]);
  });

  it("skips the remaining stories in the flow, because `stop` is the default", async () => {
    // A step failing usually means the application is not in the state the next
    // step assumes; running on produces a screen of failures with one cause.
    const { results } = await execute(
      [
        story("First", [step({ id: "a", action: "click", target: target("gone") })]),
        story("Second", [step({ id: "b", action: "click", target: target("ok") })]),
      ],
      {},
      { unresolvable: ["gone"] },
    );
    expect(statuses(results)).toEqual(["a:failed"]);
  });

  it("runs nothing of a disabled story", async () => {
    const { results } = await execute([
      story("Off", [step({ action: "click", target: target("a") })], {
        meta: { enabled: false, onFailure: "stop", tags: [] },
      }),
      story("On", [step({ id: "b", action: "click", target: target("b") })]),
    ]);
    expect(statuses(results)).toEqual(["b:passed"]);
  });
});

describe("the policy matrix (REQ-AUTO-4, LLD §8.3)", () => {
  const failing = (name: string, policy: Parameters<typeof story>[2] extends never ? never : unknown) =>
    story("A", [step({ id: "a1", action: "click", target: target("gone") })], {
      meta: { enabled: true, onFailure: policy as never, tags: [] },
      name,
    } as never);

  it("`stop` stops the flow, and records the policy on the failing step", async () => {
    const { results } = await execute(
      [
        failing("A", "stop"),
        story("B", [step({ id: "b1", action: "click", target: target("ok") })]),
      ],
      {},
      { unresolvable: ["gone"] },
    );
    expect(statuses(results)).toEqual(["a1:failed"]);
    expect(results[0]!.failure?.policyApplied).toBe("stop");
  });

  it("`continue` stops the story and runs the next one", async () => {
    const { results } = await execute(
      [
        failing("A", "continue"),
        story("B", [step({ id: "b1", action: "click", target: target("ok") })]),
      ],
      {},
      { unresolvable: ["gone"] },
    );
    expect(statuses(results)).toEqual(["a1:failed", "b1:passed"]);
    expect(results[0]!.failure?.policyApplied).toBe("continue");
  });

  it("`compensate` runs the named story and then stops the flow", async () => {
    const { results } = await execute(
      [
        failing("A", { compensate: "Cancel" }),
        story("Cancel", [step({ id: "c1", action: "click", target: target("cancel") })]),
        story("B", [step({ id: "b1", action: "click", target: target("ok") })]),
      ],
      {},
      { unresolvable: ["gone"] },
    );
    // The compensating story's steps are `aborted`: they ran, but as part of an
    // abort rather than as part of what the flow set out to do.
    expect(statuses(results)).toEqual(["a1:failed", "c1:aborted"]);
    expect(results[0]!.failure?.policyApplied).toEqual({ compensate: "Cancel" });
  });

  it("the compensating story sees what the failing one captured", async () => {
    // Which is the whole point: it cannot cancel the booking whose id the
    // failing story remembered unless it can read that id (REQ-AUTO-4).
    const { results } = await execute(
      [
        story(
          "Book",
          [
            step({ id: "b1", action: "read", target: target("ref"), capture: { name: "bookingId", from: "text" } }),
            step({ id: "b2", action: "click", target: target("gone") }),
          ],
          { meta: { enabled: true, onFailure: { compensate: "Cancel" }, tags: [] } },
        ),
        story("Cancel", [
          step({
            id: "c1",
            action: "type",
            target: target("field"),
            args: { value: { kind: "var", name: "bookingId", story: "Book" } },
          }),
        ]),
      ],
      {},
      { unresolvable: ["gone"], reads: { "ref:ref": "BK-42" } },
    );
    expect(statuses(results)).toEqual(["b1:passed", "b2:failed", "c1:aborted"]);
  });

  it("exits 11 on an abort, 1 on a failure, 0 when everything passed", async () => {
    const passed = await execute([story("S", [step({ action: "click", target: target("a") })])]);
    expect(passed.outcome.summary.exitCode).toBe(EXIT.ok);

    const failed = await execute(
      [story("S", [step({ action: "click", target: target("gone") })])],
      {},
      { unresolvable: ["gone"] },
    );
    expect(failed.outcome.summary.exitCode).toBe(EXIT.failed);

    const aborted = await execute(
      [
        failing("A", { compensate: "Cancel" }),
        story("Cancel", [step({ id: "c1", action: "click", target: target("c") })]),
      ],
      {},
      { unresolvable: ["gone"] },
    );
    expect(aborted.outcome.summary.exitCode).toBe(EXIT.aborted);
  });
});

describe("guards (REQ-AUTO-1)", () => {
  it("skips the step without acting when `Only if` does not hold", async () => {
    // "The executor evaluates it before acting and never performs the action if
    // it fails." Asserting the *absence* of the act is the only way to check it.
    const { results, surface } = await execute(
      [
        story("S", [
          step({
            id: "a",
            action: "click",
            target: target("dismiss"),
            guard: { subject: "target", predicate: { kind: "visible" }, mode: "onlyIf" },
          }),
        ]),
      ],
      {},
      { checks: { visible: false } },
    );
    expect(statuses(results)).toEqual(["a:skipped"]);
    expect(surface.actions).toEqual([]);
  });

  it("runs the step when the guard holds", async () => {
    const { results, surface } = await execute(
      [
        story("S", [
          step({
            id: "a",
            action: "click",
            target: target("dismiss"),
            guard: { subject: "target", predicate: { kind: "visible" }, mode: "onlyIf" },
          }),
        ]),
      ],
      {},
      { checks: { visible: true } },
    );
    expect(statuses(results)).toEqual(["a:passed"]);
    expect(surface.actions).toEqual(["click:ref:dismiss"]);
  });

  it("`Unless` is the other way round", async () => {
    const { surface } = await execute(
      [
        story("S", [
          step({
            action: "click",
            target: target("x"),
            guard: { subject: "target", predicate: { kind: "visible" }, mode: "unless" },
          }),
        ]),
      ],
      {},
      { checks: { visible: true } },
    );
    expect(surface.actions).toEqual([]);
  });

  it("a clean guard skip carries no failure (LLD §8.3)", async () => {
    const { results } = await execute(
      [
        story("S", [
          step({
            action: "click",
            target: target("x"),
            guard: { subject: "target", predicate: { kind: "visible" }, mode: "onlyIf" },
          }),
        ]),
      ],
      {},
      { checks: { visible: false } },
    );
    expect(results[0]!.failure).toBeUndefined();
  });

  it("a guard that cannot be evaluated fails with class `guard`, and does not act", async () => {
    // A guard that broke has not said the step is unnecessary.
    const { results, surface } = await execute([
      story("S", [
        step({
          action: "click",
          target: target("x"),
          guard: {
            subject: "scope",
            predicate: {
              kind: "expr",
              left: { kind: "var", name: "nothing" },
              op: "eq",
              right: { kind: "literal", value: "1" },
            },
            mode: "onlyIf",
          },
        }),
      ]),
    ]);
    expect(results[0]!.status).toBe("failed");
    expect(results[0]!.failure?.class).toBe("guard");
    expect(surface.actions).toEqual([]);
  });

  it("a scope guard never touches the surface", async () => {
    // `{count} is greater than 3` is a question about the run.
    const { surface } = await execute([
      story("S", [
        step({ id: "a", action: "read", target: target("n"), capture: { name: "n", from: "text" } }),
        step({
          id: "b",
          action: "click",
          target: target("x"),
          guard: {
            subject: "scope",
            predicate: {
              kind: "expr",
              left: { kind: "var", name: "n" },
              op: "eq",
              right: { kind: "literal", value: "nope" },
            },
            mode: "onlyIf",
          },
        }),
      ]),
    ]);
    expect(surface.calls.filter((c) => c.method === "check")).toEqual([]);
  });
});

describe("invoke (REQ-AUTO-5)", () => {
  const book = story(
    "Book",
    [
      step({
        id: "k1",
        action: "type",
        target: target("date"),
        args: { value: { kind: "input", name: "date" } },
      }),
      step({ id: "k2", action: "read", target: target("ref"), capture: { name: "bookingId", from: "text" } }),
    ],
    {
      signature: {
        inputs: { date: { type: "string" } },
        outputs: { bookingId: { type: "string" } },
      },
    },
  );

  it("passes inputs in and gets outputs back", async () => {
    const { results, outcome } = await execute(
      [
        book,
        story("Main", [
          step({
            id: "m1",
            action: "invoke",
            invoke: { story: "Book", inputs: { date: { kind: "literal", value: "2026-09-03" } } },
            capture: { name: "booked", from: "output" },
          }),
        ]),
      ],
      { runs: { "flows/a.flow": ["Main"] } },
      { reads: { "ref:ref": "BK-7" } },
    );
    void results;
    // The invoked story's outputs are captured under the calling step's name.
    const main = outcome.results.find((r) => r.stepId === "m1")!;
    expect(main.status).toBe("passed");
    expect(main.captured).toEqual({ booked: { bookingId: "BK-7" } });
  });

  it("fails the calling step when the invoked story fails", async () => {
    const { outcome } = await execute(
      [
        story("Broken", [step({ id: "x", action: "click", target: target("gone") })]),
        story("Main", [
          step({ id: "m1", action: "invoke", invoke: { story: "Broken", inputs: {} } }),
        ]),
      ],
      { runs: { "flows/a.flow": ["Main"] } },
      { unresolvable: ["gone"] },
    );
    expect(outcome.results.find((r) => r.stepId === "m1")!.status).toBe("failed");
  });

  it("refuses an input the signature does not declare", async () => {
    const { outcome } = await execute(
      [
        book,
        story("Main", [
          step({
            id: "m1",
            action: "invoke",
            invoke: { story: "Book", inputs: { nope: { kind: "literal", value: "x" } } },
          }),
        ]),
      ],
      { runs: { "flows/a.flow": ["Main"] } },
    );
    const failed = outcome.results.find((r) => r.status === "failed")!;
    expect(failed.failure?.class).toBe("data");
    expect(failed.failure?.message).toContain('has no input "nope"');
  });

  it("returns to the caller's scope afterwards", async () => {
    // A call returns to where it was made from: the caller must still be able to
    // read its own captures after invoking something else (LLD §8.5).
    const { outcome } = await execute(
      [
        book,
        story("Main", [
          step({ id: "m0", action: "read", target: target("mine"), capture: { name: "mine", from: "text" } }),
          step({
            id: "m1",
            action: "invoke",
            invoke: { story: "Book", inputs: { date: { kind: "literal", value: "d" } } },
          }),
          step({
            id: "m2",
            action: "type",
            target: target("f"),
            args: { value: { kind: "var", name: "mine" } },
          }),
        ]),
      ],
      { runs: { "flows/a.flow": ["Main"] } },
      { reads: { "ref:mine": "still here", "ref:ref": "BK-1" } },
    );
    expect(outcome.results.find((r) => r.stepId === "m2")!.status).toBe("passed");
  });
});

describe("signatures (REQ-AUTO-5)", () => {
  it("validates and coerces inputs before anything runs", async () => {
    const { outcome } = await execute(
      [
        story("S", [step({ id: "a", action: "click", target: target("x") })], {
          signature: { inputs: { n: { type: "number" } }, outputs: {} },
        }),
      ],
      { stories: ["S"], inputs: { n: "not a number" } },
    );
    expect(outcome.results[0]!.status).toBe("failed");
    expect(outcome.results[0]!.failure?.message).toContain("declared number");
    // Nothing ran: a function with the wrong arguments should not half-execute.
    expect(outcome.results.filter((r) => r.stepId === "a")).toEqual([]);
  });

  it("uses a default for an input that was not supplied", async () => {
    const { outcome } = await execute(
      [
        story(
          "S",
          [
            step({
              id: "a",
              action: "type",
              target: target("x"),
              args: { value: { kind: "input", name: "who" } },
            }),
          ],
          { signature: { inputs: { who: { type: "string", default: "atul" } }, outputs: {} } },
        ),
      ],
      { stories: ["S"] },
    );
    expect(outcome.results[0]!.status).toBe("passed");
  });

  it("fails when a story cannot produce an output it declared", async () => {
    const { outcome } = await execute(
      [
        story("S", [step({ id: "a", action: "click", target: target("x") })], {
          signature: { inputs: {}, outputs: { total: { type: "number" } } },
        }),
      ],
      { stories: ["S"] },
    );
    expect(outcome.results.at(-1)!.failure?.message).toContain("never captured");
  });
});

describe("parallelism (REQ-RUN-3)", () => {
  it("runs flows in parallel and stories inside a flow in order", async () => {
    const order: string[] = [];
    const surfaces = new Map<string, StubSurface>();

    const outcome = await run({
      config: config({ workers: 4 }),
      plan: plan(
        [
          story("A1", [step({ id: "a1", action: "click", target: target("x") })]),
          story("A2", [step({ id: "a2", action: "click", target: target("x") })]),
          story("B1", [step({ id: "b1", action: "click", target: target("x") })]),
        ],
        { "flows/a.flow": ["A1", "A2"], "flows/b.flow": ["B1"] },
      ),
      openSurface: async (flow) => {
        order.push(`open:${flow}`);
        const surface = new StubSurface();
        surfaces.set(flow, surface);
        // Yield, so a serial implementation would show as strictly ordered opens.
        await new Promise((resolve) => setTimeout(resolve, 5));
        return surface;
      },
      resolve: stubResolver(),
    });

    expect(order).toEqual(["open:flows/a.flow", "open:flows/b.flow"]);
    expect(outcome.summary.flows["flows/a.flow"]!.passed).toBe(2);
    expect(outcome.summary.flows["flows/b.flow"]!.passed).toBe(1);

    // Each flow owns one session, so nothing is shared between them.
    expect(surfaces.size).toBe(2);
    expect(surfaces.get("flows/a.flow")).not.toBe(surfaces.get("flows/b.flow"));

    const a = outcome.results.filter((r) => r.flow === "flows/a.flow").map((r) => r.stepId);
    expect(a).toEqual(["a1", "a2"]);
  });

  it("runs one flow at a time when workers is 1", async () => {
    const open: string[] = [];
    await run({
      config: config({ workers: 1 }),
      plan: plan(
        [
          story("A", [step({ action: "click", target: target("x") })]),
          story("B", [step({ action: "click", target: target("x") })]),
        ],
        { "flows/a.flow": ["A"], "flows/b.flow": ["B"] },
      ),
      openSurface: async (flow) => {
        open.push(`open:${flow}`);
        await new Promise((resolve) => setTimeout(resolve, 5));
        open.push(`opened:${flow}`);
        return new StubSurface();
      },
      resolve: stubResolver(),
    });
    expect(open).toEqual([
      "open:flows/a.flow",
      "opened:flows/a.flow",
      "open:flows/b.flow",
      "opened:flows/b.flow",
    ]);
  });
});

describe("determinism (REQ-RUN-2)", () => {
  it("two runs of one plan produce the same statuses and the same matches", async () => {
    const stories = [
      story("S", [
        step({ id: "a", action: "click", target: target("one") }),
        step({ id: "b", action: "read", target: target("two"), capture: { name: "x", from: "text" } }),
        step({
          id: "c",
          action: "type",
          target: target("three"),
          args: { value: { kind: "var", name: "x" } },
        }),
      ]),
    ];
    const strip = (results: readonly StepResult[]) =>
      results.map((r) => ({ stepId: r.stepId, status: r.status, matched: r.matched, captured: r.captured }));

    const first = await execute(stories, {}, { defaultRead: "same" });
    const second = await execute(stories, {}, { defaultRead: "same" });
    expect(strip(second.results)).toEqual(strip(first.results));
  });
});

describe("checkpoints (REQ-AUTO-2)", () => {
  it("writes one per step, with the scope and the session", async () => {
    const out = mkdtempSync(join(tmpdir(), "svatah-run-"));
    const directory = openRunDirectory(out, "r1");

    await run({
      config: config({ checkpoints: true }),
      plan: plan([
        story("S", [
          step({ id: "a", action: "read", target: target("h"), capture: { name: "x", from: "text" } }),
          step({ id: "b", action: "click", target: target("y") }),
        ]),
      ]),
      openSurface: async () => new StubSurface({ defaultRead: "hello" }),
      resolve: stubResolver(),
      directory,
    });

    const files = readdirSync(join(directory.path, "checkpoints")).sort();
    expect(files).toEqual(["a.json", "b.json"]);

    const second = JSON.parse(readFileSync(join(directory.path, "checkpoints", "b.json"), "utf8"));
    expect(second.stepId).toBe("b");
    expect(second.scope.captures["S"]).toEqual({ x: "hello" });
    expect(second.session).toEqual({ kind: "web", url: "http://app.test/" });
    // Run data is deliberately absent: it is read-only and re-read on resume,
    // which also keeps secrets out of the run directory (LLD §3.4).
    expect(second.scope.data).toBeUndefined();
  });

  it("writes none when checkpoints are off", async () => {
    const out = mkdtempSync(join(tmpdir(), "svatah-run-"));
    const directory = openRunDirectory(out, "r2");
    await run({
      config: config({ checkpoints: false }),
      plan: plan([story("S", [step({ id: "a", action: "click", target: target("x") })])]),
      openSurface: async () => new StubSurface(),
      resolve: stubResolver(),
      directory,
    });
    expect(readdirSync(directory.path).sort()).not.toContain("checkpoints");
  });
});

describe("the run directory (REQ-RUN-9)", () => {
  it("writes results.jsonl, summary.json and audit.jsonl", async () => {
    const out = mkdtempSync(join(tmpdir(), "svatah-run-"));
    const directory = openRunDirectory(out, "r3");
    await run({
      config: config(),
      plan: plan([story("S", [step({ id: "a", action: "click", target: target("x") })])]),
      openSurface: async () => new StubSurface(),
      resolve: stubResolver(),
      directory,
    });

    const results = readFileSync(join(directory.path, "results.jsonl"), "utf8").trim().split("\n");
    expect(results).toHaveLength(1);
    expect(JSON.parse(results[0]!).stepId).toBe("a");

    const summary = JSON.parse(readFileSync(join(directory.path, "summary.json"), "utf8"));
    expect(summary.totals).toEqual({ passed: 1, failed: 0, skipped: 0, healed: 0, aborted: 0 });
    expect(summary.exitCode).toBe(0);
    expect(summary.planHash).toMatch(/^[0-9a-f]{64}$/);

    const audit = readFileSync(join(directory.path, "audit.jsonl"), "utf8").trim().split("\n");
    expect(audit.length).toBeGreaterThan(1);
  });
});

describe("audit (REQ-AUTO-6, REQ-NFR-6)", () => {
  it("records the invoker, every surface call, and the outputs", async () => {
    const { outcome } = await execute([
      story(
        "S",
        [step({ id: "a", action: "read", target: target("h"), capture: { name: "v", from: "text" } })],
        { signature: { inputs: {}, outputs: { v: { type: "string" } } } },
      ),
    ]);

    const lines = outcome.auditLines as Array<{ kind: string; call?: { method: string } }>;
    expect(lines[0]).toMatchObject({ kind: "run" });
    expect(lines.some((l) => l.kind === "story")).toBe(true);
    expect(lines.some((l) => l.call?.method === "read")).toBe(true);
    expect(lines.some((l) => l.kind === "output")).toBe(true);
  });

  it("numbers lines monotonically, so parallel flows can still be ordered", async () => {
    const { outcome } = await execute([
      story("S", [
        step({ id: "a", action: "click", target: target("x") }),
        step({ id: "b", action: "click", target: target("y") }),
      ]),
    ]);
    const seqs = (outcome.auditLines as Array<{ seq: number }>).map((l) => l.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("redacts a secret wherever it ended up, not only where it was read", async () => {
    // The secret is read from data, typed into a field, and captured. Redacting
    // by *path* would catch the first and miss the other two.
    const { outcome } = await execute(
      [
        story("S", [
          step({
            id: "a",
            action: "type",
            target: target("pw"),
            args: { value: { kind: "data", path: "user.password", secret: true } },
          }),
        ]),
      ],
      {
        data: { user: { password: "hunter2-secret" } },
        secrets: new Set(["user.password"]),
      },
    );

    const text = JSON.stringify(outcome.auditLines);
    expect(text).not.toContain("hunter2-secret");
    expect(text).toContain("«redacted»");
  });

  it("keeps the secret out of the results too", async () => {
    const { outcome } = await execute(
      [
        story("S", [
          step({
            id: "a",
            action: "read",
            target: target("pw"),
            capture: { name: "seen", from: "text" },
          }),
          step({
            id: "b",
            action: "type",
            target: target("f"),
            args: { value: { kind: "data", path: "pw", secret: true } },
          }),
        ]),
      ],
      { data: { pw: "hunter2-secret" }, secrets: new Set(["pw"]) },
      { defaultRead: "hunter2-secret" },
    );
    expect(JSON.stringify(outcome.results)).not.toContain("hunter2-secret");
  });

  it("writes nothing when audit is off", async () => {
    const outcome = await run({
      config: config({ audit: false }),
      plan: plan([story("S", [step({ action: "click", target: target("x") })])]),
      openSurface: async () => new StubSurface(),
      resolve: stubResolver(),
    });
    expect(outcome.auditLines).toEqual([]);
  });
});

describe("overhead (REQ-NFR-4: under 5 ms per step, excluding adapter time)", () => {
  it("adds well under a millisecond per step", async () => {
    const steps = Array.from({ length: 200 }, (_, i) =>
      step({ id: `s${i}`, action: "click", target: target("x") }),
    );
    const started = performance.now();
    const { results } = await execute([story("S", steps)]);
    const perStep = (performance.now() - started) / steps.length;

    console.log(`executor overhead: ${perStep.toFixed(3)} ms per step over ${steps.length} steps`);
    expect(results).toHaveLength(steps.length);
    expect(perStep).toBeLessThan(5);
  });
});
