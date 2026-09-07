/**
 * The independent oracles (T18, REQ-SELF-3, SF-18).
 *
 * > External oracles stay: screenshot, geometry, axe, and the fixture project's
 * > files unchanged.
 *
 * They are here because a suite in which Yam is both the driver and the judge
 * is a suite grading its own homework. Each of these looks at the application
 * through something Yam did not write:
 *
 *   * **screenshot** — pixels, taken through the operation and checked to be a
 *     real image of the right shape rather than a zero-byte file that a green
 *     check would otherwise cover for;
 *   * **geometry** — the boxes the browser laid out, read over CDP, so the
 *     "no primary control overlaps another" claim is measured rather than
 *     asserted. This is the class of defect the T14 driving actually found;
 *   * **axe-core** — a second implementation of the accessibility rules,
 *     against the application's own window;
 *   * **the fixture project** — every file, hashed before and after, because
 *     the strongest claim a projectless journey makes is that it wrote nothing.
 */
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";

/** Every file under a directory, by path, with the hash of its bytes. */
export function fileHashes(dir) {
  const out = {};
  if (!existsSync(dir)) return out;
  const walk = (at) => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);
      if (entry.isDirectory()) {
        walk(path);
        continue;
      }
      if (!statSync(path).isFile()) continue;
      out[relative(dir, path)] = createHash("sha256").update(readFileSync(path)).digest("hex");
    }
  };
  walk(dir);
  return out;
}

/** What changed between two `fileHashes`, in the words a reviewer needs. */
export function changedFiles(before, after) {
  const changes = [];
  for (const [path, hash] of Object.entries(after)) {
    if (before[path] === undefined) changes.push(`added ${path}`);
    else if (before[path] !== hash) changes.push(`modified ${path}`);
  }
  for (const path of Object.keys(before)) {
    if (after[path] === undefined) changes.push(`removed ${path}`);
  }
  return changes;
}

/**
 * The oracles that need the window itself. They attach over CDP — which is
 * *not* how Yam drove the application, and is the point: a second, independent
 * view of the same window.
 */
export async function windowOracles({ cdpUrl, record, label, screenshotPath, root }) {
  const check = (name, ok, detail) => record({ pass: label, name, ok, detail });
  let chromium;
  try {
    ({ chromium } = await import("@playwright/test"));
  } catch (error) {
    check(
      "an independent view of the window is available",
      false,
      `@playwright/test did not load: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  let browser;
  try {
    browser = await chromium.connectOverCDP(cdpUrl);
    const page = browser.contexts()[0]?.pages()[0];
    if (page === undefined) {
      check("an independent view of the window is available", false, "no page on the endpoint");
      return;
    }

    /* ── geometry: primary controls do not overlap (SF-18) ────────────────── */
    const box = async (id) => {
      const locator = page.locator(`#${id}`);
      return (await locator.count()) > 0 ? await locator.first().boundingBox() : null;
    };
    const url = await box("surfaces-url");
    const connect = await box("action-surface-connect");
    const overlap =
      url !== null && connect !== null
        ? url.x + url.width > connect.x &&
          url.y < connect.y + connect.height &&
          connect.y < url.y + url.height
        : false;
    check(
      "the connect field and the Connect surface button do not overlap",
      url !== null && connect !== null && !overlap,
      url === null || connect === null
        ? "one of them is not on screen"
        : `url.right=${Math.round(url.x + url.width)} connect.x=${Math.round(connect.x)}`,
    );

    /* ── screenshot: real pixels, of the right window ─────────────────────── */
    let bytes = 0;
    try {
      bytes = (await page.screenshot({ path: screenshotPath })).length;
    } catch (error) {
      bytes = 0;
      check(
        "a screenshot of the application is taken",
        false,
        error instanceof Error ? error.message.slice(0, 200) : String(error),
      );
    }
    check(
      "a screenshot of the application is taken, and is a real image",
      bytes > 5000 &&
        readFileSync(screenshotPath).subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
      `${bytes} bytes at ${screenshotPath}`,
    );

    /* ── accessibility: a second implementation of the rules ──────────────── */
    /*
     * axe-core is MPL-2.0 and REQ-PKG-3 admits MIT, Apache-2.0 and BSD only, so
     * it is *not* a dependency of this repository. `scripts/audit-sheet.mjs` is
     * the in-house implementation of the rules the design system has to keep,
     * and it takes `--axe <axe.min.js>` when a verifier supplies one. Both are
     * honoured here: the in-house audit always runs, over the live window's own
     * DOM; axe-core runs beside it when `YAM_AXE` names a copy, and is reported
     * as blocked with that exact reason when it does not.
     */
    const html = await page.content();
    const dump = `${screenshotPath.replace(/\.png$/, "")}-dom.html`;
    writeFileSync(dump, html, "utf8");
    const audited = spawnSync(
      process.execPath,
      [
        join(root, "scripts", "audit-sheet.mjs"),
        "--sheet",
        dump,
        "--json",
        ...(process.env["YAM_AXE"] === undefined ? [] : ["--axe", process.env["YAM_AXE"]]),
      ],
      { encoding: "utf8", cwd: root, maxBuffer: 64 * 1024 * 1024 },
    );
    let findings;
    try {
      findings = JSON.parse(audited.stdout).findings ?? [];
    } catch {
      findings = undefined;
    }
    check(
      "the accessibility audit finds no violation on the application's own window",
      findings !== undefined && findings.length === 0,
      findings === undefined
        ? `the audit produced no JSON (exit ${audited.status}): ${(audited.stderr || "").trim().slice(0, 300)}`
        : findings.length === 0
          ? `0 violations over the live DOM (${html.length} bytes)`
          : `${findings.length}: ` +
            findings.map((one) => `${one.rule} ${one.message}`).slice(0, 6).join(" | "),
    );
    if (process.env["YAM_AXE"] === undefined) {
      record({
        pass: label,
        name: "axe-core confirms the in-house audit",
        blocked:
          "axe-core is MPL-2.0 and REQ-PKG-3 admits MIT, Apache-2.0 and BSD only, so it is not " +
          "a dependency of this repository. Set YAM_AXE=<path to axe.min.js> to run it beside " +
          "the in-house audit.",
      });
    }
  } catch (error) {
    check(
      "an independent view of the window is available",
      false,
      error instanceof Error ? error.message.slice(0, 200) : String(error),
    );
  } finally {
    await browser?.close().catch(() => undefined);
  }
}
