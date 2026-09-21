/**
 * A surface that replays a recorded page (T3.2's Validate).
 *
 * `scripts/record-snapshots.mjs` drives the real Playwright adapter over
 * `apps/sample-web` and writes what it saw: the snapshot, `describe(ref)` for
 * every reference, and `locate(candidate)` for every candidate synthesis would
 * propose. This answers from that file.
 *
 * It is a replay, not a simulation. Candidate uniqueness — whether
 * `role=button name="Sign In"` matches one element or three — is a property of
 * the real page, and a stub that decided it by rule would be testing the rule.
 * Everything here is a lookup; a question the recording does not answer throws,
 * so a test can never pass on an invented answer.
 *
 * `recorder` may not import an adapter (LLD §1), which is the other reason this
 * exists: the decisions grounding makes are about a snapshot, and they are
 * tested where the code lives. The live path is covered in `packages/cli`.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalJson, type Candidate, type ElementDescription, type Ref, type SessionState, type Snapshot } from "@svatah/yam-schema";
import type { AgentSurface, Capabilities } from "@svatah/yam-surface";

interface RecordedPage {
  url: string;
  snapshot: Snapshot;
  describe: Record<string, ElementDescription>;
  locate: Record<string, Ref[]>;
}

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "pages.json");

export const PAGES: Readonly<Record<string, RecordedPage>> = JSON.parse(
  readFileSync(FIXTURE, "utf8"),
) as Record<string, RecordedPage>;

export function recordedPage(path: string): RecordedPage {
  const page = PAGES[path];
  if (page === undefined) {
    throw new Error(
      `No recording of ${path}. Pages: ${Object.keys(PAGES).join(", ")}. ` +
        "Re-run `node scripts/record-snapshots.mjs` after adding one.",
    );
  }
  return page;
}

const CAPABILITIES: Capabilities = {
  dialogs: true,
  frames: true,
  windows: true,
  upload: true,
  drag: true,
  trace: false,
  webmcp: false,
  pick: false,
  observe: false,
  screenshot: true,
  restore: true,
  // The recorded pages are a web surface replayed; it has no window frame.
  windowChrome: false,
};

export interface RecordedSurfaceOptions {
  /** Turn off screenshots, to exercise the vision fallback's capability check. */
  readonly screenshot?: boolean;
  /** `desktop` replays the same page as a window with a title (T11.3). */
  readonly kind?: "web" | "desktop";
  /** The window title a desktop session reports; default "Yam". */
  readonly windowTitle?: string;
  /** Called instead of writing a file. */
  readonly onScreenshot?: (path: string) => void;
}

/** Everything the recorded surface was asked, for tests that check the order. */
export interface SurfaceCalls {
  snapshots: number;
  describes: Ref[];
  locates: Candidate[];
  screenshots: string[];
}

export class RecordedSurface implements AgentSurface {
  /**
   * `desktop` for the T11.3 cases, which are about the one thing the recorder
   * does differently there: a window title where a page has a URL (LLD §3.3).
   * Everything else about a recorded page replays the same either way, which is
   * the point — the recorder has one grounding path, not two.
   */
  readonly kind: "web" | "desktop";
  readonly calls: SurfaceCalls = { snapshots: 0, describes: [], locates: [], screenshots: [] };

  constructor(
    private readonly page: RecordedPage,
    private readonly options: RecordedSurfaceOptions = {},
  ) {
    this.kind = options.kind ?? "web";
  }

  capabilities(): Capabilities {
    return { ...CAPABILITIES, screenshot: this.options.screenshot ?? true };
  }

  async open(): Promise<void> {}
  async close(): Promise<void> {}

  async snapshot(): Promise<Snapshot> {
    this.calls.snapshots += 1;
    return structuredClone(this.page.snapshot);
  }

  async describe(ref: Ref): Promise<ElementDescription> {
    this.calls.describes.push(ref);
    const described = this.page.describe[ref];
    if (described === undefined) {
      throw new Error(`The recording of ${this.page.url} has no element ${ref}.`);
    }
    return structuredClone(described);
  }

  async locate(candidate: Candidate): Promise<Ref[]> {
    this.calls.locates.push(candidate);
    const key = canonicalJson(candidate);
    const refs = this.page.locate[key];
    if (refs === undefined) {
      throw new Error(
        `The recording of ${this.page.url} did not try ${key}. ` +
          "Re-run `node scripts/record-snapshots.mjs` rather than guessing an answer.",
      );
    }
    return [...refs];
  }

  async state(): Promise<SessionState> {
    // A desktop session says which *window* it is in; a web one, which page.
    return this.kind === "desktop"
      ? { kind: "desktop", windowTitle: this.options.windowTitle ?? "Yam", windowIndex: 0 }
      : { kind: "web", url: `http://sample.test${this.page.url}` };
  }

  async restore(): Promise<void> {}

  async screenshot(path: string): Promise<void> {
    this.calls.screenshots.push(path);
    this.options.onScreenshot?.(path);
  }

  /* Not reached by grounding; present because the interface has them. */
  async act(): Promise<never> {
    throw new Error("The recorded surface does not act; grounding never does.");
  }
  async read(): Promise<never> {
    throw new Error("The recorded surface does not read.");
  }
  async check(): Promise<never> {
    throw new Error("The recorded surface does not check.");
  }
}
