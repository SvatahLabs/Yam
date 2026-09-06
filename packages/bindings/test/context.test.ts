/**
 * T1.3 Validate — "hash invariance to text, sensitivity to structure".
 *
 * The context hash (LLD §6.2) is what scopes a binding (REQ-REC-6) and what tells
 * a failed resolution whether the element moved or the page changed (LLD §6.3).
 * Both uses depend on the same property: it must ignore what a page *says* and
 * track what a page *is*.
 */
import { describe, expect, it } from "vitest";
import type { SnapshotNode } from "@svatah/yam-schema";
import { buildSnapshot, lengthBucket, renderForHash, structuralHash } from "@svatah/yam-surface";
import {
  contextHash,
  contextPattern,
  contextRoot,
  LANDMARK_ROLES,
  patternMatches,
  subtree,
} from "../src/index.js";

/** A login page: main → form → heading, two textboxes, a checkbox, a button. */
function loginNodes(overrides: Partial<Record<string, Partial<SnapshotNode>>> = {}): SnapshotNode[] {
  const base: SnapshotNode[] = [
    { ref: "r0", role: "navigation", states: [], depth: 0, name: "Main" },
    { ref: "r1", role: "link", states: [], depth: 1, parent: "r0", name: "Dashboard" },
    { ref: "r2", role: "main", states: [], depth: 0 },
    { ref: "r3", role: "heading", states: [], depth: 1, parent: "r2", name: "Sign in" },
    { ref: "r4", role: "form", states: [], depth: 1, parent: "r2", name: "Login" },
    { ref: "r5", role: "textbox", states: ["required"], depth: 2, parent: "r4", name: "Username" },
    { ref: "r6", role: "textbox", states: ["required"], depth: 2, parent: "r4", name: "Password" },
    { ref: "r7", role: "checkbox", states: ["unchecked"], depth: 2, parent: "r4", name: "Remember" },
    { ref: "r8", role: "button", states: [], depth: 2, parent: "r4", name: "Sign In" },
  ];
  return base.map((n) => ({ ...n, ...(overrides[n.ref] ?? {}) }));
}

const snapshotOf = (nodes: SnapshotNode[]) => buildSnapshot("r0", nodes, structuralHash(nodes));

describe("length buckets (LLD §6.2)", () => {
  it("collapses a name to 0, 1-8, 9-32 or 33+", () => {
    expect(lengthBucket(undefined)).toBe("0");
    expect(lengthBucket("")).toBe("0");
    expect(lengthBucket("Sign in")).toBe("1-8");
    expect(lengthBucket("a".repeat(8))).toBe("1-8");
    expect(lengthBucket("a".repeat(9))).toBe("9-32");
    expect(lengthBucket("a".repeat(32))).toBe("9-32");
    expect(lengthBucket("a".repeat(33))).toBe("33+");
  });

  it("renders one line per node with role, bucket and sorted states", () => {
    expect(renderForHash(loginNodes()).split("\n")[5]).toBe("    textbox 1-8 [required]");
  });
});

describe("invariance to text (T1.3)", () => {
  it("a name changed within its bucket does not move the hash", () => {
    const before = contextHash(snapshotOf(loginNodes())).hash;
    const after = contextHash(
      snapshotOf(loginNodes({ r3: { name: "Log in" }, r8: { name: "Log In" } })),
    ).hash;
    expect(after).toBe(before);
  });

  it("a value changed does not move the hash — a hash is about shape, not content", () => {
    const before = contextHash(snapshotOf(loginNodes())).hash;
    const after = contextHash(snapshotOf(loginNodes({ r5: { value: "atul@example.com" } }))).hash;
    expect(after).toBe(before);
  });

  it("a reference changed does not move the hash", () => {
    const renamed = loginNodes().map((n) => ({
      ...n,
      ref: `e${n.ref.slice(1)}`,
      ...(n.parent === undefined ? {} : { parent: `e${n.parent.slice(1)}` }),
    }));
    expect(contextHash(snapshotOf(renamed)).hash).toBe(contextHash(snapshotOf(loginNodes())).hash);
  });

  it("a box changed does not move the hash", () => {
    const moved = loginNodes().map((n) => ({ ...n, box: [1, 2, 3, 4] as [number, number, number, number] }));
    expect(contextHash(snapshotOf(moved)).hash).toBe(contextHash(snapshotOf(loginNodes())).hash);
  });

  it("but a name that crosses a bucket boundary does move it", () => {
    const before = contextHash(snapshotOf(loginNodes())).hash;
    const after = contextHash(snapshotOf(loginNodes({ r3: { name: "a".repeat(40) } }))).hash;
    expect(after).not.toBe(before);
  });
});

describe("sensitivity to structure (T1.3)", () => {
  it("an added node moves the hash", () => {
    const extra = [
      ...loginNodes(),
      { ref: "r9", role: "link", states: [], depth: 2, parent: "r4", name: "Forgot?" } as SnapshotNode,
    ];
    expect(contextHash(snapshotOf(extra)).hash).not.toBe(contextHash(snapshotOf(loginNodes())).hash);
  });

  it("a removed node moves the hash", () => {
    const fewer = loginNodes().filter((n) => n.ref !== "r7");
    expect(contextHash(snapshotOf(fewer)).hash).not.toBe(contextHash(snapshotOf(loginNodes())).hash);
  });

  it("a reordered node moves the hash", () => {
    const nodes = loginNodes();
    // The checkbox and the button swapped. A binding whose candidate is
    // positional — `nth`, an XPath index, `:nth-child` — has to see that.
    const reordered = [...nodes.slice(0, 7), nodes[8]!, nodes[7]!];
    expect(contextHash(snapshotOf(reordered)).hash).not.toBe(contextHash(snapshotOf(nodes)).hash);
  });

  it("but swapping two nodes of the same role and bucket does not, and should not", () => {
    const nodes = loginNodes();
    // The two textboxes swapped. They are indistinguishable by shape — same
    // role, same name bucket, same states — so nothing about the page's shape
    // changed, and a hash that moved here would report drift on every page whose
    // fields were reordered without being renamed. Which of the two an element
    // is, is the fingerprint's job (LLD §6.4), not the context hash's.
    const swapped = [...nodes.slice(0, 5), nodes[6]!, nodes[5]!, ...nodes.slice(7)];
    expect(contextHash(snapshotOf(swapped)).hash).toBe(contextHash(snapshotOf(nodes)).hash);
  });

  it("a wrapper inserted into the tree moves the hash", () => {
    // Depth is recomputed from the parent chain rather than read off the node,
    // so a wrapper is a shape change because it is a *node*, not because a
    // number went up. An adapter that miscounted depth cannot fake a context.
    const wrapped: SnapshotNode[] = [
      ...loginNodes().slice(0, 5),
      { ref: "r9", role: "group", states: [], depth: 2, parent: "r4" },
      ...loginNodes()
        .slice(5)
        .map((n) => ({ ...n, parent: "r9", depth: 3 })),
    ];
    expect(contextHash(snapshotOf(wrapped)).hash).not.toBe(
      contextHash(snapshotOf(loginNodes())).hash,
    );
  });

  it("ignores the depth an adapter reports and uses the parent chain", () => {
    const lying = loginNodes().map((n) => ({ ...n, depth: 0 }));
    expect(contextHash(snapshotOf(lying)).hash).toBe(contextHash(snapshotOf(loginNodes())).hash);
  });

  it("a changed state moves the hash", () => {
    const disabled = loginNodes({ r8: { states: ["disabled"] } });
    expect(contextHash(snapshotOf(disabled)).hash).not.toBe(
      contextHash(snapshotOf(loginNodes())).hash,
    );
  });

  it("a changed role moves the hash", () => {
    const demoted = loginNodes({ r3: { role: "paragraph" } });
    expect(contextHash(snapshotOf(demoted)).hash).not.toBe(
      contextHash(snapshotOf(loginNodes())).hash,
    );
  });
});

describe("scoping the context (LLD §6.2)", () => {
  it("scopes to the nearest landmark ancestor", () => {
    const snapshot = snapshotOf(loginNodes());
    expect(contextRoot(snapshot, "r5")?.ref).toBe("r4"); // the form
    expect(contextRoot(snapshot, "r3")?.ref).toBe("r2"); // main
    expect(contextRoot(snapshot, "r1")?.ref).toBe("r0"); // the navigation
  });

  it("a landmark scopes to itself", () => {
    expect(contextRoot(snapshotOf(loginNodes()), "r4")?.ref).toBe("r4");
  });

  it("falls back to main, then to the root", () => {
    const noLandmarkAbove: SnapshotNode[] = [
      { ref: "r0", role: "generic", states: [], depth: 0 },
      { ref: "r1", role: "main", states: [], depth: 0 },
      { ref: "r2", role: "paragraph", states: [], depth: 1, parent: "r0" },
    ];
    expect(contextRoot(snapshotOf(noLandmarkAbove), "r2")?.ref).toBe("r1");

    const nothing: SnapshotNode[] = [
      { ref: "r0", role: "generic", states: [], depth: 0 },
      { ref: "r1", role: "paragraph", states: [], depth: 1, parent: "r0" },
    ];
    expect(contextRoot(snapshotOf(nothing), "r1")?.ref).toBe("r0");
  });

  it("names every role LLD §6.2 scopes on", () => {
    for (const role of ["form", "dialog", "main", "navigation", "window"]) {
      expect(LANDMARK_ROLES as readonly string[]).toContain(role);
    }
  });

  it("takes the subtree with depths relative to the context root", () => {
    const snapshot = snapshotOf(loginNodes());
    const form = contextRoot(snapshot, "r5")!;
    const inside = subtree(snapshot, form);
    expect(inside.map((n) => n.ref)).toEqual(["r4", "r5", "r6", "r7", "r8"]);
    expect(inside.map((n) => n.depth)).toEqual([0, 1, 1, 1, 1]);
  });

  it("a change outside the context does not move the context's hash", () => {
    const snapshot = snapshotOf(loginNodes());
    const withExtraNav = snapshotOf([
      ...loginNodes(),
      { ref: "r9", role: "link", states: [], depth: 1, parent: "r0", name: "Help" } as SnapshotNode,
    ]);

    // The form is unchanged, so a binding scoped to the form is unchanged, even
    // though the page as a whole is not.
    expect(contextHash(withExtraNav, "r5").hash).toBe(contextHash(snapshot, "r5").hash);
    expect(withExtraNav.hash).not.toBe(snapshot.hash);
  });

  it("an empty snapshot hashes without throwing", () => {
    const empty = buildSnapshot("r0", [], structuralHash([]));
    expect(contextHash(empty).hash).toMatch(/^[0-9a-f]{64}$/);
    expect(contextHash(empty).root).toBeUndefined();
  });
});

describe("context patterns (REQ-REC-6)", () => {
  it("generalises identifiers out of a path", () => {
    expect(contextPattern("http://app.test/orders/10482")).toBe("/orders/:id");
    expect(contextPattern("http://app.test/orders/10483")).toBe("/orders/:id");
    expect(contextPattern("http://app.test/u/3f1b2c4d-1111-2222-3333-444455556666/edit")).toBe(
      "/u/:uuid/edit",
    );
  });

  it("drops the query and the fragment: they change what a page shows, not its shape", () => {
    expect(contextPattern("http://app.test/login?variant=3#top")).toBe("/login");
  });

  /*
   * P1-F3. A store is committed and read by everyone who clones the repository.
   * With the origin in the pattern, bindings recorded against a test server on
   * an ephemeral port matched on exactly one run — the one that recorded them —
   * and then silently stopped being the entry for that URL. Path-only is the
   * default; `matchHost` is for a project that really does bind different
   * elements on different hosts.
   */
  it("drops the origin by default, so a store survives a different port or host", () => {
    expect(contextPattern("http://127.0.0.1:65431/login")).toBe("/login");
    expect(contextPattern("http://127.0.0.1:4173/login")).toBe("/login");
    expect(contextPattern("https://staging.example.com/login")).toBe("/login");
  });

  it("keeps the origin when the project asked for it", () => {
    expect(contextPattern("https://app.test/login", { matchHost: true })).toBe(
      "https://app.test/login",
    );
    expect(
      patternMatches("https://app.test/login", "https://other.test/login", { matchHost: true }),
    ).toBe(false);
  });

  it("matches a stored pattern against a live url", () => {
    expect(patternMatches("/orders/:id", "http://app.test/orders/99")).toBe(true);
    expect(patternMatches("/login", "http://app.test/login?variant=3")).toBe(true);
    expect(patternMatches("/login", "http://app.test/checkout")).toBe(false);
  });

  it("still matches a store recorded before the default changed", () => {
    // An existing store carries full origins. It has to keep resolving, or the
    // change would break every project that recorded one.
    expect(patternMatches("http://127.0.0.1:65431/login", "http://127.0.0.1:4173/login")).toBe(true);
    expect(patternMatches("http://app.test/orders/:id", "http://elsewhere.test/orders/99")).toBe(true);
  });

  it("handles a value that is not a url at all — a window title, say", () => {
    expect(contextPattern("Yam ADE — booking.flow")).toBe("Yam ADE — booking.flow");
    expect(patternMatches("Yam ADE — booking.flow", "Yam ADE — booking.flow")).toBe(true);
  });
});
