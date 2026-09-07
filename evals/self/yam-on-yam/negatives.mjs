/**
 * The cases that must not pass (T18, SF-10, SF-11, SF-13).
 *
 * > a wrong postcondition fails the gate; a stale reference is refused; a held
 * > target refuses the other client.
 *
 * Each is driven through the same public interfaces as the journey, against the
 * same running packaged application. The first is the one worth being careful
 * about: T18's Done says *"a deliberately wrong postcondition fails the gate"*,
 * which means the evidence has to be the check **failing**, not a correct check
 * passing. So both are run — the true one to establish that the subject is
 * readable at all, and the false one to establish that a false answer is a
 * `failed` envelope with `CHECK_FAILED` and a nonzero exit, carrying the value
 * that was actually observed.
 */
import { findNode } from "./journey.mjs";

const failedWith = (answer, code) =>
  (answer?.envelope?.status === "failed" || answer?.envelope?.status === "refused") &&
  answer?.envelope?.error?.code === code;

export async function negativeCases({ driver, connect, record, label }) {
  const check = (name, ok, detail) => record({ pass: label, name, ok, detail });
  const opened = await driver.call("connect", connect);
  const session = opened.envelope?.result?.sessionId;
  if (session === undefined) {
    check("a session opens for the negative cases", false,
      JSON.stringify(opened.envelope?.error ?? {}).slice(0, 200));
    return;
  }

  try {
    const snapshot = await driver.call("snapshot", { session, maxNodes: 600 });

    /* ── 1. A postcondition that holds, then one that does not ───────────── */
    const right = await driver.call("check", {
      session,
      predicate: { kind: "textContains", value: "Surfaces" },
      subject: "page",
    });
    check(
      "a postcondition that holds passes",
      right.envelope?.status === "succeeded",
      JSON.stringify(right.envelope?.error ?? right.envelope?.result ?? {}).slice(0, 200),
    );

    const WRONG = "this text is not on the Surfaces screen";
    const wrong = await driver.call("check", {
      session,
      predicate: { kind: "textContains", value: WRONG },
      subject: "page",
    });
    check(
      "a deliberately wrong postcondition fails, and is not reported as verified",
      failedWith(wrong, "CHECK_FAILED"),
      `status=${wrong.envelope?.status} code=${wrong.envelope?.error?.code} exit=${wrong.exit}`,
    );
    check(
      "the failing postcondition keeps the value it actually observed (SF-11)",
      typeof wrong.envelope?.result?.actual === "string" ||
        typeof wrong.envelope?.error?.message === "string",
      JSON.stringify(wrong.envelope?.result ?? wrong.envelope?.error ?? {}).slice(0, 200),
    );
    if (driver.kind === "cli") {
      check(
        "a wrong postcondition exits nonzero, so a script cannot miss it",
        wrong.exit === 20,
        `exit=${wrong.exit}`,
      );
    }

    /* ── 2. A reference from a snapshot that no longer describes the page ── */
    /*
     * `e999999` was never issued by any snapshot of this session, and the stale
     * snapshot id it is offered with was. SF-10: "stale and cross-session refs
     * must never silently address a different control" — the failure this
     * guards against is a reference resolving to *whatever holds its id now*,
     * which is exactly what wave 3's fifth defect was.
     *
     * Unconditional on purpose. An earlier draft only ran this when a
     * particular button happened to be on screen, and when it was not the case
     * was skipped in silence — which is the one thing T18 says not to do.
     */
    const anchor = snapshot.envelope?.result?.snapshotId;
    await driver.call("snapshot", { session, maxNodes: 20 });
    const refused = await driver.call("describe", {
      session,
      ref: "e999999",
      snapshot: anchor,
    });
    check(
      "a reference nothing issued is refused, not resolved to whatever holds its id",
      failedWith(refused, "STALE_REFERENCE"),
      `status=${refused.envelope?.status} code=${refused.envelope?.error?.code}: ` +
        `${(refused.envelope?.error?.message ?? "").slice(0, 120)}`,
    );

    /* ── 3. Two clients, one target ──────────────────────────────────────── */
    const taken = await driver.call("control", {
      session,
      action: "take",
      holder: "yam-on-yam-agent",
    });
    check("control can be taken explicitly", taken.envelope?.status === "succeeded",
      JSON.stringify(taken.envelope?.result ?? taken.envelope?.error ?? {}).slice(0, 200));

    /*
     * A reference from a snapshot taken *now*, so the refusal under test is the
     * control lease and not a stale reference. An earlier draft reused a
     * reference from before the navigation above and was refused for the wrong
     * reason — a green check that proved nothing about contention.
     */
    const fresh = await driver.call("snapshot", { session, maxNodes: 300 });
    const anyControl = findNode(fresh.envelope, { role: "button" });
    check(
      "there is a control to contend over",
      anyControl !== undefined,
      anyControl === undefined ? "no button on screen" : `ref=${anyControl.ref}`,
    );
    const otherClient = await driver.call("act", {
      session,
      action: "click",
      ref: anyControl?.ref ?? "e1",
      holder: "somebody-else",
    });
    check(
      "a held target refuses the other client, and names who holds it (SF-13)",
      failedWith(otherClient, "CONTROL_BUSY") &&
        `${otherClient.envelope?.error?.message ?? ""}`.includes("yam-on-yam-agent"),
      `${otherClient.envelope?.status}/${otherClient.envelope?.error?.code}: ` +
        `${(otherClient.envelope?.error?.message ?? "").slice(0, 140)}`,
    );

    const released = await driver.call("control", {
      session,
      action: "release",
      holder: "yam-on-yam-agent",
    });
    check("the holder can give it up", released.envelope?.status === "succeeded",
      JSON.stringify(released.envelope?.error ?? {}).slice(0, 160));
  } finally {
    await driver.call("close", { session });
  }
}
