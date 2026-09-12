/**
 * No test names a screen the model does not have (TV-02).
 *
 * Draft 2.27 merged Surfaces and Record into one `session` screen with three
 * modes, and the ids were removed outright. `apps/desktop/test/shell.spec.ts`
 * went on asking for `#palette-go-record` and `goTo("surfaces", …)`, and the
 * first person to run it after packaging an app watched Playwright sit on an
 * open command palette waiting for a row that does not exist.
 *
 * It survived because that suite skips itself when `apps/desktop/out/` has no
 * packaged build — for good reasons, stated in the file — and nobody had
 * packaged one for a wave. Every full run reported "38 skipped" and exited zero,
 * which looks exactly like passing in a scrolling log.
 *
 * So the rule is checked *statically*, where no build is needed and no skip can
 * hide it: a screen id in a locator or a navigation call has to be one the model
 * actually has. This is the cheap half of a check that otherwise costs a package
 * step, and it is the half that would have caught this.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SCREEN_IDS } from "@svatah/yam-screens";
import { fromRoot, REPO_ROOT } from "../src/repo.js";

/**
 * The code, without the prose.
 *
 * This file's own comment naming `goTo("surfaces", …)` — explaining the defect —
 * was the first thing the check reported. A stale id in a sentence about a stale
 * id is not a locator that can never match.
 */
function code(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** Every `.ts`/`.tsx` under a directory, recursively. */
function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === "dist" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

/*
 * The shapes a screen id is written in. Each is an id the *renderers generate*
 * from `SCREEN_IDS`, so a stale one is a locator that can never match.
 */
const PATTERNS: ReadonlyArray<{ readonly what: string; readonly find: RegExp }> = [
  { what: "a palette Go-to row", find: /#palette-go-([a-z-]+)/g },
  { what: "a rail item", find: /#rail-([a-z-]+)/g },
  { what: "a goTo call", find: /\bgoTo\(\s*"([a-z-]+)"/g },
  /*
   * Bare, as well as with the `#`.
   *
   * The first version of this matched `#rail-…` only, and missed
   * `for (const id of ["rail-surfaces", …]) … locator(`#${id}`)` — where the
   * `#` is added by a template and the id is a plain string in an array. Which
   * is exactly where the stale one was. A locator is assembled as often as it is
   * written out.
   */
  { what: "a rail id", find: /"rail-([a-z-]+)"/g },
  { what: "a palette Go-to id", find: /"palette-go-([a-z-]+)"/g },
];

/**
 * The rail's sections, which are not screens and have their own list.
 *
 * `#section-surfaces` went stale in the same commit and for the same reason, so
 * it is checked here rather than in a second file.
 */
const SECTION_IDS = ["session", "automations", "activity", "settings"] as const;

/**
 * Ids a test names in order to assert they are *absent*.
 *
 * `the legacy screens are gone (T10.3)` asks for `#rail-legacy` and expects a
 * count of zero — the opposite of a stale locator, and the one case where
 * naming something the model does not have is the point. Listed rather than
 * inferred: a rule that tried to read `toHaveCount(0)` out of a loop would be
 * guessing, and this is two words.
 */
const ASSERTED_GONE = ["legacy"] as const;

describe("every screen id a test names is one the model has", () => {
  const files = [
    ...sources(fromRoot("apps/desktop/test")),
    ...sources(fromRoot("packages/tui/test")),
    ...sources(fromRoot("tools/repo-checks/test")).filter((one) => !one.endsWith("screen-ids.test.ts")),
  ];

  it("finds no locator for a screen that was removed", () => {
    const stale: string[] = [];
    for (const file of files) {
      const text = code(readFileSync(file, "utf8"));
      for (const { what, find } of PATTERNS) {
        for (const match of text.matchAll(new RegExp(find))) {
          const id = match[1] as string;
          if (
            !(SCREEN_IDS as readonly string[]).includes(id) &&
            !(ASSERTED_GONE as readonly string[]).includes(id)
          ) {
            stale.push(`${file.replace(REPO_ROOT, "")}: ${what} for "${id}"`);
          }
        }
      }
    }
    expect(stale, stale.join("\n")).toEqual([]);
  });

  it("finds no locator for a rail section that was renamed", () => {
    const stale: string[] = [];
    for (const file of files) {
      const text = code(readFileSync(file, "utf8"));
      for (const match of text.matchAll(/["#]section-([a-z-]+)["`\s)]/g)) {
        const id = match[1] as string;
        if (!(SECTION_IDS as readonly string[]).includes(id)) {
          stale.push(`${file.replace(REPO_ROOT, "")}: a section id for "${id}"`);
        }
      }
    }
    expect(stale, stale.join("\n")).toEqual([]);
  });

  /*
   * The check is only worth anything if it is looking at the files. A refactor
   * that moved the desktop spec would otherwise leave this passing over nothing.
   */
  it("is looking at the suites that navigate", () => {
    expect(files.some((one) => one.endsWith("shell.spec.ts"))).toBe(true);
    expect(files.length).toBeGreaterThan(5);
  });
});
