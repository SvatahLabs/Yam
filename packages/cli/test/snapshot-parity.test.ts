/**
 * Two adapters, one snapshot shape (T4.1, REQ-SURF-4).
 *
 * > `snapshot()` output is normalised across adapters: roles, names, states, and
 * > a reference scheme with the same shape whether the source is ARIA, UIA, AX,
 * > AT-SPI or Appium page source.
 *
 * The BiDi adapter's injected walker is a *port* of the Playwright fallback's
 * (LLD §7.3), copied rather than imported so that the independence proof does
 * not depend on the thing it is proving independence from. What keeps the copy
 * honest is not that it stays byte-identical — it is free to diverge where BiDi
 * needs it to — but this: both adapters are driven over the same pages and
 * required to report the same roles, names and states.
 *
 * It lives in `@svatah/yam` because the CLI is the one package LLD §1 allows to
 * import every adapter. Putting it in either adapter would put the other one in
 * that adapter's dependency tree.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startSampleApp, type SampleServer } from "sample-web";
import { bidiAvailable, BidiSurface } from "@svatah/yam-adapter-bidi";
import { PlaywrightSurface } from "@svatah/yam-adapter-playwright";
import type { AgentSurface, SnapshotNode } from "@svatah/yam-surface";

const available = bidiAvailable();
const describeWithBidi = available ? describe : describe.skip;

if (!available) {
  console.warn(
    "snapshot parity: no WebDriver BiDi endpoint and no Gecko browser, so the cross-adapter " +
      "comparison is skipped. `pnpm browsers` downloads one, or set YAM_BIDI_URL.",
  );
}

/** The pages the fixtures and the conformance suite actually bind against. */
const PAGES = ["/", "/login", "/dashboard", "/widgets", "/checkout"];

let app: SampleServer;
const opened: AgentSurface[] = [];

/**
 * What a snapshot says about a page, with the parts that are legitimately an
 * adapter's own removed.
 *
 * References are explicitly "opaque above the surface" and "stable within the
 * snapshot" (LLD §2.2), so requiring `r7` to be the same element in both would
 * be requiring something the contract does not promise. Boxes are the renderer's
 * — two browsers lay out the same page to different pixels — and `native` is
 * documented as adapter-specific. Roles, names and states are the contract, and
 * they are what REQ-SURF-4 normalises.
 */
function comparable(nodes: readonly SnapshotNode[]): string[] {
  return nodes
    .filter((n) => !n.states.includes("hidden"))
    .map((n) => `${n.role}|${n.name ?? ""}|${[...n.states].sort().join(",")}`);
}

async function snapshotOf(surface: AgentSurface, path: string): Promise<string[]> {
  await surface.act("navigate", undefined, { url: path });
  return comparable((await surface.snapshot()).nodes);
}

beforeAll(async () => {
  if (!available) return;
  app = await startSampleApp(0);
}, 180_000);

afterAll(async () => {
  for (const surface of opened) await surface.close().catch(() => undefined);
  await app?.close();
});

describeWithBidi("Playwright and BiDi report the same tree (REQ-SURF-4)", () => {
  it("agrees on every role, name and state, on every page the fixtures use", async () => {
    const playwright = new PlaywrightSurface({
      headless: true,
      timeoutMs: 15_000,
      // The own-refs walker, which is the mechanism BiDi's script is a port of.
      // Comparing against Playwright's *internal* ARIA snapshot instead would be
      // comparing two different things and calling the difference a defect.
      snapshotMechanism: "own",
      testIdAttributes: ["data-testid"],
    });
    const bidi = new BidiSurface({ headless: true, timeoutMs: 15_000, testIdAttributes: ["data-testid"] });
    opened.push(playwright, bidi);

    await playwright.open({ baseUrl: app.origin });
    await bidi.open({ baseUrl: app.origin });

    const differences: string[] = [];
    for (const page of PAGES) {
      const left = await snapshotOf(playwright, page);
      const right = await snapshotOf(bidi, page);
      if (left.length === 0) differences.push(`${page}: the Playwright snapshot was empty`);
      if (JSON.stringify(left) !== JSON.stringify(right)) {
        const onlyLeft = left.filter((n) => !right.includes(n));
        const onlyRight = right.filter((n) => !left.includes(n));
        differences.push(
          `${page}: ${left.length} vs ${right.length} nodes\n` +
            `  only Playwright: ${onlyLeft.slice(0, 8).join(" · ") || "(none)"}\n` +
            `  only BiDi:       ${onlyRight.slice(0, 8).join(" · ") || "(none)"}`,
        );
      }
    }

    expect(differences.join("\n")).toBe("");
  }, 300_000);

  it("agrees on what describe() reports for the same element", async () => {
    // Synthesis and fingerprinting read `describe()` and nothing else (LLD §3.3),
    // so a binding recorded through one adapter can only resolve through the
    // other if the two describe an element the same way.
    const playwright = new PlaywrightSurface({
      headless: true,
      timeoutMs: 15_000,
      snapshotMechanism: "own",
      testIdAttributes: ["data-testid"],
    });
    const bidi = new BidiSurface({ headless: true, timeoutMs: 15_000, testIdAttributes: ["data-testid"] });
    opened.push(playwright, bidi);
    await playwright.open({ baseUrl: app.origin });
    await bidi.open({ baseUrl: app.origin });

    for (const surface of [playwright, bidi] as AgentSurface[]) {
      await surface.act("navigate", undefined, { url: "/login" });
    }

    const [left] = await playwright.locate({ by: "id", value: "password", score: 1 });
    const [right] = await bidi.locate({ by: "id", value: "password", score: 1 });
    const a = await playwright.describe(left!);
    const b = await bidi.describe(right!);

    // Everything but the reference, the box and the paths `native` carries: the
    // first is opaque by contract, the second is the renderer's, and the third
    // is a string built from a DOM two browsers may have laid out differently.
    expect({ role: b.role, name: b.name, tag: b.tag, text: b.text, index: b.index }).toEqual({
      role: a.role,
      name: a.name,
      tag: a.tag,
      text: a.text,
      index: a.index,
    });
    expect(b.attrs).toEqual(a.attrs);
    expect(b.rolePath).toEqual(a.rolePath);
    expect([...b.states].sort()).toEqual([...a.states].sort());
    expect(b.neighbours).toEqual(a.neighbours);
  }, 300_000);
});
