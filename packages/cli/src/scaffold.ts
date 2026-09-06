/**
 * What `yam init` wrote, recognised later (Draft 2.22, REQ-CLI-11).
 *
 * A new project's first `yam record` runs the example story `init` wrote. When
 * that story stops — a page the application does not have, a title it does not
 * carry — the person reads a failure in a flow they did not write and cannot
 * tell whether the application or Yam is at fault. It is neither: the example
 * described some other application. The example carries a marker comment, and
 * a stopped step in a story under that marker is named as the example.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** The first line of every flow `yam init` writes. */
export const SCAFFOLD_MARKER = "// A flow is prose. One sentence per step, no locators, no sigils.";

/** The header of the example `init` wrote before Draft 2.22: a sign-in against a `/login` route. */
export const OLD_SCAFFOLD_MARKER = "// The target phrases below have no bindings yet, so the first run records them";

/** Story name → the flow file, relative to the root, for every story in a scaffold flow. */
export function scaffoldStories(root: string, flowsDir: string): Map<string, string> {
  const found = new Map<string, string>();
  const dir = join(root, flowsDir);
  if (!existsSync(dir)) return found;
  const walk = (at: string): void => {
    for (const name of readdirSync(at)) {
      const path = join(at, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".flow")) {
        const text = readFileSync(path, "utf8");
        if (!text.includes(SCAFFOLD_MARKER) && !text.includes(OLD_SCAFFOLD_MARKER)) continue;
        for (const match of text.matchAll(/^story(?:\s*\([^)]*\))?:\s*(.+?)\s*$/gm)) found.set(match[1]!, relative(root, path));
      }
    }
  };
  walk(dir);
  return found;
}

/**
 * The line under a stopped step that says what the failure is about, when it
 * is about the flow rather than the application or Yam. Nothing when there is
 * nothing to add.
 */
export function stoppedHint(
  stopped: { readonly story: string; readonly failure?: { readonly class: string; readonly message: string } | undefined },
  scaffold: ReadonlyMap<string, string>,
): string | undefined {
  const lines: string[] = [];
  const status = /returned (\d{3})\.?$/.exec(stopped.failure?.message ?? "");
  if (stopped.failure?.class === "navigation" && status !== null) {
    lines.push(
      `The application answered ${status[1]} for that page: the flow says to open a page the application does not have.`,
    );
  }
  const file = scaffold.get(stopped.story);
  if (file !== undefined) {
    lines.push(`"${stopped.story}" is the example \`yam init\` wrote, not a description of your application; edit ${file} to say what your application does.`);
  }
  return lines.length === 0 ? undefined : lines.join("\n");
}
