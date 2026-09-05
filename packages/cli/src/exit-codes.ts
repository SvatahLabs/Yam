/**
 * The exit codes of LLD §15.
 *
 * They are part of the CLI's contract — CI decides what happened from them — so
 * they live in one table rather than as literals at the call sites.
 */
export const EXIT = {
  ok: 0,
  /** A run failed, or a command reports "not ok" without a more specific code. */
  failed: 1,
  /** `compile` / `lint`: the input had errors. */
  compileErrors: 2,
  /** A model backend was configured but unavailable. */
  modelUnavailable: 3,
  /** `record`: grounding failed. */
  groundingFailed: 4,
  /** `record`: an expectation failed while recording. */
  expectationFailed: 5,
  /** `run`: the run passed only because bindings were healed (REQ-HEAL-4). */
  healed: 6,
  /** `heal`: some failures could not be repaired. */
  someUnrepaired: 7,
  /** `migrate`: something in the source had no mapping. */
  unmapped: 8,
  /** `record`: refused by the environment policy (REQ-AUTO-7). */
  refused: 10,
  /** `run`: a flow aborted under its policy. */
  aborted: 11,
  /** `run --resume`: the plan or bindings hash does not match the checkpoint. */
  hashMismatch: 12,
  /** The command line itself was wrong. */
  usage: 64,
} as const;

export type ExitCode = (typeof EXIT)[keyof typeof EXIT];
