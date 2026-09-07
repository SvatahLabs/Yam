/**
 * The primary journey, performed on the packaged Yam (T18, SF-21).
 *
 * > open Surfaces, connect to the sample app, select a control, fill it,
 * > verify it, close
 *
 * Every step below is an operation of the published catalogue, addressed to a
 * driver that is either `yam surface` or the MCP tools. There is no selector, no
 * `page.click`, no reach into the renderer: a control is chosen by finding it in
 * a **snapshot Yam took**, and acted on by the reference that snapshot gave it.
 * That is the difference between "Yam controls Yam" and "a test framework
 * controls Yam while Yam watches", and it is the distinction wave 3's
 * verification found the driven checks stopping one step short of.
 *
 * Two applications are in play and it is worth being exact about which:
 *
 *   * the **outer** session is Yam driving the packaged Yam;
 *   * the **inner** session is the packaged Yam driving the sample app, opened
 *     by the outer session filling a URL and pressing a button.
 *
 * So "select a control, fill it, verify it" happens twice over — once as the
 * gestures the outer session performs, and once as the thing the inner session
 * is made to do. What is verified at the end is the *inner* result, read off
 * the outer application's own screen.
 */

/**
 * A node of a snapshot, by what it is called — and by its role where that
 * discriminates (T18).
 *
 * The role is a *preference*, not a requirement, and the reason is the whole
 * point of running this journey on two platforms. The same control is described
 * differently by each: the application's own tree lines are
 * `<button aria-pressed>`, which the DOM reports as `button` and which macOS
 * publishes as `checkbox`. A finder that insisted on the DOM's word would have
 * reported "the application does not show its tree" on a platform where it
 * plainly does — a defect in the harness, published as a defect in the product.
 *
 * So: match on role and name if anything does, and on the name alone if
 * nothing does. What a control is *called* is the same on both.
 */
export function findNode(snapshot, { role, name, contains, nth = 0 }) {
  const nodes = snapshot?.result?.nodes ?? [];
  const named = (node) => {
    const label = `${node.name ?? ""}`;
    if (name !== undefined && label !== name) return false;
    if (contains !== undefined && !label.toLowerCase().includes(contains.toLowerCase())) return false;
    return true;
  };
  const withRole = nodes.filter((node) => (role === undefined || node.role === role) && named(node));
  if (withRole[nth] !== undefined) return withRole[nth];
  return nodes.filter(named)[nth];
}

/** Every node whose name contains this, for a message that says what was there. */
export function nodeSummary(snapshot, limit = 40) {
  return (snapshot?.result?.nodes ?? [])
    .slice(0, limit)
    .map((node) => `${node.role} "${node.name ?? ""}" [${node.ref}]`)
    .join(", ");
}

const succeeded = (answer) => answer?.envelope?.status === "succeeded";

/** The codes that mean "the thing you named has been replaced since you looked". */
const REDRAWN = new Set(["STALE_REFERENCE", "CONNECT_FAILED"]);

/**
 * Wait for a control to be on screen, and answer with it and the snapshot it
 * came from.
 *
 * Bounded polling, never a sleep: the condition is that the application shows
 * the thing, and the reason it has to be a condition is peculiar to this suite.
 * **Yam attaching to Yam changes what Yam is showing.** Opening a session puts a
 * row in the broker's session list, and the Surfaces screen draws that list — so
 * the act of connecting makes the window under test re-render, and a snapshot
 * taken a moment before the re-render describes elements that no longer exist.
 */
async function waitFor(driver, session, want, { tries = 20, everyMs = 500, maxNodes = 600 } = {}) {
  let snapshot;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    snapshot = await driver.call("snapshot", { session, maxNodes });
    const node = findNode(snapshot.envelope, want);
    if (node !== undefined) return { node, snapshot };
    await new Promise((done) => setTimeout(done, everyMs));
  }
  return { node: undefined, snapshot };
}

/**
 * Act on a control, finding it as late as possible and once more if the
 * application redrew underneath.
 *
 * A reference is only meaningful while the surface still holds the element it
 * names, and this surface is an application that redraws when the caller
 * connects to it. Taking the snapshot immediately before the act narrows the
 * window; retrying once when the answer is `STALE_REFERENCE` or the adapter's
 * "no longer resolves" closes it. Nothing is weakened: the act still has to
 * succeed, and it still has to be the control this asked for. It is the same
 * thing the product tells a person to do — *Refresh and select again* (SF-17).
 */
async function actOn(driver, session, want, action, args) {
  let last;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { node, snapshot } = await waitFor(driver, session, want, attempt === 0 ? {} : { tries: 4 });
    if (node === undefined) return { answer: last, node: undefined, snapshot };
    last = await driver.call("act", {
      session,
      action,
      ref: node.ref,
      ...(args === undefined ? {} : { args }),
    });
    if (succeeded(last) || !REDRAWN.has(last.envelope?.error?.code)) {
      return { answer: last, node, snapshot };
    }
  }
  return { answer: last, node: undefined };
}

/**
 * Run the journey. `record` takes one check at a time so a pass that stops
 * early still publishes everything it reached — a run that cannot finish is a
 * set of failed checks, never a lost run.
 */
/**
 * Every check this journey makes, in order — so the denominator is the same on
 * every run (SF-21).
 *
 * A pass that stopped early used to record only what it reached, so the run's
 * `attempted` shrank with it: three runs of the same suite on the same machine
 * reported 92, 60 and 65 attempted checks. A count that moves because the
 * subject failed is not a denominator, and "attempted, reached, passed, failed,
 * blocked" is worth nothing if `attempted` means "however far it got".
 *
 * So the list is declared, and whatever is not reached is reported as a failure
 * that says where the pass stopped.
 */
export const JOURNEY_CHECKS = [
  "a session opens on the packaged application",
  "the packaged application opens into Surfaces",
  "the connect form offers a URL to fill",
  "the sample application's URL is typed into it",
  "Connect surface is offered",
  "Connect surface is pressed",
  "the packaged application connects to the sample app and shows its tree",
  "a control of the sample app is selected",
  "selecting a text field opens on Fill field, not a dead end",
  "the fill form asks for a value",
  "a value is typed into the fill form",
  "Fill field is pressed",
  "the application reports the action as dispatched",
  "an action with no postcondition is reported as not verified (SF-11)",
  "Disconnect is offered while a surface is connected",
  "disconnecting returns the application to its connect form",
  "the session closes",
];

export async function primaryJourney({ driver, connect, sampleUrl, record, label }) {
  const made = new Set();
  const check = (name, ok, detail) => {
    made.add(name);
    record({ pass: label, name, ok, detail });
  };
  /** The check the pass got to, for the ones it never reached. */
  let lastReached = "nothing";
  let session;

  try {
    /* 1 — a session on the packaged application, through the public contract. */
    const opened = await driver.call("connect", connect);
    session = opened.envelope?.result?.sessionId;
    check(
      "a session opens on the packaged application",
      succeeded(opened) && typeof session === "string",
      session ?? JSON.stringify(opened.envelope?.error ?? {}).slice(0, 200),
    );
    if (session === undefined) return { reached: false, session };

    /*
     * 2 — the application opened into Surfaces (SF-02, SF-16).
     *
     * Asserted by something **only the Surfaces screen has**, not by the rail.
     * The rail carries a button called "Surfaces" on every screen in the
     * application, so a check that looked for one passed while the window was
     * showing Automations — which is how a run in which the connect form was
     * never on screen still reported "opens into Surfaces".
     */
    const rail = await driver.call("snapshot", { session, interactiveOnly: true, maxNodes: 200 });
    const surfacesRail = findNode(rail.envelope, { role: "button", name: "Surfaces" });
    const { node: urlField, snapshot: full } = await waitFor(driver, session, {
      role: "textbox",
      contains: "URL",
    });
    check(
      "the packaged application opens into Surfaces",
      succeeded(rail) && surfacesRail !== undefined && urlField !== undefined,
      urlField === undefined
        ? `the rail is there and the connect form is not: ${nodeSummary(full?.envelope, 20)}`
        : `rail=${surfacesRail?.ref} connect form=${urlField.ref}`,
    );

    /* 3 — fill the connect form's URL with the sample application. */
    check(
      "the connect form offers a URL to fill",
      urlField !== undefined,
      urlField === undefined ? nodeSummary(full?.envelope, 30) : `ref=${urlField.ref}`,
    );
    if (urlField === undefined) return { reached: false, session };

    const typed = await actOn(driver, session, { role: "textbox", contains: "URL" }, "type", {
      value: sampleUrl,
    });
    check("the sample application's URL is typed into it", succeeded(typed.answer),
      JSON.stringify(typed.answer?.envelope?.result ?? typed.answer?.envelope?.error ?? {}).slice(0, 200));

    /* 4 — press Connect surface, and wait for the inner session to appear. */
    const pressedConnect = await actOn(
      driver,
      session,
      { role: "button", name: "Connect surface" },
      "click",
    );
    check("Connect surface is offered", pressedConnect.node !== undefined,
      pressedConnect.node === undefined
        ? nodeSummary(pressedConnect.snapshot?.envelope, 30)
        : `ref=${pressedConnect.node.ref}`);
    if (pressedConnect.node === undefined) return { reached: false, session };

    check("Connect surface is pressed", succeeded(pressedConnect.answer),
      JSON.stringify(
        pressedConnect.answer?.envelope?.result ?? pressedConnect.answer?.envelope?.error ?? {},
      ).slice(0, 200));

    /*
     * The inner connect launches a browser, which takes seconds. Waited for by
     * asking the application what is on it, never by sleeping: the condition is
     * that its semantic tree — the one the *inner* session produced — is on
     * screen.
     *
     * "The inner one" matters. Both sessions live in the same broker by design
     * (that is what lets a person and an agent share one), so the application's
     * own session list contains the outer session too, and it selects one of
     * them. The condition below is therefore a control **only the sample app
     * has** — its Username field — which no snapshot of Yam's own window
     * contains. A tree of the wrong session cannot satisfy it.
     */
    let connected;
    let treeNode;
    for (let tries = 0; tries < 60 && treeNode === undefined; tries += 1) {
      await new Promise((done) => setTimeout(done, 1000));
      connected = await driver.call("snapshot", { session, maxNodes: 900 });
      treeNode = findNode(connected.envelope, { role: "button", contains: 'textbox "Username"' });
    }
    check(
      "the packaged application connects to the sample app and shows its tree",
      treeNode !== undefined,
      treeNode === undefined
        ? `no tree line for the sample app's Username field; on screen: ${nodeSummary(connected?.envelope, 25)}`
        : `ref=${treeNode.ref}`,
    );
    if (treeNode === undefined) return { reached: false, session };

    /* 5 — select a control of the sample app, in the application's own tree. */
    const selected = await driver.call("act", { session, action: "click", ref: treeNode.ref });
    check("a control of the sample app is selected", succeeded(selected),
      JSON.stringify(selected.envelope?.error ?? {}).slice(0, 200));

    /*
     * The inspector appears after the selection has been round-tripped through
     * `describe`, so it is waited for rather than assumed. Measured: the same
     * check passed when the machine was slow enough and failed when it was not,
     * which is the shape of every flake worth removing.
     */
    let inspector;
    let fillButton;
    for (let tries = 0; tries < 30 && fillButton === undefined; tries += 1) {
      await new Promise((done) => setTimeout(done, 500));
      inspector = await driver.call("snapshot", { session, maxNodes: 900 });
      fillButton = findNode(inspector.envelope, { role: "button", name: "Fill field" });
    }
    check(
      "selecting a text field opens on Fill field, not a dead end",
      fillButton !== undefined,
      fillButton === undefined ? nodeSummary(inspector.envelope, 30) : `ref=${fillButton.ref}`,
    );
    if (fillButton === undefined) return { reached: false, session };

    /* 6 — fill it, through the application's own typed form. */
    const valueField = findNode(inspector.envelope, { role: "textbox", contains: "Value" });
    check("the fill form asks for a value", valueField !== undefined,
      valueField === undefined ? nodeSummary(inspector.envelope, 30) : `ref=${valueField.ref}`);
    if (valueField === undefined) return { reached: false, session };

    const TYPED = "ada";
    const typedValue = await actOn(
      driver,
      session,
      { role: "textbox", contains: "Value" },
      "type",
      { value: TYPED },
    );
    check("a value is typed into the fill form", succeeded(typedValue.answer),
      JSON.stringify(typedValue.answer?.envelope?.error ?? {}).slice(0, 200));

    const acted = await actOn(driver, session, { role: "button", name: "Fill field" }, "click");
    check("Fill field is pressed", succeeded(acted.answer),
      JSON.stringify(acted.answer?.envelope?.error ?? {}).slice(0, 200));

    /* 7 — verify, through the contract's own `check` (SF-11). */
    /*
     * Asked with the `check` operation rather than by reading the tree, for two
     * reasons. It is a first-class operation of the catalogue — SF-11 says
     * read, check, describe and screenshot are as first-class as `act` — and a
     * predicate over the page's text is a question with an answer, where
     * scraping a snapshot for a word is a guess about how a snapshot renders
     * one.
     *
     * What is verified is the *inner* result, read off the outer application's
     * own screen: Yam dispatched an action into an application that dispatched
     * an action into the sample app, and said so.
     */
    const dispatched = async (text) =>
      await driver.call("check", {
        session,
        predicate: { kind: "textContains", value: text },
        subject: "page",
      });

    let saidDispatched;
    for (let tries = 0; tries < 30; tries += 1) {
      saidDispatched = await dispatched("Dispatched");
      if (saidDispatched.envelope?.status === "succeeded") break;
      await new Promise((done) => setTimeout(done, 500));
    }
    check(
      "the application reports the action as dispatched",
      saidDispatched?.envelope?.status === "succeeded",
      JSON.stringify(saidDispatched?.envelope?.result ?? saidDispatched?.envelope?.error ?? {}).slice(0, 200),
    );

    /*
     * And says it is *not* verified, because no postcondition was given. This
     * is SF-11's rule the other way round — "`verified` is true only when an
     * explicit postcondition passed" — and it is worth driving, because a
     * screen that called every dispatch a verification would pass every check
     * above and be wrong about the only thing that matters.
     */
    const notVerified = await dispatched("Not verified — no postcondition was given");
    check(
      "an action with no postcondition is reported as not verified (SF-11)",
      notVerified.envelope?.status === "succeeded",
      JSON.stringify(notVerified.envelope?.result ?? notVerified.envelope?.error ?? {}).slice(0, 200),
    );

    /* 8 — close: the application disconnects its own session (SF-05). */
    /*
     * The journey's own last step, and not a courtesy. "Closing an attached
     * session detaches without closing the user's application" is SF-05, and
     * the way a person does it here is the Disconnect button. It also leaves
     * the application on the screen the next pass starts from — an earlier
     * draft left it connected, and the pass after it found no connect form and
     * reported a defect that was its predecessor's leftovers.
     */
    const beforeClose = await driver.call("snapshot", { session, maxNodes: 900 });
    const disconnect = findNode(beforeClose.envelope, { role: "button", name: "Disconnect" });
    check("Disconnect is offered while a surface is connected", disconnect !== undefined,
      disconnect === undefined ? nodeSummary(beforeClose.envelope, 20) : `ref=${disconnect.ref}`);
    if (disconnect !== undefined) {
      await driver.call("act", { session, action: "click", ref: disconnect.ref });
      let backToConnect;
      for (let tries = 0; tries < 30 && backToConnect === undefined; tries += 1) {
        await new Promise((done) => setTimeout(done, 500));
        const now = await driver.call("snapshot", { session, maxNodes: 900 });
        backToConnect = findNode(now.envelope, { role: "button", name: "Connect surface" });
      }
      check(
        "disconnecting returns the application to its connect form",
        backToConnect !== undefined,
        backToConnect === undefined ? "the connect form did not come back" : `ref=${backToConnect.ref}`,
      );
    }

    return { reached: true, session, typed: TYPED };
  } finally {
    /*
     * Leave the application as this pass found it, whatever happened (T18).
     *
     * The passes share one running application, so a pass that stopped early
     * left it connected — and the pass after it found no connect form and
     * reported *that* as the defect. The disconnect above is the journey's own
     * last step; this is the safety net for the runs that never reach it.
     */
    if (session !== undefined) {
      const state = await driver.call("snapshot", { session, maxNodes: 900 });
      const stillConnected = findNode(state.envelope, { role: "button", name: "Disconnect" });
      if (stillConnected !== undefined) {
        await driver.call("act", { session, action: "click", ref: stillConnected.ref });
      }
      const closed = await driver.call("close", { session });
      check("the session closes", succeeded(closed),
        JSON.stringify(closed.envelope?.error ?? {}).slice(0, 160));
    }

    /*
     * …and every check this journey declares is reported, reached or not, so
     * the denominator is the same on every run (SF-21). One that was never
     * reached is a failure — the pass did not establish it — and it says where
     * the pass stopped, which is the thing a reader needs.
     */
    for (const name of JOURNEY_CHECKS) {
      if (made.has(name)) {
        lastReached = name;
        continue;
      }
      record({
        pass: label,
        name,
        ok: false,
        detail: `not reached: the pass stopped after "${lastReached}"`,
      });
    }
  }
}
