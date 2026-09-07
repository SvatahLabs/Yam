/**
 * The AT-SPI tree, driven on a machine with no accessibility bus
 * (T23, SF-23, SF-10).
 *
 * This is what *is* validated about this adapter, and the record says exactly
 * that: the role table, the reference scope, the state inversion, the action
 * selection and every refusal are pure functions of an `AtspiNode[]`, and every
 * one of them is driven here against recorded answers. What is **not** validated
 * is `bridge.ts`'s conversation with a real registry — no Linux runner is
 * provisioned for this repository — and the support matrix says so with what
 * would have to be true beside it.
 *
 * The recorded trees below are the shape `Accessible.getRoleName()`,
 * `getState()` and `getAttributes()` produce: lower-case role phrases,
 * lower-case state names, and `accessible-id` among the object attributes.
 */
import { describe, expect, it } from "vitest";
import { normaliseRole } from "@svatah/yam-surface";
import {
  AtspiSurface,
  actionFor,
  buildNodes,
  nameOf,
  parseTree,
  roleOf,
  statesOf,
  AtspiBridgeError,
  type AtspiBridge,
  type AtspiNode,
} from "../src/index.js";

const node = (parts: Partial<AtspiNode> & { role: string }): AtspiNode => ({
  parent: -1,
  states: ["enabled", "showing", "visible"],
  ...parts,
});

/** A window as a GTK application publishes one. */
const WINDOW: AtspiNode[] = [
  node({ parent: -1, role: "frame", name: "Yam" }),
  node({ parent: 0, role: "tool bar", name: "Actions" }),
  node({
    parent: 1,
    role: "push button",
    name: "Save flow",
    automationId: "action-flows-save",
    actions: ["click"],
    box: [12, 8, 90, 24],
  }),
  node({
    parent: 1,
    role: "toggle button",
    name: "Surfaces",
    automationId: "rail-surfaces",
    states: ["enabled", "showing", "visible", "checkable", "checked"],
    actions: ["click"],
  }),
  node({
    parent: 0,
    role: "entry",
    name: "URL",
    automationId: "surfaces-url",
    text: "http://127.0.0.1:4173",
    states: ["enabled", "showing", "visible", "focused"],
    actions: ["activate"],
  }),
  node({
    parent: 0,
    role: "push button",
    name: "Disabled thing",
    states: ["showing", "visible"],
    actions: ["click"],
  }),
  node({ parent: 0, role: "label", name: "Not a control" }),
];

describe("the role table lands on the same vocabulary as the other platforms (SF-23)", () => {
  it("maps AT-SPI's phrases onto ARIA roles", () => {
    expect(roleOf(node({ role: "push button" }))).toBe("button");
    expect(roleOf(node({ role: "page tab" }))).toBe("tab");
    expect(roleOf(node({ role: "entry" }))).toBe("textbox");
    expect(roleOf(node({ role: "check box" }))).toBe("checkbox");
    expect(roleOf(node({ role: "frame" }))).toBe("window");
  });

  it("accepts the enumeration spelling a toolkit may pass through", () => {
    expect(roleOf(node({ role: "PUSH_BUTTON" })), "`PUSH_BUTTON` is `push button`").toBe("button");
    expect(roleOf(node({ role: "page-tab-list" }))).toBe("tablist");
  });

  it("falls back rather than inventing, for a role no table has", () => {
    expect(roleOf(node({ role: "something nobody has heard of" }))).toBe("generic");
  });

  /*
   * The claim the mapping exists to make: a binding written once resolves on
   * three platforms because all three tables land on the same word.
   */
  it("agrees with the macOS and Windows tables about what a button is", () => {
    expect(normaliseRole("atspi", "push button")).toBe("button");
    expect(normaliseRole("ax", "AXButton")).toBe("button");
    expect(normaliseRole("uia", "Button")).toBe("button");
  });
});

describe("states, which AT-SPI says the other way round", () => {
  /*
   * AT-SPI publishes what *is* — there is an `enabled` state and no `disabled`
   * one — and the snapshot vocabulary publishes what a caller asks about. The
   * inversion is where a wrong answer would be silent, so it is driven both
   * ways.
   */
  it("reports disabled from the absence of enabled", () => {
    expect(statesOf(node({ role: "push button", states: ["showing"] }))).toContain("disabled");
    expect(statesOf(node({ role: "push button", states: ["enabled", "showing"] }))).not.toContain(
      "disabled",
    );
  });

  it("reports hidden from the absence of showing", () => {
    expect(statesOf(node({ role: "label", states: ["enabled"] }))).toContain("hidden");
  });

  it("reports unchecked for a checkable thing that is not checked", () => {
    expect(
      statesOf(node({ role: "check box", states: ["enabled", "showing", "checkable"] })),
    ).toContain("unchecked");
    expect(
      statesOf(node({ role: "check box", states: ["enabled", "showing", "checkable", "checked"] })),
    ).toContain("checked");
  });

  it("carries focused and selected through", () => {
    const states = statesOf(
      node({ role: "list item", states: ["enabled", "showing", "focused", "selected"] }),
    );
    expect(states).toContain("focused");
    expect(states).toContain("selected");
  });

  it("calls a defunct element disabled, because it is gone", () => {
    expect(statesOf(node({ role: "push button", states: ["enabled", "defunct"] }))).toContain(
      "disabled",
    );
  });
});

describe("what an element is called", () => {
  it("prefers the name, then the description, then its text", () => {
    expect(nameOf(node({ role: "push button", name: "Save" }))).toBe("Save");
    expect(nameOf(node({ role: "push button", description: "Save the flow" }))).toBe(
      "Save the flow",
    );
    expect(nameOf(node({ role: "entry", text: "typed in" }))).toBe("typed in");
    expect(nameOf(node({ role: "filler" }))).toBe("");
  });

  it("collapses the whitespace a toolkit puts in a label", () => {
    expect(nameOf(node({ role: "label", name: "  two   words \n" }))).toBe("two words");
  });
});

describe("references are scoped to the snapshot that issued them (SF-10)", () => {
  it("gives every node a reference carrying its generation", () => {
    const first = buildNodes(WINDOW, 1);
    const second = buildNodes(WINDOW, 2);
    expect(first[0]!.node.ref).toBe("a1_0");
    expect(second[0]!.node.ref).toBe("a2_0");
    expect(
      new Set([...first, ...second].map((one) => one.node.ref)).size,
      "no reference from one snapshot can name a node of another",
    ).toBe(first.length + second.length);
  });

  it("carries the automation id, which is what a binding matches on", () => {
    const built = buildNodes(WINDOW, 1);
    const save = built.find((one) => one.node.name === "Save flow");
    expect(save?.node.native?.["automationId"]).toBe("action-flows-save");
  });

  it("computes the depth from the parent, so a tree reads as a tree", () => {
    const built = buildNodes(WINDOW, 1);
    expect(built.map((one) => one.node.depth)).toEqual([0, 1, 2, 2, 1, 1, 1]);
  });

  it("gives each node the index path a command addresses it by", () => {
    const built = buildNodes(WINDOW, 1);
    expect(built.find((one) => one.node.name === "Save flow")?.path).toEqual([0, 0]);
    expect(built.find((one) => one.node.name === "URL")?.path).toEqual([1]);
  });

  it("keeps only the controls when asked for controls only", () => {
    const built = buildNodes(WINDOW, 1, { interactiveOnly: true });
    const names = built.map((one) => one.node.name);
    expect(names).toContain("Save flow");
    expect(names, "a label is not a control").not.toContain("Not a control");
  });

  it("stops at the bound it was given", () => {
    expect(buildNodes(WINDOW, 1, { maxNodes: 3 })).toHaveLength(3);
  });
});

describe("which AT-SPI action performs a gesture", () => {
  /*
   * AT-SPI names actions per toolkit. Picking the first the element declares
   * from a preference list — rather than whatever happens to be first — is what
   * makes `click` work on a GTK button and on a Qt one.
   */
  it("prefers click, and accepts press where a toolkit spells it that way", () => {
    expect(actionFor("click", node({ role: "push button", actions: ["click"] }))).toBe("click");
    expect(actionFor("click", node({ role: "push button", actions: ["press"] }))).toBe("press");
    expect(actionFor("click", node({ role: "link", actions: ["jump", "click"] }))).toBe("click");
  });

  it("answers nothing when the element declares none of them, so the refusal can name it", () => {
    expect(actionFor("click", node({ role: "label", actions: [] }))).toBeUndefined();
  });
});

describe("what the walker said, read", () => {
  it("turns a tree into nodes", () => {
    const window = parseTree(JSON.stringify({ title: "Yam", nodes: WINDOW, truncated: false }));
    expect(window.title).toBe("Yam");
    expect(window.nodes).toHaveLength(WINDOW.length);
  });

  it("turns `no-window` into a sentence about the application", () => {
    expect(() => parseTree(JSON.stringify({ error: "no-window" }))).toThrow(
      /publishes no window on the accessibility bus/u,
    );
  });

  it("says so when the binding is missing, in the host's own words", () => {
    expect(() => parseTree(JSON.stringify({ error: "pyatspi is not installed: no module" }))).toThrow(
      /pyatspi is not installed/u,
    );
  });

  it("refuses an answer that is not a tree rather than pretending it is empty", () => {
    expect(() => parseTree("Traceback (most recent call last):")).toThrow(/is not a tree/u);
    expect(() => parseTree(JSON.stringify({ title: "x" }))).toThrow(/no nodes/u);
  });
});

/** A bridge that answers from a recorded tree, so the surface can be driven. */
function recorded(nodes: AtspiNode[] = WINDOW): AtspiBridge {
  const performed: unknown[] = [];
  return {
    async availability() {
      return { available: true, busAddress: "unix:abstract=/tmp/at-spi" };
    },
    async window() {
      return { nodes, title: "Yam", truncated: false };
    },
    async perform(command) {
      performed.push(command);
    },
    performed,
  } as AtspiBridge & { performed: unknown[] };
}

describe("the surface, over a recorded bus (SF-23)", () => {
  const surface = async (nodes: AtspiNode[] = WINDOW): Promise<AtspiSurface> => {
    const one = new AtspiSurface({ bridge: recorded(nodes) });
    await one.open({ processName: "Yam" });
    return one;
  };

  it("answers a snapshot of the window", async () => {
    const one = await surface();
    const snapshot = await one.snapshot();
    expect(snapshot.nodes[0]?.role).toBe("window");
    expect(snapshot.nodes.map((n) => n.name)).toContain("Save flow");
  });

  it("locates by the automation id a binding was recorded with", async () => {
    const one = await surface();
    await one.snapshot();
    expect(await one.locate({ by: "automationId", value: "action-flows-save" } as never)).toHaveLength(
      1,
    );
    expect(await one.locate({ by: "automationId", value: "nothing-like-this" } as never)).toEqual([]);
  });

  it("refuses a candidate it cannot answer, naming what it can", async () => {
    const one = await surface();
    await one.snapshot();
    await expect(one.locate({ by: "css", value: "#x" } as never)).rejects.toThrow(
      /cannot be located by "css"/u,
    );
  });

  it("refuses a reference from an earlier snapshot (SF-10)", async () => {
    const one = await surface();
    const first = await one.snapshot();
    const stale = first.nodes[2]!.ref;
    await one.snapshot();
    await expect(one.act("click", stale)).rejects.toThrow(/not an element of the current snapshot/u);
  });

  it("refuses a gesture the element declares no action for, and says what it offers", async () => {
    const one = await surface();
    const snapshot = await one.snapshot();
    const label = snapshot.nodes.find((n) => n.name === "Not a control")!;
    await expect(one.act("click", label.ref)).rejects.toThrow(/declares no action for click/u);
  });

  it("refuses a web action, as a desktop adapter always has (REQ-SURF-5)", async () => {
    const one = await surface();
    await one.snapshot();
    await expect(one.act("navigate", undefined, { url: "http://x" })).rejects.toThrow(
      /has no "navigate"/u,
    );
  });

  it("answers a predicate about a control's state", async () => {
    const one = await surface();
    const snapshot = await one.snapshot();
    const disabled = snapshot.nodes.find((n) => n.name === "Disabled thing")!;
    expect(await one.check({ kind: "disabled" } as never, "ref", disabled.ref)).toMatchObject({
      ok: true,
    });
    const save = snapshot.nodes.find((n) => n.name === "Save flow")!;
    expect(await one.check({ kind: "enabled" } as never, "ref", save.ref)).toMatchObject({ ok: true });
  });

  it("takes no screenshot, and says why rather than writing an empty file", async () => {
    const one = await surface();
    expect(one.capabilities().screenshot).toBe(false);
    await expect(one.screenshot()).rejects.toThrow(/compositor question/u);
  });

  it("refuses to open when the bus does not answer, in the bus's own words", async () => {
    const bridge: AtspiBridge = {
      async availability() {
        return { available: false, reason: "`org.a11y.Bus` did not answer on the session bus." };
      },
      async window() {
        throw new AtspiBridgeError("never reached");
      },
      async perform() {
        throw new AtspiBridgeError("never reached");
      },
    };
    const one = new AtspiSurface({ bridge });
    await expect(one.open({ processName: "Yam" })).rejects.toThrow(/org.a11y.Bus/u);
  });

  it("needs an application to drive, and says how to name one", async () => {
    const one = new AtspiSurface({ bridge: recorded() });
    await expect(one.open({})).rejects.toThrow(/--app <application>/u);
  });
});
