// Driven verification of the Surfaces shell (T14, SF-02/04/05/16/17/18): the
// real built renderer, in headless Chromium, over a real projectless
// `yam serve` and its broker, connecting through the real Playwright adapter —
// the dogfood.mjs approach aimed at Surfaces. Run from a built workspace:
//   pnpm --filter @svatah/yam-desktop exec node test/surfaces-dogfood.mjs
// It builds the renderer itself (see `surfaces-harness.vite.config.mjs`, which
// stubs the Node `crypto` hash the Surfaces path never calls, so a browser
// bundle links) and drives it at 1440×1000 and 1280×800.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname, resolve } from "node:path";
import { createServer, request as proxyRequest } from "node:http";
import { chromium } from "@playwright/test";

const APP_DIR = process.cwd();
const ROOT = join(APP_DIR, "..", "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
// Where the evidence goes: a directory named by SURFACES_EVIDENCE_DIR, so a
// verifier can keep it beside the spec, else a temporary one.
/*
 * Resolved against the *repository*, not against `apps/desktop` (T18).
 *
 * The command this harness documents is run through `pnpm --filter`, which puts
 * the working directory in `apps/desktop` — so a relative
 * `SURFACES_EVIDENCE_DIR=docs/spec/surface-first/evidence/wave-4` wrote its
 * screenshots to `apps/desktop/docs/spec/…`, a directory nobody asked for and
 * nobody would look in. An absolute path is unchanged by `resolve`.
 */
const OUT =
  process.env.SURFACES_EVIDENCE_DIR === undefined
    ? mkdtempSync(join(tmpdir(), "yam-surfaces-evidence-"))
    : resolve(ROOT, process.env.SURFACES_EVIDENCE_DIR);
mkdirSync(OUT, { recursive: true });
const RENDERER = mkdtempSync(join(tmpdir(), "yam-surfaces-renderer-"));

// Build the real renderer with the harness config (browser stub for crypto).
console.log("building the renderer…");
const built = spawnSync(
  join(APP_DIR, "node_modules", ".bin", "vite"),
  ["build", "--config", "surfaces-harness.vite.config.mjs", "--outDir", RENDERER, "--emptyOutDir"],
  { cwd: APP_DIR, encoding: "utf8" },
);
if (built.status !== 0) {
  console.error("renderer build failed:\n" + (built.stderr || built.stdout));
  process.exit(1);
}
mkdirSync(OUT, { recursive: true });
const results = [];
/** The keyboard journey's transcript, written however far it got. */
const transcript = [];
const note = (label, ok, detail) => {
  results.push({ label, ok, ...(detail === undefined ? {} : { detail }) });
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

const emptyProject = mkdtempSync(join(tmpdir(), "yam-surfaces-projectless-"));

/**
 * The newest file under a directory, so a write is a time that moved. A count
 * would not do: proposals go into a directory named for the day, and a second
 * promotion the same day overwrites the same files.
 */
const newestWrite = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true }).reduce(
        (latest, one) =>
          Math.max(latest, one.isDirectory() ? newestWrite(join(dir, one.name)) : statSync(join(dir, one.name)).mtimeMs),
        0,
      )
    : 0;

// A tiny target page for the connect flow to drive.
const target = createServer((req, res) => {
  if (req.url.startsWith("/api")) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ path: req.url, method: req.method }));
    return;
  }
  res.setHeader("content-type", "text/html");
  res.end(
    '<!doctype html><title>Surfaces target</title><h1>Target</h1>' +
      '<label for="u">Username</label><input id="u" name="u">' +
      '<button data-testid="go">Go</button>',
  );
});
await new Promise((r) => target.listen(0, "127.0.0.1", r));
const targetUrl = `http://127.0.0.1:${target.address().port}/`;

// A host that answers only after the adapter has given up (12 s against its
// 10 s limit): what makes an outcome genuinely unknown without a fault
// injector. The navigation may or may not have reached the target.
const slow = createServer((req, res) => {
  setTimeout(() => {
    res.setHeader("content-type", "text/html");
    res.end('<!doctype html><title>Slow</title><h1>Late</h1><button>Late</button>');
  }, 12000);
});
await new Promise((r) => slow.listen(0, "127.0.0.1", r));
const hangUrl = `http://127.0.0.1:${slow.address().port}/`;

// A project, for the one thing on Surfaces that needs one: writing a proposal
// (T17, SF-19). The fixtures project, pointed at the target above.
const PROJECT = mkdtempSync(join(tmpdir(), "yam-surfaces-project-"));
for (const entry of ["bindings", "flows", "api"]) {
  cpSync(join(ROOT, "evals", "fixtures", entry), join(PROJECT, entry), { recursive: true });
}
cpSync(join(ROOT, "evals", "fixtures", "data.yaml"), join(PROJECT, "data.yaml"));
writeFileSync(
  join(PROJECT, "yam.config.yaml"),
  readFileSync(join(ROOT, "evals", "fixtures", "yam.config.yaml"), "utf8").replace(/baseUrl: ".*"/, `baseUrl: "${targetUrl}"`),
  "utf8",
);

let service, projectService, web, browser;
try {
  // 1) A real, projectless service on an empty directory. It starts the broker
  //    lazily on the first catalogue call; nothing is written to the directory.
  service = spawn(process.execPath, [CLI, "serve", emptyProject, "--port", "0"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const info = await new Promise((res, rej) => {
    let s = "";
    const t = setTimeout(() => rej(new Error("serve startup timeout")), 30000);
    service.stdout.on("data", (b) => {
      s += b;
      const m = /url=(\S+) token=(\S+)/.exec(s);
      if (m) { clearTimeout(t); res({ url: m[1], token: m[2], project: emptyProject }); }
    });
    service.on("exit", (c) => rej(new Error("serve exited " + c)));
  });
  const serviceUrl = info.url;

  // A second service, on the project, which "Open a project" connects to.
  projectService = spawn(process.execPath, [CLI, "serve", PROJECT, "--port", "0"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  const projectInfo = await new Promise((res, rej) => {
    let s = "";
    const t = setTimeout(() => rej(new Error("project serve startup timeout")), 30000);
    projectService.stdout.on("data", (b) => {
      s += b;
      const m = /url=(\S+) token=(\S+)/.exec(s);
      if (m) { clearTimeout(t); res({ url: m[1], token: m[2], project: PROJECT }); }
    });
    projectService.on("exit", (c) => rej(new Error("project serve exited " + c)));
  });

  // The broker is machine-global and persists sessions across processes (that is
  // the design — every client sees the same sessions). For an isolated run,
  // close whatever is open before and after, so a leftover session does not
  // masquerade as this run's empty state.
  const closeAllSessions = async () => {
    try {
      const listed = await (await fetch(`${serviceUrl}/sessions`, {
        headers: { Authorization: `Bearer ${info.token}` },
      })).json();
      for (const s of listed?.result?.sessions ?? []) {
        await fetch(`${serviceUrl}/sessions/${encodeURIComponent(s.sessionId)}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${info.token}` },
        }).catch(() => {});
      }
    } catch { /* the broker may not be up yet; nothing to close */ }
  };
  /** An agent, in the only sense that matters: another client of the same broker. */
  const asAgent = async (path, body) =>
    await (await fetch(`${serviceUrl}${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${info.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    })).json();

  await closeAllSessions();

  // 2) Serve the built renderer and proxy /service/* to the real service.
  web = createServer((req, res) => {
    const upstream = req.url.startsWith("/service/") ? serviceUrl : req.url.startsWith("/project/") ? projectInfo.url : undefined;
    if (upstream !== undefined) {
      const p = proxyRequest(upstream + req.url.slice(8), { method: req.method, headers: req.headers }, (r) => {
        res.writeHead(r.statusCode, r.headers); r.pipe(res);
      });
      req.pipe(p); return;
    }
    try {
      const url = new URL(req.url, "http://localhost");
      const path = join(RENDERER, url.pathname === "/" ? "index.html" : url.pathname);
      res.setHeader("Content-Type", ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml" })[extname(path)] || "application/octet-stream");
      res.end(readFileSync(path));
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => web.listen(0, "127.0.0.1", r));
  const appOrigin = `http://127.0.0.1:${web.address().port}`;
  // The renderer reaches the service through the proxy, which CSP loopback allows.
  const bridgeInfo = { url: `${appOrigin}/service`, token: info.token, project: emptyProject, adopted: false, projectless: true };
  const projectBridge = { url: `${appOrigin}/project`, token: projectInfo.token, project: PROJECT, adopted: false, projectless: false };
  /** The preload bridge, stubbed: the projectless service first, the project when one is opened. */
  const stubBridge = [
    (setup) => {
      window.yam = {
        serviceInfo: async () => setup.surfaces,
        openProject: async (dir) => (dir === setup.project.project ? setup.project : setup.surfaces),
        pickFile: async () => setup.project.project,
        preferences: async () => ({ theme: "light", window: { width: 1440, height: 1000 }, recentProjects: [] }),
        onServiceLog: () => () => {},
        onServiceOpened: () => () => {},
      };
    },
    { surfaces: bridgeInfo, project: projectBridge },
  ];

  browser = await chromium.launch({ headless: true });


  /**
   * Radix's select, by keyboard: focus the trigger, open it, walk to the option
   * by its words, choose it. A click on the option would need it on screen,
   * and at 200% zoom the list is taller than the window.
   */
  const choose = async (page, triggerId, label) => {
    await page.locator(`#${triggerId}`).focus();
    await page.keyboard.press("Enter");
    await page.locator('[role="listbox"]').waitFor({ timeout: 10000 });
    const seen = [];
    for (let i = 0; i < 30; i += 1) {
      await page.waitForTimeout(50);
      const highlighted =
        (await page.locator('[role="option"][data-highlighted], [role="option"]:focus').first().textContent().catch(() => "")) ?? "";
      seen.push(highlighted.trim());
      if (highlighted.includes(label)) {
        await page.keyboard.press("Enter");
        await page.locator('[role="listbox"]').waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
        return;
      }
      await page.keyboard.press("ArrowDown");
    }
    throw new Error(`no option "${label}" in #${triggerId}; highlighted: ${JSON.stringify(seen)}; options: ${JSON.stringify(await page.locator('[role="option"]').allTextContents())}`);
  };

  const drive = async (width, height, label, scale = 1) => {
    // `scale` 2 is 200% zoom: the same window with half the CSS pixels (SF-18).
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
    await context.addInitScript(...stubBridge);
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
    await page.goto(appOrigin);

    // Surfaces is the default (SF-02, SF-16).
    await page.locator("#rail-surfaces").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#surfaces-discovery").waitFor({ state: "visible", timeout: 30000 });
    const title = (await page.locator("#toolbar-title").textContent())?.trim();
    note(`[${label}] opens into Session by default`, title === "Session", `title=${title}`);
    const sectionActive = await page.locator("#section-surfaces").getAttribute("aria-current");
    note(`[${label}] the Surfaces section is current`, sectionActive === "page");

    // Empty state, in the design's own words (SF-17).
    const sessionsText = (await page.locator("#surfaces-sessions").textContent()) ?? "";
    note(`[${label}] empty state invites a connection`, sessionsText.includes("Choose a browser"));

    // Discovery grouped by platform, unavailable adapter shows its prerequisite.
    const discovery = (await page.locator("#surfaces-discovery").textContent()) ?? "";
    note(`[${label}] discovery lists a Browser adapter`, discovery.includes("playwright"));
    const uiaHonest = /requires|not registered|not installed|unavailable|permission|win32/i.test(discovery);
    note(`[${label}] an unavailable adapter shows an honest reason`, uiaHonest);

    // Primary controls are usable at this size — the connect field and button on
    // screen and inside the viewport (SF-18, no overlap at 1280×800 / 1440×1000).
    const box = async (sel) => await page.locator(sel).boundingBox();
    const url = await box("#surfaces-url");
    const connect = await box("#action-surface-connect");
    const sameRow = url && connect && Math.abs(url.y - connect.y) < 20;
    const noOverlap = !sameRow || url.x + url.width <= connect.x + 1 || connect.x + connect.width <= url.x + 1;
    const usable =
      url && connect && url.x >= 0 && url.y >= 0 &&
      connect.x + connect.width <= width + 1 && url.x + url.width <= width + 1 && noOverlap;
    note(`[${label}] connect field and button are usable, no overlap`, Boolean(usable),
      `url=${JSON.stringify(url)} connect=${JSON.stringify(connect)}`);

    await page.screenshot({ path: join(OUT, `surfaces-empty-${width}x${height}.png`) });

    // Keyboard-only connect: focus the URL field, type, Enter (SF-18).
    await page.locator("#surfaces-url").focus();
    await page.keyboard.type(targetUrl);
    await page.keyboard.press("Enter");
    // A session row appears; it shows the adapter the service *used* (SF-04) —
    // the durable truth, not the transient status line.
    const row = page.locator("#surfaces-sessions tbody tr.sv-row").first();
    await row.waitFor({ timeout: 60000 });
    const rowText = (await row.textContent()) ?? "";
    note(`[${label}] the session shows the adapter the service used`, /playwright|bidi|http/.test(rowText),
      rowText.replace(/\s+/g, " ").trim().slice(0, 80));

    await page.screenshot({ path: join(OUT, `surfaces-connected-${width}x${height}.png`) });

    // Selecting the session fills the inspector (SF-16). Selection is the model
    // reloading with `selected` — the same onSelect → params → reload path every
    // screen uses — so it is asserted by *waiting* for it to commit, not read in
    // the same tick. A click is how a person chooses a session; the row may also
    // arrive already selected from the connect (auto-select), and either is fine.
    await row.click();
    let selected = "false";
    for (let i = 0; i < 40 && selected !== "true"; i += 1) {
      selected = (await page.locator("#surfaces-sessions tbody tr.sv-row").first().getAttribute("aria-selected")) ?? "false";
      if (selected !== "true") await page.waitForTimeout(150);
    }
    const inspector = await page.locator("#inspector-session").isVisible().catch(() => false);
    note(`[${label}] the connected session is selectable and inspectable`, selected === "true" && inspector,
      `aria-selected=${selected} inspector=${inspector}`);

    /* ── T15: the action inspector ───────────────────────────────────────── */

    // The semantic tree is what the inspector selects from — always available,
    // including where a screenshot is not.
    await page.locator("#surfaces-tree").waitFor({ timeout: 30000 });
    const treeText = (await page.locator("#surfaces-tree").textContent()) ?? "";
    note(`[${label}] the surface's semantic tree is on screen`, /textbox|button/.test(treeText),
      treeText.replace(/\s+/g, " ").trim().slice(0, 90));

    // Choose the text field. The form that appears comes from the catalogue.
    const textbox = page.locator("#surfaces-tree button", { hasText: "textbox" }).first();
    await textbox.click();
    await page.locator("#inspector-element").waitFor({ timeout: 20000 });
    const chosenAction = await page.locator("#surfaces-action").textContent();
    note(`[${label}] selecting a text field opens on Fill field, not "Choose an action"`,
      (chosenAction ?? "").includes("Fill"), `action=${(chosenAction ?? "").trim()}`);
    // The form asks for exactly what `type` needs: a value.
    await page.locator("#surfaces-field-value").waitFor({ timeout: 10000 });
    note(`[${label}] the fill form asks for a value`, true);

    // Fill it, and verify with a postcondition that is TRUE.
    await page.locator("#surfaces-field-value").fill("ada");
    await choose(page, "surfaces-verify", "Value equals");
    await page.locator("#surfaces-verify-value").fill("ada");
    await page.locator("#action-surface-act").click();
    await page.locator("#surfaces-last-result").waitFor({ timeout: 30000 });
    let summary = (await page.locator("#surfaces-result-summary").textContent()) ?? "";
    let pills = (await page.locator("#surfaces-last-result .sv-pill").allTextContents()).join(",");
    note(`[${label}] a true postcondition reads dispatched AND verified`,
      /dispatched/.test(pills) && /(^|,)verified/.test(pills) && summary.includes("verified"),
      `pills=${pills} summary=${summary.trim()}`);

    // Now the case the gate insists on: a DELIBERATELY WRONG postcondition must
    // read failed, never verified (SF-11).
    await page.locator("#surfaces-field-value").fill("ada");
    await choose(page, "surfaces-verify", "Value equals");
    await page.locator("#surfaces-verify-value").fill("not-what-was-typed");
    await page.locator("#action-surface-act").click();
    await page.waitForTimeout(600);
    summary = (await page.locator("#surfaces-result-summary").textContent()) ?? "";
    pills = (await page.locator("#surfaces-last-result .sv-pill").allTextContents()).join(",");
    note(`[${label}] a deliberately wrong postcondition reads NOT verified`,
      /not verified/.test(pills) && /did not hold/.test(summary),
      `pills=${pills} summary=${summary.trim()}`);

    // Details discloses the envelopes rather than putting them on the first screen.
    await page.locator("#surfaces-result-details").click();
    const raw = (await page.locator("#surfaces-result-raw").textContent()) ?? "";
    note(`[${label}] Details discloses the request and its answer`,
      raw.includes("requestId") && raw.includes("status"));

    /* ── T16: shared control ─────────────────────────────────────────────── */

    // Who is driving is on the session row, in words.
    const sessionId = ((await row.locator(".sv-flow-name").textContent()) ?? "").trim();
    note(`[${label}] the session row says who controls it`,
      ((await row.textContent()) ?? "").includes("Nobody"), `session=${sessionId}`);

    // An agent — another client of the same broker — takes the target.
    await asAgent(`/sessions/${sessionId}/control`, { action: "take", holder: "agent-1" });
    await page.locator("#action-surface-discover").click();
    await page.waitForTimeout(800);
    const heldText = (await page.locator("#surfaces-sessions").textContent()) ?? "";
    note(`[${label}] an agent's hold shows in the desktop`, heldText.includes("agent-1 controls"),
      heldText.replace(/\s+/g, " ").trim().slice(0, 80));

    // …and the surface reads busy, naming the holder and offering the handoff.
    const busy = await page.locator("#surfaces-problem-busy").isVisible().catch(() => false);
    const busyText = busy ? ((await page.locator("#surfaces-problem-busy").textContent()) ?? "") : "";
    note(`[${label}] a held target is the busy state, naming who has it`,
      busy && busyText.includes("agent-1") && /Take control/i.test(busyText), busyText.trim().slice(0, 90));
    await page.screenshot({ path: join(OUT, `surfaces-busy-${label}.png`) });

    // Acting while the agent holds it is refused with the holder's name (SF-13).
    const refused = await asAgent(`/sessions/${sessionId}/act`, {
      action: "click", ref: "r1", holder: "someone-else",
    });
    note(`[${label}] a mutation from anyone else is refused, not queued`,
      refused?.status === "refused" && refused?.error?.code === "CONTROL_BUSY",
      `${refused?.status} ${refused?.error?.code ?? ""}`);

    // The explicit handoff.
    await page.locator("#action-surface-take-control").click();
    await page.waitForTimeout(900);
    const afterText = (await page.locator("#surfaces-sessions").textContent()) ?? "";
    note(`[${label}] taking control hands the target over explicitly`,
      afterText.includes("You control"), afterText.replace(/\s+/g, " ").trim().slice(0, 80));

    // …and having taken it, the desktop can still act: the hold is its own.
    // The first cut named itself when taking control and not when acting, so
    // this exact step was refused CONTROL_BUSY — by "Yam desktop".
    await page.locator("#surfaces-tree button", { hasText: "textbox" }).first().click();
    await page.locator("#surfaces-field-value").waitFor({ timeout: 20000 });
    await page.locator("#surfaces-field-value").fill("after-handoff");
    await page.locator("#action-surface-act").click();
    await page.waitForTimeout(900);
    pills = (await page.locator("#surfaces-last-result .sv-pill").allTextContents()).join(",");
    summary = (await page.locator("#surfaces-result-summary").textContent()) ?? "";
    note(`[${label}] the desktop can act on a target it took control of`,
      /dispatched/.test(pills) && !/holds this target/.test(summary), `pills=${pills} ${summary.trim().slice(0, 60)}`);
    await page.screenshot({ path: join(OUT, `surfaces-acting-${label}.png`) });

    /* ── SF-17: stale and unknown outcome, driven rather than asserted ────── */

    // Stale: navigate with a control selected. Its reference is from the
    // generation before, so the inspector must say so and offer the way out —
    // never resolve it to whatever is there now (SF-10, SF-17).
    await choose(page, "surfaces-action", "Go to URL");
    await page.locator("#surfaces-field-url").waitFor({ timeout: 10000 });
    await page.locator("#surfaces-field-url").fill(`${targetUrl}second`);
    await page.locator("#action-surface-act").click();
    await page.locator("#surfaces-problem-stale").waitFor({ timeout: 30000 }).catch(() => {});
    const stale = await page.locator("#surfaces-problem-stale").isVisible().catch(() => false);
    const staleText = stale ? ((await page.locator("#surfaces-problem-stale").textContent()) ?? "") : "";
    note(`[${label}] a reference from before a navigation is the stale state, with the way out`,
      stale && /Refresh and select again/.test(staleText), staleText.replace(/\s+/g, " ").trim().slice(0, 90));
    await page.screenshot({ path: join(OUT, `surfaces-stale-${label}.png`) });
    await page.locator("#surfaces-problem-action").click();
    await page.locator("#surfaces-problem-stale").waitFor({ state: "detached", timeout: 20000 }).catch(() => {});
    await page.locator("#surfaces-tree button").first().waitFor({ timeout: 30000 });
    note(`[${label}] refreshing takes a fresh snapshot and clears the stale state`,
      !(await page.locator("#surfaces-problem-stale").isVisible().catch(() => false)));

    // Unknown outcome: a navigation to a host that answers after the adapter
    // has given up. The action may or may not have reached the target, so the
    // outcome is UNKNOWN, the way out is inspection, and nothing offers an
    // unqualified Retry (SF-11, SF-14, SF-17).
    await page.locator("#surfaces-tree button", { hasText: "textbox" }).first().click();
    await page.locator("#inspector-element").waitFor({ timeout: 20000 });
    await choose(page, "surfaces-action", "Go to URL");
    await page.locator("#surfaces-field-url").waitFor({ timeout: 10000 });
    await page.locator("#surfaces-field-url").fill(hangUrl);
    await page.locator("#action-surface-act").click();
    await page.locator("#surfaces-problem-unknown").waitFor({ timeout: 45000 }).catch(() => {});
    const unknown = await page.locator("#surfaces-problem-unknown").isVisible().catch(() => false);
    const unknownText = unknown ? ((await page.locator("#surfaces-problem-unknown").textContent()) ?? "") : "";
    pills = (await page.locator("#surfaces-last-result .sv-pill").allTextContents()).join(",");
    const offered = (await page.locator("button").allTextContents()).map((one) => one.trim().toLowerCase());
    note(`[${label}] a timed-out action is the unknown-outcome state: inspection offered, no Retry`,
      unknown && /Inspect the current state/.test(unknownText) && /(^|,)unknown/.test(pills) && !offered.includes("retry"),
      `pills=${pills} ${unknownText.replace(/\s+/g, " ").trim().slice(0, 80)}`);
    await page.screenshot({ path: join(OUT, `surfaces-unknown-${label}.png`) });
    await page.locator("#surfaces-problem-action").click();
    await page.locator("#surfaces-tree button").first().waitFor({ timeout: 30000 });
    note(`[${label}] inspecting after an unknown outcome shows what is there now`,
      !(await page.locator("#surfaces-problem-unknown").isVisible().catch(() => false)));

    /* ── T16: connecting an agent ────────────────────────────────────────── */

    const config = (await page.locator("#agent-mcp-config").textContent()) ?? "";
    note(`[${label}] a generic MCP configuration is offered, ready to copy`,
      config.includes("@svatah/yam") && config.includes("mcp"), config.replace(/\s+/g, " ").slice(0, 70));
    await page.locator("#action-surface-test-agent").click();
    await page.waitForTimeout(600);
    const tested = (await page.locator("#status-context").textContent()) ?? "";
    note(`[${label}] the connection test reports what it actually checked`,
      /broker answered|reaches the same sessions/i.test(tested), tested.trim().slice(0, 80));

    /* ── T17: automations regrouped, and Save as automation ──────────────── */

    // The automation features are under Automations; run evidence under Activity.
    const railIds = await page.evaluate(() =>
      [...document.querySelectorAll("#rail .sv-rail-group")].map((group) => ({
        section: group.querySelector(".sv-rail-section")?.id ?? "",
        screens: [...group.querySelectorAll(".sv-rail-item")].map((one) => one.id),
      })),
    );
    const automations = railIds.find((one) => one.section === "section-automations");
    const activity = railIds.find((one) => one.section === "section-activity");
    note(`[${label}] flow authoring, bindings and tools are under Automations`,
      ["rail-flows", "rail-bindings", "rail-agents", "rail-api", "rail-data", "rail-import"]
        .every((one) => automations?.screens.includes(one) === true),
      JSON.stringify(automations));
    note(`[${label}] run evidence is under Activity`,
      activity?.screens.includes("rail-runs") === true, JSON.stringify(activity));

    // A project is chosen here, not required to start: Surfaces needed none.
    note(`[${label}] a project is opened from the app, not demanded by it`,
      await page.locator("#open-project").isVisible(),
      (await page.locator("#open-project").textContent()) ?? "");

    // Save as automation promotes what the session did — and says honestly that
    // a proposal needs a project when none is open.
    await page.locator("#action-surface-save-automation").click();
    await page.waitForTimeout(1200);
    const promoted = (await page.locator("#status-context").textContent()) ?? "";
    note(`[${label}] Save as automation promotes, or says what it needs`,
      /unverified|needs a project|Open a project|looked at, not acted on/i.test(promoted),
      promoted.trim().slice(0, 110));

    // Without a project, the project screens say so rather than showing the
    // app's private workspace as if it were one (T17).
    await page.locator("#section-automations").click();
    await page.locator("#project-needed").waitFor({ timeout: 15000 }).catch(() => {});
    note(`[${label}] Automations without a project says so and points at Open a project`,
      await page.locator("#project-needed").isVisible().catch(() => false));
    await page.locator("#section-surfaces").click();
    await page.locator("#surfaces-discovery").waitFor({ timeout: 15000 });

    // Then with a project open: the same session, promoted into that project.
    // The session is the broker's, so opening a project does not lose it.
    await page.locator("#open-project").click();
    await page.locator("#open-project", { hasText: "Project:" }).waitFor({ timeout: 30000 });
    const rowAgain = page.locator("#surfaces-sessions tbody tr.sv-row").first();
    await rowAgain.waitFor({ timeout: 30000 });
    await rowAgain.click();
    await page.locator("#action-surface-save-automation").waitFor({ timeout: 30000 });
    const statusBefore = (await page.locator("#status-context").textContent()) ?? "";
    const clickedAt = Date.now();
    await page.locator("#action-surface-save-automation").click();
    let wrote = statusBefore;
    let written = 0;
    for (let i = 0; i < 60 && (wrote === statusBefore || written < clickedAt); i += 1) {
      await page.waitForTimeout(500);
      wrote = (await page.locator("#status-context").textContent()) ?? "";
      written = newestWrite(join(PROJECT, "proposals"));
    }
    note(`[${label}] with a project open, Save as automation writes an unverified proposal into it`,
      /Wrote a proposal/.test(wrote) && /unverified/.test(wrote) && written >= clickedAt,
      `${wrote.trim().slice(0, 90)} written ${written >= clickedAt ? "after" : "before"} the click`);

    // Disconnect closes it (SF-05); it is live now a session is selected.
    await page.locator("#action-surface-disconnect").waitFor({ state: "attached" });
    await page.locator("#action-surface-disconnect").click();
    await page.locator("#surfaces-sessions tbody tr.sv-row").first().waitFor({ state: "detached", timeout: 30000 }).catch(() => {});
    const after = (await page.locator("#surfaces-sessions").textContent()) ?? "";
    note(`[${label}] disconnect closes the session`, after.includes("Choose a browser"));

    // A session an *agent* opens is one the desktop sees: one broker, one list.
    const agentSession = await asAgent("/sessions", { url: targetUrl });
    const agentId = agentSession?.result?.sessionId;
    await page.locator("#action-surface-discover").click();
    await page.waitForTimeout(900);
    const listed = (await page.locator("#surfaces-sessions").textContent()) ?? "";
    note(`[${label}] a session an agent opened appears in the desktop`,
      typeof agentId === "string" && listed.includes(agentId), `agent session=${agentId}`);
    if (typeof agentId === "string") {
      await fetch(`${serviceUrl}/sessions/${encodeURIComponent(agentId)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${info.token}` },
      }).catch(() => {});
    }

    await context.close();
  };

  /* ── SF-18: the journey with no mouse at all ──────────────────────────── */
  const lines = transcript;
  lines.push("# Keyboard-only journey at 1440x1000: connect, select, act, check, close (SF-18)", "");
  const keyboardJourney = async () => {
    const label = "keyboard";
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript(...stubBridge);
    const page = await context.newPage();
    await page.goto(appOrigin);
    await page.locator("#surfaces-url").waitFor({ timeout: 30000 });
    const focused = () =>
      page.evaluate(() => {
        const el = document.activeElement;
        const style = el ? getComputedStyle(el) : undefined;
        return {
          id: el?.id ?? "",
          tag: (el?.tagName ?? "").toLowerCase(),
          text: (el?.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40),
          visible: style !== undefined && (style.outlineStyle !== "none" || style.boxShadow !== "none"),
          row: el?.tagName === "TR" && el.closest("#surfaces-sessions") !== null,
        };
      });
    let stops = 0;
    let invisible = 0;
    const press = async (key, why) => {
      await page.keyboard.press(key);
      const f = await focused();
      // The body is where the browser rests between the last control and the
      // first; it is not a stop and has no ring to show.
      if (key === "Tab" && f.tag !== "body") { stops += 1; if (!f.visible) invisible += 1; }
      lines.push(`${key.padEnd(10)} focus: ${f.tag}${f.id ? `#${f.id}` : ""}${f.text ? ` "${f.text}"` : ""}${f.visible || f.tag === "body" ? "" : "   [no visible focus]"}${why ? `   — ${why}` : ""}`);
      return f;
    };
    const type = async (text) => { await page.keyboard.type(text); lines.push(`type       "${text}"`); };
    const tabTo = async (want, limit = 80) => {
      for (let i = 0; i < limit; i += 1) if (want(await press("Tab"))) return true;
      return false;
    };

    note(`[${label}] Tab reaches the URL field`, await tabTo((f) => f.id === "surfaces-url"));
    await type(targetUrl);
    await press("Enter", "connect");
    const row = page.locator("#surfaces-sessions tbody tr.sv-row").first();
    await row.waitFor({ timeout: 60000 });
    await page.locator("#surfaces-tree button").first().waitFor({ timeout: 30000 });
    note(`[${label}] Enter connects, and the new session is selected`, (await row.getAttribute("aria-selected")) === "true");

    note(`[${label}] Tab reaches a control in the tree`, await tabTo((f) => f.tag === "button" && /textbox/.test(f.text)));
    await press("Enter", "select the control");
    await page.locator("#surfaces-field-value").waitFor({ timeout: 20000 });
    note(`[${label}] Tab reaches the value field the fill form opened`, await tabTo((f) => f.id === "surfaces-field-value"));
    await type("ada");
    note(`[${label}] Tab reaches the verify chooser`, await tabTo((f) => f.id === "surfaces-verify"));
    await press("Enter", "open the chooser");
    const listbox = await page.locator('[role="listbox"]').count();
    lines.push(`           listbox open: ${listbox > 0}; options: ${(await page.locator('[role="option"]').allTextContents()).join(" | ")}`);
    let chosen = false;
    for (let i = 0; i < 8 && !chosen; i += 1) {
      /*
       * Let the list settle before the first arrow (T18).
       *
       * Radix mounts the listbox in a portal and positions it before it takes
       * keys; an arrow that arrives during that never moves the highlight, and
       * every arrow after it lands on a list that thinks it is still at the
       * top. `choose()` above never hit this because it *reads* first and
       * arrows second, which gives the same fifty milliseconds by accident.
       * Measured: without this the highlight stayed on "Nothing — dispatch
       * only" for all eight presses, on this machine and on `master`.
       */
      await page.waitForTimeout(50);
      await press("ArrowDown");
      const highlighted =
        (await page.locator('[role="option"][data-highlighted], [role="option"]:focus').first().textContent().catch(() => "")) ?? "";
      lines.push(`           highlighted: "${highlighted.trim()}"`);
      if (/Value equals/.test(highlighted)) { await press("Enter", "choose Value equals"); chosen = true; }
    }
    note(`[${label}] the postcondition is chosen with the arrows and Enter`, chosen);
    await page.waitForTimeout(300);
    const back = await focused();
    lines.push(`(after)    focus: ${back.tag}${back.id ? `#${back.id}` : ""}`);
    note(`[${label}] focus returns to the chooser after the choice`, back.id === "surfaces-verify", `${back.tag}#${back.id}`);
    note(`[${label}] Tab reaches the expected value`, await tabTo((f) => f.id === "surfaces-verify-value"));
    await type("ada");
    note(`[${label}] Tab reaches the primary action`, await tabTo((f) => f.id === "action-surface-act"));
    await press("Enter", "act");
    await page.locator("#surfaces-last-result").waitFor({ timeout: 30000 });
    const pills = (await page.locator("#surfaces-last-result .sv-pill").allTextContents()).join(",");
    note(`[${label}] the action is dispatched and verified`, /dispatched/.test(pills) && /(^|,)verified/.test(pills), pills);

    // Choosing among sessions: an agent opens a second one, and the rows are
    // reached by Tab and walked with the arrows.
    const agentSession = await asAgent("/sessions", { url: targetUrl });
    const agentId = agentSession?.result?.sessionId;
    note(`[${label}] Tab reaches Recheck targets`, await tabTo((f) => f.id === "action-surface-discover"));
    await press("Enter", "recheck, which reloads the sessions");
    await page.locator("#surfaces-sessions tbody tr.sv-row").nth(1).waitFor({ timeout: 30000 });
    note(`[${label}] Tab reaches a session row`, await tabTo((f) => f.row));
    await press("ArrowDown", "the next session");
    await press("Enter", "choose it");
    await page.waitForTimeout(900);
    const selectedRow = (await page.locator('#surfaces-sessions tr[aria-selected="true"]').textContent().catch(() => "")) ?? "";
    note(`[${label}] the arrows and Enter choose the agent's session`,
      typeof agentId === "string" && selectedRow.includes(agentId), selectedRow.replace(/\s+/g, " ").trim().slice(0, 60));

    note(`[${label}] Tab reaches Disconnect`, await tabTo((f) => f.id === "action-surface-disconnect"));
    await press("Enter", "close the selected session");
    await page.waitForTimeout(900);
    const remaining = (await page.locator("#surfaces-sessions").textContent()) ?? "";
    note(`[${label}] Enter on Disconnect closes it`, typeof agentId === "string" && !remaining.includes(agentId));
    const after = await focused();
    lines.push(`(after)    focus: ${after.tag}${after.id ? `#${after.id}` : ""}`);
    note(`[${label}] focus is not lost to the document body after the control it was on went away`, after.tag !== "body", `${after.tag}#${after.id}`);
    note(`[${label}] every Tab stop showed visible focus`, invisible === 0, `${stops} stops, ${invisible} without`);
    lines.push("", `# ${stops} Tab stops, ${invisible} without visible focus`);
    await context.close();
  };

  /** One pass; a pass that cannot finish is one failed check, not a lost run. */
  const wanted = process.env.SURFACES_PASSES?.split(",");
  const pass = async (label, run) => {
    if (wanted !== undefined && !wanted.includes(label)) return;
    try {
      await run();
    } catch (e) {
      const lines = String(e.message).split("\n");
      const waiting = lines.find((one) => /waiting for|locator\(/.test(one)) ?? "";
      note(`[${label}] the pass could not finish`, false, `${lines[0]} ${waiting.trim()}`.trim());
    }
    await closeAllSessions();
  };
  await pass("1440x1000", () => drive(1440, 1000, "1440x1000"));
  await pass("1280x800", () => drive(1280, 800, "1280x800"));
  // 200% zoom: the same window sizes with half the CSS pixels (SF-18).
  await pass("1440x1000@200%", () => drive(720, 500, "1440x1000@200%", 2));
  await pass("1280x800@200%", () => drive(640, 400, "1280x800@200%", 2));
  await pass("keyboard", keyboardJourney);
  note("the projectless workspace is left empty: connecting created no project files (SF-01)",
    readdirSync(emptyProject).length === 0, readdirSync(emptyProject).join(",") || "empty");
} catch (e) {
  note("harness", false, `${e.message}\n${e.stack}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  web?.close();
  target.close();
  slow.close();
  service?.kill("SIGTERM");
  projectService?.kill("SIGTERM");
  writeFileSync(join(OUT, "surfaces-dogfood.json"), JSON.stringify(results, null, 2) + "\n");
  // The transcript, however far the keyboard journey got.
  if (transcript.length > 2) writeFileSync(join(OUT, "keyboard-transcript.txt"), transcript.join("\n") + "\n");
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}
