/**
 * `yam surface doctor` covers every adapter, not the two desktop ones
 * (native-feedback D7).
 *
 * Readiness for the other six lived only in `probeAdapter`, which `surface
 * targets` and the support matrix read — so there were two readiness reporters
 * with different coverage, and every diagnostic pointed a stuck reader at the
 * narrower one. Someone whose first run failed for want of a browser was sent
 * to a command that had nothing to say about browsers.
 *
 * These cases use `http`, whose probe is `fetch` existing and spawns no
 * process, so the assertions are about this command rather than about what
 * happens to be installed on the machine running the suite.
 */
import { describe, expect, it } from "vitest";
import { EXIT } from "@svatah/yam-bindings-cli";
import { listAdapters } from "@svatah/yam-surface";
import { main, registerAllAdapters } from "../src/index.js";
import { ADAPTERS } from "../src/commands/surface-doctor.js";

async function cli(...argv: string[]): Promise<{ code: number; out: string; err: string }> {
  let out = "";
  let err = "";
  const code = await main(argv, {
    out: (text) => (out += `${text}\n`),
    err: (text) => (err += `${text}\n`),
  });
  return { code, out, err };
}

describe("surface doctor asks about every adapter (native-feedback D7)", () => {
  it("answers for an adapter that is not ax or uia", async () => {
    const { code, out } = await cli("surface", "doctor", "--adapter", "http");
    expect(code).toBe(EXIT.ok);
    expect(out).toContain("http/reachable");
  });

  it("refuses a name that is not an adapter, and lists the ones that are", async () => {
    const { code, err } = await cli("surface", "doctor", "--adapter", "chrome");
    expect(code).toBe(EXIT.usage);
    expect(err).toContain('"chrome" is not an adapter');
    for (const adapter of ["playwright", "bidi", "ax", "uia", "atspi", "process", "http", "appium"]) {
      expect(err).toContain(adapter);
    }
  });

  it("reports the host and the runtime whichever adapter was asked for", async () => {
    const { out } = await cli("surface", "doctor", "--adapter", "http");
    expect(out).toContain("-/platform");
    expect(out).toContain("app/node-runtime");
  });

  it("keeps the JSON shape the desktop gate parses", async () => {
    /*
     * `scripts/desktop-conformance.mjs` finds its check by `adapter` and
     * `name`, so those two fields are a contract and not a rendering choice.
     */
    const { out } = await cli("surface", "doctor", "--adapter", "http", "--json");
    const parsed = JSON.parse(out) as { checks: Array<{ adapter: string; name: string; ok: boolean }> };
    expect(parsed.checks.some((one) => one.adapter === "http" && one.name === "reachable")).toBe(true);
    for (const check of parsed.checks) {
      expect(typeof check.adapter).toBe("string");
      expect(typeof check.name).toBe("string");
      expect(typeof check.ok).toBe("boolean");
    }
  });

  it("asks about every adapter Yam registers, with nothing left out", () => {
    /*
     * The invariant, stated against the registry rather than against a live
     * run: an adapter added to `registerAllAdapters` and forgotten here would
     * be invisible to the one command a stuck reader is sent to.
     *
     * Asserted from the two lists rather than by running an unfiltered doctor,
     * which asks the network — an Appium `/status`, a BiDi endpoint — and
     * spawns `npx playwright --version`. That took ten seconds and added load
     * to a suite whose slowest cases are already timing-sensitive, to prove
     * something these two lists prove exactly.
     */
    registerAllAdapters();
    expect([...ADAPTERS].sort()).toEqual([...listAdapters()].sort());
  });

  it("does not fail a machine for the servers it has not started", async () => {
    /*
     * A laptop with no Appium server is an ordinary laptop. A bare run that
     * exited 1 on it would teach everyone to ignore this command's exit code —
     * so reachability is advisory until an adapter is named with `--adapter`,
     * which is a declaration of intent and stays fatal.
     */
    const { out, code } = await cli("surface", "doctor", "--adapter", "appium", "--json");
    const parsed = JSON.parse(out) as {
      checks: Array<{ adapter: string; name: string; ok: boolean; advisory?: boolean }>;
    };
    const reachable = parsed.checks.find((one) => one.adapter === "appium" && one.name === "reachable");
    expect(reachable).toBeDefined();
    // Named, so it is fatal; and never advisory, which is what makes it so.
    expect(reachable?.advisory).toBeUndefined();
    expect(code).toBe(reachable?.ok === true ? EXIT.ok : EXIT.failed);
  });

});
