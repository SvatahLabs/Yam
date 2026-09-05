/**
 * The heal diff (REQ-HEAL-2).
 *
 * "Repairs are a diff to the bindings store plus a report; plan and flows are
 * never modified."
 *
 * A diff rather than a write, because a repair is a proposal about the meaning of
 * an element and a person has to agree with it. It is a unified diff `git apply`
 * accepts, so accepting a repair is `git apply` and nothing else — no bespoke
 * format, no tool to learn, and the review happens in the reviewer's own
 * diff viewer.
 */

/** One file's before and after, as text. */
export interface FileChange {
  /** Path relative to the repository root, e.g. `bindings/login/username-field.yaml`. */
  readonly path: string;
  readonly before: string;
  readonly after: string;
}

/** Longest common subsequence of two line arrays, as an index pair list. */
function lcs(a: readonly string[], b: readonly string[]): Array<[number, number]> {
  const table: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  );
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i]![j] = a[i] === b[j] ? table[i + 1]![j + 1]! + 1 : Math.max(table[i + 1]![j]!, table[i]![j + 1]!);
    }
  }
  const pairs: Array<[number, number]> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      pairs.push([i, j]);
      i += 1;
      j += 1;
    } else if (table[i + 1]![j]! >= table[i]![j + 1]!) i += 1;
    else j += 1;
  }
  return pairs;
}

type Op = { kind: " " | "-" | "+"; text: string; a: number; b: number };

function operations(before: readonly string[], after: readonly string[]): Op[] {
  const common = lcs(before, after);
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  for (const [ai, bj] of common) {
    while (i < ai) ops.push({ kind: "-", text: before[i]!, a: i++, b: j });
    while (j < bj) ops.push({ kind: "+", text: after[j]!, a: i, b: j++ });
    ops.push({ kind: " ", text: before[ai]!, a: i++, b: j++ });
  }
  while (i < before.length) ops.push({ kind: "-", text: before[i]!, a: i++, b: j });
  while (j < after.length) ops.push({ kind: "+", text: after[j]!, a: i, b: j++ });
  return ops;
}

/** How many unchanged lines surround a change. Three is what `git` uses. */
const CONTEXT = 3;

/** A unified diff for one file, or `""` when nothing changed. */
export function unifiedDiff(change: FileChange, context = CONTEXT): string {
  if (change.before === change.after) return "";

  const beforeLines = splitLines(change.before);
  const afterLines = splitLines(change.after);
  const ops = operations(beforeLines, afterLines);

  // Group the changes into hunks, each padded with `context` unchanged lines.
  const changed = ops
    .map((op, index) => (op.kind === " " ? -1 : index))
    .filter((index) => index >= 0);
  if (changed.length === 0) return "";

  const hunks: Array<{ from: number; to: number }> = [];
  for (const index of changed) {
    const from = Math.max(0, index - context);
    const to = Math.min(ops.length - 1, index + context);
    const last = hunks[hunks.length - 1];
    if (last !== undefined && from <= last.to + 1) last.to = Math.max(last.to, to);
    else hunks.push({ from, to });
  }

  const header =
    change.before === ""
      ? [`--- /dev/null`, `+++ b/${change.path}`]
      : change.after === ""
        ? [`--- a/${change.path}`, `+++ /dev/null`]
        : [`--- a/${change.path}`, `+++ b/${change.path}`];

  const lines = [`diff --git a/${change.path} b/${change.path}`, ...header];

  for (const hunk of hunks) {
    const slice = ops.slice(hunk.from, hunk.to + 1);
    const aStart = slice.find((op) => op.kind !== "+")?.a ?? beforeLines.length;
    const bStart = slice.find((op) => op.kind !== "-")?.b ?? afterLines.length;
    const aCount = slice.filter((op) => op.kind !== "+").length;
    const bCount = slice.filter((op) => op.kind !== "-").length;

    lines.push(
      `@@ -${aCount === 0 ? aStart : aStart + 1},${aCount} +${bCount === 0 ? bStart : bStart + 1},${bCount} @@`,
    );
    for (const op of slice) lines.push(`${op.kind}${op.text}`);
  }

  // A file that does not end in a newline has to say so, or `git apply` will add
  // one and the round trip stops being exact.
  if (change.after !== "" && !change.after.endsWith("\n")) {
    lines.push("\\ No newline at end of file");
  }

  return `${lines.join("\n")}\n`;
}

/** One diff for a set of changed files, in path order. */
export function unifiedDiffFor(changes: readonly FileChange[], context = CONTEXT): string {
  return [...changes]
    .sort((a, b) => (a.path < b.path ? -1 : 1))
    .map((change) => unifiedDiff(change, context))
    .filter((text) => text !== "")
    .join("");
}

function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  // A trailing newline produces a final empty element that is not a line.
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}
