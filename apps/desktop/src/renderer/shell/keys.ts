/**
 * The app's key map and its accelerators (TV-M03, TV-16).
 *
 * Keys left the model in TV-M03: `@svatah/yam-screens` says which actions a screen
 * has, and each renderer says which key runs them. This is the app's answer —
 * `⌘↵`, `⌘S`, `⇧R` — and `packages/tui/src/keys.ts` is the terminal's, which
 * cannot be sent a `⌘` and does not pretend it can.
 *
 * `ACCELERATOR` is what a button prints beside its label. It was `Action.key` in
 * the registry, where it was one renderer's convention living in the shared
 * model; the action ids are unchanged, and this is the only file that decides
 * what a person presses.
 */
import type { ScreenId } from "@svatah/yam-screens";

export interface AppKey {
  readonly key: string;
  readonly action: string;
  readonly label: string;
}

const SCREEN_KEYS: Partial<Record<ScreenId, readonly AppKey[]>> = {
  session: [
    { key: "C", action: "surface.connect", label: "Connect a surface" },
    { key: "S", action: "surface.refresh", label: "Refresh the surface tree" },
    { key: "R", action: "surface.discover", label: "Recheck available targets" },
    { key: "A", action: "record.accept", label: "Accept the grounding" },
    { key: "P", action: "record.repick", label: "Re-pick in the session" },
    { key: "X", action: "record.reject", label: "Reject the grounding" },
    { key: "Q", action: "record.stop", label: "Stop the session" },
    { key: "S", action: "capture.stop", label: "Stop recording and write the flow" },
  ],
  flows: [
    { key: "⌘↵", action: "run.flow", label: "Run the selected flow" },
    { key: "R", action: "capture.start", label: "Record a flow from what you do" },
    { key: "B", action: "record.start", label: "Bind the selected flow's targets" },
    { key: "H", action: "heal.run", label: "Heal the last run" },
    { key: "⌘S", action: "flows.save", label: "Edit the open flow" },
    { key: "⌘B", action: "flows.compile", label: "Compile and lint" },
  ],
  run: [
    { key: "⌘↵", action: "run.again", label: "Run the same thing again" },
    { key: "⇧R", action: "run.resume", label: "Resume from the failing step" },
    { key: "S", action: "run.stop", label: "Stop this run between steps" },
    { key: "H", action: "heal.run", label: "Heal this run" },
  ],
  runs: [
    { key: "↵", action: "go.run", label: "Open the selected run" },
    { key: "H", action: "heal.run", label: "Heal the selected run" },
  ],
  bindings: [
    { key: "V", action: "bindings.verify", label: "Dry-resolve every binding" },
  ],
  heal: [
    { key: "A", action: "heal.apply", label: "Apply the proposal" },
    { key: "H", action: "heal.run", label: "Heal the selected run" },
  ],
  agents: [
    { key: "↵", action: "go.run", label: "Open the invocation's run" },
  ],
  api: [
    { key: "⌘↵", action: "api.send", label: "Send the request" },
  ],
  data: [
    { key: "⌘S", action: "data.save", label: "Save data.yaml" },
  ],
};

/** The keys this screen binds. */
export const keysFor = (screen: ScreenId): readonly AppKey[] => SCREEN_KEYS[screen] ?? [];

/**
 * What a button prints beside an action's label, when the app gives it one.
 *
 * Not every action has an accelerator and none needs one: the palette reaches
 * all of them, which is the guarantee TV-02 makes.
 */
const ACCELERATOR: Readonly<Record<string, string>> = {
  "surface.connect": "C",
  "surface.discover": "R",
  "surface.act": "⌘↵",
  "surface.refresh": "S",
  "surface.request": "⌘↵",
  "flows.save": "⌘S",
  "run.flow": "⌘↵",
  "run.again": "⌘↵",
  "capture.start": "R",
  "capture.stop": "S",
  "record.start": "B",
  "record.accept": "A",
  "record.repick": "P",
  "record.reject": "X",
  "run.stop": "S",
  "heal.run": "H",
  "bindings.verify": "V",
  "api.send": "⌘↵",
  "api.save": "⌘S",
};

export const acceleratorFor = (action: string): string | undefined => ACCELERATOR[action];
