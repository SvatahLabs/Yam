/**
 * A stub surface for the resolver matrix (T1.3 Validate).
 *
 * The resolver's contract is about cardinality and ordering, not about a browser:
 * a candidate matches nothing, one thing, or several; a timeout is a candidate
 * that never answers; `nth` disambiguates a legitimate multi-match. Driving that
 * from a real page would make the interesting cases hard to arrange and slow to
 * run, so the stub answers `locate` from a table the test writes.
 *
 * That the stub is possible at all is the resolver's independence: it knows
 * `AgentSurface` and nothing else.
 */
import type {
  ActResult,
  Candidate,
  Capabilities,
  CheckResult,
  ElementDescription,
  Ref,
  SessionState,
  Snapshot,
  SurfaceKind,
} from "@svatah/yam-schema";
import type { AgentSurface } from "@svatah/yam-surface";
import { NO_CAPABILITIES, buildSnapshot } from "@svatah/yam-surface";

/** How the stub should answer one candidate. */
export type Answer =
  | { kind: "refs"; refs: Ref[] }
  /** Never resolves, so the per-candidate timeout is what ends it. */
  | { kind: "hang" }
  | { kind: "throw"; message: string };

export interface StubOptions {
  /** Candidate key (`by:value` or `by:role/name`) → what `locate` answers. */
  answers?: Record<string, Answer>;
  /** The default answer for a candidate with no entry. */
  fallback?: Answer;
  capabilities?: Partial<Capabilities>;
  url?: string;
  kind?: SurfaceKind;
  snapshot?: Snapshot;
  /** What `describe` reports, by reference. Synthesis reads this. */
  descriptions?: Record<Ref, ElementDescription>;
  /** What `describe` reports for a reference with no entry. */
  defaultDescription?: (ref: Ref) => ElementDescription;
}

/** The key a candidate is looked up by, so a test can write a readable table. */
export function candidateKey(candidate: Candidate): string {
  if (candidate.by === "role") {
    return `role:${candidate.role ?? ""}${candidate.name === undefined ? "" : `/${candidate.name}`}`;
  }
  if (candidate.by === "webmcp") return `webmcp:${candidate.tool ?? ""}`;
  return `${candidate.by}:${candidate.value ?? ""}`;
}

export class StubSurface implements AgentSurface {
  readonly kind: SurfaceKind;
  /** Every candidate `locate` was asked about, in order. */
  readonly located: Candidate[] = [];

  constructor(private readonly options: StubOptions = {}) {
    this.kind = options.kind ?? "web";
  }

  capabilities(): Capabilities {
    return { ...NO_CAPABILITIES, ...(this.options.capabilities ?? {}) };
  }

  async open(): Promise<void> {}
  async close(): Promise<void> {}

  async snapshot(): Promise<Snapshot> {
    return this.options.snapshot ?? buildSnapshot("r0", [], "0".repeat(64));
  }

  async act(): Promise<ActResult> {
    return { ok: true };
  }

  async read(): Promise<unknown> {
    return null;
  }

  async check(): Promise<CheckResult> {
    return { ok: true };
  }

  async locate(candidate: Candidate): Promise<Ref[]> {
    this.located.push(candidate);
    const answer =
      this.options.answers?.[candidateKey(candidate)] ??
      this.options.fallback ?? { kind: "refs", refs: [] };

    if (answer.kind === "hang") return await new Promise<Ref[]>(() => {});
    if (answer.kind === "throw") throw new Error(answer.message);
    return answer.refs;
  }

  async describe(ref: Ref): Promise<ElementDescription> {
    const configured = this.options.descriptions?.[ref];
    if (configured !== undefined) return { ...configured, ref };
    if (this.options.defaultDescription !== undefined) {
      return { ...this.options.defaultDescription(ref), ref };
    }
    return {
      ref,
      role: "textbox",
      tag: "input",
      attrs: {},
      text: "",
      neighbours: { before: [], after: [] },
      rolePath: [],
      box: [0, 0, 0, 0],
      index: 0,
      states: [],
    };
  }

  async screenshot(): Promise<void> {}

  async state(): Promise<SessionState> {
    return { kind: "web", url: this.options.url ?? "http://127.0.0.1:4173/login" };
  }

  async restore(): Promise<void> {}
}
