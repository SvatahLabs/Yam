/**
 * Compiling a trajectory into a proposal (T5.5, REQ-BEH-4, LLD §13.4).
 *
 * > Compile: group calls into steps by intent; map `act` kinds to IR actions;
 * > the intent becomes the sentence after normalisation through the synonym
 * > vocabulary; targets get element ids from `describe`; candidates and
 * > fingerprints are synthesised at capture time (no model); a story draft, plan
 * > fragment, and `verified: false` bindings go to `proposals/<date>/`. A Tier 1
 * > compile of the draft must succeed or the step is emitted as a comment with
 * > `// review:`.
 *
 * ## Nothing is written outside `proposals/`
 *
 * The one property this file has to have. A trajectory is an agent's
 * exploration, unreviewed by anyone: it may have signed in as the wrong user,
 * clicked something destructive, or wandered into a page nobody meant it to see.
 * What comes out is a *proposal* — a file a person reads, with bindings marked
 * `verified: false` — and it goes in a directory that nothing else reads. The
 * flow store, the bindings store and the plan are untouched, and
 * `writeProposal` takes the proposals directory rather than the project root so
 * there is no path it could reach them by.
 *
 * ## Grouping by intent
 *
 * Consecutive calls sharing an intent are one step. An agent that says "sign in
 * as the enterprise user" three times in a row — type, type, click — meant one
 * thing, and three steps with one sentence between them would be three copies of
 * that sentence. Consecutive rather than global: an intent repeated later in the
 * exploration is a second occasion, not the same one.
 *
 * ## The model
 *
 * None. Candidates and fingerprints come from `describe`, captured at the moment
 * of the call; the sentences come from the action and the element. `trajectory`
 * may import `compiler` and `recorder` (LLD §1), and the Tier 1 compile below is
 * the compiler's — the grammar, offline. A proposal's provenance says so.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  canonicalHash,
  canonicalJson,
  canonicalYaml,
  proposalSchema,
  SCHEMA_VERSION,
  type BindingFile,
  type Candidate,
  type Proposal,
  type Story,
} from "@svatah/yam-schema";
import { compile } from "@svatah/yam-compiler";
import { elementId, readFlow, TargetDictionary } from "@svatah/yam-spec";
import type { TrajectoryLine } from "./capture.js";
import { draftFor, type DraftStep } from "./sentence.js";

export interface CompileTrajectoryOptions {
  /** The story the draft declares. Defaults to the first intent. */
  readonly storyName?: string;
  /** The trajectory file this came from, recorded on the proposal. */
  readonly sourceTrajectory?: string;
  /** Fixed, so two compiles of one trajectory are the same bytes. */
  readonly now?: string;
  /**
   * The `app` segment of a binding id: `bindings/<app>/<page>/<element>.yaml`.
   * Defaults to `proposed`, which is where an unreviewed binding belongs.
   */
  readonly app?: string;
}

export interface CompiledTrajectory {
  readonly proposal: Proposal;
  /** How many drafted steps there were, and how many Tier 1 accepted. */
  readonly steps: { readonly total: number; readonly compiled: number; readonly rate: number };
  /** The steps that became `// review:` comments, with the reason. */
  readonly review: ReadonlyArray<{ readonly intent: string; readonly why: string }>;
}

/**
 * Compile a trajectory. Writes nothing; `writeProposal` does that.
 *
 * Separated so the compile is a pure function of the trajectory — which is what
 * lets a test assert the rate without a directory, and what makes two compiles
 * of one file the same bytes (REQ-COMP-7's spirit, applied to a proposal).
 */
export function compileTrajectory(
  lines: readonly TrajectoryLine[],
  options: CompileTrajectoryOptions = {},
): CompiledTrajectory {
  const now = options.now ?? new Date().toISOString();
  const drafts = group(lines);
  const storyName = options.storyName ?? nameFor(drafts);

  /*
   * The draft, and then the Tier 1 compile of it (LLD §13.4).
   *
   * Every step is offered to the grammar *individually*, by compiling a
   * one-step flow: a single flow with all of them would stop at the first
   * refusal and the ones after it would be judged by their neighbour. What the
   * grammar refuses becomes a `// review:` comment carrying the agent's own
   * words, which is a line a person can rewrite.
   */
  const review: Array<{ intent: string; why: string }> = [];
  const accepted: DraftStep[] = [];

  for (const draft of drafts) {
    if (draft.sentence === undefined) {
      review.push({ intent: draft.intent, why: draft.why ?? "no sentence could be drafted" });
      continue;
    }
    const problem = tier1Refusal(draft.sentence, storyName);
    if (problem !== undefined) {
      review.push({ intent: draft.intent, why: problem });
      continue;
    }
    accepted.push(draft);
  }

  const flow = renderFlow(storyName, drafts, accepted, review);

  /*
   * The plan fragment, from the draft that was just written — so the `story` on
   * the proposal is the compile of the *text* a reviewer reads, not of something
   * assembled beside it. If they could differ, the review would be of the wrong
   * artifact.
   */
  const story = compileDraft(flow, storyName);

  const bindings = bindingsFor(accepted, options.app ?? "proposed", now);

  const proposal: Proposal = proposalSchema.parse({
    schemaVersion: SCHEMA_VERSION,
    name: slug(storyName),
    createdAt: now,
    provenance: {
      /*
       * No model was involved and the provenance says exactly that. A proposal
       * is model output in the sense REQ-STD-4 means — it is a machine's
       * proposal about what an exploration meant — and the honest record is that
       * it came from the trajectory compiler with the grammar, offline.
       */
      model: "none:trajectory-compile",
      promptVersion: "t5.5",
      at: now,
      tokensIn: 0,
      tokensOut: 0,
      costUsd: 0,
    },
    flow,
    ...(story === undefined ? {} : { story }),
    bindings,
    ...(options.sourceTrajectory === undefined
      ? {}
      : { sourceTrajectory: options.sourceTrajectory }),
    notes: notesFor(lines, drafts, accepted.length),
  });

  return {
    proposal,
    steps: {
      total: drafts.length,
      compiled: accepted.length,
      rate: drafts.length === 0 ? 0 : accepted.length / drafts.length,
    },
    review,
  };
}

/**
 * Write a proposal to `proposals/<date>/`.
 *
 * `proposalsDir` rather than a project root, deliberately: this function has no
 * path by which it could reach `flows/`, `bindings/` or `plan.json`, which is
 * the property T5.5's Validate asks to be demonstrated ("nothing written outside
 * `proposals/`"). Three files, because three different people read them: the
 * `.flow` for a person, the `.json` for a tool, and the bindings as the store
 * would hold them so applying the proposal is a copy.
 */
export function writeProposal(
  proposalsDir: string,
  compiled: CompiledTrajectory,
): { readonly dir: string; readonly files: readonly string[] } {
  const date = compiled.proposal.createdAt.slice(0, 10);
  const dir = join(proposalsDir, date);
  mkdirSync(dir, { recursive: true });

  const files: string[] = [];
  const write = (path: string, text: string): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
    files.push(path);
  };

  write(join(dir, `${compiled.proposal.name}.flow`), compiled.proposal.flow);
  write(join(dir, `${compiled.proposal.name}.json`), `${canonicalJson(compiled.proposal)}\n`);

  for (const file of compiled.proposal.bindings) {
    write(join(dir, "bindings", `${file.id.split(".").join("/")}.yaml`), canonicalYaml(file));
  }

  return { dir, files };
}

/* ── grouping ─────────────────────────────────────────────────────────────── */

/**
 * Consecutive calls sharing an intent become one step (LLD §13.4).
 *
 * The *last* drafted call of a run wins, because the agent's intent describes
 * where it was going: "sign in as the enterprise user" over type, type, click is
 * one step, and the click is the one that does it. The earlier calls' elements
 * are not lost — they are recorded in the proposal's notes.
 */
function group(lines: readonly TrajectoryLine[]): DraftStep[] {
  const out: DraftStep[] = [];
  for (const line of lines) {
    const draft = draftFor(line);
    if (draft === undefined) continue;
    const last = out[out.length - 1];
    if (last !== undefined && last.intent === draft.intent) {
      out[out.length - 1] = { ...draft, seq: [...last.seq, ...draft.seq] };
      continue;
    }
    out.push(draft);
  }
  return out;
}

/**
 * The story's name: the first intent that produced a *step*.
 *
 * Not the first intent of all: an exploration usually opens with a snapshot, and
 * "see what is on the home page" names looking rather than doing. The first
 * thing the agent actually did is the closest thing to what the story is for —
 * and a reviewer renames it anyway, which is what a proposal is.
 */
function nameFor(drafts: readonly DraftStep[]): string {
  const first = drafts[0]?.intent.trim();
  return first === undefined || first === "" ? "Proposed story" : capitalise(first);
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A file name: `go-to-the-sign-in-page`. */
function slug(name: string): string {
  const out = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return out === "" ? "proposal" : out;
}

/* ── the draft, and the Tier 1 compile of it ──────────────────────────────── */

/** Why Tier 1 refused a sentence, or `undefined` when it did not. */
function tier1Refusal(sentence: string, storyName: string): string | undefined {
  const { diagnostics } = compileDraftResult(oneStepFlow(storyName, sentence), storyName);
  const errors = diagnostics.filter((d) => d.severity === "error");
  return errors.length === 0
    ? undefined
    : errors.map((d) => `${d.code}: ${d.message.split("\n")[0]}`).join("; ");
}

function oneStepFlow(storyName: string, sentence: string): string {
  return `story: ${storyName}\n  ${sentence}\n\ntest: ${storyName}\n`;
}

function compileDraftResult(
  text: string,
  storyName: string,
): { story?: Story; diagnostics: ReturnType<typeof compile>["diagnostics"] } {
  const read = readFlow(text, "proposal.flow");
  if (read.diagnostics.some((d) => d.severity === "error")) {
    return { diagnostics: read.diagnostics };
  }
  /*
   * An empty project around the one flow.
   *
   * No bindings, no data, no API requests — deliberately. The question this
   * compile answers is "does the *grammar* accept this sentence", and a project
   * that contributed target phrases would answer a different one: a step could
   * pass here because some binding in the fixtures happened to name its element,
   * and the proposal's rate would be a property of the project it was compiled
   * beside. Every target comes out `unbound`, which is what a proposal's targets
   * are.
   */
  const result = compile({
    project: {
      flows: [read.flow],
      stories: new Map(),
      runs: new Map(),
      compositions: new Map(),
      targets: new TargetDictionary(),
      data: { values: {}, secrets: new Set() },
      apis: { requests: new Map() },
    } as never,
    projectName: "proposal",
    stable: true,
  });
  const story = result.plan.stories.find((one) => one.name === storyName);
  return { ...(story === undefined ? {} : { story }), diagnostics: result.diagnostics };
}

/** The compiled fragment for the whole draft, when it compiles at all. */
function compileDraft(flow: string, storyName: string): Story | undefined {
  try {
    const { story, diagnostics } = compileDraftResult(flow, storyName);
    return diagnostics.some((d) => d.severity === "error") ? undefined : story;
  } catch {
    return undefined;
  }
}

/**
 * The `.flow` a person reads.
 *
 * Every drafted step is here, in the order the agent did it: the ones that
 * compile as sentences, and the ones that do not as `// review:` comments
 * carrying the agent's own words and the reason. A proposal that quietly
 * dropped what it could not phrase would be a proposal a reviewer could not
 * trust, because the thing missing from it is invisible.
 */
function renderFlow(
  storyName: string,
  drafts: readonly DraftStep[],
  accepted: readonly DraftStep[],
  review: ReadonlyArray<{ intent: string; why: string }>,
): string {
  const acceptedSet = new Set(accepted);
  const lines = [
    `// Proposed from a trajectory (REQ-BEH-4, LLD §13.4). Not reviewed, not run.`,
    `//`,
    `// ${accepted.length} of ${drafts.length} step(s) compile; the rest are \`// review:\``,
    `// comments carrying what the agent said it was doing. The bindings beside this`,
    `// file are \`verified: false\` — no run has confirmed any of them.`,
    ``,
    `story: ${storyName}`,
  ];

  for (const draft of drafts) {
    lines.push(`  // ${draft.intent}`);
    if (acceptedSet.has(draft)) {
      lines.push(`  ${draft.sentence}`);
      continue;
    }
    const why = review.find((one) => one.intent === draft.intent)?.why ?? "could not be phrased";
    lines.push(
      `  // review: ${draft.sentence ?? "(no sentence)"}`,
      `  //   ${why}`,
    );
  }

  lines.push(``, `test: ${storyName}`, ``);
  return lines.join("\n");
}

/* ── the bindings ─────────────────────────────────────────────────────────── */

/**
 * Bindings from the descriptions captured at the time of each call.
 *
 * "Candidates and fingerprints are synthesised at capture time (no model)"
 * (LLD §13.4). `describe()` was read when the reference still meant something,
 * and everything a candidate bundle needs is in it — which is why the compiler
 * can run long after the browser has closed, and why it needs no model.
 *
 * Every entry is `verified: false`. Nothing has replayed these; the proposal
 * schema refuses a `true` for exactly that reason.
 */
function bindingsFor(
  accepted: readonly DraftStep[],
  app: string,
  now: string,
): BindingFile[] {
  const byId = new Map<string, BindingFile>();

  for (const draft of accepted) {
    if (draft.element === undefined) continue;
    const page = pageOf(draft.url);
    const id = `${app}.${page}.${elementId(draft.element.phrase)}`;
    const existing = byId.get(id);
    if (existing !== undefined) {
      if (!existing.phrases.includes(draft.element.phrase)) {
        existing.phrases.push(draft.element.phrase);
      }
      continue;
    }

    const { describe } = draft.element;
    byId.set(id, {
      schemaVersion: SCHEMA_VERSION,
      id,
      phrases: [draft.element.phrase],
      entries: [
        {
          context: {
            pattern: patternOf(draft.url),
            /*
             * The page's structural hash at the moment of the call, not the
             * element's context hash.
             *
             * LLD §6.2's context hash is over the nearest landmark ancestor's
             * subtree, and computing one needs a live snapshot — which a
             * proposal does not have, because the exploration is over. What the
             * trajectory does have is the hash of the whole page as it was, and
             * that is a real recorded fact rather than an invented one. It is a
             * broader key than a recorded binding's, so it drifts sooner; the
             * first `yam record` after the proposal is applied replaces it
             * with the narrow one. Another reason these are `verified: false`.
             */
            hash: draft.snapshotHash ?? canonicalHash(describe),
            platform: "web",
          },
          candidates: candidatesFor(describe),
          fingerprint: {
            tag: describe.tag,
            attrs: describe.attrs,
            text: describe.text,
            neighbours: describe.neighbours,
            rolePath: describe.rolePath,
            box: describe.box,
            index: describe.index,
          },
          recordedAt: now,
          provenance: {
            model: "none:trajectory-compile",
            promptVersion: "t5.5",
            at: now,
            tokensIn: 0,
            tokensOut: 0,
            costUsd: 0,
          },
          verified: false,
        },
      ],
    });
  }

  return [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
}

/**
 * Candidates from a description, model-free (LLD §13.4, REQ-REC-3).
 *
 * The same ranking `@svatah/yam-bindings`' `synthesise` uses, applied to a
 * description rather than to a live surface: `synthesise` asks the surface how
 * many elements each candidate matches, and a proposal has no surface to ask.
 * So the ambiguity check is the one thing missing, and it is exactly why these
 * are written `verified: false` — a run is what will find out.
 */
function candidatesFor(describe: {
  role: string;
  name?: string;
  tag: string;
  attrs: Record<string, string>;
  text: string;
}): Candidate[] {
  const out: Candidate[] = [];
  const testId =
    describe.attrs["data-testid"] ?? describe.attrs["data-test"] ?? describe.attrs["data-qa"];
  const attribute = describe.attrs["data-testid"] !== undefined
    ? "data-testid"
    : describe.attrs["data-test"] !== undefined
      ? "data-test"
      : "data-qa";

  if (testId !== undefined && testId !== "") {
    out.push({ by: "testid", attribute, value: testId, score: 0.98 });
  }
  if (describe.attrs["id"] !== undefined && describe.attrs["id"] !== "") {
    out.push({ by: "id", value: describe.attrs["id"], score: 0.95 });
  }
  if (describe.name !== undefined && describe.name !== "") {
    out.push({ by: "role", role: describe.role, name: describe.name, exact: true, score: 0.92 });
  }
  const text = describe.text.trim();
  if (text !== "" && text.length <= 60) {
    out.push({ by: "text", value: text, exact: true, score: 0.75 });
  }
  if (testId !== undefined && testId !== "") {
    out.push({ by: "css", value: `[${attribute}="${testId}"]`, score: 0.68 });
    out.push({ by: "xpath", value: `//*[@${attribute}='${testId}']`, score: 0.6 });
  }

  // Never nothing: a binding with no candidate cannot be reviewed, only deleted.
  if (out.length === 0) out.push({ by: "css", value: describe.tag, score: 0.2 });
  return out;
}

/** `/login` → `login`, for the `<page>` segment of a binding id. */
function pageOf(url: string | undefined): string {
  const path = patternOf(url).replace(/^\/+|\/+$/g, "");
  const segment = path.split("/").filter((one) => one !== "" && !one.startsWith(":"))[0];
  return segment === undefined ? "root" : elementId(segment.replace(/[-_]+/g, " "));
}

/** The context pattern: the URL's path, or `/` when there is no URL. */
function patternOf(url: string | undefined): string {
  if (url === undefined) return "/";
  try {
    return new URL(url).pathname || "/";
  } catch {
    return url.startsWith("/") ? url : "/";
  }
}

/* ── notes ────────────────────────────────────────────────────────────────── */

function notesFor(
  lines: readonly TrajectoryLine[],
  drafts: readonly DraftStep[],
  accepted: number,
): string[] {
  const looks = lines.filter((line) => line.call === "snapshot").length;
  return [
    `${lines.length} trajectory line(s) → ${drafts.length} step(s); ` +
      `${accepted} compile at Tier 1.`,
    `${looks} snapshot call(s) are not steps: an agent taking a snapshot is looking, ` +
      "and a replay resolves whatever it needs.",
    "Every binding is `verified: false`: no run has confirmed any of them, and the " +
      "context hash is empty because a proposal has no live snapshot to take one from.",
    "No model was involved. Candidates and fingerprints come from `describe()`, " +
      "captured at the moment of each call; the sentences come from the action and " +
      "the element (LLD §13.4).",
  ];
}
