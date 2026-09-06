/**
 * T1.1 Validate — "one Playwright test per … predicate on `apps/sample-web`".
 *
 * ADR-7 collapsed the Java framework's 22 assert and validate actions into one
 * `expect` action over the predicate set of LLD §3.2, and the same predicates
 * serve as guards. So this file is the whole assertion surface of the adapter,
 * and the coverage test at the end reads `PREDICATE_KINDS` from the schema:
 * a predicate cannot be added without a test appearing.
 *
 * Each test names the predicates it covers in `[brackets]` in its title, which is
 * what the coverage test greps — a runtime set would only see one worker's share.
 *
 * Refs: REQ-ADP-1, LLD §2.3, §3.2.
 */
import { PREDICATE_KINDS } from "@svatah/yam-schema";
import { DataError } from "@svatah/yam-surface";
import { expect, MECHANISMS, refByTestId, test } from "./fixtures.js";

const literal = (value: string) => ({ kind: "literal" as const, value });

for (const mechanism of MECHANISMS) {
  test.describe(`predicates (${mechanism} refs)`, () => {
    /* ── element state ──────────────────────────────────────────────────── */

    test("[visible][hidden] visible and hidden", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const heading = await refByTestId(surface, "login-heading");
      const error = await refByTestId(surface, "login-error");

      expect((await surface.check({ kind: "visible" }, "ref", heading)).ok).toBe(true);
      expect((await surface.check({ kind: "hidden" }, "ref", heading)).ok).toBe(false);
      expect((await surface.check({ kind: "hidden" }, "ref", error)).ok).toBe(true);
      expect((await surface.check({ kind: "visible" }, "ref", error)).ok).toBe(false);

      // `negate` flips the answer, which is what "should not be" compiles to.
      expect((await surface.check({ kind: "visible", negate: true }, "ref", error)).ok).toBe(true);
    });

    test("[enabled][disabled] enabled and disabled", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login?variant=0");
      const submit = await refByTestId(surface, "login-submit");
      expect((await surface.check({ kind: "enabled" }, "ref", submit)).ok).toBe(true);
      expect((await surface.check({ kind: "disabled" }, "ref", submit)).ok).toBe(false);

      await surface.act("evaluate", submit, { expression: "element.disabled = true;" });
      expect((await surface.check({ kind: "disabled" }, "ref", submit)).ok).toBe(true);
    });

    test("[checked][unchecked] checked and unchecked", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const remember = await refByTestId(surface, "remember");
      expect((await surface.check({ kind: "unchecked" }, "ref", remember)).ok).toBe(true);
      await surface.act("setChecked", remember, { checked: true });
      expect((await surface.check({ kind: "checked" }, "ref", remember)).ok).toBe(true);
    });

    test("[selected] selected", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      const select = await refByTestId(surface, "single-select");
      await surface.act("selectOption", select, { value: "staging" });
      const options = await surface.locate({ by: "css", value: "#single-select option", score: 1 });
      expect(options).toHaveLength(3);
      expect((await surface.check({ kind: "selected" }, "ref", options[1]!)).ok).toBe(true);
      expect((await surface.check({ kind: "selected" }, "ref", options[0]!)).ok).toBe(false);
    });

    test("[present][absent] present and absent", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const heading = await refByTestId(surface, "login-heading");
      expect((await surface.check({ kind: "present" }, "ref", heading)).ok).toBe(true);
      expect((await surface.check({ kind: "absent" }, "ref", heading)).ok).toBe(false);

      // A reference the session never issued is absent, not an error: "should not
      // be present" has to be answerable.
      expect((await surface.check({ kind: "absent" }, "ref", "h9999")).ok).toBe(true);
      expect((await surface.check({ kind: "present" }, "ref", "h9999")).ok).toBe(false);
    });

    test("[multiSelect] multiSelect", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      const multi = await refByTestId(surface, "multi-select");
      const single = await refByTestId(surface, "single-select");
      expect((await surface.check({ kind: "multiSelect" }, "ref", multi)).ok).toBe(true);
      expect((await surface.check({ kind: "multiSelect" }, "ref", single)).ok).toBe(false);
    });

    /* ── values ─────────────────────────────────────────────────────────── */

    test("[text][textContains] text and textContains", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/schedule-build");
      const heading = await refByTestId(surface, "schedule-heading");

      expect((await surface.check({ kind: "text", value: literal("Enterprise") }, "ref", heading)).ok).toBe(true);
      expect((await surface.check({ kind: "text", value: literal("Enter") }, "ref", heading)).ok).toBe(false);
      expect((await surface.check({ kind: "textContains", value: literal("Enter") }, "ref", heading)).ok).toBe(true);

      // Against the page rather than an element.
      expect((await surface.check({ kind: "textContains", value: literal("Schedule a build") }, "page")).ok).toBe(true);
    });

    test("[value] value", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const username = await refByTestId(surface, "username");
      await surface.act("type", username, { value: "atul@example.com" });
      const check = await surface.check({ kind: "value", value: literal("atul@example.com") }, "ref", username);
      expect(check.ok).toBe(true);
      expect(check.actual).toBe("atul@example.com");
    });

    test("[title][titleContains] title and titleContains", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/dashboard");
      expect((await surface.check({ kind: "title", value: literal("Dashboard · Yam Sample") }, "page")).ok).toBe(true);
      expect((await surface.check({ kind: "titleContains", value: literal("Dashboard") }, "page")).ok).toBe(true);
      expect((await surface.check({ kind: "title", value: literal("Dashboard") }, "page")).ok).toBe(false);
    });

    test("[url][urlContains] url and urlContains", async ({ openSurface, origin }) => {
      const surface = await openSurface(mechanism, "/booking");
      expect((await surface.check({ kind: "url", value: literal(`${origin}/booking`) }, "page")).ok).toBe(true);
      expect((await surface.check({ kind: "urlContains", value: literal("/booking") }, "page")).ok).toBe(true);
      expect((await surface.check({ kind: "urlContains", value: literal("/checkout") }, "page")).ok).toBe(false);
    });

    test("[tag] tag", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/schedule-build");
      const heading = await refByTestId(surface, "schedule-heading");
      expect((await surface.check({ kind: "tag", value: literal("h1") }, "ref", heading)).ok).toBe(true);
      expect((await surface.check({ kind: "tag", value: literal("h2") }, "ref", heading)).ok).toBe(false);
    });

    /* ── named values ───────────────────────────────────────────────────── */

    test("[attribute] attribute", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/dashboard");
      const link = await refByTestId(surface, "docs-link");
      expect((await surface.check({ kind: "attribute", name: "target", value: literal("_blank") }, "ref", link)).ok).toBe(true);
      expect((await surface.check({ kind: "attribute", name: "target", value: literal("_self") }, "ref", link)).ok).toBe(false);
    });

    test("[css] css", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const submit = await refByTestId(surface, "login-submit");
      const actual = (await surface.check({ kind: "css", name: "display", value: literal("x") }, "ref", submit)).actual;
      expect(typeof actual).toBe("string");
      expect((await surface.check({ kind: "css", name: "display", value: literal(String(actual)) }, "ref", submit)).ok).toBe(true);
    });

    /* ── geometry ───────────────────────────────────────────────────────── */

    test("[location][size][box] location, size and box", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/login");
      const submit = await refByTestId(surface, "login-submit");

      const box = (await surface.check({ kind: "box", numbers: [0, 0, 0, 0] }, "ref", submit)).actual as number[];
      expect(box).toHaveLength(4);

      expect((await surface.check({ kind: "box", numbers: box }, "ref", submit)).ok).toBe(true);
      expect((await surface.check({ kind: "location", numbers: [box[0]!, box[1]!] }, "ref", submit)).ok).toBe(true);
      expect((await surface.check({ kind: "size", numbers: [box[2]!, box[3]!] }, "ref", submit)).ok).toBe(true);
      expect((await surface.check({ kind: "size", numbers: [box[2]! + 50, box[3]!] }, "ref", submit)).ok).toBe(false);
    });

    /* ── scope expressions ──────────────────────────────────────────────── */

    test("[expr] expr, for guards over scope values", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/dashboard");
      const eq = { kind: "expr" as const, left: literal("3"), op: "eq" as const, right: literal("3") };
      expect((await surface.check(eq, "page")).ok).toBe(true);
      expect((await surface.check({ ...eq, op: "ne" }, "page")).ok).toBe(false);
      expect((await surface.check({ ...eq, right: literal("2"), op: "gt" }, "page")).ok).toBe(true);
      expect((await surface.check({ ...eq, right: literal("4"), op: "lt" }, "page")).ok).toBe(true);
      expect((await surface.check({ ...eq, right: literal("^[0-9]$"), op: "matches" }, "page")).ok).toBe(true);
    });

    /* ── dialogs ────────────────────────────────────────────────────────── */

    test("dialog predicates read the dialog the session saw", async ({ openSurface }) => {
      const surface = await openSurface(mechanism, "/widgets");
      expect((await surface.check({ kind: "absent" }, "dialog")).ok).toBe(true);

      await surface.act("dialog", undefined, { action: "accept" });
      await surface.act("click", await refByTestId(surface, "show-alert"));

      expect((await surface.check({ kind: "present" }, "dialog")).ok).toBe(true);
      expect((await surface.check({ kind: "text", value: literal("Saved.") }, "dialog")).ok).toBe(true);
      expect((await surface.check({ kind: "textContains", value: literal("Sav") }, "dialog")).ok).toBe(true);
    });

    /* ── unresolved references ──────────────────────────────────────────── */

    test("an unresolved value reference is a DataError, not a false comparison", async ({
      openSurface,
    }) => {
      const surface = await openSurface(mechanism, "/dashboard");
      await expect(
        surface.check({ kind: "title", value: { kind: "data", path: "user.email" } }, "page"),
      ).rejects.toBeInstanceOf(DataError);
    });
  });
}

test("every predicate kind has a test (LLD §3.2)", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL(import.meta.url), "utf8");
  const tagged = new Set<string>();
  for (const match of source.matchAll(/test\("((?:\[[a-zA-Z]+\])+)/g)) {
    for (const tag of match[1]!.matchAll(/\[([a-zA-Z]+)\]/g)) tagged.add(tag[1]!);
  }

  const known = new Set<string>(PREDICATE_KINDS);
  for (const tag of tagged) {
    expect(known, `"[${tag}]" in a test title is not a predicate kind`).toContain(tag);
  }

  const missing = PREDICATE_KINDS.filter((kind) => !tagged.has(kind));
  expect(
    missing,
    `these predicate kinds have no tagged test in predicates.spec.ts: ${missing.join(", ")}`,
  ).toEqual([]);
});
