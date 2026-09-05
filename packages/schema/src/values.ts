import { z } from "zod";

/**
 * How a step refers to a value (LLD §3.1).
 *
 * `template` is recursive, so the schema is built with `z.lazy` and the inferred
 * type is declared explicitly.
 */
export type ValueRef =
  | { kind: "literal"; value: string }
  | { kind: "var"; story?: string; name: string }
  | { kind: "data"; path: string; secret?: boolean }
  | { kind: "input"; name: string }
  | { kind: "template"; parts: ValueRef[] };

export const valueRefSchema: z.ZodType<ValueRef> = z.lazy(() =>
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("literal"), value: z.string() }).strict(),
    z
      .object({
        kind: z.literal("var"),
        /** Absent means "a capture of the current story"; set means `{Story name.name}`. */
        story: z.string().min(1).optional(),
        name: z.string().min(1),
      })
      .strict(),
    z
      .object({
        kind: z.literal("data"),
        /** Dotted path into `data.yaml`, e.g. `user.email`. */
        path: z.string().min(1),
        /** True when the value came through `${ENV}` indirection under `secrets:` (REQ-NFR-6). */
        secret: z.boolean().optional(),
      })
      .strict(),
    z.object({ kind: z.literal("input"), name: z.string().min(1) }).strict(),
    z
      .object({
        kind: z.literal("template"),
        parts: z.array(valueRefSchema),
      })
      .strict(),
  ]),
);

/** A literal that a step may carry directly rather than through a `ValueRef`. */
export const scalarArgSchema = z.union([z.string(), z.number(), z.boolean()]);
export type ScalarArg = z.infer<typeof scalarArgSchema>;

/** `Step.args` values: a `ValueRef` or a plain scalar (LLD §3.2). */
export const argValueSchema: z.ZodType<ValueRef | ScalarArg> = z.union([
  valueRefSchema,
  scalarArgSchema,
]);
export type ArgValue = ValueRef | ScalarArg;

/** True when a `ValueRef` reads a value marked secret; used by redaction (REQ-NFR-6). */
export function referencesSecret(ref: ValueRef): boolean {
  switch (ref.kind) {
    case "data":
      return ref.secret === true;
    case "template":
      return ref.parts.some(referencesSecret);
    default:
      return false;
  }
}
