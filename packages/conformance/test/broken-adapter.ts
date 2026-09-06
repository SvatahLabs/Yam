/**
 * A deliberately broken mock adapter (T1.2 Validate).
 *
 * "A deliberately broken mock adapter fails with a readable report." This is that
 * adapter: it implements `AgentSurface` completely enough to be registered and
 * driven, and gets a specific, named set of things wrong. Each fault is one an
 * adapter author could plausibly ship, so the report has to name it clearly.
 *
 * It uses no browser: the conformance suite is handed an `AgentSurface` and knows
 * nothing else, which is exactly what makes this possible.
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
  SurfaceAction,
  SurfaceKind,
} from "@svatah/yam-schema";
import type { AgentSurface } from "@svatah/yam-surface";
import { NO_CAPABILITIES, buildSnapshot } from "@svatah/yam-surface";

/** Which faults a broken adapter has. Each maps onto a check the suite makes. */
export interface Faults {
  /** Report no reference on snapshot nodes. */
  refsMissing?: boolean;
  /** Omit the states array's contents, so `required` and `unchecked` never appear. */
  statesMissing?: boolean;
  /** Render hidden nodes into `Snapshot.text`. */
  showsHidden?: boolean;
  /** `read("value")` returns what was typed one call late. */
  staleValue?: boolean;
  /** `locate` returns exactly one reference whatever the candidate. */
  alwaysOne?: boolean;
  /** `describe` omits the fingerprint fields. */
  thinDescribe?: boolean;
  /** Return `undefined` instead of throwing for a bad candidate. */
  swallowsErrors?: boolean;
  /** Claim every capability, including ones it has not implemented. */
  overclaims?: boolean;
}

interface FakeElement {
  ref: string;
  role: string;
  name?: string;
  value?: string;
  states: string[];
  hidden?: boolean;
  tag: string;
  attrs: Record<string, string>;
}

const LOGIN_PAGE: FakeElement[] = [
  { ref: "f1", role: "navigation", name: "Main", states: [], tag: "nav", attrs: {} },
  { ref: "f2", role: "link", name: "Sign in", states: [], tag: "a", attrs: { href: "/login" } },
  {
    ref: "f3",
    role: "heading",
    name: "Deterministic automation, once described",
    states: [],
    tag: "h1",
    attrs: {},
  },
  {
    ref: "f4",
    role: "textbox",
    name: "Username",
    value: "",
    states: ["required"],
    tag: "input",
    attrs: { id: "username", name: "username" },
  },
  {
    ref: "f5",
    role: "textbox",
    name: "Password",
    value: "",
    states: ["required"],
    tag: "input",
    attrs: { id: "password", name: "password" },
  },
  {
    ref: "f6",
    role: "checkbox",
    name: "Remember me",
    states: ["unchecked"],
    tag: "input",
    attrs: { id: "remember" },
  },
  { ref: "f7", role: "button", name: "Sign In", states: [], tag: "input", attrs: {} },
  {
    ref: "f8",
    role: "alert",
    name: "Invalid credentials",
    states: ["hidden"],
    tag: "div",
    attrs: {},
  },
];

export class BrokenAdapter implements AgentSurface {
  readonly kind: SurfaceKind = "web";
  private url = "about:blank";
  private readonly elements = LOGIN_PAGE.map((e) => ({ ...e }));
  private pendingValue: string | undefined;

  constructor(private readonly faults: Faults = {}) {}

  capabilities(): Capabilities {
    if (this.faults.overclaims === true) {
      return {
        dialogs: true,
        frames: true,
        windows: true,
        upload: true,
        drag: true,
        trace: true,
        webmcp: true,
        pick: false,
        screenshot: true,
        restore: true,
      };
    }
    return { ...NO_CAPABILITIES, restore: true };
  }

  async open(_session: SessionInit): Promise<void> {}
  async close(): Promise<void> {}

  async snapshot(): Promise<Snapshot> {
    const nodes = this.elements
      .filter((e) => this.faults.showsHidden === true || e.hidden !== true)
      .map((e, index) => ({
        ref: this.faults.refsMissing === true ? "" : e.ref,
        role: e.role,
        ...(e.name === undefined ? {} : { name: e.name }),
        ...(e.value === undefined || e.value === "" ? {} : { value: e.value }),
        states: (this.faults.statesMissing === true
          ? []
          : e.states) as Snapshot["nodes"][number]["states"],
        depth: index === 0 ? 0 : 1,
      }));
    return buildSnapshot("f1", nodes, "0".repeat(64), {
      omitHidden: this.faults.showsHidden !== true,
    });
  }

  async act(action: SurfaceAction, ref?: Ref, args: ActArgs = {}): Promise<ActResult> {
    switch (action) {
      case "navigate":
        this.url = String(args["url"] ?? "");
        return { ok: true, navigated: true };
      case "click": {
        const element = this.find(ref);
        if (element?.role === "link") this.url = element.attrs["href"] ?? this.url;
        return { ok: true, ...(ref === undefined ? {} : { ref }) };
      }
      case "type": {
        const element = this.find(ref);
        if (element !== undefined) {
          if (this.faults.staleValue === true) {
            element.value = this.pendingValue ?? "";
            this.pendingValue = String(args["value"] ?? "");
          } else {
            element.value = String(args["value"] ?? "");
          }
        }
        return { ok: true, ...(ref === undefined ? {} : { ref }) };
      }
      case "clear": {
        const element = this.find(ref);
        if (element !== undefined) element.value = "";
        return { ok: true, ...(ref === undefined ? {} : { ref }) };
      }
      case "setChecked": {
        const element = this.find(ref);
        if (element !== undefined) {
          element.states = [args["checked"] === false ? "unchecked" : "checked"];
        }
        return { ok: true, ...(ref === undefined ? {} : { ref }) };
      }
      default:
        return { ok: true, ...(ref === undefined ? {} : { ref }) };
    }
  }

  async read(kind: ReadKind, ref?: Ref): Promise<unknown> {
    if (kind === "url") return this.url;
    if (kind === "title") return "Broken · Yam Sample";
    const element = this.find(ref);
    if (kind === "value") return element?.value ?? "";
    if (kind === "text") return element?.name ?? "";
    return null;
  }

  async check(predicate: Predicate, _subject: CheckSubject, ref?: Ref): Promise<CheckResult> {
    const element = this.find(ref);
    if (predicate.kind === "checked") return { ok: element?.states.includes("checked") === true };
    if (predicate.kind === "unchecked") return { ok: element?.states.includes("unchecked") === true };
    if (predicate.kind === "multiSelect") return { ok: false };
    if (predicate.kind === "value") {
      const expected = predicate.value.kind === "literal" ? predicate.value.value : "";
      return { ok: (element?.value ?? "") === expected, actual: element?.value, expected };
    }
    if (predicate.kind === "present") return { ok: element !== undefined };
    if (predicate.kind === "absent") return { ok: element === undefined };
    return { ok: false, message: `The broken adapter does not answer "${predicate.kind}".` };
  }

  async locate(candidate: Candidate): Promise<Ref[]> {
    if (candidate.value === undefined && candidate.role === undefined) {
      if (this.faults.swallowsErrors === true) return [];
      throw new Error(`A "${candidate.by}" candidate must carry a value.`);
    }
    if (this.faults.alwaysOne === true) return ["f4"];

    const matches = this.elements.filter((e) => {
      switch (candidate.by) {
        case "role":
          return e.role === candidate.role && (candidate.name === undefined || e.name === candidate.name);
        case "label":
          return e.name === candidate.value;
        case "id":
          return e.attrs["id"] === candidate.value;
        case "css":
          return candidate.value === "h1" ? e.tag === "h1" : false;
        default:
          return false;
      }
    });
    return matches.map((e) => e.ref);
  }

  async describe(ref: Ref): Promise<ElementDescription> {
    const element = this.find(ref);
    if (element === undefined) throw new Error(`Unknown reference "${ref}".`);
    if (this.faults.thinDescribe === true) {
      return {
        ref,
        role: element.role,
        tag: element.tag,
        attrs: {},
        text: "",
        neighbours: { before: [], after: [] },
        rolePath: [],
        box: [0, 0, 0, 0],
        index: 0,
        states: [],
      };
    }
    return {
      ref,
      role: element.role,
      ...(element.name === undefined ? {} : { name: element.name }),
      tag: element.tag,
      attrs: element.attrs,
      text: element.name ?? "",
      neighbours: { before: ["Sign in to your account"], after: ["Remember me"] },
      rolePath: ["main", "form"],
      box: [10, 20, 200, 32],
      index: 0,
      states: element.states as ElementDescription["states"],
    };
  }

  async screenshot(): Promise<void> {}

  async state(): Promise<SessionState> {
    return { kind: "web", url: this.url, windowIndex: 0, dialog: null };
  }

  async restore(state: SessionState): Promise<void> {
    if (state.url !== undefined) this.url = state.url;
  }

  private find(ref: Ref | undefined): FakeElement | undefined {
    return ref === undefined ? undefined : this.elements.find((e) => e.ref === ref);
  }
}

/** Every fault, so one run shows every kind of failure the report has to render. */
export const ALL_FAULTS: Faults = {
  refsMissing: true,
  statesMissing: true,
  showsHidden: true,
  staleValue: true,
  alwaysOne: true,
  thinDescribe: true,
  swallowsErrors: true,
  overclaims: true,
};
