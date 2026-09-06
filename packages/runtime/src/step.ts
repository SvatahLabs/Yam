/**
 * Running one step (REQ-RUN-1, 5, 7, REQ-AUTO-1, LLD §8.2).
 *
 * ```
 * runStep(step):
 *   args = scope.resolve(step.args)
 *   if step.guard: … → "skipped" with reason "guard"; return   // never acts
 *   target = resolver.resolve(...)
 *   switch step.action: read | expect | api | custom | invoke | default → surface.act
 * ```
 *
 * Two things are load-bearing and easy to get subtly wrong:
 *
 * **A failed guard must not act.** REQ-AUTO-1: "the executor evaluates it before
 * acting and never performs the action if it fails." So the guard is evaluated
 * before the target is even resolved — resolving is harmless, but the order is
 * the thing a reader checks, and an evaluation that came after a resolution
 * would be one refactor away from coming after an action.
 *
 * **No model call, ever.** REQ-RUN-1. Nothing here can reach one: `runtime`
 * cannot import `gateway` (LLD §1) and the lint says so.
 */
import type {
  Candidate,
  Predicate,
  Ref,
  Step,
  StepResult,
  TargetRef,
} from "@svatah/schema";
import type { AgentSurface, SnapshotNode } from "@svatah/surface";
import { CheckError } from "@svatah/surface";
import { GuardError, candidatesTried, classify, messageOf, stackOf } from "./failure.js";
import { DataError, type Scope } from "./scope.js";

/** Resolves a target to a live reference. Supplied by the runner (LLD §6.3). */
export type Resolver = (
  target: TargetRef,
  surface: AgentSurface,
) => Promise<{ ref: Ref; candidateIndex: number; by: Candidate["by"] }>;

/**
 * Runs a Tier 0 custom step.
 *
 * Injected rather than imported: LLD §1 draws `runtime ─► bindings, surface,
 * schema` and nothing else. The CLI, which has both, wires `@svatah/steps` in.
 * That also means a foreign runtime can execute a plan without custom steps at
 * all and say so, rather than failing to start.
 */
export type CustomStepRunner = (
  step: Step,
  context: {
    surface: AgentSurface;
    scope: Scope;
    resolve: Resolver;
    timeoutMs: number;
    signal: AbortSignal;
  },
) => Promise<void>;

/** Runs an `api` step. Injected for the same reason. */
export type ApiRunner = (
  step: Step,
  context: { scope: Scope; args: Record<string, unknown> },
) => Promise<unknown>;

/** Runs another story as a function (`invoke`, REQ-AUTO-5). */
export type StoryRunner = (
  story: string,
  inputs: Record<string, unknown>,
) => Promise<{ outputs: Record<string, unknown>; ok: boolean }>;

export interface StepContext {
  readonly surface: AgentSurface;
  readonly scope: Scope;
  readonly resolve: Resolver;
  readonly custom?: CustomStepRunner;
  readonly api?: ApiRunner;
  readonly invoke?: StoryRunner;
  readonly stepTimeoutMs: number;
  readonly signal?: AbortSignal;
  /** `config.run.screenshots`. */
  readonly screenshots?: "onFailure" | "always" | "never";
  /** Where a screenshot goes. Returns the path recorded in the result. */
  readonly screenshotPath?: (step: Step) => string;
  /**
   * Which element the resolver is about to look for, and when it is done
   * (REQ-AUTO-6, P9-F5).
   *
   * The audit is written by a proxy over the surface (`audit.ts`), and the
   * surface's `locate(candidate)` is never told which element the candidate
   * belongs to — so every locate line read `locate · ok` and a reader could not
   * tell which of a step's five candidates had matched nothing. This is how the
   * executor lends the auditor the one fact it has and the surface does not.
   */
  readonly resolving?: (elementId: string | undefined) => void;
}

/**
 * `context.resolve`, with the element named for the audit (P9-F5).
 *
 * Every resolution in this file goes through here, so a call site added later
 * is audited by existing — the same argument the audit proxy itself is built on.
 */
async function resolveTarget(
  context: StepContext,
  target: TargetRef,
  surface: AgentSurface,
): Promise<{ ref: Ref; candidateIndex: number; by: Candidate["by"] }> {
  context.resolving?.(target.ref);
  try {
    return await context.resolve(target, surface);
  } finally {
    context.resolving?.(undefined);
  }
}

export interface StepOutcome {
  readonly status: StepResult["status"];
  readonly matched?: StepResult["matched"];
  readonly captured?: Record<string, unknown>;
  readonly failure?: StepResult["failure"];
  /** Set when the step was skipped by its guard rather than by a policy. */
  readonly guardSkipped?: boolean;
}

export async function runStep(step: Step, context: StepContext): Promise<StepOutcome> {
  const { scope, surface } = context;

  let args: Record<string, unknown>;
  try {
    args = scope.resolveArgs(step.args);
  } catch (error) {
    return await failed(step, error, context);
  }

  /* The guard, before anything else touches the application (REQ-AUTO-1). */
  if (step.guard !== undefined) {
    let holds: boolean;
    try {
      holds = await evaluate(step.guard.subject, step.guard.predicate, step, context, {
        /*
         * The guard's own element, when it has one (LLD §3.2, Draft 2.7).
         *
         * "Only if the login error is hidden, click the sign in button" asks
         * about the login error and acts on the sign in button, so the guard
         * is resolved against its own target and the step's is not touched
         * until the guard has said to go ahead — which is what REQ-AUTO-1's
         * "never performs the action if it fails" means when the two elements
         * are different.
         */
        ...(step.guard.target === undefined ? {} : { target: step.guard.target }),
      });
    } catch (error) {
      // The guard itself broke — an unresolved reference, a surface error. That
      // is `guard`, and it is a failure rather than a skip: a guard that cannot
      // be evaluated has not said the step is unnecessary (LLD §8.3).
      return await failed(
        step,
        new GuardError(`The guard could not be evaluated: ${messageOf(error)}`, error),
        context,
      );
    }

    const shouldRun = step.guard.mode === "onlyIf" ? holds : !holds;
    if (!shouldRun) {
      // A clean guard skip carries no failure (LLD §8.3).
      return { status: "skipped", guardSkipped: true };
    }
  }

  let matched: StepResult["matched"] | undefined;
  try {
    if (step.target !== undefined) {
      matched = await resolveTarget(context, step.target, surface);
    }
    const target2 =
      step.target2 === undefined ? undefined : await resolveTarget(context, step.target2, surface);

    const captured = await perform(step, args, matched?.ref, target2?.ref, context);

    if (context.screenshots === "always") await screenshot(step, context);

    return {
      status: "passed",
      ...(matched === undefined ? {} : { matched }),
      ...(captured === undefined ? {} : { captured }),
    };
  } catch (error) {
    if (context.screenshots !== "never") await screenshot(step, context);
    return {
      ...(await failed(step, error, context)),
      ...(matched === undefined ? {} : { matched }),
    };
  }
}

/* ── the action ───────────────────────────────────────────────────────────── */

async function perform(
  step: Step,
  args: Record<string, unknown>,
  ref: Ref | undefined,
  ref2: Ref | undefined,
  context: StepContext,
): Promise<Record<string, unknown> | undefined> {
  const { surface, scope } = context;

  switch (step.action) {
    case "read": {
      const kind = step.capture?.from ?? "text";
      const value = await surface.read(
        kind === "response" || kind === "output" ? "result" : kind,
        ref,
        step.capture?.attribute,
      );
      return capture(step, value, scope);
    }

    case "expect": {
      if (step.expect === undefined) {
        throw new DataError(`"${step.text}" is an expectation with no predicate.`);
      }
      const ok = await evaluate(step.expect.subject, step.expect.predicate, step, context);
      if (!ok) {
        throw new CheckError(
          `Expected ${describePredicate(step.expect.predicate)}${
            step.target === undefined ? "" : ` of "${step.target.phrase}"`
          }, and it was not so.`,
        );
      }
      return undefined;
    }

    case "api": {
      if (context.api === undefined) {
        throw new DataError(
          "This step calls an API and no HTTP adapter is wired in. " +
            "`svatah run` registers one; a foreign runtime has to supply its own.",
        );
      }
      const value = await context.api(step, { scope, args });
      return capture(step, value, scope);
    }

    case "custom": {
      if (context.custom === undefined) {
        throw new DataError(
          `This step is the custom step ${step.custom?.id ?? "?"}, and no runner for custom steps ` +
            "is wired in. `svatah run` loads `steps/`; a foreign runtime cannot execute Tier 0.",
        );
      }
      await context.custom(step, {
        surface,
        scope,
        resolve: context.resolve,
        timeoutMs: step.timeoutMs,
        signal: context.signal ?? AbortSignal.timeout(step.timeoutMs),
      });
      return undefined;
    }

    case "invoke": {
      if (context.invoke === undefined || step.invoke === undefined) {
        throw new DataError("This step invokes another story and no runner was supplied.");
      }
      const inputs: Record<string, unknown> = {};
      for (const [name, value] of Object.entries(step.invoke.inputs)) {
        inputs[name] = scope.read(value);
      }
      const result = await context.invoke(step.invoke.story, inputs);
      if (!result.ok) {
        throw new DataError(`"${step.invoke.story}" failed, so this step could not complete.`);
      }
      return capture(step, result.outputs, scope);
    }

    /*
     * `Wait for the "<name>" API to answer <path> <predicate>` (pattern 19
     * extended, T12.7, LLD §13.9 Draft 2.15).
     *
     * Every other `waitFor` is the adapter's: it is waiting for an element on
     * the screen in front of it. This one is not — it polls a service until it
     * answers something, which is what four of the parity gate's one-sided
     * checks needed: the ADE's Run button starts a *second* Svatah run, and a
     * flow could not wait for it or read its result.
     *
     * The poll is the step's own timeout, half a second apart. A request that
     * throws is not a failure yet — a service that has not finished starting
     * answers with a connection refused, and giving up on the first one would
     * make this a race rather than a wait.
     */
    case "waitFor": {
      if (step.expect?.subject !== "api") {
        await surface.act(step.action as never, ref, args as never, ref2);
        return undefined;
      }
      if (context.api === undefined) {
        throw new DataError(
          "This step waits on an API and no HTTP adapter is wired in. " +
            "`svatah run` registers one; a foreign runtime has to supply its own.",
        );
      }
      const deadline = Date.now() + step.timeoutMs;
      const wanted = resolvePredicateValue(step.expect.predicate, scope);
      let last: unknown;
      let why = "";
      for (;;) {
        try {
          last = await context.api(step, { scope, args });
          if (matchesValue(wanted, last)) return undefined;
          why = `it answered ${JSON.stringify(last) ?? "nothing"}`;
        } catch (error) {
          why = `the request failed: ${messageOf(error)}`;
        }
        if (Date.now() >= deadline) {
          throw new CheckError(
            `Waited ${step.timeoutMs} ms for the API to answer ` +
              `${describePredicate(wanted)} and ${why}.`,
          );
        }
        await new Promise((done) => setTimeout(done, 500));
      }
    }

    case "screenshot": {
      const path = context.screenshotPath?.(step);
      if (path !== undefined) await surface.screenshot(path, ref === undefined ? [] : [ref]);
      return undefined;
    }

    case "evaluate": {
      const value = await surface.act("evaluate", ref, args as never);
      return capture(step, (value as { value?: unknown }).value ?? value, scope);
    }

    default: {
      await surface.act(step.action as never, ref, args as never, ref2);
      return undefined;
    }
  }
}

function capture(
  step: Step,
  value: unknown,
  scope: Scope,
): Record<string, unknown> | undefined {
  if (step.capture === undefined) return undefined;
  scope.capture(step.capture.name, value);
  return { [step.capture.name]: value };
}

/* ── predicates ───────────────────────────────────────────────────────────── */

/**
 * Evaluate a predicate for a guard or an expectation.
 *
 * `scope` predicates never touch the surface: `{count} is greater than 3` is a
 * question about the run, and asking the application would be both slower and
 * wrong.
 */
async function evaluate(
  subject: NonNullable<Step["expect"]>["subject"],
  predicate: Predicate,
  step: Step,
  context: StepContext,
  /** A guard's own target, which is not the step's (Draft 2.7). */
  about: { target?: TargetRef } = {},
): Promise<boolean> {
  if (subject === "scope") return evaluateExpression(predicate, context.scope);
  if (subject === "set") return await evaluateSet(predicate, step, context);
  if (subject === "api") {
    // `waitFor` polls the API itself, above; nothing else asks about one.
    throw new DataError(
      `"${step.text}" asks about an API answer outside a \`Wait for … to answer\` step.`,
    );
  }

  const element = about.target ?? step.target;
  const ref =
    subject === "target" && element !== undefined
      ? (await resolveTarget(context, element, context.surface)).ref
      : undefined;

  const resolved = resolvePredicateValue(predicate, context.scope);
  const result = await context.surface.check(
    resolved,
    subject === "target" ? "ref" : subject,
    ref,
  );
  return result.ok;
}

/* ── pattern 32: an assertion over a set (T12.7, LLD §13.9 Draft 2.15) ────── */

/**
 * Which snapshot roles each noun of pattern 32 is made of.
 *
 * A closed map, and the grammar's noun list is its keys, so a sentence cannot
 * name a set the executor would silently find nothing in. `text` and `element`
 * are the two that are not a role list: `text` is every node that puts words on
 * the screen, which is what "No text on this screen should contain a secret"
 * means, and `element` is the whole tree.
 */
const SET_ROLES: Readonly<Record<string, readonly string[]>> = {
  control: [
    "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox",
    "listbox", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "switch",
    "slider", "spinbutton", "option",
  ],
  button: ["button"],
  link: ["link"],
  field: ["textbox", "searchbox", "combobox", "spinbutton", "slider"],
  row: ["row"],
  cell: ["cell", "gridcell", "columnheader", "rowheader"],
  heading: ["heading"],
  item: ["listitem", "menuitem", "option", "treeitem"],
  tab: ["tab"],
  checkbox: ["checkbox", "switch", "menuitemcheckbox"],
  text: [],
  element: [],
};

/** Is this node a member of the set the sentence named? */
function inSet(node: SnapshotNode, of: string): boolean {
  if (of === "element") return true;
  if (of === "text") return textOf(node) !== "";
  return (SET_ROLES[of] ?? []).includes(node.role);
}

/** The words a node puts on the screen: its name, and the value it shows. */
function textOf(node: SnapshotNode): string {
  return [node.name ?? "", node.value ?? ""].join(" ").trim();
}

/**
 * How a node describes itself for an `attribute` predicate on a set.
 *
 * `id` and `name` are the two the sentences need — "every button has an id",
 * "every control has a name" — and neither is an HTML attribute here: they are
 * the snapshot's own fields, which is the *only* thing that makes this question
 * askable of a UIA tree and an AX tree and a DOM alike (LLD §2.2). Anything
 * else falls through to the adapter's `native` extras, where a `data-testid` or
 * an `AXIdentifier` lives.
 */
function attributeOf(node: SnapshotNode, name: string): string | undefined {
  if (name === "name") return node.name;
  if (name === "role") return node.role;
  if (name === "value") return node.value;
  if (name === "id") return node.native?.["automationId"] ?? node.native?.["id"];
  return node.native?.[name];
}

/**
 * Evaluate one predicate against one snapshot node, with no surface call.
 *
 * A set of two hundred controls asked through `surface.check` is two hundred
 * round trips to an accessibility API that costs milliseconds a node (LLD
 * §7.5); the snapshot the question is about already carries every fact these
 * predicates need. That is why the noun list is closed and the predicate list
 * is: a predicate that needs the live element — `css`, geometry against a
 * viewport — is refused here rather than answered approximately.
 */
function holdsForNode(predicate: Predicate, node: SnapshotNode): boolean {
  const one = predicate as {
    kind: string;
    negate?: boolean;
    name?: string;
    numbers?: number[];
    value?: { value?: unknown };
  };
  const wanted = String(one.value?.value ?? "");
  const box = node.box;
  let held: boolean;

  switch (one.kind) {
    case "visible":
      held = !node.states.includes("hidden");
      break;
    case "hidden":
      held = node.states.includes("hidden");
      break;
    case "enabled":
      held = !node.states.includes("disabled");
      break;
    case "disabled":
      held = node.states.includes("disabled");
      break;
    case "checked":
      held = node.states.includes("checked");
      break;
    case "unchecked":
      held = node.states.includes("unchecked") || !node.states.includes("checked");
      break;
    case "selected":
      held = node.states.includes("selected");
      break;
    case "present":
      held = true;
      break;
    case "absent":
      held = false;
      break;
    case "text":
      held = textOf(node) === wanted;
      break;
    case "textContains":
      held = textOf(node).includes(wanted);
      break;
    case "value":
      held = (node.value ?? "") === wanted;
      break;
    case "tag":
      held = node.role === wanted;
      break;
    case "attribute":
      held = (attributeOf(node, one.name ?? "") ?? "") === wanted;
      break;
    case "size":
      held = box !== undefined && box[2] === one.numbers?.[0] && box[3] === one.numbers?.[1];
      break;
    case "location":
      held = box !== undefined && box[0] === one.numbers?.[0] && box[1] === one.numbers?.[1];
      break;
    default:
      throw new DataError(
        `"${one.kind}" is not a question that can be asked of every member of a set. ` +
          "A set is read from one snapshot, and this predicate needs the live element.",
      );
  }
  return one.negate === true ? !held : held;
}

/** How a member is named in a failure, so a reader can find it on the screen. */
function describeNode(node: SnapshotNode): string {
  const name = node.name ?? "";
  return `${node.role}${name === "" ? "" : ` "${name.slice(0, 40)}"`} (${node.ref})`;
}

/**
 * `Every <noun> … should <predicate>` and its `No` mirror (pattern 32).
 *
 * The scope is the step's own target — `Every row of the headers table` — or the
 * whole window when the sentence said `on this screen`.
 *
 * **An empty set fails, whichever quantifier it is.** "Every button has an id"
 * over a screen with no buttons is vacuously true and means nothing; so is "no
 * control shows a secret" over a screen that has not loaded. A green step that
 * asked about nothing is the one outcome this pattern must not have, because it
 * is indistinguishable from a working one until somebody reads the tree.
 */
async function evaluateSet(
  predicate: Predicate,
  step: Step,
  context: StepContext,
): Promise<boolean> {
  const spec = step.expect?.set;
  if (spec === undefined) {
    throw new DataError(`"${step.text}" is a set assertion with no quantifier.`);
  }
  const root =
    step.target === undefined
      ? undefined
      : (await resolveTarget(context, step.target, context.surface)).ref;
  const snapshot = await context.surface.snapshot(root === undefined ? {} : { root });

  const members = snapshot.nodes.filter((node) => inSet(node, spec.of));
  const where = step.target === undefined ? "on this screen" : `in "${step.target.phrase}"`;
  if (members.length === 0) {
    throw new CheckError(
      `No ${spec.of} was found ${where}, and an assertion about every member of an ` +
        "empty set is not one anybody asked. The snapshot had " +
        `${snapshot.nodes.length} node(s).`,
    );
  }

  const wanted = resolvePredicateValue(predicate, context.scope);
  const offenders = members.filter((node) =>
    spec.quantifier === "every" ? !holdsForNode(wanted, node) : holdsForNode(wanted, node),
  );
  if (offenders.length === 0) return true;

  throw new CheckError(
    `${offenders.length} of ${members.length} ${spec.of}(s) ${where} ` +
      `${spec.quantifier === "every" ? "did not" : "did"} ${describePredicate(wanted)}: ` +
      offenders.slice(0, 5).map(describeNode).join(", ") +
      (offenders.length > 5 ? `, and ${offenders.length - 5} more` : ""),
  );
}

/**
 * Does a service's answer satisfy the predicate (pattern 19 extended)?
 *
 * The answer is JSON and the predicate's vocabulary is text, so both sides are
 * compared as the strings a person would read: `42` answers `to be "42"`, and a
 * `null` answers nothing.
 */
function matchesValue(predicate: Predicate, value: unknown): boolean {
  const one = predicate as { kind: string; negate?: boolean; value?: { value?: unknown } };
  const wanted = String(one.value?.value ?? "");
  const said = value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value);
  const held =
    one.kind === "textContains" ? said.includes(wanted) : said === wanted;
  return one.negate === true ? !held : held;
}

/** A predicate's `value` with the scope applied, so `{enterprise}` compares. */
function resolvePredicateValue(predicate: Predicate, scope: Scope): Predicate {
  const value = (predicate as { value?: unknown }).value;
  if (value === undefined || typeof value !== "object" || value === null) return predicate;
  const literal = String(scope.read(value as never) ?? "");
  return { ...predicate, value: { kind: "literal", value: literal } } as Predicate;
}

/** `{name} is "x"`, `is not empty`, `is greater than 3`, `matches "re"` (pattern 29). */
function evaluateExpression(predicate: Predicate, scope: Scope): boolean {
  const expression = predicate as unknown as {
    kind: string;
    left: never;
    op: string;
    right: never;
  };
  if (expression.kind !== "expr") {
    throw new GuardError(`A scope guard cannot evaluate "${expression.kind}".`);
  }

  const left = scope.read(expression.left);
  const right = scope.read(expression.right);

  switch (expression.op) {
    case "eq":
      return String(left ?? "") === String(right ?? "");
    case "ne":
      return String(left ?? "") !== String(right ?? "");
    case "gt":
      return Number(left) > Number(right);
    case "lt":
      return Number(left) < Number(right);
    case "matches":
      return new RegExp(String(right)).test(String(left ?? ""));
    default:
      throw new GuardError(`Unknown comparison "${expression.op}".`);
  }
}

function describePredicate(predicate: Predicate): string {
  const kind = (predicate as { kind: string }).kind;
  const value = (predicate as { value?: { value?: unknown } }).value?.value;
  const negated = (predicate as { negate?: boolean }).negate === true ? "not " : "";
  return value === undefined ? `${negated}${kind}` : `${negated}${kind} ${JSON.stringify(value)}`;
}

/* ── failure ──────────────────────────────────────────────────────────────── */

/**
 * Build the failure record, including the session state (Draft 2.4, LLD §3.4).
 *
 * `failure.session` is what lets a healer get back to the page without a plan:
 * module (a)'s session-state `Replayer` reads it out of `results.jsonl` and
 * restores it (LLD §10). Without it, every flow failure was `unreachable` to
 * `svatah-bindings heal --run`, which is the defect F1 names.
 *
 * Reading the state is best effort. A session that has already crashed cannot
 * answer, and a failure record that says less is far better than a failure
 * record that never gets written.
 */
async function failed(step: Step, error: unknown, context: StepContext): Promise<StepOutcome> {
  const tried = candidatesTried(error);
  const session = await context.surface.state().catch(() => undefined);
  return {
    status: "failed",
    failure: {
      class: classify(error),
      message: context.scope.redact(messageOf(error)),
      ...(tried === undefined ? {} : { candidatesTried: tried as never }),
      ...(stackOf(error) === undefined ? {} : { stack: context.scope.redact(stackOf(error)!) }),
      ...(context.screenshots === "never" || context.screenshotPath === undefined
        ? {}
        : { screenshot: context.screenshotPath(step) }),
      ...(session === undefined ? {} : { session }),
    },
  };
}

/**
 * A screenshot, masking the elements a secret was typed into (REQ-NFR-6).
 *
 * Best effort: a screenshot that fails must not turn a passing step into a
 * failing one, or a report would be reporting on the reporter.
 */
async function screenshot(step: Step, context: StepContext): Promise<void> {
  const path = context.screenshotPath?.(step);
  if (path === undefined) return;
  try {
    const masks: Ref[] = [];
    if (step.target !== undefined && stepInjectsSecret(step, context.scope)) {
      const resolved = await resolveTarget(context, step.target, context.surface).catch(
        () => undefined,
      );
      if (resolved !== undefined) masks.push(resolved.ref);
    }
    await context.surface.screenshot(path, masks);
  } catch {
    // Nothing: see above.
  }
}

/** Whether this step puts a secret into the page (REQ-NFR-6: masked screenshots). */
function stepInjectsSecret(step: Step, scope: Scope): boolean {
  for (const value of Object.values(step.args ?? {})) {
    if (typeof value !== "object" || value === null) continue;
    const ref = value as { kind?: string; secret?: boolean };
    if (ref.kind === "data" && ref.secret === true) return true;
    try {
      if (scope.isSecretValue(scope.read(value as never))) return true;
    } catch {
      // A reference that cannot be read is not a secret we can mask.
    }
  }
  return false;
}
