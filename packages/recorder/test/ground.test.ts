/**
 * T3.2's Validate list.
 *
 * "Recorded-snapshot tests with a fake gateway; pruning keeps interactive nodes;
 * redaction; vision only when allowed; refuses in `production` without
 * `--force-production`."
 *
 * The surface is a replay of `apps/sample-web` recorded by
 * `scripts/record-snapshots.mjs`, and the gateway is the fake one. Between them
 * there is no browser and no credential, and nothing is simulated: every answer
 * the surface gives came off the real page once.
 */
import { describe, expect, it } from "vitest";
import { fakeGateway, GatewayRefusal, type GatewayRequest } from "@svatah/gateway";
import { estimateTokens, isInteractiveRole } from "@svatah/surface";
import {
  assertRecordable,
  EnvironmentRefused,
  ground,
  PROMPT_VERSION,
  prune,
  question,
  SYSTEM,
  type GroundOptions,
} from "../src/index.js";
import { RecordedSurface, recordedPage } from "./recorded-surface.js";

/** A gateway that always names one reference. */
function chooses(ref: string | null, confidence = 0.95, captured?: unknown[]) {
  return fakeGateway({
    answer: () => ({ ref, why: "the recorded fixture says so", confidence }),
    ...(captured === undefined ? {} : { captured }),
  });
}

/** A gateway that answers from the question it was given, like the real one does. */
function reads(pick: (user: string) => string | null, options: { secrets?: Set<string> } = {}) {
  const questions: string[] = [];
  const gateway = fakeGateway({
    answer: (request: GatewayRequest<unknown>) => {
      questions.push(request.user);
      return { ref: pick(request.user), why: "read from the snapshot", confidence: 0.9 };
    },
    ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
  });
  return { gateway, questions };
}

const login = () => new RecordedSurface(recordedPage("/login"));

function options(gateway: GroundOptions["gateway"], extra: Partial<GroundOptions> = {}): GroundOptions {
  return { gateway, ...extra };
}

/* ── the decision ─────────────────────────────────────────────────────────── */

describe("grounding a phrase to an element (REQ-REC-2, LLD §11)", () => {
  it("writes a binding entry from the element the model chose", async () => {
    const surface = login();
    const { decision, entry } = await ground(
      { id: "login.username-field", phrase: "the username field" },
      surface,
      options(chooses("r10")),
    );

    expect(decision.outcome).toBe("grounded");
    expect(decision.ref).toBe("r10");
    expect(entry).toBeDefined();

    // The candidates came from the element, not from the model: the model saw a
    // snapshot with roles and names in it and never saw a `data-testid`.
    expect(entry!.candidates.map((c) => c.by)).toContain("testid");
    expect(entry!.candidates[0]!.score).toBeGreaterThanOrEqual(
      entry!.candidates[entry!.candidates.length - 1]!.score,
    );
    expect(entry!.context.pattern).toBe("/login");
    expect(entry!.context.platform).toBe("web");
    expect(entry!.fingerprint.tag).toBe("input");
  });

  it("records the prompt version and the model on the entry (REQ-AGT-3, REQ-STD-4)", async () => {
    const { entry } = await ground(
      { id: "login.login-button", phrase: "the login button" },
      login(),
      options(chooses("r13")),
    );
    expect(entry!.provenance.promptVersion).toBe(PROMPT_VERSION);
    // The fake says it is fake, so an artifact recorded this way can never be
    // mistaken for one a model produced.
    expect(entry!.provenance.model).toBe("fake:fake");
  });

  it("does not call the binding verified: grounding has not acted (REQ-REC-5)", async () => {
    const { entry } = await ground(
      { id: "login.login-button", phrase: "the login button" },
      login(),
      options(chooses("r13")),
    );
    expect(entry!.verified).toBe(false);
  });

  it("a null is not-found, and says whether the page was fully described", async () => {
    const { decision, entry } = await ground(
      { id: "checkout.pay-button", phrase: "the pay button" },
      login(),
      options(chooses(null)),
    );
    expect(decision.outcome).toBe("not-found");
    expect(entry).toBeUndefined();
    expect(decision.message).toContain("the pay button");
  });

  it("a guess is refused rather than written (below the confidence floor)", async () => {
    const { decision, entry } = await ground(
      { id: "login.username-field", phrase: "the username field" },
      login(),
      options(chooses("r10", 0.2)),
    );
    expect(decision.outcome).toBe("low-confidence");
    expect(entry).toBeUndefined();
    expect(decision.message).toContain("0.20");
  });

  it("a reference the page does not have is unverified, not a crash", async () => {
    const { decision, entry } = await ground(
      { id: "login.username-field", phrase: "the username field" },
      login(),
      options(chooses("r999")),
    );
    expect(decision.outcome).toBe("unverified");
    expect(entry).toBeUndefined();
  });

  it("a refusal from the model is an outcome, not an exception the caller must catch", async () => {
    const refusing = fakeGateway({ answer: () => null });
    const { decision } = await ground(
      { id: "login.username-field", phrase: "the username field" },
      login(),
      options(refusing),
    );
    expect(decision.outcome).toBe("refused");
    expect(decision.message).toContain("declined");
    // The gateway's own error class is what the recorder caught; a caller that
    // wants it can still see one.
    expect(new GatewayRefusal("x", { category: "cyber" }).category).toBe("cyber");
  });

  it("chooses an element the model can actually see in what it was sent", async () => {
    // The model reads the snapshot it was given and picks the textbox named
    // "Password". Nothing here tells the test which ref that is.
    const { gateway, questions } = reads((user) => {
      const line = user.split("\n").find((l) => l.includes('textbox "Password"'));
      return /\[ref=([^\]]+)\]/.exec(line ?? "")?.[1] ?? null;
    });

    const { decision, entry } = await ground(
      { id: "login.password-field", phrase: "the password field" },
      login(),
      options(gateway),
    );

    expect(decision.outcome).toBe("grounded");
    expect(entry!.fingerprint.attrs["type"]).toBe("password");
    expect(questions[0]).toContain("Phrase: the password field");
    expect(questions[0]).toContain("Element id: login.password-field");
  });
});

/* ── the dry-check ────────────────────────────────────────────────────────── */

describe("the dry-check: a binding has to be re-findable (REQ-REC-3)", () => {
  it("asks the surface to resolve the best candidate back to the same element", async () => {
    const surface = login();
    await ground(
      { id: "login.username-field", phrase: "the username field" },
      surface,
      options(chooses("r10")),
    );
    // Synthesis verifies each candidate; the dry-check then asks the question
    // the resolver will ask at replay, of the candidate a run will try first.
    expect(surface.calls.locates.length).toBeGreaterThan(1);
  });

  it("an element nothing can be synthesised from is unverified, not a binding", async () => {
    const page = recordedPage("/login");
    const surface = new RecordedSurface({
      ...page,
      // An element with no attributes, no name and no text: synthesis has
      // nothing to make a candidate from except coordinates, and coordinates
      // that resolve to something else are not a binding.
      describe: {
        ...page.describe,
        r10: {
          ...page.describe["r10"]!,
          attrs: {},
          text: "",
          name: "",
          box: [0, 0, 0, 0],
        },
      },
    });

    const { decision, entry } = await ground(
      { id: "login.username-field", phrase: "the username field" },
      surface,
      options(chooses("r10")),
    );
    expect(decision.outcome).toBe("unverified");
    expect(entry).toBeUndefined();
  });
});

/* ── pruning ──────────────────────────────────────────────────────────────── */

describe("pruning keeps what the answer could be (REQ-NFR-2, LLD §11)", () => {
  const dashboard = recordedPage("/dashboard").snapshot;

  it("sends the whole page when it fits", () => {
    const result = prune(dashboard, { maxTokens: 100_000 });
    expect(result.pruned).toBe(false);
    expect(result.overBudget).toBe(false);
    expect(result.text).toBe(dashboard.text);
  });

  it("keeps every interactive element when it does not", () => {
    const interactive = dashboard.nodes.filter(
      (n) => isInteractiveRole(n.role) && !n.states.includes("hidden"),
    );
    expect(interactive.length).toBeGreaterThan(3);

    const result = prune(dashboard, { maxTokens: 40 });
    for (const node of interactive) {
      expect(result.text, `${node.role} "${node.name ?? ""}" was pruned away`).toContain(
        `[ref=${node.ref}]`,
      );
    }
  });

  it("keeps the structure that gives an element its address", () => {
    const result = prune(dashboard, { maxTokens: 200 });
    const landmarks = dashboard.nodes.filter((n) => n.role === "navigation" || n.role === "main");
    for (const node of landmarks) {
      expect(result.text).toContain(`[ref=${node.ref}]`);
    }
  });

  it("says it pruned, and says when even the controls are over budget", () => {
    // The floor is the controls and their ancestors; nothing smaller is sent.
    const floor = prune(dashboard, { maxTokens: 1 });
    expect(floor.overBudget).toBe(true);
    expect(floor.pruned).toBe(true);
    // Still carries the controls: a snapshot without them is a snapshot without
    // the answer, and the flag is how the caller learns to raise the budget.
    expect(floor.text).toContain("[ref=");

    // A budget above the floor and below the whole page: something is cut, and
    // what is sent fits.
    const budget = floor.tokensEstimate + 20;
    const roomy = prune(dashboard, { maxTokens: budget });
    expect(roomy.pruned).toBe(true);
    expect(roomy.overBudget).toBe(false);
    expect(estimateTokens(roomy.text)).toBeLessThanOrEqual(budget);
  });

  it("spends a remaining budget on nearby lines rather than leaving it", () => {
    const floor = prune(dashboard, { maxTokens: 1 });
    const narrow = prune(dashboard, { maxTokens: floor.tokensEstimate + 10 });
    const wide = prune(dashboard, { maxTokens: floor.tokensEstimate + 80 });
    expect(narrow.nodes.length).toBeGreaterThanOrEqual(floor.nodes.length);
    expect(wide.nodes.length).toBeGreaterThan(narrow.nodes.length);
    expect(estimateTokens(wide.text)).toBeLessThanOrEqual(floor.tokensEstimate + 80);
  });

  it("keeps document order, because the prompt tells the model to read it", () => {
    const result = prune(dashboard, { maxTokens: 300 });
    const order = result.nodes.map((n) => n.ref);
    const expected = dashboard.nodes.filter((n) => order.includes(n.ref)).map((n) => n.ref);
    expect(order).toEqual(expected);
  });

  it("tells the model the page was cut, so it can answer null", async () => {
    const { gateway, questions } = reads(() => null);
    await ground(
      { id: "app.nowhere", phrase: "the nowhere link" },
      new RecordedSurface(recordedPage("/dashboard")),
      options(gateway, { maxSnapshotTokens: 60 }),
    );
    expect(questions[0]).toContain("pruned to fit");
  });
});

/* ── redaction (REQ-REC-7, REQ-NFR-6) ─────────────────────────────────────── */

describe("a secret never reaches the model (REQ-REC-7)", () => {
  it("is stripped from the snapshot text before it is sent", async () => {
    const page = recordedPage("/login");
    const typed = {
      ...page,
      snapshot: {
        ...page.snapshot,
        // What a page looks like after the executor typed a password into it.
        nodes: page.snapshot.nodes.map((node) =>
          node.ref === "r11" ? { ...node, value: "qwerty123" } : node,
        ),
      },
    };

    const secrets = new Set(["qwerty123"]);
    const { gateway, questions } = reads(() => "r11", { secrets });

    await ground(
      { id: "login.password-field", phrase: "the password field" },
      new RecordedSurface(typed),
      options(gateway),
    );

    // The question the gateway was handed still holds it — redaction is the
    // gateway's job, done on the rendered body — and nothing that was sent does.
    expect(questions[0]).toContain("qwerty123");
    expect(gateway.usage().calls).toBe(1);
  });

  it("the gateway refuses to send a prompt a secret survived in", async () => {
    // `render()` redacts and then asserts. A recorder that forgot to hand the
    // secrets over would still be caught the moment one appeared in a prompt,
    // which is the guard that matters.
    const secrets = new Set(["qwerty123"]);
    const captured: unknown[] = [];
    const gateway = fakeGateway({
      answer: () => ({ ref: "r11", why: "x", confidence: 0.9 }),
      secrets,
      captured,
    });

    const page = recordedPage("/login");
    await ground(
      { id: "login.password-field", phrase: "the password field" },
      new RecordedSurface({
        ...page,
        snapshot: {
          ...page.snapshot,
          nodes: page.snapshot.nodes.map((node) =>
            node.ref === "r11" ? { ...node, value: "qwerty123" } : node,
          ),
        },
      }),
      options(gateway),
    );

    expect(JSON.stringify(captured)).not.toContain("qwerty123");
    expect(JSON.stringify(captured)).toContain("«redacted»");
  });
});

/* ── the vision fallback (REQ-REC-2) ──────────────────────────────────────── */

describe("a screenshot is a fallback, never the input (REQ-REC-2)", () => {
  const image = { mediaType: "image/png" as const, base64: "aGVsbG8=" };

  function withVision(pick: (user: string) => string | null, screenshot = true) {
    const captured: unknown[] = [];
    const gateway = fakeGateway({
      answer: (request: GatewayRequest<unknown>) => ({
        ref: pick(request.user),
        why: "x",
        confidence: 0.9,
      }),
      captured,
    });
    const surface = new RecordedSurface(recordedPage("/login"), { screenshot });
    return { gateway, surface, captured };
  }

  it("is not taken when the snapshot answered", async () => {
    const { gateway, surface } = withVision(() => "r10");
    const { decision } = await ground(
      { id: "login.username-field", phrase: "the username field" },
      surface,
      options(gateway, {
        visionFallback: true,
        screenshotPath: () => "shot.png",
        readScreenshot: async () => image,
      }),
    );
    expect(decision.usedVision).toBe(false);
    expect(surface.calls.screenshots).toEqual([]);
  });

  it("is not taken when it is not configured, even after a null", async () => {
    const { gateway, surface } = withVision(() => null);
    const { decision } = await ground(
      { id: "login.username-field", phrase: "the username field" },
      surface,
      options(gateway, {
        visionFallback: false,
        screenshotPath: () => "shot.png",
        readScreenshot: async () => image,
      }),
    );
    expect(decision.outcome).toBe("not-found");
    expect(decision.usedVision).toBe(false);
    expect(surface.calls.screenshots).toEqual([]);
  });

  it("is not taken when the adapter cannot take one", async () => {
    const { gateway, surface } = withVision(() => null, false);
    const { decision } = await ground(
      { id: "login.username-field", phrase: "the username field" },
      surface,
      options(gateway, {
        visionFallback: true,
        screenshotPath: () => "shot.png",
        readScreenshot: async () => image,
      }),
    );
    expect(decision.usedVision).toBe(false);
    expect(surface.calls.screenshots).toEqual([]);
  });

  it("is taken after a null when it is configured, and the picture is sent", async () => {
    let asked = 0;
    const captured: unknown[] = [];
    const gateway = fakeGateway({
      answer: () => {
        asked += 1;
        return asked === 1
          ? { ref: null, why: "not in the tree", confidence: 0.9 }
          : { ref: "r10", why: "visible in the screenshot", confidence: 0.9 };
      },
      captured,
    });
    const surface = new RecordedSurface(recordedPage("/login"));

    const { decision, entry } = await ground(
      { id: "login.username-field", phrase: "the username field" },
      surface,
      options(gateway, {
        visionFallback: true,
        screenshotPath: () => "shot.png",
        readScreenshot: async () => image,
      }),
    );

    expect(decision.outcome).toBe("grounded");
    expect(decision.usedVision).toBe(true);
    expect(entry).toBeDefined();
    expect(surface.calls.screenshots).toEqual(["shot.png"]);

    // The first call carried no image; the second did, and said so in words.
    const bodies = captured as Array<{ messages: Array<{ content: Array<{ type: string }> }> }>;
    expect(bodies[0]!.messages[0]!.content.map((c) => c.type)).toEqual(["text"]);
    expect(bodies[1]!.messages[0]!.content.map((c) => c.type)).toEqual(["image", "text"]);
    expect(JSON.stringify(bodies[1])).toContain("A screenshot of the page is attached");
  });
});

/* ── the environment (REQ-AUTO-7) ─────────────────────────────────────────── */

describe("recording against production is refused (REQ-AUTO-7, LLD §11)", () => {
  it("refuses, naming the flag that overrides it", async () => {
    await expect(
      ground(
        { id: "login.username-field", phrase: "the username field" },
        login(),
        options(chooses("r10"), { environment: "production" }),
      ),
    ).rejects.toBeInstanceOf(EnvironmentRefused);

    try {
      assertRecordable({ environment: "production" });
    } catch (error) {
      expect((error as Error).message).toContain("--force-production");
    }
  });

  it("refuses before anything is asked of the model or the page", async () => {
    const surface = login();
    const gateway = chooses("r10");
    await ground(
      { id: "x.y", phrase: "the thing" },
      surface,
      options(gateway, { environment: "production" }),
    ).catch(() => undefined);

    expect(gateway.usage().calls).toBe(0);
    expect(surface.calls.snapshots).toBe(0);
  });

  it("proceeds with the override, and in test and staging without one", async () => {
    for (const environment of ["test", "staging"] as const) {
      const { decision } = await ground(
        { id: "login.username-field", phrase: "the username field" },
        login(),
        options(chooses("r10"), { environment }),
      );
      expect(decision.outcome).toBe("grounded");
    }

    const { decision } = await ground(
      { id: "login.username-field", phrase: "the username field" },
      login(),
      options(chooses("r10"), { environment: "production", forceProduction: true }),
    );
    expect(decision.outcome).toBe("grounded");
  });
});

/* ── the prompt itself ────────────────────────────────────────────────────── */

describe("prompt g-1 (Draft 1 §9.2)", () => {
  it("is stable, so it caches; the question is what varies", () => {
    const a = question({ phrase: "the sign in button", snapshot: "- link [ref=r1]" });
    const b = question({ phrase: "the login button", snapshot: "- link [ref=r1]" });
    expect(a).not.toBe(b);
    // Two identical questions render identically: no timestamps, no run ids,
    // nothing that would give the cache a new key every call.
    expect(question({ phrase: "x", snapshot: "y" })).toBe(question({ phrase: "x", snapshot: "y" }));
  });

  it("tells the model that null is the right answer when it would be guessing", () => {
    expect(SYSTEM).toContain("Prefer null");
    expect(SYSTEM).toContain("Answer null when");
  });

  it("explains the snapshot format it is actually given", () => {
    const rendered = recordedPage("/login").snapshot.text.split("\n")[0]!;
    expect(rendered).toMatch(/^- \w+ ".*" \[ref=r\d+\]$/);
    expect(SYSTEM).toContain("[ref=");
  });
});

/**
 * Grounding a desktop snapshot the way a web one is grounded (T11.3, LLD §13.9).
 *
 * Two things differ and nothing else does: the question says which **window**
 * it is about rather than which page, and the binding's context pattern is that
 * window's title rather than a URL path. LLD §3.3 has always said a pattern is
 * "a URL *or window-title* pattern"; the recorder only ever read `url`, so
 * every desktop binding it wrote was keyed on `/` and every desktop grounding
 * question was asked without saying which screen it was about.
 */
describe("a desktop session grounds by window (T11.3)", () => {
  const ade = () =>
    new RecordedSurface(recordedPage("/login"), { kind: "desktop", windowTitle: "Svatah ADE" });

  it("asks about the window, not the page", async () => {
    const { gateway, questions } = reads(() => null);
    await ground({ id: "sign-in", phrase: "the Sign in button" }, ade(), options(gateway));
    expect(questions[0]).toContain("Window: Svatah ADE");
    expect(questions[0]).not.toContain("Page:");
  });

  it("still says `Page:` for a web session, and never both", async () => {
    const { gateway, questions } = reads(() => null);
    await ground({ id: "sign-in", phrase: "the Sign in button" }, login(), options(gateway));
    expect(questions[0]).toContain("Page: http://sample.test/login");
    expect(questions[0]).not.toContain("Window:");
  });

  it("keys the binding on the window title, not on `/`", async () => {
    const surface = ade();
    const first = (await surface.snapshot()).nodes.find((one) => one.role === "button");
    const { entry, decision } = await ground(
      { id: "sign-in", phrase: "the Sign in button" },
      surface,
      options(chooses(first?.ref ?? "r1")),
    );
    expect(decision.outcome, JSON.stringify(decision)).toBe("grounded");
    expect(entry?.context.platform).toBe("desktop");
    // A desktop pattern has no segments to generalise; `/` is not where it is.
    expect(entry?.context.pattern).toBe("Svatah ADE");
  });
});
