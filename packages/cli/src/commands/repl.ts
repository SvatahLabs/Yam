/**
 * `svatah repl` (T4.5, REQ-RUN-11, LLD §15).
 *
 * > REPL: one sentence at a time against an open session, appended to a session
 * > flow and bindings.
 *
 * The whole point is that nothing here is a second implementation. A sentence
 * goes through the same compiler `svatah compile` uses, an unbound target is
 * grounded by the same `ground()` `svatah record` uses, and the step is
 * performed by the same `runStep()` the executor uses. What the REPL adds is the
 * loop and the two files it leaves behind: a flow you can commit, and the
 * bindings its steps recorded.
 *
 * That is what makes it useful rather than a toy. A person exploring an
 * application ends the session holding a `.flow` file that replays what they
 * just did, deterministically, with no model in the loop.
 *
 * ## Grounding
 *
 * LLD §15: "grounds unbound targets through the recorder when a gateway is
 * available and through the picker otherwise". The picker needs a headed
 * browser and a person to click, so when there is neither a gateway nor a headed
 * session the REPL says which of the two is missing rather than failing at the
 * step — an unbound target is the normal state of a phrase nobody has recorded,
 * and the answer to it is a decision, not an error.
 *
 * ## Nothing is written until the session ends
 *
 * A binding is staged in memory as it is grounded, so the next sentence can use
 * it, and the store is saved on exit. A session that crashed halfway would
 * otherwise leave a project half-recorded, and REQ-REC-5's "unverified bindings
 * never reach disk" would hold for `record` and not for this.
 */
import { createInterface } from "node:readline";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { BindingsStore, resolve as resolveBinding } from "@svatah/bindings";
import { compileSentence, tierFor } from "@svatah/compiler";
import { ground, type GroundingResult } from "@svatah/recorder";
import { Scope, runStep, type Resolver } from "@svatah/runtime";
import { createSurface, type AgentSurface } from "@svatah/surface";
import type { Config, Step } from "@svatah/schema";
import { formatDiagnostic, TargetDictionary, type Diagnostic } from "@svatah/spec";
import {
  boolOption,
  EXIT,
  sessionTarget,
  stringOption,
  type CommandIo,
  type ExitCode,
  type ParsedArgs,
} from "@svatah/bindings-cli";
import { registerAllAdapters } from "../adapters.js";
import { loadProject } from "../project.js";
import { gatewayForRecording } from "../gateway-for.js";
import { registerModelTiers } from "../tiers/register.js";

const HELP = `Type one sentence at a time. Each is compiled, grounded if it names an element
nothing has recorded yet, and performed against the open session.

  .help                 this
  .url                  where the session is
  .snapshot [n]         the first n lines of the accessibility tree (default 30)
  .bindings             what this session has recorded
  .flow                 the flow this session has written so far
  .undo                 drop the last sentence from the flow (the page is not undone)
  .save                 write the flow and the bindings now, and keep going
  .exit                 write them and stop

Anything else is a step. See docs/flow-language.md for the sentence patterns.
`;

/** One sentence that ran, and the step it compiled to. */
interface Accepted {
  readonly text: string;
  readonly step: Step;
}

export async function replCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = args.command[1] ?? ".";
  const loaded = await loadProject(root);
  for (const one of loaded.diagnostics.filter((d) => d.severity === "error")) {
    io.err(formatDiagnostic(one));
  }

  registerAllAdapters();

  const target = sessionTarget(args, { config: loaded.config.app });
  const config: Config = {
    ...loaded.config,
    ...(stringOption(args, "adapter") === undefined
      ? {}
      : { adapter: stringOption(args, "adapter") as Config["adapter"] }),
    app: { ...loaded.config.app, ...target },
    // Headed by default: a REPL is something a person watches, and the picker
    // needs a window to click in.
    run: { ...loaded.config.run, headless: boolOption(args, "headless") },
  };

  const wantTier2 = boolOption(args, "tier2");
  const wantTier3 = boolOption(args, "tier3");
  if (wantTier2 || wantTier3) {
    const registered = registerModelTiers({
      config,
      wantTier2,
      wantTier3,
      onCall: (line) => io.err(`  ${line}`),
    });
    for (const refusal of registered.refusals) io.err(refusal);
  }

  const bindingsDir = resolve(loaded.root, config.bindings.dir);
  const store = BindingsStore.load(bindingsDir);

  /*
   * The dictionary the REPL compiles against: the project's, plus whatever this
   * session records. A phrase used twice in one session must produce one id and
   * therefore one binding, which is the same rule `compile` follows across a
   * project (REQ-COMP-5).
   */
  const targets = new TargetDictionary();
  targets.addBindings(store.ids().map((id) => ({ id, phrases: store.phrases(id) })));

  const gateway = gatewayForRecording(args, loaded, io, { optional: true });
  const surface = await createSurface(config);
  await surface.open({ ...target });
  if (target.baseUrl !== undefined && surface.kind === "web") {
    await surface.act("navigate", undefined, { url: target.baseUrl });
  }

  const scope = new Scope({ data: loaded.project.data.values, secrets: loaded.project.data.secrets });
  scope.enterStory("REPL session");

  const resolver: Resolver = async (ref, live) => {
    const resolution = await resolveBinding(ref.ref, live, store, {
      candidateTimeoutMs: config.run.candidateTimeoutMs,
      phrase: ref.phrase,
    });
    return { ref: resolution.ref, candidateIndex: resolution.candidateIndex, by: resolution.by };
  };

  const accepted: Accepted[] = [];
  const outDir = resolve(loaded.root, stringOption(args, "out") ?? config.flows.dir);
  const flowPath = join(outDir, `${stringOption(args, "name") ?? sessionName()}.flow`);

  io.err(`svatah repl — ${config.adapter}${target.baseUrl === undefined ? "" : ` at ${target.baseUrl}`}`);
  io.err(
    gateway === undefined
      ? "  no model gateway: a sentence naming an unrecorded element will say so"
      : `  grounding through ${gateway.name}`,
  );
  io.err("  .help for the commands, .exit to write the flow and stop\n");

  const save = (): void => {
    mkdirSync(outDir, { recursive: true });
    writeFileSync(flowPath, renderFlow(accepted), "utf8");
    const written = store.save();
    io.err(
      `wrote ${relative(loaded.root, flowPath)} (${accepted.length} step(s))` +
        (written.written.length === 0
          ? ""
          : ` and ${written.written.length} binding file(s) under ${config.bindings.dir}`),
    );
  };

  const lines = createInterface({ input: process.stdin, terminal: false });
  try {
    for await (const raw of lines) {
      const line = raw.trim();
      if (line === "" || line.startsWith("//") || line.startsWith("#")) continue;

      if (line.startsWith(".")) {
        const done = await meta(line, {
          io,
          surface,
          store,
          accepted,
          save,
        });
        if (done) break;
        continue;
      }

      await sentence(line, {
        io,
        surface,
        store,
        targets,
        scope,
        resolver,
        config,
        gateway,
        accepted,
        bindingsDir,
      });
    }
  } finally {
    lines.close();
    save();
    await surface.close().catch(() => undefined);
  }

  if (boolOption(args, "json")) {
    io.out(
      JSON.stringify(
        {
          flow: relative(loaded.root, flowPath),
          steps: accepted.map((one) => ({ text: one.text, action: one.step.action })),
          bindings: store.ids(),
        },
        null,
        2,
      ),
    );
  }
  return EXIT.ok;
}

/* ── one sentence ─────────────────────────────────────────────────────────── */

interface SentenceContext {
  readonly io: CommandIo;
  readonly surface: AgentSurface;
  readonly store: BindingsStore;
  readonly targets: TargetDictionary;
  readonly scope: Scope;
  readonly resolver: Resolver;
  readonly config: Config;
  readonly gateway: Parameters<typeof ground>[2]["gateway"] | undefined;
  readonly accepted: Accepted[];
  readonly bindingsDir: string;
}

async function sentence(text: string, context: SentenceContext): Promise<void> {
  const { io } = context;

  const compiled = await compileOne(text, context);
  if (compiled.step === undefined) {
    for (const one of compiled.diagnostics) io.err(`  ${one.code}: ${one.message}`);
    return;
  }
  const step = compiled.step;

  /*
   * An unbound target is the normal state of a phrase nobody has recorded. It is
   * grounded here, once, and staged into the live store so the next sentence
   * naming the same element resolves it without asking again (REQ-REC-1).
   *
   * `staged` is what makes REQ-REC-5 hold here as it does for `svatah record`:
   * "the recorder performs the step with the top candidate and verifies any
   * expectation before committing". A binding is in the store only so the
   * resolver can find it; it is *kept* only if the step it was grounded for
   * passed, and rolled back if it did not.
   */
  const staged =
    step.target !== undefined && !context.store.has(step.target.ref) ? step.target.ref : undefined;
  if (staged !== undefined) {
    const grounded = await groundTarget(staged, step.target!.phrase, context);
    if (grounded === undefined) return;
  }

  const outcome = await runStep(step, {
    surface: context.surface,
    scope: context.scope,
    resolve: context.resolver,
    stepTimeoutMs: context.config.run.stepTimeoutMs,
    screenshots: "never",
  });

  if (outcome.status === "passed") {
    // The step performed through it, so the binding is verified (REQ-REC-5).
    if (staged !== undefined) {
      const entry = context.store.entryFor(staged, {});
      if (entry !== undefined) {
        context.store.put(staged, { ...entry, verified: true }, undefined, {
          replaces: entry.context,
        });
      }
    }
    context.accepted.push({ text, step });
    const captured = Object.entries(outcome.captured ?? {});
    io.err(
      `  ✓ ${step.action}` +
        (step.target === undefined ? "" : ` ${step.target.ref}`) +
        (outcome.matched === undefined ? "" : ` (by ${outcome.matched.by})`) +
        (captured.length === 0 ? "" : ` → ${captured.map(([k, v]) => `${k}=${String(v)}`).join(", ")}`),
    );
    return;
  }

  /*
   * A failed sentence is *not* appended to the flow, and a binding grounded for
   * it is rolled back. The flow is what the session did successfully; a step
   * that failed is one the person will rephrase or fix, and an unverified
   * binding must never reach disk (REQ-REC-5).
   */
  if (staged !== undefined) {
    context.store.remove(staged);
    io.err(`  dropped the binding grounded for "${step.target!.phrase}": the step did not pass`);
  }
  io.err(`  ✗ ${outcome.failure?.class ?? outcome.status}: ${outcome.failure?.message ?? "failed"}`);
}

/** Compile one sentence, asking the registered model tiers about the residue. */
async function compileOne(
  text: string,
  context: SentenceContext,
): Promise<{ step?: Step; diagnostics: readonly Diagnostic[] }> {
  const lower = {
    targets: context.targets,
    secrets: new Set<string>(),
    file: "repl",
    line: context.accepted.length + 1,
    stepTimeoutMs: context.config.run.stepTimeoutMs,
  };
  const raw = { text, line: context.accepted.length + 1 };
  const identity = {
    id: `REPL session#${context.accepted.length + 1}`,
    storyName: "REPL session",
    file: "repl",
    lower,
  };

  const grammar = compileSentence(raw, identity);
  if (grammar.step !== undefined) return grammar;

  for (const level of [2, 3] as const) {
    const tier = tierFor(level);
    if (tier === undefined) continue;
    const answer = await tier
      .compile(text, { file: "repl", line: raw.line, storyName: "REPL session" })
      .catch(() => undefined);
    if (answer === undefined) continue;
    const withModel = compileSentence(raw, {
      ...identity,
      modelAnswers: new Map([[`repl:${raw.line}:${text}`, { ...answer, tier: level }]]),
    });
    if (withModel.step !== undefined) {
      context.io.err(`  (tier ${level}, confidence ${answer.confidence.toFixed(2)})`);
      return withModel;
    }
  }
  return grammar;
}

/**
 * Ground one target and stage it into the live store (LLD §15).
 *
 * Returns the entry, or nothing when it could not be grounded — in which case
 * the reason has already been printed, because "no model" and "the model could
 * not find it" are different problems with different answers.
 */
async function groundTarget(
  id: string,
  phrase: string,
  context: SentenceContext,
): Promise<GroundingResult["entry"] | undefined> {
  const { io } = context;
  if (context.gateway === undefined) {
    io.err(
      `  "${phrase}" is not in the bindings store and there is no model to ground it with.\n` +
        "    Set ANTHROPIC_API_KEY (or run `ant auth login`), or pass --gateway fake to ground\n" +
        "    from the grounding eval's committed answers — which is a fixture, not a model.",
    );
    return undefined;
  }

  const result = await ground({ id, phrase }, context.surface, {
    gateway: context.gateway,
    maxSnapshotTokens: context.config.record.maxSnapshotTokens,
    visionFallback: context.config.record.visionFallback,
    environment: context.config.environment,
    testIdAttributes: context.config.bindings.testIdAttributes,
    ...(context.config.bindings.ignoreAttributes === undefined
      ? {}
      : { ignoreAttributes: context.config.bindings.ignoreAttributes }),
    ...(context.config.bindings.matchHost === undefined
      ? {}
      : { matchHost: context.config.bindings.matchHost }),
  });

  if (result.entry === undefined) {
    io.err(`  could not ground "${phrase}": ${result.decision.outcome}${result.decision.why === undefined ? "" : ` — ${result.decision.why}`}`);
    return undefined;
  }

  context.store.put(id, result.entry, phrase);
  context.targets.addBindings([{ id, phrases: [phrase] }]);
  io.err(`  grounded "${phrase}" → ${id} (by ${result.entry.candidates[0]?.by ?? "?"})`);
  return result.entry;
}

/* ── the meta commands ────────────────────────────────────────────────────── */

interface MetaContext {
  readonly io: CommandIo;
  readonly surface: AgentSurface;
  readonly store: BindingsStore;
  readonly accepted: readonly Accepted[];
  save(): void;
}

/** Returns true when the session should end. */
async function meta(line: string, context: MetaContext): Promise<boolean> {
  const [command, argument] = line.split(/\s+/, 2);
  const { io } = context;

  switch (command) {
    case ".help":
      io.err(HELP);
      return false;
    case ".exit":
    case ".quit":
      return true;
    case ".save":
      context.save();
      return false;
    case ".url":
      io.err(`  ${String(await context.surface.read("url"))}`);
      return false;
    case ".snapshot": {
      const limit = Number(argument ?? 30);
      const snapshot = await context.surface.snapshot();
      io.err(
        snapshot.text
          .split("\n")
          .slice(0, Number.isFinite(limit) ? limit : 30)
          .map((one) => `  ${one}`)
          .join("\n"),
      );
      io.err(`  … ${snapshot.nodes.length} nodes, ${snapshot.tokensEstimate} tokens`);
      return false;
    }
    case ".bindings":
      io.err(context.store.ids().map((id) => `  ${id}`).join("\n") || "  (none)");
      return false;
    case ".flow":
      io.err(renderFlow(context.accepted));
      return false;
    case ".undo": {
      // The *flow* is undone, not the page: nothing here can un-click a button,
      // and pretending otherwise would be worse than saying so.
      const dropped = (context.accepted as Accepted[]).pop();
      io.err(dropped === undefined ? "  nothing to undo" : `  dropped "${dropped.text}"`);
      return false;
    }
    default:
      io.err(`  unknown command "${command}". .help for the list.`);
      return false;
  }
}

/* ── the flow the session leaves behind ───────────────────────────────────── */

/** `repl-2026-09-03T19-42-11`: sortable, and unique per session. */
function sessionName(): string {
  return `repl-${new Date().toISOString().replace(/[:.]/g, "-").replace(/Z$/, "")}`;
}

/**
 * The session, as a flow file (REQ-RUN-11).
 *
 * One story, one sentence per step, and a run block — the same shape `svatah
 * init` writes and `svatah compile` reads, so the file a session leaves behind
 * is a file the rest of the toolchain already knows what to do with.
 */
export function renderFlow(accepted: readonly Accepted[]): string {
  const header = [
    "// Written by `svatah repl`.",
    "//",
    "// Every sentence here ran successfully against a live session, and the",
    "// elements they name are in the bindings store. `svatah run` replays it",
    "// with no model in the loop.",
    "",
    "story: REPL session",
  ];
  const steps = accepted.map((one) => `  ${one.text}`);
  return [...header, ...(steps.length === 0 ? ["  // (no steps)"] : steps), "", "test: REPL session", ""].join(
    "\n",
  );
}
