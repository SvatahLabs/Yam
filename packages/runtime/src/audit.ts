/**
 * The audit log (REQ-AUTO-6, LLD §3.4, §8.6).
 *
 * "`audit.jsonl` records invoker identity, inputs (secrets redacted), every
 * surface call with reference and outcome, and outputs."
 *
 * Every surface call, without the executor having to remember to write a line at
 * each call site — because that is exactly the kind of thing that is complete on
 * the day it is written and has three gaps a year later. `auditing()` wraps a
 * surface in a proxy, so a call that is added later is audited by existing.
 *
 * `seq` is monotonic within a run, so lines can be ordered after the fact even
 * though flows run in parallel and their timestamps interleave.
 */
import type { AgentSurface } from "@svatah/yam-surface";
import type { AuditKind, AuditLine, Invoker } from "@svatah/yam-schema";
import type { Scope } from "./scope.js";

export interface AuditSink {
  write(line: AuditLine): void;
}

/** Collects lines in memory. The runner writes them to `audit.jsonl`. */
export class MemoryAuditSink implements AuditSink {
  readonly lines: AuditLine[] = [];
  write(line: AuditLine): void {
    this.lines.push(line);
  }
}

export interface AuditContext {
  readonly runId: string;
  readonly sink: AuditSink;
  /** Redacts secrets out of anything written (REQ-NFR-6). */
  readonly scope: Scope;
  /** Off when `config.run.audit` is false. */
  readonly enabled: boolean;
}

/**
 * Methods an adapter exposes that are *about* itself rather than calls on the
 * platform, and which the proxy must therefore leave alone.
 *
 * The trap turns every function into an async one that writes a line. That is
 * right for `act`, `read`, `snapshot` and the rest, and wrong for an accessor:
 * `dialogLog()` returns an array the caller iterates, and wrapped it returned a
 * Promise — "not a function or its return value is not iterable", from every
 * run, the moment the executor started draining it (T8.3).
 */
const NOT_A_SURFACE_CALL = new Set(["capabilities", "bridgeCost", "dialogLog", "browser"]);

/**
 * A `Candidate` reduced to the two fields that say which one it is.
 *
 * `by` and `value` for a locator, `role` and `name` for a role candidate — the
 * form the `Run` artboard's audit pane shows (`testid "pay"`). The fingerprint,
 * the score and the context stay out: they are a paragraph, and the audit line
 * is a line.
 */
function candidateOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null) return {};
  const one = value as Record<string, unknown>;
  return {
    ...(typeof one["by"] === "string" ? { by: one["by"] } : {}),
    ...(typeof one["value"] === "string" ? { value: one["value"] } : {}),
    ...(typeof one["role"] === "string" ? { role: one["role"] } : {}),
    ...(typeof one["name"] === "string" ? { name: one["name"] } : {}),
    ...(typeof one["nth"] === "number" ? { nth: one["nth"] } : {}),
  };
}

export class Auditor {
  private seq = 0;

  constructor(private readonly context: AuditContext) {}

  /** One line. Everything in `detail` and `call.args` is redacted first. */
  record(
    kind: AuditKind,
    parts: Omit<AuditLine, "runId" | "at" | "seq" | "kind"> = {},
  ): void {
    if (!this.context.enabled) return;
    const redacted = this.context.scope.redact({
      ...(parts.call === undefined ? {} : { call: parts.call }),
      ...(parts.detail === undefined ? {} : { detail: parts.detail }),
      ...(parts.error === undefined ? {} : { error: parts.error }),
    });

    this.context.sink.write({
      runId: this.context.runId,
      at: new Date().toISOString(),
      seq: this.seq++,
      kind,
      ...parts,
      ...redacted,
    } as AuditLine);
  }

  run(invoker: Invoker, inputs: Readonly<Record<string, unknown>>): void {
    this.record("run", { detail: { invoker, inputs } });
  }

  story(story: string, detail?: unknown): void {
    this.record("story", { story, ...(detail === undefined ? {} : { detail }) });
  }

  outputs(story: string, outputs: Readonly<Record<string, unknown>>): void {
    this.record("output", { story, detail: outputs });
  }

  policy(story: string, stepId: string, detail: unknown): void {
    this.record("policy", { story, stepId, detail });
  }

  /**
   * Somebody stopped this run (Draft 2.12 §13.5, T10.4).
   *
   * Written where the executor noticed — between two steps, in a named story —
   * so `audit.jsonl` says which step was the last one to run and which never
   * started. Without it a stopped run is indistinguishable from one whose
   * remaining steps a policy skipped, and the difference is whether a person
   * did it.
   */
  stopped(where: { story?: string; stepId?: string }, reason: string): void {
    this.record("stop", { ...where, detail: { reason } });
  }

  /**
   * One dialog the adapter answered (Draft 2.9 LLD §3.2, T8.3).
   *
   * "A dialog answered with no armed policy writes an audit line
   * `kind:"dialog", armed:false, answer:"accept"` so the default is never
   * silent." The line exists for the unarmed case and is written for both,
   * because a log that only records the mistake cannot be read as an account of
   * what happened.
   */
  dialog(
    story: string,
    stepId: string,
    answered: { type: string; message: string; armed: boolean; answer: "accept" | "dismiss" },
  ): void {
    this.record("dialog", {
      story,
      stepId,
      armed: answered.armed,
      answer: answered.answer,
      detail: { type: answered.type, message: answered.message },
    });
  }

  /**
   * Wrap a surface so every call writes a line.
   *
   * A `Proxy` rather than a hand-written wrapper: `AgentSurface` has fourteen
   * methods and two optional ones, and a wrapper would need updating each time
   * one is added — which is precisely when nobody remembers the audit log.
   */
  auditing(
    surface: AgentSurface,
    at: () => { story?: string; stepId?: string; element?: string },
  ): AgentSurface {
    if (!this.context.enabled) return surface;
    // The proxy's traps are not arrow functions — a `get` trap has its own
    // `this` — so the auditor is captured explicitly.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const auditor: Auditor = this;

    return new Proxy(surface, {
      get(target, property, receiver) {
        const value = Reflect.get(target, property, receiver) as unknown;
        if (typeof value !== "function" || typeof property !== "string") return value;
        if (NOT_A_SURFACE_CALL.has(property)) return value.bind(target);

        return async function audited(...args: unknown[]): Promise<unknown> {
          const started = performance.now();
          /*
           * `element` is not an audit-line field: it is *which element the
           * caller asked for*, which for `locate` is the reference the call is
           * about (REQ-AUTO-6: "every surface call with reference and
           * outcome"). The surface itself is handed a candidate and never the
           * element id, so without this a `locate` line read `locate · ok` and
           * a reader could not tell which of a step's five candidates it was
           * (P9-F5, Draft 2.12 §13.7).
           */
          const { element, ...where } = at();
          const call = {
            method: property,
            ...(property === "act" && typeof args[0] === "string" ? { action: args[0] } : {}),
            ...(property === "locate" && element !== undefined
              ? { ref: element }
              : typeof args[1] === "string"
                ? { ref: args[1] }
                : {}),
            ...(property === "act" || property === "read" || property === "check"
              ? { args: args.slice(2) }
              : {}),
            // The candidate, reduced to what identifies it. A whole candidate
            // carries a fingerprint and a score, which is a paragraph in a log
            // line; `testid "pay"` is what the mockup's audit pane shows.
            ...(property === "locate" ? { args: [candidateOf(args[0])] } : {}),
          };

          try {
            const result: unknown = await (value as (...a: unknown[]) => Promise<unknown>).apply(
              target,
              args,
            );
            auditor.record("surface", {
              ...where,
              call,
              /*
               * How many elements a candidate matched. The resolver requires
               * exactly one (REQ-RUN-5), so this is what says whether a
               * candidate was the one — and it is the artboard's own words,
               * "matched nothing".
               */
              ...(property === "locate" && Array.isArray(result)
                ? { detail: { matched: result.length } }
                : {}),
              outcome: "ok",
              durationMs: Math.round(performance.now() - started),
            });
            return result;
          } catch (error) {
            auditor.record("surface", {
              ...where,
              call,
              outcome: "error",
              error: error instanceof Error ? error.message : String(error),
              durationMs: Math.round(performance.now() - started),
            });
            throw error;
          }
        };
      },
    });
  }
}
