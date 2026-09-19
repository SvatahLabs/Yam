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
} from "@svatah/yam-schema";
import type { AgentSurface, SnapshotNode } from "@svatah/yam-surface";
import { CheckError, isWindowChrome, TimeoutError } from "@svatah/yam-surface";
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
 * schema` and nothing else. The CLI, which has both, wires `@svatah/yam-steps` in.
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

/**
 * Runs an `api` step. Injected for the same reason.
 *
 * `surface` is the session the step runs in, when there is one (REQ-ADP-3).
 * `Call the "x" API with the session cookies` means "as the person the browser
 * signed in", and the runner is the only thing that sends the request — but it
 * was never shown the browser, so the phrase compiled, ran, and sent no
 * browser cookie. The runner asks `surface.cookies(url)` for them; a surface
 * without that method has none to give.
 */
export type ApiRunner = (
  step: Step,
  context: { scope: Scope; args: Record<string, unknown>; surface?: AgentSurface },
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
  /**
   * How long an expectation is re-asked before it is a failure
   * (`config.run.expectTimeoutMs`, T00).
   *
   * Undefined keeps the old behaviour — asked once — for a caller that has not
   * been told; `run` passes the project's own value.
   */
  readonly expectTimeoutMs?: number;
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
      holds = (await evaluate(step.guard.subject, step.guard.predicate, step, context, {
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
      })).ok;
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
      /*
       * A step that asserts an element is *not there* does not resolve it here
       * (T12.7). `evaluate` does, and takes a `locator` failure as the answer;
       * resolving up front would turn "…should be absent" into the one
       * assertion that can never pass. See `meansAbsence`.
       */
      if (meansAbsence(step)) {
        matched = await resolveTarget(context, step.target, surface).catch(() => undefined);
      } else {
        matched = await resolveTarget(context, step.target, surface);
      }
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
      /*
       * Asked until it holds, or until the budget runs out (T00, SF-11).
       *
       * An expectation used to be evaluated exactly once. Against a live
       * application that is a coin flip, and the parity gate published the
       * result of one for a whole wave as a disagreement between two oracles:
       * clicking the desktop's Flows rail item makes that screen's own buttons
       * visible **up to 200 ms before** the toolbar title beside them changes
       * (measured), so a flow that waits by resolving one and then asserts the
       * other is asking about a screen that has half arrived. The accessibility
       * side agreed with the application only because a native tree read is
       * slow enough that the frame has always landed.
       *
       * Only expectations. A *guard* is a question asked now — "only if the
       * error is hidden, click sign in" — and one that waited would change what
       * the sentence means and delay every step it guards.
       *
       * A predicate that is *supposed* not to hold costs the budget before it
       * fails, which is the price of a green run meaning something; two seconds
       * by default, and `expectTimeoutMs: 0` restores the single evaluation.
       */
      const budget = context.expectTimeoutMs ?? 0;
      const deadline = Date.now() + budget;
      let held = await evaluate(step.expect.subject, step.expect.predicate, step, context);
      while (!held.ok && Date.now() < deadline) {
        await new Promise((done) => setTimeout(done, 100));
        held = await evaluate(step.expect.subject, step.expect.predicate, step, context);
      }
      if (!held.ok) {
        throw new CheckError(
          `Expected ${describePredicate(step.expect.predicate)}${
            step.target === undefined ? "" : ` of "${step.target.phrase}"`
          }, and it was not so${observed(held.actual)}.`,
        );
      }
      return undefined;
    }

    case "api": {
      if (context.api === undefined) {
        throw new DataError(
          "This step calls an API and no HTTP adapter is wired in. " +
            "`yam run` registers one; a foreign runtime has to supply its own.",
        );
      }
      const value = await context.api(step, { scope, args, surface });
      return capture(step, value, scope);
    }

    case "custom": {
      if (context.custom === undefined) {
        throw new DataError(
          `This step is the custom step ${step.custom?.id ?? "?"}, and no runner for custom steps ` +
            "is wired in. `yam run` loads `steps/`; a foreign runtime cannot execute Tier 0.",
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
     * checks needed: the app's Run button starts a *second* Yam run, and a
     * flow could not wait for it or read its result.
     *
     * The poll is the step's own timeout, half a second apart. A request that
     * throws is not a failure yet — a service that has not finished starting
     * answers with a connection refused, and giving up on the first one would
     * make this a race rather than a wait.
     */
    case "waitFor": {
      if (step.expect?.subject !== "api") {
        /*
         * An element wait takes its state from the step's predicate (see
         * `elementWait`). A target with no reference is an `absent` or
         * `hidden` wait whose element did not resolve (`meansAbsence`), and
         * is asked rather than sent to the adapter as a page wait.
         */
        const asked = elementWait(step, args);
        if (asked.poll || (step.target !== undefined && ref === undefined)) {
          await waitUntilHolds(step, context);
          return undefined;
        }
        await surface.act(step.action as never, ref, asked.args as never, ref2);
        return undefined;
      }
      if (context.api === undefined) {
        throw new DataError(
          "This step waits on an API and no HTTP adapter is wired in. " +
            "`yam run` registers one; a foreign runtime has to supply its own.",
        );
      }
      const deadline = Date.now() + step.timeoutMs;
      const wanted = resolvePredicateValue(step.expect.predicate, scope);
      let last: unknown;
      let why = "";
      for (;;) {
        try {
          last = await context.api(step, { scope, args, surface });
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

/*
 * The state a `Wait for "<element>" to be <state>` waits for (pattern 19).
 *
 * The sentence compiles to a target and `expect: {subject: "target",
 * predicate}`, and nothing else; every adapter reads the state from
 * `args.state` and waits for `visible` when there is none. So the executor
 * handed the adapter `{}`, and `Wait for "toast" to be hidden` waited for the
 * toast to be *visible* — returning at once while it was on the screen, which
 * is exactly when the flow meant to wait — and `to be enabled` returned as
 * soon as a still-disabled button was drawn. The predicate is the state, so it
 * becomes `args.state` here. A state already in `args` is the caller's and is
 * left alone, and a step with no predicate still reads `until`, the argument
 * migrated steps carry (`present` or `visible`).
 */
const WAIT_STATES: Readonly<Record<string, string>> = {
  present: "attached",
  absent: "detached",
  visible: "visible",
  hidden: "hidden",
  enabled: "enabled",
  disabled: "disabled",
};
const LEGACY_UNTIL: Readonly<Record<string, string>> = { present: "attached", visible: "visible" };

/**
 * The arguments an element wait goes to the adapter with — or `poll`, for a
 * predicate no adapter's `waitFor` knows (`checked`, `unchecked`, `selected`,
 * a negated one), which the executor asks `check` about itself rather than
 * sending a wait the adapter would read as "visible", or refuse.
 */
function elementWait(
  step: Step,
  args: Record<string, unknown>,
): { poll: false; args: Record<string, unknown> } | { poll: true } {
  if (args["state"] !== undefined || step.target === undefined) return { poll: false, args };
  const predicate = step.expect?.subject === "target" ? step.expect.predicate : undefined;
  if (predicate !== undefined) {
    const one = predicate as { kind: string; negate?: boolean };
    const state = one.negate === true ? undefined : WAIT_STATES[one.kind];
    return state === undefined ? { poll: true } : { poll: false, args: { ...args, state } };
  }
  const until = typeof args["until"] === "string" ? LEGACY_UNTIL[args["until"]] : undefined;
  return until === undefined ? { poll: false, args } : { poll: false, args: { ...args, state: until } };
}

/**
 * Ask the step's own predicate until it holds, for the step's timeout.
 *
 * `evaluate` resolves the element afresh each time, so an element that is
 * replaced while it is waited on is asked about as it now is, and an `absent`
 * or `hidden` one that no longer resolves holds (T12.7). Running out is a
 * `timeout`, as an adapter's own wait running out is.
 */
async function waitUntilHolds(step: Step, context: StepContext): Promise<void> {
  const expectation = step.expect;
  if (expectation === undefined) {
    throw new DataError(`"${step.text}" waits for an element with no state to wait for.`);
  }
  const deadline = Date.now() + step.timeoutMs;
  for (;;) {
    const held = await evaluate(expectation.subject, expectation.predicate, step, context);
    if (held.ok) return;
    if (Date.now() >= deadline) {
      throw new TimeoutError(
        `Waited ${step.timeoutMs} ms for ${
          step.target === undefined ? "the element" : `"${step.target.phrase}"`
        } to be ${describePredicate(expectation.predicate)}, and it was not so${observed(held.actual)}.`,
        { timeoutMs: step.timeoutMs },
      );
    }
    await new Promise((done) => setTimeout(done, 100));
  }
}

/**
 * Does this predicate *mean* "not there"? (T12.7)
 *
 * `absent` and `hidden`, un-negated. `should not be absent` is the opposite
 * claim and keeps the resolver's failure, because an element nobody can find is
 * exactly what that sentence says must not be the case.
 */
function predicateMeansAbsence(predicate: Predicate): boolean {
  const one = predicate as { kind: string; negate?: boolean };
  return one.negate !== true && (one.kind === "absent" || one.kind === "hidden");
}

/**
 * Is this step an expectation, or a wait, that its own target is not there?
 *
 * A wait too: `Wait for "toast" to be absent` once the toast has already gone
 * failed at resolution with "matched nothing", which is the state it was
 * waiting for. Such a wait reaches `waitFor` with no reference, and is asked
 * through `evaluate`, which takes a locator failure as the answer.
 */
function meansAbsence(step: Step): boolean {
  return (
    (step.action === "expect" || step.action === "waitFor") &&
    step.expect?.subject === "target" &&
    step.guard === undefined &&
    predicateMeansAbsence(step.expect.predicate)
  );
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
): Promise<Held> {
  if (subject === "scope") return { ok: evaluateExpression(predicate, context.scope) };
  if (subject === "set") return { ok: await evaluateSet(predicate, step, context) };
  if (subject === "api") {
    // `waitFor` polls the API itself, above; nothing else asks about one.
    throw new DataError(
      `"${step.text}" asks about an API answer outside a \`Wait for … to answer\` step.`,
    );
  }

  const element = about.target ?? step.target;
  /*
   * "…should be absent" is the sentence for an element that is not there, and
   * an element that is not there does not resolve (T12.7).
   *
   * Until now the resolver's `locator` failure came first, so the one predicate
   * whose *whole meaning* is "I could not find it" could only pass when a stale
   * reference happened to survive — which is to say, almost never. The Surface
   * explorer's alert is the case that found it: it is on the screen while the
   * intent is empty and gone once it is not, and the sentence that says so
   * failed with "matched nothing", which is the answer rather than the error.
   *
   * Only for `absent` and `hidden`, and only when the *resolution* is what
   * failed. Every other predicate keeps the old behaviour, because "the sign in
   * button should be visible" against an element nobody can find is a locator
   * failure and saying anything else would hide it.
   */
  const meansNotThere = subject === "target" && predicateMeansAbsence(predicate);
  let ref: Ref | undefined;
  if (subject === "target" && element !== undefined) {
    try {
      ref = (await resolveTarget(context, element, context.surface)).ref;
    } catch (error) {
      if (!meansNotThere || classify(error) !== "locator") throw error;
      return { ok: true };
    }
  }

  const resolved = resolvePredicateValue(predicate, context.scope);
  const result = await context.surface.check(
    resolved,
    subject === "target" ? "ref" : subject,
    ref,
  );
  /*
   * The value the adapter actually read comes back with the verdict (SF-11).
   *
   * "Checks returning false … retain the actual observed value", and this
   * discarded it: every failing expectation read *"and it was not so"* with
   * nothing about what was there instead. The parity gate's
   * `app.screen-through-two-adapters` disagreement survived a whole wave on
   * that sentence — one oracle said the toolbar title contained "Flows" and the
   * other said it did not, and neither said what it had read.
   */
  return { ok: result.ok, actual: result.actual };
}

/** A predicate's verdict, and what was observed when it did not hold. */
interface Held {
  readonly ok: boolean;
  readonly actual?: unknown;
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
  /*
   * `control` is what a person operates, and a `<select>`'s own options are
   * not: they are reached through the select, and macOS publishes exactly one
   * of them — the selected one, with no title of its own — so "every control
   * has a name" failed on an artefact of the platform's pop-up button rather
   * than on anything the application did. `item` is the noun for a row of a
   * list, and it has `option` in it, so a sentence that really is about the
   * command palette's rows still has one.
   */
  control: [
    "button", "link", "textbox", "searchbox", "checkbox", "radio", "combobox",
    "listbox", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "switch",
    "slider", "spinbutton",
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

/**
 * Is this node a member of the set the sentence named?
 *
 * **Standard window chrome is not**, and for the reason the desktop conformance
 * case gives (P10-F2): the window's close, minimise and zoom buttons are the
 * *window manager's*, not the application's. macOS creates them, names them by
 * subrole, and gives an application no way to put an identifier on them — so
 * "every button on this screen has an id" would fail on every macOS window that
 * has ever existed, which is a rule about the platform rather than about the
 * application. `isWindowChrome` is the same closed list the conformance case
 * uses, deliberately shared rather than restated.
 *
 * `element` is the exception to the exception: it means every node in the
 * snapshot, chrome included, because a sentence that says `element` is asking
 * about the tree rather than about the application's own controls.
 */
function inSet(node: SnapshotNode, of: string): boolean {
  if (of === "element") return true;
  if (isWindowChrome(node)) return false;
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

/**
 * What was there instead, for a failure message a reader can act on (SF-11).
 *
 * Bounded, because a page's text is a page's text and a failure line is a line;
 * and silent when the adapter did not say — a predicate like `visible` has no
 * observed *value*, and inventing "false" for it would be noise.
 */
function observed(actual: unknown): string {
  if (actual === undefined || actual === null) return "";
  const said = typeof actual === "string" ? actual : JSON.stringify(actual);
  if (said === "" || said === "true" || said === "false") return "";
  const shown = said.replace(/\s+/g, " ").trim();
  return `; what was there was ${JSON.stringify(shown.length > 300 ? `${shown.slice(0, 300)}…` : shown)}`;
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

  /*
   * The message reads as the sentence does. `describePredicate` already says
   * "not attribute …" for a negated predicate, so prefixing "did not" spelled
   * a double negative at exactly the moment somebody is trying to work out what
   * went wrong.
   */
  throw new CheckError(
    `${offenders.length} of ${members.length} ${spec.of}(s) ${where} ` +
      `${spec.quantifier === "every" ? "failed" : "matched"} ${describePredicate(wanted)}: ` +
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
 * `yam-bindings heal --run`, which is the defect F1 names.
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
