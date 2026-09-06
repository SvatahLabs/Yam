#!/usr/bin/env node
/**
 * Record the app's accessibility tree for the desktop adapters (T6.1, T6.2,
 * LLD §7.5).
 *
 *   node scripts/record-desktop-tree.mjs --shape ax  [--screen record]
 *   node scripts/record-desktop-tree.mjs --shape uia [--screen record]
 *
 * ## What this records, and what it does not
 *
 * It records **Chromium's own accessibility tree** for the app's window,
 * through `Accessibility.getFullAXTree` over the DevTools protocol, and maps it
 * into the shape one of the desktop adapters consumes: the `AXRole` /
 * `AXTitle` / `AXDOMIdentifier` names Chromium publishes on macOS, or the
 * `ControlType` / `Name` / `AutomationId` names it publishes to UI Automation
 * on Windows. Same tree, two vocabularies — which is what REQ-SURF-4 asks the
 * adapters to normalise back to one.
 *
 * It does **not** read `AXUIElement`, and it does not read a UIA tree. Reading
 * the first needs the macOS Accessibility permission, which cannot be granted
 * in a non-interactive session (the prompt blocks and the Apple event times out
 * at `-1712`); reading the second needs Windows. A tree recorded here is
 * therefore one step removed from what a bridge would return: it is the tree
 * Chromium's platform bridges serialise *from*, which is why the roles and the
 * names are real, and it is not proof that either bridge works.
 *
 * That distinction is the whole reason this script exists rather than a
 * hand-written fixture. `docs/spec/progress/phase-6.md` states the live gates
 * that remain, and the commands that close them.
 *
 * ## The two screens that need a run (T11.1)
 *
 * `--screen results` and `--screen run` are *about* a run, and
 * `evals/fixtures/runs/` is ignored by git and empty in a fresh checkout. So
 * those two are recorded with one seeded and it is taken out again — the
 * committed project must not keep it (Draft 2.12 §13.7, P9-F5, and
 * `tools/repo-checks/test/screen-fixtures.test.ts` fails when it does):
 *
 *   node scripts/seed-fixture-run.mjs
 *   node scripts/record-desktop-tree.mjs --shape both --screen results
 *   node scripts/record-desktop-tree.mjs --shape both --screen run
 *   node scripts/seed-fixture-run.mjs --remove
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = join(ROOT, "apps", "desktop");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const project = resolve(ROOT, option("project", "evals/fixtures"));
const shapeOption = option("shape", "both");
if (!["ax", "uia", "both"].includes(shapeOption)) {
  process.stderr.write(`--shape must be "ax", "uia" or "both", not "${shapeOption}"\n`);
  process.exit(1);
}
/*
 * `both` by default, and both from *one* read of *one* window.
 *
 * `packages/adapter-uia/test/parity.test.ts` compares the two adapters'
 * normalisation of the same window, and two separate launches are not the same
 * window: the app's service takes an ephemeral port, so the URL in its header
 * differs, and the Results screen lists the runs that exist at the time. Both
 * showed up as parity failures that were really recording noise.
 */
const shapes = shapeOption === "both" ? ["ax", "uia"] : [shapeOption];
const outOption = option("out", undefined);
/**
 * Which APP_DIR accessibility variant to record (Draft 2.8 LLD §16, T7.1).
 *
 * `0` is the real interface. `1` renames a screen tab and a Project button; `2`
 * moves the Record screen's gateway control into another panel. The desktop
 * healing cases need a *pair* of trees — before and after — and this is how the
 * "after" gets recorded without a granted Accessibility permission, exactly as
 * the variant-0 trees were.
 */
const variant = option("variant", "0");
if (!["0", "1", "2"].includes(variant)) {
  process.stderr.write(`--variant must be 0, 1 or 2, not "${variant}"\n`);
  process.exit(1);
}

const cli = join(ROOT, "packages", "cli", "dist", "bin.js");
const entry = join(APP_DIR, ".vite", "build", "main.js");
for (const [what, path] of [["the CLI", cli], ["the app build", entry]]) {
  if (!existsSync(path)) {
    process.stderr.write(`${what} is not built (${path}). Run \`pnpm -r build\` and \`pnpm --filter @svatah/yam-desktop exec electron-forge package\`.\n`);
    process.exit(1);
  }
}

/** A free port, so a stray Electron from an earlier run cannot block this one. */
const PORT = 9300 + Math.floor(Math.random() * 400);
const electron = join(ROOT, "node_modules", "electron", "cli.js");
const child = spawn(
  process.execPath,
  [electron, `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*", APP_DIR],
  {
    cwd: APP_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      YAM_CLI: cli,
      YAM_A11Y: "1",
      ...(variant === "0" ? {} : { YAM_A11Y_VARIANT: variant }),
      /*
       * The project the app opens on (T8.1, §13.6, T10.3).
       *
       * `YAM_APP_PROJECT` is the variable the main process reads; the name
       * here used to be `YAM_APP_RECORD_PROJECT`, which nothing read, so
       * every tree was recorded against an app with no project open. That was
       * invisible while the Project screen was the default and drew its "Open a
       * project…" button either way; with the rail it is not — a project-less
       * window has no rail at all.
       */
      YAM_APP_PROJECT: project,
    },
  },
);
let log = "";
child.stdout.on("data", (chunk) => (log += String(chunk)));
child.stderr.on("data", (chunk) => (log += String(chunk)));

const deadline = setTimeout(() => {
  child.kill("SIGKILL");
  process.stderr.write(`timed out waiting for the app\n${log}\n`);
  process.exit(1);
}, 120_000);

/** Wait for the DevTools endpoint to answer, then take the renderer target. */
async function target() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const targets = await response.json();
      const page = targets.find((one) => one.type === "page" && one.webSocketDebuggerUrl);
      if (page !== undefined) return page;
    } catch {
      // Not up yet.
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  throw new Error("the app never opened a debuggable page");
}

/** A minimal CDP client: one socket, numbered messages. */
async function connect(url) {
  // Node 22's own `WebSocket`, which is why this needs no dependency.
  const socket = new globalThis.WebSocket(url);
  await new Promise((done, fail) => {
    socket.addEventListener("open", done, { once: true });
    socket.addEventListener("error", fail, { once: true });
  });
  let next = 0;
  const pending = new Map();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data));
    const waiting = pending.get(message.id);
    if (waiting === undefined) return;
    pending.delete(message.id);
    if (message.error !== undefined) waiting.fail(new Error(JSON.stringify(message.error)));
    else waiting.done(message.result);
  });
  return {
    send: (method, params = {}) =>
      new Promise((done, fail) => {
        const id = (next += 1);
        pending.set(id, { done, fail });
        socket.send(JSON.stringify({ id, method, params }));
      }),
    close: () => socket.close(),
  };
}

/**
 * Chromium AX node → the `AxNode` of `packages/adapter-ax/src/bridge.ts`.
 *
 * The mapping is Chromium's own macOS bridge, read from its source of truth:
 * an ARIA role becomes an `AXRole` through the table below, `name` becomes
 * `AXTitle` for a control whose name comes from its contents and `AXDescription`
 * for one named by `aria-label`, and the DOM `id` becomes `AXDOMIdentifier`.
 */
/**
 * How each recordable screen is reached (T10.3).
 *
 * The eleven tabs are gone; the app is a rail of eight and a palette that has a
 * `Go to` row for every screen (LLD §13.7). So a screen is either a rail item's
 * `automationId` or a palette label — and the recorder navigates the way the
 * conformance cases do, so a tree it records is a tree they can be run against.
 *
 * The names on the left are the *file* names: `app-flows.json` and the rest are
 * read by `packages/adapter-ax/test` and `packages/adapter-uia/test`, and
 * renaming them would be renaming fixtures for no reason.
 */
const SCREENS = {
  project: { rail: "rail-settings", label: "Settings" },
  flows: { rail: "rail-flows", label: "Flows" },
  runs: { rail: "rail-runs", label: "Runs" },
  results: { rail: "rail-runs", label: "Runs" },
  bindings: { rail: "rail-bindings", label: "Bindings" },
  agents: { rail: "rail-agents", label: "Agents and tools" },
  api: { rail: "rail-api", label: "API" },
  data: { rail: "rail-data", label: "Data" },
  import: { rail: "rail-import", label: "Import prototype database" },
  settings: { rail: "rail-settings", label: "Settings" },
  /*
   * The command palette itself, open (T10.3).
   *
   * The conformance suite reaches four screens through it, and a recorded tree
   * of the application *without* it can only show the button that opens one.
   * `Palette` is one of the approved artboards, so a tree of it is a tree of a
   * screen the design has.
   */
  palette: { open: true, label: "Command palette" },
  /* The four the rail does not carry: reached through the palette. */
  run: { palette: "run", label: "Run" },
  record: { palette: "record", label: "Record review" },
  heal: { palette: "heal", label: "Heal review" },
  explorer: { palette: "explorer", label: "Surface explorer" },
};

const AX_ROLE_FOR = {
  RootWebArea: "AXWebArea",
  button: "AXButton",
  checkbox: "AXCheckBox",
  columnheader: "AXCell",
  combobox: "AXPopUpButton",
  ComboBox: "AXPopUpButton",
  complementary: "AXGroup",
  document: "AXWebArea",
  generic: "AXGroup",
  group: "AXGroup",
  heading: "AXHeading",
  image: "AXImage",
  link: "AXLink",
  list: "AXList",
  listitem: "AXGroup",
  listbox: "AXList",
  main: "AXGroup",
  menu: "AXMenu",
  menuitem: "AXMenuItem",
  navigation: "AXGroup",
  // Chromium's macOS bridge publishes a `<select>`'s option as a menu item
  // (`kMenuListOption` → `NSAccessibilityMenuItemRole`), inside the pop-up
  // button's menu. The adapter turns it back into an `option` from that parent.
  option: "AXMenuItem",
  paragraph: "AXGroup",
  radio: "AXRadioButton",
  region: "AXGroup",
  row: "AXRow",
  rowheader: "AXCell",
  StaticText: "AXStaticText",
  status: "AXGroup",
  table: "AXTable",
  tab: "AXRadioButton",
  tablist: "AXTabGroup",
  textbox: "AXTextField",
  alert: "AXGroup",
  cell: "AXCell",
  code: "AXGroup",
  banner: "AXGroup",
  contentinfo: "AXGroup",
  LineBreak: "AXStaticText",
  // Chromium's leaf text runs. Its macOS bridge publishes them as static text,
  // which is why they are here rather than dropped: a name is often on the run.
  InlineTextBox: "AXStaticText",
  none: "AXGroup",
  presentation: "AXGroup",
  pre: "AXGroup",
};
/**
 * Chromium AX role → the UIA `ControlType` it publishes on Windows.
 *
 * The other half of REQ-SURF-4's claim. A `<button>` is `AXButton` on macOS and
 * `ControlType.Button` on Windows; an `<input type=text>` is `AXTextField` and
 * `ControlType.Edit`; an ARIA `tab` is `AXRadioButton` (with the `AXTabButton`
 * subrole) and `ControlType.TabItem`. The adapters map both back to `button`,
 * `textbox` and `tab`, which is what makes one flow drive the app on both.
 */
const UIA_CONTROL_TYPE_FOR = {
  RootWebArea: "Document",
  alert: "Group",
  banner: "Group",
  button: "Button",
  cell: "DataItem",
  checkbox: "CheckBox",
  code: "Group",
  columnheader: "HeaderItem",
  combobox: "ComboBox",
  ComboBox: "ComboBox",
  complementary: "Group",
  contentinfo: "Group",
  document: "Document",
  generic: "Group",
  group: "Group",
  heading: "Text",
  image: "Image",
  InlineTextBox: "Text",
  LineBreak: "Text",
  link: "Hyperlink",
  list: "List",
  listbox: "List",
  // A plain `<li>` is an `AXGroup` on macOS, so it is a `Group` here too: this
  // table's job is to be the *same window* in a second vocabulary, and a
  // `ListItem` would make one element two roles (T10.3, the parity check).
  listitem: "Group",
  main: "Group",
  menu: "Menu",
  menuitem: "MenuItem",
  navigation: "Group",
  none: "Group",
  option: "ListItem",
  paragraph: "Group",
  pre: "Group",
  presentation: "Group",
  radio: "RadioButton",
  region: "Group",
  row: "DataItem",
  rowheader: "HeaderItem",
  StaticText: "Text",
  status: "Group",
  tab: "TabItem",
  table: "Table",
  tablist: "Tab",
  textbox: "Edit",
};

/**
 * The roles Chromium names in `LocalizedControlType` on Windows.
 *
 * UIA has no landmark control types and no subrole: a `<header>` is
 * `ControlType.Group` and a `<h1>` is `ControlType.Text`, and the refinement is
 * this string. Without it every landmark in the app reads as a plain group and
 * every heading as text — which is exactly what the cross-adapter parity check
 * found (`packages/adapter-uia/test/parity.test.ts`).
 */
const UIA_LOCALIZED_FOR = new Set([
  "heading",
  "tab",
  "banner",
  "navigation",
  "main",
  "complementary",
  "contentinfo",
  "region",
  "search",
  "form",
  "status",
  "alert",
]);

/** The UIA `ClassName` Chromium reports for a web element. */
const UIA_CLASS_NAME = "Chrome_RenderWidgetHostHWND";

/**
 * The UIA control patterns a Chromium element supports.
 *
 * A pattern is UIA's equivalent of an AX action: `Invoke` presses, `Value` sets
 * text, `SelectionItem` selects, `Toggle` checks, `ExpandCollapse` opens a
 * dropdown. LLD §7.5's "act via UIA patterns (Invoke, Value, Toggle, Selection,
 * Scroll) with a mouse/keyboard fallback" is a list of these.
 */
function uiaPatternsFor(role) {
  const patterns = [];
  if (["button", "link", "menuitem"].includes(role)) patterns.push("Invoke");
  if (["textbox", "combobox"].includes(role)) patterns.push("Value");
  if (["tab", "option", "radio"].includes(role)) patterns.push("SelectionItem");
  if (role === "checkbox") patterns.push("Toggle");
  if (role === "combobox") patterns.push("ExpandCollapse");
  if (["list", "listbox", "table", "document"].includes(role)) patterns.push("Scroll");
  return patterns;
}

const AX_SUBROLE_FOR = {
  tab: "AXTabButton",
  main: "AXLandmarkMain",
  navigation: "AXLandmarkNavigation",
  banner: "AXLandmarkBanner",
  contentinfo: "AXLandmarkContentInfo",
  complementary: "AXLandmarkComplementary",
  region: "AXLandmarkRegion",
  status: "AXApplicationStatus",
  alert: "AXApplicationAlert",
};

function property(node, name) {
  const found = (node.properties ?? []).find((one) => one.name === name);
  return found?.value?.value;
}

async function main() {
  const page = await target();
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send("Accessibility.enable");
  await cdp.send("DOM.enable");
  await cdp.send("Runtime.enable");

  /*
   * Open the project through the app's own preload bridge, and then click the
   * screen's tab — the same two things a person does, driven from outside.
   *
   * `window.yam.openProject` is the bridge the renderer uses; using it rather
   * than reaching into React's state is what makes this a recording of the
   * application rather than of a rendering of it. The tab is clicked by its
   * accessible name, which is the name the AX tree will show and the name a
   * Yam flow would use.
   */
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails !== undefined) throw new Error(JSON.stringify(exceptionDetails));
    return result.value;
  };

  /*
   * The project opens two ways, and this waits for whichever happened (T10.3).
   *
   * `YAM_APP_PROJECT` opens one on ready (§13.6), so the shell is usually
   * already up by the time this attaches — and then there is no Recent list to
   * click, because the welcome screen is not showing. When the renderer came up
   * before the main process announced the project, it *is* showing, and the
   * Recent button is what a person would press: the app's own click handler is
   * what calls `setInfo` and renders the rail, so calling `openProject` from
   * here would start the service and leave React none the wiser.
   */
  await evaluate(
    `window.yam.preferences({ recentProjects: [${JSON.stringify(project)}] }).then(() => "ok")`,
  );

  const name = project.split(/[\\/]/).pop();
  const opened = await (async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if ((await evaluate(`document.getElementById("rail-flows") !== null`)) === true) return true;
      const pressed = await evaluate(
        `(() => {
           const button = [...document.querySelectorAll("button")]
             .find((one) => one.textContent.trim() === ${JSON.stringify(name)});
           if (button === undefined) return false;
           button.click();
           return true;
         })()`,
      );
      if (pressed === true) continue;
      await new Promise((done) => setTimeout(done, 500));
    }
    return false;
  })();
  if (opened !== true) {
    const body = await evaluate(`document.body.innerText.slice(0, 400)`);
    throw new Error(`the app did not open "${name}"; it shows:\n${body}`);
  }

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await evaluate(`document.querySelectorAll('#rail-flows').length`);
    if (Number(ready) > 0) break;
    await new Promise((done) => setTimeout(done, 500));
  }

  const screen = option("screen", "flows");
  const where = SCREENS[screen];
  if (where === undefined) {
    throw new Error(`unknown --screen ${screen}; one of ${Object.keys(SCREENS).join(", ")}`);
  }

  /*
   * By `id` first, always. Variant 1 renames a rail item (LLD §16), and a
   * recorder that could only find one by its text would be unable to record the
   * very variant it exists to record.
   */
  const clicked =
    where.rail !== undefined
      ? await evaluate(
          `(() => {
             const item = document.getElementById(${JSON.stringify(where.rail)});
             if (item === null) return false;
             item.click();
             return true;
           })()`,
        )
      : await evaluate(
          `(() => {
             const open = document.getElementById("open-command-palette");
             if (open === null) return false;
             open.click();
             return true;
           })()`,
        );
  if (clicked !== true) {
    const seen = await evaluate(
      `JSON.stringify([...document.querySelectorAll("[id^='rail-']")].map((o) => o.id))`,
    );
    const body = await evaluate(`document.body.innerText.slice(0, 400)`);
    throw new Error(`the app cannot reach the "${where.label}" screen; its rail is ${seen}\n${body}`);
  }

  if (where.open === true) {
    // Just the palette: opened, and recorded as it is.
    await new Promise((done) => setTimeout(done, 800));
  }

  if (where.palette !== undefined) {
    /*
     * The palette is open: choose its `Go to` row **by id**.
     *
     * By id and never by text: "Go to Run" is a substring of "Go to Runs", so a
     * text search picked the wrong row and recorded the Flows screen under two
     * names. Every palette row carries `palette-go-<screen>`, which is what a
     * desktop binding would use too.
     */
    await new Promise((done) => setTimeout(done, 500));
    const rowId = `palette-go-${where.palette}`;
    const chose = await evaluate(
      `(() => {
         const row = document.getElementById(${JSON.stringify(rowId)});
         if (row === null) return false;
         row.click();
         return true;
       })()`,
    );
    if (chose !== true) {
      const rows = await evaluate(
        `JSON.stringify([...document.querySelectorAll(".sv-palette-row")].map((o) => o.id).slice(0, 40))`,
      );
      throw new Error(`the palette has no "${rowId}" row; it shows ${rows}`);
    }
  }
  /*
   * Wait for the *workspace* to have something in it, not for a fixed time.
   *
   * A screen is a `load()` over five or six endpoints — the Flows screen reads
   * the plan, the runs, the bindings and a compile — and on a cold service that
   * takes longer than any sleep worth writing. Two seconds produced trees of the
   * chrome with an empty middle, which look plausible and assert nothing.
   */
  const settled = await (async () => {
    // The palette is a dialog over the workspace; what says it is ready is its
    // own rows, not the screen behind it.
    if (where.open === true) {
      for (let attempt = 0; attempt < 60; attempt += 1) {
        const rows = await evaluate(`document.querySelectorAll(".sv-palette-row").length > 10`);
        if (rows === true) return true;
        await new Promise((done) => setTimeout(done, 500));
      }
      return false;
    }
    for (let attempt = 0; attempt < 60; attempt += 1) {
      /*
       * "Filled" is "not still loading", not "has no empty state": the API
       * screen's response panel says "Press Send" until somebody does, and the
       * Record screen says there is no session — both are what those screens
       * look like, not what they look like before they have loaded.
       *
       * The inspector counts too, and `>= 3` rather than `> 3` is the line
       * between "has not rendered" and "has rendered its own empty state",
       * which is a section, a heading and a sentence. The Runs screen's
       * inspector loads a second request after the table, and a tree taken
       * before it landed is a tree the `app.result` case cannot read.
       */
      const filled = await evaluate(
        `document.querySelectorAll(".sv-workspace *").length > 30 &&
         document.querySelectorAll(".sv-inspector *").length >= 3 &&
         !document.body.innerText.includes("Loading…")`,
      );
      if (filled === true) return true;
      await new Promise((done) => setTimeout(done, 500));
    }
    return false;
  })();
  if (settled !== true) {
    const body = await evaluate(`document.querySelector(".sv-workspace")?.innerText.slice(0, 300)`);
    throw new Error(`the "${where.label}" screen did not fill within 30 s; it shows:\n${body}`);
  }
  // And a moment more, so an animation or a late row is in the tree too.
  await new Promise((done) => setTimeout(done, 1_000));

  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));

  /* Boxes and DOM ids, read once and shared by both shapes. */
  const geometry = new Map();
  for (const node of nodes) {
    if (node.backendDOMNodeId === undefined) continue;
    const entry = {};
    try {
      const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId: node.backendDOMNodeId });
      const [x1, y1, , , x3, y3] = model.border;
      entry.box = [Math.round(x1), Math.round(y1), Math.round(x3 - x1), Math.round(y3 - y1)];
    } catch {
      // An element with no layout box has none; the adapters read that as hidden.
    }
    try {
      const { node: dom } = await cdp.send("DOM.describeNode", {
        backendNodeId: node.backendDOMNodeId,
      });
      const attributes = dom.attributes ?? [];
      for (let a = 0; a < attributes.length; a += 2) {
        if (attributes[a] === "id" && attributes[a + 1] !== "") entry.domId = attributes[a + 1];
      }
    } catch {
      // A pseudo-element or a text node has no attributes.
    }
    geometry.set(node.nodeId, entry);
  }

  const { result } = await cdp.send("Runtime.evaluate", { expression: "document.title" });
  const title = result.value ?? "Yam";

  for (const shape of shapes) {
    writeShape(shape, { nodes, byId, geometry, title, screen });
  }

  cdp.close();
  clearTimeout(deadline);
  child.kill("SIGTERM");
  process.exit(0);
}

/** One read of one window, written in one platform's vocabulary. */
function writeShape(shape, { nodes, byId, geometry, title, screen }) {
  const flat = [];
  const index = new Map();
  const walk = (node, parent) => {
    if (node.ignored === true) {
      for (const child of node.childIds ?? []) {
        const next = byId.get(child);
        if (next !== undefined) walk(next, parent);
      }
      return;
    }
    const role = node.role?.value ?? "generic";
    const name = (node.name?.value ?? "").replace(/\s+/g, " ").trim();
    const description = (node.description?.value ?? "").replace(/\s+/g, " ").trim();
    const value = node.value?.value;

    const at = flat.length;
    index.set(node.nodeId, at);
    const mapped =
      shape === "uia"
        ? { parent, controlType: UIA_CONTROL_TYPE_FOR[role] ?? "Custom", className: UIA_CLASS_NAME }
        : { parent, role: AX_ROLE_FOR[role] ?? "AXUnknown" };
    const subrole = AX_SUBROLE_FOR[role];
    if (shape === "ax" && subrole !== undefined) mapped.subrole = subrole;
    /*
     * UIA has no subrole, and Chromium says "this Text is a heading" through
     * `LocalizedControlType` instead. The adapter reads it the same way.
     */
    if (shape === "uia" && UIA_LOCALIZED_FOR.has(role)) {
      mapped.localizedControlType = role;
    }
    /*
     * Chromium puts a name that came from the element's own contents in
     * `AXTitle`, and one that came from `aria-label` in `AXDescription`. The
     * `from` of the name's source is what says which.
     */
    const from = node.name?.sources?.find((one) => one.value !== undefined)?.type;
    if (shape === "uia") {
      // UIA has one `Name`, wherever the name came from, and `HelpText` for a
      // tooltip. The macOS split between `AXTitle` and `AXDescription` has no
      // counterpart.
      if (name !== "") mapped.name = name;
      if (description !== "" && description !== name) mapped.helpText = description;
    } else if (name !== "") {
      if (from === "attribute" || from === "relatedElement") mapped.description = name;
      else mapped.title = name;
    }
    if (shape === "ax" && description !== "" && description !== name) mapped.help = description;
    if (typeof value === "string" && value !== "") mapped.value = value;
    if (typeof value === "number") mapped.value = String(value);

    const disabled = property(node, "disabled");
    const focused = property(node, "focused");
    const selected = property(node, "selected");
    const expanded = property(node, "expanded");
    const checked = property(node, "checked");

    if (shape === "uia") {
      mapped.isEnabled = disabled !== true;
      if (focused === true) mapped.hasKeyboardFocus = true;
      if (typeof selected === "boolean") mapped.isSelected = selected;
      if (typeof expanded === "boolean") {
        mapped.expandCollapseState = expanded ? "Expanded" : "Collapsed";
      }
      if (checked === "true") mapped.toggleState = "On";
      else if (checked === "false") mapped.toggleState = "Off";
      else if (checked === "mixed") mapped.toggleState = "Indeterminate";
      const patterns = uiaPatternsFor(role);
      if (patterns.length > 0) mapped.patterns = patterns;
    } else {
      mapped.enabled = disabled !== true;
      if (focused === true) mapped.focused = true;
      if (typeof selected === "boolean") mapped.selected = selected;
      if (typeof expanded === "boolean") mapped.expanded = expanded;
      if (checked === "true") mapped.checked = true;
      else if (checked === "false") mapped.checked = false;

      // The actions a Chromium AX node offers on macOS: everything focusable and
      // clickable gets AXPress; a text field also gets AXConfirm and AXSetValue.
      const actions = [];
      if (["button", "link", "tab", "checkbox", "radio", "combobox", "menuitem", "option"].includes(role)) {
        actions.push("AXPress");
      }
      if (role === "textbox" || role === "combobox") actions.push("AXConfirm", "AXSetValue");
      if (actions.length > 0) mapped.actions = actions;
    }

    const geo = geometry.get(node.nodeId);
    if (geo?.box !== undefined) mapped.box = geo.box;
    if (geo?.domId !== undefined) {
      /*
       * "`automationId` is populated from `id` attributes on Windows and from
       * `aria-label` or `AXIdentifier` on macOS" (LLD §7.5). On Windows the
       * `id` *is* the `AutomationId`, so there is no second field for it.
       */
      if (shape === "uia") mapped.automationId = geo.domId;
      else mapped.domIdentifier = geo.domId;
    }

    flat.push(mapped);
    for (const child of node.childIds ?? []) {
      const next = byId.get(child);
      if (next !== undefined) walk(next, at);
    }
  };

  const webArea = nodes.find((node) => node.role?.value === "RootWebArea") ?? nodes[0];
  walk(webArea, -1);

  /*
   * The window Chromium's platform bridge puts above the web area: an
   * `AXWindow` on macOS, a `ControlType.Window` on Windows, whose title is the
   * document title. It is not in the CDP tree because CDP describes the *page*;
   * a real AXUIElement or UIA walk starts here.
   */
  const root =
    shape === "uia"
      ? {
          parent: -1,
          controlType: "Window",
          name: title,
          className: "Chrome_WidgetWin_1",
          isEnabled: true,
          box: [0, 0, 1280, 860],
        }
      : { parent: -1, role: "AXWindow", subrole: "AXStandardWindow", title, box: [0, 0, 1280, 860] };
  const window = [root, ...flat.map((node) => ({ ...node, parent: node.parent + 1 }))];
  window[1].parent = 0;

  /*
   * The window's own three buttons (P10-F2, P8-F3).
   *
   * Close, minimise and zoom belong to the window manager, and CDP describes
   * the *page*, so they are not in the tree this reads — exactly as the window
   * above them is not. Synthesising them alongside the window is the same
   * fidelity decision: a real `AXUIElement` walk of the app returns them, the
   * desktop snapshot case checks that a snapshot has them (a tree that stopped
   * reading the window frame is a tree that silently shrank), and a fixture
   * without them is a fixture that cannot answer the question.
   *
   * They carry no id and no title on either platform: macOS names them by
   * subrole and Windows by a fixed `AutomationId`, which is what
   * `isWindowChrome` reads and what exempts them from the id rule.
   *
   * Appended rather than inserted, so every index in the tree above is the
   * index it was: a fixture whose nodes moved is a fixture every recorded
   * `rolePath` and `controlPath` has to be re-derived against.
   */
  const chrome =
    shape === "uia"
      ? [
          ["Close", "Close"],
          ["Minimize", "Minimize"],
          ["Maximize", "Maximize"],
        ].map(([id, name], at) => ({
          parent: 0,
          controlType: "Button",
          name,
          automationId: id,
          className: "Chrome_WidgetWin_1",
          isEnabled: true,
          patterns: ["Invoke"],
          box: [1180 + at * 24, 4, 20, 20],
        }))
      : [
          ["AXCloseButton"],
          ["AXMinimizeButton"],
          ["AXZoomButton"],
        ].map(([subrole], at) => ({
          parent: 0,
          role: "AXButton",
          subrole,
          enabled: true,
          actions: ["AXPress"],
          box: [8 + at * 20, 8, 14, 14],
        }));
  window.push(...chrome);

  const out = resolve(ROOT, outOption ?? `packages/adapter-${shape}/test/fixtures`);
  mkdirSync(out, { recursive: true });
  const file = join(out, `app-${screen}${variant === "0" ? "" : `-v${variant}`}.json`);
  writeFileSync(
    file,
    `${JSON.stringify({ process: "Yam", title, truncated: false, nodes: window }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`wrote ${window.length} node(s) to ${file}\n`);
}

main().catch((error) => {
  clearTimeout(deadline);
  child.kill("SIGKILL");
  process.stderr.write(`${String(error)}\n${log}\n`);
  process.exit(1);
});
