#!/usr/bin/env node
/**
 * Record the sample application's pages as a fixture the recorder's tests replay
 * (T3.2: "recorded-snapshot tests with a fake gateway").
 *
 *   node scripts/record-snapshots.mjs [--out packages/recorder/test/fixtures/pages.json]
 *
 * ## Why a recorded surface rather than a live one
 *
 * Grounding is a decision made from a snapshot. What the recorder's tests are
 * about is that decision — the pruning, the prompt, the null handling, the
 * synthesis and the dry-check — and none of it is about a browser. Replaying a
 * recorded page makes those tests fast, deterministic, and runnable in the
 * package that owns the code: `recorder` may not import an adapter (LLD §1), and
 * a test that needed one would have to live somewhere else.
 *
 * The live path is covered where it belongs — `packages/cli` records
 * `simple.flow` against a real browser (T3.3).
 *
 * ## What is recorded
 *
 * Everything the recorder asks a surface for, keyed so the stub can answer it:
 * the snapshot, `describe(ref)` for every reference, and `locate(candidate)` for
 * every candidate synthesis would propose. That last one is what makes the
 * replay faithful rather than approximate: candidate uniqueness is a property of
 * the real page, and a stub that guessed at it would be testing the guess.
 *
 * Regenerate after changing `apps/sample-web` or the snapshot mechanism. The
 * file is committed, so the diff shows what moved.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { startSampleApp, PAGES } from "sample-web";
import { PlaywrightSurface } from "@svatah/adapter-playwright";
import { candidatesFor } from "@svatah/bindings";
import { canonicalJson } from "@svatah/schema";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const OUT = resolve(
  ROOT,
  outArg > 0 ? process.argv[outArg + 1] : "packages/recorder/test/fixtures/pages.json",
);

const app = await startSampleApp(0);

try {
  const pages = {};

  for (const page of PAGES) {
    const surface = new PlaywrightSurface({ browser: "chromium", headless: true });
    await surface.open({ baseUrl: app.origin });
    await surface.act("navigate", undefined, { url: `${app.origin}${page.path}` });

    const snapshot = await surface.snapshot();
    const describe = {};
    const locate = {};

    for (const node of snapshot.nodes) {
      const described = await surface.describe(node.ref).catch(() => undefined);
      if (described === undefined) continue;
      describe[node.ref] = described;

      for (const candidate of candidatesFor(described)) {
        const key = canonicalJson(candidate);
        if (locate[key] !== undefined) continue;
        const found = await surface.locate(candidate).catch(() => []);
        locate[key] = found;

        /*
         * `locate` answers in the adapter's own handle references, not in the
         * snapshot's. That is real — a candidate is resolved against the live
         * page, not against a snapshot — and it is how synthesis decides whether
         * what it found is the element it started from: it describes both and
         * compares. So the recording has to be able to describe a handle too.
         */
        for (const ref of found) {
          if (describe[ref] !== undefined) continue;
          const other = await surface.describe(ref).catch(() => undefined);
          if (other !== undefined) describe[ref] = other;
        }
      }
    }

    pages[page.path] = {
      // The origin is stripped: it holds an ephemeral port, and a fixture that
      // changed on every run would be a fixture nobody reviews.
      url: page.path,
      snapshot,
      describe,
      locate,
    };

    await surface.close();
    process.stderr.write(`${page.path}: ${snapshot.nodes.length} nodes\n`);
  }

  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${canonicalJson(pages)}\n`, "utf8");
  process.stderr.write(`wrote ${OUT}\n`);
} finally {
  await app.close();
}
