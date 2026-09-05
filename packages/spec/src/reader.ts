/**
 * The flow file reader (REQ-LANG-1, 2, 3, 10, 13, 14 (parse), LLD §4.1).
 *
 * ```
 * File     := (Blank | Comment | Block)*
 * Block    := Header NEWLINE SigLine* (StepLine | GuardLine | Comment)* (Blank | EOF)
 * Header   := Kind Meta? ':' Name
 * SigLine  := ('inputs:' | 'outputs:') (Param (',' Param)*)
 * GuardLine:= ('Only if' | 'Unless') Predicate
 * StepLine := ('Only if' Predicate ',' | 'Unless' Predicate ',')? Sentence
 * Comment  := ('//' | '#') any
 * ```
 *
 * The reader stops at the sentence. What a sentence *means* is Tier 0 (T2.3) and
 * Tier 1 (T2.4); what the file *is* — blocks, order, metadata, signatures, which
 * guard applies to which step — is here. The split is deliberate: a sentence the
 * grammar does not recognise should be one diagnostic on one line, not a file
 * that stops parsing.
 *
 * Every diagnostic carries a line, and the reader keeps going after one wherever
 * it can. A flow with three mistakes should report three, not the first.
 */
import type { Signature } from "@svatah/schema";
import type { FlowBlock, FlowFile, ListBlock, RawStep, StoryBlock } from "./ast.js";
import { diagnostic, type Diagnostic } from "./diagnostics.js";
import { parseMeta } from "./meta.js";
import { isEmpty, readSignatureLine } from "./signature.js";

/** `story`, `scenario`, `compose`, `test`, `run` — the five block kinds. */
const HEADER =
  /^(story|scenario|compose|test|run)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/;

const GUARD = /^(only if|unless)\b\s*(.*)$/i;

const SIGNATURE_LINE = /^(inputs|outputs)\s*:\s*(.*)$/i;

/** `//` or `#` starts a comment line (REQ-LANG-3). */
function isComment(line: string): boolean {
  return line.startsWith("//") || line.startsWith("#");
}

/**
 * Split a guard prefix from its sentence at the first comma outside quotes.
 *
 * `Only if the banner is visible, Click the sign in button` is a prefixed step;
 * `Only if {plan} matches "free,basic"` is a standalone guard whose predicate
 * happens to contain a comma. Quotes are the only thing that can tell them
 * apart, so quotes are what is honoured (REQ-LANG-5: literals are always
 * double-quoted).
 */
function splitAtComma(text: string): { before: string; after: string } | undefined {
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (char === '"' && text[i - 1] !== "\\") quoted = !quoted;
    if (char === "," && !quoted) {
      return { before: text.slice(0, i).trim(), after: text.slice(i + 1).trim() };
    }
  }
  return undefined;
}

interface Pending {
  header: { kind: string; meta: string | undefined; name: string; line: number };
  signature: { inputs: Signature["inputs"]; outputs: Signature["outputs"] };
  sawSignature: boolean;
  steps: RawStep[];
  names: Array<{ name: string; line: number }>;
  /** A `Only if …` line waiting for the step it guards. */
  guard: { mode: "onlyIf" | "unless"; text: string; line: number } | undefined;
  /** True once a step has been read, so a late `inputs:` is an error. */
  sawStep: boolean;
}

/**
 * Read one flow file.
 *
 * `file` is the path as it should appear in diagnostics — relative to the
 * project root, so a report reads the same on every machine.
 */
export function readFlow(text: string, file: string): { flow: FlowFile; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  const blocks: FlowBlock[] = [];
  const lines = text.split(/\r?\n/);

  let pending: Pending | undefined;

  const finish = (): void => {
    if (pending === undefined) return;
    const { header } = pending;

    if (pending.guard !== undefined) {
      diagnostics.push(
        diagnostic(
          "E_GUARD_ORPHAN",
          `"${pending.guard.text}" guards nothing: a guard line applies to the step below it, and the block ends here.`,
          { file, line: pending.guard.line },
        ),
      );
    }

    if (header.kind === "story" || header.kind === "scenario") {
      const { meta, diagnostics: metaDiagnostics } = parseMeta(header.meta ?? "", {
        file,
        line: header.line,
      });
      diagnostics.push(...metaDiagnostics);

      const signature: Signature = {
        inputs: pending.signature.inputs,
        outputs: pending.signature.outputs,
      };
      const story: StoryBlock = {
        kind: header.kind,
        name: header.name,
        line: header.line,
        meta,
        ...(pending.sawSignature && !isEmpty(signature) ? { signature } : {}),
        steps: pending.steps,
      };
      blocks.push(story);
    } else {
      if (header.meta !== undefined) {
        diagnostics.push(
          diagnostic(
            "E_META",
            `A "${header.kind}:" block takes no metadata; only story and scenario headers do.`,
            { file, line: header.line },
          ),
        );
      }
      const kind = header.kind as ListBlock["kind"];

      if (kind === "compose") {
        if (pending.names.length === 0) {
          diagnostics.push(
            diagnostic("E_SYNTAX", `"compose: ${header.name}" names no stories.`, {
              file,
              line: header.line,
            }),
          );
        }
        blocks.push({ kind, name: header.name, line: header.line, names: pending.names });
        pending = undefined;
        return;
      }

      /*
       * A run block that lists nothing runs the story or composition of its own
       * name. Every legacy flow is written that way — `test : Validate Text` —
       * and the migrated fixtures keep it, so this is the common case rather
       * than a fallback. Listing names below the header is the form that lets
       * one run block name several, which REQ-LANG-10 asks for and the legacy
       * parser could not express.
       */
      const listed = pending.names.length > 0;
      blocks.push({
        kind,
        name: header.name,
        line: header.line,
        names: listed ? pending.names : [{ name: header.name, line: header.line }],
        ...(listed ? {} : { fromHeader: true }),
      });
    }
    pending = undefined;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const number = index + 1;
    const raw = lines[index]!;
    const line = raw.trim();

    if (line === "") {
      // A blank line ends a block (LLD §4.1).
      finish();
      continue;
    }
    if (isComment(line)) continue;

    const header = HEADER.exec(line);
    if (header !== null) {
      // A header ends the previous block whether or not a blank line did.
      finish();
      const name = header[3]!.trim();
      if (name === "") {
        diagnostics.push(
          diagnostic("E_SYNTAX", `"${header[1]!}:" has no name.`, { file, line: number, source: raw }),
        );
        continue;
      }
      pending = {
        header: { kind: header[1]!, meta: header[2], name, line: number },
        signature: { inputs: {}, outputs: {} },
        sawSignature: false,
        steps: [],
        names: [],
        guard: undefined,
        sawStep: false,
      };
      continue;
    }

    if (pending === undefined) {
      diagnostics.push(
        diagnostic(
          "E_SYNTAX",
          `"${line}" is outside any block. Every step belongs to a story, scenario, compose, test or run header.`,
          { file, line: number, source: raw },
        ),
      );
      continue;
    }

    const isStoryKind = pending.header.kind === "story" || pending.header.kind === "scenario";

    const signatureLine = SIGNATURE_LINE.exec(line);
    if (signatureLine !== null && isStoryKind) {
      if (pending.sawStep) {
        diagnostics.push(
          diagnostic(
            "E_SIGNATURE",
            `"${signatureLine[1]!}:" must come directly under the header, before any step.`,
            { file, line: number, source: raw },
          ),
        );
        continue;
      }
      pending.sawSignature = true;
      readSignatureLine(
        signatureLine[1]!.toLowerCase() as "inputs" | "outputs",
        signatureLine[2]!,
        { file, line: number, source: raw },
        pending.signature,
        diagnostics,
      );
      continue;
    }

    if (!isStoryKind) {
      // `compose:` and the run blocks list one story name per line.
      pending.names.push({ name: line, line: number });
      continue;
    }

    const guard = GUARD.exec(line);
    if (guard !== null) {
      const mode = guard[1]!.toLowerCase() === "unless" ? "unless" : "onlyIf";
      const rest = guard[2]!.trim();
      if (rest === "") {
        diagnostics.push(
          diagnostic("E_SYNTAX", `"${line}" has no predicate.`, { file, line: number, source: raw }),
        );
        continue;
      }
      const split = splitAtComma(rest);
      if (split === undefined) {
        // A guard line: it applies to the next step (REQ-LANG-14).
        if (pending.guard !== undefined) {
          diagnostics.push(
            diagnostic(
              "E_GUARD_ORPHAN",
              `"${pending.guard.text}" guards nothing: another guard line follows it. One guard per step.`,
              { file, line: pending.guard.line },
            ),
          );
        }
        pending.guard = { mode, text: rest, line: number };
        continue;
      }
      // A prefixed step: `Only if <predicate>, <sentence>`.
      if (split.after === "") {
        diagnostics.push(
          diagnostic("E_SYNTAX", `"${line}" has a guard but no step after the comma.`, {
            file,
            line: number,
            source: raw,
          }),
        );
        continue;
      }
      if (pending.guard !== undefined) {
        diagnostics.push(
          diagnostic(
            "E_GUARD_ORPHAN",
            `"${pending.guard.text}" guards nothing: the step below carries its own guard. One guard per step.`,
            { file, line: pending.guard.line },
          ),
        );
        pending.guard = undefined;
      }
      pending.sawStep = true;
      pending.steps.push({
        text: split.after.replace(/\s+/g, " "),
        line: number,
        guard: { mode, text: split.before, line: number },
      });
      continue;
    }

    pending.sawStep = true;
    pending.steps.push({
      text: line.replace(/\s+/g, " "),
      line: number,
      ...(pending.guard === undefined ? {} : { guard: pending.guard }),
    });
    pending.guard = undefined;
  }

  finish();

  return { flow: { file, blocks }, diagnostics };
}
