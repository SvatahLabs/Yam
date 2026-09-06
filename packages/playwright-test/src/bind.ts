/**
 * `bind()` for plain Playwright tests (LLD §6.5, REQ-REC-11, REQ-HEAL-6).
 *
 * This is the adoption wedge (ADR-11, REQ-PKG-1, REQ-PKG-2): a Playwright user
 * adds one dependency and one fixture and gets bindings and model-free healing,
 * with no flow language, no compiler and no model anywhere.
 *
 * ```ts
 * import { test } from "@svatah/yam-playwright-test";
 *
 * test("login", async ({ page, bind }) => {
 *   await page.goto("/login");
 *   await (await bind("login.username-field", "the username field")).fill("user");
 *   await (await bind("login.sign-in-button")).click();
 * });
 * ```
 *
 * Three modes, chosen by `YAM_MODE`:
 *
 * * **run** (the default) — the resolver reads the store and returns a Playwright
 *   `Locator`. No model, no network beyond the application under test. A failure
 *   raises `LocatorError` with every candidate tried, and writes a line to
 *   `.yam/bind-failures.jsonl` for the healer (LLD §12).
 * * **record** — an id with no binding for the current context is grounded by a
 *   person clicking it, and the binding is synthesised with
 *   `provenance.model: "human"`. Module (a) records without any model.
 * * **heal** — on a `LocatorError`, relocalization runs inline, the resolution is
 *   retried once, and the test is annotated `healed`. The repair is staged, not
 *   applied: a run that only passed because bindings were healed is `healed`,
 *   never `passed` (REQ-HEAL-4, ADR-6).
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve as resolvePath } from "node:path";
import type { Locator, Page } from "playwright";
import type { LocatorError } from "@svatah/yam-bindings";
import {
  BindingsStore,
  contextHash,
  contextPattern,
  fingerprintOf,
  relocalize,
  synthesise,
  tryResolve,
} from "@svatah/yam-bindings";
import { HUMAN_PROVENANCE_MODEL, type BindingEntry, type Candidate } from "@svatah/yam-schema";
import { PlaywrightSurface } from "@svatah/yam-adapter-playwright";
import { clearPickerStamp, parseProgrammaticPicks, pickInteractively, pickSelector } from "./picker.js";
import { currentBindGrounder, hasBindGrounder } from "./grounder.js";

export type BindMode = "run" | "record" | "heal";

/** How a `bind()` call was answered, for the reporter and the annotations. */
export interface BindOutcome {
  readonly id: string;
  readonly phrase?: string;
  readonly mode: BindMode;
  readonly status: "resolved" | "recorded" | "healed" | "failed";
  readonly by?: Candidate["by"];
  readonly durationMs: number;
  readonly message?: string;
}

export interface BindOptions {
  /** Where the store lives. Default `bindings/`. */
  bindingsDir?: string;
  /** Where bind failures and staged repairs are written. Default `.yam/`. */
  outputDir?: string;
  mode?: BindMode;
  /** Attributes treated as test ids. */
  testIdAttributes?: readonly string[];
  /**
   * Keep the origin in a recorded entry's `context.pattern`
   * (`config.bindings.matchHost`, LLD §3.5). Default false, so a store recorded
   * against `http://127.0.0.1:<ephemeral>` still resolves on the next run and
   * can be committed and shared.
   */
  matchHost?: boolean;
  /** Per-candidate timeout for the resolver. */
  candidateTimeoutMs?: number;
  /** How long a person has to click, in record mode. */
  pickTimeoutMs?: number;
  /**
   * Element id → selector, for recording without a person. A test affordance so
   * record mode can run headless in CI; `YAM_PICK` sets it from the
   * environment. Not part of the quick start.
   */
  picks?: ReadonlyMap<string, string>;
  /** Called for every `bind()` call, however it ended. */
  onOutcome?: (outcome: BindOutcome) => void;
}

/** `YAM_MODE`, defaulting to `run` (LLD §6.5). */
export function modeFromEnvironment(value: string | undefined): BindMode {
  const mode = (value ?? "run").trim().toLowerCase();
  if (mode === "record" || mode === "heal" || mode === "run") return mode;
  throw new Error(`YAM_MODE must be "run", "record" or "heal"; got "${value ?? ""}".`);
}

/**
 * A `bind()` bound to one page.
 *
 * Held for the life of a test: it owns the surface wrapping the test's page and
 * the store, so repeated `bind()` calls in one test do not reopen either.
 */
export class Binder {
  private surface: PlaywrightSurface | undefined;
  private store: BindingsStore | undefined;
  private dirty = false;
  readonly outcomes: BindOutcome[] = [];

  constructor(
    private readonly page: Page,
    private readonly options: BindOptions = {},
  ) {}

  get mode(): BindMode {
    return this.options.mode ?? modeFromEnvironment(process.env["YAM_MODE"]);
  }

  private get bindingsDir(): string {
    return resolvePath(this.options.bindingsDir ?? process.env["YAM_BINDINGS"] ?? "bindings");
  }

  private get outputDir(): string {
    return resolvePath(this.options.outputDir ?? process.env["YAM_OUT"] ?? ".yam");
  }

  private get testIdAttributes(): readonly string[] {
    return this.options.testIdAttributes ?? ["data-testid", "data-test-id", "data-test"];
  }

  private async open(): Promise<{ surface: PlaywrightSurface; store: BindingsStore }> {
    if (this.surface === undefined) {
      this.surface = new PlaywrightSurface({
        page: this.page,
        testIdAttributes: this.testIdAttributes,
        timeoutMs: this.options.candidateTimeoutMs ?? 5_000,
      });
      await this.surface.open({});
    }
    if (this.store === undefined) this.store = BindingsStore.load(this.bindingsDir);
    return { surface: this.surface, store: this.store };
  }

  /**
   * Resolve an element id to a Playwright `Locator`.
   *
   * `phrase` is optional after the first record: it is kept with the binding so
   * a person reading the store, and a target dictionary built from it, can say
   * what the element is called (REQ-COMP-5).
   */
  async bind(id: string, phrase?: string): Promise<Locator> {
    const started = Date.now();
    const { surface, store } = await this.open();
    const mode = this.mode;

    if (mode === "record" && !this.hasBindingHere(store, id)) {
      const locator = await this.record(id, phrase);
      this.record_(
        { id, ...(phrase === undefined ? {} : { phrase }), mode, status: "recorded", durationMs: Date.now() - started },
      );
      return locator;
    }

    if (phrase !== undefined && store.has(id)) {
      store.addPhrase(id, phrase);
      this.dirty = true;
    }

    const attempt = await tryResolve(id, surface, store, {
      ...(phrase === undefined ? {} : { phrase }),
      ...(this.options.candidateTimeoutMs === undefined
        ? {}
        : { candidateTimeoutMs: this.options.candidateTimeoutMs }),
      reportDrift: true,
    });

    if (attempt.ok) {
      const candidate = attempt.resolution.entry.candidates[attempt.resolution.candidateIndex]!;
      this.record_({
        id,
        ...(phrase === undefined ? {} : { phrase }),
        mode,
        status: "resolved",
        by: attempt.resolution.by,
        durationMs: Date.now() - started,
      });
      return surface.locatorForCandidate(candidate);
    }

    // The failure line is written whatever the mode: the healer's other input is
    // `.yam/bind-failures.jsonl`, so a plain `run` produces the material a
    // later `yam heal --from-bind-failures` works from (LLD §12).
    this.writeFailure(attempt.error);

    if (mode !== "heal") {
      this.record_({
        id,
        ...(phrase === undefined ? {} : { phrase }),
        mode,
        status: "failed",
        durationMs: Date.now() - started,
        message: attempt.error.message,
      });
      throw attempt.error;
    }

    return await this.heal(id, phrase, attempt.error, started);
  }

  /** Whether the store has a binding for the context the page is in now. */
  private hasBindingHere(store: BindingsStore, id: string): boolean {
    if (!store.has(id)) return false;
    return store.entryFor(id, { url: this.page.url(), platform: "web" }) !== undefined;
  }

  /* ── record (LLD §6.5) ──────────────────────────────────────────────────── */

  private async record(id: string, phrase?: string): Promise<Locator> {
    const { surface, store } = await this.open();

    /*
     * Module (b), if it is installed (LLD §6.5, T3.3).
     *
     * With the flow language present, `@svatah/yam-host-playwright` has registered
     * the recorder's grounder, and `bind("login.username-field", "the username
     * field")` is grounded by the same `ground()` a flow gets. Module (a) alone
     * has none registered and goes straight to the picker, which is what keeps
     * "module (a) has no dependency on (b)" true rather than aspirational.
     *
     * A `null` falls back to the picker: a person at a keyboard is a better
     * answer than an error, and that fallback is what makes this safe to try.
     */
    if (hasBindGrounder()) {
      const grounder = currentBindGrounder();
      const entry = await grounder
        .ground({ id, ...(phrase === undefined ? {} : { phrase }) }, surface)
        .catch(() => null);
      if (entry !== null) {
        store.put(id, entry, phrase);
        this.dirty = true;
        return surface.locatorForCandidate(entry.candidates[0]!);
      }
    }

    const picks = this.options.picks ?? parseProgrammaticPicks(process.env["YAM_PICK"], this.testIdAttributes[0]);
    const programmatic = picks.get(id);

    let selector: string;
    let source: "human" | "programmatic";

    if (programmatic !== undefined) {
      // A pick from the fixture option has not been through `parseProgrammaticPicks`,
      // so it is normalised here: both sources must mean the same thing.
      selector = pickSelector(programmatic, this.testIdAttributes[0]);
      source = "programmatic";
    } else {
      const pick = await pickInteractively(this.page, id, this.options.pickTimeoutMs ?? 120_000);
      if (pick === null) {
        throw new Error(
          `Recording "${id}" was cancelled. Click the element, or set YAM_PICK to name it ` +
            "when there is nobody at the keyboard.",
        );
      }
      selector = pick.selector;
      source = "human";
    }

    const refs = await surface.locate({ by: "css", value: selector, score: 1 });
    await clearPickerStamp(this.page);
    if (refs.length !== 1) {
      throw new Error(
        `Recording "${id}": the selector ${JSON.stringify(selector)} matched ${refs.length} elements; exactly one is needed.`,
      );
    }
    const ref = refs[0]!;

    const description = await surface.describe(ref);
    const candidates = await synthesise(surface, ref, { testIdAttributes: this.testIdAttributes });
    if (candidates.length === 0) {
      throw new Error(
        `Recording "${id}": nothing about that element identifies it uniquely — no test id, id, ` +
          "accessible name, label or stable path. Give it a `data-testid`.",
      );
    }

    const snapshot = await surface.snapshot();
    const { hash } = contextHash(snapshot, ref);

    const entry: BindingEntry = {
      context: {
        // Path-only unless the project asked for the host (Draft 2.3): an
        // origin here is a port that existed for one process, and a store that
        // cannot be committed is not a store.
        pattern: contextPattern(this.page.url(), { matchHost: this.options.matchHost === true }),
        hash,
        platform: "web",
        ...(await this.viewport()),
      },
      candidates,
      fingerprint: fingerprintOf(description),
      recordedAt: new Date().toISOString(),
      // A person clicked it. REQ-STD-4 requires provenance on every recorded
      // binding, and "a person chose this" is the honest answer here — there was
      // no model (LLD §6.5).
      provenance: {
        model: HUMAN_PROVENANCE_MODEL,
        promptVersion: source === "human" ? "picker" : "picker:programmatic",
        at: new Date().toISOString(),
        tokensIn: 0,
        tokensOut: 0,
      },
      // Not verified until something has acted through it (REQ-REC-5); `bind()`
      // hands back a locator and the test does the acting.
      verified: false,
    };

    store.put(id, entry, phrase);
    this.dirty = true;
    return surface.locatorForCandidate(candidates[0]!);
  }

  private async viewport(): Promise<{ viewport?: [number, number] }> {
    const size = this.page.viewportSize();
    return size === null ? {} : { viewport: [size.width, size.height] };
  }

  /* ── heal (LLD §6.5, REQ-HEAL-6) ────────────────────────────────────────── */

  private async heal(
    id: string,
    phrase: string | undefined,
    failure: LocatorError,
    started: number,
  ): Promise<Locator> {
    const { surface, store } = await this.open();
    const entry = store.entryFor(id, { url: this.page.url(), platform: "web" });
    if (entry === undefined) throw failure;

    const result = await relocalize(surface, entry.fingerprint, {
      preferRole: entry.candidates.find((c) => c.by === "role")?.role ?? undefined,
    });

    if (result.outcome !== "relocalized") {
      this.record_({
        id,
        ...(phrase === undefined ? {} : { phrase }),
        mode: "heal",
        status: "failed",
        durationMs: Date.now() - started,
        message:
          result.outcome === "ambiguous"
            ? `relocalization found two elements it could not tell apart (margin ${result.margin.toFixed(3)})`
            : "relocalization found nothing above the threshold",
      });
      throw failure;
    }

    const candidates = await synthesise(surface, result.match.ref, {
      testIdAttributes: this.testIdAttributes,
    });
    if (candidates.length === 0) throw failure;

    // Verify the repair before using it: the retry is the verification
    // (REQ-HEAL-3). A proposal that does not itself resolve is not a repair.
    const refs = await surface.locate(candidates[0]!);
    if (refs.length !== 1) throw failure;

    const snapshot = await surface.snapshot();
    const { hash } = contextHash(snapshot, result.match.ref);
    const repaired: BindingEntry = {
      ...entry,
      context: { ...entry.context, hash },
      candidates,
      fingerprint: fingerprintOf(await surface.describe(result.match.ref)),
      verified: false,
      // Lineage, so a reviewer sees the repair and not only its result (LLD §6.4).
      previous: [
        ...(entry.previous ?? []),
        { fingerprint: entry.fingerprint, provenance: entry.provenance },
      ],
    };

    this.stageRepair(id, entry, repaired, result.match.score.total);

    this.record_({
      id,
      ...(phrase === undefined ? {} : { phrase }),
      mode: "heal",
      status: "healed",
      by: candidates[0]!.by,
      durationMs: Date.now() - started,
      message: `relocalized at ${result.match.score.total.toFixed(3)}`,
    });

    return surface.locatorForCandidate(candidates[0]!);
  }

  /* ── output ─────────────────────────────────────────────────────────────── */

  private record_(outcome: BindOutcome): void {
    this.outcomes.push(outcome);
    this.options.onOutcome?.(outcome);
  }

  private writeFailure(error: LocatorError): void {
    const path = join(this.outputDir, "bind-failures.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(error.toFailureLine())}\n`, "utf8");
  }

  /**
   * A healed binding is staged, not written into the store.
   *
   * "Repairs are a diff to the bindings store plus a report" (REQ-HEAL-2), and a
   * heal-on-fail run is marked `healed`, never `passed` (REQ-HEAL-4). Writing the
   * repair in place during a test run would turn a red build green with nobody
   * having looked at it.
   */
  private stageRepair(
    id: string,
    before: BindingEntry,
    after: BindingEntry,
    score: number,
  ): void {
    const path = join(this.outputDir, "heal-proposals.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(
      path,
      `${JSON.stringify({ id, at: new Date().toISOString(), score, before, after })}\n`,
      "utf8",
    );
  }

  /** Whether anything was recorded or a phrase added. */
  get hasChanges(): boolean {
    return this.dirty;
  }

  /** Write the store, if record mode changed it. Called at the end of a test. */
  async flush(): Promise<void> {
    if (this.dirty && this.store !== undefined) this.store.save();
    this.dirty = false;
  }

  async close(): Promise<void> {
    await this.flush();
    // The surface borrowed the test's page, so closing it must not close the
    // page: Playwright owns that, and the test may not be finished with it.
    this.surface = undefined;
    this.store = undefined;
  }
}
