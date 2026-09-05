/**
 * `svatah eval finetune export` (T6.5, ADR-4, REQ-COMP-3).
 *
 * ```
 * svatah eval finetune export [--project <dir>]… [--ref master]
 *                             [--out evals/compiler/finetune/pairs.jsonl] [--json]
 * ```
 *
 * > The fine-tune pipeline exports only pairs from plans that were merged,
 * > trains a LoRA on the Tier 2 base model, publishes the digest, and compares
 * > base against tuned on the golden `tier: 2` subset (HLD ADR-4).
 *
 * ## What a pair is, and why "merged" is the whole rule
 *
 * A pair is a sentence and the IR step it compiles to. The step has to be
 * *right*, and the only evidence this project has that a step is right is that
 * a person reviewed the flow it came from and merged it (ADR-1: "every model
 * decision is a committed, diffable file"). So the flows are read **as they are
 * on the merge ref**, through `git show <ref>:<path>`, not from the working
 * tree. A draft in someone's editor is not evidence of anything, and a pipeline
 * that trained on the working tree would learn whatever was half-written when
 * it ran.
 *
 * ## Tier 1's output is the training signal
 *
 * Every exported pair is compiled by the **grammar**, at tier 0 or 1, with no
 * model in the loop. That is not a limitation, it is the point: Tier 2 exists to
 * handle the sentences Tier 1 cannot parse, and what it gets wrong on those is
 * the IR's shape and the action vocabulary. Tier 1's output is the only
 * unimpeachable teacher for both. A pair whose step a *model* produced would be
 * the model's own guess fed back to it.
 *
 * ## The contamination rule
 *
 * Every sentence in `evals/compiler/golden.jsonl` is excluded, normalised, and
 * the count is reported. The golden set is the test set: a tuned model measured
 * on sentences it was trained on would report an improvement that means nothing,
 * and REQ-COMP-9's number would stop being a number. This is the property most
 * likely to be got wrong quietly, so the export refuses to write a file it
 * cannot say the exclusion count for.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { compile } from "@svatah/compiler";
import { readProject } from "@svatah/spec";
import {
  boolOption,
  EXIT,
  stringOption,
  stringOptions,
  type CommandIo,
  type ExitCode,
  type ParsedArgs,
} from "@svatah/bindings-cli";
import { asExample } from "../tiers/examples.js";
import { TIER2_PROMPT_VERSION } from "../tiers/tier2.js";

/** One training pair. */
export interface Pair {
  /** The sentence, as the flow file has it. */
  readonly text: string;
  /**
   * The step, **in the shape a Tier 2 answer has** — not the finished IR.
   *
   * This is the part that would be silently wrong. `modelStepSchema` constrains
   * the model to the *grammar's raw step*: an action, a target *phrase*,
   * literal args as plain strings and references under `argRefs`. The finished
   * `Step` carries an element id, a secret flag, a timeout and a positional id,
   * every one of which is a fact about the project that a model has no basis
   * for (see `@svatah/compiler`'s `raw-schema.ts`).
   *
   * Training on the finished shape would teach the model to emit something the
   * tier's own parser rejects, and the tuned model would score *worse* while
   * every pair looked right in the file. `asExample` is the same converter the
   * prompt's few-shot examples go through, for exactly the same reason.
   */
  readonly step: Record<string, unknown>;
  /** Which merged file it came from, so a reviewer can find it. */
  readonly source: string;
  /** 1: the grammar. Nothing else produces an accepted pair. */
  readonly tier: 1;
}

export interface ExportResult {
  readonly ref: string;
  readonly commit: string;
  readonly projects: readonly string[];
  readonly pairs: readonly Pair[];
  /** Sentences dropped because the golden set holds them (the test set). */
  readonly excludedGolden: number;
  /** Sentences dropped because an identical one was already exported. */
  readonly excludedDuplicate: number;
  /** Sentences the grammar could not parse, which have no accepted step. */
  readonly unparsed: number;
}

/** A sentence, normalised for comparison against the golden set. */
export function normalise(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}



/** Every file under a ref, at a path prefix. */
function filesAt(root: string, ref: string, prefix: string): string[] {
  try {
    return execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "--", prefix], {
      cwd: root,
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.endsWith(".flow"));
  } catch {
    return [];
  }
}

function contentAt(root: string, ref: string, path: string): string | undefined {
  try {
    return execFileSync("git", ["show", `${ref}:${path}`], { cwd: root, encoding: "utf8" });
  } catch {
    return undefined;
  }
}

export function exportPairs(options: {
  readonly root: string;
  readonly ref: string;
  readonly projects: readonly string[];
  readonly goldenPath: string;
}): ExportResult {
  const { root, ref } = options;

  const commit = execFileSync("git", ["rev-parse", ref], { cwd: root, encoding: "utf8" }).trim();

  /* The test set, normalised. Nothing in it may be exported. */
  const golden = new Set<string>();
  if (existsSync(options.goldenPath)) {
    for (const line of readFileSync(options.goldenPath, "utf8").split("\n")) {
      if (line.trim() === "") continue;
      const entry = JSON.parse(line) as { text?: string };
      if (typeof entry.text === "string") golden.add(normalise(entry.text));
    }
  }

  const pairs: Pair[] = [];
  const seen = new Set<string>();
  let excludedGolden = 0;
  let excludedDuplicate = 0;
  let unparsed = 0;

  for (const project of options.projects) {
    const prefix = `${relative(root, resolve(root, project)).split("\\").join("/")}/`;
    const flows = filesAt(root, ref, `${prefix}flows`);
    if (flows.length === 0) continue;

    /*
     * Compiled from the *merged* text, one project at a time, with no model
     * tier registered — so every step here is the grammar's or a custom step's.
     */
    const read = readProject({
      flows: flows.map((path) => ({
        file: path.slice(prefix.length),
        text: contentAt(root, ref, path) ?? "",
      })),
      env: {},
    });
    const compiled = compile({ project: read.project, projectName: project, stable: true });

    for (const story of compiled.plan.stories) {
      for (const step of story.steps) {
        const key = normalise(step.text);
        if (golden.has(key)) {
          excludedGolden += 1;
          continue;
        }
        if (seen.has(key)) {
          excludedDuplicate += 1;
          continue;
        }
        /*
         * The grammar's, or nothing. Tier 0's custom steps compile to
         * `action: "custom"` with a handler this model could never write, and a
         * model tier's answer would be the model's own guess fed back to it —
         * neither is a pair a person accepted.
         */
        if (step.origin.tier !== 1) {
          unparsed += 1;
          continue;
        }
        seen.add(key);
        pairs.push({
          text: step.text,
          step: asExample(step as unknown as Record<string, unknown>),
          source: `${ref}:${prefix}${story.file}`,
          tier: 1,
        });
      }
    }

    // A sentence the grammar refused has no accepted step, by definition.
    unparsed += compiled.diagnostics.filter((one) => one.code === "E_NO_MATCH").length;
  }

  return {
    ref,
    commit,
    projects: [...options.projects],
    pairs,
    excludedGolden,
    excludedDuplicate,
    unparsed,
  };
}

/**
 * The projects whose merged flows are worth learning from, by default.
 *
 * `evals/migrate/expected` is the migration's own committed output — 14 stories
 * of prose that came from real legacy files, which is exactly the register a
 * person writes in. `packages/host-playwright/test/project` is small and its
 * sentences are ordinary.
 *
 * `evals/compiler/project` is *not* here: it exists to compile the golden set,
 * so every sentence in it is a sentence the eval measures. It would be excluded
 * by the contamination rule anyway; leaving it out says why.
 */
const DEFAULT_PROJECTS = [
  "evals/fixtures",
  "evals/migrate/expected",
  "packages/host-playwright/test/project",
];

export async function finetuneCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const sub = args.command[2];
  if (sub !== "export") {
    io.err(
      `Unknown "eval finetune" subcommand ${sub === undefined ? "(none given)" : `"${sub}"`}.\n` +
        "  svatah eval finetune export [--project <dir>]… [--ref master] [--out <path.jsonl>]\n\n" +
        "Training and the base-versus-tuned comparison are `scripts/finetune-tier2.mjs`, " +
        "which needs a fine-tuning stack this command deliberately does not depend on.",
    );
    return EXIT.usage;
  }

  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();
  const ref = stringOption(args, "ref") ?? "master";
  const chosen = stringOptions(args, "project");
  const projects = chosen.length > 0 ? chosen : DEFAULT_PROJECTS;
  const out = resolve(root, stringOption(args, "out") ?? "evals/compiler/finetune/pairs.jsonl");

  let result: ExportResult;
  try {
    result = exportPairs({
      root,
      ref,
      projects,
      goldenPath: join(root, "evals", "compiler", "golden.jsonl"),
    });
  } catch (error) {
    io.err(
      `Could not read the flows at "${ref}": ` +
        `${error instanceof Error ? error.message : String(error)}\n` +
        "Pairs are exported from *merged* flows, so the ref has to exist. " +
        "Use --ref to name another.",
    );
    return EXIT.usage;
  }

  if (result.pairs.length === 0) {
    io.err(
      `No pairs at "${ref}" in ${projects.join(", ")}. Either the projects have no flows ` +
        "there, or every sentence in them is in the golden set.",
    );
    return EXIT.failed;
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${result.pairs.map((pair) => JSON.stringify(pair)).join("\n")}\n`,
    "utf8",
  );

  /*
   * The manifest, beside the pairs. A training set with no record of where it
   * came from is a training set nobody can reproduce or audit — and the
   * exclusion count is the one number that says the eval was not contaminated.
   */
  const manifest = {
    generatedAt: new Date().toISOString(),
    ref: result.ref,
    commit: result.commit,
    projects: result.projects,
    pairs: result.pairs.length,
    /*
     * The shape, named in the manifest. Anyone reading the file has to know it
     * is a Tier 2 *answer* and not the IR, or they will train on the wrong
     * thing and the tuned model will score worse for a reason nobody can see.
     */
    shape: "modelStepSchema (@svatah/compiler raw-schema.ts) — the shape a Tier 2 answer has",
    promptVersion: TIER2_PROMPT_VERSION,
    excluded: {
      golden: result.excludedGolden,
      duplicate: result.excludedDuplicate,
      unparsed: result.unparsed,
    },
    note:
      "Exported from merged flows only (ADR-4). Every sentence in " +
      "evals/compiler/golden.jsonl is excluded: it is the test set, and a tuned model " +
      "measured on sentences it was trained on would report an improvement that means " +
      "nothing.",
  };
  writeFileSync(
    join(dirname(out), "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  if (boolOption(args, "json")) {
    io.out(JSON.stringify({ ...manifest, out: relative(root, out) }, null, 2));
  } else {
    io.err(
      `exported ${result.pairs.length} pair(s) from ${ref} (${result.commit.slice(0, 12)}) ` +
        `→ ${relative(root, out)}\n` +
        `  every pair is a grammar (tier 1) compile, in the shape a Tier 2 answer has\n` +
        `  excluded: ${result.excludedGolden} in the golden set, ` +
        `${result.excludedDuplicate} duplicate, ${result.unparsed} unparsed\n` +
        "  the golden set is the test set and is never trained on",
    );
  }

  return EXIT.ok;
}
