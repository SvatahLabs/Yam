/**
 * `yam record` with no flow named: capture (Draft 2.23, REQ-REC-13, LLD §15.1).
 *
 *   yam record [dir] [--name <story>]
 *
 * "I want to create a new flow, and I am recording it as my manual
 * interaction." The browser opens at the application; the person drives; each
 * thing they do becomes a sentence, and each element they touch a binding.
 * Enter at the terminal, or closing the browser, ends it; the flow is written
 * under `flows/`, the bindings under `bindings/`, and `yam` says what is next.
 *
 * Binding a flow somebody wrote is the other thing this verb does, and it is
 * asked for by naming the flow: `yam record --flow <file>` (or `--all`).
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { EXIT, sessionTarget, stringOption, type CommandIo, type ExitCode, type ParsedArgs } from "@svatah/yam-bindings-cli";
import type { BindingsStore } from "@svatah/yam-bindings";
import { capture } from "@svatah/yam-recorder";
import type { Config } from "@svatah/yam-schema";
import { createSurface, type AgentSurface } from "@svatah/yam-surface";
import { registerAllAdapters } from "../adapters.js";
import { diagnostic, say } from "../diagnostics.js";
import { loadProject } from "../project.js";
import { loadBindings } from "./run.js";

/** Whether a person is at this terminal to drive, or a script stands in (`YAM_OBSERVE`). */
export function personCanDrive(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env["YAM_OBSERVE"] ?? "") !== "") return true;
  return process.stdin.isTTY === true && process.stdout.isTTY === true && (env["CI"] ?? "") === "";
}

/** A file name for a story: `Sign in` → `sign-in.flow`, not overwriting one that exists. */
export function flowFileFor(dir: string, story: string): string {
  const base = story.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "recorded";
  let name = `${base}.flow`;
  for (let n = 2; existsSync(join(dir, name)); n += 1) name = `${base}-${n}.flow`;
  return name;
}

/** What a capture left in the project. */
export interface CapturedFlow {
  /** The flow file, relative to the project root. */
  readonly file: string;
  readonly story: string;
  readonly steps: readonly string[];
  readonly inputs: Readonly<Record<string, "string" | "secret">>;
  /** Element ids bound from what was done. */
  readonly bound: readonly string[];
  /** Phrases a sentence names that could not be bound. */
  readonly unbound: readonly string[];
  /** Binding files the store wrote, relative to the project root. */
  readonly written: readonly string[];
}

/**
 * Capture into an open session: the sentences, the flow file, the store.
 *
 * Shared by `yam record` and the service's `POST /capture` (Draft 2.23), for
 * the reason LLD §13.5 already gives about grounding: an app that recorded
 * through its own code and a person who recorded through `yam record` would be
 * doing two different things, and the flow would be whichever one wrote it.
 */
export async function captureIntoProject(options: {
  readonly loaded: Awaited<ReturnType<typeof loadProject>>;
  readonly store: BindingsStore;
  readonly surface: AgentSurface;
  readonly config: Config;
  readonly name: string;
  readonly signal?: AbortSignal;
  readonly onStep?: (sentence: string) => void;
  readonly log?: (message: string) => void;
}): Promise<CapturedFlow> {
  const { loaded, store, surface, config } = options;
  const outcome = await capture({
    surface,
    store,
    name: options.name,
    ...(config.app.baseUrl === undefined ? {} : { startUrl: config.app.baseUrl }),
    testIdAttributes: config.bindings.testIdAttributes,
    ...(config.bindings.ignoreAttributes === undefined ? {} : { ignoreAttributes: config.bindings.ignoreAttributes }),
    ...(config.bindings.matchHost === undefined ? {} : { matchHost: config.bindings.matchHost }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
    ...(options.onStep === undefined ? {} : { onStep: options.onStep }),
    ...(options.log === undefined ? {} : { log: options.log }),
  });

  const flowsDir = resolve(loaded.root, loaded.config.flows.dir);
  mkdirSync(flowsDir, { recursive: true });
  const file = flowFileFor(flowsDir, outcome.story);
  writeFileSync(join(flowsDir, file), outcome.flow, "utf8");
  const saved = store.save();
  return {
    file: join(loaded.config.flows.dir, file),
    story: outcome.story,
    steps: outcome.steps,
    inputs: outcome.inputs,
    bound: outcome.bound,
    unbound: outcome.unbound,
    // Relative: this crosses the service to a client, and an absolute path
    // says where somebody's machine keeps their work (REQ-NFR-6).
    written: saved.written.map((one) => relative(loaded.root, one)),
  };
}

export async function captureCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  const root = resolve(args.command[1] ?? ".");
  if (!personCanDrive()) {
    say(io, args, diagnostic("cannot-drive"));
    return EXIT.usage;
  }
  const loaded = await loadProject(root);
  const store = loadBindings(loaded);
  const scripted = (process.env["YAM_OBSERVE"] ?? "") !== "";

  const name = stringOption(args, "name") ?? (scripted ? "Recorded" : await askName());

  registerAllAdapters();
  const target = sessionTarget(args, { config: loaded.config.app });
  const config = {
    ...loaded.config,
    app: { ...loaded.config.app, ...target },
    // A person drives a browser they can see; the scripted person does not need one.
    run: { ...loaded.config.run, headless: scripted ? loaded.config.run.headless : false },
  };
  const surface = await createSurface(config);
  if (surface.observe === undefined || surface.capabilities().observe !== true) {
    say(io, args, diagnostic("cannot-observe", config.adapter));
    return EXIT.usage;
  }
  await surface.open({
    ...(config.app.baseUrl === undefined ? {} : { baseUrl: config.app.baseUrl }),
    ...(config.app.storageState === undefined ? {} : { storageState: config.app.storageState }),
  });
  if (config.app.baseUrl !== undefined && surface.kind === "web") {
    await surface.act("navigate", undefined, { url: config.app.baseUrl });
  }

  const controller = new AbortController();
  let stdin: ReturnType<typeof createInterface> | undefined;
  if (!scripted) {
    io.err(
      `recording what you do at ${config.app.baseUrl ?? "the application"}: drive it in the browser that opened.\n` +
        "  Each click and each value you enter becomes a sentence of the flow.\n" +
        "  Press Enter here when you are done, or close the browser.\n",
    );
    stdin = createInterface({ input: process.stdin });
    stdin.once("line", () => controller.abort());
  }

  try {
    const captured = await captureIntoProject({
      loaded,
      store,
      surface,
      config,
      name,
      signal: controller.signal,
      onStep: (text) => io.err(`  ${text}`),
      log: (message) => io.err(`      ${message}`),
    });

    const inputs = Object.keys(captured.inputs);
    io.err(
      `\nwrote ${captured.file}: "${captured.story}", ${captured.steps.length} step${captured.steps.length === 1 ? "" : "s"}; ` +
        `${captured.written.length} binding${captured.written.length === 1 ? "" : "s"} written` +
        (captured.unbound.length === 0 ? "" : `; ${captured.unbound.length} not bound (${captured.unbound.join(", ")}) — yam record --flow ${captured.file}`) +
        "\n\n  yam check     read, lint and compile the flow\n" +
        `  yam run${inputs.length === 0 ? "" : ` ${inputs.map((one) => `--input ${one}=…`).join(" ")}`}    replay it with no model in the loop\n`,
    );
    if (args.options["json"] !== undefined) io.out(JSON.stringify(captured, null, 2));
    return EXIT.ok;
  } finally {
    stdin?.close();
    await surface.close().catch(() => undefined);
  }
}

async function askName(): Promise<string> {
  const fallback = `Recorded ${new Date().toISOString().slice(0, 16).replace("T", " ")}`;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const reply = await new Promise<string>((done) => rl.question(`Story name [${fallback}] `, done));
    return reply.trim() === "" ? fallback : reply.trim();
  } finally {
    rl.close();
  }
}
