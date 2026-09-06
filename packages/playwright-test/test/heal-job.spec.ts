/**
 * T1.7 Validate — "variant-based end to end: failure, heal, diff applies with
 * `git apply`, re-run passes; unrepairable reported; plan and flows untouched".
 *
 * The whole point of REQ-HEAL-2 is that a repair arrives as a diff a person
 * reads and applies, so the test applies it the way a person would — with `git
 * apply` in a real git repository — rather than trusting the healer's own writer.
 * If the diff and the writer ever disagree, this fails.
 *
 * Refs: REQ-HEAL-1, 2, 3, 6, LLD §12, §10.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BindingsStore,
  contextHash,
  fingerprintOf,
  synthesise,
  tryResolve,
} from "@svatah/yam-bindings";
import {
  clearRegrounder,
  heal,
  hasRegrounder,
  NO_REGROUNDER,
  readBindFailures,
  registerRegrounder,
  renderHealMarkdown,
  renderHealReport,
  unifiedDiff,
  type HealInput,
} from "@svatah/yam-healer";
import { HUMAN_PROVENANCE_MODEL, type BindingEntry } from "@svatah/yam-schema";
import { PlaywrightSurface } from "@svatah/yam-adapter-playwright";
import { expect, test } from "./fixtures.js";

/** A throwaway git repository holding a bindings store. */
function makeRepository(): string {
  const dir = mkdtempSync(join(tmpdir(), "yam-heal-"));
  execFileSync("git", ["init", "--quiet"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@example.invalid"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Yam tests"], { cwd: dir });
  mkdirSync(join(dir, "bindings", "login"), { recursive: true });
  return dir;
}

/** The XPath a v1 flow had for the username field, before there were bindings. */
const LEGACY_XPATH = '//form[@id="login"]/div[1]/input';

/** Record a binding whose only candidate is that XPath — what a migration produces. */
async function seedStore(dir: string, surface: PlaywrightSurface, id: string): Promise<BindingEntry> {
  const ref = (await surface.locate({ by: "css", value: "#username", score: 1 }))[0]!;
  const description = await surface.describe(ref);
  const snapshot = await surface.snapshot();

  const entry: BindingEntry = {
    context: {
      pattern: (await surface.state()).url!,
      hash: contextHash(snapshot, ref).hash,
      platform: "web",
    },
    candidates: [{ by: "xpath", value: LEGACY_XPATH, score: 0.5 }],
    fingerprint: fingerprintOf(description),
    recordedAt: "2026-09-02T10:00:00.000Z",
    provenance: {
      model: HUMAN_PROVENANCE_MODEL,
      promptVersion: "migrate",
      at: "2026-09-02T10:00:00.000Z",
      tokensIn: 0,
      tokensOut: 0,
    },
    verified: true,
  };

  const store = BindingsStore.empty(join(dir, "bindings"));
  store.put(id, entry, "the username field");
  store.save();
  return entry;
}

test.describe("the heal job (REQ-HEAL-1, 2, 3)", () => {
  test.afterEach(() => clearRegrounder());

  test("a broken binding is repaired, the diff applies with git apply, and the re-run passes", async ({
    app,
  }, testInfo) => {
    test.setTimeout(180_000);
    const repository = makeRepository();

    const open = async (url: string): Promise<PlaywrightSurface> => {
      const surface = new PlaywrightSurface({
        browser: testInfo.project.name as "chromium" | "firefox" | "webkit",
        headless: true,
        snapshotMechanism: "own",
        timeoutMs: 5_000,
      });
      await surface.open({ baseUrl: app.origin });
      await surface.act("navigate", undefined, { url });
      return surface;
    };

    try {
      /* 1. Record the binding at variant 0, and commit it. */
      const baseline = await open("/login");
      await seedStore(repository, baseline, "login.username-field");
      await baseline.close();

      execFileSync("git", ["add", "-A"], { cwd: repository });
      execFileSync("git", ["commit", "--quiet", "-m", "record"], { cwd: repository });

      /* 2. On variant 3 the XPath no longer resolves — a real failure. */
      const broken = await open("/login?variant=3");
      const store = BindingsStore.load(join(repository, "bindings"));
      const attempt = await tryResolve("login.username-field", broken, store, { reportDrift: true });
      expect(attempt.ok, "variant 3 should have broken the binding").toBe(false);
      if (attempt.ok) return;
      expect(attempt.error.detail.tried.map((t) => t.candidate.by)).toEqual(["xpath"]);

      // The failure as a `bind()` run would have written it (LLD §12).
      writeFileSync(
        join(repository, "bind-failures.jsonl"),
        `${JSON.stringify(attempt.error.toFailureLine())}\n`,
        "utf8",
      );
      await broken.close();

      /* 3. Heal. Nothing is written: the diff is the output (REQ-HEAL-2). */
      const inputs = readBindFailures(repository);
      expect(inputs).toHaveLength(1);
      expect(inputs[0]!.id).toBe("login.username-field");
      expect(inputs[0]!.url).toContain("variant=3");

      const report = await heal({
        bindingsDir: join(repository, "bindings"),
        pathPrefix: "bindings",
        inputs,
        open: async (input) => await open(new URL(input.url!).pathname + new URL(input.url!).search),
      });

      expect(report.totals.repaired).toBe(1);
      expect(report.totals.unrepaired).toBe(0);
      expect(report.applied, "heal must not write the store unless asked").toBe(false);
      expect(report.usedModel, "module (a) alone uses no model").toBe(false);
      expect(report.regrounder).toBe("none");
      expect(report.results[0]!.outcome).toBe("repaired");
      expect(report.results[0]!.score).toBeGreaterThan(0.72);
      // The repair is a whole new bundle, not a patched XPath: that is what makes
      // the binding survive the next change too.
      expect(report.results[0]!.candidates!.length).toBeGreaterThan(1);

      await testInfo.attach("bindings.diff", { body: report.diff, contentType: "text/plain" });
      await testInfo.attach("heal-report.md", {
        body: renderHealMarkdown(report),
        contentType: "text/markdown",
      });

      /* 4. The diff applies with `git apply`, as a person would apply it. */
      expect(report.diff).toContain("diff --git a/bindings/login/username-field.yaml");
      // The legacy XPath goes, and a bundle of candidates arrives in its place.
      // The canonical YAML writer escapes the quotes inside the XPath, so the
      // removed line is matched on a fragment that survives the escaping.
      const removed = report.diff.split("\n").filter((line) => line.startsWith("-"));
      const added = report.diff.split("\n").filter((line) => line.startsWith("+"));
      expect(
        removed.some((line) => line.includes("/div[1]/input")),
        `the diff does not remove the legacy XPath:\n${report.diff}`,
      ).toBe(true);
      expect(added.some((line) => line.includes('by: "testid"'))).toBe(true);
      expect(added.some((line) => line.includes("previous:"))).toBe(true);

      const patch = join(repository, "bindings.diff");
      writeFileSync(patch, report.diff, "utf8");
      execFileSync("git", ["apply", "--check", "bindings.diff"], { cwd: repository });
      execFileSync("git", ["apply", "bindings.diff"], { cwd: repository });

      /* 5. The re-run passes: the repaired binding resolves on the broken page. */
      const rerun = await open("/login?variant=3");
      const repaired = BindingsStore.load(join(repository, "bindings"));
      const after = await tryResolve("login.username-field", rerun, repaired, {});
      expect(after.ok, "the repaired binding still does not resolve").toBe(true);
      if (!after.ok) return;

      // …and it resolves to the field it was always about.
      const described = await rerun.describe(after.resolution.ref);
      expect(described.attrs["id"]).toBe("username");
      await rerun.close();

      /* 6. The repair replaced the broken entry rather than sitting beside it. */
      expect(
        repaired.entries("login.username-field"),
        "the broken entry is still in the store, and LLD §6.3 would resolve it first",
      ).toHaveLength(1);

      /* 7. Lineage: a reviewer can see what it used to be (LLD §6.4). */
      const entry = repaired.entryFor("login.username-field", {})!;
      expect(entry.previous).toHaveLength(1);
      expect(entry.previous![0]!.provenance.model).toBe(HUMAN_PROVENANCE_MODEL);
      expect(entry.verified).toBe(true);

      /* 8. Nothing outside the bindings store was touched (REQ-HEAL-2). */
      const changed = execFileSync("git", ["diff", "--name-only"], { cwd: repository, encoding: "utf8" })
        .trim()
        .split("\n")
        .filter((line) => line !== "");
      expect(changed).toEqual(["bindings/login/username-field.yaml"]);
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  test("an unrepairable failure is reported, not dropped", async ({ app }, testInfo) => {
    test.setTimeout(120_000);
    const repository = makeRepository();

    const open = async (url: string): Promise<PlaywrightSurface> => {
      const surface = new PlaywrightSurface({
        browser: testInfo.project.name as "chromium" | "firefox" | "webkit",
        headless: true,
        snapshotMechanism: "own",
        timeoutMs: 5_000,
      });
      await surface.open({ baseUrl: app.origin });
      await surface.act("navigate", undefined, { url });
      return surface;
    };

    try {
      // A binding for an element that is not on the page at all: the fingerprint
      // describes something the checkout page does not have, so relocalization
      // has nothing to find.
      const baseline = await open("/login");
      const entry = await seedStore(repository, baseline, "login.username-field");
      await baseline.close();

      const inputs: HealInput[] = [
        {
          id: "login.username-field",
          source: "bind-failure",
          url: `${app.origin}/checkout`,
          tried: ["xpath"],
          contextDrift: true,
        },
      ];
      void entry;

      const report = await heal({
        bindingsDir: join(repository, "bindings"),
        pathPrefix: "bindings",
        inputs,
        open: async () => await open("/checkout"),
      });

      expect(report.totals.repaired).toBe(0);
      expect(report.totals.unrepaired).toBe(1);
      expect(report.results[0]!.outcome).toBe("not-found");
      expect(report.results[0]!.message).toContain("above the threshold");
      // Nothing changed, so there is nothing to apply.
      expect(report.diff).toBe("");

      const text = renderHealReport(report);
      expect(text).toContain("login.username-field");
      expect(text).toContain("not-found");
      expect(text).toContain("0 repaired by relocalization");
      expect(text).toContain("The unrepaired are reported, not dropped");

      const markdown = renderHealMarkdown(report);
      expect(markdown).toContain("## Not repaired");
      expect(markdown).toContain("Relocalization only — no model was involved");
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });

  test("--apply writes exactly the bytes the diff described", async ({ app }, testInfo) => {
    test.setTimeout(180_000);
    const withDiff = makeRepository();
    const withApply = makeRepository();

    const open = async (url: string): Promise<PlaywrightSurface> => {
      const surface = new PlaywrightSurface({
        browser: testInfo.project.name as "chromium" | "firefox" | "webkit",
        headless: true,
        snapshotMechanism: "own",
        timeoutMs: 5_000,
      });
      await surface.open({ baseUrl: app.origin });
      await surface.act("navigate", undefined, { url });
      return surface;
    };

    try {
      for (const repository of [withDiff, withApply]) {
        const baseline = await open("/login");
        await seedStore(repository, baseline, "login.username-field");
        await baseline.close();
        execFileSync("git", ["add", "-A"], { cwd: repository });
        execFileSync("git", ["commit", "--quiet", "-m", "record"], { cwd: repository });
      }

      const inputs: HealInput[] = [
        {
          id: "login.username-field",
          source: "bind-failure",
          url: `${app.origin}/login?variant=3`,
          tried: ["xpath"],
          contextDrift: false,
        },
      ];

      const viaDiff = await heal({
        bindingsDir: join(withDiff, "bindings"),
        pathPrefix: "bindings",
        inputs,
        open: async () => await open("/login?variant=3"),
      });
      writeFileSync(join(withDiff, "p.diff"), viaDiff.diff, "utf8");
      execFileSync("git", ["apply", "p.diff"], { cwd: withDiff });

      const viaApply = await heal({
        bindingsDir: join(withApply, "bindings"),
        pathPrefix: "bindings",
        inputs,
        apply: true,
        open: async () => await open("/login?variant=3"),
      });
      expect(viaApply.applied).toBe(true);

      // The two paths must produce the same file. If they diverge, the diff a
      // reviewer reads is not the change that `--apply` makes.
      const a = readFileSync(join(withDiff, "bindings", "login", "username-field.yaml"), "utf8");
      const b = readFileSync(join(withApply, "bindings", "login", "username-field.yaml"), "utf8");
      expect(stripTimestamps(b)).toBe(stripTimestamps(a));
    } finally {
      rmSync(withDiff, { recursive: true, force: true });
      rmSync(withApply, { recursive: true, force: true });
    }
  });
});

test.describe("the Regrounder plugin (LLD §10)", () => {
  test.afterEach(() => clearRegrounder());

  test("the default is a no-op, which is what makes module (a) alone honest", async () => {
    clearRegrounder();
    expect(hasRegrounder()).toBe(false);
    expect(
      await NO_REGROUNDER.ground(
        { id: "x", entry: {} as BindingEntry },
        {} as never,
      ),
    ).toBeNull();
  });

  test("a registered Regrounder is used when relocalization cannot place the element", async ({
    app,
  }, testInfo) => {
    test.setTimeout(120_000);
    const repository = makeRepository();

    const open = async (url: string): Promise<PlaywrightSurface> => {
      const surface = new PlaywrightSurface({
        browser: testInfo.project.name as "chromium" | "firefox" | "webkit",
        headless: true,
        snapshotMechanism: "own",
        timeoutMs: 5_000,
      });
      await surface.open({ baseUrl: app.origin });
      await surface.act("navigate", undefined, { url });
      return surface;
    };

    try {
      const baseline = await open("/login");
      await seedStore(repository, baseline, "login.username-field");
      await baseline.close();

      // Module (b) will register the recorder here (LLD §10). This stands in for
      // it: it grounds by knowing the answer, which is what a model does after a
      // fashion, and it proves the seam is real rather than declared.
      registerRegrounder({
        name: "test-regrounder",
        async ground(request, surface) {
          const refs = await surface.locate({ by: "css", value: "#cvv", score: 1 });
          if (refs.length !== 1) return null;
          const candidates = await synthesise(surface, refs[0]!);
          return {
            ...request.entry,
            candidates,
            fingerprint: fingerprintOf(await surface.describe(refs[0]!)),
            verified: false,
          };
        },
      });
      expect(hasRegrounder()).toBe(true);

      const report = await heal({
        bindingsDir: join(repository, "bindings"),
        pathPrefix: "bindings",
        inputs: [
          {
            id: "login.username-field",
            source: "bind-failure",
            url: `${app.origin}/checkout`,
            tried: ["xpath"],
            contextDrift: true,
          },
        ],
        open: async () => await open("/checkout"),
      });

      expect(report.usedModel).toBe(true);
      expect(report.regrounder).toBe("test-regrounder");
      expect(report.totals.regrounded).toBe(1);
      expect(report.results[0]!.outcome).toBe("regrounded");
      expect(report.diff).not.toBe("");
    } finally {
      rmSync(repository, { recursive: true, force: true });
    }
  });
});

test.describe("the diff generator", () => {
  test("produces a unified diff git apply accepts", () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-diff-"));
    try {
      execFileSync("git", ["init", "--quiet"], { cwd: dir });
      execFileSync("git", ["config", "user.email", "t@example.invalid"], { cwd: dir });
      execFileSync("git", ["config", "user.name", "t"], { cwd: dir });

      const before = ["one", "two", "three", "four", "five", "six", "seven", "eight"].join("\n") + "\n";
      const after = ["one", "two", "THREE", "four", "five", "six", "seven", "eight"].join("\n") + "\n";

      writeFileSync(join(dir, "a.txt"), before, "utf8");
      execFileSync("git", ["add", "-A"], { cwd: dir });
      execFileSync("git", ["commit", "--quiet", "-m", "one"], { cwd: dir });

      const diff = unifiedDiff({ path: "a.txt", before, after });
      writeFileSync(join(dir, "p.diff"), diff, "utf8");
      execFileSync("git", ["apply", "p.diff"], { cwd: dir });

      expect(readFileSync(join(dir, "a.txt"), "utf8")).toBe(after);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("says nothing about a file that did not change", () => {
    expect(unifiedDiff({ path: "a.txt", before: "same\n", after: "same\n" })).toBe("");
  });

  test("handles a new file and a deleted one", () => {
    expect(unifiedDiff({ path: "a.txt", before: "", after: "new\n" })).toContain("--- /dev/null");
    expect(unifiedDiff({ path: "a.txt", before: "old\n", after: "" })).toContain("+++ /dev/null");
  });
});

/** Timestamps differ between two runs of the same repair; the content should not. */
function stripTimestamps(yaml: string): string {
  return yaml.replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, "<at>");
}

/** Referenced so `existsSync` stays imported for the readers above. */
void existsSync;
