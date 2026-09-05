/**
 * T1.1 Validate — "`locate` for every candidate kind incl. `coords`".
 *
 * `CANDIDATE_KINDS` is the whole vocabulary of LLD §3.3, across web, mobile and
 * desktop. A web adapter honours the web kinds and `coords`, refuses the mobile
 * and desktop kinds by name, and returns nothing for `webmcp` until REQ-ADP-9
 * lands. The coverage test at the end reads the schema's list, so a kind cannot
 * be added without a decision appearing here.
 *
 * `locate` returns 0, 1 or many references; the "exactly one" rule belongs to the
 * resolver in `@svatah/bindings` (LLD §6.3), not to the adapter.
 *
 * Refs: REQ-ADP-1, REQ-RUN-5, LLD §3.3, §7.1.
 */
import { CANDIDATE_KINDS, type Candidate } from "@svatah/schema";
import { LocateError } from "@svatah/surface";
import { expect, MECHANISMS, test } from "./fixtures.js";

const candidate = (c: Omit<Candidate, "score">): Candidate => ({ ...c, score: 1 } as Candidate);

for (const mechanism of MECHANISMS) {
  test.describe(`locate (${mechanism} refs)`, () => {
    test("[role] role, with and without a name", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const named = await surface.locate(candidate({ by: "role", role: "button", name: "Sign In" }));
      expect(named).toHaveLength(1);
      expect((await surface.describe(named[0]!)).attrs["data-testid"]).toBe("login-submit");

      const all = await surface.locate(candidate({ by: "role", role: "textbox" }));
      expect(all.length).toBeGreaterThanOrEqual(2);
    });

    test("[role] an inexact name matches a substring", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      expect(await surface.locate(candidate({ by: "role", role: "button", name: "Sign" }))).toHaveLength(0);
      expect(
        await surface.locate(candidate({ by: "role", role: "button", name: "Sign", exact: false })),
      ).toHaveLength(1);
    });

    test("[label] label", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const refs = await surface.locate(candidate({ by: "label", value: "Password" }));
      expect(refs).toHaveLength(1);
      expect((await surface.describe(refs[0]!)).attrs["id"]).toBe("password");
    });

    test("[placeholder] placeholder", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const refs = await surface.locate(candidate({ by: "placeholder", value: "you@example.com" }));
      expect(refs).toHaveLength(1);
      expect((await surface.describe(refs[0]!)).attrs["id"]).toBe("username");
    });

    test("[testid] testid, with the default attribute and with a named one", async ({
      openSurface,
    }) => {
      const surface = await openSurface(mechanism, "/login");
      expect(await surface.locate(candidate({ by: "testid", value: "username" }))).toHaveLength(1);
      expect(
        await surface.locate(candidate({ by: "testid", value: "username", attribute: "data-testid" })),
      ).toHaveLength(1);
      expect(
        await surface.locate(candidate({ by: "testid", value: "username", attribute: "data-test" })),
      ).toHaveLength(0);
    });

    test("[text] text", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/dashboard");
      const refs = await surface.locate(candidate({ by: "text", value: "Welcome back, Enterprise" }));
      expect(refs).toHaveLength(1);
      expect((await surface.describe(refs[0]!)).tag).toBe("h1");
    });

    test("[altText] altText", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/dashboard");
      await surface.act("evaluate", undefined, {
        expression:
          'const i = document.createElement("img"); i.alt = "Build status"; i.src = "data:image/gif;base64,R0lGODlhAQABAAAAACw="; document.body.appendChild(i);',
      });
      expect(await surface.locate(candidate({ by: "altText", value: "Build status" }))).toHaveLength(1);
    });

    test("[title] title", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      expect(await surface.locate(candidate({ by: "title", value: "Embedded widget" }))).toHaveLength(1);
    });

    test("[css] css", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      expect(await surface.locate(candidate({ by: "css", value: "#login .field" }))).toHaveLength(3);
      expect(await surface.locate(candidate({ by: "css", value: "#nothing-here" }))).toHaveLength(0);
    });

    test("[xpath] xpath", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/schedule-build");
      const refs = await surface.locate(candidate({ by: "xpath", value: "//h1" }));
      expect(refs).toHaveLength(1);
      expect(await surface.read("text", refs[0]!)).toBe("Enterprise");
    });

    test("[id][name] id and name", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      expect(await surface.locate(candidate({ by: "id", value: "password" }))).toHaveLength(1);
      expect(await surface.locate(candidate({ by: "name", value: "username" }))).toHaveLength(1);
    });

    test("[coords] coords resolve to whatever is at the point", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const submit = await surface.locate(candidate({ by: "testid", value: "login-submit" }));
      const box = (await surface.describe(submit[0]!)).box;
      const centre = `${box[0] + box[2] / 2},${box[1] + box[3] / 2}`;

      const refs = await surface.locate(candidate({ by: "coords", value: centre }));
      expect(refs).toHaveLength(1);
      expect((await surface.describe(refs[0]!)).attrs["data-testid"]).toBe("login-submit");
    });

    test("[coords] coords off the page resolve to nothing", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      expect(await surface.locate(candidate({ by: "coords", value: "-50,-50" }))).toHaveLength(0);
    });

    test("[coords] reach the canvas-only control, which has no accessibility node", async ({
      openSurface,
    }) => {
      const surface = await openSurface(mechanism, "/widgets");
      const canvas = (await surface.locate(candidate({ by: "testid", value: "canvas-control" })))[0]!;

      // `elementFromPoint` reads viewport coordinates, so the control has to be
      // on screen before its box means anything.
      await surface.act("scrollIntoView", canvas);
      const box = (await surface.describe(canvas)).box;

      // The painted button occupies 80,35 to 240,79 inside the canvas (CANVAS_JS),
      // so its centre is 160,57 from the canvas's top-left corner. Nothing in the
      // accessibility tree names it: coordinates are the only way to it, which is
      // exactly what the `coords` candidate kind is for.
      const point = `${box[0] + 160},${box[1] + 57}`;
      const refs = await surface.locate(candidate({ by: "coords", value: point }));
      expect(refs).toHaveLength(1);
      expect((await surface.describe(refs[0]!)).tag).toBe("canvas");

      const page = surface.pageForTests();
      await page.mouse.click(box[0] + 160, box[1] + 57);

      const result = (await surface.locate(candidate({ by: "testid", value: "canvas-result" })))[0]!;
      expect(await surface.read("text", result)).toBe("approved");
    });

    test("[webmcp] a tool the page does not declare locates nothing", async ({ openSurface }) => {
      /*
       * The fall-through, at its smallest (T6.3, REQ-ADP-9, LLD §6.3). The home
       * page declares no tools, so a `webmcp` candidate resolves to nothing and
       * the resolver moves on to the locators recorded behind it. The capability
       * says this adapter *can* read a declaration, not that this page has one.
       */
      const surface = await openSurface(mechanism, "/");
      expect(await surface.locate(candidate({ by: "webmcp", tool: "book-a-slot" }))).toHaveLength(0);
      expect(surface.capabilities().webmcp).toBe(true);
    });

    test("[webmcp] a declared tool locates to a reference that is not an element", async ({
      openSurface,
    }) => {
      const surface = await openSurface(mechanism, "/site-tools");
      const refs = await surface.locate(candidate({ by: "webmcp", tool: "book-the-slot" }));
      expect(refs).toHaveLength(1);
      // `wN`, and it names a tool: `describe` refuses it, because there is no
      // element to describe.
      expect(refs[0]).toMatch(/^w\d+$/);
      await expect(surface.describe(refs[0]!)).rejects.toThrow(/site tool/);

      // And the same page with the declaration removed answers with nothing.
      await surface.act("navigate", undefined, { url: "/site-tools?webmcp=off" });
      expect(await surface.locate(candidate({ by: "webmcp", tool: "book-the-slot" }))).toHaveLength(
        0,
      );
    });

    test("[accessibilityId][resourceId][automationId][controlPath] the foreign kinds are refused by name", async ({
      openSurface,
    }) => {
      const surface = await openSurface(mechanism, "/");
      const cases: Array<[Candidate["by"], RegExp]> = [
        ["accessibilityId", /Appium/],
        ["resourceId", /Appium/],
        ["automationId", /UIA and AX/],
        ["controlPath", /UIA and AX/],
      ];
      for (const [by, owner] of cases) {
        await expect(surface.locate(candidate({ by, value: "x" }))).rejects.toBeInstanceOf(
          LocateError,
        );
        await expect(surface.locate(candidate({ by, value: "x" }))).rejects.toThrow(owner);
      }
    });

    test("a candidate missing its value is a LocateError, not an empty match", async ({
      openSurface,
    }) => {
      const surface = await openSurface(mechanism, "/");
      await expect(surface.locate(candidate({ by: "css" }))).rejects.toBeInstanceOf(LocateError);
      await expect(surface.locate(candidate({ by: "role" }))).rejects.toThrow(/must carry a role/);
      await expect(surface.locate(candidate({ by: "coords", value: "nope" }))).rejects.toThrow(
        /"x,y"/,
      );
    });

    test("locate returns many references when a candidate is not unique", async ({
      openSurface,
    }) => {
      const surface = await openSurface(mechanism, "/booking?variant=9");
      const refs = await surface.locate(candidate({ by: "role", role: "button", name: "Book now" }));
      // Variant 9 adds a second "Book now" button. `locate` reports both; the
      // "exactly one" rule is the resolver's (LLD §6.3).
      expect(refs.length).toBeGreaterThan(1);
    });
  });
}

test("every candidate kind has a decision (LLD §3.3)", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL(import.meta.url), "utf8");
  const tagged = new Set<string>();
  for (const match of source.matchAll(/test\("((?:\[[a-zA-Z]+\])+)/g)) {
    for (const tag of match[1]!.matchAll(/\[([a-zA-Z]+)\]/g)) tagged.add(tag[1]!);
  }

  const known = new Set<string>(CANDIDATE_KINDS);
  for (const tag of tagged) {
    expect(known, `"[${tag}]" in a test title is not a candidate kind`).toContain(tag);
  }

  const missing = CANDIDATE_KINDS.filter((kind) => !tagged.has(kind));
  expect(
    missing,
    `these candidate kinds have no tagged test in locate.spec.ts: ${missing.join(", ")}`,
  ).toEqual([]);
});
