#!/usr/bin/env node
/**
 * The front door, as a person walks through it (SF-07, REQ-PKG-2).
 *
 *   node scripts/registry-mcp-smoke.mjs [--version latest] [--with-deps] [--keep]
 *
 * The README says: install Chromium with `npx playwright install chromium`, add
 * `npx -y @svatah/yam-mcp` to an agent's server list, connect to a page. Nothing
 * in CI did that. `pnpm quick-start:registry` installs the four Playwright-test
 * packages by name; the MCP server and `yam` were only ever run from this
 * checkout — and the first time somebody ran the published server from an empty
 * directory, it could not open a browser, because `npx` resolved a newer
 * Playwright than the browser it had installed was built for.
 *
 * So this runs exactly that, in an empty directory, with no package from this
 * checkout anywhere on the path, and no dependency of its own: the protocol is
 * spoken as JSON-RPC lines over the server's stdio, which is all an MCP client
 * over stdio is.
 *
 * 1. `npx playwright install chromium`, as the README says;
 * 2. `npx -y @svatah/yam@<version> surface doctor`, which must exit 0;
 * 3. `npx -y @svatah/yam-mcp@<version>`: initialize, list the tools, ask for
 *    targets, connect to a page this script serves, snapshot it, close.
 *
 * The broker the server starts is given a state directory of its own and
 * stopped at the end, so a run leaves nothing behind on a person's machine.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const argv = process.argv.slice(2);
const option = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at >= 0 ? argv[at + 1] : undefined;
};
const version = option("version") ?? "latest";
const withDeps = argv.includes("--with-deps");
const keep = argv.includes("--keep");

const dir = mkdtempSync(join(tmpdir(), "yam-registry-mcp-"));
const stateDir = join(dir, ".broker");
const env = { ...process.env, YAM_BROKER_STATE_DIR: stateDir, npm_config_yes: "true" };
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
/* `npx.cmd` is a batch file, which Node spawns only through a shell. */
const shell = process.platform === "win32";
/* A step that hangs fails the run rather than the runner's six hours. */
const STEP_TIMEOUT_MS = 10 * 60 * 1000;
const failures = [];

const say = (line) => process.stdout.write(`${line}\n`);
const fail = (what, detail) => {
  failures.push(what);
  say(`FAIL ${what}${detail === undefined ? "" : `\n     ${String(detail).slice(0, 1200)}`}`);
};
const pass = (what, detail) => say(`ok   ${what}${detail === undefined ? "" : ` — ${detail}`}`);

/* ── 1. the browser, as the README installs it ─────────────────────────────── */
const install = spawnSync(npx, ["playwright", "install", ...(withDeps ? ["--with-deps"] : []), "chromium"], {
  cwd: dir,
  env,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
  shell,
  timeout: STEP_TIMEOUT_MS,
});
if (install.status === 0) pass("npx playwright install chromium");
else fail("npx playwright install chromium", install.stderr || install.stdout);

/* ── 2. the doctor ─────────────────────────────────────────────────────────── */
const doctor = spawnSync(npx, ["-y", `@svatah/yam@${version}`, "surface", "doctor"], {
  cwd: dir,
  env,
  encoding: "utf8",
  shell,
  timeout: STEP_TIMEOUT_MS,
});
say(doctor.stdout.trimEnd());
if (doctor.status === 0) pass(`npx @svatah/yam@${version} surface doctor`);
else fail(`npx @svatah/yam@${version} surface doctor exited ${doctor.status}`, doctor.stderr);

/* ── 3. the MCP server, and one page through it ────────────────────────────── */
const page = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end('<!doctype html><title>Registry smoke</title><label>Name <input name="name"></label><button>Go</button>');
});
await new Promise((done) => page.listen(0, "127.0.0.1", done));
const pageUrl = `http://127.0.0.1:${page.address().port}/`;

const server = spawn(npx, ["-y", `@svatah/yam-mcp@${version}`], { cwd: dir, env, stdio: ["pipe", "pipe", "pipe"], shell });
let buffer = "";
let stderr = "";
let id = 0;
const pending = new Map();
server.stdout.on("data", (chunk) => {
  buffer += chunk;
  for (let at = buffer.indexOf("\n"); at >= 0; at = buffer.indexOf("\n")) {
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    if (line.trim() === "") continue;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      continue; // Not the protocol: a server may say other things on a stdio it does not own.
    }
    pending.get(message.id)?.(message);
    pending.delete(message.id);
  }
});
server.stderr.on("data", (chunk) => {
  stderr += chunk;
});
const request = (method, params, timeoutMs = 120_000) =>
  new Promise((done, failed) => {
    id += 1;
    const timer = setTimeout(() => failed(new Error(`${method} did not answer in ${timeoutMs} ms`)), timeoutMs);
    pending.set(id, (message) => {
      clearTimeout(timer);
      done(message);
    });
    server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
const tool = async (name, args) => {
  const answer = await request("tools/call", { name, arguments: args });
  const text = answer.result?.content?.find((one) => one.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return { status: "failed", error: { message: text || JSON.stringify(answer.error) } };
  }
};

try {
  const init = await request("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "registry-smoke", version: "0" },
  });
  if (init.result?.serverInfo === undefined) throw new Error(`initialize: ${JSON.stringify(init.error ?? init)}`);
  server.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);
  pass("initialize", `${init.result.serverInfo.name} ${init.result.serverInfo.version}`);

  const listed = await request("tools/list", {});
  const names = (listed.result?.tools ?? []).map((one) => one.name);
  const wanted = ["surface_targets", "surface_connect", "surface_snapshot", "surface_act", "surface_close"];
  const missing = wanted.filter((one) => !names.includes(one));
  if (missing.length === 0) pass("tools/list", `${names.length} tools`);
  else fail("tools/list", `missing ${missing.join(", ")}`);

  const targets = await tool("surface_targets", {});
  const playwright = targets.result?.targets?.find((one) => one.adapter === "playwright");
  if (playwright?.ready === true) pass("surface_targets says the browser is ready");
  else fail("surface_targets says the browser is not ready", JSON.stringify(playwright));

  const connected = await tool("surface_connect", { url: pageUrl, adapter: "playwright" });
  const session = connected.result?.sessionId;
  if (connected.status === "succeeded" && session !== undefined) pass("surface_connect opens the page", session);
  else fail("surface_connect opens the page", connected.error?.message ?? JSON.stringify(connected));

  if (session !== undefined) {
    const snapshot = await tool("surface_snapshot", { session, interactiveOnly: true });
    const text = snapshot.result?.text ?? "";
    if (snapshot.status === "succeeded" && /textbox "Name"/.test(text)) pass("surface_snapshot reads the page");
    else fail("surface_snapshot reads the page", text || JSON.stringify(snapshot.error));
    const closed = await tool("surface_close", { session });
    if (closed.status === "succeeded") pass("surface_close");
    else fail("surface_close", JSON.stringify(closed.error));
  }
} catch (error) {
  fail("the MCP session", `${error instanceof Error ? error.message : String(error)}\n${stderr.slice(-800)}`);
} finally {
  server.kill();
  page.close();
  /* The broker the server started, by the pid in its own descriptor. */
  try {
    const descriptor = JSON.parse(readFileSync(join(stateDir, "broker.json"), "utf8"));
    process.kill(descriptor.pid);
  } catch {
    // No broker was started, or it has gone already.
  }
  if (!keep) rmSync(dir, { recursive: true, force: true });
}

say(
  failures.length === 0
    ? `The published front door works: @svatah/yam-mcp@${version} from an empty directory.`
    : `${failures.length} step(s) failed: ${failures.join("; ")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
