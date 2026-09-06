/**
 * `yam host generate` (REQ-RUN-12, LLD §9.1).
 *
 * Writes `.yam/specs/<flow>.spec.ts`: one `test()` per story, in order, under
 * a serial `describe`.
 *
 * ```ts
 * import { test } from "@svatah/yam-host-playwright";
 * test.describe("simple.flow", () => {
 *   test("Validate login", async ({ yam }) => { await yam.runStory("Validate login"); });
 * });
 * ```
 *
 * ## Why generate a file at all
 *
 * Playwright Test discovers tests by importing files and collecting `test()`
 * calls. A flow is not a file it knows about, so something has to be the file.
 * Generating one — rather than registering tests dynamically — is what gives a
 * flow everything the runner already does: `--grep`, sharding, the HTML report's
 * per-test entries, retries, the trace viewer, and a name in the terminal that
 * matches the story in the flow file.
 *
 * The generated file is committed or not as the project prefers; it is derived,
 * so `.yam/` is the natural home and `.gitignore` the natural treatment.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Plan } from "@svatah/yam-schema";

export interface GenerateOptions {
  readonly plan: Plan;
  /** Where the specs go. Default `.yam/specs`. */
  readonly outDir?: string;
  /** The package the generated spec imports. Overridden in this repo's tests. */
  readonly importFrom?: string;
  /** Where the plan is, relative to the project root, for the fixture to load. */
  readonly planPath?: string;
}

export interface GeneratedSpec {
  /** Absolute path written. */
  readonly path: string;
  readonly flow: string;
  readonly stories: readonly string[];
  readonly text: string;
}

/** A flow file path as a spec file name: `flows/simple.flow` → `simple`. */
export function specName(flow: string): string {
  return basename(flow).replace(/\.flow$/, "");
}

/** The spec's text for one flow. Pure, so it can be asserted without a disk. */
export function renderSpec(
  flow: string,
  stories: readonly string[],
  options: { importFrom?: string; planPath?: string } = {},
): string {
  const from = options.importFrom ?? "@svatah/yam-host-playwright";
  const lines = [
    "/*",
    ` * GENERATED from ${flow} by \`yam host generate\` — do not edit.`,
    " *",
    " * One test per story, in the order the flow's run block gives, under a serial",
    " * describe so a later story sees what an earlier one did (LLD §9.1).",
    " */",
    `import { test } from ${JSON.stringify(from)};`,
    "",
    ...(options.planPath === undefined
      ? []
      : [`test.use({ yamPlan: ${JSON.stringify(options.planPath)}, yamFlow: ${JSON.stringify(flow)} });`, ""]),
    `test.describe(${JSON.stringify(flow)}, () => {`,
    "  test.describe.configure({ mode: \"serial\" });",
    "",
    ...stories.map(
      (story) =>
        `  test(${JSON.stringify(story)}, async ({ yam }) => {\n` +
        `    await yam.runStory(${JSON.stringify(story)});\n` +
        `  });`,
    ),
    "});",
    "",
  ];
  return lines.join("\n");
}

/**
 * Write one spec per flow that has something to run.
 *
 * A flow with an empty run block produces no file rather than an empty one: an
 * empty spec is a test file Playwright reports as having no tests, which reads
 * like a configuration problem.
 */
export function generateSpecs(options: GenerateOptions): GeneratedSpec[] {
  const outDir = options.outDir ?? join(".yam", "specs");
  mkdirSync(outDir, { recursive: true });

  const out: GeneratedSpec[] = [];
  for (const [flow, names] of Object.entries(options.plan.runs)) {
    const stories = expand(options.plan, names);
    if (stories.length === 0) continue;

    const text = renderSpec(flow, stories, {
      ...(options.importFrom === undefined ? {} : { importFrom: options.importFrom }),
      ...(options.planPath === undefined ? {} : { planPath: options.planPath }),
    });
    const path = join(outDir, `${specName(flow)}.spec.ts`);
    writeFileSync(path, text, "utf8");
    out.push({ path, flow, stories, text });
  }
  return out;
}

/** Compositions expand in place (REQ-LANG-10). */
function expand(plan: Plan, names: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    const composition = plan.compositions[name];
    if (composition !== undefined) out.push(...composition);
    else out.push(name);
  }
  return out.filter((name) => plan.stories.some((story) => story.name === name && story.meta.enabled));
}

/**
 * Whether retries are permitted for a story (LLD §9.1).
 *
 * "Retries: disabled by default; enabled only if the flow's policy is `continue`
 * or the story is `idempotent`."
 *
 * A retry re-runs a story from the top. For a story that books a slot, that is a
 * second booking — so the default has to be off, and turning it on has to be
 * something the flow said, not something a config flag did globally.
 */
export function retriesAllowed(plan: Plan, storyName: string): boolean {
  const story = plan.stories.find((s) => s.name === storyName);
  if (story === undefined) return false;
  if (story.meta.idempotent === true) return true;
  return story.meta.onFailure === "continue";
}
