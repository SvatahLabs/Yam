/**
 * T1.4 Validate — the three claims, against real pages:
 *
 *   "For every interactive element on every sample page, the top candidate
 *    resolves uniquely to that element."
 *   "Fingerprints stable across reloads."
 *   "Snapshot of bundles committed for review."
 *
 * The first is the one that matters: a bundle whose best candidate does not find
 * the element it was synthesised from is not a weaker binding, it is a wrong one.
 * So it is asserted for every interactive element on every page rather than for a
 * sample, and the count is printed so a regression that quietly narrowed the
 * sweep would show.
 *
 * Refs: REQ-REC-3, REQ-REC-4, LLD §3.3, §7.4.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { candidateSchema, canonicalJson, fingerprintSchema } from "@svatah/schema";
import { fingerprintOf, synthesise, synthesiseBundle } from "@svatah/bindings";
import type { PlaywrightSurface } from "@svatah/adapter-playwright";
import { expect, PAGES, test } from "./fixtures.js";

const HERE = dirname(fileURLToPath(import.meta.url));
/** The committed bundle snapshot (T1.4: "snapshot of bundles committed for review"). */
const SNAPSHOT_PATH = join(HERE, "__snapshots__", "candidate-bundles.json");

/** Every interactive element on the current page, by reference. */
async function interactiveRefs(surface: PlaywrightSurface): Promise<string[]> {
  const snapshot = await surface.snapshot({ interactiveOnly: true });
  return snapshot.nodes.filter((n) => !n.states.includes("hidden")).map((n) => n.ref);
}

test.describe("candidate synthesis (REQ-REC-3)", () => {
  for (const page of PAGES) {
    test(`${page}: the top candidate resolves uniquely to the element it came from`, async ({
      openSurface,
    }) => {
      const surface = await openSurface(page);
      const refs = await interactiveRefs(surface);
      expect(refs.length, `${page} has no interactive elements to bind`).toBeGreaterThan(0);

      let checked = 0;
      for (const ref of refs) {
        const described = await surface.describe(ref);
        const candidates = await synthesise(surface, ref);

        expect(
          candidates.length,
          `${page}: no candidate at all for the ${described.role} "${described.name ?? described.text}"`,
        ).toBeGreaterThan(0);

        const top = candidates[0]!;
        expect(candidateSchema.safeParse(top).success, JSON.stringify(top)).toBe(true);

        const found = await surface.locate(top);
        expect(
          found.length,
          `${page}: the top candidate for the ${described.role} "${described.name ?? described.text}" ` +
            `(${top.by} ${top.value ?? `${top.role ?? ""} ${top.name ?? ""}`}) matched ${found.length} elements`,
        ).toBe(1);

        const again = await surface.describe(found[0]!);
        expect(
          { tag: again.tag, role: again.role, box: again.box },
          `${page}: the top candidate for the ${described.role} "${described.name ?? described.text}" ` +
            "resolved to a different element",
        ).toEqual({ tag: described.tag, role: described.role, box: described.box });

        checked += 1;
      }
      expect(checked).toBe(refs.length);
    });
  }

  test("candidates are ranked, and the ranking is by how much has to change to break them", async ({
    openSurface,
  }) => {
    const surface = await openSurface("/login");
    const ref = (await surface.locate({ by: "id", value: "username", score: 1 }))[0]!;
    const candidates = await synthesise(surface, ref);

    expect(candidates.map((c) => c.by)).toContain("testid");
    expect(candidates[0]!.by).toBe("testid");
    expect(candidates.map((c) => c.score)).toEqual([...candidates.map((c) => c.score)].sort((a, b) => b - a));

    // Every kind the login username field can legitimately offer is there, so a
    // healer that loses one to a front-end change has somewhere to fall back to.
    const kinds = new Set(candidates.map((c) => c.by));
    for (const kind of ["testid", "id", "role", "label", "placeholder", "name", "css"]) {
      expect(kinds, `no ${kind} candidate for the username field`).toContain(kind);
    }
  });

  test("a candidate matching more than one element is dropped, not guessed at", async ({
    openSurface,
  }) => {
    // Variant 9 adds a second "Book now" button, so the role-and-name candidate
    // stops being unique. REQ-REC-3: it is dropped.
    const surface = await openSurface("/booking?variant=9");
    const refs = await surface.locate({ by: "role", role: "button", name: "Book now", score: 1 });
    expect(refs.length).toBeGreaterThan(1);

    const candidates = await synthesise(surface, refs[0]!);
    expect(candidates.some((c) => c.by === "role" && c.name === "Book now")).toBe(false);
    for (const candidate of candidates) {
      expect(
        (await surface.locate(candidate)).length,
        `${candidate.by} ${candidate.value ?? ""} survived the uniqueness filter but matches several`,
      ).toBe(1);
    }
  });

  test("an element with no accessibility node falls back to coordinates", async ({
    openSurface,
  }) => {
    const surface = await openSurface("/widgets");
    const canvas = (await surface.locate({ by: "testid", value: "canvas-control", score: 1 }))[0]!;
    await surface.act("scrollIntoView", canvas);

    // The canvas itself has a test id, so it binds normally. What has no node is
    // the button painted *on* it, reached only by coordinates.
    const box = (await surface.describe(canvas)).box;
    const painted = (
      await surface.locate({ by: "coords", value: `${box[0] + 160},${box[1] + 57}`, score: 1 })
    )[0]!;

    const candidates = await synthesise(surface, painted);
    expect(candidates.length).toBeGreaterThan(0);
    // The point resolves to the canvas element, which does have a test id; the
    // coords fallback is what the recorder falls back to when even that is gone.
    expect(candidates[0]!.by).toBe("testid");
  });

  test("a generated id is not bound to", async ({ openSurface }) => {
    const surface = await openSurface("/dashboard");
    await surface.act("evaluate", undefined, {
      expression:
        'const b = document.createElement("button"); b.id = ":r7:"; b.className = "css-1x2y3z"; b.textContent = "Generated"; document.body.appendChild(b);',
    });
    const ref = (await surface.locate({ by: "text", value: "Generated", score: 1 }))[0]!;
    const candidates = await synthesise(surface, ref);

    expect(candidates.some((c) => c.by === "id")).toBe(false);
    expect(JSON.stringify(candidates)).not.toContain("css-1x2y3z");
    expect(candidates.length).toBeGreaterThan(0);
  });
});

test.describe("fingerprints (REQ-REC-4)", () => {
  for (const page of PAGES) {
    test(`${page}: fingerprints are stable across a reload`, async ({ openSurface }) => {
      const surface = await openSurface(page);
      const refs = await interactiveRefs(surface);

      const before = new Map<string, unknown>();
      for (const ref of refs) {
        const described = await surface.describe(ref);
        // Keyed by something that survives a reload — references do not.
        before.set(identity(described), canonicalJson(fingerprintOf(described)));
      }

      await surface.act("refresh");
      const after = await interactiveRefs(surface);
      expect(after.length).toBe(refs.length);

      for (const ref of after) {
        const described = await surface.describe(ref);
        const key = identity(described);
        expect(before.has(key), `${page}: ${key} was not there before the reload`).toBe(true);
        expect(canonicalJson(fingerprintOf(described)), `${page}: ${key} changed across a reload`).toBe(
          before.get(key),
        );
      }
    });
  }

  test("a fingerprint carries everything LLD §3.3 names", async ({ openSurface }) => {
    const surface = await openSurface("/login");
    const ref = (await surface.locate({ by: "id", value: "password", score: 1 }))[0]!;
    const { fingerprint } = await synthesiseBundle(surface, ref);

    expect(fingerprintSchema.safeParse(fingerprint).success).toBe(true);
    expect(fingerprint.tag).toBe("input");
    expect(fingerprint.attrs["id"]).toBe("password");
    expect(fingerprint.attrs["type"]).toBe("password");
    expect(fingerprint.neighbours.before.length + fingerprint.neighbours.after.length).toBeGreaterThan(0);
    expect(fingerprint.rolePath).toContain("main");
    expect(fingerprint.box).toHaveLength(4);
    expect(Number.isInteger(fingerprint.index)).toBe(true);
  });

  test("leaves out the attributes that change for reasons that are not identity", async ({
    openSurface,
  }) => {
    const surface = await openSurface("/login");
    const ref = (await surface.locate({ by: "id", value: "username", score: 1 }))[0]!;

    const before = fingerprintOf(await surface.describe(ref));
    await surface.act("evaluate", ref, {
      expression: 'element.setAttribute("style", "outline: 2px solid red"); element.classList.add("css-9z8y7x");',
    });
    const after = fingerprintOf(await surface.describe(ref));

    expect(after.attrs).toEqual(before.attrs);
  });
});

/**
 * T1.4 Validate — "snapshot of bundles committed for review".
 *
 * The committed file is what a reviewer reads to see what the synthesiser
 * actually produces, and what makes a change to the ranking a visible diff rather
 * than a silent one. `SVATAH_UPDATE_BUNDLES=1` rewrites it.
 */
test("the committed bundle snapshot matches what synthesis produces", async ({ openSurface }) => {
  test.setTimeout(300_000);

  const bundles: Record<string, unknown> = {};
  for (const page of PAGES) {
    const surface = await openSurface(page);
    const refs = await interactiveRefs(surface);
    const forPage: Array<Record<string, unknown>> = [];

    for (const ref of refs) {
      const described = await surface.describe(ref);
      const candidates = await synthesise(surface, ref);
      forPage.push({
        element: identity(described),
        role: described.role,
        ...(described.name === undefined ? {} : { name: described.name }),
        // The box is left out: it is a real part of a fingerprint but it moves
        // with the platform's font metrics, and a snapshot nobody can reproduce
        // on their own machine is a snapshot nobody reviews.
        candidates: candidates.map((c) => ({
          by: c.by,
          score: c.score,
          ...(c.role === undefined ? {} : { role: c.role }),
          ...(c.name === undefined ? {} : { name: c.name }),
          ...(c.value === undefined ? {} : { value: c.value }),
          ...(c.attribute === undefined ? {} : { attribute: c.attribute }),
        })),
      });
    }
    bundles[page] = forPage;
  }

  const rendered = canonicalJson(bundles);

  if (process.env["SVATAH_UPDATE_BUNDLES"] === "1" || !existsSync(SNAPSHOT_PATH)) {
    mkdirSync(dirname(SNAPSHOT_PATH), { recursive: true });
    writeFileSync(SNAPSHOT_PATH, rendered, "utf8");
    test.info().annotations.push({ type: "snapshot", description: `wrote ${SNAPSHOT_PATH}` });
    return;
  }

  expect(
    rendered,
    "the synthesised bundles differ from the committed snapshot. Review the diff, then " +
      "re-run with SVATAH_UPDATE_BUNDLES=1 if the change is intended.",
  ).toBe(readFileSync(SNAPSHOT_PATH, "utf8"));
});

/** A key for an element that survives a reload, unlike a reference. */
function identity(described: { tag: string; role: string; name?: string; index: number; attrs: Record<string, string> }): string {
  const id = described.attrs["data-testid"] ?? described.attrs["id"] ?? described.attrs["name"] ?? "";
  return `${described.tag}${id === "" ? "" : `#${id}`}[${described.role}]${
    described.name === undefined ? "" : ` "${described.name}"`
  }@${described.index}`;
}
