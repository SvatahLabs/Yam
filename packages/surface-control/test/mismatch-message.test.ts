/**
 * Three installables, one broker, two contracts (PK-07, PK-08).
 *
 * The broker is one process per machine and outlives the commands that use it,
 * so on a machine with `@svatah/yam`, `@svatah/yam-mcp` and Yam.app, whichever
 * needs one first starts it. While the contract has not moved they interoperate,
 * because the fingerprint is derived from the shape and not the version — and
 * the moment it has, a client refuses rather than sending an argument the other
 * has never heard of and being told `succeeded`.
 *
 * The refusal is correct. What it says is the thing PK-08 is about: "a different
 * build of Yam" cannot be acted on when three of them are installed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { brokerState, startBroker } from "../src/server.js";
import { generateToken } from "../src/broker.js";
import { catalogueFingerprint } from "@svatah/yam-contract";

const running: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  for (const one of running.splice(0)) await one.close();
});

const start = async (startedBy: string) => {
  const token = generateToken();
  const broker = await startBroker({
    token,
    factory: async () => { throw new Error("not driven in this test"); },
    registeredAdapters: [],
    startedBy,
  });
  running.push(broker);
  return { url: broker.url, token, pid: process.pid };
};

describe("what a second installable finds", () => {
  it("serves a client that speaks the same contract, whoever started it", async () => {
    for (const who of ["@svatah/yam 0.1.0", "@svatah/yam-mcp 0.1.0", "Yam.app 0.1.0"]) {
      const descriptor = await start(who);
      const verdict = await brokerState(descriptor);
      expect(verdict.state, `${who} started a broker this client refused`).toBe("serving");
      expect(verdict.contract).toBe(catalogueFingerprint());
      expect(verdict.startedBy).toBe(who);
    }
  });

  /*
   * The message a person has to act on. It is built from the verdict, so this
   * asserts the verdict carries what the message needs — both parties and both
   * contracts — rather than asserting a sentence somebody could reword.
   */
  it("carries enough to say which of the three to update", async () => {
    const descriptor = await start("Yam.app 0.1.0");
    const verdict = await brokerState(descriptor);
    expect(verdict.startedBy, "the message cannot name the broker's starter").toBeDefined();
    expect(verdict.contract, "the message cannot compare contracts").toBeDefined();
    /* And this build can name itself, which is the other half of the sentence. */
    expect(catalogueFingerprint()).toMatch(/^[0-9a-f]{16}$/);
  });

  /*
   * A version bump that does not move the contract must not orphan the machine's
   * sessions, or every patch release would. This is the property the whole
   * three-installable shape rests on.
   */
  it("does not depend on the version", async () => {
    const one = await start("@svatah/yam 0.1.0");
    const two = await start("@svatah/yam 9.9.9");
    expect((await brokerState(one)).contract).toBe((await brokerState(two)).contract);
  });
});
