/**
 * What a session did, in a shape that compiles (T17, SF-19).
 *
 * "Save as automation promotes a selected session sequence into a reviewed
 * proposal without forcing a flow or a run." A proposal is compiled from
 * *trajectory lines*, and a line is only worth compiling if it carries the
 * evidence a binding is made from: the reference acted on, what that element
 * was at the moment it was acted on, and the page it was on.
 *
 * Wave 1 learned this the expensive way in both directions. Capturing a full
 * page snapshot before every call was too much, and removing `describe` and
 * `url` with it was too little — the proposals that came out had steps that
 * could not name what they touched and no bindings at all. So this records the
 * middle: one element description and one URL read, per **mutation** only. An
 * inspection — a snapshot, a read, a check — records nothing, because nobody
 * promotes looking at something.
 *
 * The lines are held in the broker, beside the session, and go when it closes.
 * Nothing is written to disk here: promotion is a thing a person asks for, and
 * a trajectory written whether or not anyone wanted one would be a session log
 * in a project nobody chose.
 */

/**
 * One recorded step, shaped as `@svatah/yam-trajectory`'s `TrajectoryLine`.
 *
 * Structurally rather than by import: this package depends on `schema` and
 * `surface` only (LLD §1), and the trajectory package is module (b)'s. The
 * service validates against the real schema when it compiles, so a drift here
 * is a refused compile rather than a bad proposal.
 */
export interface PromotionStep {
  seq: number;
  at: string;
  call: string;
  intent?: string;
  args?: Record<string, unknown>;
  ref?: string;
  url?: string;
  snapshotHash?: string;
  describe?: unknown;
  result?: unknown;
  error?: string;
}

export interface PromotionStore {
  /** Record one step against a session, numbering it in order. */
  record(sessionId: string, step: Omit<PromotionStep, "seq" | "at"> & { at?: string }): PromotionStep;
  /** Every step this session has taken, in order. */
  list(sessionId: string): readonly PromotionStep[];
  /** Forget a session's steps; called when it closes. */
  clear(sessionId: string): void;
}

export function createPromotionStore(): PromotionStore {
  const bySession = new Map<string, PromotionStep[]>();

  return {
    record(sessionId, step) {
      const steps = bySession.get(sessionId) ?? [];
      const full: PromotionStep = {
        ...step,
        seq: steps.length + 1,
        at: step.at ?? new Date().toISOString(),
      };
      steps.push(full);
      bySession.set(sessionId, steps);
      return full;
    },

    list(sessionId) {
      return bySession.get(sessionId) ?? [];
    },

    clear(sessionId) {
      bySession.delete(sessionId);
    },
  };
}
