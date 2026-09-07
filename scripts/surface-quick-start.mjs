#!/usr/bin/env node
/**
 * The surface quick start, from the documentation, in a clean directory, from
 * the packed artifact (T19, T20, SF-20).
 *
 *   node scripts/surface-quick-start.mjs [--json] [--keep]
 *
 * SF-20 asks for install, generic MCP configuration and curl-free CLI quick
 * starts "from a clean environment using the correct scoped package", tested
 * with "packed artifacts outside workspace symlinks and copied examples
 * verbatim". Three words in that carry the whole check:
 *
 *   * **packed** — `pnpm pack`, so a missing `files` entry, an unbuilt `dist`
 *     or a `workspace:*` that escaped into a tarball is a failure here rather
 *     than a bug report after publishing;
 *   * **outside** — a directory under the OS temporary directory with no
 *     relationship to this checkout, so nothing resolves through pnpm's links;
 *   * **verbatim** — the commands are **extracted from the documentation
 *     source**, not written here. A doc that drifts is a failing check, not a
 *     stale page.
 *
 * ## The two substitutions, and why they are honest
 *
 * A reader replaces exactly two things when they copy this quick start, and so
 * does this script — nothing else:
 *
 *   * `http://localhost:3000` → the sample application this repository serves,
 *     because the reader has an application of their own and we do not;
 *   * `s_...` → the session id the *previous command actually printed*, which
 *     is what the doc's own comment ("Returns: …") tells the reader to do.
 *
 * Both are recorded in the report beside the command, so nobody has to take it
 * on trust that "verbatim" meant verbatim.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SETS, closureOf, workspacePackages } from "./lib/release-packages.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const keep = argv.includes("--keep");
const say = (line) => {
  if (!asJson) process.stdout.write(`${line}\n`);
  else process.stderr.write(`${line}\n`);
};

/** The documentation this quick start is *of*. Its commands are the test. */
const SOURCE = join("examples", "surface-control", "README.md");

/**
 * Every shell command in a document's fenced `bash` blocks, in order.
 *
 * Comment lines and blank lines are dropped — a reader does not type a comment —
 * and everything else is kept exactly as written, including the `echo … >
 * check.json` that builds an input file, because that *is* one of the steps.
 */
function commandsFrom(markdown) {
  const out = [];
  for (const block of markdown.matchAll(/```bash\n([\s\S]*?)```/g)) {
    for (const raw of block[1].split("\n")) {
      const line = raw.trim();
      if (line === "" || line.startsWith("#")) continue;
      out.push(line);
    }
  }
  return out;
}

const results = [];
const record = (one) => {
  results.push(one);
  const mark = one.blocked !== undefined ? "blocked" : one.ok ? "ok  " : "FAIL";
  say(`${mark} ${one.command}${one.detail === undefined ? "" : `\n       ${one.detail}`}`);
};

/* ── 1. pack the CLI and everything it needs ──────────────────────────────── */

const release = mkdtempSync(join(tmpdir(), "yam-surface-quick-start-pack-"));
const byName = workspacePackages();
const wanted = closureOf(SETS.cli, byName);
const tarballs = [];
say(`── packing ${wanted.length} package(s)`);
for (const name of wanted) {
  const entry = byName.get(name);
  const packed = spawnSync("pnpm", ["pack", "--pack-destination", release], {
    cwd: entry.dir,
    encoding: "utf8",
  });
  if (packed.status !== 0) {
    record({
      command: `pnpm pack ${name}`,
      ok: false,
      detail: `${packed.stdout}${packed.stderr}`.trim().split("\n").slice(-3).join(" ").slice(0, 300),
    });
  }
}
for (const file of readdirSync(release)) {
  if (file.endsWith(".tgz")) tarballs.push(join(release, file));
}

/* ── 2. a clean directory, outside this workspace ─────────────────────────── */

const directory = mkdtempSync(join(tmpdir(), "yam-surface-quick-start-"));
writeFileSync(
  join(directory, "package.json"),
  `${JSON.stringify({ name: "surface-quick-start", private: true, version: "0.0.0", type: "module" }, null, 2)}\n`,
  "utf8",
);

/**
 * The sample application, in a **child process** (measured, and it matters).
 *
 * An earlier draft started it in this one with `startSampleApp`, and every
 * `yam surface connect` timed out after ten seconds. The cause was here, not in
 * the product: the commands below run under `spawnSync`, which blocks this
 * process's event loop, so the in-process HTTP server could not answer the
 * browser the broker had opened. A harness that reports its own blocked loop as
 * a product timeout is worse than no harness.
 */
async function sampleApp() {
  const child = spawn(process.execPath, [join(ROOT, "apps", "sample-web", "dist", "cli.js")], {
    env: { ...process.env, PORT: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const origin = await new Promise((done, fail) => {
    let seen = "";
    const timer = setTimeout(() => fail(new Error("the sample application did not start")), 60_000);
    child.stdout.on("data", (chunk) => {
      seen += chunk;
      const found = /listening on (http:\/\/\S+)/.exec(seen);
      if (found !== null) {
        clearTimeout(timer);
        done(found[1]);
      }
    });
    child.on("exit", (code) => fail(new Error(`the sample application exited ${code}`)));
  });
  return { origin, close: async () => void child.kill("SIGTERM") };
}

let app;
try {
  app = await sampleApp();

  /* ── 3. the install line, from the document ────────────────────────────── */

  const source = readFileSync(join(ROOT, SOURCE), "utf8");
  const lines = commandsFrom(source);
  const installLine = lines.find((one) => one.startsWith("npm install"));
  record({
    command: installLine ?? "npm install @svatah/yam",
    source: SOURCE,
    ok: installLine === "npm install @svatah/yam",
    detail:
      installLine === "npm install @svatah/yam"
        ? "the scoped package, which is what SF-20 asks the docs to say"
        : `the document says \`${installLine}\`; SF-20 requires the scoped package \`@svatah/yam\``,
  });

  /*
   * Installed from the tarballs rather than the registry, because nothing is
   * published (that is the owner's call) and because the tarball is the
   * artifact under test. The *line* checked above is the reader's; this is how
   * the same four hundred kilobytes get there without a registry.
   */
  say(`── installing into ${directory}`);
  const installed = spawnSync("npm", ["install", "--no-audit", "--no-fund", ...tarballs], {
    cwd: directory,
    encoding: "utf8",
    timeout: 10 * 60 * 1000,
  });
  if (installed.status !== 0) {
    record({
      command: `npm install <${tarballs.length} packed tarball(s)>`,
      source: SOURCE,
      ok: false,
      detail: `${installed.stdout}${installed.stderr}`.trim().split("\n").slice(-5).join(" ").slice(0, 500),
    });
  } else {
    record({
      command: `npm install <${tarballs.length} packed tarball(s)>`,
      source: SOURCE,
      ok: true,
      detail: `installed outside the workspace, from ${release}`,
    });
  }

  const binary = join(directory, "node_modules", ".bin", "yam");
  if (!existsSync(binary)) {
    record({
      command: "yam --version",
      source: SOURCE,
      ok: false,
      detail: `the package installed no \`yam\` binary at ${binary}`,
    });
  } else {
    /* ── 4. every other command in the document, verbatim ─────────────────── */

    let session;
    for (const line of lines) {
      if (line.startsWith("npm install")) continue;

      const substitutions = [];
      let command = line;
      if (command.includes("http://localhost:3000")) {
        command = command.replace("http://localhost:3000", app.origin);
        substitutions.push(`http://localhost:3000 → ${app.origin} (the reader's own application)`);
      }
      if (command.includes("s_...")) {
        if (session === undefined) {
          record({
            command: line,
            source: SOURCE,
            blocked: "no session id yet: the connect command above did not print one",
          });
          continue;
        }
        command = command.replace("s_...", session);
        substitutions.push(`s_... → ${session} (what the previous command printed)`);
      }

      const ran = spawnSync("sh", ["-c", command.replace(/^yam /, `${binary} `)], {
        cwd: directory,
        encoding: "utf8",
        timeout: 5 * 60 * 1000,
        env: { ...process.env, PATH: `${join(directory, "node_modules", ".bin")}:${process.env["PATH"]}` },
      });
      const output = `${ran.stdout ?? ""}`;
      if (session === undefined) {
        const found = /"sessionId"\s*:\s*"(s_[0-9a-f]+)"/.exec(output);
        if (found !== null) session = found[1];
      }
      /*
       * A `check` that answers `false` exits 20 and that is the command
       * *working*: the document's own predicate asks whether the title contains
       * "Home", and the sample application's does not. What is under test is
       * that the command runs, parses and answers in the envelope — not that
       * this machine's page says a particular thing.
       */
      const answered = /"schemaVersion"\s*:\s*"1\.0"/.test(output);
      const ok = ran.status === 0 || (answered && command.includes(" check "));
      record({
        command: line,
        source: SOURCE,
        ok,
        ...(substitutions.length === 0 ? {} : { substitutions }),
        detail: ok
          ? `exit ${ran.status}${answered ? ", answered in the result envelope" : ""}`
          : `exit ${ran.status}: ${`${ran.stderr ?? ""}${output}`.trim().split("\n").slice(-3).join(" ").slice(0, 300)}`,
      });
    }

    /* ── 5. the MCP configuration the same document publishes ─────────────── */

    /*
     * SF-20 names "generic MCP configuration" beside the CLI quick start, and
     * SF-07 says no client-specific plugin is required. What is checked is that
     * the configuration in the document starts a server that completes an MCP
     * initialisation and lists the surface tools — from the *installed*
     * package, in this directory, exactly as the JSON says to start it.
     */
    const config = /```jsonc\n([\s\S]*?)```/.exec(source);
    const parsed =
      config === null
        ? undefined
        : JSON.parse(config[1].replace(/^\s*\/\/.*$/gm, ""));
    const server = parsed?.mcpServers?.yam;
    if (server === undefined) {
      record({
        command: "the MCP configuration in the document",
        source: SOURCE,
        ok: false,
        detail: "no `mcpServers.yam` block was found to test",
      });
    } else {
      record({
        command: `${server.command} ${server.args.join(" ")}`,
        source: SOURCE,
        ok: server.args.includes("@svatah/yam") && server.args.includes("mcp"),
        detail:
          server.args.includes("@svatah/yam") && server.args.includes("mcp")
            ? "generic: the scoped package and the `mcp` subcommand, no client-specific plugin"
            : `the configuration says \`${server.command} ${server.args.join(" ")}\``,
      });

      const probe = spawnSync(
        process.execPath,
        [join(ROOT, "scripts", "mcp-probe.mjs"), binary],
        { encoding: "utf8", cwd: directory, timeout: 3 * 60 * 1000 },
      );
      let tools;
      try {
        tools = JSON.parse(probe.stdout).tools;
      } catch {
        tools = undefined;
      }
      record({
        command: "an MCP client initialises against the installed package and lists its tools",
        source: SOURCE,
        ok: Array.isArray(tools) && tools.includes("surface_connect"),
        detail:
          tools === undefined
            ? `the probe produced no JSON (exit ${probe.status}): ${(probe.stderr || probe.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 300)}`
            : `${tools.length} tool(s), including ${tools.filter((one) => one.startsWith("surface_")).length} surface tools`,
      });
    }
  }
} finally {
  await app?.close();
  if (!keep) {
    rmSync(directory, { recursive: true, force: true });
    rmSync(release, { recursive: true, force: true });
  }
}

const failed = results.filter((one) => one.blocked === undefined && one.ok !== true);
if (asJson) {
  process.stdout.write(
    `${JSON.stringify({ source: SOURCE, directory, tarball: `${tarballs.length} packed tarball(s)`, commands: results }, null, 2)}\n`,
  );
} else {
  say(
    `\n${results.length - failed.length - results.filter((one) => one.blocked !== undefined).length}` +
      ` of ${results.filter((one) => one.blocked === undefined).length} reached command(s) passed` +
      `${keep ? `; kept ${directory}` : ""}`,
  );
}
process.exit(failed.length === 0 ? 0 : 1);
