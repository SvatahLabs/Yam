// Driven verification of the Surfaces shell (T14, SF-02/04/05/16/17/18): the
// real built renderer, in headless Chromium, over a real projectless
// `yam serve` and its broker, connecting through the real Playwright adapter —
// the dogfood.mjs approach aimed at Surfaces. Run from a built workspace:
//   pnpm --filter @svatah/yam-desktop exec node test/surfaces-dogfood.mjs
// It builds the renderer itself (see `surfaces-harness.vite.config.mjs`, which
// stubs the Node `crypto` hash the Surfaces path never calls, so a browser
// bundle links) and drives it at 1440×1000 and 1280×800.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";
import { createServer, request as proxyRequest } from "node:http";
import { chromium } from "@playwright/test";

const APP_DIR = process.cwd();
const ROOT = join(APP_DIR, "..", "..");
const CLI = join(ROOT, "packages", "cli", "dist", "bin.js");
const OUT = mkdtempSync(join(tmpdir(), "yam-surfaces-evidence-"));
const RENDERER = join(OUT, "renderer");

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
const note = (label, ok, detail) => {
  results.push({ label, ok, ...(detail === undefined ? {} : { detail }) });
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
};

const emptyProject = mkdtempSync(join(tmpdir(), "yam-surfaces-projectless-"));

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

let service, web, browser;
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
    if (req.url.startsWith("/service/")) {
      const p = proxyRequest(serviceUrl + req.url.slice(8), { method: req.method, headers: req.headers }, (r) => {
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
  const bridgeInfo = { url: `${appOrigin}/service`, token: info.token, project: emptyProject, adopted: false };

  browser = await chromium.launch({ headless: true });


  /** Radix's select: click the trigger, then the option by its words. */
  const choose = async (page, triggerId, label) => {
    await page.locator(`#${triggerId}`).click();
    await page.locator('[role="option"]', { hasText: label }).first().click();
  };

  const drive = async (width, height, label) => {
    const context = await browser.newContext({ viewport: { width, height } });
    await context.addInitScript((i) => {
      window.yam = {
        serviceInfo: async () => i,
        openProject: async () => i,
        pickFile: async () => null,
        preferences: async () => ({ theme: "light", window: { width: 1440, height: 1000 }, recentProjects: [] }),
        onServiceLog: () => () => {},
        onServiceOpened: () => () => {},
      };
    }, bridgeInfo);
    const page = await context.newPage();
    page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
    await page.goto(appOrigin);

    // Surfaces is the default (SF-02, SF-16).
    await page.locator("#rail-surfaces").waitFor({ state: "visible", timeout: 30000 });
    await page.locator("#surfaces-discovery").waitFor({ state: "visible", timeout: 30000 });
    const title = (await page.locator("#toolbar-title").textContent())?.trim();
    note(`[${label}] opens into Surfaces by default`, title === "Surfaces", `title=${title}`);
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

    /* ── T16: connecting an agent ────────────────────────────────────────── */

    const config = (await page.locator("#agent-mcp-config").textContent()) ?? "";
    note(`[${label}] a generic MCP configuration is offered, ready to copy`,
      config.includes("@svatah/yam") && config.includes("mcp"), config.replace(/\s+/g, " ").slice(0, 70));
    await page.locator("#action-surface-test-agent").click();
    await page.waitForTimeout(600);
    const tested = (await page.locator("#status-context").textContent()) ?? "";
    note(`[${label}] the connection test reports what it actually checked`,
      /broker answered|reaches the same sessions/i.test(tested), tested.trim().slice(0, 80));

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

  await drive(1440, 1000, "1440x1000");
  await closeAllSessions();
  await drive(1280, 800, "1280x800");
} catch (e) {
  note("harness", false, `${e.message}\n${e.stack}`);
  process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  web?.close();
  target.close();
  service?.kill("SIGTERM");
  writeFileSync(join(OUT, "surfaces-dogfood.json"), JSON.stringify(results, null, 2) + "\n");
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}
