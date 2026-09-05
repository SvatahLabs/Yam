/**
 * A mock adapter (T0.4 Validate). It implements every `AgentSurface` method over an
 * in-memory node list, so the registry and error-type tests exercise the contract
 * without a browser — and so a later phase has a broken-adapter baseline for the
 * conformance suite's negative case (T1.2).
 */
import type {
  ActArgs,
  ActResult,
  Candidate,
  Capabilities,
  CheckResult,
  CheckSubject,
  ElementDescription,
  Predicate,
  ReadKind,
  Ref,
  SessionInit,
  SessionState,
  Snapshot,
  SnapshotNode,
  SurfaceAction,
  SurfaceKind,
} from "@svatah/schema";
import {
  buildSnapshot,
  CheckError,
  LocateError,
  NavigationError,
  NO_CAPABILITIES,
  ScriptError,
  SessionError,
  type AgentSurface,
} from "../src/index.js";

export interface MockNode extends SnapshotNode {
  /** Candidate values this node answers to, e.g. `{ testid: "username" }`. */
  matches?: Record<string, string>;
}

export const MOCK_NODES: MockNode[] = [
  { ref: "r1", role: "document", states: [], depth: 0 },
  {
    ref: "r2",
    role: "textbox",
    name: "Username",
    value: "",
    states: ["required"],
    depth: 1,
    parent: "r1",
    box: [40, 120, 240, 32],
    native: { "data-testid": "username" },
    matches: { testid: "username", label: "Username" },
  },
  {
    ref: "r3",
    role: "button",
    name: "Sign in",
    states: [],
    depth: 1,
    parent: "r1",
    box: [40, 180, 100, 36],
    matches: { testid: "sign-in", role: "button" },
  },
  {
    ref: "r4",
    role: "alert",
    name: "Invalid credentials",
    states: ["hidden"],
    depth: 1,
    parent: "r1",
    matches: { testid: "error" },
  },
];

export class MockAdapter implements AgentSurface {
  readonly kind: SurfaceKind = "web";

  /** Every call, in order — the tests assert on this instead of on side effects. */
  readonly calls: Array<{ method: string; args: unknown[] }> = [];

  private opened = false;
  private url = "about:blank";
  private nodes: MockNode[];

  constructor(
    private readonly caps: Capabilities = { ...NO_CAPABILITIES, screenshot: true, restore: true },
    nodes: MockNode[] = MOCK_NODES,
  ) {
    this.nodes = nodes.map((n) => ({ ...n }));
  }

  private record(method: string, ...args: unknown[]): void {
    this.calls.push({ method, args });
  }

  private requireOpen(): void {
    if (!this.opened) throw new SessionError("MockAdapter: session is not open.", { adapter: "mock" });
  }

  private node(ref: Ref): MockNode {
    const found = this.nodes.find((n) => n.ref === ref);
    if (found === undefined) {
      throw new LocateError(`MockAdapter: no element with reference "${ref}".`, {
        adapter: "mock",
        matchCount: 0,
      });
    }
    return found;
  }

  capabilities(): Capabilities {
    this.record("capabilities");
    return { ...this.caps };
  }

  async open(session: SessionInit): Promise<void> {
    this.record("open", session);
    this.opened = true;
    this.url = session.baseUrl ?? "about:blank";
  }

  async close(): Promise<void> {
    this.record("close");
    this.opened = false;
  }

  async snapshot(opts?: {
    root?: Ref;
    maxNodes?: number;
    interactiveOnly?: boolean;
  }): Promise<Snapshot> {
    this.record("snapshot", opts);
    this.requireOpen();
    let nodes: MockNode[] = this.nodes;
    if (opts?.interactiveOnly === true) {
      nodes = nodes.filter((n) => n.role !== "document" && n.role !== "text");
    }
    if (opts?.maxNodes !== undefined) nodes = nodes.slice(0, opts.maxNodes);
    // `matches` is the mock's own bookkeeping and must not leak into the wire shape.
    const clean: SnapshotNode[] = nodes.map(({ matches: _matches, ...node }) => node);
    return buildSnapshot(opts?.root ?? "r1", clean, "mock-context-hash");
  }

  async act(action: SurfaceAction, ref?: Ref, args?: ActArgs, ref2?: Ref): Promise<ActResult> {
    this.record("act", action, ref, args, ref2);
    this.requireOpen();

    if (action === "navigate") {
      const to = args?.["url"];
      if (typeof to !== "string" || to === "") {
        throw new NavigationError("MockAdapter: navigate needs a url argument.", { adapter: "mock" });
      }
      this.url = to;
      return { ok: true, navigated: true };
    }
    if (action === "evaluate") {
      throw new ScriptError("MockAdapter: evaluate is not implemented.", { adapter: "mock" });
    }

    const node = ref === undefined ? undefined : this.node(ref);
    if (node !== undefined && action === "type") {
      node.value = String(args?.["value"] ?? "");
    }
    return { ok: true, ...(ref === undefined ? {} : { ref }) };
  }

  async read(kind: ReadKind, ref?: Ref, name?: string): Promise<unknown> {
    this.record("read", kind, ref, name);
    this.requireOpen();
    if (kind === "url") return this.url;
    if (kind === "title") return "Mock";
    const node = this.node(ref ?? "");
    if (kind === "text") return node.name ?? "";
    if (kind === "value") return node.value ?? "";
    if (kind === "attribute") return node.native?.[name ?? ""] ?? null;
    return null;
  }

  async check(predicate: Predicate, subject: CheckSubject, ref?: Ref): Promise<CheckResult> {
    this.record("check", predicate, subject, ref);
    this.requireOpen();

    if (subject === "page") {
      if (predicate.kind === "url") {
        const expected =
          "value" in predicate && predicate.value.kind === "literal" ? predicate.value.value : "";
        return { ok: this.url === expected, actual: this.url, expected };
      }
      throw new CheckError(`MockAdapter: page predicate "${predicate.kind}" is not implemented.`, {
        adapter: "mock",
      });
    }
    if (subject === "dialog") {
      throw new CheckError("MockAdapter: there is no dialog.", { adapter: "mock" });
    }

    const node = this.node(ref ?? "");
    if (predicate.kind === "visible") return { ok: !node.states.includes("hidden") };
    if (predicate.kind === "hidden") return { ok: node.states.includes("hidden") };
    throw new CheckError(`MockAdapter: predicate "${predicate.kind}" is not implemented.`, {
      adapter: "mock",
    });
  }

  async locate(candidate: Candidate): Promise<Ref[]> {
    this.record("locate", candidate);
    this.requireOpen();
    const wanted = candidate.value ?? candidate.name ?? candidate.role ?? "";
    return this.nodes.filter((n) => n.matches?.[candidate.by] === wanted).map((n) => n.ref);
  }

  async describe(ref: Ref): Promise<ElementDescription> {
    this.record("describe", ref);
    this.requireOpen();
    const node = this.node(ref);
    const index = this.nodes.filter((n) => n.role === node.role).indexOf(node);
    return {
      ref: node.ref,
      role: node.role,
      ...(node.name === undefined ? {} : { name: node.name }),
      ...(node.value === undefined ? {} : { value: node.value }),
      tag: node.role,
      attrs: node.native ?? {},
      text: node.name ?? "",
      neighbours: { before: [], after: [] },
      rolePath: [node.role],
      box: node.box ?? [0, 0, 0, 0],
      index,
      states: node.states,
      ...(node.native === undefined ? {} : { native: node.native }),
    };
  }

  async screenshot(path: string, mask?: Ref[]): Promise<void> {
    this.record("screenshot", path, mask);
    this.requireOpen();
  }

  async state(): Promise<SessionState> {
    this.record("state");
    this.requireOpen();
    return { kind: "web", url: this.url, windowIndex: 0, dialog: null };
  }

  async restore(state: SessionState): Promise<void> {
    this.record("restore", state);
    this.requireOpen();
    this.url = state.url ?? this.url;
  }
}

/** An adapter that fails to open — the negative case for the registry tests. */
export class BrokenAdapter extends MockAdapter {
  override async open(): Promise<void> {
    throw new SessionError("BrokenAdapter: cannot open a session.", { adapter: "broken" });
  }
}
