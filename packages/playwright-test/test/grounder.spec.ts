/**
 * T3.3 Validate — "`bind()` in record mode uses the model when module (b) is
 * present (test toggles installation)".
 *
 * Module (a) alone records by a person clicking (LLD §6.5). With module (b)
 * installed, `@svatah/yam-host-playwright` registers the recorder's grounder here
 * and record mode asks it first. This toggles that registration and shows the
 * difference — which is the only way to check "module (a) has no dependency on
 * (b)" is still true at the level where it matters: behaviour, not manifests.
 *
 * The grounder used here is a stand-in, not the recorder: this package cannot
 * import module (b) at all (LLD §1), and what is being tested is the plugin
 * point. The real recorder behind it is covered in `packages/cli`, and the
 * installation itself in `packages/host-playwright`.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BindingsStore,
  contextHash,
  fingerprintOf,
  synthesise,
} from "@svatah/yam-bindings";
import type { BindingEntry } from "@svatah/yam-schema";
import type { AgentSurface } from "@svatah/yam-surface";
import {
  Binder,
  clearBindGrounder,
  currentBindGrounder,
  hasBindGrounder,
  registerBindGrounder,
} from "../src/index.js";
import { expect, test } from "./fixtures.js";

test.afterEach(() => {
  clearBindGrounder();
});

test("module (a) alone has no grounder, and record mode needs a person", async () => {
  expect(hasBindGrounder()).toBe(false);
  expect(currentBindGrounder().name).toBe("none");
  // The default declines every request, which is what sends record mode to the
  // picker (LLD §6.5).
  expect(
    await currentBindGrounder().ground({ id: "login.username-field" }, null as never),
  ).toBeNull();
});

test("with one registered, record mode binds without anybody clicking", async ({ page, app }) => {
  const dir = mkdtempSync(join(tmpdir(), "yam-grounder-"));
  try {
    /*
     * A stand-in for module (b): it grounds "the username field" by finding the
     * textbox with that name in the snapshot, which is the shape the recorder's
     * `ground()` produces — a real entry, synthesised from the live element.
     */
    let asked = 0;
    registerBindGrounder({
      name: "stand-in",
      async ground(request, surface: AgentSurface): Promise<BindingEntry | null> {
        asked += 1;
        const snapshot = await surface.snapshot();
        const node = snapshot.nodes.find(
          (one) => one.role === "textbox" && one.name === "Username",
        );
        if (node === undefined || request.id !== "login.username-field") return null;

        const description = await surface.describe(node.ref);
        const candidates = await synthesise(surface, node.ref);
        return {
          context: {
            pattern: "/login",
            hash: contextHash(snapshot, node.ref).hash,
            platform: "web",
          },
          candidates,
          fingerprint: fingerprintOf(description),
          recordedAt: new Date().toISOString(),
          provenance: {
            model: "stand-in",
            promptVersion: "g-1",
            at: new Date().toISOString(),
            tokensIn: 0,
            tokensOut: 0,
          },
          verified: false,
        };
      },
    });

    await page.goto(`${app.origin}/login`);
    const binder = new Binder(page, {
      bindingsDir: dir,
      outputDir: dir,
      mode: "record",
      // No `picks`, and nobody at the keyboard: without the grounder this would
      // wait for a click and time out.
      pickTimeoutMs: 1_000,
    });

    const locator = await binder.bind("login.username-field", "the username field");
    await locator.fill("someone@example.com");
    expect(await locator.inputValue()).toBe("someone@example.com");
    expect(asked).toBe(1);

    await binder.flush();
    const store = BindingsStore.load(dir);
    expect(store.has("login.username-field")).toBe(true);
    expect(store.entries("login.username-field")[0]!.provenance.model).toBe("stand-in");
    // Not verified: `bind()` hands back a locator and the test does the acting
    // (REQ-REC-5).
    expect(store.entries("login.username-field")[0]!.verified).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a grounder that declines falls back to the picker, rather than failing", async ({
  page,
  app,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "yam-grounder-"));
  try {
    registerBindGrounder({
      name: "declines",
      async ground(): Promise<BindingEntry | null> {
        return null;
      },
    });

    await page.goto(`${app.origin}/login`);
    const binder = new Binder(page, {
      bindingsDir: dir,
      outputDir: dir,
      mode: "record",
      // The programmatic pick is the picker's stand-in for CI (LLD §6.5), and
      // reaching it is the proof that a decline fell through rather than failed.
      picks: new Map([["login.username-field", "username"]]),
    });

    await binder.bind("login.username-field", "the username field");
    await binder.flush();

    const store = BindingsStore.load(dir);
    expect(store.entries("login.username-field")[0]!.provenance.model).toBe("human");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a grounder that throws also falls back, so a model outage is not a failed test", async ({
  page,
  app,
}) => {
  const dir = mkdtempSync(join(tmpdir(), "yam-grounder-"));
  try {
    registerBindGrounder({
      name: "broken",
      async ground(): Promise<BindingEntry | null> {
        throw new Error("the model endpoint is unreachable");
      },
    });

    await page.goto(`${app.origin}/login`);
    const binder = new Binder(page, {
      bindingsDir: dir,
      outputDir: dir,
      mode: "record",
      picks: new Map([["login.username-field", "username"]]),
    });

    await binder.bind("login.username-field", "the username field");
    await binder.flush();
    expect(BindingsStore.load(dir).has("login.username-field")).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
