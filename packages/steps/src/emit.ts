/**
 * Turning a template match into IR (LLD §3.2, §5, Draft 2.2).
 *
 * The whole of the interesting part is which side of `custom` a placeholder
 * lands on:
 *
 * * `string`, `number`, `boolean` and `value` become `ValueRef`s under
 *   `custom.params`.
 * * `target` becomes a `TargetRef` under `custom.targets`.
 *
 * Draft 2.2 added `custom.targets` for exactly this reason. A target encoded as
 * a literal in `params` is invisible to the recorder, which grounds targets, and
 * to the resolver, which resolves them — the step would compile, record clean,
 * and then act on nothing. The schema now rejects it, and this is the code that
 * has to get it right.
 */
import type { TargetRef, ValueRef } from "@svatah/schema";
import type { Placeholder } from "./types.js";
import type { TemplateMatch } from "./template.js";

/** How a `value` placeholder's text becomes a `ValueRef`. Supplied by the compiler. */
export type ValueParser = (raw: string) => ValueRef;

/** How a `target` placeholder's phrase becomes a `TargetRef`. Supplied by the compiler. */
export type TargetResolver = (phrase: string) => TargetRef;

export interface EmitOptions {
  readonly parseValue: ValueParser;
  readonly resolveTarget: TargetResolver;
}

export interface EmittedCustom {
  readonly params: Record<string, ValueRef>;
  readonly targets: Record<string, TargetRef>;
}

/** Split a match's captures into `params` and `targets`. */
export function emitCustom(
  placeholders: readonly Placeholder[],
  match: TemplateMatch,
  options: EmitOptions,
): EmittedCustom {
  const params: Record<string, ValueRef> = {};
  const targets: Record<string, TargetRef> = {};

  for (const placeholder of placeholders) {
    const raw = match.captures[placeholder.name] ?? "";
    if (placeholder.type === "target") {
      targets[placeholder.name] = options.resolveTarget(raw.trim());
      continue;
    }
    if (placeholder.type === "value") {
      params[placeholder.name] = options.parseValue(raw.trim());
      continue;
    }
    /*
     * `string`, `number` and `boolean` are a literal *or* a `{…}` reference —
     * the two forms their patterns accept (LLD §5, `template.ts`). A reference
     * goes through the same parser a `value` placeholder uses, so
     * `{input.amount}` in a `number` slot produces the same `ValueRef` it would
     * anywhere else and the executor resolves it against the same scope.
     */
    const trimmed = raw.trim();
    params[placeholder.name] =
      trimmed.startsWith("{") && trimmed.endsWith("}")
        ? options.parseValue(trimmed)
        : { kind: "literal", value: raw };
  }

  return { params, targets };
}
