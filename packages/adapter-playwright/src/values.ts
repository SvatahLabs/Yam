/**
 * Reading a concrete value out of a `ValueRef` at the surface.
 *
 * LLD §8.2 has the executor resolve a step's arguments against the scope before
 * it calls the surface (`args = scope.resolve(step.args)`), so by the time a
 * predicate reaches an adapter every reference in it should already be a
 * literal. An adapter has no scope and cannot resolve `{name}`, `{data.x}` or
 * `{input.x}`; if one arrives it is a caller mistake, and saying so is better
 * than comparing against the string "{data.x}".
 */
import type { ValueRef } from "@svatah/yam-schema";
import { DataError } from "@svatah/yam-surface";

export function literalValue(ref: ValueRef): string {
  switch (ref.kind) {
    case "literal":
      return ref.value;
    case "template":
      return ref.parts.map(literalValue).join("");
    case "var":
    case "data":
    case "input":
      throw new DataError(
        `A predicate reached the adapter with an unresolved ${ref.kind} reference. ` +
          "The executor resolves values against the scope before calling the surface (LLD §8.2).",
        { adapter: "playwright" },
      );
    default: {
      const exhaustive: never = ref;
      throw new DataError(`Unknown value reference ${JSON.stringify(exhaustive)}.`, {
        adapter: "playwright",
      });
    }
  }
}
