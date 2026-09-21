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
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ActionabilityError,
  DataError,
  LocateError,
  TimeoutError,
  UnsupportedError,
  normaliseRole,
} from "@svatah/yam-surface";
import {
  AtspiSurface,
  WALK_SCRIPT,
  actionFor,
  buildNodes,
  nameOf,
  parseTree,
  roleOf,
  statesOf,
  valueOf,
  AtspiBridgeError,
  type AtspiBridge,
  type AtspiCommand,
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

  /*
   * The row the Linux gate could not read (SF-23).
   *
   * `getText` on a container answers one U+FFFC per embedded child and nothing
   * the children say, so a two-cell row answered `"￼￼"` — and because both
   * `nameOf` and `valueOf` fall through to the text, the row arrived with that
   * as its name *and* as its value. `app.result` read every row of the flow
   * list as `"￼￼ ￼￼"` and could not find a file name that was on the screen.
   */
  it("says nothing for a row whose text is only embedded-object markers", () => {
    const row = node({ role: "table row", text: "￼￼" });
    expect(nameOf(row)).toBe("");
    expect(valueOf(row)).toBe("");
  });

  it("keeps the words either side of an embedded child", () => {
    const cell = node({ role: "table cell", text: "Flow ￼ guards-and-compensation.flow" });
    expect(nameOf(cell)).toBe("Flow guards-and-compensation.flow");
    expect(valueOf(cell)).toBe("Flow guards-and-compensation.flow");
  });
});

/*
 * A row's cells, which nothing could ask for (T12.3, SF-23).
 *
 * `SnapshotNode.parent` is how a caller asks what is *inside* an element: the
 * desktop conformance suite reads a table row by walking to its cells, and the
 * resolver reads neighbours the same way. `ax` and `uia` have published it
 * since T12.3; this adapter never did, so every such question answered
 * "nothing" and the Linux gate read each row of the flow list as empty — having
 * found the row and none of the cells inside it.
 */
/*
 * `describe()` carries the application's own id where callers read it
 * (T12.3, SF-23).
 *
 * `ax` and `uia` spread their node's `native` bag into the description, and the
 * desktop healing cases read `describe(ref).native.automationId` to check that
 * a relocalization landed on the element that was recorded rather than on one
 * that merely scored well. This adapter put the id in `attrs` alone, so that
 * comparison was against `undefined`: both Linux healing cases relocalized
 * correctly and then failed their last check.
 */
describe("what describe() says about an element", () => {
  it("carries automationId in native, where every caller reads it", async () => {
    const surface = await openOn(changingBus([...WINDOW]).bridge);
    const snapshot = await surface.snapshot();
    const save = snapshot.nodes.find((one) => one.name === "Save flow")!;
    const described = await surface.describe(save.ref);
    expect(described.native?.["automationId"]).toBe("action-flows-save");
    expect(described.native?.["atspiRole"]).toBe("push button");
    // Still in `attrs` as well: the fingerprint reads it from there.
    expect(described.attrs["automationId"]).toBe("action-flows-save");
  });
});

describe("a node names the one above it", () => {
  const TABLE: AtspiNode[] = [
    node({ parent: -1, role: "frame", name: "Yam" }),
    node({ parent: 0, role: "table", name: "Flows" }),
    node({ parent: 1, role: "table row" }),
    node({ parent: 2, role: "table cell", name: "guards-and-compensation.flow" }),
    node({ parent: 2, role: "table cell", name: "2 stories" }),
  ];

  it("gives every node but the root a parent reference", () => {
    const built = buildNodes(TABLE, 1).map((one) => one.node);
    expect(built[0]!.parent).toBeUndefined();
    expect(built[1]!.parent).toBe(built[0]!.ref);
    expect(built[2]!.parent).toBe(built[1]!.ref);
    expect(built[3]!.parent).toBe(built[2]!.ref);
    expect(built[4]!.parent).toBe(built[2]!.ref);
  });

  /*
   * What the conformance suite does with it: everything the row says is what
   * its cells say, and a row's own name is empty.
   */
  it("lets a caller read a row by what is inside it", () => {
    const built = buildNodes(TABLE, 1).map((one) => one.node);
    const row = built.find((one) => one.role === "row")!;
    const inside = built.filter((one) => one.parent === row.ref);
    expect(inside.map((one) => one.name).join(" ")).toContain("guards-and-compensation.flow");
  });

  /*
   * With the containers dropped, the nearest ancestor that survived. A ref to a
   * node this snapshot does not carry would be worse than none.
   */
  it("names the nearest kept ancestor when the tree is filtered", () => {
    const withFiller: AtspiNode[] = [
      node({ parent: -1, role: "frame", name: "Yam" }),
      node({ parent: 0, role: "filler" }),
      node({ parent: 1, role: "push button", name: "Run", actions: ["click"] }),
    ];
    const built = buildNodes(withFiller, 1, { interactiveOnly: true }).map((one) => one.node);
    const run = built.find((one) => one.name === "Run")!;
    expect(built.some((one) => one.role === "generic")).toBe(false);
    expect(run.parent).toBe(built[0]!.ref);
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
    // Chromium's tabs, rows and list items offer `select` and no `click`.
    expect(actionFor("click", node({ role: "list item", actions: ["select", "showContextMenu"] }))).toBe("select");
    expect(actionFor("click", node({ role: "page tab", actions: ["select", "click"] }))).toBe("click");
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
    // A label does not grow a `click` by waiting, so this is not a timeout (SF-11).
    await expect(one.act("click", label.ref)).rejects.toThrow(UnsupportedError);
  });

  it("refuses a web action, as a desktop adapter always has (REQ-SURF-5)", async () => {
    const one = await surface();
    await one.snapshot();
    await expect(one.act("navigate", undefined, { url: "http://x" })).rejects.toThrow(
      /has no "navigate"/u,
    );
    // Unsupported, not an invalid argument: no argument would make it work (SF-11).
    await expect(one.act("navigate", undefined, { url: "http://x" })).rejects.toThrow(
      UnsupportedError,
    );
    await expect(one.read("url")).rejects.toThrow(UnsupportedError);
    await expect(one.restore()).rejects.toThrow(UnsupportedError);
    await expect(
      one.check({ kind: "urlContains", value: { kind: "literal", value: "/x" } } as never, "page"),
    ).rejects.toThrow(UnsupportedError);
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
    await expect(one.screenshot()).rejects.toThrow(UnsupportedError);
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

/**
 * A bus whose window changes, the way an application's does after a click.
 *
 * `recorded` serves one tree forever, which is exactly what hid the defects
 * below: a check that answered from the last snapshot and one that re-read the
 * window were indistinguishable against a window that never changed.
 */
function changingBus(initial: AtspiNode[]) {
  let nodes = initial;
  let title = "Yam";
  let reads = 0;
  const bridge: AtspiBridge = {
    async availability() {
      return { available: true, busAddress: "unix:abstract=/tmp/at-spi" };
    },
    async window({ maxNodes }) {
      reads += 1;
      return { nodes: nodes.slice(0, maxNodes), title, truncated: false };
    },
    async perform() {
      /* The tests change the window themselves, as the application would. */
    },
  };
  return {
    bridge,
    show: (next: AtspiNode[]) => {
      nodes = next;
    },
    retitle: (next: string) => {
      title = next;
    },
    reads: () => reads,
  };
}

async function openOn(bridge: AtspiBridge): Promise<AtspiSurface> {
  const surface = new AtspiSurface({ bridge });
  await surface.open({ processName: "Yam" });
  return surface;
}

/** `WINDOW` with the Surfaces toggle unchecked, as a click on it would leave it. */
const UNCHECKED: AtspiNode[] = WINDOW.map((one) =>
  one.automationId === "rail-surfaces"
    ? { ...one, states: ["enabled", "showing", "visible", "checkable"] }
    : one,
);

/** `WINDOW` without "Save flow": index 2 gone, and every parent index after it moved. */
const WITHOUT_SAVE: AtspiNode[] = WINDOW.filter((one) => one.name !== "Save flow");

/** Two rows with no automation id, the case a path alone gets wrong. */
const ROWS: AtspiNode[] = [
  node({ parent: -1, role: "frame", name: "Yam" }),
  node({ parent: 0, role: "list", name: "Flows" }),
  node({ parent: 1, role: "list item", name: "checkout.flow", actions: ["click"] }),
  node({ parent: 1, role: "list item", name: "signup.flow", actions: ["click"] }),
];

describe("check answers about the window as it is now", () => {
  it("re-reads before answering, so a state changed by the last click is seen", async () => {
    const bus = changingBus(WINDOW);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const toggle = snapshot.nodes.find((n) => n.name === "Surfaces")!;
    expect((await one.check({ kind: "checked" } as never, "ref", toggle.ref)).ok).toBe(true);

    bus.show(UNCHECKED);
    expect((await one.check({ kind: "checked" } as never, "ref", toggle.ref)).ok).toBe(false);
    expect((await one.check({ kind: "unchecked" } as never, "ref", toggle.ref)).ok).toBe(true);
  });

  it("leaves the caller's references good: a check is not a new snapshot (SF-10)", async () => {
    const bus = changingBus(WINDOW);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const toggle = snapshot.nodes.find((n) => n.name === "Surfaces")!;
    await one.check({ kind: "checked" } as never, "ref", toggle.ref);
    await expect(one.act("click", toggle.ref)).resolves.toMatchObject({ ok: true });
  });

  it("re-reads the window's text for a page predicate", async () => {
    const bus = changingBus(WINDOW);
    const one = await openOn(bus.bridge);
    await one.snapshot();
    const saved = { kind: "textContains", value: { kind: "literal", value: "Save flow" } } as never;
    expect((await one.check(saved, "page")).ok).toBe(true);
    bus.show(WITHOUT_SAVE);
    expect((await one.check(saved, "page")).ok).toBe(false);
  });

  it("passes `absent` on an element that has gone, instead of refusing its reference", async () => {
    const bus = changingBus(WINDOW);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const save = snapshot.nodes.find((n) => n.name === "Save flow")!;
    bus.show(WITHOUT_SAVE);

    expect(await one.check({ kind: "absent" } as never, "ref", save.ref)).toMatchObject({ ok: true });
    expect(
      (await one.check({ kind: "present", negate: true } as never, "ref", save.ref)).ok,
      "a negated presence is the same question",
    ).toBe(true);
    expect((await one.check({ kind: "present" } as never, "ref", save.ref)).ok).toBe(false);
    expect((await one.check({ kind: "visible" } as never, "ref", save.ref)).ok).toBe(false);
  });

  it("does not mistake the row that moved into a deleted row's place for it", async () => {
    const bus = changingBus(ROWS);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const checkout = snapshot.nodes.find((n) => n.name === "checkout.flow")!;
    const signup = snapshot.nodes.find((n) => n.name === "signup.flow")!;
    // Delete the first row: the second now sits at the first one's index path.
    bus.show(ROWS.filter((one_) => one_.name !== "checkout.flow"));

    expect((await one.check({ kind: "absent" } as never, "ref", checkout.ref)).ok).toBe(true);
    expect((await one.check({ kind: "present" } as never, "ref", signup.ref)).ok).toBe(true);
  });

  it("still answers about a reference from an earlier snapshot by what it named", async () => {
    const bus = changingBus(WINDOW);
    const one = await openOn(bus.bridge);
    const first = await one.snapshot();
    await one.snapshot();
    const save = first.nodes.find((n) => n.name === "Save flow")!;
    expect((await one.check({ kind: "present" } as never, "ref", save.ref)).ok).toBe(true);
    // Acting on it is still refused: an index from then must not address now (SF-10).
    await expect(one.act("click", save.ref)).rejects.toThrow(/not an element of the current snapshot/u);
  });

  it("refuses a reference no snapshot issued, because nothing is known about it", async () => {
    const one = await openOn(changingBus(WINDOW).bridge);
    await one.snapshot();
    await expect(one.check({ kind: "absent" } as never, "ref", "a99_1")).rejects.toThrow(LocateError);
  });

  it("refuses a predicate it cannot answer before reading the bus", async () => {
    const bus = changingBus(WINDOW);
    const one = await openOn(bus.bridge);
    const reads = bus.reads();
    await expect(one.check({ kind: "css", name: "color" } as never, "page")).rejects.toThrow(
      UnsupportedError,
    );
    expect(bus.reads()).toBe(reads);
  });
});

describe("waitFor, which this adapter did not have (SF-16)", () => {
  it("waits for an element to go, and keeps the reference good", async () => {
    const bus = changingBus(WINDOW);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const save = snapshot.nodes.find((n) => n.name === "Save flow")!;
    setTimeout(() => bus.show(WITHOUT_SAVE), 150);
    await expect(
      one.act("waitFor", save.ref, { state: "detached", timeoutMs: 3_000 }),
    ).resolves.toEqual({ ok: true, ref: save.ref });
  });

  it("waits for an element to be showing, which is what `visible` means here", async () => {
    const hidden = WINDOW.map((one) =>
      one.name === "Save flow" ? { ...one, states: ["enabled", "visible"] } : one,
    );
    const bus = changingBus(hidden);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const save = snapshot.nodes.find((n) => n.name === "Save flow")!;
    setTimeout(() => bus.show(WINDOW), 150);
    await expect(one.act("waitFor", save.ref, { timeoutMs: 3_000 })).resolves.toMatchObject({
      ok: true,
    });
  });

  it("times out, as a timeout, and says where the element is", async () => {
    const one = await openOn(changingBus(WINDOW).bridge);
    const snapshot = await one.snapshot();
    const save = snapshot.nodes.find((n) => n.name === "Save flow")!;
    const failure = await one
      .act("waitFor", save.ref, { state: "detached", timeoutMs: 300 })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TimeoutError);
    expect((failure as Error).message).toMatch(/to be detached, and it is showing/u);
  });

  it("waits for the window's text with no reference", async () => {
    const bus = changingBus(WITHOUT_SAVE);
    const one = await openOn(bus.bridge);
    setTimeout(() => bus.show(WINDOW), 150);
    await expect(
      one.act("waitFor", undefined, { text: "Save flow", timeoutMs: 3_000 }),
    ).resolves.toEqual({ ok: true });
  });

  it("waits for a title the window takes later", async () => {
    const bus = changingBus(WINDOW);
    const one = await openOn(bus.bridge);
    setTimeout(() => bus.retitle("Yam — checkout.flow"), 150);
    await expect(
      one.act("waitFor", undefined, { title: "checkout.flow", timeoutMs: 3_000 }),
    ).resolves.toEqual({ ok: true });
  });

  it("refuses a URL at once, and says what is missing when there is nothing to wait for", async () => {
    const one = await openOn(changingBus(WINDOW).bridge);
    const started = Date.now();
    await expect(
      one.act("waitFor", undefined, { url: "/x", timeoutMs: 5_000 }),
    ).rejects.toThrow(UnsupportedError);
    await expect(one.act("waitFor", undefined, { timeoutMs: 5_000 })).rejects.toThrow(DataError);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

/**
 * Telling one element from another after the window changed (SF-10).
 *
 * The identity check preferred whichever look-alike sat at the old index path,
 * and the walker never published the D-Bus address that was meant to come
 * first. So after deleting the first of two rows that nothing distinguishes,
 * the second row — now at the first one's path — answered for it: `absent`
 * failed, and every other question was answered about the neighbour.
 */
/** A value predicate over a literal, as the executor hands one to the surface. */
const literal = (kind: string, value: string): never =>
  ({ kind, value: { kind: "literal", value } }) as never;

describe("finding an element again, when rows look alike", () => {
  /** Two list items with no name, no id and no text: only position tells them apart. */
  const UNNAMED: AtspiNode[] = [
    node({ parent: -1, role: "frame", name: "Yam" }),
    node({ parent: 0, role: "list", name: "Flows" }),
    node({ parent: 1, role: "list item", states: ["enabled", "showing", "selected"] }),
    node({ parent: 1, role: "list item" }),
  ];
  /** Two rows the application gave the same automation id. */
  const SAME_ID: AtspiNode[] = [
    node({ parent: -1, role: "frame", name: "Yam" }),
    node({ parent: 0, role: "list", name: "Flows" }),
    node({ parent: 1, role: "list item", name: "checkout.flow", automationId: "flow-row" }),
    node({ parent: 1, role: "list item", name: "signup.flow", automationId: "flow-row" }),
  ];
  const withAddresses = (nodes: AtspiNode[]): AtspiNode[] =>
    nodes.map((one, at) => ({ ...one, address: { bus: ":1.42", path: `/org/a11y/atspi/accessible/${at}` } }));
  const withoutFirstRow = (nodes: AtspiNode[]): AtspiNode[] => nodes.filter((_, at) => at !== 2);

  it("refuses to answer for a deleted unnamed row with its neighbour, given no address", async () => {
    const bus = changingBus(UNNAMED);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const [first, second] = snapshot.nodes.filter((n) => n.role === "listitem");
    bus.show(withoutFirstRow(UNNAMED));

    // Before: `absent` said false and `selected` answered with the second row's state.
    await expect(one.check({ kind: "absent" } as never, "ref", first!.ref)).rejects.toThrow(LocateError);
    await expect(one.check({ kind: "selected" } as never, "ref", first!.ref)).rejects.toThrow(
      /cannot be told apart/u,
    );
    await expect(one.check({ kind: "present" } as never, "ref", second!.ref)).rejects.toThrow(
      LocateError,
    );
  });

  it("still answers about an unnamed row in a window where nothing moved", async () => {
    const bus = changingBus(UNNAMED);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const [first, second] = snapshot.nodes.filter((n) => n.role === "listitem");
    // A state change is not a move: the rows are the same rows in the same places.
    bus.show(UNNAMED.map((n, at) => (at === 2 ? { ...n, states: ["enabled", "showing"] } : n)));

    expect((await one.check({ kind: "selected" } as never, "ref", first!.ref)).ok).toBe(false);
    expect((await one.check({ kind: "present" } as never, "ref", second!.ref)).ok).toBe(true);
  });

  it("refuses rows that share an automation id once one of them is deleted", async () => {
    const bus = changingBus(SAME_ID);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const checkout = snapshot.nodes.find((n) => n.name === "checkout.flow")!;
    bus.show(withoutFirstRow(SAME_ID));

    // Before: `text` on the deleted row answered "signup.flow".
    await expect(
      one.check(literal("text", "signup.flow"), "ref", checkout.ref),
    ).rejects.toThrow(LocateError);
    await expect(one.check({ kind: "absent" } as never, "ref", checkout.ref)).rejects.toThrow(
      /2 list item elements had the automation id "flow-row"/u,
    );
  });

  it("answers exactly, deleted row and neighbour both, when the walker publishes addresses", async () => {
    for (const rows of [UNNAMED, SAME_ID]) {
      const bus = changingBus(withAddresses(rows));
      const one = await openOn(bus.bridge);
      const snapshot = await one.snapshot();
      const [first, second] = snapshot.nodes.filter((n) => n.role === "listitem");
      bus.show(withoutFirstRow(withAddresses(rows)));

      expect((await one.check({ kind: "absent" } as never, "ref", first!.ref)).ok).toBe(true);
      expect((await one.check({ kind: "present" } as never, "ref", second!.ref)).ok).toBe(true);
      expect(
        (await one.check({ kind: "selected" } as never, "ref", second!.ref)).ok,
        "the neighbour answers with its own state, not the deleted row's",
      ).toBe(false);
    }
    const bus = changingBus(withAddresses(SAME_ID));
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const signup = snapshot.nodes.find((n) => n.name === "signup.flow")!;
    bus.show(withoutFirstRow(withAddresses(SAME_ID)));
    expect(await one.check(literal("textContains", "flow"), "ref", signup.ref)).toMatchObject({
      ok: true,
      actual: "signup.flow",
    });
  });

  it("reads a recycled address with a different role as the element having gone", async () => {
    const bus = changingBus(withAddresses(WINDOW));
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const save = snapshot.nodes.find((n) => n.name === "Save flow")!;
    bus.show(withAddresses(WINDOW).map((n, at) => (at === 2 ? { ...n, role: "label", actions: [] } : n)));
    expect((await one.check({ kind: "absent" } as never, "ref", save.ref)).ok).toBe(true);
  });

  it("waits on an ambiguous row by refusing at once, rather than timing out on a guess", async () => {
    const bus = changingBus(UNNAMED);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const [first] = snapshot.nodes.filter((n) => n.role === "listitem");
    bus.show(withoutFirstRow(UNNAMED));
    const started = Date.now();
    await expect(
      one.act("waitFor", first!.ref, { state: "detached", timeoutMs: 5_000 }),
    ).rejects.toThrow(LocateError);
    expect(Date.now() - started).toBeLessThan(1_000);
  });
});

/**
 * A rename is not a removal (SF-16).
 *
 * An element with no automation id is found again by its name, so a label that
 * counts — "3 items", then "4 items" — read as gone the moment it changed, and
 * `the count should say "4 items"` could not be asked of the reference the
 * snapshot gave.
 */
describe("an element whose name changed", () => {
  const COUNTED: AtspiNode[] = [
    node({ parent: -1, role: "frame", name: "Yam" }),
    node({ parent: 0, role: "list", name: "Flows" }),
    node({ parent: 1, role: "list item", name: "checkout.flow" }),
    node({ parent: 1, role: "list item", name: "signup.flow" }),
    node({ parent: 0, role: "label", name: "3 items" }),
  ];

  it("is still there, and answers with its new name", async () => {
    const bus = changingBus(COUNTED);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const count = snapshot.nodes.find((n) => n.name === "3 items")!;
    bus.show(COUNTED.map((n) => (n.name === "3 items" ? { ...n, name: "4 items" } : n)));

    expect((await one.check({ kind: "present" } as never, "ref", count.ref)).ok).toBe(true);
    expect((await one.check({ kind: "absent" } as never, "ref", count.ref)).ok).toBe(false);
    expect(
      await one.check(literal("text", "4 items"), "ref", count.ref),
    ).toMatchObject({ ok: true, actual: "4 items" });
  });

  it("is not a deleted row's neighbour that moved into its place and changed its name", async () => {
    const bus = changingBus(COUNTED);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const checkout = snapshot.nodes.find((n) => n.name === "checkout.flow")!;
    // The first row goes; the second moves into its path and is renamed in the same repaint.
    bus.show(
      COUNTED.filter((n) => n.name !== "checkout.flow").map((n) =>
        n.name === "signup.flow" ? { ...n, name: "signup-v2.flow" } : n,
      ),
    );
    expect((await one.check({ kind: "absent" } as never, "ref", checkout.ref)).ok).toBe(true);
  });

  it("is not an existing element that moved into its place", async () => {
    const bus = changingBus(COUNTED);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const checkout = snapshot.nodes.find((n) => n.name === "checkout.flow")!;
    // Same number of rows, but the one at the old path is a row that was already there.
    bus.show([COUNTED[0]!, COUNTED[1]!, COUNTED[3]!, { ...COUNTED[3]!, name: "billing.flow" }, COUNTED[4]!]);
    expect((await one.check({ kind: "absent" } as never, "ref", checkout.ref)).ok).toBe(true);
  });
});

/**
 * Questions the bus answers, which were refused (SF-11).
 */
describe("title and geometry predicates", () => {
  it("answers a title predicate from the window as it is now", async () => {
    const bus = changingBus(WINDOW);
    const one = await openOn(bus.bridge);
    const titled = { kind: "titleContains", value: { kind: "literal", value: "checkout.flow" } } as never;
    expect((await one.check(titled, "page")).ok).toBe(false);
    bus.retitle("Yam — checkout.flow");
    expect(await one.check(titled, "page")).toMatchObject({ ok: true, actual: "Yam — checkout.flow" });
    expect(
      (await one.check({ kind: "title", value: { kind: "literal", value: "Yam" } } as never, "page")).ok,
    ).toBe(false);
    expect((await one.state()).windowTitle).toBe("Yam — checkout.flow");
  });

  it("answers box, size and location from the element's extents", async () => {
    const one = await openOn(changingBus(WINDOW).bridge);
    const snapshot = await one.snapshot();
    const save = snapshot.nodes.find((n) => n.name === "Save flow")!;
    const box = { kind: "box", numbers: [12, 8, 90, 24] } as never;
    expect(await one.check(box, "ref", save.ref)).toMatchObject({ ok: true });
    expect((await one.check({ kind: "size", numbers: [90, 24] } as never, "ref", save.ref)).ok).toBe(true);
    expect((await one.check({ kind: "location", numbers: [12, 8] } as never, "ref", save.ref)).ok).toBe(true);
    expect(
      await one.check({ kind: "location", numbers: [0, 0] } as never, "ref", save.ref),
    ).toMatchObject({ ok: false, actual: [12, 8] });
  });

  it("refuses geometry for an element that publishes no extents", async () => {
    const one = await openOn(changingBus(WINDOW).bridge);
    const snapshot = await one.snapshot();
    const label = snapshot.nodes.find((n) => n.name === "Not a control")!;
    await expect(one.check({ kind: "size", numbers: [1, 1] } as never, "ref", label.ref)).rejects.toThrow(
      UnsupportedError,
    );
  });
});

/** A bus that records every command and serves whatever tree a test puts in front of it. */
function recordingBus(initial: AtspiNode[]) {
  const performed: AtspiCommand[] = [];
  const reads: Array<AtspiNode[]> = [];
  let nodes = initial;
  const bridge: AtspiBridge = {
    async availability() {
      return { available: true, busAddress: "unix:abstract=/tmp/at-spi" };
    },
    async window() {
      reads.push(nodes);
      return { nodes, title: "Yam", truncated: false };
    },
    async perform(command) {
      performed.push(command);
    },
  };
  return {
    bridge,
    performed,
    show: (next: AtspiNode[]) => {
      nodes = next;
    },
  };
}

describe("setChecked sets, rather than toggles (SF-11)", () => {
  const BOXES: AtspiNode[] = [
    node({ parent: -1, role: "frame", name: "Yam" }),
    node({
      parent: 0,
      role: "check box",
      name: "Headless",
      states: ["enabled", "showing", "checkable"],
      actions: ["click"],
    }),
    node({
      parent: 0,
      role: "check box",
      name: "Record video",
      states: ["enabled", "showing", "checkable", "checked"],
      actions: ["click"],
    }),
  ];

  it("leaves a box that is already in the state asked for alone", async () => {
    const bus = recordingBus(BOXES);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const headless = snapshot.nodes.find((n) => n.name === "Headless")!;
    const video = snapshot.nodes.find((n) => n.name === "Record video")!;

    // Verified before the fix: this clicked, and checked the box.
    await expect(one.act("setChecked", headless.ref, { checked: false })).resolves.toMatchObject({
      ok: true,
    });
    await expect(one.act("setChecked", video.ref, { checked: true })).resolves.toMatchObject({
      ok: true,
    });
    expect(bus.performed).toEqual([]);
  });

  it("clicks a box that is in the other state, and only that one", async () => {
    const bus = recordingBus(BOXES);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const headless = snapshot.nodes.find((n) => n.name === "Headless")!;
    const video = snapshot.nodes.find((n) => n.name === "Record video")!;

    await one.act("setChecked", headless.ref, { checked: true });
    await one.act("setChecked", video.ref, { checked: "false" });
    expect(bus.performed).toEqual([
      { kind: "action", path: [0], action: "click" },
      { kind: "action", path: [1], action: "click" },
    ]);
  });

  it("reads the state now, not from the snapshot taken before the last click", async () => {
    const bus = recordingBus(BOXES);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const headless = snapshot.nodes.find((n) => n.name === "Headless")!;
    bus.show(BOXES.map((n) => (n.name === "Headless" ? { ...n, states: [...n.states!, "checked"] } : n)));
    await one.act("setChecked", headless.ref, { checked: true });
    expect(bus.performed).toEqual([]);
  });
});

describe("an Action interface that did not answer is not an element with no actions (SF-11)", () => {
  const BUSY: AtspiNode[] = [
    node({ parent: -1, role: "frame", name: "Yam" }),
    node({ parent: 0, role: "push button", name: "Save flow", actionsError: "Timeout was reached" }),
  ];
  const ANSWERED: AtspiNode[] = [
    BUSY[0]!,
    node({ parent: 0, role: "push button", name: "Save flow", actions: ["click"] }),
  ];

  it("reads the window again, and acts when the interface answers the second time", async () => {
    const bus = recordingBus(BUSY);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const save = snapshot.nodes.find((n) => n.name === "Save flow")!;
    bus.show(ANSWERED);
    await expect(one.act("click", save.ref)).resolves.toMatchObject({ ok: true });
    expect(bus.performed).toEqual([{ kind: "action", path: [0], action: "click" }]);
  });

  it("says try again, not never, when it still does not answer", async () => {
    const bus = recordingBus(BUSY);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const save = snapshot.nodes.find((n) => n.name === "Save flow")!;
    const failure = await one.act("click", save.ref).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ActionabilityError);
    expect(failure).not.toBeInstanceOf(UnsupportedError);
    expect((failure as Error).message).toMatch(/Timeout was reached/u);
    expect(bus.performed).toEqual([]);
  });

  it("still refuses as unsupported an element that answered with no actions", async () => {
    const bus = recordingBus([BUSY[0]!, node({ parent: 0, role: "label", name: "Status", actions: [] })]);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const status = snapshot.nodes.find((n) => n.name === "Status")!;
    await expect(one.act("click", status.ref)).rejects.toThrow(UnsupportedError);
  });
});

/**
 * The six states the executor sends a reference wait (pattern 19). `enabled`
 * and `disabled` were refused as unknown states.
 */
describe("waiting for an element to be enabled or disabled", () => {
  const disabledSave = WINDOW.map((one) =>
    one.name === "Save flow" ? { ...one, states: ["showing", "visible"] } : one,
  );

  it("waits for enabled, and not while the element is disabled", async () => {
    const bus = changingBus(disabledSave);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const save = snapshot.nodes.find((n) => n.name === "Save flow")!;
    await expect(
      one.act("waitFor", save.ref, { state: "enabled", timeoutMs: 300 }),
    ).rejects.toThrow(/to be enabled, and it is showing and disabled/u);
    await expect(
      one.act("waitFor", save.ref, { state: "disabled", timeoutMs: 300 }),
    ).resolves.toEqual({ ok: true, ref: save.ref });
    setTimeout(() => bus.show(WINDOW), 150);
    await expect(
      one.act("waitFor", save.ref, { state: "enabled", timeoutMs: 3_000 }),
    ).resolves.toEqual({ ok: true, ref: save.ref });
  });

  it("does not call an element that has gone disabled", async () => {
    const bus = changingBus(WINDOW);
    const one = await openOn(bus.bridge);
    const snapshot = await one.snapshot();
    const save = snapshot.nodes.find((n) => n.name === "Save flow")!;
    bus.show(WITHOUT_SAVE);
    await expect(
      one.act("waitFor", save.ref, { state: "disabled", timeoutMs: 300 }),
    ).rejects.toThrow(/is not in the window/u);
    await expect(
      one.act("waitFor", save.ref, { state: "attached", timeoutMs: 300 }),
    ).rejects.toThrow(TimeoutError);
  });

  it("refuses a state it does not know, naming the six", async () => {
    const one = await openOn(changingBus(WINDOW).bridge);
    const snapshot = await one.snapshot();
    const save = snapshot.nodes.find((n) => n.name === "Save flow")!;
    await expect(one.act("waitFor", save.ref, { state: "checked" })).rejects.toThrow(DataError);
    await expect(one.act("waitFor", save.ref, { state: "checked" })).rejects.toThrow(
      /attached, detached, visible, hidden, enabled or disabled/u,
    );
  });
});

describe("a wait's default is the configured step timeout", () => {
  it("waits as long as `timeoutMs` says when the step does not", async () => {
    const one = new AtspiSurface({ bridge: changingBus(WINDOW).bridge, timeoutMs: 250 });
    await one.open({ processName: "Yam" });
    const started = Date.now();
    const failure = await one
      .act("waitFor", undefined, { text: "never here" })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(TimeoutError);
    expect((failure as Error).message).toMatch(/Waited 250 ms/u);
    expect(Date.now() - started).toBeLessThan(2_000);

    const snapshot = await one.snapshot();
    const save = snapshot.nodes.find((n) => n.name === "Save flow")!;
    await expect(one.act("waitFor", save.ref, { state: "detached" })).rejects.toThrow(/Waited 250 ms/u);
  });
});

/**
 * The walker itself, against a stand-in for `pyatspi` (SF-10, SF-11).
 *
 * Not a live registry — nothing here is — but the Python the bridge ships is
 * run, so what it writes for an address and for an Action interface that
 * failed is the walker's own output rather than a fixture that assumes it.
 * Skipped on a host with no `python3`.
 */
const PYTHON = spawnSync("python3", ["--version"]).status === 0;

const FAKE_PYATSPI = `
DESKTOP_COORDS = 0
STATE_ACTIVE = 'STATE_ACTIVE'
class _App(object):
    def __init__(self, bus_name):
        self.bus_name = bus_name
class _StateType(object):
    """
    What pyatspi hands back: a PyGObject enum, not a string.

    Its str() is the repr GObject introspection prints, which is where the
    walker's first attempt at a name went wrong. Modelling it as 'STATE_SHOWING'
    — a plain string — is what let that ship: the name happened to fall out of
    the parsing, and no live registry had been asked.
    """
    def __init__(self, name):
        self.value_name = 'ATSPI_' + name
        self.value_nick = name[len('STATE_'):].lower().replace('_', '-')
    def __str__(self):
        return '<enum %s of type Atspi-StateType>' % self.value_name
class _States(object):
    def __init__(self, states):
        self._states = states
    def getStates(self):
        return [_StateType(one) for one in self._states]
    def contains(self, state):
        return state in self._states
def stateToString(one):
    return one.value_nick.replace('-', ' ')
class _Action(object):
    def __init__(self, names):
        self._names = names
        self.nActions = len(names)
    def getName(self, index):
        return self._names[index]
class Accessible(object):
    def __init__(self, role, name='', children=(), actions=None, action_error=None, path=None, app=None):
        self._role = role
        self.name = name
        self.description = ''
        self._children = list(children)
        self._actions = actions
        self._action_error = action_error
        if path is not None:
            self.path = path
        if app is not None:
            self.app = app
    def getRoleName(self):
        return self._role
    def getAttributes(self):
        return []
    def getState(self):
        return _States(['STATE_ENABLED', 'STATE_SHOWING', 'STATE_READ_ONLY'])
    def queryText(self):
        raise NotImplementedError
    def queryValue(self):
        raise NotImplementedError
    def queryComponent(self):
        raise NotImplementedError
    def queryAction(self):
        if self._action_error is not None:
            raise RuntimeError(self._action_error)
        if self._actions is None:
            raise NotImplementedError
        return _Action(self._actions)
    def __iter__(self):
        return iter(self._children)
_app = _App(':1.42')
_window = Accessible('frame', 'Yam', path='/org/a11y/atspi/accessible/1', app=_app, children=[
    Accessible('push button', 'Save', actions=['click'], path='/org/a11y/atspi/accessible/2', app=_app),
    Accessible('push button', 'Busy', action_error='Timeout was reached',
               path='/org/a11y/atspi/accessible/3', app=_app),
    Accessible('label', 'Plain'),
])
class _Application(Accessible):
    pass
class _Registry(object):
    def getDesktop(self, index):
        return [_Application('application', 'Yam', children=[_window])]
Registry = _Registry()
`;

describe.skipIf(!PYTHON)("the walker, run against a stand-in pyatspi", () => {
  it("publishes addresses, and tells an Action interface that failed from one that is absent", () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-atspi-"));
    try {
      writeFileSync(join(dir, "pyatspi.py"), FAKE_PYATSPI);
      const ran = spawnSync("python3", ["-c", WALK_SCRIPT, "Yam", "50"], {
        encoding: "utf8",
        env: { ...process.env, PYTHONPATH: dir },
      });
      expect(ran.stderr).toBe("");
      const window = parseTree(ran.stdout);
      const [frame, save, busy, plain] = window.nodes;
      expect(frame?.address).toEqual({ bus: ":1.42", path: "/org/a11y/atspi/accessible/1" });
      expect(save).toMatchObject({ actions: ["click"], address: { path: "/org/a11y/atspi/accessible/2" } });
      expect(save?.actionsError).toBeUndefined();
      expect(busy?.actionsError).toBe("Timeout was reached");
      expect(busy?.actions).toBeUndefined();
      // No Action interface is not a failure, and no address is published as none rather than a guess.
      expect(plain?.actionsError).toBeUndefined();
      expect(plain?.actions).toBeUndefined();
      expect(plain?.address).toBeUndefined();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /*
   * The states the walker writes are the ones `statesOf` reads (SF-23).
   *
   * Everything above this line in the file drives `statesOf` against
   * `['enabled', 'showing', …]` — the vocabulary the walker is supposed to
   * produce — and nothing checked that it produces it. It did not: the names
   * came out as `showing of type atspi-statetype>`, so no node was ever
   * `showing` or `enabled`, every node was reported `hidden` and `disabled`,
   * and `Snapshot.text` rendered to the empty string because the renderer drops
   * hidden nodes. That is what the first live run of the Linux gate reported,
   * and this is the seam it went through.
   *
   * Both halves, because they are the halves that have to agree: the names out
   * of the Python, and what `statesOf` makes of them.
   */
  it("writes the state names statesOf reads, so a showing node is not hidden", () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-atspi-"));
    try {
      writeFileSync(join(dir, "pyatspi.py"), FAKE_PYATSPI);
      const ran = spawnSync("python3", ["-c", WALK_SCRIPT, "Yam", "50"], {
        encoding: "utf8",
        env: { ...process.env, PYTHONPATH: dir },
      });
      expect(ran.stderr).toBe("");
      const [frame] = parseTree(ran.stdout).nodes;
      expect(frame?.states).toEqual(["enabled", "showing", "read only"]);
      const states = statesOf(frame as AtspiNode);
      expect(states).not.toContain("hidden");
      expect(states).not.toContain("disabled");
      expect(states).toContain("readonly");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /*
   * And on a pyatspi too old to have `stateToString`, which is the fallback the
   * walker carries. Nothing is gained by the fallback being silently dead.
   */
  it("falls back to the enum's own name where stateToString is missing", () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-atspi-"));
    try {
      writeFileSync(
        join(dir, "pyatspi.py"),
        FAKE_PYATSPI.replace("def stateToString(one):", "def _withheld(one):"),
      );
      const ran = spawnSync("python3", ["-c", WALK_SCRIPT, "Yam", "50"], {
        encoding: "utf8",
        env: { ...process.env, PYTHONPATH: dir },
      });
      expect(ran.stderr).toBe("");
      const [frame] = parseTree(ran.stdout).nodes;
      expect(frame?.states).toEqual(["enabled", "showing", "read only"]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
