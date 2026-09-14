#!/usr/bin/env node
/**
 * A binding *recorded* against the app relocalizes at variant 1 (T11.3).
 *
 *   node scripts/self-relocalize.mjs --project <a recorded self project>
 *
 * The third of T11.3's Validate items:
 *
 *   > a variant-1 rename relocalizes live.
 *
 * `YAM_A11Y_VARIANT=1` renames the Flows rail item to "Editor" and changes
 * nothing else about it — its id is the same, and the relocalizer is blind to
 * the id by design (LLD §16: it is the ground-truth key, and scoring on it
 * would let the check find the answer in the answer key). So what has to carry
 * the repair is the fingerprint the recorder wrote, and what says the repair is
 * *right* is that the element it proposes has the recorded id.
 *
 * Separate from `scripts/self-record.mjs` because it needs the app at a
 * different variant: a relocalization measured against the window the binding
 * was recorded from would measure nothing.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const at = args.indexOf("--project");
const project = at < 0 ? join(ROOT, "evals", "self") : args[at + 1];
const bundle = join(ROOT, "apps", "desktop", "out", "Yam-darwin-arm64", "Yam.app");
const executable = join(bundle, "Contents", "MacOS", "Yam");

const store = join(project, "bindings", "flows-rail-item.yaml");
if (!existsSync(store)) {
  process.stderr.write(`No recorded binding at ${store}. Run \`pnpm self:record --keep\` first.\n`);
  process.exit(2);
}

const { parse } = await import(pathToFileURL(join(ROOT, "node_modules", "yaml", "dist", "index.js")).href);
const { relocalize } = await import(pathToFileURL(join(ROOT, "packages", "bindings", "dist", "index.js")).href);
const { createSurface } = await import(pathToFileURL(join(ROOT, "packages", "surface", "dist", "index.js")).href);
const ax = await import(pathToFileURL(join(ROOT, "packages", "adapter-ax", "dist", "index.js")).href);
const { DEFAULT_CONFIG } = await import(pathToFileURL(join(ROOT, "packages", "schema", "dist", "index.js")).href);
ax.registerAxAdapter();

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const alive = () =>
  (spawnSync("pgrep", ["-f", executable], { encoding: "utf8" }).stdout ?? "")
    .split("\n")
    .filter((one) => one.trim() !== "");

function stop() {
  if (alive().length === 0) return;
  spawnSync("osascript", ["-e", 'tell application id "com.electron.yam" to quit'], {
    encoding: "utf8",
  });
  for (let waited = 0; waited < 20_000 && alive().length > 0; waited += 250) {
    spawnSync(process.execPath, ["-e", "setTimeout(() => {}, 250)"]);
  }
  if (alive().length > 0) spawnSync("pkill", ["-f", executable], { encoding: "utf8" });
}

const entry = parse(readFileSync(store, "utf8")).entries[0];
process.stderr.write(
  `recorded at variant 0: text ${JSON.stringify(entry.fingerprint.text)}, ` +
    `candidates ${entry.candidates.map((one) => one.by).join(", ")}\n`,
);

stop();
const environment = {
  YAM_A11Y: "1",
  YAM_A11Y_VARIANT: "1",
  YAM_CLI: join(ROOT, "packages", "cli", "dist", "bin.js"),
  YAM_APP_PROJECT: join(ROOT, "evals", "fixtures"),
};
const open = ["-n", "-F"];
for (const [name, value] of Object.entries(environment)) open.push("--env", `${name}=${value}`);
open.push("-a", bundle);
spawnSync("open", open, { encoding: "utf8" });
await sleep(13_000);

const surface = await createSurface({
  ...DEFAULT_CONFIG,
  project: "self-relocalize",
  adapter: "ax",
  app: { processName: "Yam" },
  run: { ...DEFAULT_CONFIG.run, candidateTimeoutMs: 8_000 },
});
await surface.open({ processName: "Yam" });

const live = (await surface.snapshot()).nodes.find(
  (one) => one.native?.["automationId"] === "rail-flows",
);
process.stderr.write(`at variant 1 the same control is named ${JSON.stringify(live?.name)}\n`);

/*
 * The variant has to break the recorded candidate, or the case proves nothing:
 * a binding that still resolves has not been healed, it has simply not been
 * hurt.
 */
const byName = entry.candidates.find((one) => one.by === "role");
const stillResolves = byName === undefined ? [] : await surface.locate(byName);
process.stderr.write(
  `the recorded role+name candidate now resolves to ${stillResolves.length} element(s)\n`,
);

const result = await relocalize(surface, entry.fingerprint, {
  preferRole: "button",
  // LLD §16: the ground-truth key can never help the repair.
  ignoreAttributes: ["automationId"],
});
const proposed =
  result.outcome === "relocalized" ? await surface.describe(result.match.ref) : undefined;
const key = proposed?.native?.["automationId"];
process.stderr.write(
  `relocalize: ${result.outcome}` +
    (result.outcome === "relocalized" ? ` ${result.match.score.total.toFixed(3)}` : "") +
    `; proposed ${key ?? "nothing"} against the recorded rail-flows\n`,
);

stop();
const ok = stillResolves.length === 0 && result.outcome === "relocalized" && key === "rail-flows";
process.stdout.write(
  ok
    ? "a binding recorded at variant 0 relocalized onto the right element at variant 1\n"
    : "the variant-1 relocalization did not hold\n",
);
process.exit(ok ? 0 : 1);
