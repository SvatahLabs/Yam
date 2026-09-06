const REDACTED = "[REDACTED]";

export interface RedactionPolicy {
  patterns: RegExp[];
  literals: string[];
}

export function createRedactionPolicy(): RedactionPolicy {
  return { patterns: [], literals: [] };
}

export function addSecretPattern(policy: RedactionPolicy, pattern: RegExp): void {
  policy.patterns.push(pattern);
}

export function addSecretLiteral(policy: RedactionPolicy, literal: string): void {
  if (literal.length > 0) {
    policy.literals.push(literal);
  }
}

export function redactString(policy: RedactionPolicy, value: string): string {
  let result = value;
  for (const literal of policy.literals) {
    while (result.includes(literal)) {
      result = result.replace(literal, REDACTED);
    }
  }
  for (const pattern of policy.patterns) {
    result = result.replace(pattern, REDACTED);
  }
  return result;
}

export function redactObject(policy: RedactionPolicy, obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return redactString(policy, obj);
  if (typeof obj === "number" || typeof obj === "boolean") return obj;
  if (Array.isArray(obj)) return obj.map((item) => redactObject(policy, item));
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = redactObject(policy, value);
    }
    return result;
  }
  return obj;
}

export function hasSecret(policy: RedactionPolicy, value: string): boolean {
  for (const literal of policy.literals) {
    if (value.includes(literal)) return true;
  }
  for (const pattern of policy.patterns) {
    if (pattern.test(value)) return true;
  }
  return false;
}
