/**
 * `svatah eval compiler` (T4.3, T4.4, REQ-COMP-9, REQ-PKG-4).
 *
 * ```
 * svatah eval compiler [--tier2] [--tier3] [--gateway local|anthropic|fake]
 *                      [--only tier1,tier2] [--report reports/eval-compiler.md] [--json]
 * ```
 *
 * Every golden entry is compiled the way its tier says it should be: a `tier: 1`
 * entry through the grammar alone, a `tier: 2` entry with the local model
 * registered, a `tier: 3` entry with the frontier model. The report is per tier,
 * because "95 percent end to end" and "100 percent on the grammar" are different
 * claims and REQ-COMP-9 makes both.
 *
 * Two things the report always says, because a number without them is not a
 * result: **which gateway** produced the model-tier answers, and whether it was
 * a real model. A fake's 100 percent measures the harness.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  compileSentence,
  readGolden,
  scoreCase,
  summarise,
  tierFor,
  type CaseResult,
  type EvalReport,
  type GoldenEntry,
} from "@svatah/compiler";
import { fakeGateway, type Gateway } from "@svatah/gateway";
import { parseTargets, readData, TargetDictionary } from "@svatah/spec";
import {
  boolOption,
  EXIT,
  stringOption,
  type CommandIo,
  type ExitCode,
  type ParsedArgs,
} from "@svatah/bindings-cli";
import { loadConfig } from "../project.js";
import { registerModelTiers } from "../tiers/register.js";
import { loadSteps, type StepRegistry } from "@svatah/steps";

/** The thresholds REQ-COMP-9 names. */
export const TIER1_THRESHOLD = 1;
export const TIER2_THRESHOLD = 0.8;
export const OVERALL_THRESHOLD = 0.95;

/**
 * The project the golden set compiles against (`evals/compiler/project`).
 *
 * Three entries need it and nothing else does: `{data.card.number}` compiles to
 * a `secret` value only because `data.yaml`'s `secrets:` list says so, and
 * "the frame button" carries `scope: frame` only because `targets.yaml` says so.
 * Both are properties of the *project*, not of the sentence — which is exactly
 * why they are declared in a project rather than in the corpus, and why an eval
 * that compiled against an empty one would score the compiler as wrong for being
 * right.
 */
interface GoldenProject {
  readonly secrets: ReadonlySet<string>;
  readonly targets: Record<string, unknown>;
  readonly steps?: StepRegistry;
  /** What the Tier 0 loader said, if anything. Printed, never swallowed. */
  readonly loaderDiagnostics: readonly string[];
}

async function loadGoldenProject(dir: string): Promise<GoldenProject> {
  const data = existsSync(join(dir, "data.yaml"))
    ? readData(readFileSync(join(dir, "data.yaml"), "utf8"), "data.yaml").data
    : undefined;
  const targets = existsSync(join(dir, "targets.yaml"))
    ? parseTargets(
        (await import("yaml")).parse(readFileSync(join(dir, "targets.yaml"), "utf8")),
        "targets.yaml",
      ).targets
    : {};
  /*
   * The Tier 0 custom steps the `tier: 0` entries compile against. A loader
   * diagnostic is surfaced rather than swallowed: three entries would otherwise
   * fall through to the model tiers and be scored as model failures, which is
   * the opposite of what they measure (LLD §5).
   */
  let steps: StepRegistry | undefined;
  const loaderDiagnostics: string[] = [];
  if (existsSync(join(dir, "steps"))) {
    const loaded = await loadSteps(dir, "steps");
    steps = loaded.registry;
    for (const one of loaded.diagnostics) loaderDiagnostics.push(one.message);
  }

  return {
    secrets: data?.secrets ?? new Set<string>(),
    targets: targets as Record<string, unknown>,
    ...(steps === undefined ? {} : { steps }),
    loaderDiagnostics,
  };
}

/**
 * Compile one golden sentence in isolation.
 *
 * A fresh dictionary per case, seeded from the project's `targets.yaml` and from
 * nothing else, so one entry's phrases cannot bind another's: the golden set
 * measures *translation*, and a run in which "the sign in button" happened to be
 * bound by an earlier case would be measuring order.
 */
async function compileEntry(
  entry: GoldenEntry,
  options: { stepTimeoutMs: number; project: GoldenProject },
): Promise<CaseResult> {
  const targets = new TargetDictionary();
  targets.addTargets(options.project.targets as never);
  const lower = {
    targets,
    secrets: options.project.secrets,
    file: "golden",
    line: 1,
    stepTimeoutMs: options.stepTimeoutMs,
  };
  const raw = { text: entry.text, line: 1 };
  const context = {
    id: `Golden/${entry.id}`,
    storyName: "Golden",
    file: "golden",
    lower,
    ...(options.project.steps === undefined ? {} : { registry: options.project.steps }),
  };

  const grammar = compileSentence(raw, context);
  if (grammar.step !== undefined) return scoreCase(entry, grammar.step);

  /*
   * The grammar refused, which is what a Tier 2 or Tier 3 entry is *for*. Ask
   * the tiers in order and stop at the first that answers, exactly as
   * `compileWithModelTiers` does — one sentence at a time, because the eval
   * scores sentences rather than plans.
   */
  for (const level of [2, 3] as const) {
    const tier = tierFor(level);
    if (tier === undefined) continue;
    let answer;
    try {
      answer = await tier.compile(entry.text, { file: "golden", line: 1, storyName: "Golden" });
    } catch (error) {
      return scoreCase(entry, undefined, error instanceof Error ? error.message : String(error));
    }
    if (answer === undefined) continue;

    const withModel = compileSentence(raw, {
      ...context,
      modelAnswers: new Map([
        [`golden:1:${entry.text}`, { ...answer, tier: level }],
      ]),
    });
    if (withModel.step !== undefined) return scoreCase(entry, withModel.step);
    return scoreCase(
      entry,
      undefined,
      withModel.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; "),
    );
  }

  return scoreCase(
    entry,
    undefined,
    grammar.diagnostics.map((d) => `${d.code}: ${d.message}`).join("; ") ||
      "no tier claimed the sentence",
  );
}

export async function compilerEvalCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = stringOption(args, "project") ?? ".";
  const goldenPath = resolve(
    stringOption(args, "golden") ?? join(root, "evals", "compiler", "golden.jsonl"),
  );

  let entries: GoldenEntry[];
  try {
    entries = readGolden(goldenPath);
  } catch (error) {
    io.err(error instanceof Error ? error.message : String(error));
    return EXIT.usage;
  }

  const only = stringOption(args, "only")
    ?.split(",")
    .map((one) => Number(one.trim().replace(/^tier/, "")));
  const selected = only === undefined ? entries : entries.filter((e) => only.includes(e.tier));

  const wantTier2 = boolOption(args, "tier2") || selected.some((e) => e.tier === 2);
  const wantTier3 = boolOption(args, "tier3") || selected.some((e) => e.tier === 3);
  const { config } = loadConfig(resolve(root));

  /*
   * `--gateway fake` answers every model-tier question with the golden answer,
   * so the *harness* can be verified with no model at all — and so a report can
   * never be mistaken for a measurement, because it says `fake:golden` at the
   * top and `real: false` in the JSON (REQ-PKG-4, and Phase 3's D1).
   */
  const gatewayChoice = stringOption(args, "gateway") ?? "local";
  const gateways: { tier2?: Gateway; tier3?: Gateway } = {};
  if (gatewayChoice === "fake") {
    const answers = new Map(selected.map((e) => [e.text, goldenAsModelAnswer(e)]));
    const fake = fakeGateway({
      label: "golden",
      answer: (request) => answers.get(request.user) ?? null,
    });
    if (wantTier2) gateways.tier2 = fake;
    if (wantTier3) gateways.tier3 = fake;
  }

  const registered = registerModelTiers({
    config,
    wantTier2,
    wantTier3,
    ...(Object.keys(gateways).length === 0 ? {} : { gateways }),
  });
  for (const refusal of registered.refusals) io.err(refusal);

  const gatewayName =
    gatewayChoice === "fake"
      ? "fake:golden"
      : registered.tier3
        ? `anthropic:${config.compile.tier3?.model ?? "?"}`
        : registered.tier2
          ? `${config.compile.tier2?.provider ?? "local"}:${config.compile.tier2?.model ?? "?"}`
          : "(none)";

  const project = await loadGoldenProject(
    resolve(stringOption(args, "golden-project") ?? join(dirname(goldenPath), "project")),
  );

  for (const one of project.loaderDiagnostics) io.err(`  steps/: ${one}`);

  const cases: CaseResult[] = [];
  for (const entry of selected) {
    const result = await compileEntry(entry, { stepTimeoutMs: 10_000, project });
    cases.push(result);
    if (!boolOption(args, "json")) {
      io.err(`  ${result.ok ? "ok  " : "FAIL"} ${result.id} tier ${result.tier}  ${result.text}`);
    }
  }

  const report = summarise(cases, {
    gateway: gatewayName,
    real: gatewayChoice !== "fake" && (registered.tier2 || registered.tier3),
  });

  const reportPath = stringOption(args, "report");
  if (reportPath !== undefined) {
    mkdirSync(dirname(resolve(reportPath)), { recursive: true });
    writeFileSync(resolve(reportPath), renderCompilerReport(report), "utf8");
    io.err(`wrote ${reportPath}`);
  }

  if (boolOption(args, "json")) io.out(JSON.stringify(report, null, 2));
  else io.out(renderCompilerSummary(report));

  return meetsThresholds(report) ? EXIT.ok : EXIT.failed;
}

/** Whether a report clears the thresholds REQ-COMP-9 names for the tiers it ran. */
export function meetsThresholds(report: EvalReport): boolean {
  const tier1 = report.byTier["tier1"];
  const tier2 = report.byTier["tier2"];
  if (tier1 !== undefined && tier1.rate < TIER1_THRESHOLD) return false;
  if (tier2 !== undefined && tier2.rate < TIER2_THRESHOLD) return false;
  return report.totals.rate >= OVERALL_THRESHOLD;
}

/** A golden entry, in the shape a model tier would have answered with. */
function goldenAsModelAnswer(entry: GoldenEntry): Record<string, unknown> {
  const step = entry.step as Record<string, unknown>;
  const out: Record<string, unknown> = { action: step["action"] };
  const target = step["target"] as { phrase?: string; scope?: string } | undefined;
  if (target?.phrase !== undefined) {
    out["target"] =
      target.scope === undefined ? { phrase: target.phrase } : { phrase: target.phrase, scope: target.scope };
  }
  const target2 = step["target2"] as { phrase?: string } | undefined;
  if (target2?.phrase !== undefined) out["target2"] = { phrase: target2.phrase };

  const args: Record<string, unknown> = {};
  const argRefs: Record<string, unknown> = {};
  for (const [name, value] of Object.entries((step["args"] ?? {}) as Record<string, unknown>)) {
    const ref = value as { kind?: string; value?: string; path?: string; name?: string };
    if (typeof value !== "object" || value === null) {
      args[name] = value;
    } else if (ref.kind === "literal") {
      args[name] = ref.value;
    } else if (ref.kind === "data") {
      argRefs[name] = { kind: "data", value: ref.path };
    } else if (ref.kind === "input") {
      argRefs[name] = { kind: "input", value: ref.name };
    } else if (ref.kind === "var") {
      argRefs[name] = { kind: "var", value: ref.name };
    }
  }
  if (Object.keys(args).length > 0) out["args"] = args;
  if (Object.keys(argRefs).length > 0) out["argRefs"] = argRefs;
  for (const field of ["expect", "capture"]) {
    if (step[field] !== undefined) out[field] = step[field];
  }
  return out;
}

/* ── reporting ────────────────────────────────────────────────────────────── */

export function renderCompilerSummary(report: EvalReport): string {
  const lines = [`Compiler eval — ${report.gateway}${report.real ? "" : " (not a model)"}`, ""];
  for (const [tier, bucket] of Object.entries(report.byTier).sort()) {
    lines.push(
      `  ${tier}: ${bucket.matched}/${bucket.total} exact match (${(bucket.rate * 100).toFixed(1)}%)`,
    );
  }
  lines.push(
    "",
    `  overall: ${report.totals.matched}/${report.totals.total} ` +
      `(${(report.totals.rate * 100).toFixed(1)}%)`,
    "",
    meetsThresholds(report)
      ? "  Meets REQ-COMP-9."
      : "  Below REQ-COMP-9's thresholds (tier 1 100%, tier 2 80%, overall 95%).",
  );
  return lines.join("\n");
}

export function renderCompilerReport(report: EvalReport): string {
  const lines = [
    "# Compiler eval",
    "",
    `Run at ${report.at}.`,
    "",
  ];

  if (!report.real) {
    lines.push(
      `**This run used \`${report.gateway}\`, which is not a model.** Its numbers measure the`,
      "harness — that every sentence is offered to the right tier and that an answer of the",
      "right shape is scored correctly — and nothing about a model's accuracy.",
      "",
    );
  } else {
    lines.push(`Model-tier answers came from \`${report.gateway}\`.`, "");
  }

  lines.push(
    `**Overall exact match: ${(report.totals.rate * 100).toFixed(1)}%** ` +
      `(${report.totals.matched} of ${report.totals.total}).`,
    "",
    "## Per tier (REQ-COMP-9)",
    "",
    "| Tier | Cases | Exact match | Threshold |",
    "|---|---|---|---|",
  );
  const thresholds: Record<string, string> = { tier1: "100%", tier2: "80%", tier3: "—", tier0: "—" };
  for (const [tier, bucket] of Object.entries(report.byTier).sort()) {
    lines.push(
      `| \`${tier}\` | ${bucket.total} | ${bucket.matched} (${(bucket.rate * 100).toFixed(1)}%) | ` +
        `${thresholds[tier] ?? "—"} |`,
    );
  }

  lines.push(
    "",
    "## Method",
    "",
    "Every entry in `evals/compiler/golden.jsonl` is compiled on its own, with a fresh target",
    "dictionary, so no entry's phrases can bind another's. A `tier: 1` entry goes through the",
    "grammar; a `tier: 2` entry is a sentence the grammar deliberately refuses, and is offered",
    "to the local model; a `tier: 3` entry is offered to the frontier model.",
    "",
    "A case matches when the compiled step is **byte-identical** to the expected one on the",
    "part the sentence determines: action, target phrase, arguments, expectation, capture and",
    "originating tier. The step id, the line, the timeout and the provenance are not compared —",
    "the first three come from the project rather than the sentence, and the fourth is",
    "different on every run by construction.",
    "",
  );

  const failures = report.cases.filter((c) => !c.ok);
  if (failures.length > 0) {
    lines.push("## Not matched", "");
    for (const one of failures) {
      lines.push(`### \`${one.id}\` (tier ${one.tier})`, "", `> ${one.text}`, "");
      if (one.error !== undefined) lines.push(`No step: ${one.error}`, "");
      else {
        lines.push("```diff", `- ${one.expected ?? ""}`, `+ ${one.actual ?? ""}`, "```", "");
      }
    }
  }

  return `${lines.join("\n")}\n`;
}
