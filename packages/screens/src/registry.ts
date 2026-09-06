/**
 * The action registry (T9.1, REQ-ADE-10, LLD §13.7).
 *
 * > an `Action` is `{ id, label, run(service, args), availableWhen(state), cli }`
 * > and the same list is what the command palette shows, what the SDK exposes as
 * > `actions`, and what the CLI has a command for; the repository check asserts
 * > the three agree by id.
 *
 * This file is that list. There is one of it, and every surface resolves an
 * action from here rather than declaring its own: the ADE's palette and toolbar
 * buttons, `svatah ui`'s palette and single-letter keys, `@svatah/sdk`'s
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
 * `svatah goto` would put a row in LLD §15's table that nobody would ever type.
 * Neither do the three review decisions (accept, re-pick, reject): they answer a
 * `record.decision` event on an open session, which a command line has no way to
 * be holding.
 */
import type { Action, ActionArgs, ActionOutcome, ScreenId, ScreenStateBase } from "./types.js";
import { SCREEN_IDS } from "./types.js";
import type { ScreenService } from "./service.js";

/** Most actions are available whenever their screen loaded at all. */
const loaded = (state: ScreenStateBase): boolean => state.error === undefined;

/** An action that needs the screen to be about something in particular. */
const has =
  (field: keyof ScreenStateBase | string) =>
  (state: ScreenStateBase): boolean =>
    loaded(state) && (state as unknown as Record<string, unknown>)[field] !== undefined;

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

/* ────────────────────────────────────────────────────────────────────────────
 * Actions
 * ──────────────────────────────────────────────────────────────────────────── */

const ACTIONS_ONLY: readonly Action[] = [
  {
    id: "flows.compile",
    label: "Compile",
    group: "Actions",
    screen: "flows",
    cli: "svatah compile",
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
    key: "⌘S",
    // `PUT /flows/:file` writes the file the CLI reads; from a terminal you
    // would use an editor, which is what `svatah ui`'s `e` key opens.
    availableWhen: has("file"),
    async run(service, args): Promise<ActionOutcome> {
      if (typeof args.file !== "string") return refused("No flow file is open.");
      if (typeof args["text"] !== "string") return refused("Nothing to save.");
      const value = await service.putFlowsByFile(args.file, args["text"]);
      return ok(`Saved ${args.file}.`, { value });
    },
  },
  {
    id: "run.flow",
    label: "Run",
    group: "Actions",
    screen: "flows",
    key: "⌘↵",
    cli: "svatah run --flow <file>",
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
    cli: "svatah run --story <name>",
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
    key: "⌘↵",
    cli: "svatah run --flow <file>",
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
    cli: "svatah run --resume <runId> --from <stepId>",
    availableWhen: has("resumeFrom"),
    async run(service, args): Promise<ActionOutcome> {
      if (typeof args.runId !== "string") return refused("No run is selected.");
      const from = args["from"];
      if (typeof from !== "string") return refused("No step to resume from.");
      const value = await service.postRun({ resume: args.runId, from });
      return ok(`Resumed ${args.runId} from ${from}.`, { value, goTo: "run" });
    },
  },
  {
    id: "record.start",
    label: "Record",
    group: "Actions",
    screen: "flows",
    key: "R",
    cli: "svatah record --flow <file>",
    availableWhen: loaded,
    async run(service, args): Promise<ActionOutcome> {
      const value = await service.postRecord({
        ...(typeof args.file === "string" ? { flows: [args.file] } : {}),
        ...(typeof args["gateway"] === "string" ? { gateway: args["gateway"] } : {}),
      });
      const sessionId = (value as { sessionId?: unknown }).sessionId;
      return ok(`Recording session ${String(sessionId ?? "?")} started.`, {
        value,
        goTo: "record",
        ...(typeof sessionId === "string" ? { params: { sessionId } } : {}),
      });
    },
  },
  {
    id: "record.accept",
    label: "Accept",
    group: "Actions",
    screen: "record",
    key: "A",
    availableWhen: has("decision"),
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
    screen: "record",
    key: "P",
    availableWhen: has("decision"),
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
    screen: "record",
    key: "X",
    availableWhen: has("decision"),
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
    screen: "record",
    availableWhen: has("sessionId"),
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
    key: "S",
    /*
     * No CLI command (Draft 2.12 §13.5, T10.4).
     *
     * `svatah run` is the run: stopping it from a terminal is `^C`, which is
     * not a command anyone types into a palette. What the route exists for is a
     * run somebody started from a *screen* and can no longer reach with a
     * keyboard interrupt — the ADE's and the cockpit's.
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
    key: "H",
    cli: "svatah heal --run <id>",
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
    cli: "svatah heal --from-bind-failures",
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
    key: "V",
    cli: "svatah bindings verify",
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
    cli: "svatah bindings prune",
    // Nothing on the service prunes: `svatah bindings prune` writes the store
    // directly, and LLD §13.5 has no route for it. The palette shows the
    // command rather than pretending there is a button that runs it.
    availableWhen: () => false,
    async run(): Promise<ActionOutcome> {
      return refused("Run `svatah bindings prune` from a terminal; the service has no route for it.");
    },
  },
  {
    id: "api.send",
    label: "Send request",
    group: "Actions",
    screen: "api",
    key: "⌘↵",
    availableWhen: loaded,
    async run(service, args): Promise<ActionOutcome> {
      const request = args["request"];
      if (request === undefined) return refused("Nothing to send.");
      const value = await service.postApiRequest(request);
      return ok("Sent the request.", { value });
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
    cli: "svatah tool serve",
    // The tool server is a process, not a service route (LLD §13.5 has none):
    // the screen lists what is exposed and its invocations, and the command is
    // how it is started.
    availableWhen: () => false,
    async run(): Promise<ActionOutcome> {
      return refused("Run `svatah tool serve` from a terminal; the service has no route for it.");
    },
  },
  {
    id: "explorer.snapshot",
    label: "Snapshot the session",
    group: "Actions",
    screen: "explorer",
    cli: "svatah surface snapshot",
    availableWhen: has("sessionId"),
    async run(service, args): Promise<ActionOutcome> {
      if (typeof args.sessionId !== "string") return refused("No surface session is open.");
      const intent = args["intent"];
      if (typeof intent !== "string" || intent.trim() === "") {
        // REQ-BEH-4 and LLD §8: every raw surface call records why it was made.
        return refused("Say what you are looking for: every surface call records an intent.");
      }
      const value = await service.postSurfaceBySessionSnapshot(args.sessionId, { intent });
      return ok("Read the session's snapshot.", { value });
    },
  },
  {
    id: "import.prototype",
    label: "Import prototype database",
    group: "Actions",
    screen: "import",
    cli: "svatah migrate <dest> --from-ade <electron-db dir>",
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
    screen: "explorer",
    cli: "svatah trajectory compile <trajectory.jsonl>",
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
  flows: "Flows",
  record: "Record review",
  runs: "Runs",
  run: "Run",
  heal: "Heal review",
  bindings: "Bindings",
  agents: "Agents and tools",
  api: "API",
  data: "Data",
  explorer: "Surface explorer",
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
