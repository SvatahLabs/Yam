/**
 * The artboards fit their frames (T11.1, P10-F4, LLD §13.7).
 *
 * The Phase 10 verification approved the four new artboards "with two changes",
 * and both were things a person had to *look at a picture* to see: the Explorer
 * toolbar wrapped its title and its buttons onto two lines, and the Data
 * inspector's "Read by" table ran past the inspector's right edge. Neither is
 * visible in the HTML; both are one question to a browser.
 *
 * So the reading is a command now — `pnpm artboards` — and this is the check
 * that keeps it green. The rules are the ones the *build* is held to in
 * `apps/ade/test/shell.spec.ts`: a toolbar is one row with nothing past its end
 * and a title that keeps twelve characters, an inspector's contents are inside
 * the inspector, and nothing is past the edge of the 1440 px frame.
 *
 * Every rule is shown to bite, against an artboard written to break exactly one
 * of them — an audit that answers "fine" to a good design and "fine" to a bad
 * one has said nothing.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromRoot, REPO_ROOT } from "../src/repo.js";

const AUDIT = fromRoot("scripts/audit-artboards.mjs");
const ARTBOARDS = fromRoot("docs/spec/design/artboards");

/** Run the audit over one directory of artboards and hand back what it said. */
function audit(directory?: string): { status: number; output: string } {
  const ran = spawnSync(
    process.execPath,
    [AUDIT, ...(directory === undefined ? [] : ["--artboards", directory])],
    { encoding: "utf8", cwd: REPO_ROOT, timeout: 300_000 },
  );
  return { status: ran.status ?? 1, output: `${ran.stdout ?? ""}${ran.stderr ?? ""}` };
}

const made: string[] = [];
const scratch = (): string => {
  const one = mkdtempSync(join(tmpdir(), "svatah-artboards-"));
  made.push(one);
  return one;
};
afterEach(() => {
  while (made.length > 0) rmSync(made.pop()!, { recursive: true, force: true });
});

/** One artboard with a workspace, a toolbar and an inspector, and nothing wrong. */
const SOUND = `<div class="app">
@@TOPBAR(Test)
@@SIDEBAR(flows)
<section class="workspace">
  <div class="toolbar"><h1>A sound artboard</h1><span class="sub">nothing is out of place</span><div class="spacer"></div>
    <button class="btn">One</button><button class="btn primary">Two</button>
  </div>
  <div class="main"><aside class="list" aria-label="List"><div class="group">a row</div></aside></div>
</section>
<aside class="inspector" aria-label="Inspector"><h2>Inspector</h2><p style="padding:0 16px">A sentence.</p></aside>
@@STATUS(<span>ok</span>)
</div>
`;

const write = (directory: string, name: string, body: string): void =>
  writeFileSync(join(directory, name), body, "utf8");

describe("the committed artboards fit their frames (P10-F4)", () => {
  it("has the audit and the artboards to run it over", () => {
    expect(existsSync(AUDIT), "scripts/audit-artboards.mjs is missing").toBe(true);
    expect(existsSync(ARTBOARDS), "docs/spec/design/artboards is missing").toBe(true);
  });

  it("passes on every artboard, and says how many it read", () => {
    const ran = audit();
    // Playwright's browser is not installed: say so rather than pass silently.
    if (ran.status === 2) {
      expect(ran.output).toContain("pnpm browsers");
      return;
    }
    expect(ran.status, ran.output).toBe(0);
    expect(ran.output).toMatch(/\d+ artboard\(s\) fit their frames\./);
    // The two the Phase 10 verification named, by name.
    expect(ran.output).toContain("ok    Explorer.html");
    expect(ran.output).toContain("ok    Data.html");
  }, 300_000);
});

describe("every rule the audit has bites (P10-F4)", () => {
  const skipUnlessBrowser = (ran: { status: number; output: string }): boolean => {
    if (ran.status !== 2) return false;
    process.stderr.write("Playwright's browser is not installed; run `pnpm browsers`.\n");
    return true;
  };

  it("a sound artboard passes, which is what makes the rest mean something", () => {
    const directory = scratch();
    write(directory, "Sound.html", SOUND);
    const ran = audit(directory);
    if (skipUnlessBrowser(ran)) return;
    expect(ran.status, ran.output).toBe(0);
  }, 300_000);

  it("catches a toolbar that wraps (the Explorer finding)", () => {
    const directory = scratch();
    write(
      directory,
      "Wrapped.html",
      SOUND.replace(
        '<div class="toolbar">',
        '<div class="toolbar" style="flex-wrap: wrap; height: auto">',
      ).replace(
        "<button class=\"btn\">One</button>",
        "<button class=\"btn\">A button with a very long label indeed</button>".repeat(6),
      ),
    );
    const ran = audit(directory);
    if (skipUnlessBrowser(ran)) return;
    expect(ran.status, ran.output).toBe(1);
    expect(ran.output).toMatch(/toolbar is \d+px tall, so it has wrapped/);
  }, 300_000);

  it("catches a title cut below twelve characters (Draft 2.13)", () => {
    const directory = scratch();
    write(
      directory,
      "Squeezed.html",
      SOUND.replace(
        "<h1>A sound artboard</h1>",
        '<h1 style="min-width:0;max-width:18px">A title far too long for eighteen pixels</h1>',
      ),
    );
    const ran = audit(directory);
    if (skipUnlessBrowser(ran)) return;
    expect(ran.status, ran.output).toBe(1);
    expect(ran.output).toMatch(/is cut to \d+ characters/);
  }, 300_000);

  it("catches an inspector whose contents run past its edge (the Data finding)", () => {
    const directory = scratch();
    write(
      directory,
      "Spilled.html",
      SOUND.replace(
        "<p style=\"padding:0 16px\">A sentence.</p>",
        '<p style="width:900px;white-space:nowrap">A line far too wide for a 360px inspector</p>',
      ),
    );
    const ran = audit(directory);
    if (skipUnlessBrowser(ran)) return;
    expect(ran.status, ran.output).toBe(1);
    expect(ran.output).toContain("past the inspector's edge");
  }, 300_000);

  it("catches anything at all past the frame's right edge", () => {
    const directory = scratch();
    write(
      directory,
      "Overhanging.html",
      SOUND.replace(
        '<div class="group">a row</div>',
        '<div class="group" style="position:relative;left:1600px;width:200px">out of the frame</div>',
      ),
    );
    const ran = audit(directory);
    if (skipUnlessBrowser(ran)) return;
    expect(ran.status, ran.output).toBe(1);
    expect(ran.output).toContain("past the right edge of the artboard");
  }, 300_000);
});
