#!/usr/bin/env node
/**
 * The ADE's renderer tree, over CDP, against its accessibility snapshot
 * (T11.5, REQ-SELF-3, LLD §13.9).
 *
 *   node scripts/tree-agreement.mjs [--json]
 *
 * > What stays external on purpose: the ground-truth keys of the healing eval,
 * > axe-core on the component sheet, and **the tree-agreement oracle, which
 * > reads the ADE's renderer tree over CDP and compares roles, names, and ids
 * > with the AX or UIA snapshot of the same screen**. Those three sit below the
 * > surface and are what keeps the gate from grading its own homework.
 *
 * ## Why this is not something Yam can check about itself
 *
 * Every other check in the parity gate has two implementations that both go
 * *through* something Yam wrote: a flow through an adapter, a Playwright case
 * through a browser. This one is about whether the adapter's picture of a window
 * is the window. Its two sides are the DOM Chromium renders and the
 * accessibility tree macOS publishes from it, and Yam is in neither: the
 * comparison happens outside the surface entirely, which is precisely why it is
 * worth having.
 *
 * ## What "agree" means
 *
 * Every control the renderer publishes with an `id` and an accessible name must
 * appear in the accessibility snapshot with **the same id, the same normalised
 * role and the same name**. Not the other way round: the snapshot also carries
 * the window's own chrome, which the DOM has never heard of (P10-F2). And not
 * every DOM node: a `<div>` with an id is not a control, and the accessibility
 * tree is right to leave it out.
 *
 * Exit 0 when they agree, 1 when they do not, 2 when the host cannot be asked —
 * no macOS, no packaged ADE, no accessibility permission, a locked display.
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const json = args.includes("--json");
const bundle = join(ROOT, "apps", "ade", "out", "Yam ADE-darwin-arm64", "Yam ADE.app");
const executable = join(bundle, "Contents", "MacOS", "Yam ADE");
const cli = join(ROOT, "packages", "cli", "dist", "bin.js");
const project = join(ROOT, "evals", "fixtures");
const PORT = 9800 + Math.floor(Math.random() * 150);

const unreachable = (why) => {
  process.stderr.write(`${why}\n`);
  process.exit(2);
};

if (process.platform !== "darwin") {
  unreachable("The tree-agreement oracle compares an AX snapshot; that needs macOS.");
}
if (!existsSync(executable)) {
  unreachable(`The ADE is not packaged (${executable}). Run \`pnpm --filter @svatah/yam-ade package\`.`);
}
if (!existsSync(cli)) unreachable("Run `pnpm -r build` first.");

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = () =>
  (spawnSync("pgrep", ["-f", executable], { encoding: "utf8" }).stdout ?? "")
    .split("\n")
    .filter((one) => one.trim() !== "");

function stop() {
  if (alive().length === 0) return;
  spawnSync("osascript", ["-e", 'tell application id "com.electron.yam-ade" to quit'], {
    encoding: "utf8",
  });
  for (let waited = 0; waited < 20_000 && alive().length > 0; waited += 250) {
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 250)"]);
  }
  if (alive().length > 0) spawnSync("pkill", ["-f", executable], { encoding: "utf8" });
}

/* ── 1. one ADE, with a debugging port and the accessibility tree published ── */

stop();
const environment = {
  YAM_A11Y: "1",
  YAM_ADE_DEBUG: "1",
  YAM_CLI: cli,
  YAM_ADE_PROJECT: project,
};
const open = ["-n", "-F"];
for (const [name, value] of Object.entries(environment)) open.push("--env", `${name}=${value}`);
open.push("-a", bundle, "--args", `--remote-debugging-port=${PORT}`);
if (spawnSync("open", open, { encoding: "utf8" }).status !== 0) {
  unreachable(`\`open\` refused to launch ${bundle}.`);
}

/** The renderer's DevTools endpoint. */
async function page() {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const found = targets.find((one) => one.type === "page" && one.webSocketDebuggerUrl);
      if (found !== undefined) return found;
    } catch {
      // Not up yet.
    }
    await sleep(500);
  }
  return undefined;
}

const target = await page();
if (target === undefined) {
  stop();
  unreachable(`The ADE published no DevTools endpoint on ${PORT} within 45 s.`);
}

/* ── 2. the renderer's own controls, over CDP ─────────────────────────────── */

const { chromium } = await import("playwright");
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORT}`);
const context = browser.contexts()[0];
const renderer = context?.pages()[0];
if (renderer === undefined) {
  await browser.close();
  stop();
  unreachable("The ADE's browser context has no page.");
}

// Wait for the project, so both sides are looking at the same screen.
await renderer.waitForSelector("#rail-flows", { timeout: 60_000 }).catch(() => undefined);
await renderer.waitForFunction(
  () => document.querySelectorAll("#workspace [id]").length > 0,
  undefined,
  { timeout: 60_000 },
).catch(() => undefined);
await renderer.waitForTimeout(1_000);

const fromRenderer = await renderer.evaluate(() => {
  const roleOf = (el) => {
    const explicit = el.getAttribute("role");
    if (explicit !== null) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a") return el.hasAttribute("href") ? "link" : "generic";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "h1" || tag === "h2" || tag === "h3") return "heading";
    if (tag === "input") {
      const type = (el.getAttribute("type") ?? "text").toLowerCase();
      if (type === "checkbox") return "checkbox";
      if (type === "search") return "searchbox";
      return "textbox";
    }
    return "";
  };
  const nameOf = (el) => {
    const label = el.getAttribute("aria-label");
    if (label !== null && label.trim() !== "") return label.trim();
    const by = el.getAttribute("aria-labelledby");
    if (by !== null) {
      const target = document.getElementById(by);
      if (target !== null) return (target.textContent ?? "").replace(/[ \t\n]+/g, " ").trim();
    }
    return [...el.childNodes]
      .map((node) => {
        if (node.nodeType === 3) return node.textContent ?? "";
        if (node.nodeType !== 1) return "";
        if (node.getAttribute("aria-hidden") === "true" || node.hidden) return "";
        return node.textContent ?? "";
      })
      .join(" ")
      .replace(/[ \t\n]+/g, " ")
      .trim();
  };
  /*
   * The roles a flow can *name*, and nothing else.
   *
   * A `tabpanel` with an id is a container, and its "accessible name" is
   * whatever text happens to be inside it — the whole of a flow file, in one
   * case measured here. The comparison is about the controls a sentence can
   * address, which is LLD §13.7's list plus headings.
   */
  const NAMEABLE = new Set([
    "button", "link", "textbox", "searchbox", "checkbox", "radio",
    "combobox", "option", "tab", "switch", "menuitem", "heading",
  ]);
  /*
   * The name a person *sees*, `text-transform` included.
   *
   * macOS publishes the rendered text, so a section heading styled
   * `text-transform: uppercase` has the accessible name "INSPECTOR" while its
   * `textContent` is "Inspector". The adapter is right and `textContent` is the
   * wrong source: LLD §13.7's contract is "a visible label that is its
   * accessible name", and the visible label is the transformed one. This oracle
   * found that difference, which is what it is for.
   */
  const transformed = (el, text) => {
    const how = getComputedStyle(el).textTransform;
    if (how === "uppercase") return text.toUpperCase();
    if (how === "lowercase") return text.toLowerCase();
    if (how === "capitalize") {
      return text.replace(/\b[a-z]/g, (one) => one.toUpperCase());
    }
    return text;
  };
  /** A framework's own id is not something a binding would ever be written on. */
  const generated = (id) => /^(radix|mui|:r|react-aria)|[-_]:?r[0-9a-z]+:?/i.test(id);

  const out = [];
  for (const el of document.querySelectorAll("[id]")) {
    const role = roleOf(el);
    if (!NAMEABLE.has(role)) continue;
    if (generated(el.id)) continue;
    if (el.hidden || el.closest("[hidden]") !== null) continue;
    if (el.closest("[aria-hidden='true']") !== null) continue;
    const name = transformed(el, nameOf(el));
    if (name === "") continue;
    out.push({ id: el.id, role, name });
  }
  return out;
});
await browser.close();

/* ── 3. the accessibility snapshot of the same window ─────────────────────── */

const { createSurface } = await import(join(ROOT, "packages", "surface", "dist", "index.js"));
const ax = await import(join(ROOT, "packages", "adapter-ax", "dist", "index.js"));
const { DEFAULT_CONFIG } = await import(join(ROOT, "packages", "schema", "dist", "index.js"));
ax.registerAxAdapter();

let snapshot;
try {
  const surface = await createSurface({
    ...DEFAULT_CONFIG,
    project: "tree-agreement",
    adapter: "ax",
    app: { processName: "Yam ADE" },
  });
  await surface.open({ processName: "Yam ADE" });
  snapshot = await surface.snapshot();
} catch (error) {
  stop();
  const doctor = spawnSync(process.execPath, [cli, "surface", "doctor", "--adapter", "ax"], {
    encoding: "utf8",
  });
  unreachable(
    `The accessibility snapshot could not be taken: ${String(error)}\n${doctor.stdout ?? ""}`,
  );
}
stop();

/* ── 4. the comparison ────────────────────────────────────────────────────── */

const byId = new Map();
for (const node of snapshot.nodes) {
  const id = node.native?.automationId;
  if (id !== undefined && id !== "") byId.set(id, node);
}

const disagreements = [];
let compared = 0;
for (const control of fromRenderer) {
  const node = byId.get(control.id);
  if (node === undefined) {
    disagreements.push({
      id: control.id,
      what: "missing",
      renderer: `${control.role} "${control.name}"`,
      adapter: "not in the accessibility snapshot",
    });
    continue;
  }
  compared += 1;
  if (node.role !== control.role) {
    disagreements.push({
      id: control.id,
      what: "role",
      renderer: control.role,
      adapter: node.role,
    });
  }
  /*
   * Names are compared after collapsing whitespace, and nothing else: an
   * adapter that "helpfully" trimmed a name would be an adapter a flow sentence
   * could not address, and that is what this is for.
   */
  const rendered = control.name.replace(/\s+/g, " ").trim();
  const adapted = (node.name ?? "").replace(/\s+/g, " ").trim();
  if (rendered !== adapted) {
    disagreements.push({ id: control.id, what: "name", renderer: rendered, adapter: adapted });
  }
}

const summary = {
  controlsInRenderer: fromRenderer.length,
  nodesInSnapshot: snapshot.nodes.length,
  identifiedInSnapshot: byId.size,
  compared,
  disagreements,
};

if (json) process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
else {
  for (const one of disagreements) {
    process.stderr.write(
      `  ${one.id}: ${one.what} — renderer ${JSON.stringify(one.renderer)}, ` +
        `adapter ${JSON.stringify(one.adapter)}\n`,
    );
  }
  process.stdout.write(
    disagreements.length === 0
      ? `the renderer and the accessibility snapshot agree about ${compared} identified ` +
          `control(s) (${fromRenderer.length} in the DOM, ${snapshot.nodes.length} in the tree)\n`
      : `${disagreements.length} disagreement(s) over ${fromRenderer.length} identified ` +
          "control(s)\n",
  );
}

// A comparison of nothing is not an agreement.
if (compared === 0) {
  process.stderr.write(
    "No identified control was in both, so nothing was compared. That is not agreement.\n",
  );
  process.exit(1);
}
process.exit(disagreements.length === 0 ? 0 : 1);