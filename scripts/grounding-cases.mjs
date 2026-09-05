#!/usr/bin/env node
/**
 * Build the grounding eval's case set (T3.4, REQ-REC-10, LLD §16).
 *
 *   node scripts/grounding-cases.mjs [--out evals/grounding/cases.jsonl]
 *
 * "150 grounding cases from sample pages." A case is a phrase a person might
 * write, the page it is said on, and the element it means — identified by the
 * ground-truth key `apps/sample-web` stamps on every interactive element, which
 * is the same key across every variant and which nothing above the surface can
 * see (LLD §16).
 *
 * ## Where the phrases come from
 *
 * From the element's own role and accessible name: "Sign in" as a link becomes
 * "the Sign in link", a textbox named "Username" becomes "the username field".
 * That is what a person writing a flow actually types, and it is generated rather
 * than hand-written so the set covers every control on every page instead of the
 * dozen someone thought of.
 *
 * Two kinds of case, and the second is the one that matters:
 *
 * * **present** — the phrase names an element on the page. The answer is that
 *   element, and nothing else counts.
 * * **absent** — the phrase names something real on a *different* page. The
 *   answer is null. A grounding model that never says null is a model that binds
 *   the closest-looking control, and an eval with no absent cases would score it
 *   perfect.
 *
 * ## And on the variants
 *
 * The twenty variants are the same application after a change a real team would
 * make: a class renamed, a heading demoted, a login moved into a modal. Grounding
 * is supposed to be the part that survives those — it matches on meaning, not on
 * markup — so a case set drawn only from variant 0 would not test the property
 * that makes grounding worth doing. The ground-truth key is stamped before a
 * variant is applied and carries through it, so the expected answer is the same
 * element on both.
 *
 * An element whose role and name are not unique on its page is left out of the
 * present cases: the phrase would be genuinely ambiguous, and "which of these two
 * identical buttons" is not a question with a right answer.
 *
 * ## And the phrases people actually wrote
 *
 * Generated phrases are regular by construction, and regular is not what a flow
 * file looks like. The four migrated fixtures say "the sign in button" for a
 * link, "the username field", "the Schedule Build link" — phrases a person chose,
 * carried over from the legacy suite. Every one of them is in
 * `evals/fixtures/bindings`, beside the element it means, so they are read from
 * there rather than invented: the case set gets the wording a real project uses,
 * and `svatah record --gateway fake` can record the fixtures from it.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, PAGES, VARIANTS, GROUND_TRUTH_ATTRIBUTE } from "sample-web";
import { PlaywrightSurface } from "@svatah/adapter-playwright";
import { BindingsStore } from "@svatah/bindings";
import { isInteractiveRole } from "@svatah/surface";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const OUT = resolve(ROOT, outArg > 0 ? process.argv[outArg + 1] : "evals/grounding/cases.jsonl");

/** `the <name> <noun>` — what a person writes for a control of that role. */
function phraseFor(role, name) {
  const noun = {
    link: "link",
    button: "button",
    textbox: "field",
    searchbox: "search field",
    spinbutton: "field",
    checkbox: "checkbox",
    radio: "option",
    combobox: "select",
    listbox: "select",
    option: "option",
    slider: "slider",
    menuitem: "menu item",
    tab: "tab",
    switch: "switch",
  }[role];
  return noun === undefined ? undefined : `the ${name} ${noun}`;
}

const app = await startSampleApp(0);
const cases = [];
/**
 * Phrases the fake gateway can answer but the eval cannot score.
 *
 * Written beside the cases as `fixture-answers.jsonl`. `svatah record --gateway
 * fake` reads both; `svatah eval grounding` reads only the cases, so a phrase
 * that cannot be checked can never flatter or drag a published number.
 */
const answers = [];
let n = 0;
const id_ = () => `g-${String((n += 1)).padStart(3, "0")}`;

/** Every unambiguous, nameable control on one page of one variant. */
async function presentOn(path, variant) {
  const surface = new PlaywrightSurface({
    browser: "chromium",
    headless: true,
    // The key must not reach a candidate or a fingerprint; the eval reads it
    // with a page script instead (LLD §16).
    ignoreAttributes: [GROUND_TRUTH_ATTRIBUTE],
  });
  await surface.open({ baseUrl: app.origin });
  await surface.act("navigate", undefined, {
    url: `${app.origin}${path}${variant === 0 ? "" : `?variant=${variant}`}`,
  });

  try {
    const snapshot = await surface.snapshot();
    const interactive = snapshot.nodes.filter(
      (node) => isInteractiveRole(node.role) && !node.states.includes("hidden") && node.name,
    );

    /** role+name that appear more than once: genuinely ambiguous, so left out. */
    const seen = new Map();
    for (const node of interactive) {
      const key = `${node.role}|${node.name}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }

    const here = [];
    for (const node of interactive) {
      if (seen.get(`${node.role}|${node.name}`) !== 1) continue;
      const phrase = phraseFor(node.role, node.name);
      if (phrase === undefined) continue;

      const truth = await surface.readRawAttribute(node.ref, GROUND_TRUTH_ATTRIBUTE);
      if (truth === undefined) continue;

      here.push({
        id: id_(),
        page: path,
        ...(variant === 0 ? {} : { variant }),
        phrase,
        expect: "present",
        element: truth,
        role: node.role,
        name: node.name,
      });
    }
    return here;
  } finally {
    await surface.close();
  }
}

try {
  /** page → the present cases on it, so absent cases can borrow from elsewhere. */
  const byPage = new Map();

  for (const page of PAGES) {
    const here = await presentOn(page.path, 0);
    byPage.set(page.path, here);
    cases.push(...here);
    process.stderr.write(`${page.path}: ${here.length} present\n`);
  }

  /*
   * Absent cases: a phrase that is real somewhere else and not here.
   *
   * Borrowed from another page rather than invented, so the phrase is one a
   * person would plausibly write against this project — "the pay button" on the
   * login page is a copy-paste mistake, which is exactly when a confident wrong
   * answer costs the most.
   */
  const pages = [...byPage.keys()];
  for (const [at, page] of pages.entries()) {
    const other = byPage.get(pages[(at + 1) % pages.length]) ?? [];
    const mine = new Set((byPage.get(page) ?? []).map((c) => c.phrase));
    for (const borrowed of other.filter((c) => !mine.has(c.phrase)).slice(0, 3)) {
      cases.push({ id: id_(), page, phrase: borrowed.phrase, expect: "absent" });
    }
  }

  /*
   * Two cases per variant, on the first page it changes.
   *
   * Two rather than all of them: the point is that grounding still works after a
   * change a team would make, and twenty variants at two cases each is enough to
   * fail visibly if it stops. The elements are chosen deterministically — the
   * first two the page reports — so re-running produces the same set.
   */
  for (const variant of VARIANTS) {
    const path = variant.pages[0];
    if (path === undefined) continue;
    const here = (await presentOn(path, variant.id)).slice(0, 2);
    cases.push(...here);
    process.stderr.write(`variant ${variant.id} on ${path}: ${here.length} present\n`);
  }

  /*
   * The phrases the fixtures actually use, from the store that holds them.
   *
   * Each binding file names an element, the phrases a person wrote for it, and
   * the page pattern it applies to. Locating it through its own top candidate and
   * reading the snapshot line back gives the role and name a case needs — so the
   * mapping comes from committed data rather than from a table someone retyped.
   */
  const store = BindingsStore.load(join(ROOT, "evals", "fixtures", "bindings"));
  for (const id of store.ids()) {
    const file = store.get(id);
    if (file === undefined) continue;

    for (const entry of file.entries) {
      const path = entry.context.pattern;
      if (!PAGES.some((page) => page.path === path)) continue;

      const surface = new PlaywrightSurface({
        browser: "chromium",
        headless: true,
        ignoreAttributes: [GROUND_TRUTH_ATTRIBUTE],
      });
      await surface.open({ baseUrl: app.origin });
      await surface.act("navigate", undefined, { url: `${app.origin}${path}` });

      try {
        const snapshot = await surface.snapshot();
        let node;
        for (const candidate of entry.candidates) {
          const refs = await surface.locate(candidate).catch(() => []);
          if (refs.length !== 1) continue;
          const described = await surface.describe(refs[0]).catch(() => undefined);
          if (described === undefined) continue;
          node = snapshot.nodes.find(
            (one) => one.role === described.role && one.name === described.name,
          );
          if (node !== undefined) break;
        }
        if (node === undefined) {
          process.stderr.write(`${id} on ${path}: could not locate; skipped\n`);
          continue;
        }
        if (node.states.includes("hidden")) {
          /*
           * Not in the snapshot the model is given, so not a grounding case.
           *
           * `booking.indiranagar-suggestion` is an `<option>` inside a
           * `<datalist>`: the accessibility tree does not expose it, which is the
           * same limitation the conformance fixture documents for clicking it.
           * REQ-REC-2 measures grounding *from the snapshot*; an element the
           * snapshot does not contain is a case for the vision fallback, not for
           * this suite.
           */
          process.stderr.write(`${id} on ${path}: hidden from the snapshot; skipped\n`);
          continue;
        }

        const truth = await surface.readRawAttribute(node.ref, GROUND_TRUTH_ATTRIBUTE);

        // Where the element sits among the same role, so an answer for a control
        // with no accessible name — a nameless select — can still say which one
        // it means. Counted over what the renderer emits, not over every node:
        // hidden nodes are dropped from the text, and an index over a different
        // list would point at a different element.
        const visible = snapshot.nodes.filter((one) => !one.states.includes("hidden"));
        const nth = visible.filter((one) => one.role === node.role).indexOf(node);

        /*
         * A phrase with no ground-truth key is an *answer*, not a *case*.
         *
         * `apps/sample-web` stamps interactive elements; a heading is not one,
         * and the fixtures bind two of them. The eval cannot check such an
         * answer, so scoring it would put a permanently unreachable case in
         * REQ-REC-10's denominator — a rigged threshold, not a hard case. But
         * `svatah record --gateway fake` still has to be able to answer the
         * phrase, or the fixtures cannot be recorded without a credential. So it
         * goes in the answer book and not in the case set.
         */
        const target = truth === undefined ? answers : cases;
        for (const phrase of file.phrases) {
          if ([...cases, ...answers].some((c) => c.page === path && c.phrase === phrase)) continue;
          target.push({
            id: id_(),
            page: path,
            phrase,
            expect: "present",
            ...(truth === undefined ? {} : { element: truth }),
            role: node.role,
            ...(node.name === undefined ? {} : { name: node.name }),
            nth,
            source: "fixtures",
          });
        }
      } finally {
        await surface.close();
      }
    }
  }
  process.stderr.write(
    `fixture phrases: ${cases.filter((c) => c.source === "fixtures").length}\n`,
  );

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${cases.map((c) => JSON.stringify(c)).join("\n")}\n`, "utf8");
  process.stderr.write(
    `wrote ${cases.length} case(s) to ${OUT} ` +
      `(${cases.filter((c) => c.expect === "present").length} present, ` +
      `${cases.filter((c) => c.expect === "absent").length} absent)\n`,
  );

  const answersPath = join(dirname(OUT), "fixture-answers.jsonl");
  writeFileSync(answersPath, `${answers.map((c) => JSON.stringify(c)).join("\n")}\n`, "utf8");
  process.stderr.write(`wrote ${answers.length} unscored answer(s) to ${answersPath}\n`);
} finally {
  await app.close();
}
