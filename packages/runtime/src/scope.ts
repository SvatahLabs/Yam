/**
 * The run's scope (REQ-RUN-6, LLD §8.5).
 *
 * "Run data read-only and global; captures scoped to the flow and namespaced by
 * story; inputs scoped to the story."
 *
 * Three visibilities, and the reason each is what it is:
 *
 * * **Run data** is read-only because two runs of one plan against one
 *   application must produce the same outcomes (REQ-RUN-2). A step that could
 *   rewrite the data would make the second run depend on the first.
 * * **Captures** are per flow and namespaced by story, so `{Story name.value}`
 *   reads across stories inside a flow and nothing reads across flows — flows run
 *   in parallel (REQ-RUN-3), and a shared capture space would make their order
 *   observable.
 * * **Inputs** are per story, because a story with a signature is a function
 *   (REQ-AUTO-5) and a function's parameters do not leak into its caller.
 *
 * ## Secrets
 *
 * The scope knows which values came from a secret path, and `redact()` is how
 * everything downstream — audit lines, results, screenshots, prompts — avoids
 * writing one down (REQ-NFR-6). Knowing it here rather than pattern-matching for
 * things that look like passwords is what makes the guarantee checkable.
 */
import type { Signature, ValueRef } from "@svatah/schema";

/** What a secret becomes wherever it would otherwise be written. */
export const REDACTED = "«redacted»";

export class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}

export interface ScopeOptions {
  /** `data.yaml`, already resolved. Read-only for the whole run. */
  readonly data?: Readonly<Record<string, unknown>>;
  /** Dotted paths declared secret (REQ-NFR-6). */
  readonly secrets?: ReadonlySet<string>;
}

interface StoryFrame {
  readonly inputs: Record<string, unknown>;
  readonly captures: Record<string, unknown>;
}

export class Scope {
  private readonly data: Readonly<Record<string, unknown>>;
  private readonly secrets: ReadonlySet<string>;
  /** Story name → its frame. Captures survive the story, inputs do not leak. */
  private readonly frames = new Map<string, StoryFrame>();
  private current: string | undefined;
  /** Values known to have come from a secret, by identity of the string. */
  private readonly secretValues = new Set<string>();

  constructor(options: ScopeOptions = {}) {
    this.data = options.data ?? {};
    this.secrets = options.secrets ?? new Set();
  }

  /** Enter a story, with its inputs. Re-entering keeps the captures it made. */
  enterStory(name: string, inputs: Readonly<Record<string, unknown>> = {}): void {
    const existing = this.frames.get(name);
    this.frames.set(name, {
      inputs: { ...inputs },
      captures: existing?.captures ?? {},
    });
    this.current = name;
  }

  /** Leave the current story. Its captures stay readable as `{Story.name}`. */
  leaveStory(): void {
    this.current = undefined;
  }

  get storyName(): string | undefined {
    return this.current;
  }

  /**
   * Capture a value.
   *
   * A name is never reassigned (LLD §8.5). The compiler catches this
   * statically (`E_VAR_REDEFINED`), so reaching it at run time means a custom
   * step did it, and a `DataError` is the honest answer: the story is not doing
   * what its text says.
   */
  capture(name: string, value: unknown): void {
    const frame = this.frame();
    if (name in frame.captures) {
      throw new DataError(
        `"${name}" is already captured in "${this.current!}". A name is never reassigned; ` +
          "capture the second value under a different name.",
      );
    }
    frame.captures[name] = value;
  }

  /** Every capture of a story, for `{Story.name}` and for a checkpoint. */
  capturesOf(story: string): Readonly<Record<string, unknown>> {
    return { ...(this.frames.get(story)?.captures ?? {}) };
  }

  /** Every story's captures, for a checkpoint (LLD §3.4). */
  allCaptures(): Record<string, Record<string, unknown>> {
    return Object.fromEntries(
      [...this.frames.entries()].map(([name, frame]) => [name, { ...frame.captures }]),
    );
  }

  inputsOf(story: string): Readonly<Record<string, unknown>> {
    return { ...(this.frames.get(story)?.inputs ?? {}) };
  }

  /** Restore from a checkpoint (REQ-AUTO-3). Run data is re-read, never stored. */
  restore(state: {
    inputs: Readonly<Record<string, unknown>>;
    captures: Readonly<Record<string, Record<string, unknown>>>;
  }): void {
    this.frames.clear();
    for (const [name, captures] of Object.entries(state.captures)) {
      this.frames.set(name, { inputs: {}, captures: { ...captures } });
    }
    for (const [name, value] of Object.entries(state.inputs)) {
      const frame = this.frames.get(name);
      if (frame !== undefined) Object.assign(frame.inputs, value as Record<string, unknown>);
    }
  }

  /** Resolve a `ValueRef` (LLD §3.1). */
  read(reference: ValueRef): unknown {
    switch (reference.kind) {
      case "literal":
        return reference.value;

      case "template":
        return reference.parts.map((part) => stringify(this.read(part))).join("");

      case "data": {
        const value = readPath(this.data, reference.path);
        if (value === undefined) {
          throw new DataError(`{data.${reference.path}} is not in the run data.`);
        }
        if (reference.secret === true || this.isSecretPath(reference.path)) {
          // Remembered by value, so redaction finds it wherever it ends up —
          // in a capture, in another story's input, inside a template.
          this.noteSecret(value);
        }
        return value;
      }

      case "input": {
        const frame = this.frame();
        if (!(reference.name in frame.inputs)) {
          throw new DataError(
            `{input.${reference.name}} was not supplied to "${this.current!}".`,
          );
        }
        return frame.inputs[reference.name];
      }

      case "var": {
        if (reference.story !== undefined) {
          const frame = this.frames.get(reference.story);
          if (frame === undefined) {
            throw new DataError(`{${reference.story}.${reference.name}} — that story has not run.`);
          }
          if (!(reference.name in frame.captures)) {
            throw new DataError(`"${reference.story}" captured no "${reference.name}".`);
          }
          return frame.captures[reference.name];
        }
        const frame = this.frame();
        if (reference.name in frame.captures) return frame.captures[reference.name];
        if (reference.name in frame.inputs) return frame.inputs[reference.name];
        throw new DataError(
          `{${reference.name}} has not been captured in "${this.current!}", and is not one of its inputs.`,
        );
      }
    }
  }

  /** Resolve a step's `args` (LLD §8.2: "args = scope.resolve(step.args)"). */
  resolveArgs(
    args: Readonly<Record<string, ValueRef | number | string | boolean>> | undefined,
  ): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [name, value] of Object.entries(args ?? {})) {
      out[name] = isValueRef(value) ? this.read(value) : value;
    }
    return out;
  }

  /**
   * The outputs a story's signature promises (REQ-AUTO-5).
   *
   * Validated against the declared types, because a story is invocable as a
   * function and a caller reading `{Book.total}` as a number should get one.
   */
  collectOutputs(story: string, signature: Signature | undefined): Record<string, unknown> {
    if (signature === undefined) return {};
    const captures = this.frames.get(story)?.captures ?? {};
    const out: Record<string, unknown> = {};

    for (const [name, declared] of Object.entries(signature.outputs)) {
      if (!(name in captures)) {
        throw new DataError(`"${story}" declares an output "${name}" that it never captured.`);
      }
      out[name] = coerce(captures[name], declared.type, `${story}.${name}`);
    }
    return out;
  }

  /** Validate and coerce a story's inputs before it runs (REQ-AUTO-5). */
  validateInputs(
    story: string,
    signature: Signature | undefined,
    supplied: Readonly<Record<string, unknown>>,
  ): Record<string, unknown> {
    if (signature === undefined) return { ...supplied };
    const out: Record<string, unknown> = {};

    /*
     * An input the signature does not declare is reported first. Someone who
     * mistyped a name would otherwise be told that a *different* input is
     * missing, while looking straight at the one they passed.
     */
    for (const name of Object.keys(supplied)) {
      if (signature.inputs[name] === undefined) {
        throw new DataError(
          `"${story}" has no input "${name}".` +
            (Object.keys(signature.inputs).length === 0
              ? " It declares none."
              : ` It declares: ${Object.keys(signature.inputs).sort().join(", ")}.`),
        );
      }
    }

    for (const [name, declared] of Object.entries(signature.inputs)) {
      if (name in supplied) {
        out[name] = coerce(supplied[name], declared.type, `${story}.${name}`);
        if (declared.type === "secret") this.noteSecret(out[name]);
        continue;
      }
      if ("default" in declared) {
        out[name] = declared.default;
        continue;
      }
      throw new DataError(
        `"${story}" needs an input "${name}" and none was supplied. ` +
          "Pass it with --input, or give it a default in the signature.",
      );
    }

    return out;
  }

  /* ── secrets (REQ-NFR-6) ────────────────────────────────────────────────── */

  /** Whether a dotted data path was declared secret, or sits under one. */
  isSecretPath(path: string): boolean {
    if (this.secrets.has(path)) return true;
    for (const secret of this.secrets) if (path.startsWith(`${secret}.`)) return true;
    return false;
  }

  /** Whether a value is one the scope has seen come from a secret. */
  isSecretValue(value: unknown): boolean {
    return typeof value === "string" && value !== "" && this.secretValues.has(value);
  }

  /**
   * Replace every secret value inside a structure.
   *
   * By *value*, not by name: a secret that has been read into a capture, passed
   * to another story as an input and interpolated into a template is the same
   * string all the way through, and redacting only the paths it was read from
   * would miss every one of those. Substring replacement matters because
   * `"Bearer ${token}"` is a header value that contains a secret rather than
   * being one.
   */
  redact<T>(value: T): T {
    if (this.secretValues.size === 0) return value;
    return this.redactInner(value) as T;
  }

  private redactInner(value: unknown): unknown {
    if (typeof value === "string") {
      let out = value;
      for (const secret of this.secretValues) {
        if (out.includes(secret)) out = out.split(secret).join(REDACTED);
      }
      return out;
    }
    if (Array.isArray(value)) return value.map((item) => this.redactInner(item));
    if (typeof value === "object" && value !== null) {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([key, item]) => [
          key,
          this.redactInner(item),
        ]),
      );
    }
    return value;
  }

  /**
   * Remember a value as secret, so `redact` finds it anywhere later.
   *
   * Very short values are not tracked: a one-character secret would turn every
   * occurrence of that character in every log line into `«redacted»`, which
   * destroys the output without protecting anything a log was going to leak.
   */
  noteSecret(value: unknown): void {
    if (typeof value !== "string" || value.length < 4) return;
    this.secretValues.add(value);
  }

  private frame(): StoryFrame {
    if (this.current === undefined) {
      throw new DataError("No story is running, so there is no scope to read or write.");
    }
    return this.frames.get(this.current)!;
  }
}

function isValueRef(value: unknown): value is ValueRef {
  return typeof value === "object" && value !== null && "kind" in value;
}

function stringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

function readPath(tree: Readonly<Record<string, unknown>>, path: string): unknown {
  let cursor: unknown = tree;
  for (const segment of path.split(".")) {
    if (typeof cursor !== "object" || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/** Coerce a value to a declared signature type, or say why it cannot be. */
function coerce(value: unknown, type: string, what: string): unknown {
  switch (type) {
    case "number": {
      const n = typeof value === "number" ? value : Number(value);
      if (Number.isNaN(n)) throw new DataError(`${what} is declared number; got ${JSON.stringify(value)}.`);
      return n;
    }
    case "boolean": {
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      throw new DataError(`${what} is declared boolean; got ${JSON.stringify(value)}.`);
    }
    case "json":
      return value;
    case "string":
    case "secret":
      return typeof value === "string" ? value : stringify(value);
    default:
      return value;
  }
}
