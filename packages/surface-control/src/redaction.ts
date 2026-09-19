import { isSecretField, REDACTED_VALUE, type ElementDescription } from "@svatah/yam-schema";

const REDACTED = REDACTED_VALUE;

export interface RedactionPolicy {
  patterns: RegExp[];
  /** Secrets every session's output is redacted of. */
  literals: string[];
  /**
   * Secrets one session declared, redacted from that session's output only
   * (SF-15). One client's `secrets` used to join the broker-wide list, so an
   * agent could blank words out of the Activity a person reads on another
   * session.
   */
  sessions?: Map<string, string[]>;
}

/**
 * The shortest secret redacted wherever it appears inside a longer string.
 *
 * A shorter one is redacted only where it is the whole value. Replacing every
 * `E` in every answer is not redaction, it is noise — and it was worse than
 * noise: the placeholder itself contains `E`, `RED` and `[`, and the old loop
 * replaced until nothing matched, so a one-letter secret never returned and
 * the broker every client shares stopped answering.
 */
const SHORTEST_SUBSTRING_SECRET = 3;

export function createRedactionPolicy(): RedactionPolicy {
  return { patterns: [], literals: [], sessions: new Map() };
}

export function addSecretPattern(policy: RedactionPolicy, pattern: RegExp): void {
  policy.patterns.push(pattern);
}

/** A secret for every session, or — given `session` — for that session alone. */
export function addSecretLiteral(policy: RedactionPolicy, literal: string, session?: string): void {
  if (literal.length === 0) return;
  if (session === undefined) {
    if (!policy.literals.includes(literal)) policy.literals.push(literal);
    return;
  }
  policy.sessions ??= new Map();
  const declared = policy.sessions.get(session) ?? [];
  if (!declared.includes(literal)) declared.push(literal);
  policy.sessions.set(session, declared);
}

/** Forget what a session declared, when it closes. */
export function forgetSecrets(policy: RedactionPolicy, session: string): void {
  policy.sessions?.delete(session);
}

function literalsFor(policy: RedactionPolicy, session: string | undefined): string[] {
  const declared = session === undefined ? [] : (policy.sessions?.get(session) ?? []);
  // Longest first, so a secret that contains another is replaced whole.
  return [...policy.literals, ...declared].sort((a, b) => b.length - a.length);
}

export function redactString(policy: RedactionPolicy, value: string, session?: string): string {
  const literals = literalsFor(policy, session);
  if (literals.includes(value) || policy.patterns.some((pattern) => wholeMatch(pattern, value))) {
    return REDACTED;
  }
  /*
   * Segments, so a placeholder already written is never searched again: one
   * pass per secret over the text that is still text.
   */
  let parts: Array<{ text: string; redacted: boolean }> = [{ text: value, redacted: false }];
  const splitBy = (find: (text: string) => string[]): void => {
    parts = parts.flatMap((part) => {
      if (part.redacted) return [part];
      const pieces = find(part.text);
      return pieces.flatMap((piece, index) => [
        ...(index === 0 ? [] : [{ text: REDACTED, redacted: true }]),
        ...(piece === "" ? [] : [{ text: piece, redacted: false }]),
      ]);
    });
  };
  for (const literal of literals) {
    if (literal.length < SHORTEST_SUBSTRING_SECRET) continue;
    splitBy((text) => text.split(literal));
  }
  for (const pattern of policy.patterns) {
    const every = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    splitBy((text) => text.replace(every, "\u0000").split("\u0000"));
  }
  return parts.map((part) => part.text).join("");
}

function wholeMatch(pattern: RegExp, value: string): boolean {
  const found = new RegExp(pattern.source, pattern.flags.replace("g", "")).exec(value);
  return found !== null && found[0] === value && value !== "";
}

export function redactObject(policy: RedactionPolicy, obj: unknown, session?: string): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return redactString(policy, obj, session);
  if (typeof obj === "number" || typeof obj === "boolean") return obj;
  if (Array.isArray(obj)) return obj.map((item) => redactObject(policy, item, session));
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = redactObject(policy, value, session);
    }
    return result;
  }
  return obj;
}

export function hasSecret(policy: RedactionPolicy, value: string, session?: string): boolean {
  return redactString(policy, value, session) !== value;
}

/** Whether a `describe()` answer, of whatever provenance, names a secret field. */
function describesSecretField(describe: unknown): boolean {
  const described = describe as ElementDescription | undefined;
  return (
    typeof described === "object" &&
    described !== null &&
    typeof described.attrs === "object" &&
    isSecretField(described)
  );
}

/**
 * An action's arguments as they may be kept: in a trajectory, in the promotion
 * store, in a proposal (SF-15).
 *
 * Redacting only what a result echoed left the arguments themselves raw, and
 * those are what a session is promoted from — so a password typed with an
 * intent reached `runs/<id>/trajectory.jsonl` and then a proposal's `.flow`,
 * which is a file a person commits. A declared secret is withheld wherever it
 * appears; a value typed into a field that says it is a password is withheld
 * whether or not anybody declared it.
 *
 * `failClosed` withholds the typed value when nothing says what the field was:
 * a `describe` that failed — a stale reference, a page that navigated — is not
 * evidence that the field was an ordinary one.
 */
export function withholdSecrets(
  args: Record<string, unknown> | undefined,
  evidence: { secrets?: readonly string[]; describe?: unknown; failClosed?: boolean },
): Record<string, unknown> | undefined {
  if (args === undefined) return undefined;
  const policy = createRedactionPolicy();
  for (const secret of evidence.secrets ?? []) addSecretLiteral(policy, secret);
  const out = redactObject(policy, args) as Record<string, unknown>;
  const withhold =
    describesSecretField(evidence.describe) ||
    (evidence.failClosed === true && evidence.describe === undefined);
  if (withhold && typeof out["value"] === "string" && out["value"] !== "") out["value"] = REDACTED;
  return out;
}

/**
 * What a call about a secret field may keep of the field's own value (SF-15).
 *
 * `describe()` answers a password field's `value`, a `read` returns it and a
 * `check` reports it as `actual` — so evidence gathered for a step on the field
 * carried the password even when the typed arguments did not. Every `value`,
 * `actual` and `expected` inside is withheld when the field is a secret one;
 * anything else is returned as it came.
 */
export function withholdFieldValues<T>(answer: T, describe: unknown): T {
  if (!describesSecretField(describe)) return answer;
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        ["value", "actual", "expected"].includes(key) && item !== undefined && item !== null && typeof item !== "object"
          ? REDACTED
          : walk(item),
      ]),
    );
  };
  return walk(answer) as T;
}
