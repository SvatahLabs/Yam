#!/usr/bin/env node
/**
 * Record the ADE's accessibility tree as `AxNode[]` (T6.2, LLD §7.5).
 *
 *   node scripts/record-ax-tree.mjs [--project evals/fixtures] [--screen record]
 *
 * ## What this records, and what it does not
 *
 * It records **Chromium's own accessibility tree** for the ADE's window,
 * through `Accessibility.getFullAXTree` over the DevTools protocol, and maps it
 * into the `AxNode` shape `packages/adapter-ax` consumes — the AX attribute
 * names Chromium publishes on macOS, with the same roles, names, identifiers and
 * boxes.
 *
 * It does **not** read `AXUIElement`. That needs the macOS Accessibility
 * permission, which cannot be granted in a non-interactive session (the prompt
 * blocks and the Apple event times out at `-1712`). A tree recorded here is
 * therefore one step removed from what `osascriptBridge` would return: it is the
 * tree Chromium's macOS AX bridge serialises *from*, which is why the roles and
 * names are real, and it is not proof that the bridge itself works.
 *
 * That distinction is the whole reason this script exists rather than a
 * hand-written fixture. `docs/spec/progress/phase-6.md` states the live gate
 * that remains, and the command that closes it.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ADE = join(ROOT, "apps", "ade");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const project = resolve(ROOT, option("project", "evals/fixtures"));
const out = resolve(ROOT, option("out", "packages/adapter-ax/test/fixtures"));

const cli = join(ROOT, "packages", "cli", "dist", "bin.js");
const entry = join(ADE, ".vite", "build", "main.js");
for (const [what, path] of [["the CLI", cli], ["the ADE build", entry]]) {
  if (!existsSync(path)) {
    process.stderr.write(`${what} is not built (${path}). Run \`pnpm -r build\` and \`pnpm --filter @svatah/ade exec electron-forge package\`.\n`);
    process.exit(1);
  }
}

/** A free port, so a stray Electron from an earlier run cannot block this one. */
const PORT = 9300 + Math.floor(Math.random() * 400);
const electron = join(ROOT, "node_modules", "electron", "cli.js");
const child = spawn(
  process.execPath,
  [electron, `--remote-debugging-port=${PORT}`, "--remote-allow-origins=*", ADE],
  {
    cwd: ADE,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      SVATAH_CLI: cli,
      SVATAH_A11Y: "1",
      SVATAH_ADE_RECORD_PROJECT: project,
    },
  },
);
let log = "";
child.stdout.on("data", (chunk) => (log += String(chunk)));
child.stderr.on("data", (chunk) => (log += String(chunk)));

const deadline = setTimeout(() => {
  child.kill("SIGKILL");
  process.stderr.write(`timed out waiting for the ADE\n${log}\n`);
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
  throw new Error("the ADE never opened a debuggable page");
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
/** The tab labels of `apps/ade/src/renderer/App.tsx`'s `SCREENS`. */
const SCREEN_LABELS = {
  project: "Project",
  flows: "Flow editor",
  plan: "Plan",
  run: "Run",
  results: "Results",
  api: "API client",
  data: "Data",
  record: "Record review",
  bindings: "Bindings",
  explorer: "Surface explorer",
  tools: "Tool panel",
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
  option: "AXStaticText",
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
   * Open the project through the ADE's own preload bridge, and then click the
   * screen's tab — the same two things a person does, driven from outside.
   *
   * `window.ade.openProject` is the bridge the renderer uses; using it rather
   * than reaching into React's state is what makes this a recording of the
   * application rather than of a rendering of it. The tab is clicked by its
   * accessible name, which is the name the AX tree will show and the name a
   * Svatah flow would use.
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
   * The project is put in the Recent list through the preload bridge, and then
   * *clicked* — because the ADE's own click handler is what calls `setInfo` and
   * renders the tabs. Calling `openProject` from here starts the service and
   * leaves React none the wiser, which is the difference between driving the
   * application and reaching around it.
   */
  await evaluate(
    `window.ade.preferences({ recentProjects: [${JSON.stringify(project)}] }).then(() => "ok")`,
  );
  await evaluate(`window.location.reload()`).catch(() => undefined);
  await new Promise((done) => setTimeout(done, 1_500));

  const name = project.split(/[\\/]/).pop();
  const pressed = await evaluate(
    `(() => {
       const button = [...document.querySelectorAll("button")]
         .find((one) => one.textContent.trim() === ${JSON.stringify(name)});
       if (button === undefined) return false;
       button.click();
       return true;
     })()`,
  );
  if (pressed !== true) throw new Error(`the ADE's Recent list has no "${name}"`);

  for (let attempt = 0; attempt < 60; attempt += 1) {
    const ready = await evaluate(`document.querySelectorAll('[role="tab"]').length`);
    if (Number(ready) > 0) break;
    await new Promise((done) => setTimeout(done, 500));
  }

  const screen = option("screen", "project");
  const label = SCREEN_LABELS[screen];
  if (label === undefined) {
    throw new Error(`unknown --screen ${screen}; one of ${Object.keys(SCREEN_LABELS).join(", ")}`);
  }
  if (screen !== "project") {
    const clicked = await evaluate(
      `(() => {
         const tab = [...document.querySelectorAll('[role="tab"]')]
           .find((one) => one.textContent.trim() === ${JSON.stringify(label)});
         if (tab === undefined) return false;
         tab.click();
         return true;
       })()`,
    );
    if (clicked !== true) {
      const seen = await evaluate(
        `JSON.stringify([...document.querySelectorAll('[role="tab"]')].map((o) => o.textContent.trim()))`,
      );
      const body = await evaluate(`document.body.innerText.slice(0, 400)`);
      throw new Error(`the ADE has no "${label}" tab; it shows ${seen}\n${body}`);
    }
  }
  await new Promise((done) => setTimeout(done, 2_000));

  const { nodes } = await cdp.send("Accessibility.getFullAXTree");
  const byId = new Map(nodes.map((node) => [node.nodeId, node]));

  /* Flatten depth-first into the parent-index form the adapter reads. */
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
    const mapped = {
      parent,
      role: AX_ROLE_FOR[role] ?? "AXUnknown",
    };
    const subrole = AX_SUBROLE_FOR[role];
    if (subrole !== undefined) mapped.subrole = subrole;
    /*
     * Chromium puts a name that came from the element's own contents in
     * `AXTitle`, and one that came from `aria-label` in `AXDescription`. The
     * `from` of the name's source is what says which.
     */
    const from = node.name?.sources?.find((one) => one.value !== undefined)?.type;
    if (name !== "") {
      if (from === "attribute" || from === "relatedElement") mapped.description = name;
      else mapped.title = name;
    }
    if (description !== "" && description !== name) mapped.help = description;
    if (typeof value === "string" && value !== "") mapped.value = value;
    if (typeof value === "number") mapped.value = String(value);

    const disabled = property(node, "disabled");
    mapped.enabled = disabled !== true;
    const focused = property(node, "focused");
    if (focused === true) mapped.focused = true;
    const selected = property(node, "selected");
    if (typeof selected === "boolean") mapped.selected = selected;
    const expanded = property(node, "expanded");
    if (typeof expanded === "boolean") mapped.expanded = expanded;
    const checked = property(node, "checked");
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

    flat.push(mapped);
    for (const child of node.childIds ?? []) {
      const next = byId.get(child);
      if (next !== undefined) walk(next, at);
    }
  };

  const root = nodes.find((node) => node.role?.value === "RootWebArea") ?? nodes[0];
  walk(root, -1);

  /*
   * The boxes. `DOM.getBoxModel` per node is one round trip each, which is fine
   * for a fixture and would not be for a snapshot; the adapter reads
   * `AXPosition` and `AXSize` in the same walk that reads everything else.
   */
  for (const node of nodes) {
    const at = index.get(node.nodeId);
    if (at === undefined || node.backendDOMNodeId === undefined) continue;
    try {
      const { model } = await cdp.send("DOM.getBoxModel", { backendNodeId: node.backendDOMNodeId });
      const [x1, y1, , , x3, y3] = model.border;
      flat[at].box = [Math.round(x1), Math.round(y1), Math.round(x3 - x1), Math.round(y3 - y1)];
    } catch {
      // An element with no layout box has none; the adapter reads that as hidden.
    }
    /*
     * The DOM `id`, which Chromium publishes on macOS as `AXDOMIdentifier`.
     * It is not among the AX node's `properties`, so it is read from the DOM
     * node the AX node came from — which is where `AXDOMIdentifier` comes from
     * in Chromium too.
     */
    try {
      const { node: dom } = await cdp.send("DOM.describeNode", {
        backendNodeId: node.backendDOMNodeId,
      });
      const attributes = dom.attributes ?? [];
      for (let a = 0; a < attributes.length; a += 2) {
        if (attributes[a] === "id" && attributes[a + 1] !== "") {
          flat[at].domIdentifier = attributes[a + 1];
        }
      }
    } catch {
      // A pseudo-element or a text node has no attributes.
    }
  }

  /*
   * The window Chromium's AX bridge puts above the web area on macOS: an
   * `AXWindow` whose `AXTitle` is the document title. It is not in the CDP tree
   * because CDP describes the *page*; a real AXUIElement walk starts here.
   */
  const { result } = await cdp.send("Runtime.evaluate", { expression: "document.title" });
  const title = result.value ?? "Svatah ADE";
  const window = [
    { parent: -1, role: "AXWindow", subrole: "AXStandardWindow", title, box: [0, 0, 1280, 860] },
    ...flat.map((node) => ({ ...node, parent: node.parent + 1 })),
  ];
  window[1].parent = 0;

  mkdirSync(out, { recursive: true });
  const file = join(out, `ade-${screen}.json`);
  writeFileSync(
    file,
    `${JSON.stringify({ process: "Svatah ADE", title, truncated: false, nodes: window }, null, 2)}\n`,
    "utf8",
  );
  process.stdout.write(`wrote ${window.length} node(s) to ${file}\n`);

  cdp.close();
  clearTimeout(deadline);
  child.kill("SIGTERM");
  process.exit(0);
}

main().catch((error) => {
  clearTimeout(deadline);
  child.kill("SIGKILL");
  process.stderr.write(`${String(error)}\n${log}\n`);
  process.exit(1);
});
