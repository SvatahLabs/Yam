/**
 * `LocatorError` — the resolver's failure (LLD §6.3, REQ-RUN-5).
 *
 * "Resolution tries candidates in order with a per-candidate timeout, requires
 * exactly one match, and reports every candidate tried on failure."
 *
 * The report is the point. A locator failure is the one a healer acts on
 * (REQ-HEAL-1) and the one a person has to diagnose from a CI log, so the error
 * carries what was tried, what each attempt saw, where the session was, and
 * whether the page's shape had drifted from the one the binding was recorded
 * against — which is the difference between "this element moved" and "this is a
 * different page".
 */
import type { Candidate, SessionState } from "@svatah/yam-schema";
import { LocateError } from "@svatah/yam-surface";

/** What one candidate did when it was tried. */
export interface CandidateAttempt {
  readonly candidate: Candidate;
  /** How many elements it matched. */
  readonly matched: number;
  readonly durationMs: number;
  /** Set when the candidate itself failed rather than simply matching nothing. */
  readonly error?: string;
  /** Why this attempt was not accepted, when it matched something. */
  readonly rejected?: string;
}

export interface LocatorErrorDetail {
  /** The element id being resolved. */
  readonly id: string;
  readonly phrase?: string;
  readonly tried: readonly CandidateAttempt[];
  readonly state?: SessionState;
  /** True when the live context hash differs from the one the entry was recorded against. */
  readonly contextDrift: boolean;
  readonly recordedHash?: string;
  readonly liveHash?: string;
}

export class LocatorError extends LocateError {
  readonly detail: LocatorErrorDetail;

  constructor(detail: LocatorErrorDetail) {
    super(describe(detail), { adapter: "resolver" });
    this.detail = detail;
  }

  /** The failure as a line for `.yam/bind-failures.jsonl` (LLD §12). */
  toFailureLine(): Record<string, unknown> {
    return {
      id: this.detail.id,
      ...(this.detail.phrase === undefined ? {} : { phrase: this.detail.phrase }),
      at: new Date().toISOString(),
      contextDrift: this.detail.contextDrift,
      ...(this.detail.recordedHash === undefined ? {} : { recordedHash: this.detail.recordedHash }),
      ...(this.detail.liveHash === undefined ? {} : { liveHash: this.detail.liveHash }),
      ...(this.detail.state === undefined ? {} : { state: this.detail.state }),
      tried: this.detail.tried.map((a) => ({
        by: a.candidate.by,
        candidate: a.candidate,
        matched: a.matched,
        durationMs: a.durationMs,
        ...(a.error === undefined ? {} : { error: a.error }),
        ...(a.rejected === undefined ? {} : { rejected: a.rejected }),
      })),
    };
  }
}

function summarise(candidate: Candidate): string {
  const parts: string[] = [candidate.by];
  if (candidate.role !== undefined) parts.push(candidate.role);
  if (candidate.name !== undefined) parts.push(JSON.stringify(candidate.name));
  if (candidate.value !== undefined) parts.push(JSON.stringify(candidate.value));
  if (candidate.tool !== undefined) parts.push(`tool=${candidate.tool}`);
  if (candidate.nth !== undefined) parts.push(`nth=${candidate.nth}`);
  return parts.join(" ");
}

function describe(detail: LocatorErrorDetail): string {
  const lines: string[] = [];
  lines.push(
    `Could not resolve "${detail.id}"${detail.phrase === undefined ? "" : ` (${detail.phrase})`}: ` +
      `${detail.tried.length} candidate${detail.tried.length === 1 ? "" : "s"} tried, none matched exactly one element.`,
  );
  for (const attempt of detail.tried) {
    const outcome =
      attempt.error !== undefined
        ? `error: ${attempt.error}`
        : attempt.rejected ?? `matched ${attempt.matched}`;
    lines.push(`  ${summarise(attempt.candidate)} — ${outcome} (${attempt.durationMs} ms)`);
  }
  if (detail.state?.url !== undefined) lines.push(`  session at ${detail.state.url}`);
  if (detail.contextDrift) {
    lines.push(
      "  the page's shape has drifted from the one this binding was recorded against " +
        `(recorded ${detail.recordedHash?.slice(0, 12) ?? "?"}, live ${detail.liveHash?.slice(0, 12) ?? "?"}) — ` +
        "the element may not simply have moved.",
    );
  }
  return lines.join("\n");
}
