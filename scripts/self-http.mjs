#!/usr/bin/env node
/**
 * The HTTP side of the self suite: start the service, drive it, stop it
 * (T12.7, REQ-SELF-1, LLD §13.9).
 *
 *   node scripts/self-http.mjs [--keep]
 *
 * > `evals/self/` is a Yam project: flows … over the HTTP adapter against
 * > the local service …
 *
 * This is the "D5" the Phase 11 verification carried: the check catalogue named
 * an HTTP side and the suite did not have one. It has one now, and it is
 * written in the flow language — `evals/self/http/flows/service.flow` — rather
 * than as assertions in this file. What is left here is the only part a flow
 * cannot do: the service binds to a port it is given and prints a bearer token
 * it generated, so somebody has to start it, read both, and hand them over.
 *
 * ## Why the fixtures project and not the self project
 *
 * The service serves *a* project, and the questions the flow asks are about a
 * real one: a plan with stories in it, a bindings store, a `data.yaml` with a
 * secret. `evals/fixtures` is that project and is what the app opens; pointing
 * the service at `evals/self` would be asking it about the suite that is asking.
 *
 * Exit 0 when the flow is green.
 */
import { spawn, spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(ROOT, "packages", "cli", "dist", "bin.js");
const keep = process.argv.includes("--keep");

/** `yam serve listening url=http://127.0.0.1:1234 token=…`, off its stdout. */
function startService() {
  const child = spawn(process.execPath, [cli, "serve", join(ROOT, "evals", "fixtures"), "--port", "0"], {
    cwd: ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let said = "";
  return {
    child,
    ready: new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        reject(new Error(`the service printed nothing usable in 60 s:\n${said}`));
      }, 60_000);
      child.stdout.on("data", (chunk) => {
        said += String(chunk);
        const line = /url=(\S+) token=(\S+)/.exec(said);
        if (line === null) return;
        clearTimeout(deadline);
        resolve({ url: line[1], token: line[2] });
      });
      child.stderr.on("data", (chunk) => {
        said += String(chunk);
      });
      child.on("exit", (code) => {
        clearTimeout(deadline);
        reject(new Error(`the service exited with ${code ?? "no code"} before it was ready:\n${said}`));
      });
    }),
  };
}

const service = startService();
let status = 1;
try {
  const { url, token } = await service.ready;
  process.stderr.write(`the local service is on ${url}\n`);

  const ran = spawnSync(
    process.execPath,
    [cli, "run", join(ROOT, "evals", "self", "http"), "--host", "none"],
    {
      cwd: ROOT,
      stdio: "inherit",
      env: {
        ...process.env,
        YAM_SELF_SERVICE_URL: url,
        /*
         * The token is a secret in `evals/self/http/data.yaml`, so it is
         * redacted in results, in the audit and anywhere else a person or a
         * model could read it (REQ-NFR-6). It is in this process's environment
         * and nowhere else.
         */
        YAM_SELF_SERVICE_TOKEN: token,
      },
    },
  );
  status = ran.status ?? 1;
} catch (error) {
  process.stderr.write(`${(error instanceof Error ? error.message : String(error))}\n`);
  status = 2;
} finally {
  if (!keep) service.child.kill("SIGTERM");
}

process.stdout.write(
  status === 0
    ? "the HTTP side of the self suite is green\n"
    : `the HTTP side of the self suite exited ${status}\n`,
);
process.exit(status);
