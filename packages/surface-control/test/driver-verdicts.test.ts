/**
 * Three answers, not two (PK-03).
 *
 * Before the drivers became optional peers, `yam surface doctor` had two ways of
 * saying no: **not this host** (`uia` on a Mac) and **not configured** (no Appium
 * server, no BiDi endpoint). Neither fits the third case the split creates — the
 * adapter is here and its driver is not — and they send a person to different
 * places: one is unfixable, one wants a server started, one wants a command run.
 */
import { afterEach, describe, expect, it } from "vitest";
import { registerAdapter, unregisterAdapter } from "@svatah/yam-surface";
import { forgetProbes, probeAdapter } from "../src/probes.js";

const NAME = "appium";
afterEach(() => {
  unregisterAdapter(NAME);
  forgetProbes();
});

const register = (resolved: boolean): void => {
  unregisterAdapter(NAME);
  registerAdapter(NAME, async () => { throw new Error("not driven in this test"); },
    { name: "webdriverio", resolved, install: "npm i webdriverio" });
  forgetProbes();
};

describe("what doctor can say about an adapter", () => {
  it("says not installed, with the one command, when the driver is missing", async () => {
    register(false);
    const answer = await probeAdapter(NAME);
    expect(answer.present).toBe(false);
    expect(answer.install).toBe("npm i webdriverio");
    expect(answer.reason).toContain("not installed");
  });

  /*
   * And when the driver is there, the answer is about the *server* — which is a
   * different failure with a different fix, and the one the old two-answer
   * version conflated with a missing install.
   */
  it("says nothing about installing when the driver is present", async () => {
    register(true);
    const answer = await probeAdapter(NAME);
    expect(answer.install).toBeUndefined();
    if (!answer.present) expect(answer.reason).toContain("Appium server");
  });

  /*
   * An adapter that needs no driver is not "installed" — it simply is. Offering
   * a command for `ax` on Windows would be a lie, and `uia` on a Mac is not
   * fixed by anything a person can type.
   */
  it("offers no command for an adapter that needs nothing", async () => {
    forgetProbes();
    for (const adapter of ["ax", "uia", "atspi", "process", "http", "bidi"]) {
      const answer = await probeAdapter(adapter);
      expect(answer.install, `${adapter} offered an install command`).toBeUndefined();
    }
  });
});
