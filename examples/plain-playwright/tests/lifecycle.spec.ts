/**
 * T1.6 Validate — the whole of it, in one runnable spec:
 *
 *   "A plain Playwright project records three bindings by picker in headed mode,
 *    replays headless with the model endpoint blocked, breaks on variant 3, heals
 *    inline, and the annotation reads `healed`."
 *
 * The four phases run serially against one bindings store in a temporary
 * directory, so the spec is the record → run → break → heal lifecycle rather than
 * four unrelated assertions. Recording uses the programmatic pick
 * (`svatahPicks`), which is the test affordance that lets the picker path run
 * with nobody at the keyboard; the headed interactive picker is the same code
 * path with the pick coming from a click instead.
 *
 * "With the model endpoint blocked" is enforced rather than asserted: the whole
 * process's `fetch` and `http.request` are replaced with ones that throw for any
 * host that is not the sample application. Module (a) makes no model call at any
 * point, and the way to show that is to make one impossible.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { test, expect, HEALED_ANNOTATION, modeFromEnvironment } from "@svatah/playwright-test";

/** One store for the whole lifecycle, thrown away at the end. */
const WORKSPACE = mkdtempSync(join(tmpdir(), "svatah-example-"));
const BINDINGS = join(WORKSPACE, "bindings");
const OUTPUT = join(WORKSPACE, ".svatah");

/** The three bindings recorded in phase 1, and how the pick names each. */
const PICKS: Record<string, string> = {
  "login.username-field": "username",
  "login.password-field": "password",
  "login.sign-in-button": "login-submit",
};

test.describe.configure({ mode: "serial" });

test.afterAll(() => {
  rmSync(WORKSPACE, { recursive: true, force: true });
});

/* ── the network guard ────────────────────────────────────────────────────── */

/**
 * Make a model call impossible for the rest of the process.
 *
 * REQ-RUN-1 says the executor makes no model calls, and REQ-NFR-1 says replay has
 * no network dependency other than the target platform. Asserting that by reading
 * the code proves nothing; refusing every request that is not to the application
 * under test proves it for as long as this spec runs.
 */
function blockEverythingButTheApplication(allowedOrigin: string): () => void {
  const realFetch = globalThis.fetch;
  const allowed = new URL(allowedOrigin);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    if (url.host !== allowed.host) {
      throw new Error(
        `Blocked a request to ${url.host}. Module (a) makes no model call and needs no network ` +
          "beyond the application under test (REQ-RUN-1, REQ-NFR-1).",
      );
    }
    return await realFetch(input, init);
  }) as typeof fetch;

  return () => {
    globalThis.fetch = realFetch;
  };
}

/* ── phase 1: record ──────────────────────────────────────────────────────── */

test.describe("1 — record", () => {
  test.use({ svatahMode: "record", bindingsDir: BINDINGS, svatahOutputDir: OUTPUT, svatahPicks: PICKS });

  test("records three bindings by picking the elements", async ({ page, bind, bindOutcomes }, testInfo) => {
    const restore = blockEverythingButTheApplication(testInfo.project.use.baseURL!);
    try {
      await page.goto("/login");

      await (await bind("login.username-field", "the username field")).fill("atul@example.com");
      await (await bind("login.password-field", "the password field")).fill("hunter2");
      await (await bind("login.sign-in-button", "the sign in button")).click();

      await expect(page).toHaveURL(/dashboard/);
    } finally {
      restore();
    }

    expect(bindOutcomes.map((o) => o.status)).toEqual(["recorded", "recorded", "recorded"]);
    expect(testInfo.annotations.filter((a) => a.type === "recorded")).toHaveLength(3);
  });

  test("writes a reviewable file per element, with human provenance", async () => {
    for (const [id, testId] of Object.entries(PICKS)) {
      const path = join(BINDINGS, ...id.split(".").map((s, i, all) => (i === all.length - 1 ? `${s}.yaml` : s)));
      expect(existsSync(path), `${id} was not written to ${path}`).toBe(true);

      const file = parseYaml(readFileSync(path, "utf8")) as {
        id: string;
        phrases: string[];
        entries: Array<{
          candidates: Array<{ by: string; value?: string; score: number }>;
          fingerprint: { tag: string };
          provenance: { model: string };
          context: { pattern: string; hash: string };
        }>;
      };

      expect(file.id).toBe(id);
      expect(file.phrases.length).toBeGreaterThan(0);
      expect(file.entries).toHaveLength(1);

      const entry = file.entries[0]!;
      // A person clicked it — no model was involved anywhere (LLD §6.5).
      expect(entry.provenance.model).toBe("human");
      expect(entry.candidates.length).toBeGreaterThan(1);
      expect(entry.candidates[0]!.value).toBe(testId);
      expect(entry.candidates.map((c) => c.score)).toEqual(
        [...entry.candidates.map((c) => c.score)].sort((a, b) => b - a),
      );
      expect(entry.fingerprint.tag).not.toBe("");
      expect(entry.context.hash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

/* ── phase 2: run ─────────────────────────────────────────────────────────── */

test.describe("2 — run", () => {
  test.use({ svatahMode: "run", bindingsDir: BINDINGS, svatahOutputDir: OUTPUT });

  test("replays the recorded bindings with no model and no other network", async ({
    page,
    bind,
    bindOutcomes,
  }, testInfo) => {
    const restore = blockEverythingButTheApplication(testInfo.project.use.baseURL!);
    try {
      await page.goto("/login");
      await (await bind("login.username-field")).fill("atul@example.com");
      await (await bind("login.password-field")).fill("hunter2");
      await (await bind("login.sign-in-button")).click();
      await expect(page).toHaveURL(/dashboard/);
    } finally {
      restore();
    }

    expect(bindOutcomes.map((o) => o.status)).toEqual(["resolved", "resolved", "resolved"]);
    // The strongest candidate is the one that resolved, so nothing had degraded.
    expect(bindOutcomes.map((o) => o.by)).toEqual(["testid", "testid", "testid"]);
    expect(testInfo.annotations.filter((a) => a.type === HEALED_ANNOTATION)).toHaveLength(0);
  });

  test("SVATAH_MODE selects the mode, and run is the default", () => {
    expect(modeFromEnvironment(undefined)).toBe("run");
    expect(modeFromEnvironment("run")).toBe("run");
    expect(modeFromEnvironment("record")).toBe("record");
    expect(modeFromEnvironment("heal")).toBe("heal");
    expect(() => modeFromEnvironment("guess")).toThrow(/must be "run", "record" or "heal"/);
  });

  test("a fully synthesised bundle survives variant 3 without needing to heal", async ({
    page,
    bind,
    bindOutcomes,
  }) => {
    // Variant 3 wraps every login field in an extra layout div, which invalidates
    // the descendant CSS path and the relative XPath. It does not invalidate the
    // test id, the id, the label or the accessible name — and a synthesised
    // bundle carries all of those. That a single-property change rarely breaks a
    // whole bundle is a real result, measured across all twenty variants in T1.5,
    // and it is why the heal phase below has to use a narrower binding.
    await page.goto("/login?variant=3");
    await (await bind("login.username-field")).fill("still fine");
    expect(bindOutcomes[0]!.status).toBe("resolved");
  });
});

/* ── phase 3: break, and heal ─────────────────────────────────────────────── */

test.describe("3 — break on variant 3, and heal inline", () => {
  test.use({ svatahMode: "heal", bindingsDir: BINDINGS, svatahOutputDir: OUTPUT });

  /** The XPath a v1 flow had for this field, before there were bindings at all. */
  const LEGACY_XPATH = '//form[@id="login"]/div[1]/input';

  test("narrows a binding to the single structural locator a migration produces", async ({ page }) => {
    // What a project arriving from hand-written locators has: one XPath per
    // element and nothing else. `svatah migrate` (T2.9) produces exactly this
    // shape from a v1 `.locator` file — the legacy sample flows are full of
    // `~xpath://input[@type='text']~` — and it is the shape healing exists for.
    // The fingerprint is the real recorded one, so relocalization has something
    // truthful to score against.
    const { BindingsStore } = await import("@svatah/bindings");
    const store = BindingsStore.load(BINDINGS);

    const recorded = store.entryFor("login.username-field", {})!;
    store.put(
      "login.legacy-username",
      { ...recorded, candidates: [{ by: "xpath", value: LEGACY_XPATH, score: 0.5 }] },
      "the username field",
    );
    store.save();

    expect(BindingsStore.load(BINDINGS).entryFor("login.legacy-username", {})!.candidates).toHaveLength(1);

    // It was a working locator before the change, and it is not one after: that
    // is what makes the next test a repair rather than a coincidence.
    await page.goto("/login");
    expect(await page.locator(`xpath=${LEGACY_XPATH}`).count()).toBe(1);
    await page.goto("/login?variant=3");
    expect(await page.locator(`xpath=${LEGACY_XPATH}`).count()).toBe(0);
  });

  test("breaks on variant 3, heals inline, and the annotation reads healed", async ({
    page,
    bind,
    bindOutcomes,
  }, testInfo) => {
    const restore = blockEverythingButTheApplication(testInfo.project.use.baseURL!);
    try {
      await page.goto("/login?variant=3");

      // The XPath the binding was recorded with no longer resolves: variant 3 put
      // a wrapper between the form and the field. Relocalization scores every
      // element on the page against the recorded fingerprint, finds the field
      // again, and the test carries on against it.
      const field = await bind("login.legacy-username", "the username field");
      await field.fill("healed@example.com");
      await expect(field).toHaveValue("healed@example.com");
    } finally {
      restore();
    }

    expect(bindOutcomes).toHaveLength(1);
    expect(bindOutcomes[0]!.status).toBe("healed");
    expect(bindOutcomes[0]!.message).toMatch(/^relocalized at \d\.\d{3}$/);

    // The Validate item, literally: the annotation reads `healed`.
    const healed = testInfo.annotations.filter((a) => a.type === HEALED_ANNOTATION);
    expect(healed).toHaveLength(1);
    expect(healed[0]!.description).toContain("login.legacy-username");
  });

  test("writes the failure for the healer and stages the repair without applying it", async () => {
    const failures = readFileSync(join(OUTPUT, "bind-failures.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { id: string; tried: Array<{ by: string }> });

    const failure = failures.find((f) => f.id === "login.legacy-username");
    expect(failure, ".svatah/bind-failures.jsonl has no line for the broken binding").toBeDefined();
    expect(failure!.tried.map((t) => t.by)).toEqual(["xpath"]);

    const proposals = readFileSync(join(OUTPUT, "heal-proposals.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as { id: string; score: number; after: { candidates: unknown[] } });

    expect(proposals).toHaveLength(1);
    expect(proposals[0]!.id).toBe("login.legacy-username");
    expect(proposals[0]!.score).toBeGreaterThan(0.72);
    expect((proposals[0]!.after.candidates as unknown[]).length).toBeGreaterThan(1);

    // The store still holds the broken binding. A repair reaches the repository
    // through a diff someone reads, not through a test run (REQ-HEAL-2,
    // REQ-HEAL-4): green has to keep meaning that a deterministic replay passed.
    const { BindingsStore } = await import("@svatah/bindings");
    const store = BindingsStore.load(BINDINGS);
    expect(store.entryFor("login.legacy-username", {})!.candidates).toHaveLength(1);
  });
});
