#!/usr/bin/env node
/**
 * Put a project into the app's Recent list (T11.2, T11.4).
 *
 *   node scripts/seed-app-recents.mjs [--project evals/fixtures]
 *
 * `evals/self`'s flows open the fixtures project **through the app's own Recent
 * list**, because that is the gesture a person makes and the one T11.2's
 * Validate names. The Recent list is `<userData>/preferences.json`, which the
 * app writes when somebody opens a project — so on a machine where nobody has,
 * the list is empty and the first sentence of every self flow has nothing to
 * click.
 *
 * This writes that one entry, in the shape `withRecentProject` writes it, and
 * nothing else: the theme and the window size are left as they are, and a
 * project already in the list is moved to the front rather than duplicated.
 *
 * The alternative was `YAM_APP_PROJECT`, which opens a project *for* the app
 * on ready — and then the welcome screen never appears and the flow is not
 * about the Recent list at all. Seeding the list and clicking it is the flow
 * the Validate item asks for.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const at = args.indexOf("--project");
const project = resolve(at < 0 ? join(ROOT, "evals", "fixtures") : args[at + 1]);

/** Where Electron puts the app's user data, per platform. */
const userData =
  process.platform === "darwin"
    ? join(homedir(), "Library", "Application Support", "Yam")
    : process.platform === "win32"
      ? join(process.env["APPDATA"] ?? homedir(), "Yam")
      : join(process.env["XDG_CONFIG_HOME"] ?? join(homedir(), ".config"), "Yam");

const path = join(userData, "preferences.json");
let preferences = { theme: "system", window: { width: 1280, height: 860 }, recentProjects: [] };
if (existsSync(path)) {
  try {
    preferences = { ...preferences, ...(JSON.parse(readFileSync(path, "utf8")) ?? {}) };
  } catch {
    // A file nobody can read is the defaults, exactly as the app treats it.
  }
}

const recent = [
  project,
  ...(preferences.recentProjects ?? []).filter((one) => resolve(one) !== project),
].slice(0, 10);

mkdirSync(userData, { recursive: true });
writeFileSync(path, `${JSON.stringify({ ...preferences, recentProjects: recent }, null, 2)}\n`, "utf8");
process.stdout.write(`${project} is the app's first recent project (${path})\n`);
