// @vitest-environment jsdom
/**
 * What a screen reader hears (`EX-03`, `AX-09`, `AX-10`, wave E2).
 *
 * Three findings from the walkthrough of 2026-09-11, each read out of the
 * packaged window's own accessibility tree:
 *
 *   * `B12` — `INSPECTOR`, `CONNECT AN AGENT`, `BROWSER`, `API`, `NATIVE APP`
 *     and `DEVICE` arrived in capitals. Some screen readers spell those out.
 *   * `B13`, `B14` — the heading outline was flat, and one heading was
 *     published without being drawn.
 *   * `B15` — six tables, fifteen rows and a hundred and six cells existed on a
 *     screen where nothing was connected.
 *
 * Two of the three are checkable here, because they are structure. The capitals
 * are not: jsdom loads no stylesheet, and the defect is that **Chromium puts
 * `text-transform` into the accessible name** — so the check for that one is of
 * the stylesheets, plus the walkthrough itself (`EX-N1`, wave E5).
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  actionsForScreen,
  fakeService,
  screenById,
  type FakeResponses,
  type SessionState,
} from "@svatah/yam-screens";
import { SessionScreen, SessionInspector } from "../src/renderer/shell/Session.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const FIXTURES = JSON.parse(
  readFileSync(join(ROOT, "packages", "screens", "test", "fixtures", "fixtures-project.json"), "utf8"),
) as FakeResponses;

const SHEETS = [
  join(ROOT, "packages", "ui", "ui.css"),
  join(HERE, "..", "src", "renderer", "shell", "shell.css"),
];

afterEach(cleanup);

async function session(): Promise<SessionState> {
  return (await screenById("session").load(fakeService(FIXTURES), { mode: "do" })) as SessionState;
}

function draw(state: SessionState): HTMLElement {
  const shared = {
    params: { mode: "do" },
    actions: actionsForScreen("session"),
    onAction: () => undefined,
    onParams: () => undefined,
  } as const;
  const { container } = render(
    <>
      <SessionScreen state={state} {...shared} />
      <SessionInspector state={state} {...shared} />
    </>,
  );
  return container;
}

describe("visual styling is never an accessible name (EX-03)", () => {
  it("uppercases nothing in CSS, because Chromium puts that in the name", () => {
    /*
     * The rule already said "capitals are `text-transform`" and they already
     * were. That is what makes this finding worth writing down: the rule was
     * satisfied and the defect was there anyway, because Chromium computes an
     * accessible name from *rendered* text and `text-transform` is rendering.
     *
     * `font-variant-caps` is a font feature. It changes which glyphs are drawn
     * and nothing about the text.
     */
    for (const sheet of SHEETS) {
      const css = readFileSync(sheet, "utf8");
      expect(css, `${sheet} still uppercases in CSS`).not.toMatch(/text-transform:\s*uppercase/);
    }
  });

  it("keeps the small-caps treatment, so this is a fix and not a deletion", () => {
    const css = SHEETS.map((one) => readFileSync(one, "utf8")).join("\n");
    expect(css).toMatch(/font-variant-caps:\s*all-small-caps/);
  });

  it("writes no label in capitals by hand either", async () => {
    /*
     * The stylesheet half above is about the rendering. This is about the
     * source: a heading authored as `INSPECTOR` would pass every rule here and
     * still be shouted, because nothing would have transformed it.
     */
    const container = draw(await session());
    for (const one of container.querySelectorAll("h1, h2, h3, h4, h5, h6, label, caption, th")) {
      const text = (one.textContent ?? "").trim();
      const letters = text.replace(/[^A-Za-z]/g, "");
      if (letters.length < 4) continue;
      expect(
        letters === letters.toUpperCase(),
        `"${text}" is written in capitals rather than styled in them`,
      ).toBe(false);
    }
  });
});

describe("the outline nests, and nothing undrawn is published (AX-09)", () => {
  it("descends without skipping a level", async () => {
    const container = draw(await session());
    const levels = [...container.querySelectorAll("h1, h2, h3, h4, h5, h6")].map((one) =>
      Number(one.tagName.slice(1)),
    );
    /*
     * The screen's own title is the window's `h1` and is drawn by the shell,
     * which is not rendered here — so the floor for this fragment is two, and
     * what is checked is that nothing jumps.
     */
    let previous = 1;
    for (const level of levels) {
      expect(level, `a heading at level ${String(level)} follows one at ${String(previous)}`)
        .toBeLessThanOrEqual(previous + 1);
      previous = level;
    }
  });

  it("publishes no heading with nothing in it", async () => {
    const container = draw(await session());
    for (const heading of container.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
      expect(
        (heading.textContent ?? "").trim(),
        `${heading.tagName} ${heading.id} is published with no text`,
      ).not.toBe("");
    }
  });
});

describe("structure is not built before it has content (AX-10)", () => {
  it("publishes no table without rows", async () => {
    const container = draw(await session());
    for (const table of container.querySelectorAll("table")) {
      expect(
        table.querySelectorAll("tbody tr").length,
        `${table.id} is published as a table with no rows`,
      ).toBeGreaterThan(0);
    }
  });

  it("says what is not here instead, keeping the id a flow addresses", async () => {
    const container = draw(await session());
    /*
     * The sessions list is the one every launch starts with nothing in. It is
     * still `#surfaces-sessions`, still named, and is now a region with a
     * sentence rather than a grid with a sentence in a cell.
     */
    const list = container.querySelector("#surfaces-sessions");
    expect(list, "the sessions list lost its id when it lost its rows").not.toBeNull();
    expect(list?.tagName).not.toBe("TABLE");
    expect((list?.textContent ?? "").trim(), "the zero state says nothing").not.toBe("");
  });

  it("would have failed before: shown to bite (EX-N3)", async () => {
    /*
     * The old `Table` drew `<table><caption><thead><tbody><tr><td colspan>` for
     * an empty list, so the first assertion above would have found a `<table>`
     * with one `tbody tr` — a row that is not a row — and passed. It is the
     * *second* that separates the designs: the old empty state was a `TABLE`.
     */
    const container = draw(await session());
    const empties = [...container.querySelectorAll(".sv-table-empty")];
    expect(empties.length, "no list was empty, so this case measured nothing").toBeGreaterThan(0);
  });
});
