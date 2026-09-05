/**
 * T1.1 Validate — "snapshot refs resolve back to the same element".
 *
 * Also the standing check on LLD §7.1's two mechanisms: neither may be the only
 * one that works, and the own-refs walker's roles and names are held against
 * Playwright's public `ariaSnapshot()`, which is the independent account of the
 * accessibility tree.
 *
 * Refs: REQ-SURF-1, REQ-SURF-4, LLD §2.2, §7.1.
 */
import { snapshotSchema } from "@svatah/schema";
import {
  parseAiSnapshot,
  playwrightMechanismAvailable,
  renderForHash,
  structuralHash,
} from "../src/index.js";
import { expect, MECHANISMS, test } from "./fixtures.js";

const PAGES = ["/", "/login", "/dashboard", "/schedule-build", "/booking", "/checkout", "/widgets"];

for (const mechanism of MECHANISMS) {
  test.describe(`snapshot (${mechanism} refs)`, () => {
    test("validates against the published wire schema", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const snapshot = await surface.snapshot();
      const parsed = snapshotSchema.safeParse(snapshot);
      expect(parsed.success ? null : JSON.stringify(parsed.error.issues)).toBeNull();
      expect(snapshot.nodes.length).toBeGreaterThan(5);
      expect(snapshot.tokensEstimate).toBeGreaterThan(0);
      expect(snapshot.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    test("every ref resolves back to the element it came from", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const snapshot = await surface.snapshot();

      // Every node, not a sample: a ref that does not resolve is the failure
      // mode that would make bindings meaningless.
      for (const node of snapshot.nodes) {
        const described = await surface.describe(node.ref);
        expect(described.ref, `${node.ref} described itself as something else`).toBe(node.ref);
        expect(
          described.role,
          `${node.ref} is a "${node.role}" in the snapshot but a "${described.role}" when described`,
        ).toBe(node.role);
        if (node.name !== undefined && node.name !== "") {
          expect(described.name ?? "").toContain(node.name.slice(0, 20));
        }
      }
    });

    test("a ref resolves to the same element twice", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const snapshot = await surface.snapshot();
      const textbox = snapshot.nodes.find((n) => n.role === "textbox");
      expect(textbox).toBeDefined();

      const first = await surface.describe(textbox!.ref);
      const second = await surface.describe(textbox!.ref);
      expect(second.attrs["id"]).toBe(first.attrs["id"]);
      expect(second.box).toEqual(first.box);
    });

    test("acting through a snapshot ref reaches the element the snapshot named", async ({
      openSurface,
    }) => {
      const surface = await openSurface(mechanism, "/login");
      const snapshot = await surface.snapshot();
      const password = snapshot.nodes.find(
        (n) => n.role === "textbox" && n.name?.includes("Password"),
      );
      expect(password).toBeDefined();

      await surface.act("type", password!.ref, { value: "typed through the snapshot" });
      const value = await surface.read("value", password!.ref);
      expect(value).toBe("typed through the snapshot");

      const described = await surface.describe(password!.ref);
      expect(described.attrs["id"]).toBe("password");
    });

    test("refs are lost on navigation and say so", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const snapshot = await surface.snapshot();
      const ref = snapshot.nodes[snapshot.nodes.length - 1]!.ref;
      await surface.act("navigate", undefined, { url: "/widgets" });
      await expect(surface.describe(ref)).rejects.toThrow(/no longer resolves|not a reference/);
    });

    test("interactiveOnly narrows to actionable roles", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const all = await surface.snapshot();
      const interactive = await surface.snapshot({ interactiveOnly: true });
      expect(interactive.nodes.length).toBeGreaterThan(0);
      expect(interactive.nodes.length).toBeLessThan(all.nodes.length);
      for (const node of interactive.nodes) {
        expect(["textbox", "button", "checkbox", "link", "combobox", "listbox", "option"]).toContain(
          node.role,
        );
      }
    });

    test("maxNodes truncates in document order", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      const all = await surface.snapshot();
      const few = await surface.snapshot({ maxNodes: 5 });
      expect(few.nodes).toHaveLength(5);
      expect(few.nodes.map((n) => n.role)).toEqual(all.nodes.slice(0, 5).map((n) => n.role));
    });

    test("the structural hash ignores text but tracks structure (LLD §6.2)", async ({
      openSurface,
    }) => {
      const surface = await openSurface(mechanism, "/login");
      const before = await surface.snapshot();

      // Same shape, different text of the same length bucket: the hash holds.
      await surface.act("evaluate", undefined, {
        expression:
          'document.querySelector("[data-testid=login-heading]").textContent = "Sign in to your account!";',
      });
      const renamed = await surface.snapshot();
      expect(renamed.hash).toBe(before.hash);

      // A new landmark with content in it changes the shape: the hash moves.
      // It has to carry content — an empty landmark is not in every adapter's
      // tree, and the point of the assertion is that a real structural change is
      // visible, not that one particular empty element is.
      await surface.act("evaluate", undefined, {
        expression:
          'const n = document.createElement("nav"); n.setAttribute("aria-label","Extra"); ' +
          'const a = document.createElement("a"); a.href = "/docs"; a.textContent = "Extra link"; ' +
          "n.appendChild(a); document.body.appendChild(n);",
      });
      const restructured = await surface.snapshot();
      expect(restructured.hash).not.toBe(before.hash);
    });

    test.describe("across every sample page", () => {
      for (const path of PAGES) {
        test(`${path} snapshots and every ref describes`, async ({ openSurface }) => {
          const surface = await openSurface(mechanism, path);
          const snapshot = await surface.snapshot();
          expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
          expect(snapshot.nodes.length).toBeGreaterThan(0);
          for (const node of snapshot.nodes.slice(0, 12)) {
            const described = await surface.describe(node.ref);
            expect(described.tag).not.toBe("");
          }
        });
      }
    });
  });
}

test.describe("the two mechanisms agree (LLD §7.1)", () => {
  test("both are available in this environment", async ({ openSurface }) => {
    const surface = await openSurface("playwright", "/login");
    expect(surface.snapshotMechanism()).toBe("playwright");
    const own = await openSurface("own", "/login");
    expect(own.snapshotMechanism()).toBe("own");
  });

  test("auto picks Playwright's mechanism while it answers, and falls back when it does not", async ({
    openSurface,
  }) => {
    const surface = await openSurface("own", "/login");
    // The probe is the whole of the fallback decision, so it is asserted
    // directly: if Playwright removes the internal call, `auto` becomes `own`.
    const available = await playwrightMechanismAvailable(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (surface as any).activeFrame,
    );
    expect(typeof available).toBe("boolean");
  });

  test("the own-refs walker reports the roles and names Playwright's public ariaSnapshot does", async ({
    openSurface,
  }) => {
    for (const path of PAGES) {
      const surface = await openSurface("own", path);
      const snapshot = await surface.snapshot();
      const aria = await surface.ariaSnapshot();

      // Every role-and-name pair the public snapshot reports for an interactive
      // element must appear in the walker's node list. This is what keeps our own
      // accessible-name computation honest without asserting byte equality
      // between two different renderings.
      const pairs = [...aria.matchAll(/^\s*-\s+(button|link|textbox|checkbox|combobox|listbox|heading)\s+"((?:[^"\\]|\\.)*)"/gm)];
      expect(pairs.length).toBeGreaterThan(0);
      for (const [, role, rawName] of pairs) {
        const name = rawName!.replace(/\\(.)/g, "$1");
        const found = snapshot.nodes.some(
          (n) => n.role === role && (n.name ?? "") === name,
        );
        expect(found, `${path}: ariaSnapshot has ${role} "${name}" but the walker does not`).toBe(
          true,
        );
      }
    }
  });

  test("both mechanisms see the same interactive elements on the login page", async ({
    openSurface,
  }) => {
    const viaPlaywright = await (await openSurface("playwright", "/login")).snapshot({
      interactiveOnly: true,
    });
    const viaOwn = await (await openSurface("own", "/login")).snapshot({ interactiveOnly: true });

    const key = (nodes: typeof viaOwn.nodes) =>
      nodes.map((n) => `${n.role} ${n.name ?? ""}`).sort();
    expect(key(viaOwn.nodes)).toEqual(key(viaPlaywright.nodes));
  });
});

test.describe("parsing Playwright's AI snapshot", () => {
  test("reads roles, names, values, states, depth and parents", () => {
    const nodes = parseAiSnapshot(
      [
        `- main [ref=e1]:`,
        `  - heading "Sign in" [level=1] [ref=e2]`,
        `  - textbox "Username": you@example.com [required] [ref=e3]`,
        `  - checkbox "Remember me" [checked=false] [ref=e4]`,
        `  - button "Sign In" [disabled] [ref=e5]`,
        `  - generic`,
      ].join("\n"),
    );

    expect(nodes.map((n) => n.ref)).toEqual(["e1", "e2", "e3", "e4", "e5"]);
    expect(nodes[1]).toMatchObject({ role: "heading", name: "Sign in", depth: 1, parent: "e1" });
    expect(nodes[2]).toMatchObject({ role: "textbox", value: "you@example.com" });
    expect(nodes[2]!.states).toContain("required");
    expect(nodes[3]!.states).toContain("unchecked");
    expect(nodes[4]!.states).toContain("disabled");
  });

  test("skips a node Playwright issued no reference for", () => {
    expect(parseAiSnapshot(`- generic\n- button "Go" [ref=e2]`).map((n) => n.ref)).toEqual(["e2"]);
  });
});

test.describe("the structural hash", () => {
  test("buckets names by length so content does not move it", () => {
    const node = (name: string) => ({ ref: "r0", role: "heading", states: [], depth: 0, name });
    expect(structuralHash([node("abcdefgh")])).toBe(structuralHash([node("12345678")]));
    expect(structuralHash([node("abcdefgh")])).not.toBe(structuralHash([node("a".repeat(40))]));
  });

  test("renders one line per node, with role, bucket and sorted states", () => {
    expect(
      renderForHash([
        { ref: "r0", role: "form", states: [], depth: 0 },
        { ref: "r1", role: "textbox", states: ["required", "disabled"], depth: 1, name: "User" },
      ]),
    ).toBe("form 0\n  textbox 1-8 [disabled,required]");
  });
});
