#!/usr/bin/env node
/**
 * The desktop case set the fake gateway answers from (T11.3, LLD §13.9, §16).
 *
 *   node scripts/desktop-grounding-cases.mjs
 *       [--out evals/grounding/desktop-cases.jsonl] [--variant 0]
 *
 * > The recorder grounds a desktop snapshot the way it grounds a web one; the
 * > fake gateway gains a **desktop case set recorded from the app**.
 *
 * A case is a phrase a person might write, the *window* it is said in, and the
 * control it means — the desktop twin of `scripts/grounding-cases.mjs`, whose
 * cases are keyed on a page. Two things differ, and both follow from what a
 * desktop application is:
 *
 * * **The key is the window title**, not a URL path. LLD §3.3 has always said a
 *   binding's context pattern is "a URL *or window-title* pattern"; a window has
 *   no segments to generalise.
 * * **The ground truth is the `automationId`.** `apps/sample-web` stamps
 *   `data-yam-eval` on every element for the web eval; the app needs no such
 *   stamp, because LLD §13.7's accessibility contract already requires an id on
 *   every button, link, tab, field and row action, and the desktop snapshot case
 *   fails the live gate when one is missing. The id is the answer key.
 *
 * ## Recorded from the app, not written down
 *
 * The cases come from a **real read of the real application**, through the same
 * CDP path `scripts/record-desktop-tree.mjs` uses: launch the packaged app, open
 * the fixtures project, walk each screen, and turn every control with a name and
 * an id into a case. Hand-writing them would be writing down what somebody
 * believed the app looked like.
 *
 * Exit 0 when the cases are written, 2 when the app is not packaged.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP_DIR = join(ROOT, "apps", "desktop");

const args = process.argv.slice(2);
const option = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at < 0 ? fallback : args[at + 1];
};
const out = join(ROOT, option("out", "evals/grounding/desktop-cases.jsonl"));
const variant = option("variant", "0");
const project = join(ROOT, "evals", "fixtures");
const cli = join(ROOT, "packages", "cli", "dist", "bin.js");
const entry = join(APP_DIR, ".vite", "build", "main.js");

for (const [what, path] of [
  ["the CLI", cli],
  ["the app build", entry],
]) {
  if (!existsSync(path)) {
    process.stderr.write(
      `${what} is not built (${path}). Run \`pnpm -r build\` and ` +
        "`pnpm --filter @svatah/yam-desktop package`.\n",
    );
    process.exit(2);
  }
}

const PORT = 9700 + Math.floor(Math.random() * 200);
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
       * Started with *no* project, so the welcome screen is recorded too
       * (T11.3).
       *
       * It is the first screen anybody sees and the one `evals/self`'s flow
       * starts on — a case set that skipped it could not answer a grounding
       * question about the Recent list, which is how a self flow opens a
       * project at all.
       */
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

async function connect(url) {
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
 * The screens to walk, and how the app reaches each.
 *
 * The rail's eight, plus the palette's four. The same navigation the desktop
 * conformance suite uses, so a case recorded here is a case those cases could
 * be asked about.
 */
const SCREENS = [
  { rail: "rail-flows" },
  { rail: "rail-runs" },
  { rail: "rail-bindings" },
  { rail: "rail-agents" },
  { rail: "rail-api" },
  { rail: "rail-data" },
  { rail: "rail-import" },
  { rail: "rail-settings" },
  { palette: "run" },
  { palette: "record" },
  { palette: "heal" },
  { palette: "explorer" },
];

/**
 * A control's phrase, the way a person writes one.
 *
 * The same shapes `scripts/grounding-cases.mjs` produces for the web, because a
 * flow sentence does not know which platform it is about: "the Flows button",
 * "the Gateway field".
 */
function phrasesFor(role, name) {
  const clean = name.replace(/\s+/g, " ").trim();
  if (clean === "") return [];
  switch (role) {
    case "button":
      return [`the ${clean} button`];
    case "link":
      return [`the ${clean} link`];
    case "textbox":
    case "searchbox":
      return [`the ${clean} field`];
    case "combobox":
      return [`the ${clean} select`, `the ${clean} dropdown`];
    case "checkbox":
      return [`the ${clean} checkbox`];
    case "tab":
      return [`the ${clean} tab`];
    case "heading":
      return [`the ${clean} heading`];
    default:
      return [`the ${clean} ${role}`];
  }
}

const main = async () => {
  const page = await target();
  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send("Runtime.enable");

  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails !== undefined) throw new Error(JSON.stringify(exceptionDetails));
    return result.value;
  };

  /** Every control with a name *and* an id, as the app renders it right now. */
  const controlsNow = async () =>
    await evaluate(`(() => {
      const roleOf = (el) => {
        const explicit = el.getAttribute("role");
        if (explicit !== null) return explicit;
        const tag = el.tagName.toLowerCase();
        if (tag === "button") return "button";
        if (tag === "a") return "link";
        if (tag === "select") return "combobox";
        if (tag === "h1" || tag === "h2" || tag === "h3") return "heading";
        if (tag === "input") {
          const type = (el.getAttribute("type") ?? "text").toLowerCase();
          if (type === "checkbox") return "checkbox";
          if (type === "search") return "searchbox";
          return "textbox";
        }
        if (tag === "textarea") return "textbox";
        return "";
      };
      /*
       * The accessible name, the way an accessibility tree computes one:
       * aria-hidden subtrees are not part of it. The app has them — a button's
       * accelerator is a kbd element marked aria-hidden — so textContent alone
       * produced "the Open a sessionO button", a phrase no person would write
       * and no adapter would ever match.
       */
      const nameOf = (el) => {
        const label = el.getAttribute("aria-label");
        if (label !== null && label.trim() !== "") return label.trim();
        const by = el.getAttribute("aria-labelledby");
        if (by !== null) {
          const target = document.getElementById(by);
          if (target !== null) return (target.textContent ?? "").trim();
        }
        const visible = [...el.childNodes]
          .map((node) => {
            if (node.nodeType === 3) return node.textContent ?? "";
            if (node.nodeType !== 1) return "";
            if (node.getAttribute("aria-hidden") === "true" || node.hidden) return "";
            return node.textContent ?? "";
          })
          .join(" ");
        return visible.replace(/\\s+/g, " ").trim();
      };
      const out = [];
      for (const el of document.querySelectorAll("[id]")) {
        const role = roleOf(el);
        if (role === "") continue;
        if (el.hidden || el.closest("[hidden]") !== null) continue;
        if (el.closest("[aria-hidden='true']") !== null) continue;
        const name = nameOf(el);
        // A sentence is not a name. An alert whose "name" is a paragraph is a
        // thing to read, not a control to point at, and a phrase built from one
        // is a phrase nobody would write.
        if (name === "" || name.length > 48) continue;
        out.push({ id: el.id, role, name });
      }
      return out;
    })()`);

  const seen = new Map();
  /** Read what is on screen now: for a screen that is already there. */
  const recordNow = async (label) => {
    const found = await controlsNow();
    process.stderr.write(`${label}: ${found.length} control(s)\n`);
    for (const control of found) {
      // Keyed on id: a control the walk meets twice is one control, and the
      // screen it was first seen on is the one its phrases are about.
      if (!seen.has(control.id)) seen.set(control.id, { ...control, screen: label });
    }
  };
  /**
   * Wait for the screen to arrive, then read it.
   *
   * A rail click is a request the app answers with a `load()` over five or six
   * endpoints, and a read taken the instant after it is a read of an empty
   * workspace. The first version of this script recorded nine controls — the
   * rail, and nothing any screen has.
   */
  const record = async (label) => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const ready = await evaluate(
        `document.querySelectorAll("#workspace [id]").length > 0 &&
         !document.body.innerText.includes("Loading…")`,
      );
      if (ready === true) break;
      await new Promise((done) => setTimeout(done, 500));
    }
    await recordNow(label);
  };

  await evaluate(
    `window.yam.preferences({ recentProjects: [${JSON.stringify(project)}] }).then(() => "ok")`,
  );

  /*
   * The welcome screen first, before anything is opened (T11.3).
   *
   * It is the first screen anybody sees and the one `evals/self`'s flow starts
   * on: a case set that skipped it could not answer a grounding question about
   * the Recent list, which is how a self flow opens a project at all.
   */
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await evaluate(`document.getElementById("project-open") !== null`)) === true) break;
    await new Promise((done) => setTimeout(done, 500));
  }
  await recordNow("welcome");

  // Then the project, through the app's own Recent button — the same gesture a
  // person makes, and the same one `evals/self`'s flow makes.
  const opened = await (async () => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      if ((await evaluate(`document.getElementById("rail-flows") !== null`)) === true) return true;
      await evaluate(
        `(() => {
           const one = document.getElementById("project-recent-0");
           if (one !== null) one.click();
           return true;
         })()`,
      );
      await new Promise((done) => setTimeout(done, 500));
    }
    return false;
  })();
  if (opened !== true) {
    throw new Error(
      `the app did not open ${project}; it shows:\n` +
        String(await evaluate("document.body.innerText.slice(0, 400)")),
    );
  }

  await record("flows");
  for (const where of SCREENS) {
    try {
      if (where.rail !== undefined) {
        await evaluate(
          `(() => { const one = document.getElementById(${JSON.stringify(where.rail)});
             if (one !== null) one.click(); return true; })()`,
        );
      } else {
        await evaluate(
          `(() => { const one = document.getElementById("open-command-palette");
             if (one !== null) one.click(); return true; })()`,
        );
        await new Promise((done) => setTimeout(done, 400));
        await evaluate(
          `(() => { const one = document.getElementById("palette-go-${where.palette}");
             if (one !== null) one.click(); return true; })()`,
        );
      }
      await new Promise((done) => setTimeout(done, 400));
      await record(where.rail ?? where.palette);
    } catch (error) {
      process.stderr.write(`could not reach ${JSON.stringify(where)}: ${String(error)}\n`);
    }
  }

  const title = (await evaluate("document.title")) ?? "Yam";
  const cases = [];
  let n = 0;
  for (const control of [...seen.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    for (const phrase of phrasesFor(control.role, control.name)) {
      n += 1;
      cases.push({
        id: `d-${String(n).padStart(3, "0")}`,
        // The *window*, where a web case has a page (LLD §3.3, T11.3).
        window: title,
        phrase,
        expect: "present",
        // The ground-truth key: the id LLD §13.7 requires on every control.
        element: control.id,
        role: control.role,
        name: control.name,
        screen: control.screen,
      });
    }
  }

  /*
   * And one case that is *absent*, on purpose.
   *
   * A case set that only ever says "yes" measures nothing about refusing: the
   * recorder has to be able to answer "nothing here is that", and the fake
   * gateway has to be able to say it.
   */
  cases.push({
    id: `d-${String(n + 1).padStart(3, "0")}`,
    window: title,
    phrase: "the Frobnicate button",
    expect: "absent",
  });

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${cases.map((one) => JSON.stringify(one)).join("\n")}\n`, "utf8");
  process.stdout.write(`wrote ${cases.length} desktop case(s) to ${out}\n`);

  cdp.close();
  clearTimeout(deadline);
  child.kill("SIGTERM");
  process.exit(0);
};

try {
  await main();
} catch (error) {
  clearTimeout(deadline);
  child.kill("SIGKILL");
  process.stderr.write(`${String(error)}\n${log}\n`);
  process.exit(1);
}