/**
 * A mismatch names the parties (PK-08).
 *
 * The broker outlives the commands that use it, and three installables can share
 * one machine: the CLI, `@svatah/yam-mcp`, and the application that stages its
 * own copy of the CLI. Whichever needs a broker first starts it, and a second
 * one finding a contract it does not recognise used to be told only that it was
 * "a different build of Yam" — true, unactionable, and immediately followed by
 * that broker's sessions being closed.
 */
import { afterEach, describe, expect, it } from "vitest";
import { brokerState, startBroker } from "../src/server.js";
import { generateToken } from "../src/broker.js";

const running: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  for (const one of running.splice(0)) await one.close();
});

const start = async (startedBy?: string) => {
  const token = generateToken();
  const broker = await startBroker({
    token,
    factory: async () => { throw new Error("no adapter in this test"); },
    registeredAdapters: [],
    ...(startedBy === undefined ? {} : { startedBy }),
  });
  running.push(broker);
  return { broker, descriptor: { url: broker.url, token, pid: process.pid } };
};

describe("a broker says who started it", () => {
  it("reports the starter on its health endpoint", async () => {
    const { descriptor } = await start("@svatah/yam-mcp 9.9.9");
    const verdict = await brokerState(descriptor);
    expect(verdict.state).toBe("serving");
    expect(verdict.startedBy).toBe("@svatah/yam-mcp 9.9.9");
  });

  /*
   * A broker that predates this is still usable; it simply cannot be named, and
   * the message has to read properly without it rather than printing
   * "undefined" at the person who has to act on it.
   */
  it("says something usable when the starter is not known", async () => {
    const { descriptor } = await start();
    const verdict = await brokerState(descriptor);
    expect(verdict.startedBy).toBe("an unnamed build of Yam");
  });

  it("carries the contract beside the starter, so both can be compared", async () => {
    const { descriptor } = await start("Yam.app 0.1.0");
    const verdict = await brokerState(descriptor);
    expect(verdict.contract).toMatch(/^[0-9a-f]{16}$/);
    expect(verdict.startedBy).toBe("Yam.app 0.1.0");
  });
});
