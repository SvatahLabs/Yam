/**
 * Header metadata (REQ-LANG-2, LLD §4.1).
 *
 * ```
 * story (tags=smoke, onFailure=compensate:cancel booking): Book a slot
 * ```
 *
 * Every key is closed: an unknown one is an error rather than a silently ignored
 * word. A typo in `continueOnFailure` that read as "no policy" would change what
 * a failing flow does, and would do it invisibly.
 */
import type { OnFailure, StoryMeta } from "@svatah/schema";
import { diagnostic, type Diagnostic } from "./diagnostics.js";

/** The keys REQ-LANG-2 allows, and nothing else. */
export const META_KEYS = [
  "enabled",
  "dataProvider",
  "filePath",
  "continueOnFailure",
  "onFailure",
  "idempotent",
  "tags",
] as const;

export const DEFAULT_META: StoryMeta = { enabled: true, onFailure: "stop", tags: [] };

interface Where {
  file: string;
  line: number;
  source?: string;
}

/**
 * Split `a=1, b=2` on commas that are not inside a value.
 *
 * `onFailure=compensate:cancel booking` has no comma, but a story name could,
 * and `tags=a,b` deliberately does. Tags are the one repeated key, so a bare
 * comma inside a value would be ambiguous; the split is on commas that are
 * followed by `key=`, which is unambiguous because every key is known.
 */
function splitPairs(raw: string): string[] {
  const keys = META_KEYS.join("|");
  // A comma that a known key follows starts the next pair. `tags=a,b` and
  // `onFailure=compensate:cancel booking, please` therefore keep their commas.
  const boundary = new RegExp(`,\\s*(?=(?:${keys})\\s*(?:=|,|$))`, "g");
  return raw
    .split(boundary)
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** Keys that may be written bare, meaning `=true`. */
const FLAGS: readonly string[] = ["enabled", "idempotent", "continueOnFailure"];

function parseBoolean(
  key: string,
  value: string,
  where: Where,
  out: Diagnostic[],
): boolean | undefined {
  if (value === "true") return true;
  if (value === "false") return false;
  out.push(
    diagnostic("E_META", `"${key}" must be true or false, not "${value}".`, where),
  );
  return undefined;
}

/**
 * Parse the metadata inside a header's parentheses.
 *
 * Returns defaults plus whatever parsed; a diagnostic never stops the rest of
 * the header being read, because one bad key should not hide the story's steps.
 */
export function parseMeta(raw: string, where: Where): { meta: StoryMeta; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  let enabled = true;
  let dataProvider: string | undefined;
  let filePath: string | undefined;
  let idempotent: boolean | undefined;
  let tags: string[] = [];

  /** Set by `onFailure`, by `continueOnFailure`, or by neither. */
  let onFailure: OnFailure | undefined;
  let onFailureFrom: string | undefined;

  for (const pair of splitPairs(raw)) {
    const at = pair.indexOf("=");
    /*
     * A boolean key may be written bare: `scenario (idempotent): cancel booking`
     * reads better than `idempotent=true` and is what the fixtures use. Only the
     * booleans allow it, because `tags` or `onFailure` written bare would be a
     * value someone forgot rather than a flag someone set.
     */
    const bare = at < 0 && FLAGS.includes(pair.trim());
    if (at < 0 && !bare) {
      diagnostics.push(
        diagnostic(
          "E_META",
          `"${pair}" is not a key=value pair.` +
            (( META_KEYS as readonly string[]).includes(pair.trim())
              ? ` "${pair.trim()}" needs a value.`
              : ""),
          where,
        ),
      );
      continue;
    }
    const key = bare ? pair.trim() : pair.slice(0, at).trim();
    const value = bare ? "true" : pair.slice(at + 1).trim();

    if (!(META_KEYS as readonly string[]).includes(key)) {
      diagnostics.push(
        diagnostic(
          "E_META",
          `Unknown metadata key "${key}". Allowed: ${META_KEYS.join(", ")}.`,
          where,
        ),
      );
      continue;
    }
    if (value === "") {
      diagnostics.push(diagnostic("E_META", `"${key}" has no value.`, where));
      continue;
    }

    switch (key) {
      case "enabled": {
        const parsed = parseBoolean(key, value, where, diagnostics);
        if (parsed !== undefined) enabled = parsed;
        break;
      }
      case "idempotent": {
        const parsed = parseBoolean(key, value, where, diagnostics);
        if (parsed !== undefined) idempotent = parsed;
        break;
      }
      case "dataProvider":
        dataProvider = value;
        break;
      case "filePath":
        filePath = value;
        break;
      case "tags":
        tags = value
          .split(",")
          .map((tag) => tag.trim())
          .filter((tag) => tag !== "");
        break;
      case "continueOnFailure": {
        const parsed = parseBoolean(key, value, where, diagnostics);
        if (parsed === undefined) break;
        // REQ-LANG-2: an alias of onFailure=continue. `false` says nothing —
        // it is the default policy, not a third policy — so it sets nothing.
        if (parsed) {
          if (onFailure !== undefined && onFailureFrom === "onFailure") {
            diagnostics.push(
              diagnostic(
                "E_META",
                "continueOnFailure=true and onFailure both set the abort policy. Use one.",
                where,
              ),
            );
            break;
          }
          onFailure = "continue";
          onFailureFrom = "continueOnFailure";
        }
        break;
      }
      case "onFailure": {
        const parsed = parseOnFailure(value, where, diagnostics);
        if (parsed === undefined) break;
        if (onFailure !== undefined && onFailureFrom === "continueOnFailure") {
          diagnostics.push(
            diagnostic(
              "E_META",
              "continueOnFailure=true and onFailure both set the abort policy. Use one.",
              where,
            ),
          );
          break;
        }
        onFailure = parsed;
        onFailureFrom = "onFailure";
        break;
      }
    }
  }

  return {
    meta: {
      enabled,
      onFailure: onFailure ?? "stop",
      tags,
      ...(dataProvider === undefined ? {} : { dataProvider }),
      ...(filePath === undefined ? {} : { filePath }),
      ...(idempotent === undefined ? {} : { idempotent }),
    },
    diagnostics,
  };
}

/** `stop` | `continue` | `compensate:<story>` (REQ-AUTO-4). */
export function parseOnFailure(
  value: string,
  where: Where,
  out: Diagnostic[],
): OnFailure | undefined {
  if (value === "stop" || value === "continue") return value;
  if (value.startsWith("compensate:")) {
    const story = value.slice("compensate:".length).trim();
    if (story === "") {
      out.push(
        diagnostic("E_META", 'onFailure=compensate: needs a story name after the colon.', where),
      );
      return undefined;
    }
    return { compensate: story };
  }
  out.push(
    diagnostic(
      "E_META",
      `onFailure must be "stop", "continue" or "compensate:<story>", not "${value}".`,
      where,
    ),
  );
  return undefined;
}
