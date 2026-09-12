/**
 * Playwright's readiness is a property of the install, not of the directory
 * (P-W2-F5).
 *
 * The probe ran `npx --no-install playwright --version`, which asks whether a
 * *binary* is reachable from the current working directory. The service's
 * working directory is the person's project, so in a packaged application the
 * answer was always no — however well installed Playwright was. The app reported
 * the adapter unavailable, and told a person to install what was already inside
 * its own bundle, under `node_modules/.pnpm/playwright@1.62.1`.
 *
 * What the adapter does is `import "playwright"`. So that is what is checked,
 * and this is the property: the answer does not depend on where the process
 * happens to be standing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { forgetProbes, probeAdapter } from "../src/probes.js";

const HERE = process.cwd();
afterEach(() => {
  process.chdir(HERE);
  forgetProbes();
});

describe("the probe asks about the install, not the working directory", () => {
  it("answers the same from a directory with no node_modules", async () => {
    forgetProbes();
    const here = await probeAdapter("playwright");
    process.chdir(mkdtempSync(`${tmpdir()}/yam-probe-`));
    forgetProbes();
    const elsewhere = await probeAdapter("playwright");
    expect(elsewhere.present, elsewhere.reason).toBe(here.present);
    expect(elsewhere.version).toBe(here.version);
  });

  /*
   * This repository has Playwright installed, so the answer here is `true`. The
   * assertion is worth making anyway: it is the one that fails if the resolution
   * regresses to something working-directory-shaped.
   */
  it("finds the Playwright this workspace installs", async () => {
    forgetProbes();
    const answer = await probeAdapter("playwright");
    expect(answer.present, answer.reason).toBe(true);
    expect(answer.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  /*
   * The package and the browser are two questions. A message that says "install
   * a browser" when the package is missing sends somebody to the wrong command —
   * which is what the single-branch version did for every cause it had.
   */
  it("keeps the package and the browser apart in what it says", async () => {
    forgetProbes();
    const answer = await probeAdapter("playwright");
    if (answer.present) return;
    const about = answer.reason ?? "";
    expect(
      about.includes("not installed where Yam can load it") || about.includes("no browser to drive"),
      about,
    ).toBe(true);
  });
});
