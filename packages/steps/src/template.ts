/**
 * Template compilation and matching (REQ-LANG-15, LLD §5).
 *
 * `"Transfer {amount:number} from {from:target} to {to:target}"` becomes a
 * regular expression with one capture per placeholder. The literal text between
 * placeholders is matched case-insensitively with whitespace collapsed, because
 * a step is prose and prose does not have consistent spacing.
 *
 * ## Why the captures are typed and not just `(.+)`
 *
 * A `number` placeholder that accepted anything would let
 * `Transfer everything from A to B` match, bind `amount` to `"everything"`, and
 * fail at run time with a message about a value the author never thought of as a
 * number. Each type gets a pattern that only its own values satisfy, so a
 * sentence that does not fit simply does not match — and then the grammar gets
 * its turn, which is the correct outcome.
 *
 * `target` is the loose one, necessarily: a target is a noun phrase and almost
 * anything can be one. It is bounded by the literal text around it, which is why
 * a template with two adjacent `target` placeholders and nothing between them is
 * rejected at definition time rather than silently matching greedily.
 */
import { PLACEHOLDER_TYPES, type Placeholder, type PlaceholderType } from "./types.js";

/** `{name:type}` — the only placeholder syntax. */
const PLACEHOLDER = /\{([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([a-z]+)\}/g;

/**
 * What each placeholder type may capture.
 *
 * `value` and `target` are lazy (`+?`) so the literal text after them wins; a
 * greedy target would swallow " to the savings account" and leave the second
 * placeholder nothing.
 */
const PATTERNS: Record<PlaceholderType, string> = {
  // A quoted literal, or a bare word run with no quotes.
  string: '(?:"((?:[^"\\\\]|\\\\.)*)"|(\\S+))',
  number: "(-?\\d+(?:\\.\\d+)?)",
  boolean: "(true|false)",
  // A noun phrase, bounded by the literal text around it.
  target: "(.+?)",
  // A quoted literal or a `{…}` reference (LLD §5).
  value: '("(?:[^"\\\\]|\\\\.)*"|\\{[^}]+\\}|\\S+)',
};

/** How many capture groups each type's pattern opens. */
const GROUPS: Record<PlaceholderType, number> = {
  string: 2,
  number: 1,
  boolean: 1,
  target: 1,
  value: 1,
};

export interface CompiledTemplate {
  readonly template: string;
  readonly placeholders: readonly Placeholder[];
  readonly regex: RegExp;
}

export class TemplateError extends Error {}

/** Escape a literal run so it matches itself, with flexible whitespace. */
function literalPattern(text: string): string {
  const escaped = text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Any run of whitespace in the template matches any run in the sentence.
  return escaped.replace(/\s+/g, "\\s+");
}

/**
 * Compile a template into a matcher.
 *
 * Throws on a template that could not do its job: an unknown placeholder type, a
 * repeated name, or two placeholders with nothing between them. All three are
 * author mistakes that would otherwise show up as a step that never matches, or
 * matches with the wrong split — much harder to diagnose than a message at
 * definition time.
 */
export function compileTemplate(template: string): CompiledTemplate {
  const placeholders: Placeholder[] = [];
  const seen = new Set<string>();
  let pattern = "^";
  let last = 0;
  let previousEndedAt = -1;

  PLACEHOLDER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PLACEHOLDER.exec(template)) !== null) {
    const [whole, name, type] = match as unknown as [string, string, string];

    if (!(PLACEHOLDER_TYPES as readonly string[]).includes(type)) {
      throw new TemplateError(
        `"${template}": placeholder {${name}:${type}} has an unknown type. ` +
          `Use one of: ${PLACEHOLDER_TYPES.join(", ")}.`,
      );
    }
    if (seen.has(name)) {
      throw new TemplateError(`"${template}": placeholder "${name}" appears twice.`);
    }
    seen.add(name);

    const between = template.slice(last, match.index);
    if (previousEndedAt === match.index && between.trim() === "") {
      throw new TemplateError(
        `"${template}": {${name}:${type}} follows another placeholder with nothing between them. ` +
          "There would be no way to tell where the first value ends.",
      );
    }
    if (between.trim() === "" && previousEndedAt >= 0 && between.length > 0 && /^\s+$/.test(between)) {
      throw new TemplateError(
        `"${template}": {${name}:${type}} is separated from the placeholder before it only by a space. ` +
          "Put a word between them, or the split is a guess.",
      );
    }

    pattern += literalPattern(between);
    pattern += PATTERNS[type as PlaceholderType];
    placeholders.push({ name, type: type as PlaceholderType });

    last = match.index + whole.length;
    previousEndedAt = last;
  }

  pattern += literalPattern(template.slice(last));
  pattern += "$";

  if (placeholders.length === 0 && template.trim() === "") {
    throw new TemplateError("A step template cannot be empty.");
  }

  return { template, placeholders, regex: new RegExp(pattern, "i") };
}

export interface TemplateMatch {
  /** Placeholder name → the raw text it captured. */
  readonly captures: Readonly<Record<string, string>>;
}

/** Match a sentence against a compiled template. */
export function matchTemplate(
  compiled: CompiledTemplate,
  sentence: string,
): TemplateMatch | undefined {
  const found = compiled.regex.exec(sentence.trim());
  if (found === null) return undefined;

  const captures: Record<string, string> = {};
  let group = 1;
  for (const placeholder of compiled.placeholders) {
    const width = GROUPS[placeholder.type];
    if (placeholder.type === "string") {
      // Two alternatives: a quoted literal, or a bare run. Exactly one matched.
      const quoted = found[group];
      const bare = found[group + 1];
      captures[placeholder.name] = quoted ?? bare ?? "";
    } else {
      captures[placeholder.name] = found[group] ?? "";
    }
    group += width;
  }
  return { captures };
}
