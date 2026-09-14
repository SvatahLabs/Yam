#!/usr/bin/env node
/**
 * Read the artboards as *designs*: does each one fit its own frame (T11.1,
 * P10-F4, LLD §13.7)?
 *
 *   node scripts/audit-artboards.mjs            # every artboard, at 1440×900
 *   node scripts/audit-artboards.mjs --shoot <dir>
 *
 * The Phase 10 verification approved the four new artboards with two changes,
 * and both were things a person had to *look* at a picture to see: the Explorer
 * toolbar wrapped its title and buttons onto two lines, and the Data
 * inspector's "Read by" table ran past the inspector's right edge. Neither is
 * visible in the HTML, and both are exactly what a browser can be asked.
 *
 * So the artboards are rendered — with `base.css`, with `build.mjs`'s macros
 * expanded, in the browser `pnpm browsers` already installs — and the layout
 * rules the design *has* are checked:
 *
 *   1. a toolbar is one row and nothing in it is past its right edge;
 *   2. a toolbar's title keeps at least twelve characters (Draft 2.13);
 *   3. nothing in the inspector is wider than the inspector;
 *   4. no element anywhere is past the right edge of the window.
 *
 * These are the same rules `apps/desktop/test/shell.spec.ts` measures on the built
 * application. A design that fails them is a design the build cannot be held
 * to — which is why the two F4 findings were findings and not opinions.
 *
 * Exit 0 when every artboard passes, 1 when one does not, 2 when the browser is
 * not installed (`pnpm browsers`).
 */
import { readFileSync, readdirSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DESIGN = join(ROOT, "docs", "spec", "design");
const args = process.argv.slice(2);
const shootAt = args.indexOf("--shoot");
const shoot = shootAt >= 0 ? args[shootAt + 1] : undefined;

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  process.stderr.write("Playwright is not installed. Run `pnpm install && pnpm browsers`.\n");
  process.exit(2);
}

/**
 * `build.mjs`'s macros, expanded the same way.
 *
 * Imported rather than copied: the sidebar, the top bar and the status bar are
 * part of every artboard's layout, and an audit that rendered a fragment
 * without them would be measuring a different picture from the one that was
 * approved.
 */
const { expand, baseCss } = await import(pathToFileURL(join(DESIGN, "macros.mjs")).href);

/**
 * Which artboards to read. The committed set by default; `--artboards <dir>` for
 * a directory of them, which is how `tools/repo-checks/test/artboards.test.ts`
 * shows every rule here biting against a design written to break exactly one.
 */
const boardsAt = args.indexOf("--artboards");
const boards = boardsAt >= 0 && args[boardsAt + 1] !== undefined
  ? resolve(args[boardsAt + 1])
  : join(DESIGN, "artboards");

const artboards = readdirSync(boards)
  .filter((one) => one.endsWith(".html"))
  .sort();

const browser = await chromium.launch();
const page = await browser.newPage({ viewportSize: { width: 1700, height: 1200 } });
const failures = [];

for (const file of artboards) {
  const body = expand(readFileSync(join(boards, file), "utf8"));
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><style>\n${baseCss}\n</style></head>` +
      `<body>${body}</body></html>`,
    { waitUntil: "load" },
  );

  const found = await page.evaluate(() => {
    const problems = [];
    const box = (one) => one.getBoundingClientRect();

    for (const toolbar of document.querySelectorAll(".toolbar")) {
      const bar = box(toolbar);
      if (bar.height > 48) {
        problems.push(`a toolbar is ${Math.round(bar.height)}px tall, so it has wrapped`);
      }
      for (const child of toolbar.children) {
        const one = box(child);
        if (one.width === 0 && one.height === 0) continue;
        if (one.right > bar.right + 1) {
          problems.push(
            `"${(child.textContent ?? "").trim().slice(0, 40)}" is ` +
              `${Math.round(one.right - bar.right)}px past the end of its toolbar`,
          );
        }
        if (one.bottom > bar.bottom + 1 || one.top < bar.top - 1) {
          problems.push(
            `"${(child.textContent ?? "").trim().slice(0, 40)}" is outside its toolbar's row`,
          );
        }
      }
      /*
       * The title's floor, and only where it *bites*.
       *
       * A title of four characters has room for four, and that is a short
       * title rather than a truncated one. What Draft 2.13 forbids is a title
       * cut down to fewer than twelve — so the rule applies to a title that is
       * actually being clipped.
       */
      const title = toolbar.querySelector("h1");
      if (title !== null && title.scrollWidth > title.clientWidth + 1) {
        const per = title.scrollWidth / Math.max(1, (title.textContent ?? "").length);
        const fits = Math.floor(title.clientWidth / Math.max(1, per));
        if (fits < 12) {
          problems.push(
            `the toolbar title "${(title.textContent ?? "").trim()}" is cut to ${fits} characters`,
          );
        }
      }
    }

    for (const inspector of document.querySelectorAll(".inspector")) {
      const frame = box(inspector);
      for (const child of inspector.querySelectorAll("*")) {
        const one = box(child);
        if (one.width === 0 && one.height === 0) continue;
        if (one.right > frame.right + 1) {
          problems.push(
            `"${(child.textContent ?? "").trim().slice(0, 40)}" is ` +
              `${Math.round(one.right - frame.right)}px past the inspector's edge`,
          );
        }
      }
    }

    /*
     * And nothing past the right edge of the artboard's own frame.
     *
     * The frame, not the browser window: `.app` is 1440 px wide by design and
     * the page is rendered wider than that on purpose, so an element that runs
     * out of the frame is *measurable* rather than clipped into looking fine.
     * `overflow: hidden` on `.app` is what hides the defect from a reader —
     * which is how the Explorer toolbar and the Data table got through review.
     */
    /*
     * The terminal boards (TV-T17).
     *
     * `.app` is the 1440 px application frame and the cockpit's boards have
     * none, so every rule above passed them by saying nothing. A terminal board
     * has its own frame — `.term`, a fixed number of columns wide — and the same
     * question is worth asking of it: is anything drawn past the edge, and does
     * the frame fill the rows it claims?
     */
    for (const term of document.querySelectorAll(".term")) {
      const edge = box(term);
      for (const element of term.querySelectorAll("*")) {
        const one = box(element);
        if (one.width === 0 && one.height === 0) continue;
        if (one.right > edge.right + 1) {
          problems.push(
            `"${(element.textContent ?? "").trim().slice(0, 40)}" is ` +
              `${Math.round(one.right - edge.right)}px past the right edge of its terminal`,
          );
        }
        if (one.bottom > edge.bottom + 1) {
          problems.push(
            `"${(element.textContent ?? "").trim().slice(0, 40)}" is ` +
              `${Math.round(one.bottom - edge.bottom)}px below its terminal`,
          );
        }
      }
      /*
       * And the frame is filled. A terminal board drawn with rows to spare is
       * drawing the defect this whole specification is about: a cockpit as tall
       * as its content, with the rest of the screen black.
       */
      const rows = [...term.querySelectorAll(".r, .sbar, .foot, .modes, .hand")];
      if (rows.length > 0) {
        const lowest = Math.max(...rows.map((one) => box(one).bottom));
        const spare = edge.bottom - lowest;
        if (spare > edge.height * 0.5) {
          problems.push(
            `a terminal board leaves ${Math.round(spare)}px of its ${Math.round(edge.height)}px unused`,
          );
        }
      }
    }

    const frame = document.querySelector(".app");
    if (frame !== null) {
      const edge = box(frame);
      for (const element of frame.querySelectorAll("*")) {
        const one = box(element);
        if (one.width === 0 && one.height === 0) continue;
        if (one.right > edge.right + 1) {
          problems.push(
            `"${(element.textContent ?? "").trim().slice(0, 40)}" is ` +
              `${Math.round(one.right - edge.right)}px past the right edge of the artboard`,
          );
        }
      }
    }

    // One line per problem, and never the same one twice.
    return [...new Set(problems)];
  });

  if (shoot !== undefined) {
    mkdirSync(shoot, { recursive: true });
    await page.screenshot({ path: join(shoot, file.replace(".html", ".png")), fullPage: true });
  }

  if (found.length === 0) {
    process.stdout.write(`ok    ${file}\n`);
  } else {
    failures.push({ file, found });
    process.stdout.write(`FAIL  ${file}\n`);
    for (const one of found) process.stdout.write(`      → ${one}\n`);
  }
}

await browser.close();

process.stdout.write(
  failures.length === 0
    ? `\n${artboards.length} artboard(s) fit their frames.\n`
    : `\n${failures.length} of ${artboards.length} artboard(s) do not fit their frames.\n`,
);
process.exit(failures.length === 0 ? 0 : 1);
