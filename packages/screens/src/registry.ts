/**
 * The action registry (T9.1, REQ-ADE-10, LLD §13.7).
 *
 * > an `Action` is `{ id, label, run(service, args), availableWhen(state), cli }`
 * > and the same list is what the command palette shows, what the SDK exposes as
 * > `actions`, and what the CLI has a command for; the repository check asserts
 * > the three agree by id.
 *
 * This file is that list. There is one of it, and every surface resolves an
 * action from here rather than declaring its own: the app's palette and toolbar
 * buttons, `yam ui`'s palette and single-letter keys, `@svatah/yam-sdk`'s
 * `actions`, and — through `cli` — the command line.
 *
 * ## Why the CLI string is data and not a link
 *
 * The palette shows the command beside the row ("Same list, same names,
 * everywhere", the Palette artboard), and the point of showing it is that
 * someone can type it. So it is written out as a person would type it, with
 * `<angle brackets>` for what the row fills in, and
 * `tools/repo-checks/test/action-parity.test.ts` asserts that the command it
 * names is one the CLI actually dispatches and documents in its usage. An
 * action whose `cli` named a command that does not exist would be a promise the
 * palette cannot keep.
 *
 * ## Actions with no CLI
 *
 * Navigation has none: "Go to run comp" is not a command, and inventing
 * `yam goto` would put a row in LLD §15's table that nobody would ever type.
 * Neither do the three review decisions (accept, re-pick, reject): they answer a
 * `record.decision` event on an open session, which a command line has no way to
 * be holding.
 */
import type { Action, ActionArgs, ActionOutcome, ScreenId, ScreenStateBase } from "./types.js";
import { SCREEN_IDS } from "./types.js";
import type { ScreenService } from "./service.js";
import { DESKTOP_HOLDER } from "./holder.js";
import { agentTestView } from "./screens/surfaces.js";

/** Most actions are available whenever their screen loaded at all. */
const loaded = (state: ScreenStateBase): boolean => state.error === undefined;

/** An action that needs the screen to be about something in particular. */
const has =
  (field: keyof ScreenStateBase | string) =>
  (state: ScreenStateBase): boolean =>
    loaded(state) && (state as unknown as Record<string, unknown>)[field] !== undefined;

/* ────────────────────────────────────────────────────────────────────────────
 * Where a field lives, now that Session has halves (TV-M02, REQ-ADE-14).
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The half of a Session state a field belongs to — or the state itself.
 *
 * Draft 2.27 merged Surfaces and Record into one screen with a `surface` half
 * and a `record` half, and the actions kept their ids. A predicate that read
 * `state.session` before must read `state.surface.session` now, and until
 * TV-M04 removes the old screens both shapes are in flight. So this looks in
 * the half when there is one and at the state when there is not; when the old
 * screens go, the second branch goes with them.
 */
const half = (state: ScreenStateBase, name: "surface" | "record"): Record<string, unknown> => {
  const whole = state as unknown as Record<string, unknown>;
  const part = whole[name];
  return typeof part === "object" && part !== null ? (part as Record<string, unknown>) : whole;
};

/** `has`, against one of Session's halves. */
const hasIn =
  (name: "surface" | "record", field: string) =>
  (state: ScreenStateBase): boolean =>
    loaded(state) && half(state, name)[field] !== undefined;

/** How many sessions the broker is holding, as the loaded state saw it. */
const openSessions = (state: ScreenStateBase): number => {
  const rows = half(state, "surface")["sessions"];
  return Array.isArray(rows) ? rows.length : 0;
};

/**
 * An action that belongs to some of Session's three modes and not the others
 * (REQ-ADE-14, TV-15).
 *
 * A screen with no `mode` is not a screen with modes, and this says nothing
 * about it: the gate is "when this screen has modes, the action belongs to
 * these ones", so an action is never made unavailable by a question that was
 * not asked.
 */
const inMode =
  (...modes: readonly string[]) =>
  (state: ScreenStateBase): boolean => {
    const mode = (state as unknown as Record<string, unknown>)["mode"];
    return typeof mode !== "string" || modes.includes(mode);
  };

/** Both, and in this order: the cheap question first. */
const both =
  (a: (state: ScreenStateBase) => boolean, b: (state: ScreenStateBase) => boolean) =>
  (state: ScreenStateBase): boolean =>
    a(state) && b(state);

const ok = (message: string, extra: Partial<ActionOutcome> = {}): ActionOutcome => ({
  ok: true,
  message,
  ...extra,
});

const refused = (message: string): ActionOutcome => ({ ok: false, message });

/** `{ runId }` off an answer, whatever else came with it. */
const runIdOf = (value: unknown): string | undefined => {
  const id = (value as { runId?: unknown } | undefined)?.runId;
  return typeof id === "string" ? id : undefined;
};

/**
 * A surface `ResultEnvelope`, unwrapped (SF-03).
 *
 * The catalogue's routes answer `{ status, result, error }`. An action reads
 * the outcome from `status` — never from an HTTP code, which the service uses
 * only to say whether it could answer at all — so a refusal reads as a refusal
 * here rather than as a success (the wave-2 defect where refusals exited 0).
 */
const envelopeOf = (
  value: unknown,
): { ok: boolean; result: Record<string, unknown>; message?: string } => {
  const env = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const result =
    typeof env["result"] === "object" && env["result"] !== null
      ? (env["result"] as Record<string, unknown>)
      : {};
  const error = env["error"] as { message?: unknown } | undefined;
  return {
    ok: env["status"] === "succeeded",
    result,
    ...(typeof error?.message === "string" ? { message: error.message } : {}),
  };
};

/**
 * Which of the three targets a typed string is (SF-04).
 *
 * The CLI has `--url`, `--app` and `--attach`; a person typing one line has one
 * line, so the shape decides. A scheme means a URL; `host:port` or a WebSocket
 * means an endpoint to join; anything else is an application's name.
 *
 * The runtime refuses two at once and says why, so a wrong guess here is a
 * refusal with a reason rather than a silent switch — which is what SF-04
 * requires of the broker and therefore of this.
 */
function namedTarget(
  typed: string,
  url: string,
  args: ActionArgs,
): { url: string } | { app: string } | { attach: string } | undefined {
  const explicit = ["url", "app", "attach"] as const;
  for (const name of explicit) {
    const value = args[name];
    if (typeof value === "string" && value.trim() !== "") {
      return { [name]: value.trim() } as { url: string } | { app: string } | { attach: string };
    }
  }
  const text = typed !== "" ? typed : url;
  if (text === "") return undefined;
  if (/^wss?:\/\//i.test(text)) return { attach: text };
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text)) return { url: text };
  if (/^[^\s/]+:\d+(\/\S*)?$/.test(text)) return { attach: text };
  if (/^(localhost|(\d{1,3}\.){3}\d{1,3}|[a-z0-9-]+(\.[a-z0-9-]+)+)(\/\S*)?$/i.test(text)) {
    return { url: `https://${text}` };
  }
  return { app: text };
}

/* ────────────────────────────────────────────────────────────────────────────
 * Actions
 * ──────────────────────────────────────────────────────────────────────────── */

const ACTIONS_ONLY: readonly Action[] = [
  /* ── surfaces: connect, disconnect, recheck (T14, SF-02, SF-04, SF-05) ───── */
  {
    id: "surface.connect",
    label: "Connect surface",
    group: "Actions",
    screen: "session",
    cli: "yam surface connect [--url <url> | --app <name> | --attach <endpoint>]",
    /*
     * The target, asked for rather than assumed (SF-04).
     *
     * This refused with "Enter a URL to connect to" and no renderer had anywhere
     * to enter one: the cockpit's only typing line belonged to say mode, so `c`
     * produced that refusal every time. The parity checks passed the whole while
     * — a key that reliably refuses is still reachable.
     *
     * And a URL was never the only answer. The runtime takes exactly one of
     * three (`surface-control/src/dispatcher.ts`): a URL launches a browser, an
     * endpoint joins one already running, a name drives an application already
     * running. The old copy promised "a browser, app, device or API" for a field
     * that accepted the first only.
     */
    /*
     * Connecting is Do's subject (REQ-ADE-14, P-W2-F9).
     *
     * It was offered in every mode, and in Record it was a dead end: the session
     * it makes is stored as `selected`, which is what the surface half reads,
     * while the record half reads `sessionId`. So pressing Connect on the Record
     * screen opened a browser and left the pane saying "No session" — the mode
     * did not change, but the result was only visible in another one, which is
     * indistinguishable from being sent there.
     *
     * And a surface session cannot become a recording one: `record.start` posts
     * a flow and a gateway and gets its own session back. Joining the two is a
     * runtime change, not a view one.
     */
    modes: ["do"],
    needs: [
      {
        name: "target",
        label: "URL, application name, or endpoint",
        placeholder: "https://example.com",
        /* The three the CLI has and the app's form already sends. */
        satisfiedBy: ["url", "app", "attach"],
      },
    ],
    availableWhen: loaded,
    async run(service, args): Promise<ActionOutcome> {
      const target = typeof args["target"] === "string" ? args["target"].trim() : "";
      const url = typeof args.url === "string" ? args.url.trim() : "";
      const named = namedTarget(target, url, args);
      if (named === undefined) {
        return refused(
          "Name a target: a URL launches a browser, an endpoint joins one already " +
            "running, an application name drives one already running.",
        );
      }
      const adapter = typeof args.adapter === "string" && args.adapter !== "" ? args.adapter : undefined;
      /*
       * Visible unless asked otherwise (SF-04, TV-A09).
       *
       * The runtime has taken `headed` since the adapter factory was written —
       * `headless: options?.headed !== true` — and neither renderer offered it,
       * so a person driving a browser from the Session screen was driving one
       * they could not see. Headless is right for `yam run` in CI, which is a
       * different code path with its own `--headed`; it is the wrong default for
       * the one screen whose whole subject is watching.
       */
      const headed = args["headed"] === undefined ? true : args["headed"] === true || args["headed"] === "true";
      const answer = await service.postSessions({
        ...named,
        headed,
        ...(adapter === undefined ? {} : { adapter }),
      });
      const { ok: succeeded, result, message } = envelopeOf(answer);
      if (!succeeded) {
        // The service's own reason, not one invented here (SF-04, SF-17): a
        // missing adapter, an unreachable host, a refused connection.
        return refused(message ?? "Could not connect.");
      }
      const sessionId = typeof result["sessionId"] === "string" ? result["sessionId"] : undefined;
      // The adapter the service *used*, never the one asked for (SF-04).
      const used = typeof result["adapter"] === "string" ? result["adapter"] : (adapter ?? "the default adapter");
      return ok(`Connected with the ${used} adapter${headed ? ", and the window is visible" : " (no window)"}.`, {
        value: answer,
        goTo: "session",
        /*
         * `mode: "do"` with it: the palette can run this from any mode, and a
         * connected surface is only visible in one. Landing a person where the
         * thing they just made is beats leaving them on a pane that says
         * nothing happened.
         */
        params: { mode: "do", ...(sessionId === undefined ? {} : { selected: sessionId }) },
      });
    },
  },
  {
    id: "surface.disconnect",
    label: "Disconnect",
    group: "Actions",
    screen: "session",
    cli: "yam surface close --session <id>",
    /*
     * Wherever a session is open, in every mode (`AX-03`, `B7`).
     *
     * This read `hasIn("surface", "selected")`, and `selected` is a *screen
     * parameter* set by picking a row in the Open sessions list — a list that
     * only the **do** mode draws. So in record mode, with a browser open and
     * nothing else able to close it, Disconnect was a disabled button. That is
     * how the owner came to kill a browser by hand.
     *
     * A session being open is a fact about the broker, not about what a person
     * has clicked. When exactly one is open the action does not need to be told
     * which; when more than one is, it says so rather than guessing.
     */
    availableWhen: (state) =>
      loaded(state) &&
      (half(state, "surface")["selected"] !== undefined ||
        half(state, "record")["sessionId"] !== undefined ||
        /*
         * Exactly one, not "at least one".
         *
         * "At least one" made the button live whenever the broker held
         * anything, and with two open and neither chosen it could only refuse —
         * which is the *Reachable* property this specification opens with:
         * "no enabled-looking control refuses". One session needs no choosing;
         * more than one is chosen in Do's session list, and until it is, this
         * has nothing to act on.
         */
        openSessions(state) === 1),
    async run(service, args): Promise<ActionOutcome> {
      let session =
        typeof args.selected === "string"
          ? args.selected
          : typeof args["sessionId"] === "string"
            ? args["sessionId"]
            : undefined;
      if (session === undefined) {
        const open = await service.getSessions();
        const rows = envelopeOf(open).result["sessions"];
        const ids = (Array.isArray(rows) ? rows : [])
          .map((one) => (one as { sessionId?: unknown }).sessionId)
          .filter((one): one is string => typeof one === "string");
        if (ids.length === 0) return refused("Nothing is connected.");
        if (ids.length > 1) {
          return refused(
            `${String(ids.length)} sessions are open. Choose one under Open sessions in Do, then press Disconnect.`,
          );
        }
        session = ids[0];
      }
      const answer = await service.deleteSessionsBySession(session!);
      const { ok: succeeded, message } = envelopeOf(answer);
      if (!succeeded) return refused(message ?? "Could not disconnect.");
      // Back to Surfaces with nothing selected: the session is gone.
      return ok("Disconnected.", { value: answer, goTo: "session", params: { selected: undefined } });
    },
  },
  {
    id: "surface.discover",
    label: "Recheck targets",
    group: "Actions",
    screen: "session",
    cli: "yam surface targets",
    /* listing what there is to connect to is part of connecting. */
    modes: ["do"],
    availableWhen: loaded,
    async run(service): Promise<ActionOutcome> {
      // Reads discovery again; the reload the shell does after an action is
      // what refreshes the screen, so this only reports what it found.
      const answer = await service.getTargets();
      const { ok: succeeded, result, message } = envelopeOf(answer);
      if (!succeeded) return refused(message ?? "Could not reach the surface broker.");
      const adapters = Array.isArray(result["adapters"]) ? result["adapters"] : [];
      const ready = adapters.filter((one) => (one as { available?: unknown }).available === true).length;
      return ok(`${ready} of ${adapters.length} adapters ready.`, { value: answer, goTo: "session" });
    },
  },
  /* ── T15: the selected-target action inspector (SF-09, SF-10, SF-11) ────── */
  {
    id: "surface.act",
    label: "Perform the action",
    group: "Actions",
    screen: "session",
    cli: "yam surface act --session <id> --action <action> --ref <ref>",
    // Not on an HTTP surface: its `act` refuses everything, so offering it
    // would be the dead end T15 exists to remove. That surface has `request`.
    modes: ["do"],
    availableWhen: both(inMode("do"), (state) => {
      const surface = half(state, "surface");
      return surface["session"] !== undefined && surface["httpSurface"] !== true;
    }),
    async run(service, args): Promise<ActionOutcome> {
      const session = typeof args.selected === "string" ? args.selected : undefined;
      if (session === undefined) return refused("Choose a surface first.");
      const action = typeof args.action === "string" ? args.action : undefined;
      if (action === undefined) return refused("Choose an action.");

      /*
       * Dispatch and verification are two phases (SF-11).
       *
       * The act says the action reached the target. It does *not* say the
       * intended outcome happened — only an explicit postcondition can, so
       * `verified` comes from a separate `check` and is false without one.
       */
      const act = await service.postSessionsBySessionAct(session, {
        action,
        // Named, so a target this desktop took is one it can still act on: the
        // broker refuses a mutation from anyone but the holder (SF-13).
        holder: DESKTOP_HOLDER,
        ...(typeof args.ref === "string" ? { ref: args.ref } : {}),
        ...(typeof args["ref2"] === "string" ? { ref2: args["ref2"] } : {}),
        ...(typeof args["snapshot"] === "string" ? { snapshot: args["snapshot"] } : {}),
        ...(args["args"] === undefined ? {} : { args: args["args"] }),
      });
      const dispatched = envelopeOf(act);
      if (!dispatched.ok) {
        // The service's own reason and its domain code, so the screen can put
        // the inspector into the right SF-17 state with the right way out.
        return { ok: false, message: dispatched.message ?? "The action was refused.", value: { act } };
      }

      const verify = args["verify"];
      let check: unknown;
      if (typeof verify === "object" && verify !== null) {
        const predicate = verify as { kind?: unknown; value?: unknown; name?: unknown };
        if (typeof predicate.kind === "string" && predicate.kind !== "") {
          check = await service.postSessionsBySessionCheck(session, {
            predicate: {
              kind: predicate.kind,
              ...(predicate.value === undefined ? {} : { value: String(predicate.value) }),
              ...(predicate.name === undefined ? {} : { name: String(predicate.name) }),
            },
            subject: typeof args.ref === "string" ? "ref" : "page",
            ...(typeof args.ref === "string" ? { ref: args.ref } : {}),
          });
        }
      }

      const verified = check !== undefined && envelopeOf(check).ok && envelopeOf(check).result["ok"] === true;
      const message =
        check === undefined
          ? "Dispatched. Not verified — no postcondition was given."
          : verified
            ? "Dispatched and verified."
            : "Dispatched, but the postcondition did not hold.";
      return ok(message, { value: { act, ...(check === undefined ? {} : { check }) } });
    },
  },
  {
    id: "surface.check",
    label: "Check the surface",
    group: "Actions",
    screen: "session",
    cli: "yam surface check --session <id> --input <file.json>",
    modes: ["do"],
    availableWhen: both(inMode("do"), hasIn("surface", "session")),
    async run(service, args): Promise<ActionOutcome> {
      const session = typeof args.selected === "string" ? args.selected : undefined;
      if (session === undefined) return refused("Choose a surface first.");
      const verify = args["verify"];
      const predicate = (typeof verify === "object" && verify !== null ? verify : {}) as {
        kind?: unknown;
        value?: unknown;
      };
      if (typeof predicate.kind !== "string" || predicate.kind === "") {
        return refused("Choose what to check.");
      }
      const check = await service.postSessionsBySessionCheck(session, {
        predicate: {
          kind: predicate.kind,
          ...(predicate.value === undefined ? {} : { value: String(predicate.value) }),
        },
        subject: typeof args.ref === "string" ? "ref" : "page",
        ...(typeof args.ref === "string" ? { ref: args.ref } : {}),
      });
      const answer = envelopeOf(check);
      if (!answer.ok) return { ok: false, message: answer.message ?? "The check could not run.", value: { act: check } };
      const held = answer.result["ok"] === true;
      return ok(held ? "The postcondition holds." : "The postcondition does not hold.", {
        // Shaped like an act outcome so one view renders both (SF-11).
        value: { act: check, check },
      });
    },
  },
  {
    id: "surface.read",
    label: "Read a value",
    group: "Actions",
    screen: "session",
    cli: "yam surface read --session <id> --kind text --ref <ref>",
    modes: ["do"],
    availableWhen: both(inMode("do"), hasIn("surface", "session")),
    async run(service, args): Promise<ActionOutcome> {
      const session = typeof args.selected === "string" ? args.selected : undefined;
      if (session === undefined) return refused("Choose a surface first.");
      const kind = typeof args["kind"] === "string" ? args["kind"] : "text";
      const answer = await service.postSessionsBySessionRead(session, {
        kind,
        ...(typeof args.ref === "string" ? { ref: args.ref } : {}),
      });
      const read = envelopeOf(answer);
      if (!read.ok) return { ok: false, message: read.message ?? "Nothing could be read.", value: { act: answer } };
      return ok(`${kind}: ${String(read.result["value"] ?? "")}`, { value: { act: answer } });
    },
  },
  {
    id: "surface.refresh",
    label: "Refresh and select again",
    group: "Actions",
    screen: "session",
    cli: "yam surface snapshot --session <id>",
    /* a fresh snapshot is what those two modes act on. */
    modes: ["do", "say"],
    availableWhen: hasIn("surface", "session"),
    async run(_service, args): Promise<ActionOutcome> {
      /*
       * The way out of a stale reference (SF-17). The screen re-loads with the
       * selection cleared, which takes a fresh bounded snapshot — so the tree is
       * what is there now and nothing is holding a reference to what was.
       */
      return ok("Took a fresh snapshot; choose a control.", {
        goTo: "session",
        params: {
          selected: typeof args.selected === "string" ? args.selected : undefined,
          ref: undefined,
          snapshot: undefined,
        },
      });
    },
  },
  {
    id: "surface.preview",
    label: "Show or hide the preview",
    group: "Actions",
    screen: "session",
    cli: "yam surface screenshot --session <id> --path <file.png>",
    /* a picture of what the Do mode's tree is a tree of. */
    modes: ["do"],
    /*
     * Only where a picture can be both taken and drawn (T15): a session that is
     * not an HTTP one, which has nothing to look at, and a client that can
     * fetch bytes. The cockpit's cannot, so there this is greyed with a reason
     * rather than a key that changes nothing on the screen.
     */
    availableWhen: both(inMode("do"), (state) => {
      const surface = half(state, "surface");
      return (
        surface["session"] !== undefined && surface["httpSurface"] !== true && surface["previewable"] === true
      );
    }),
    async run(service, args): Promise<ActionOutcome> {
      const session = typeof args.selected === "string" ? args.selected : undefined;
      if (session === undefined) return refused("Choose a surface first.");
      if (service.sessionScreenshot === undefined) {
        return refused(
          "This client cannot draw a picture of the surface. `yam surface screenshot --session <id> --path <file.png>` writes one to a file.",
        );
      }
      /*
       * `show` when a control says which, else the other of what is showing:
       * the palette row is one row for both, and the app's checkbox knows the
       * state it is asking for.
       */
      const show = typeof args["show"] === "boolean" ? args["show"] : args.preview !== true;
      /*
       * The load takes the picture, not this: straight after the snapshot its
       * boxes are hit-tested against, and again on every load after, so what is
       * drawn is never older than the tree beside it.
       */
      return ok(
        show
          ? "Showing a picture of the surface beside the tree. Pointing at a control selects it; nothing is clicked in the application."
          : "Preview hidden. The tree is the whole surface.",
        { goTo: "session", params: { selected: session, preview: show } },
      );
    },
  },
  /* ── T16: shared control, and the agent that shares it (SF-05, SF-13) ────── */
  {
    id: "surface.take-control",
    label: "Take control",
    group: "Actions",
    screen: "session",
    cli: "yam surface control --session <id> --take",
    availableWhen: (state) => {
      const session = half(state, "surface")["session"] as { heldByYou?: boolean } | undefined;
      return session !== undefined && session.heldByYou !== true;
    },
    async run(service, args): Promise<ActionOutcome> {
      const session = typeof args.selected === "string" ? args.selected : undefined;
      if (session === undefined) return refused("Choose a surface first.");
      /*
       * `force` is the explicit handoff (SF-13): a person taking a target an
       * agent has not given up. It is what a person means by pressing this, and
       * the previous holder is told rather than quietly displaced.
       */
      const answer = await service.postSessionsBySessionControl(session, {
        action: "take",
        holder: DESKTOP_HOLDER,
        force: true,
      });
      const { ok: succeeded, result, message } = envelopeOf(answer);
      if (!succeeded) return refused(message ?? "Could not take control.");
      return ok(`You control this target${result["holder"] === undefined ? "" : ""}.`, {
        value: answer,
        goTo: "session",
        params: { selected: session },
      });
    },
  },
  {
    id: "surface.release-control",
    label: "Give up control",
    group: "Actions",
    screen: "session",
    cli: "yam surface control --session <id> --release",
    availableWhen: (state) =>
      (half(state, "surface")["session"] as { heldByYou?: boolean } | undefined)?.heldByYou === true,
    async run(service, args): Promise<ActionOutcome> {
      const session = typeof args.selected === "string" ? args.selected : undefined;
      if (session === undefined) return refused("Choose a surface first.");
      const answer = await service.postSessionsBySessionControl(session, {
        action: "release",
        holder: DESKTOP_HOLDER,
      });
      const { ok: succeeded, message } = envelopeOf(answer);
      if (!succeeded) return refused(message ?? "Could not give up control.");
      return ok("Anyone can drive this target now.", {
        value: answer,
        goTo: "session",
        params: { selected: session },
      });
    },
  },
  {
    id: "surface.test-agent",
    label: "Test the connection",
    group: "Actions",
    screen: "session",
    cli: "yam surface targets",
    /* the agent's link to the surface is the Do mode's subject. */
    modes: ["do"],
    availableWhen: loaded,
    async run(service): Promise<ActionOutcome> {
      /*
       * Two things, each checked for what it is (T16, SF-07).
       *
       * The broker an agent would share, which is what makes the copied
       * configuration reach the same sessions. And the server that
       * configuration names, spoken to over MCP: the service starts it —
       * a renderer cannot spawn a process — completes `initialize`, sends
       * `notifications/initialized`, lists its tools and stops it. The command
       * is fixed in the service and never taken from here (SF-15), and no tool
       * is called, so the answer says nothing about a surface it did not touch.
       */
      const broker = await service.getTargets();
      const brokerAnswer = envelopeOf(broker);
      if (service.postAgentsTest === undefined) {
        if (!brokerAnswer.ok) return refused(brokerAnswer.message ?? "The surface broker did not answer.");
        const adapters = Array.isArray(brokerAnswer.result["adapters"]) ? brokerAnswer.result["adapters"] : [];
        return ok(
          `The broker answered with ${adapters.length} adapters. An agent using this configuration reaches the same sessions. This service cannot start an MCP server, so no handshake was tried.`,
          { value: { broker } },
        );
      }
      let handshake: unknown;
      try {
        handshake = await service.postAgentsTest();
      } catch (cause) {
        // The route itself failing is a handshake that was never attempted.
        handshake = {
          ok: false,
          stage: "request",
          message: cause instanceof Error ? cause.message : String(cause),
        };
      }
      const view = agentTestView({ broker, handshake });
      return {
        ok: view?.ok === true,
        message: (view?.checks ?? ["The connection test answered with nothing."]).join(" "),
        value: { broker, handshake },
      };
    },
  },
  {
    id: "surface.save-automation",
    label: "Save as automation",
    group: "Actions",
    screen: "session",
    cli: "yam trajectory compile <trajectory.jsonl>",
    /* a trajectory becomes a flow, which is what recording makes. */
    modes: ["record"],
    availableWhen: hasIn("surface", "session"),
    async run(service, args): Promise<ActionOutcome> {
      const session = typeof args.selected === "string" ? args.selected : undefined;
      if (session === undefined) return refused("Choose a surface first.");

      /*
       * Promote what the session *did*, read from the broker (SF-19).
       *
       * Not what this client believes it asked for: the steps come back with
       * the element each action touched and the page it was on, which is what a
       * binding is made from. A session that has only been looked at has no
       * steps, and says so rather than writing an empty proposal.
       */
      const answer = await service.getSessionsBySessionEvents(session);
      const { ok: succeeded, result, message } = envelopeOf(answer);
      if (!succeeded) return refused(message ?? "Could not read what this session did.");
      const steps = Array.isArray(result["steps"]) ? result["steps"] : [];
      if (steps.length === 0) {
        return refused(
          "Nothing to promote yet: this session has been looked at, not acted on. Perform an action first.",
        );
      }
      /*
       * No project, no proposal (T14, T17). The app's private workspace loads
       * like a project — it is an empty directory the service can compile
       * into — so without this the promotion "succeeded" into a directory
       * under the app's own data that nobody chose and nobody would find.
       * The shell says whether a project is open; the desktop is the only
       * client that can be projectless.
       */
      if (args["projectless"] === true) {
        return refused(
          "A proposal is written into a project, and none is open. Choose one with “Open a project”, then save again.",
        );
      }

      /*
       * A proposal is written into a *project* — `proposals/` lives in one —
       * and Surfaces works without one. So a promotion with no project open
       * says which thing is missing and where to fix it, rather than surfacing
       * the loader's error (SF-17: every state names its next action).
       */
      let compiled: unknown;
      try {
        compiled = await service.postTrajectoryCompile({
          lines: steps,
          ...(typeof args["name"] === "string" ? { name: args["name"] } : {}),
        });
      } catch {
        return refused(
          "A proposal is written into a project, and none is open. Choose one with “Open a project”, then save again.",
        );
      }
      const dir = (compiled as { dir?: unknown })?.dir;
      return ok(
        `Wrote a proposal from ${steps.length} step(s)${typeof dir === "string" ? ` to ${dir}` : ""}. Every binding in it is unverified until you review it.`,
        { value: compiled },
      );
    },
  },
  {
    id: "surface.request",
    label: "Send the request",
    group: "Actions",
    screen: "session",
    cli: "yam surface request --session <id> --url <url>",
    // Only an HTTP surface has this form; the model says which is which.
    modes: ["do"],
    availableWhen: both(inMode("do"), (state) => half(state, "surface")["httpSurface"] === true),
    async run(service, args): Promise<ActionOutcome> {
      const session = typeof args.selected === "string" ? args.selected : undefined;
      if (session === undefined) return refused("Choose a surface first.");
      const url = typeof args["url"] === "string" ? args["url"].trim() : "";
      if (url === "") return refused("Enter a URL or a path to request.");
      const method = (typeof args["method"] === "string" ? args["method"] : "GET").toUpperCase();
      const answer = await service.postSessionsBySessionRequest(session, {
        request: { name: "request", method, url },
        holder: DESKTOP_HOLDER,
      });
      const sent = envelopeOf(answer);
      if (!sent.ok) return { ok: false, message: sent.message ?? "The request could not be sent.", value: { act: answer } };
      const response = sent.result["response"] as { status?: unknown } | undefined;
      return ok(`${method} ${url} → ${String(response?.status ?? "?")}`, { value: { act: answer } });
    },
  },
  {
    id: "flows.compile",
    label: "Compile",
    group: "Actions",
    screen: "flows",
    cli: "yam compile",
    availableWhen: loaded,
    async run(service: ScreenService): Promise<ActionOutcome> {
      const value = await service.postCompile();
      const errors = (value as { errors?: unknown[] }).errors ?? [];
      const warnings = (value as { warnings?: unknown[] }).warnings ?? [];
      return ok(`Compiled: ${errors.length} error(s), ${warnings.length} warning(s).`, { value });
    },
  },
  {
    id: "flows.save",
    label: "Save flow",
    group: "Actions",
    screen: "flows",
    // `PUT /flows/:file` writes the file the CLI reads; from a terminal you
    // would use an editor, which is what `yam ui`'s `e` key opens.
    availableWhen: has("file"),
    async run(service, args): Promise<ActionOutcome> {
      if (typeof args.file !== "string") return refused("No flow file is open.");
      if (typeof args["text"] !== "string") return refused("Nothing to save.");
      /*
       * The *name*, not the project-relative path (K6, T11.1).
       *
       * `/flows/:file` is rooted at the project's flows directory and joins
       * what it is given to it, so `flows/simple.flow` asked for
       * `flows/flows/simple.flow` — and the generated client encodes the
       * separator, so the route did not even match. `load()` has always sent
       * the basename to `GET`; this is the same unit, which is why the read
       * worked and the write did not.
       */
      const name = args.file.split("/").pop() ?? args.file;
      const value = await service.putFlowsByFile(name, args["text"]);
      return ok(`Saved ${args.file}.`, { value });
    },
  },
  {
    id: "run.flow",
    label: "Run",
    group: "Actions",
    screen: "flows",
    cli: "yam run --flow <file>",
    availableWhen: loaded,
    async run(service, args): Promise<ActionOutcome> {
      const value = await service.postRun(
        typeof args.file === "string" ? { flows: [args.file] } : {},
      );
      const runId = runIdOf(value);
      return ok(runId === undefined ? "Started a run." : `Started run ${runId}.`, {
        value,
        goTo: "run",
        ...(runId === undefined ? {} : { params: { runId } }),
      });
    },
  },
  {
    id: "run.story",
    label: "Run story",
    group: "Actions",
    screen: "flows",
    cli: "yam run --story <name>",
    availableWhen: loaded,
    async run(service, args): Promise<ActionOutcome> {
      if (typeof args.story !== "string") return refused("No story is selected.");
      const value = await service.postRun({ stories: [args.story] });
      const runId = runIdOf(value);
      return ok(`Started run ${runId ?? "?"} for “${args.story}”.`, {
        value,
        goTo: "run",
        ...(runId === undefined ? {} : { params: { runId } }),
      });
    },
  },
  {
    id: "run.again",
    label: "Run again",
    group: "Actions",
    screen: "run",
    cli: "yam run --flow <file>",
    availableWhen: loaded,
    async run(service, args): Promise<ActionOutcome> {
      const value = await service.postRun(
        typeof args.file === "string" ? { flows: [args.file] } : {},
      );
      const runId = runIdOf(value);
      return ok(`Started run ${runId ?? "?"}.`, {
        value,
        goTo: "run",
        ...(runId === undefined ? {} : { params: { runId } }),
      });
    },
  },
  {
    id: "run.resume",
    label: "Resume from step",
    group: "Actions",
    screen: "run",
    cli: "yam run --resume <runId> --from <stepId>",
    availableWhen: has("resumeFrom"),
    async run(service, args): Promise<ActionOutcome> {
      if (typeof args.runId !== "string") return refused("No run is selected.");
      const from = args["from"];
      if (typeof from !== "string") return refused("No step to resume from.");
      const value = await service.postRun({ resume: args.runId, from });
      return ok(`Resumed ${args.runId} from ${from}.`, { value, goTo: "run" });
    },
  },
  /**
   * Record a flow by doing it (REQ-REC-13, Draft 2.23).
   *
   * This is what "Record" means, here as at the command line: the browser opens
   * at the application, the person drives, and the flow is written from what
   * they did. Binding the targets of a flow that already exists is the *other*
   * action below, and it says so.
   */
  {
    id: "capture.start",
    label: "Record",
    group: "Actions",
    screen: "flows",
    cli: "yam record",
    availableWhen: loaded,
    async run(service, args): Promise<ActionOutcome> {
      const value = await service.postCapture({
        ...(typeof args["name"] === "string" ? { name: args["name"] } : {}),
      });
      const sessionId = (value as { sessionId?: unknown }).sessionId;
      return ok("Recording what you do. Drive the application, then press Stop.", {
        value,
        goTo: "session",
        /*
         * The mode with the session (REQ-ADE-14). Session opens in `do`, and a
         * capture that landed there would be recording into a screen showing a
         * snapshot tree — the right session, the wrong subject.
         */
        params: {
          mode: "record",
          ...(typeof sessionId === "string" ? { sessionId, capturing: true } : {}),
        },
      });
    },
  },
  {
    id: "capture.stop",
    label: "Stop recording",
    group: "Actions",
    screen: "session",
    // No `cli`: at a terminal a capture ends with Enter, which is not a command.
    modes: ["record"],
    availableWhen: both(inMode("record"), hasIn("record", "sessionId")),
    async run(service, args): Promise<ActionOutcome> {
      if (typeof args.sessionId !== "string") return refused("No recording session is open.");
      // The flow is written on the way out, so this is how a capture finishes.
      const value = await service.postCaptureByIdStop(args.sessionId);
      return ok("Stopping; the flow and its bindings are being written.", { value });
    },
  },
  {
    id: "record.start",
    label: "Bind targets",
    group: "Actions",
    screen: "flows",
    cli: "yam record --flow <file>",
    availableWhen: loaded,
    async run(service, args): Promise<ActionOutcome> {
      const value = await service.postRecord({
        ...(typeof args.file === "string" ? { flows: [args.file] } : {}),
        ...(typeof args["gateway"] === "string" ? { gateway: args["gateway"] } : {}),
      });
      const sessionId = (value as { sessionId?: unknown }).sessionId;
      return ok(`Recording session ${String(sessionId ?? "?")} started.`, {
        value,
        goTo: "session",
        /* Binding a written flow is the record mode's other half (REQ-REC-13). */
        params: { mode: "record", ...(typeof sessionId === "string" ? { sessionId } : {}) },
      });
    },
  },
  {
    id: "record.accept",
    label: "Accept",
    group: "Actions",
    screen: "session",
    modes: ["record"],
    availableWhen: both(inMode("record"), hasIn("record", "decision")),
    async run(service, args): Promise<ActionOutcome> {
      if (typeof args.sessionId !== "string") return refused("No recording session is open.");
      // `{ accept: true }` is the body `POST /record/:id/decision` takes; a
      // body it does not understand is read as a *rejection*, which stops the
      // session — so the shape is the service's, not a word of our own.
      const value = await service.postRecordByIdDecision(args.sessionId, { accept: true });
      return ok("Accepted the grounding.", { value });
    },
  },
  {
    id: "record.repick",
    label: "Re-pick",
    group: "Actions",
    screen: "session",
    modes: ["record"],
    availableWhen: both(inMode("record"), hasIn("record", "decision")),
    async run(service, args): Promise<ActionOutcome> {
      if (typeof args.sessionId !== "string") return refused("No recording session is open.");
      const ref = args["ref"];
      if (typeof ref !== "string") return refused("Pick an element in the driven session first.");
      const value = await service.postRecordByIdDecision(args.sessionId, { repick: ref });
      return ok(`Re-picked ${ref}.`, { value });
    },
  },
  {
    id: "record.reject",
    label: "Reject",
    group: "Actions",
    screen: "session",
    modes: ["record"],
    availableWhen: both(inMode("record"), hasIn("record", "decision")),
    async run(service, args): Promise<ActionOutcome> {
      if (typeof args.sessionId !== "string") return refused("No recording session is open.");
      const value = await service.postRecordByIdDecision(args.sessionId, {
        accept: false,
        ...(typeof args["why"] === "string" ? { why: args["why"] } : {}),
      });
      return ok("Rejected the grounding.", { value });
    },
  },
  {
    id: "record.stop",
    label: "Stop recording",
    group: "Actions",
    screen: "session",
    modes: ["record"],
    availableWhen: both(inMode("record"), hasIn("record", "sessionId")),
    async run(service, args): Promise<ActionOutcome> {
      if (typeof args.sessionId !== "string") return refused("No recording session is open.");
      const value = await service.postRecordByIdStop(args.sessionId);
      return ok("Stopped the recording session.", { value });
    },
  },
  {
    id: "run.stop",
    label: "Stop",
    group: "Actions",
    screen: "run",
    /*
     * No CLI command (Draft 2.12 §13.5, T10.4).
     *
     * `yam run` is the run: stopping it from a terminal is `^C`, which is
     * not a command anyone types into a palette. What the route exists for is a
     * run somebody started from a *screen* and can no longer reach with a
     * keyboard interrupt — the app's and the cockpit's.
     */
    availableWhen: (state) => (state as { live?: boolean }).live === true,
    async run(service, args): Promise<ActionOutcome> {
      if (typeof args.runId !== "string") return refused("No run is selected.");
      const value = await service.postRunsByIdStop(args.runId);
      return ok(
        `Stopping run ${args.runId}. The step under way finishes; the rest are skipped.`,
        { value },
      );
    },
  },
  {
    id: "heal.run",
    label: "Heal",
    group: "Actions",
    screen: "run",
    cli: "yam heal --run <id>",
    availableWhen: loaded,
    async run(service, args): Promise<ActionOutcome> {
      if (typeof args.runId !== "string") return refused("No run is selected.");
      const value = await service.postHeal({ runId: args.runId });
      return ok(`Healing run ${args.runId}.`, { value, goTo: "heal", params: { runId: args.runId } });
    },
  },
  {
    id: "heal.bind-failures",
    label: "Heal from bind failures",
    group: "Actions",
    screen: "heal",
    cli: "yam heal --from-bind-failures",
    availableWhen: loaded,
    async run(service): Promise<ActionOutcome> {
      const value = await service.postHeal({ fromBindFailures: true });
      return ok("Healing from the recorded bind failures.", { value, goTo: "heal" });
    },
  },
  {
    id: "heal.apply",
    label: "Apply proposal",
    group: "Actions",
    screen: "heal",
    availableWhen: has("proposal"),
    async run(service, args): Promise<ActionOutcome> {
      if (typeof args.runId !== "string") return refused("No heal is selected.");
      const value = await service.postHeal({ runId: args.runId, apply: true });
      return ok("Applied the proposal to the bindings store.", { value });
    },
  },
  {
    id: "bindings.verify",
    label: "Verify all bindings",
    group: "Actions",
    screen: "bindings",
    cli: "yam bindings verify",
    availableWhen: loaded,
    async run(service, args): Promise<ActionOutcome> {
      const value = await service.postBindingsVerify(
        typeof args.bindingId === "string" ? { id: args.bindingId } : {},
      );
      return ok("Dry-resolved the bindings store.", { value });
    },
  },
  {
    id: "bindings.prune",
    label: "Prune unused bindings",
    group: "Actions",
    screen: "bindings",
    cli: "yam bindings prune",
    // Nothing on the service prunes: `yam bindings prune` writes the store
    // directly, and LLD §13.5 has no route for it. The palette shows the
    // command rather than pretending there is a button that runs it.
    availableWhen: () => false,
    async run(): Promise<ActionOutcome> {
      return refused("Run `yam bindings prune` from a terminal; the service has no route for it.");
    },
  },
  {
    id: "api.send",
    label: "Send request",
    group: "Actions",
    screen: "api",
    availableWhen: loaded,
    async run(service, args): Promise<ActionOutcome> {
      const request = args["request"];
      if (request === undefined) return refused("Nothing to send.");
      const value = await service.postApiRequest(request);
      return ok("Sent the request.", { value });
    },
  },
  {
    id: "api.save",
    label: "Save request",
    group: "Actions",
    screen: "api",
    /*
     * `PUT /api/:name` writes `api/<name>.yaml`, which is the file the CLI's
     * `api` step reads (K7, T11.1). The Phase 10 verification: "a release
     * cannot ship an 'editor' that does not edit" — the API screen could send a
     * saved request and not change one, so the only way to fix a header was a
     * text editor outside the app.
     */
    availableWhen: has("request"),
    async run(service, args): Promise<ActionOutcome> {
      const request = args["request"];
      if (typeof request !== "object" || request === null) return refused("Nothing to save.");
      const name = (request as { name?: unknown }).name;
      if (typeof name !== "string" || name === "") {
        return refused("A saved request needs a name.");
      }
      /*
       * The name is the file, not part of the file. `api/<name>.yaml` is keyed
       * by it, so writing it into the body as well would make a rename look
       * like it had half happened.
       */
      const { name: _dropped, ...body } = request as Record<string, unknown>;
      const value = await service.putApiByName(name, body);
      return ok(`Saved ${name}.`, { value });
    },
  },
  {
    id: "data.save",
    label: "Save data",
    group: "Actions",
    screen: "data",
    availableWhen: loaded,
    async run(service, args): Promise<ActionOutcome> {
      const values = args["values"];
      if (values === undefined) return refused("Nothing to save.");
      const value = await service.putData({ values });
      return ok("Saved data.yaml. Redacted secrets were left as they were.", { value });
    },
  },
  {
    id: "agents.serve",
    label: "Start the tool server",
    group: "Actions",
    screen: "agents",
    cli: "yam tool serve",
    // The tool server is a process, not a service route (LLD §13.5 has none):
    // the screen lists what is exposed and its invocations, and the command is
    // how it is started.
    availableWhen: () => false,
    async run(): Promise<ActionOutcome> {
      return refused("Run `yam tool serve` from a terminal; the service has no route for it.");
    },
  },
  {
    id: "import.prototype",
    /*
     * "Import the database", not "Import prototype database" (T11.4).
     *
     * The rail's row is called "Import prototype database" — it is a
     * *destination* — and this button did the same, so two controls on one
     * screen had one accessible name and any sentence naming it was ambiguous
     * (`W_AMBIGUOUS_TARGET`). The self suite found it, which is what a suite
     * that drives the application by the words on it is for. A rail row says
     * where you are going; a button says what it does.
     */
    label: "Import the database",
    group: "Actions",
    screen: "import",
    cli: "yam migrate <dest> --from-prototype <electron-db dir>",
    availableWhen: loaded,
    async run(service, args): Promise<ActionOutcome> {
      const source = args["source"];
      if (typeof source !== "string") return refused("Choose the prototype's database directory.");
      const value = await service.postMigrate({ source });
      return ok("Imported into the open project.", { value });
    },
  },
  {
    id: "trajectory.compile",
    label: "Compile a trajectory",
    group: "Actions",
    screen: "agents",
    cli: "yam trajectory compile <trajectory.jsonl>",
    availableWhen: has("trajectory"),
    async run(service, args): Promise<ActionOutcome> {
      const path = args["trajectory"];
      if (typeof path !== "string") return refused("No trajectory has been captured yet.");
      const value = await service.postTrajectoryCompile({ trajectory: path });
      return ok("Wrote a proposal under proposals/.", { value });
    },
  },
];

/**
 * The palette's second group: one row per screen (LLD §13.7).
 *
 * Generated from `SCREEN_IDS` rather than written out, because "every old
 * screen has exactly one home" is a property of the list of screens, and a
 * hand-written copy of it would be a place for a screen to go missing. The
 * labels are the rail's, which is what the mockups show.
 */
const GO_TO_LABEL: Readonly<Record<ScreenId, string>> = {
  session: "Session",
  flows: "Flows",
  runs: "Runs",
  run: "Run",
  heal: "Heal review",
  bindings: "Bindings",
  agents: "Agents and tools",
  api: "API",
  data: "Data",
  import: "Import prototype database",
  settings: "Settings",
};

const GO_TO: readonly Action[] = SCREEN_IDS.map((id) => ({
  id: `go.${id}`,
  label: `Go to ${GO_TO_LABEL[id]}`,
  group: "Go to" as const,
  screen: id,
  availableWhen: () => true,
  async run(_service: ScreenService, args: ActionArgs): Promise<ActionOutcome> {
    return ok(`Opened ${GO_TO_LABEL[id]}.`, { goTo: id, params: args });
  },
}));

/** Every action, in palette order: Actions first, then Go to (LLD §13.7). */
export const ACTIONS: readonly Action[] = [...ACTIONS_ONLY, ...GO_TO];

/** One action by id, or `undefined`. The renderers and the SDK both use this. */
export function actionById(id: string): Action | undefined {
  return ACTIONS.find((one) => one.id === id);
}

/** The actions a screen offers, in registry order. */
export function actionsForScreen(screen: ScreenId): readonly Action[] {
  return ACTIONS.filter((one) => one.screen === screen && one.group === "Actions");
}
