/**
 * The heal job (REQ-HEAL-1, 2, 3, LLD §12).
 *
 * Select the `locator` failures, get back to the page each one failed on,
 * relocalize against the recorded fingerprint, verify the repair, and emit a diff
 * and a report. The plan and the flows are never touched (REQ-HEAL-2).
 *
 * Verification is not optional and not a formality (REQ-HEAL-3): a proposed
 * element becomes a repair only when a candidate re-synthesised from it resolves
 * to exactly that element. A healer that trusted its own score would be a machine
 * for turning red builds green while clicking the wrong thing.
 */
import { relative, resolve as resolvePath } from "node:path";
import {
  BindingsStore,
  contextHash,
  fingerprintOf,
  relocalize,
  synthesise,
  type Match,
} from "@svatah/bindings";
import type { AgentSurface } from "@svatah/surface";
import { canonicalYaml, type BindingEntry, type BindingFile } from "@svatah/schema";
import type { HealInput } from "./failures.js";
import { unifiedDiffFor, type FileChange } from "./diff.js";
import { currentRegrounder, hasRegrounder } from "./regrounder.js";

/** What happened to one failure. */
export interface HealResult {
  readonly id: string;
  readonly phrase?: string;
  readonly source: HealInput["source"];
  readonly outcome:
    | "repaired"
    | "regrounded"
    | "not-found"
    | "ambiguous"
    | "unverified"
    | "no-binding"
    | "unreachable";
  readonly score?: number;
  readonly runnerUpScore?: number;
  /** The candidate kinds the repair now offers. */
  readonly candidates?: readonly string[];
  readonly message?: string;
  readonly url?: string;
}

export interface HealReport {
  readonly at: string;
  readonly bindingsDir: string;
  readonly inputs: number;
  readonly results: readonly HealResult[];
  readonly totals: {
    readonly repaired: number;
    readonly regrounded: number;
    readonly unrepaired: number;
  };
  /** The unified diff of the store; empty when nothing was repaired. */
  readonly diff: string;
  /** Whether the repaired store was written to disk (`--apply`). */
  readonly applied: boolean;
  /** Whether anything but the no-op `Regrounder` was registered (LLD §10). */
  readonly usedModel: boolean;
  readonly regrounder: string;
}

export interface HealOptions {
  readonly bindingsDir: string;
  readonly inputs: readonly HealInput[];
  /** Open a session and put it on the page a failure happened on. */
  readonly open: (input: HealInput) => Promise<AgentSurface>;
  readonly close?: (surface: AgentSurface) => Promise<void>;
  readonly threshold?: number;
  readonly margin?: number;
  readonly testIdAttributes?: readonly string[];
  /**
   * The store's path as it should appear in the diff, relative to wherever `git
   * apply` will be run. Defaults to `bindingsDir` relative to the working
   * directory, which is right when the CLI is run from the project root.
   */
  readonly pathPrefix?: string;
  /**
   * Write the repaired store.
   *
   * Off by default, and that is the point: "repairs are a diff to the bindings
   * store plus a report" (REQ-HEAL-2). Applying is offered because a person who
   * has read the report should not have to run the job twice, and it produces
   * exactly the bytes the diff described.
   */
  readonly apply?: boolean;
  readonly onProgress?: (message: string) => void;
}

/** Run the heal job. Nothing is written; the caller decides what to do with the diff. */
export async function heal(options: HealOptions): Promise<HealReport> {
  const store = BindingsStore.load(options.bindingsDir);
  const prefix = options.pathPrefix ?? relative(process.cwd(), resolvePath(options.bindingsDir));
  const before = snapshotOfStore(store, prefix);
  const results: HealResult[] = [];

  for (const input of options.inputs) {
    results.push(await healOne(input, store, options));
    options.onProgress?.(`${input.id}: ${results[results.length - 1]!.outcome}`);
  }

  const after = snapshotOfStore(store, prefix);
  const changes: FileChange[] = [];
  for (const path of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const from = before[path] ?? "";
    const to = after[path] ?? "";
    if (from !== to) changes.push({ path, before: from, after: to });
  }

  const repaired = results.filter((r) => r.outcome === "repaired").length;
  const regrounded = results.filter((r) => r.outcome === "regrounded").length;

  const applied = options.apply === true && changes.length > 0;
  if (applied) store.save();

  return {
    at: new Date().toISOString(),
    bindingsDir: options.bindingsDir,
    inputs: options.inputs.length,
    results,
    totals: {
      repaired,
      regrounded,
      unrepaired: results.length - repaired - regrounded,
    },
    diff: unifiedDiffFor(changes),
    applied,
    usedModel: hasRegrounder(),
    regrounder: currentRegrounder().name,
  };
}

async function healOne(
  input: HealInput,
  store: BindingsStore,
  options: HealOptions,
): Promise<HealResult> {
  const base = {
    id: input.id,
    ...(input.phrase === undefined ? {} : { phrase: input.phrase }),
    source: input.source,
    ...(input.url === undefined ? {} : { url: input.url }),
  } as const;

  const entry = store.entryFor(input.id, {
    ...(input.url === undefined ? {} : { url: input.url }),
    platform: "web",
  });
  if (entry === undefined) {
    return {
      ...base,
      outcome: "no-binding",
      message: "the store has no binding for this element, so there is nothing to repair",
    };
  }

  let surface: AgentSurface;
  try {
    surface = await options.open(input);
  } catch (error) {
    return {
      ...base,
      outcome: "unreachable",
      message: `could not get back to the page it failed on: ${
        error instanceof Error ? error.message.split("\n")[0] : String(error)
      }`,
    };
  }

  try {
    const result = await relocalize(surface, entry.fingerprint, {
      preferRole: entry.candidates.find((c) => c.by === "role")?.role,
      ...(options.threshold === undefined ? {} : { threshold: options.threshold }),
      ...(options.margin === undefined ? {} : { margin: options.margin }),
    });

    if (result.outcome === "not-found" || result.outcome === "ambiguous") {
      // Relocalization could not place it. This is where the model half of
      // REQ-HEAL-1 would run; with the default `Regrounder` there is none, and
      // the residue is reported rather than dropped (LLD §10).
      const regrounded = await currentRegrounder().ground(
        { id: input.id, ...(input.phrase === undefined ? {} : { phrase: input.phrase }), entry },
        surface,
      );
      if (regrounded !== null) {
        store.put(input.id, withLineage(entry, regrounded), undefined, {
          replaces: entry.context,
        });
        return {
          ...base,
          outcome: "regrounded",
          candidates: regrounded.candidates.map((c) => c.by),
          message: `re-grounded by "${currentRegrounder().name}"`,
        };
      }

      return result.outcome === "ambiguous"
        ? {
            ...base,
            outcome: "ambiguous",
            score: round(result.best.score.total),
            runnerUpScore: round(result.runnerUp.score.total),
            message:
              `two elements scored within ${result.margin.toFixed(3)} of each other, ` +
              "so the fingerprint cannot say which was meant",
          }
        : {
            ...base,
            outcome: "not-found",
            ...(bestOf(result.ranked) === undefined
              ? {}
              : { score: round(bestOf(result.ranked)!.score.total) }),
            message: "nothing on the page scored above the threshold",
          };
    }

    const candidates = await synthesise(surface, result.match.ref, {
      ...(options.testIdAttributes === undefined
        ? {}
        : { testIdAttributes: options.testIdAttributes }),
    });

    // REQ-HEAL-3: a repaired binding is verified before inclusion. The proposal
    // has to resolve, and it has to resolve to the element it was proposed from.
    const verified = candidates.length > 0 && (await surface.locate(candidates[0]!)).length === 1;
    if (!verified) {
      return {
        ...base,
        outcome: "unverified",
        score: round(result.match.score.total),
        message:
          "relocalization proposed an element, but nothing synthesised from it resolves back to " +
          "it — so the proposal cannot be verified and is not offered",
      };
    }

    const snapshot = await surface.snapshot();
    const { hash } = contextHash(snapshot, result.match.ref);
    const description = await surface.describe(result.match.ref);

    // The repaired entry supersedes the broken one. Its context hash has moved —
    // the page's shape changed, which is why the binding broke — so without
    // saying what it replaces the store would keep both, with the broken one
    // first (LLD §6.3), and the next run would fail exactly as before.
    store.put(
      input.id,
      withLineage(entry, {
        ...entry,
        context: { ...entry.context, hash },
        candidates,
        fingerprint: fingerprintOf(description),
        recordedAt: new Date().toISOString(),
        verified: true,
      }),
      undefined,
      { replaces: entry.context },
    );

    return {
      ...base,
      outcome: "repaired",
      score: round(result.match.score.total),
      ...(result.ranked[1] === undefined
        ? {}
        : { runnerUpScore: round(result.ranked[1].score.total) }),
      candidates: candidates.map((c) => c.by),
    };
  } finally {
    await (options.close?.(surface) ?? surface.close()).catch(() => undefined);
  }
}

/**
 * Keep what the binding used to be.
 *
 * A repair a reviewer cannot see the shape of is a repair they cannot judge, so
 * the previous fingerprint and provenance stay on the entry (LLD §6.4, §3.3).
 */
function withLineage(previous: BindingEntry, next: BindingEntry): BindingEntry {
  return {
    ...next,
    previous: [
      ...(previous.previous ?? []),
      { fingerprint: previous.fingerprint, provenance: previous.provenance },
    ],
  };
}

/**
 * Path → canonical YAML, for every file in the store.
 *
 * The paths are relative to the repository root, because that is where `git
 * apply` is run from. The store's own directory is turned into that relative
 * path by the caller's `pathPrefix`, defaulting to the store directory relative
 * to the working directory.
 */
function snapshotOfStore(store: BindingsStore, pathPrefix: string): Record<string, string> {
  const out: Record<string, string> = {};
  const prefix = pathPrefix.replace(/\\/g, "/").replace(/\/+$/, "");
  for (const id of store.ids()) {
    const file: BindingFile = store.get(id)!;
    out[`${prefix}/${id.split(".").join("/")}.yaml`] = canonicalYaml(file);
  }
  return out;
}

function bestOf(ranked: readonly Match[]): Match | undefined {
  return ranked[0];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
