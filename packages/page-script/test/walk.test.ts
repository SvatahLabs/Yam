/**
 * The contract two adapters now share (REQ-SURF-4, Draft 2.29).
 *
 * `walkDocument` was `adapter-bidi`'s and exercised only through a live
 * browser — its own suite and `snapshot-parity.test.ts`, which drive it and the
 * Playwright adapter over the same pages and require the same answers. Both are
 * the right checks and neither runs without a browser, so the mapping itself
 * had no test at the size you can read.
 *
 * It has two callers now: the BiDi adapter, and the Appium adapter evaluating
 * it in a webview. A regression here is a regression in both, which is the
 * argument for driving it directly as well.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { walkDocument, REGISTRY, type RawNode } from "../src/index.js";

const OPTIONS = {
  registry: REGISTRY,
  maxNodes: 200,
  interactiveOnly: false,
  testIdAttributes: ["data-testid"],
  ignoreAttributes: [] as string[],
  rootIndex: null,
};

const walk = (html: string, over: Partial<typeof OPTIONS> = {}): RawNode[] => {
  document.body.innerHTML = html;
  return walkDocument({ ...OPTIONS, ...over });
};

const find = (nodes: readonly RawNode[], role: string, name?: string): RawNode | undefined =>
  nodes.find((one) => one.role === role && (name === undefined || one.name === name));

describe("the DOM walked into the snapshot of LLD §2.2", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("maps tags onto the ARIA role vocabulary", () => {
    const nodes = walk(`
      <nav><a href="/in">Sign in</a></nav>
      <h1>Deterministic automation</h1>
      <button type="button">Save flow</button>
      <input type="checkbox" aria-label="Remember me">
    `);
    expect(find(nodes, "navigation")).toBeDefined();
    expect(find(nodes, "heading", "Deterministic automation")).toBeDefined();
    expect(find(nodes, "link", "Sign in")).toBeDefined();
    expect(find(nodes, "button", "Save flow")).toBeDefined();
    expect(find(nodes, "checkbox", "Remember me")).toBeDefined();
  });

  /*
   * The name a screen reader would say, not the `name` attribute. Reading the
   * attribute is what the Appium adapter did while it put Chrome's HTML through
   * an Android XML walker, and `login.describe` reported the role `generic` and
   * the name `password` for a field labelled "Password".
   */
  it("takes the accessible name from the label, not from the name attribute", () => {
    const nodes = walk(`
      <label for="pw">Password</label>
      <input id="pw" name="password" type="password">
    `);
    const field = find(nodes, "textbox");
    expect(field?.name).toBe("Password");
  });

  it("reports the states a predicate can ask about", () => {
    const nodes = walk(`
      <input type="text" aria-label="Username" required>
      <input type="checkbox" aria-label="Keep me" checked>
      <input type="checkbox" aria-label="Not me">
      <button type="button" disabled>Send</button>
    `);
    expect(find(nodes, "textbox", "Username")?.states).toContain("required");
    expect(find(nodes, "checkbox", "Keep me")?.states).toContain("checked");
    expect(find(nodes, "checkbox", "Not me")?.states).toContain("unchecked");
    expect(find(nodes, "button", "Send")?.states).toContain("disabled");
  });

  it("gives every node a reference and registers it in the page", () => {
    const nodes = walk(`<button type="button">Run</button>`);
    const run = find(nodes, "button", "Run");
    expect(run?.ref).toMatch(/^r\d+$/);
    const registry = (globalThis as unknown as Record<string, Element[] | undefined>)[REGISTRY];
    expect(registry?.[Number(run!.ref.slice(1))]?.textContent).toBe("Run");
  });

  it("keeps the controls when asked for those only, and drops the prose", () => {
    const nodes = walk(
      `<p>Some prose nobody clicks</p><button type="button">Run</button>`,
      { interactiveOnly: true },
    );
    expect(find(nodes, "button", "Run")).toBeDefined();
    expect(nodes.some((one) => one.name === "Some prose nobody clicks")).toBe(false);
  });

  it("stops at maxNodes rather than walking a page without end", () => {
    const many = Array.from({ length: 50 }, (_, i) => `<button>B${i}</button>`).join("");
    expect(walk(many, { maxNodes: 10 }).length).toBeLessThanOrEqual(10);
  });
});
