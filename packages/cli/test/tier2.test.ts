/**
 * Tier 2 — the local model tier (T4.3, REQ-COMP-3, REQ-COMP-7, REQ-NFR-3).
 *
 * The *accuracy* is measured by `yam eval compiler --only tier2` against a
 * real local model, and published in `reports/eval-compiler.md`. This is the
 * other half: the machinery around the model, exercised with a fake gateway so
 * it runs on a clean checkout with no model server present — which is the
 * verification contract.
 *
 * Four things are checked here that a number cannot say:
 *
 * * the compile is **offline** unless a tier is asked for (REQ-NFR-3);
 * * a Tier 2 step carries provenance and a confidence lint will flag;
 * * two compiles of one project are **byte-identical** (REQ-COMP-7);
 * * a **digest mismatch fails** without `--allow-model-drift` (REQ-COMP-3).
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearTiers,
  compileWithModelTiers,
  hasModelTiers,
  registerTier,
  toRawStep,
} from "@svatah/yam-compiler";
import { fakeGateway, localGateway } from "@svatah/yam-gateway";
import { readProject } from "@svatah/yam-spec";
import { configSchema, DEFAULT_CONFIG } from "@svatah/yam-schema";
import { EXIT } from "@svatah/yam-bindings-cli";
import { z } from "zod";
import { main } from "../src/index.js";
import { retrieve, shapeWords, suggestedAction, tier2, TIER2_MAX_CONFIDENCE } from "../src/tiers/tier2.js";
import { asExample } from "../src/tiers/examples.js";
import { ACTION_CONVENTIONS, conventionsBlock } from "../src/tiers/conventions.js";
import { registerModelTiers } from "../src/tiers/register.js";

afterEach(() => clearTiers());

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(argv, {
    out: (text) => (out += `${text}\n`),
    err: (text) => (err += `${text}\n`),
  });
  return { code, out, err };
}

/** A project whose four sentences the grammar all refuse. */
const FLOW = `story: Sign in loosely
  Go to the "/login" page
  Put "alice" in the username field
  Tap the sign in button

test: Sign in loosely
`;

/** The answers a fake local model gives for those three sentences. */
const ANSWERS: Record<string, Record<string, unknown>> = {
  'Go to the "/login" page': { action: "navigate", args: { url: "/login" } },
  'Put "alice" in the username field': {
    action: "type",
    target: { phrase: "the username field" },
    args: { value: "alice" },
  },
  "Tap the sign in button": { action: "click", target: { phrase: "the sign in button" } },
};

function project(config: string): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-tier2-"));
  mkdirSync(join(dir, "flows"), { recursive: true });
  writeFileSync(join(dir, "flows", "loose.flow"), FLOW, "utf8");
  writeFileSync(join(dir, "yam.config.yaml"), config, "utf8");
  return dir;
}

const BASE_CONFIG = `schemaVersion: "1.0.0"
project: "tier2-test"
environment: test
adapter: playwright
app: {}
flows: { dir: flows }
steps: { dir: steps }
bindings: { dir: bindings, testIdAttributes: ["data-testid"] }
data: { file: data.yaml }
api: { dir: api }
run:
  workers: 1
  headless: true
  stepTimeoutMs: 10000
  candidateTimeoutMs: 2000
  screenshots: never
  trace: false
  outputDir: runs
  checkpoints: false
  audit: true
record: { model: "claude-opus-5", maxSnapshotTokens: 4000, visionFallback: false }
heal: { onFail: false, relocalizeThreshold: 0.72, margin: 0.1, useModel: false }
`;

describe("compile is offline unless a tier is asked for (REQ-NFR-3)", () => {
  it("refuses the paraphrases with E_NO_MATCH and writes no plan", async () => {
    const dir = project(`${BASE_CONFIG}compile: { confidenceThreshold: 0.8 }\n`);
    const { code, err } = await cli("compile", dir, "--stable");
    expect(code).toBe(EXIT.compileErrors);
    expect(err).toContain("E_NO_MATCH");
    // Three sentences, three errors: a model tier that was not asked for is
    // absent, not silently substituted.
    expect(err.match(/E_NO_MATCH/g)).toHaveLength(3);
  });

  it("says why when --tier2 is asked for and no server is configured", async () => {
    // "Compiled with the grammar alone because you asked for nothing else" and
    // "…because the config names no server" are different facts.
    const dir = project(`${BASE_CONFIG}compile: { confidenceThreshold: 0.8 }\n`);
    const { err } = await cli("compile", dir, "--stable", "--tier2");
    expect(err).toContain("`compile.tier2` names no local model server");
    expect(err).toContain("docs/local-model.md");
  });
});

describe("a Tier 2 step is a Tier 1 step but for its origin (REQ-COMP-1)", () => {
  it("lowers the model's answer through the same path the grammar uses", async () => {
    const gateway = fakeGateway({
      label: "tier2",
      answer: (request) => ANSWERS[request.user] ?? null,
    });
    registerTier(tier2({ provider: "ollama", endpoint: "http://127.0.0.1:11434", model: "fake", gateway }));

    const { project: read } = readProject({
      flows: [{ file: "loose.flow", text: FLOW }],
    });
    const result = await compileWithModelTiers(
      { project: read, projectName: "t", stable: true },
      { tier2: true },
    );

    expect(result.ok).toBe(true);
    const steps = result.plan.stories[0]!.steps;
    expect(steps.map((s) => s.action)).toEqual(["navigate", "type", "click"]);

    // The element id came from the dictionary, not from the model: the model
    // said "the username field" and never saw an id (REQ-COMP-5).
    expect(steps[1]!.target).toMatchObject({
      ref: "username-field",
      phrase: "the username field",
      status: "unbound",
    });

    for (const step of steps) {
      expect(step.origin.tier).toBe(2);
      expect(step.origin.confidence).toBe(TIER2_MAX_CONFIDENCE);
      // Provenance is mandatory on a Tier 2 step and schema-enforced
      // (REQ-AGT-3, REQ-STD-4).
      expect(step.origin.provenance?.model).toBe("fake:tier2");
      expect(step.origin.provenance?.promptVersion).toBe("c2-1");
    }
  });

  it("holds confidence below the default threshold, so lint flags every step", async () => {
    // A guess a small model made about what a person meant is a thing a person
    // should read before it is committed (REQ-COMP-8).
    expect(TIER2_MAX_CONFIDENCE).toBeLessThan(0.8);
  });

  it("leaves a sentence no tier could place as a compile error", async () => {
    const gateway = fakeGateway({ label: "silent", answer: () => null });
    registerTier(tier2({ provider: "ollama", endpoint: "http://x", model: "fake", gateway }));

    const { project: read } = readProject({ flows: [{ file: "loose.flow", text: FLOW }] });
    const result = await compileWithModelTiers(
      { project: read, projectName: "t", stable: true },
      { tier2: true },
    );
    // A refusal falls through to `E_NO_MATCH`, which is the answer the sentence
    // would have had with no tier at all — not a plan quietly missing a step.
    expect(result.ok).toBe(false);
    expect(result.diagnostics.filter((d) => d.code === "E_NO_MATCH")).toHaveLength(3);
  });
});

describe("byte-stability with a model in the loop (REQ-COMP-7)", () => {
  it("compiles the same plan twice", async () => {
    const gateway = fakeGateway({
      label: "tier2",
      answer: (request) => ANSWERS[request.user] ?? null,
    });
    const register = (): void => {
      clearTiers();
      registerTier(tier2({ provider: "ollama", endpoint: "http://x", model: "fake", gateway }));
    };
    const { project: read } = readProject({ flows: [{ file: "loose.flow", text: FLOW }] });

    register();
    const first = await compileWithModelTiers(
      { project: read, projectName: "t", stable: true },
      { tier2: true },
    );
    register();
    const second = await compileWithModelTiers(
      { project: read, projectName: "t", stable: true },
      { tier2: true },
    );

    expect(second.plan.hash).toBe(first.plan.hash);
    expect(JSON.stringify(second.plan)).toBe(JSON.stringify(first.plan));
  });

  it("fixes the provenance timestamp under --stable and nothing else in it", async () => {
    /*
     * Provenance carries the time of the call, which differs on every compile —
     * so a plan with one model step could never be byte-stable and REQ-COMP-7
     * would hold for the grammar alone. The timestamp is the only field fixed:
     * which model, which digest, which prompt, how many tokens are facts about
     * the *answer* (REQ-AGT-3).
     */
    const gateway = fakeGateway({
      label: "tier2",
      answer: (request) => ANSWERS[request.user] ?? null,
    });
    registerTier(tier2({ provider: "ollama", endpoint: "http://x", model: "fake", gateway }));
    const { project: read } = readProject({ flows: [{ file: "loose.flow", text: FLOW }] });

    const stable = await compileWithModelTiers(
      { project: read, projectName: "t", stable: true },
      { tier2: true },
    );
    const provenance = stable.plan.stories[0]!.steps[0]!.origin.provenance!;
    expect(provenance.at).toBe("1970-01-01T00:00:00.000Z");
    expect(provenance.model).toBe("fake:tier2");
    expect(provenance.promptVersion).toBe("c2-1");
  });
});

describe("the pinned digest (REQ-COMP-3)", () => {
  /** An Ollama that serves one model, under whichever digest the test names. */
  const server = (digest: string): typeof globalThis.fetch =>
    (async (url: string | URL) => {
      if (String(url).endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "pinned:3b", digest }] }), {
          status: 200,
        });
      }
      return new Response(
        JSON.stringify({ response: '{"action":"click"}', prompt_eval_count: 1, eval_count: 1 }),
        { status: 200 },
      );
    }) as typeof globalThis.fetch;

  const ask = {
    promptVersion: "c2-1",
    system: "s",
    user: "u",
    answer: z.object({ action: z.string() }),
  };

  it("refuses when the served digest is not the pinned one", async () => {
    const gateway = localGateway({
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "pinned:3b",
      digest: "a".repeat(64),
      fetch: server("b".repeat(64)),
    });
    await expect(gateway.ask(ask)).rejects.toThrow(/reports digest b+, and the project pins a+/);
  });

  it("proceeds when they agree, and records the digest in provenance", async () => {
    const gateway = localGateway({
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "pinned:3b",
      digest: "a".repeat(64),
      fetch: server("a".repeat(64)),
    });
    const answer = await gateway.ask(ask);
    expect(answer.provenance.digest).toBe("a".repeat(64));
  });

  it("records the *served* digest when --allow-model-drift is set", async () => {
    /*
     * The flag suppresses the check, not the record. A plan compiled against
     * weights that are not the pinned ones says so in every step's provenance,
     * which is what makes the permission reviewable.
     */
    const gateway = localGateway({
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "pinned:3b",
      digest: "a".repeat(64),
      allowDigestDrift: true,
      fetch: server("b".repeat(64)),
    });
    const answer = await gateway.ask(ask);
    expect(answer.provenance.digest).toBe("b".repeat(64));
  });

  it("resolves the digest from the model list, not from the generation response", async () => {
    // Ollama's `/api/generate` reports no digest at all, so a pin checked
    // against it would be a pin that never fired — which is what it was.
    const seen: string[] = [];
    const spy = (async (url: string | URL) => {
      seen.push(String(url));
      return server("a".repeat(64))(url as never);
    }) as typeof globalThis.fetch;
    const gateway = localGateway({
      provider: "ollama",
      endpoint: "http://127.0.0.1:11434",
      model: "pinned:3b",
      digest: "a".repeat(64),
      fetch: spy,
    });
    await gateway.ask(ask);
    expect(seen.some((one) => one.endsWith("/api/tags"))).toBe(true);
  });
});

describe("few-shot retrieval (T4.3)", () => {
  const examples = [
    { id: "g-001", text: 'Open "https://x/login"', step: { action: "navigate", args: { url: "https://x/login" } } },
    { id: "g-002", text: "Click the sign in button", step: { action: "click", target: { phrase: "the sign in button" } } },
    { id: "g-003", text: "Refresh the page", step: { action: "refresh" } },
    { id: "g-004", text: 'Type "alice" into the username field', step: { action: "type", target: { phrase: "the username field" }, args: { value: "alice" } } },
  ];

  it("ignores quoted literals and references when comparing shapes", () => {
    // 'Type "alice" into the username field' and 'Type "bob" into the password
    // field' are the same *shape*; ranking on the quoted string would rank by
    // the accident of what a test happened to type.
    expect(shapeWords('Type "alice" into the {data.x} field')).toEqual(["type", "into", "the", "field"]);
  });

  it("uses the project's synonym vocabulary to recognise an action", () => {
    // The vocabulary already knows "reload" means `refresh`; a retrieval that
    // ignored it ranked "Reload the current page" beside whatever shared the
    // word "page".
    expect(suggestedAction("Reload the current page")).toBe("refresh");
    expect(suggestedAction("Go back")).toBe("back");
    expect(suggestedAction("Push the book now button")).toBeUndefined();
  });

  it("puts examples of the suggested action first", () => {
    expect(retrieve("Reload the current page", examples, 1)[0]!.id).toBe("g-003");
  });

  it("falls back to word overlap when the vocabulary recognises nothing", () => {
    expect(retrieve("Tap the sign in button", examples, 1)[0]!.id).toBe("g-002");
  });

  it("is deterministic, so one sentence always gets one prompt", () => {
    // The prompt is part of the cache key and part of what the model answers
    // from; a retrieval that reordered on ties would break REQ-COMP-7.
    const once = retrieve("Something entirely unlike any of these", examples).map((e) => e.id);
    const twice = retrieve("Something entirely unlike any of these", examples).map((e) => e.id);
    expect(twice).toEqual(once);
  });
});

describe("the golden set as examples (T4.3)", () => {
  it("converts an IR step into the shape the model answers in", () => {
    // Showing an example in a shape the model cannot produce would be showing
    // it the wrong thing.
    expect(
      asExample({
        action: "type",
        target: { ref: "username-field", phrase: "the username field", status: "unbound" },
        args: { value: { kind: "literal", value: "alice" } },
      }),
    ).toEqual({
      action: "type",
      target: { phrase: "the username field" },
      args: { value: "alice" },
    });
  });

  it("keeps a reference as a reference", () => {
    expect(
      asExample({ action: "type", args: { value: { kind: "data", path: "user.email" } } }),
    ).toEqual({ action: "type", argRefs: { value: { kind: "data", value: "user.email" } } });
  });
});

describe("the conventions a model is given (T4.3)", () => {
  it("names an argument for every action that takes one", () => {
    const named = new Set(ACTION_CONVENTIONS.map((one) => one.action));
    for (const action of ["navigate", "type", "press", "selectOption", "setChecked", "dialog"]) {
      expect(named, action).toContain(action);
    }
  });

  it("is one block, used by both tiers", () => {
    // A rule that held for Tier 2 and not Tier 3 would mean one sentence
    // compiling two ways depending on which model was available.
    const block = conventionsBlock();
    expect(block).toContain("navigate");
    expect(block).toContain("Distinctions that matter");
  });
});

describe("normalising the model's answer to the grammar's shape (T4.3)", () => {
  it("drops a target from an action that never has one", () => {
    // "the page" on a `refresh` would send the recorder looking for an element
    // the grammar would never have named.
    expect(toRawStep({ action: "refresh", target: { phrase: "the page" } })).toEqual({
      action: "refresh",
    });
    expect(toRawStep({ action: "scrollToTop", target: { phrase: "the top of the page" } })).toEqual({
      action: "scrollToTop",
    });
  });

  it("derives the expectation's subject rather than trusting it", () => {
    // A claim about a URL is about the page; any other claim on a step with a
    // target is about the target. The grammar derives it the same way.
    expect(
      toRawStep({
        action: "expect",
        target: { phrase: "the heading" },
        expect: { subject: "page", predicate: { kind: "visible" } },
      }),
    ).toMatchObject({ expect: { subject: "target" } });

    expect(
      toRawStep({
        action: "expect",
        expect: {
          subject: "target",
          predicate: { kind: "urlContains", value: { kind: "literal", value: "/x" } },
        },
      }),
    ).toMatchObject({ expect: { subject: "page" } });
  });

  it("keeps a number a number", () => {
    expect(toRawStep({ action: "switchWindow", args: { index: 1 } })).toEqual({
      action: "switchWindow",
      args: { index: 1 },
    });
  });
});

describe("registering the tiers (T4.3, T4.7)", () => {
  const config = configSchema.parse({ ...DEFAULT_CONFIG, project: "t" });

  it("registers nothing when nothing was asked for", () => {
    // The default is offline, and that is the whole of privacy mode's compile
    // half (REQ-NFR-3, T4.7).
    const registered = registerModelTiers({ config, wantTier2: false, wantTier3: false });
    expect(registered).toEqual({ tier2: false, tier3: false, refusals: [] });
    expect(hasModelTiers()).toBe(false);
  });

  it("refuses Tier 3 without a credential, and says how to give one", () => {
    const withTier3 = configSchema.parse({
      ...DEFAULT_CONFIG,
      project: "t",
      compile: {
        ...DEFAULT_CONFIG.compile,
        tier3: { provider: "anthropic", model: "claude-opus-5", promptVersion: "c3-1" },
      },
    });
    const before = { key: process.env["ANTHROPIC_API_KEY"], token: process.env["ANTHROPIC_AUTH_TOKEN"] };
    delete process.env["ANTHROPIC_API_KEY"];
    delete process.env["ANTHROPIC_AUTH_TOKEN"];
    try {
      const registered = registerModelTiers({ config: withTier3, wantTier2: false, wantTier3: true });
      expect(registered.tier3).toBe(false);
      expect(registered.refusals.join(" ")).toContain("ANTHROPIC_API_KEY");
    } finally {
      if (before.key !== undefined) process.env["ANTHROPIC_API_KEY"] = before.key;
      if (before.token !== undefined) process.env["ANTHROPIC_AUTH_TOKEN"] = before.token;
    }
  });
});
