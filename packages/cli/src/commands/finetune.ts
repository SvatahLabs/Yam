/**
 * `yam eval finetune corpus` and `yam eval finetune export`
 * (T8.4, T6.5, ADR-4, REQ-COMP-3).
 *
 * ```
 * yam eval finetune corpus [--json]
 * yam eval finetune export [--out evals/compiler/finetune/pairs.jsonl] [--json]
 * ```
 *
 * ## What Phase 7 trained on, and why it made the model worse
 *
 * The first version of this command exported pairs from *merged flows*: every
 * sentence in the fixture projects that the grammar compiled, with the grammar's
 * own step as the answer. Eighty-three pairs, every one of them a **tier 1**
 * compile — and Tier 2 exists for the sentences tier 1 *refuses*. The tuned
 * model was measured at 86.8 % → **13.2 %** on the golden `tier: 2` subset
 * (T7.5, and Phase 7 verification F7): it had been taught to answer the
 * questions it is never asked.
 *
 * Draft 2.9 withdraws the fine-tune from 0.1.0 and makes the corpus its
 * precondition. So the export's source is now the corpus, and the corpus is made
 * of sentences the grammar **refuses**.
 *
 * ## The three sources, and what each contributes
 *
 * | Source | Kind | Contributes |
 * |---|---|---|
 * | `evals/compiler/golden.jsonl`, the `tier: 2` entries | test set | nothing, ever |
 * | `evals/migrate/expected/migration-review.md` | candidates | nothing until reviewed |
 * | `evals/compiler/refused.jsonl` | reviewed pairs | the training set |
 *
 * The golden `tier: 2` subset is *counted* rather than exported: it is the
 * measurement, and a tuned model scored on sentences it was trained on would
 * report an improvement that means nothing. The migration review notes are the
 * legacy sentences a person had to look at by hand — real prose from real files,
 * refused by v3's grammar by construction — and they are collected as candidates
 * so the next batch of reviewed pairs has somewhere to come from. Only
 * `refused.jsonl` carries an answer someone signed for.
 *
 * ## The contamination rule, unchanged
 *
 * Every sentence in `evals/compiler/golden.jsonl` is excluded, normalised, and
 * the count is reported. The export refuses to write a file it cannot say the
 * exclusion count for. This is the property most likely to be got wrong quietly.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import {
  boolOption,
  EXIT,
  stringOption,
  type CommandIo,
  type ExitCode,
  type ParsedArgs,
} from "@svatah/yam-bindings-cli";
import { asExample } from "../tiers/examples.js";
import { TIER2_PROMPT_VERSION } from "../tiers/tier2.js";

/** One training pair. */
export interface Pair {
  /** The sentence, as a person wrote it and the grammar refused it. */
  readonly text: string;
  /**
   * The step, **in the shape a Tier 2 answer has** — not the finished IR.
   *
   * This is the part that would be silently wrong. `modelStepSchema` constrains
   * the model to the *grammar's raw step*: an action, a target *phrase*,
   * literal args as plain strings and references under `argRefs`. The finished
   * `Step` carries an element id, a secret flag, a timeout and a positional id,
   * every one of which is a fact about the project that a model has no basis
   * for (see `@svatah/yam-compiler`'s `raw-schema.ts`).
   *
   * Training on the finished shape would teach the model to emit something the
   * tier's own parser rejects, and the tuned model would score *worse* while
   * every pair looked right in the file. `asExample` is the same converter the
   * prompt's few-shot examples go through, for exactly the same reason.
   */
  readonly step: Record<string, unknown>;
  /** The corpus file it came from, so a reviewer can find it. */
  readonly source: string;
  /** Why the grammar refuses this sentence, as the reviewer put it. */
  readonly why: string;
}

/** One place the corpus draws on, and what it contributed. */
export interface CorpusSource {
  readonly path: string;
  readonly kind: "reviewed" | "test-set" | "candidate";
  /** Sentences found. */
  readonly found: number;
  /** Sentences that became training pairs. */
  readonly exported: number;
  readonly note: string;
}

export interface Corpus {
  readonly sources: readonly CorpusSource[];
  readonly pairs: readonly Pair[];
  /** Sentences dropped because the golden set holds them (the test set). */
  readonly excludedGolden: number;
  /** Sentences dropped because an identical one was already exported. */
  readonly excludedDuplicate: number;
  /** Sentences collected with no reviewed answer yet. */
  readonly candidates: readonly string[];
}

/** A sentence, normalised for comparison against the golden set. */
export function normalise(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

interface RefusedEntry {
  readonly id: string;
  readonly rule: string;
  readonly text: string;
  readonly step: Record<string, unknown>;
  readonly why: string;
  readonly reviewedBy: string;
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as T);
}

/**
 * The legacy sentences the migration asked a person to look at.
 *
 * They are quoted in `migration-review.md` as blockquoted code — the original
 * v1/v2 line, sigils and all — beneath the note about what the migration had to
 * guess. Every one of them is refused by the v3 grammar by construction
 * (REQ-LANG-4), and every one is prose somebody actually wrote, which is what
 * makes them worth collecting. None of them has an accepted step yet, so they
 * are candidates and nothing more.
 */
export function reviewCandidates(markdown: string): string[] {
  return [...markdown.matchAll(/^\s*>\s*`(.+)`\s*$/gm)].map((match) => match[1]!.trim());
}

export interface CorpusOptions {
  readonly root: string;
  readonly goldenPath: string;
  readonly refusedPath: string;
  readonly reviewPath: string;
}

export function readCorpus(options: CorpusOptions): Corpus {
  const { root } = options;
  const rel = (path: string): string => relative(root, path).split("\\").join("/");

  /* 1. The test set. Counted, never exported. */
  const goldenLines = readJsonl<{ tier?: number; text?: string }>(options.goldenPath);
  const golden = new Set(
    goldenLines.map((one) => normalise(one.text ?? "")).filter((one) => one !== ""),
  );
  const goldenTier2 = goldenLines.filter((one) => one.tier === 2).length;

  /* 2. The candidates. Collected, never exported until someone reviews them. */
  const candidates = existsSync(options.reviewPath)
    ? reviewCandidates(readFileSync(options.reviewPath, "utf8"))
    : [];

  /* 3. The reviewed pairs. The training set. */
  const refused = readJsonl<RefusedEntry>(options.refusedPath);
  const pairs: Pair[] = [];
  const seen = new Set<string>();
  let excludedGolden = 0;
  let excludedDuplicate = 0;

  for (const entry of refused) {
    const key = normalise(entry.text);
    if (golden.has(key)) {
      excludedGolden += 1;
      continue;
    }
    if (seen.has(key)) {
      excludedDuplicate += 1;
      continue;
    }
    seen.add(key);
    pairs.push({
      text: entry.text,
      step: asExample(entry.step),
      source: `${rel(options.refusedPath)}#${entry.id}`,
      why: entry.why,
    });
  }

  return {
    sources: [
      {
        path: rel(options.goldenPath),
        kind: "test-set",
        found: goldenTier2,
        exported: 0,
        note:
          "the golden set's `tier: 2` entries — the sentences the eval measures. " +
          "Counted here so the corpus can be read against them, and never exported: " +
          "a tuned model scored on what it was trained on reports nothing.",
      },
      {
        path: rel(options.reviewPath),
        kind: "candidate",
        found: candidates.length,
        exported: 0,
        note:
          "legacy sentences the migration flagged for review. Refused by the v3 grammar " +
          "by construction, and real prose — but no reviewed step yet, so they are where " +
          `the next entries in ${rel(options.refusedPath)} should come from.`,
      },
      {
        path: rel(options.refusedPath),
        kind: "reviewed",
        found: refused.length,
        exported: pairs.length,
        note:
          "sentences the grammar refuses, each with the step a reviewer says it means. " +
          "The only source that contributes a training pair.",
      },
    ],
    pairs,
    excludedGolden,
    excludedDuplicate,
    candidates,
  };
}

function corpusPaths(root: string): CorpusOptions {
  return {
    root,
    goldenPath: join(root, "evals", "compiler", "golden.jsonl"),
    refusedPath: join(root, "evals", "compiler", "refused.jsonl"),
    reviewPath: join(root, "evals", "migrate", "expected", "migration-review.md"),
  };
}

/** Where the repository root is, from anywhere inside it. */
function repoRoot(): string {
  let cursor = process.cwd();
  for (let up = 0; up < 12; up += 1) {
    if (existsSync(join(cursor, "evals", "compiler", "golden.jsonl"))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  return process.cwd();
}

export async function finetuneCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const sub = args.command[2];
  if (sub !== "export" && sub !== "corpus") {
    io.err(
      `Unknown "eval finetune" subcommand ${sub === undefined ? "(none given)" : `"${sub}"`}.\n` +
        "  yam eval finetune corpus [--json]\n" +
        "  yam eval finetune export [--out <path.jsonl>] [--json]\n\n" +
        "Training and the base-versus-tuned comparison are `scripts/finetune-tier2.mjs`, " +
        "which needs a fine-tuning stack this command deliberately does not depend on.",
    );
    return EXIT.usage;
  }

  const root = repoRoot();
  const corpus = readCorpus(corpusPaths(root));
  const json = boolOption(args, "json");

  if (sub === "corpus") {
    if (json) {
      io.out(
        JSON.stringify(
          {
            sources: corpus.sources,
            pairs: corpus.pairs.length,
            excluded: { golden: corpus.excludedGolden, duplicate: corpus.excludedDuplicate },
            candidates: corpus.candidates.length,
          },
          null,
          2,
        ),
      );
    } else {
      io.out("Tier 2 corpus — sentences the grammar refuses (T8.4, ADR-4)\n");
      for (const source of corpus.sources) {
        io.out(
          `  ${source.kind.padEnd(9)} ${String(source.found).padStart(4)} found, ` +
            `${String(source.exported).padStart(4)} exported  ${source.path}`,
        );
        io.out(`            ${source.note}`);
      }
      io.out(
        `\n  ${corpus.pairs.length} training pair(s); excluded ${corpus.excludedGolden} in the ` +
          `golden set and ${corpus.excludedDuplicate} duplicate(s).`,
      );
      io.out("  `yam eval finetune export` writes them, and nothing else.");
    }
    return corpus.pairs.length === 0 ? EXIT.failed : EXIT.ok;
  }

  const out = resolve(root, stringOption(args, "out") ?? "evals/compiler/finetune/pairs.jsonl");

  if (corpus.pairs.length === 0) {
    io.err(
      `No reviewed pairs in ${relative(root, corpusPaths(root).refusedPath)}. ` +
        "The corpus is the export's only source (T8.4): add reviewed (sentence, step) pairs " +
        "there, or run `yam eval finetune corpus` to see what is collected.",
    );
    return EXIT.failed;
  }

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${corpus.pairs.map((pair) => JSON.stringify(pair)).join("\n")}\n`, "utf8");

  /*
   * The manifest, beside the pairs. A training set with no record of where it
   * came from is a training set nobody can reproduce or audit — and the
   * exclusion count is the one number that says the eval was not contaminated.
   */
  const manifest = {
    generatedAt: new Date().toISOString(),
    sources: corpus.sources,
    pairs: corpus.pairs.length,
    /*
     * The shape, named in the manifest. Anyone reading the file has to know it
     * is a Tier 2 *answer* and not the IR, or they will train on the wrong
     * thing and the tuned model will score worse for a reason nobody can see.
     */
    shape: "modelStepSchema (@svatah/yam-compiler raw-schema.ts) — the shape a Tier 2 answer has",
    promptVersion: TIER2_PROMPT_VERSION,
    excluded: { golden: corpus.excludedGolden, duplicate: corpus.excludedDuplicate },
    candidates: corpus.candidates.length,
    note:
      "Every pair is a sentence the grammar refuses, with the step a reviewer says it means " +
      "(T8.4). Phase 7 exported tier 1 grammar compiles instead and the tuned model fell from " +
      "86.8 % to 13.2 % on the golden `tier: 2` subset. Every sentence in " +
      "evals/compiler/golden.jsonl is excluded: it is the test set.",
  };
  writeFileSync(join(dirname(out), "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  if (json) {
    io.out(JSON.stringify({ ...manifest, out: relative(root, out) }, null, 2));
  } else {
    io.err(
      `exported ${corpus.pairs.length} pair(s) from the Tier 2 corpus → ${relative(root, out)}\n` +
        `  every pair is a sentence the grammar refuses, in the shape a Tier 2 answer has\n` +
        `  sources: ${corpus.sources.map((one) => `${one.path} (${one.exported})`).join(", ")}\n` +
        `  excluded: ${corpus.excludedGolden} in the golden set, ` +
        `${corpus.excludedDuplicate} duplicate\n` +
        "  the golden set is the test set and is never trained on",
    );
  }

  return EXIT.ok;
}
