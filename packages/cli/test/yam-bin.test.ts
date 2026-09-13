/**
 * The broker is spawned from *this* package's binary (PK-05).
 *
 * `yamBin()` preferred `process.argv[1]` whenever it ended in `bin.js` or
 * `yam`, on the reasoning that a process already running as `yam` knows where
 * `yam` is. That was true while there was one binary.
 *
 * `@svatah/yam-mcp`'s entry point is also called `bin.js`. So when an agent's
 * MCP server was the first thing to need a broker, it spawned **itself** —
 * `node …/yam-mcp/dist/bin.js surface broker` — which starts a second MCP
 * server, finds its stdin closed because the spawn ignores stdio, and exits 0.
 * What the caller prints is "The surface broker exited with 0 instead of
 * starting", and the agent cannot connect to anything at all unless a broker
 * happens to be running already.
 *
 * Found by a person starting `npx @svatah/yam-mcp` and asking an agent to use
 * it. Nothing in the suites took that path: every one of them starts a broker
 * from the CLI first, deliberately, because on macOS the Accessibility grant
 * belongs to whichever program starts it (`evals/self/yam-on-yam/run.mjs`
 * explains this at its top). A precaution about permissions hid a defect about
 * executables.
 */
import { afterEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { yamBin } from "../src/commands/ui.js";

const real = process.argv[1];
afterEach(() => {
  process.argv[1] = real!;
});

describe("which executable a broker is spawned from", () => {
  it("is this package's own bin, whatever is running", () => {
    /* The exact shape that broke it: another package's entry, also `bin.js`. */
    process.argv[1] = "/somewhere/node_modules/@svatah/yam-mcp/dist/bin.js";
    const chosen = yamBin();
    expect(chosen, "the MCP server would spawn itself as the broker").not.toContain("yam-mcp");
    expect(basename(chosen)).toBe("bin.js");
    expect(existsSync(chosen), `${chosen} does not exist`).toBe(true);
  });

  it("is the CLI's, and not a test runner's entry either", () => {
    process.argv[1] = "/usr/local/lib/node_modules/vitest/vitest.mjs";
    const chosen = yamBin();
    expect(chosen).not.toContain("vitest");
    expect(existsSync(chosen)).toBe(true);
  });

  it("names a file that answers as the command line", () => {
    /*
     * The one property that matters: what is spawned has to be the `yam`
     * executable. `dist/bin.js` beside the CLI's own `dist/index.js` is that
     * file — a check of the path rather than of a spawn, because spawning it
     * here would start a broker this suite did not ask for.
     */
    const chosen = yamBin();
    expect(existsSync(join(dirname(chosen), "index.js")), `${chosen} has no sibling index.js`).toBe(
      true,
    );
  });
});
