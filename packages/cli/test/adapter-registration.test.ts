/**
 * Registering an adapter twice is a no-op, not a crash (T14.9, REQ-SURF-2).
 *
 * `registerAllAdapters` is idempotent through a module-local flag, which holds
 * only while there is one copy of the module. There are two: `yam explore`
 * registers from the copy bundled into `bin.js`, then hands over to
 * `@svatah/yam-mcp`, whose `buildMcpServer` registers again from the copy in
 * `@svatah/yam`'s own bundle. Two flags, one registry — so the second call
 * reached `registerAdapter` with every name already taken.
 *
 * Five adapters guarded with `hasAdapter` and survived it. The three added
 * last — `http` (T12.7), `process` (T22) and `atspi` (T23) — did not, and the
 * first of them to be reached threw `Adapter "http" is already registered`
 * before the command served a single tool. Nothing caught it because no test
 * registered twice and the only caller that does it is `yam explore`, whose
 * own leg was new.
 *
 * Per adapter rather than over `registerAllAdapters`, because the flag inside
 * that function would hide exactly the defect this is about.
 */
import { describe, expect, it } from "vitest";
import { registerAppiumAdapter } from "@svatah/yam-adapter-appium";
import { registerAtspiAdapter } from "@svatah/yam-adapter-atspi";
import { registerAxAdapter } from "@svatah/yam-adapter-ax";
import { registerBidiAdapter } from "@svatah/yam-adapter-bidi";
import { registerHttpAdapter } from "@svatah/yam-adapter-http";
import { registerPlaywrightAdapter } from "@svatah/yam-adapter-playwright";
import { registerProcessAdapter } from "@svatah/yam-adapter-process";
import { registerUiaAdapter } from "@svatah/yam-adapter-uia";
import { listAdapters } from "@svatah/yam-surface";

const REGISTER: ReadonlyArray<readonly [string, () => void]> = [
  ["playwright", registerPlaywrightAdapter],
  ["bidi", registerBidiAdapter],
  ["appium", registerAppiumAdapter],
  ["ax", registerAxAdapter],
  ["uia", registerUiaAdapter],
  ["http", registerHttpAdapter],
  ["process", registerProcessAdapter],
  ["atspi", registerAtspiAdapter],
];

describe("an adapter registers twice without throwing", () => {
  for (const [name, register] of REGISTER) {
    it(`${name} — the second call is a no-op`, () => {
      register();
      expect(listAdapters()).toContain(name);
      expect(() => register()).not.toThrow();
      expect(listAdapters().filter((one) => one === name)).toHaveLength(1);
    });
  }

  /*
   * The whole set, in the order `yam explore` reaches it: the first unguarded
   * name is the one that throws, so a per-adapter case alone would pass on a
   * build where only the last of the eight regressed.
   */
  it("every adapter is registered twice in one process", () => {
    for (const [, register] of REGISTER) register();
    expect(() => {
      for (const [, register] of REGISTER) register();
    }).not.toThrow();
  });
});
