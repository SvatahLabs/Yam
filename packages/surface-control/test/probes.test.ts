/**
 * Readiness is asked of the host, not looked up in a table (T23, SF-09, SF-23).
 *
 * The gap this closes is one wave 4's own coverage report named:
 *
 * > Neither is `available: true`, which means registered and on a matching
 * > platform — a claim about this machine, not about the adapter.
 *
 * `appium: available` on a machine with no Appium server; `bidi: available`
 * with no browser started with a BiDi endpoint. Both were true statements about
 * a `Record<string, string[]>` and false statements about the host, and SF-09
 * asks readiness to report "adapter version, readiness and reasons for
 * unavailable operations" — of which there was no version at all.
 *
 * These cases are about the *shape* of an answer rather than about this
 * machine's, because a suite that asserted "appium is unavailable" would fail
 * on a machine where somebody had started one — which would be the table
 * mistake all over again, with the sides swapped.
 */
import { describe, expect, it, beforeEach } from "vitest";
import { probeAdapter, forgetProbes, DRIVEN_RANGES } from "../src/probes.js";
import { probeAdapters, checkAdapterReadiness } from "../src/discovery.js";

const REGISTERED = ["playwright", "bidi", "appium", "ax", "uia", "http", "process", "atspi"];

beforeEach(() => {
  forgetProbes();
});

describe("a probe answers with what the host said", () => {
  it("either finds the thing and names its version, or says what it looked for", async () => {
    for (const adapter of REGISTERED) {
      const probe = await probeAdapter(adapter);
      if (probe.present) {
        expect(probe.version, `${adapter} is present, so it has a version`).toBeTruthy();
      } else {
        expect(probe.reason, `${adapter} is absent, so it says why`).toBeTruthy();
      }
    }
  }, 120_000);

  it("carries the versions this repository has driven, for every adapter", async () => {
    for (const adapter of REGISTERED) {
      expect((await probeAdapter(adapter)).range, `${adapter} has a driven range`).toBe(
        DRIVEN_RANGES[adapter],
      );
    }
  }, 120_000);

  it("says there is no probe for a name nobody registered", async () => {
    const probe = await probeAdapter("nothing-like-this");
    expect(probe.present).toBe(false);
    expect(probe.reason).toContain("no probe");
  });

  it("is cached, so `doctor` asking for all of them costs one round of spawns", async () => {
    const first = await probeAdapter("http");
    const second = await probeAdapter("http");
    expect(second).toBe(first);
  });
});

describe("readiness with the host asked (SF-09)", () => {
  it("no longer calls an adapter available on the strength of the platform alone", async () => {
    const probed = await probeAdapters(REGISTERED);
    for (const row of probed) {
      /*
       * The rule, stated as a rule rather than as this machine's answer:
       * `available` is now exactly "registered, and the probe found it". A row
       * that is available names a version; a row that is not names a reason.
       */
      expect(row.available).toBe(row.registered && row.probe?.present === true);
      if (row.available) expect(row.probe?.version).toBeTruthy();
      else expect(row.reason, `${row.adapter} says why not`).toBeTruthy();
    }
  }, 120_000);

  it("keeps the cheap table answer for the path a connect is on", () => {
    /*
     * `checkAdapterReadiness` stays synchronous and table-based on purpose: it
     * is on the path of every `connect`, and a probe there would put a process
     * spawn in front of every session. The adapter refuses with its own
     * sentence a moment later, which is the answer that matters.
     */
    const row = checkAdapterReadiness("uia", REGISTERED);
    expect(row.registered).toBe(true);
    expect(row).not.toHaveProperty("probe");
  });

  it("reports every adapter, including the ones this host cannot run", async () => {
    const names = (await probeAdapters(REGISTERED)).map((one) => one.adapter);
    for (const adapter of REGISTERED) expect(names).toContain(adapter);
  }, 120_000);

  it("gives the new adapters a platform row rather than leaving them out", async () => {
    const rows = await probeAdapters(REGISTERED);
    expect(rows.find((one) => one.adapter === "process")?.platform).toEqual(["darwin", "linux"]);
    expect(rows.find((one) => one.adapter === "atspi")?.platform).toEqual(["linux"]);
  }, 120_000);

  it("names the prerequisites of an adapter this host cannot run", async () => {
    const atspi = (await probeAdapters(REGISTERED)).find((one) => one.adapter === "atspi");
    expect(atspi?.prerequisites?.join(" ")).toMatch(/at-spi2-registryd/u);
  }, 120_000);
});
