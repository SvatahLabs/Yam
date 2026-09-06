/**
 * Story signatures (REQ-LANG-13, LLD §3.2, `docs/flow-language.md` §2).
 *
 * ```
 * inputs: date: string, seats: number = 2, token: secret
 * outputs: bookingId: string, total: number
 * ```
 *
 * A signature is what makes a story invocable as a function, which is what makes
 * the workflow and tool behaviors possible at all (REQ-AUTO-5). So the parse is
 * strict: an unknown type, a duplicate name, or a default that is not of the
 * declared type is an error here rather than a surprise at run time.
 *
 * Defaults are literals: a quoted string, a number, or `true`/`false`. They are
 * not expressions and not variable references — a default that could read
 * `{data.x}` would make a story's signature depend on the run's data, and the
 * signature is the part that is supposed to be knowable without one.
 */
import { INPUT_TYPES, OUTPUT_TYPES, type Signature } from "@svatah/yam-schema";
import { diagnostic, type Diagnostic } from "./diagnostics.js";

type InputType = (typeof INPUT_TYPES)[number];
type OutputType = (typeof OUTPUT_TYPES)[number];

interface Where {
  file: string;
  line: number;
  source?: string;
}

/** Split on commas that separate parameters, not commas inside a quoted default. */
function splitParams(raw: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < raw.length; i += 1) {
    const char = raw[i]!;
    if (char === '"' && raw[i - 1] !== "\\") quoted = !quoted;
    if (char === "," && !quoted) {
      out.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  out.push(current);
  return out.map((part) => part.trim()).filter((part) => part !== "");
}

/** A default literal, and whether it matches the declared type. */
function parseDefault(
  raw: string,
  type: InputType,
  name: string,
  where: Where,
  out: Diagnostic[],
): { value: unknown } | undefined {
  const text = raw.trim();
  if (type === "secret") {
    out.push(
      diagnostic(
        "E_SIGNATURE",
        `Input "${name}" is a secret and cannot have a default. A secret in a flow file is a secret in the repository (REQ-NFR-6).`,
        where,
      ),
    );
    return undefined;
  }
  if (text.startsWith('"') && text.endsWith('"') && text.length >= 2) {
    const value = text.slice(1, -1);
    if (type !== "string" && type !== "json") {
      out.push(
        diagnostic(
          "E_SIGNATURE",
          `Input "${name}" is declared ${type} but its default is the string ${text}.`,
          where,
        ),
      );
      return undefined;
    }
    return { value };
  }
  if (text === "true" || text === "false") {
    if (type !== "boolean" && type !== "json") {
      out.push(
        diagnostic(
          "E_SIGNATURE",
          `Input "${name}" is declared ${type} but its default is the boolean ${text}.`,
          where,
        ),
      );
      return undefined;
    }
    return { value: text === "true" };
  }
  if (/^-?\d+(\.\d+)?$/.test(text)) {
    if (type !== "number" && type !== "json") {
      out.push(
        diagnostic(
          "E_SIGNATURE",
          `Input "${name}" is declared ${type} but its default is the number ${text}.`,
          where,
        ),
      );
      return undefined;
    }
    return { value: Number(text) };
  }
  out.push(
    diagnostic(
      "E_SIGNATURE",
      `The default for "${name}" must be a quoted string, a number, or true/false — not ${text}. ` +
        "Signature defaults are literals, so a story's signature is knowable without a run.",
      where,
    ),
  );
  return undefined;
}

/**
 * Read one `inputs:` or `outputs:` line into the signature being built.
 *
 * Mutates `signature` because the two lines are read independently and either
 * may be absent; returning a merged copy per line would make the caller do the
 * merging instead, for no gain.
 */
export function readSignatureLine(
  which: "inputs" | "outputs",
  raw: string,
  where: Where,
  signature: { inputs: Signature["inputs"]; outputs: Signature["outputs"] },
  out: Diagnostic[],
): void {
  const params = splitParams(raw);
  if (params.length === 0) {
    out.push(diagnostic("E_SIGNATURE", `"${which}:" names no parameters.`, where));
    return;
  }

  for (const param of params) {
    const at = param.indexOf(":");
    if (at < 0) {
      out.push(
        diagnostic(
          "E_SIGNATURE",
          `"${param}" is not "name: type". Every ${which.slice(0, -1)} declares a type.`,
          where,
        ),
      );
      continue;
    }
    const name = param.slice(0, at).trim();
    const rest = param.slice(at + 1).trim();
    if (name === "") {
      out.push(diagnostic("E_SIGNATURE", `"${param}" has no name.`, where));
      continue;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      out.push(
        diagnostic(
          "E_SIGNATURE",
          `"${name}" is not a usable name. Use letters, digits and underscores, starting with a letter.`,
          where,
        ),
      );
      continue;
    }

    const equals = rest.indexOf("=");
    const typeText = (equals < 0 ? rest : rest.slice(0, equals)).trim();
    const defaultText = equals < 0 ? undefined : rest.slice(equals + 1);

    const allowed: readonly string[] = which === "inputs" ? INPUT_TYPES : OUTPUT_TYPES;
    if (!allowed.includes(typeText)) {
      out.push(
        diagnostic(
          "E_SIGNATURE",
          `"${name}" is declared "${typeText}". ${which === "inputs" ? "Inputs" : "Outputs"} must be one of: ${allowed.join(", ")}.`,
          where,
        ),
      );
      continue;
    }

    if (which === "inputs") {
      if (signature.inputs[name] !== undefined) {
        out.push(diagnostic("E_SIGNATURE", `Input "${name}" is declared twice.`, where));
        continue;
      }
      const type = typeText as InputType;
      if (defaultText === undefined) {
        signature.inputs[name] = { type };
        continue;
      }
      const parsed = parseDefault(defaultText, type, name, where, out);
      if (parsed === undefined) continue;
      signature.inputs[name] = { type, default: parsed.value };
    } else {
      if (signature.outputs[name] !== undefined) {
        out.push(diagnostic("E_SIGNATURE", `Output "${name}" is declared twice.`, where));
        continue;
      }
      if (defaultText !== undefined) {
        out.push(
          diagnostic(
            "E_SIGNATURE",
            `Output "${name}" has a default. An output is produced by the story, not supplied to it.`,
            where,
          ),
        );
      }
      signature.outputs[name] = { type: typeText as OutputType };
    }
  }
}

/** Whether a signature says anything, so an empty one is left off the story. */
export function isEmpty(signature: Signature): boolean {
  return Object.keys(signature.inputs).length === 0 && Object.keys(signature.outputs).length === 0;
}
