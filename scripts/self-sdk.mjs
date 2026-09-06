#!/usr/bin/env node
/**
 * The SDK side of the self suite: every screen, out of process (T12.7,
 * REQ-SELF-1, REQ-SDK-1, REQ-ADE-13, LLD §13.9).
 *
 *   node scripts/self-sdk.mjs
 *
 * > `evals/self/` is a Yam project: flows … over the SDK against
 * > `yam ui --json`.
 *
 * This is the other half of the "D5" the Phase 11 verification carried. It is a
 * script rather than a flow, and that is not a shortcut: the check catalogue
 * has said since Phase 11 that "a flow cannot run a command and read its
 * stdout", which is exactly what comparing `yam ui --json` with the model
 * requires. LLD §13.9 Draft 2.15 settles it — "the HTTP and SDK sides of the
 * self suite are written, not catalogued" — because there is no second oracle
 * for this that is not the same code twice.
 *
 * ## What it asserts
 *
 * For every screen the model has:
 *
 *   1. `@svatah/yam-sdk` loads the screen's state from the running service, in this
 *      process, which is REQ-SDK-1's "the screen model's actions runnable out of
 *      process";
 *   2. `yam ui --json --screen <id>` prints a state from another process;
 *   3. the two are the same document.
 *
 * A difference is a drift between the SDK and the cockpit — two clients of one
 * service disagreeing about what a screen is, which is the failure REQ-ADE-13
 * exists to prevent ("nothing exists only in a UI").
 *
 * ## Why some fields are dropped before the comparison
 *
 * A state carries `loadedAt`, and two loads a second apart carry two different
 * timestamps. `tui-pty.test.ts` makes the same allowance for the same reason
 * (P9-F4): the point is whether the *screen* is the same, not whether a clock
 * moved between two reads.
 *
 * Exit 0 when every screen agrees, 2 when the service could not be started.
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(ROOT, "packages", "cli", "dist", "bin.js");
const project = join(ROOT, "evals", "fixtures");

/** Fields whose value is a clock rather than a screen. */
const MOVING = new Set(["loadedAt", "at", "startedAt", "endedAt", "durationMs"]);

/** Drop the moving parts, everywhere they appear. */
function settled(value) {
  if (Array.isArray(value)) return value.map(settled);
  if (value === null || typeof value !== "object") return value;
  const out = {};
  for (const [key, one] of Object.entries(value)) {
    if (MOVING.has(key)) continue;
    out[key] = settled(one);
  }
  return out;
}

function startService() {
  const child = spawn(process.execPath, [cli, "serve", project, "--port", "0"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let said = "";
  return {
    child,
    ready: new Promise((resolve, reject) => {
      const deadline = setTimeout(
        () => reject(new Error(`the service printed nothing usable in 60 s:\n${said}`)),
        60_000,
      );
      const read = (chunk) => {
        said += String(chunk);
        const line = /url=(\S+) token=(\S+)/.exec(said);
        if (line === null) return;
        clearTimeout(deadline);
        resolve({ url: line[1], token: line[2] });
      };
      child.stdout.on("data", read);
      child.stderr.on("data", (chunk) => (said += String(chunk)));
      child.on("exit", (code) => {
        clearTimeout(deadline);
        reject(new Error(`the service exited with ${code ?? "no code"}:\n${said}`));
      });
    }),
  };
}

const service = startService();
let connection;
try {
  connection = await service.ready;
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  service.child.kill("SIGTERM");
  process.exit(2);
}
process.stderr.write(`the local service is on ${connection.url}\n`);

const { SCREENS } = await import(join(ROOT, "packages", "screens", "dist", "index.js"));
const { YamClient } = await import(join(ROOT, "packages", "sdk", "dist", "index.js"));
const client = new YamClient({ url: connection.url, token: connection.token });

/** `yam ui --json --screen <id>`, from another process entirely. */
function cockpit(screen) {
  const ran = spawnSync(
    process.execPath,
    [cli, "ui", project, "--json", "--screen", screen, "--url", connection.url, "--token", connection.token],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const at = ran.stdout.indexOf("{");
  if (at < 0) {
    throw new Error(
      `\`yam ui --json --screen ${screen}\` printed no JSON (exit ${ran.status ?? "none"}): ` +
        `${(ran.stderr || ran.stdout).trim().split("\n").slice(-3).join(" ")}`,
    );
  }
  /*
   * `--json` prints the cockpit's whole document — the screen id, its params,
   * which pane has focus, and the screen's *state* under `state`. The SDK
   * loads the state alone, because focus is a cockpit's idea and not a
   * screen's. So the comparison is against `state`, which is the part both
   * clients are claims about.
   */
  const printed = JSON.parse(ran.stdout.slice(at));
  return printed.state ?? printed;
}

const disagreements = [];
let compared = 0;
for (const screen of SCREENS) {
  let mine;
  let theirs;
  try {
    mine = settled(await screen.load(client, {}));
    theirs = settled(cockpit(screen.id));
  } catch (error) {
    disagreements.push(`${screen.id}: ${error instanceof Error ? error.message : String(error)}`);
    continue;
  }
  compared += 1;
  const a = JSON.stringify(mine, null, 1);
  const b = JSON.stringify(theirs, null, 1);
  if (a !== b) {
    const at = [...a].findIndex((char, index) => char !== b[index]);
    disagreements.push(
      `${screen.id}: the SDK and \`yam ui --json\` differ from character ${at}\n` +
        `  sdk:     ${a.slice(Math.max(0, at - 40), at + 120).replace(/\n/g, " ")}\n` +
        `  cockpit: ${b.slice(Math.max(0, at - 40), at + 120).replace(/\n/g, " ")}`,
    );
  }
}

service.child.kill("SIGTERM");

process.stdout.write(
  disagreements.length === 0
    ? `the SDK and \`yam ui --json\` agree on all ${compared} screen(s)\n`
    : `${disagreements.length} screen(s) disagree:\n${disagreements.join("\n")}\n`,
);
process.exit(disagreements.length === 0 ? 0 : 1);
