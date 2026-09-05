/**
 * The one part of this adapter that touches macOS (T6.2, LLD §7.5, REQ-ADP-7).
 *
 * > AX: `AXUIElement` via a small native module; `AXRole` → role map;
 * > `AXIdentifier` → `automationId`; actions via `AXPress`, `AXSetValue`,
 * > keyboard events; documents the accessibility permission prompt and provides
 * > a `svatah surface doctor` check.
 *
 * ## Why `osascript`, and not a native module
 *
 * A native N-API module would call `AXUIElementCopyAttributeValue` directly.
 * It would also need a compiler on every machine that installs this package,
 * which is what `node-gyp` means in practice — and REQ-PKG-3 keeps the
 * dependency tree permissive, not merely licensed. macOS already ships a client
 * of exactly that API: **System Events**, whose `UI elements` and
 * `attributes` are `AXUIElement` under a scripting name. Driving it through
 * `osascript -l JavaScript` needs nothing installed, needs the same
 * Accessibility permission a native module would, and reads the same tree.
 *
 * ## The cost, and what Phase 6 got wrong about it (Draft 2.8 §7.5)
 *
 * Every Apple event costs about the same fixed ~16-25 ms whatever it carries,
 * so the only number that matters is **how many events a snapshot sends**. The
 * first version of this bridge walked the tree element by element and read
 * about seventeen attributes per element, one event each: measured against the
 * ADE's 35-node welcome window that is 650 ms *per node*, so the smallest
 * window the ADE has took ten seconds and the project screen would have taken
 * minutes. Every case of the live macOS gate failed on the surface's ten-second
 * deadline (Phase 6 verification, F1).
 *
 * The fix is not a native module — Draft 2.8 §7.5 permits this bridge and
 * requires **bulk reads**: one event must answer for a whole set of elements,
 * never one element's one attribute. Three System Events forms do that, and
 * they are why this script is AppleScript rather than JXA (JXA cannot ask a
 * plural specifier for `properties`; it answers `Can't get object.`):
 *
 * - `properties of every UI element of C` — one event, every attribute of
 *   every child of `C`: role, subrole, title, description, value, name, help,
 *   enabled, focused, selected, position, size.
 * - `value of attribute "X" of every UI element of C` — one event, one
 *   attribute across every child, for the attributes `properties` leaves out
 *   (`AXIdentifier`, `AXDOMIdentifier`, `AXPlaceholderValue`, `AXExpanded`).
 * - `name of every action of every UI element of C` — one event, the action
 *   names of every child.
 *
 * `AXChildren` read the same way says which children are containers, so the
 * walk spends no event on a leaf. The cost is therefore *per container*, not
 * per node or per attribute. Measured on this machine against the ADE's own
 * 199-node menu-bar tree: 103 events, 2.06 s, **10.4 ms per node** — against
 * 650 ms per node before. The 400-node budget of §7.5 is met with room.
 *
 * Every snapshot is one `osascript` invocation. The script carries its own
 * deadline so that a window it cannot finish comes back as a *measured* bridge
 * timeout — nodes, milliseconds, events — rather than as a killed process with
 * nothing to say.
 *
 * ## Why the bridge is an interface
 *
 * Everything above this file — role mapping, candidate synthesis, the snapshot
 * shape, the predicates — is a pure function of an `AxNode[]`. Making the
 * bridge injectable is what lets all of it be tested against recorded trees on
 * a machine with no Accessibility permission, which is the situation this was
 * written in and the situation CI is in.
 */
import { spawn } from "node:child_process";

/**
 * One accessibility element, flattened (LLD §7.5).
 *
 * A flat array with parent indices rather than a nested tree, because that is
 * what the walk produces and what a snapshot's `depth`/`parent` need. Index 0
 * is the root; `parent: -1` marks it.
 *
 * Field names are the `AX*` attribute names with the prefix dropped, so a tree
 * recorded from a real application can be read against Apple's documentation
 * without a translation table.
 */
export interface AxNode {
  /** Index of this node's parent in the same array; `-1` for the root. */
  readonly parent: number;
  /** `AXRole`, e.g. `AXButton`. Mapped to an ARIA role by `tree.ts`. */
  readonly role: string;
  /** `AXSubrole`, e.g. `AXSearchField`. Refines the role when present. */
  readonly subrole?: string;
  /** `AXTitle`. */
  readonly title?: string;
  /** `AXDescription` — what Chromium puts an `aria-label` in. */
  readonly description?: string;
  /** `AXValue`, rendered as a string. */
  readonly value?: string;
  /** `AXIdentifier` — a native application's own id for the element (LLD §3.3). */
  readonly identifier?: string;
  /**
   * `AXDOMIdentifier` — the DOM `id` attribute, which Chromium publishes.
   *
   * Not named in LLD §7.5, which says the macOS `automationId` comes "from
   * `aria-label` or `AXIdentifier`". It is read anyway because the conformance
   * target is an Electron application (REQ-ADE-6): a `<select id="record-gateway">`
   * has an `id` and no `AXIdentifier`, and an aria-label is a *label* — it
   * changes when the wording changes, which is the thing an `automationId` is
   * supposed to survive. The precedence in `tree.ts` keeps §7.5's two sources
   * and puts this between them.
   */
  readonly domIdentifier?: string;
  /** `AXHelp`, which is a `title` attribute on the web. */
  readonly help?: string;
  /** `AXPlaceholderValue`. */
  readonly placeholder?: string;
  readonly enabled?: boolean;
  readonly focused?: boolean;
  readonly selected?: boolean;
  /** `AXExpanded`, when the element has the attribute at all. */
  readonly expanded?: boolean;
  /** `AXValue` of a checkbox or radio, as a tri-state. */
  readonly checked?: boolean;
  /** `AXPosition` and `AXSize` together: `[x, y, width, height]`. */
  readonly box?: readonly [number, number, number, number];
  /** The names of the actions the element declares: `AXPress`, `AXShowMenu`. */
  readonly actions?: readonly string[];
}

/**
 * What one `snapshot()` cost, which Draft 2.8 §7.5 requires the desktop
 * conformance report to publish: "The desktop conformance report records nodes
 * read, wall time, and milliseconds per node."
 *
 * It is measured on this side of the process boundary, so `wallMs` includes
 * spawning `osascript`. That is the number a caller waits for, and the number
 * the ten-second surface deadline is spent against.
 */
export interface AxSnapshotCost {
  readonly nodes: number;
  readonly wallMs: number;
  readonly msPerNode: number;
  /** How many `osascript` processes the read took. One, by design. */
  readonly invocations: number;
  /** How many Apple events the script sent. The number the design is about. */
  readonly appleEvents: number;
}

/** What the bridge was asked to do, and what came back. */
export interface AxWindow {
  /** The application process the tree was read from. */
  readonly process: string;
  /** The front window's `AXTitle`, which is what `state()` reports. */
  readonly title: string;
  readonly nodes: readonly AxNode[];
  /** True when the walk stopped at `maxNodes` rather than at the leaves. */
  readonly truncated: boolean;
  readonly cost: AxSnapshotCost;
}

/** Why an accessibility call could not be made. */
export type AxPermissionState =
  | "granted"
  /** The permission has never been asked for, or the prompt is unanswered. */
  | "prompt-pending"
  /** The permission was asked for and refused. */
  | "denied"
  /** Not macOS. */
  | "unsupported";

export interface AxPermission {
  readonly state: AxPermissionState;
  /** What to do about it, written for whoever runs `svatah surface doctor`. */
  readonly advice: string;
  /** The raw `osascript` diagnostic, when there was one. */
  readonly detail?: string;
}

/** An action the bridge performs on one element, addressed by its path. */
export type AxCommand =
  | { readonly kind: "action"; readonly path: readonly number[]; readonly action: string }
  | { readonly kind: "setValue"; readonly path: readonly number[]; readonly value: string }
  | { readonly kind: "focus"; readonly path: readonly number[] }
  | { readonly kind: "keystroke"; readonly text: string; readonly using?: readonly string[] }
  | { readonly kind: "keycode"; readonly code: number; readonly using?: readonly string[] }
  | { readonly kind: "click"; readonly at: readonly [number, number] }
  | { readonly kind: "activate" };

/**
 * What the adapter needs from macOS. Everything else is a pure function.
 */
export interface AxBridge {
  /** Is the Accessibility permission granted to whatever is running this? */
  permission(): Promise<AxPermission>;
  /** The accessibility tree of a process's front window. */
  window(request: { process: string; maxNodes: number }): Promise<AxWindow>;
  /** Perform one command; throws `AxBridgeError` when macOS refuses. */
  perform(command: AxCommand): Promise<void>;
  /** A PNG of the screen (or of one rectangle), written to `path`. */
  screenshot(path: string, box?: readonly [number, number, number, number]): Promise<void>;
}

export class AxBridgeError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AxBridgeError";
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * The osascript runner.
 * ──────────────────────────────────────────────────────────────────────────── */

/** Which `osascript` dialect a script is written in. */
export type OsascriptLanguage = "JavaScript" | "AppleScript";

/**
 * Run one JXA script, with a hard deadline.
 *
 * The deadline is not a nicety. An `osascript` that trips the Accessibility
 * prompt blocks on a dialog nobody may be there to answer and then fails with
 * `-1712` after roughly two minutes; a `svatah surface doctor` that inherited
 * that wait would be useless exactly when it is needed. Killing the child and
 * reporting the timeout as a *permission* answer is the honest reading: an
 * accessibility call that cannot complete is an accessibility call you do not
 * have.
 */
export async function runOsascript(
  script: string,
  argument: unknown,
  timeoutMs: number,
  language: OsascriptLanguage = "JavaScript",
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  /*
   * Two languages, one runner (Draft 2.8 §7.5).
   *
   * The permission check and the action script stay in JXA, where JSON in and
   * JSON out costs nothing. The window read is AppleScript because only
   * AppleScript can ask a *plural* specifier for `properties` — JXA answers
   * `Can't get object.` — and that one form is the whole bulk-read design.
   * AppleScript has no JSON, so its arguments are plain `argv` strings and its
   * answer is delimiter-separated text that `parseWindow` reads back.
   */
  const args =
    language === "AppleScript"
      ? ["-e", script, ...(argument as readonly string[])]
      : ["-l", "JavaScript", "-e", script, JSON.stringify(argument)];
  return await new Promise((resolve) => {
    const child = spawn("osascript", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.on("data", (chunk) => (stdout += String(chunk)));
    child.stderr.on("data", (chunk) => (stderr += String(chunk)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: String(error), timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

/* ────────────────────────────────────────────────────────────────────────────
 * The scripts.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The smallest call that needs **assistive access**, and nothing else.
 *
 * The distinction matters and cost a wrong answer to get right. Counting
 * `applicationProcesses` needs only Automation permission for System Events —
 * it succeeds on a machine where the accessibility API is refused — so a
 * `doctor` built on it reported `granted` while every `snapshot` failed with
 * `-25211`, which is the worst kind of diagnostic: confidently wrong, and it
 * sends the reader to look at the adapter.
 *
 * Reading a process's `UI elements` is the thing the adapter actually does, so
 * it is the thing the check does. `System Events` itself is the target: it is
 * always running, it belongs to the OS, and asking it about its own interface
 * touches no application under test.
 */
const PERMISSION_SCRIPT = `function run(argv) {
  const se = Application("System Events");
  const procs = se.applicationProcesses.length;
  // The assistive-access call. Any process would do; the one guaranteed to be
  // running is System Events itself.
  const self = se.applicationProcesses.byName("System Events");
  let windows = 0;
  try { windows = self.windows().length; } catch (e) { windows = 0; }
  // A window list is not enough on its own — a process with no windows answers
  // 0 either way — so a UI-element read is what the check turns on.
  const elements = se.applicationProcesses.byName("Finder").uiElements().length;
  return JSON.stringify({ ok: true, processes: procs, windows: windows, elements: elements });
}`;

/**
 * One window's accessibility tree, in one `osascript` invocation (Draft 2.8 §7.5).
 *
 * ## The shape of the walk
 *
 * Breadth-first over **containers**, not over nodes. For each container the
 * script sends at most six Apple events, each of which answers for *every*
 * child at once:
 *
 * | event | what it answers |
 * |---|---|
 * | `properties of every UI element of C` | role, subrole, title, description, value, name, help, enabled, focused, selected, position, size |
 * | `value of attribute "AXChildren" of every UI element of C` | which children are containers, so no event is spent on a leaf |
 * | `value of attribute "AXIdentifier" …` | `automationId`, first source |
 * | `value of attribute "AXDOMIdentifier" …` | `automationId`, second source; what Chromium publishes a DOM `id` as |
 * | `value of attribute "AXPlaceholderValue" …` | the placeholder a name falls back to |
 * | `name of every action of every UI element of C` | `AXPress` and friends, so `act` uses an accessibility action rather than a click |
 *
 * The last four run only for a container that has at least one interactive
 * child, because those attributes only matter on controls; a Chromium tree is
 * mostly nested `AXGroup`s and those cost two events, not six.
 *
 * ## Asking for an attribute a set does not all have
 *
 * A bulk read is all-or-nothing: `value of attribute "AXDOMIdentifier" of every
 * UI element of C` fails outright if one child lacks the attribute, and a
 * failed event still costs its ~20 ms. So each optional attribute keeps a
 * success and a failure count and is abandoned once it has failed eight times
 * without earning its place (`wanted`). On an Electron window
 * `AXDOMIdentifier` succeeds everywhere in the web content and `AXIdentifier`
 * gives up after eight containers; on a native window it is the other way
 * round. Nothing is read attribute-by-attribute in either case.
 *
 * ## Why it carries its own deadline
 *
 * §7.5: "A deadline exceeded after `doctor` reported `granted` is reported as a
 * bridge timeout with those numbers, never as a permission prompt." A killed
 * `osascript` has no numbers to report, so the script stops itself a second
 * before the caller would and answers with what it has: the `D` flag, the node
 * count and the event count. AppleScript's clock has one-second resolution,
 * which is why the deadline crosses the boundary in seconds.
 *
 * ## Why it is not JXA
 *
 * `Application("System Events").…uiElements.properties()` — the plural read the
 * whole design rests on — answers `Error: Can't get object.` in JXA. The
 * AppleScript form works. That is the entire reason.
 */
const WINDOW_SCRIPT = `global evCount
global idOk, idFail, domOk, domFail, phOk, phFail, expOk, expFail, actOk, actFail

on toText(v)
	try
		if v is missing value then return ""
		if class of v is boolean then
			if v then return "1"
			return "0"
		end if
		if class of v is list then
			set acc to {}
			repeat with one in v
				set end of acc to my toText(one)
			end repeat
			return my joinList(acc, ",")
		end if
		return v as text
	on error
		return ""
	end try
end toText

on joinList(lst, sep)
	set old to AppleScript's text item delimiters
	set AppleScript's text item delimiters to sep
	set s to lst as text
	set AppleScript's text item delimiters to old
	return s
end joinList

on clean(s)
	if s is "" then return ""
	set old to AppleScript's text item delimiters
	set AppleScript's text item delimiters to (character id 31)
	set parts to text items of s
	set AppleScript's text item delimiters to " "
	set s to parts as text
	set AppleScript's text item delimiters to (character id 30)
	set parts to text items of s
	set AppleScript's text item delimiters to " "
	set s to parts as text
	set AppleScript's text item delimiters to old
	return s
end clean

on wanted(okCount, failCount)
	if failCount < 8 then return true
	return okCount > failCount
end wanted

on bulkAttr(parentEl, attrName, n)
	set evCount to evCount + 1
	tell application "System Events"
		try
			set vals to value of attribute attrName of every UI element of parentEl
			if (count of vals) is n then return vals
		end try
	end tell
	return missing value
end bulkAttr

on bulkActions(parentEl, n)
	set evCount to evCount + 1
	tell application "System Events"
		try
			set vals to name of every action of every UI element of parentEl
			if (count of vals) is n then return vals
		end try
	end tell
	return missing value
end bulkActions

on interactive(r)
	return r is in {"AXButton", "AXRadioButton", "AXCheckBox", "AXPopUpButton", "AXMenuButton", "AXTextField", "AXTextArea", "AXComboBox", "AXSearchField", "AXLink", "AXTab", "AXTabGroup", "AXRadioGroup", "AXSlider", "AXIncrementor", "AXStepper", "AXDisclosureTriangle", "AXCell", "AXRow", "AXMenuItem", "AXMenuBarItem", "AXCheckBoxGroup", "AXColorWell", "AXScrollBar"}
end interactive

on pick(lst, i)
	if lst is missing value then return ""
	try
		return my toText(item i of lst)
	on error
		return ""
	end try
end pick

on emit(parentIndex, p, extra)
	set fields to {parentIndex as text}
	tell application "System Events"
		set end of fields to my clean(my toText(role of p))
		set end of fields to my clean(my toText(subrole of p))
		set end of fields to my clean(my toText(title of p))
		set end of fields to my clean(my toText(description of p))
		set end of fields to my clean(my toText(value of p))
		set end of fields to my clean(my toText(name of p))
		set end of fields to my clean(my toText(help of p))
		set end of fields to my toText(enabled of p)
		set end of fields to my toText(focused of p)
		set end of fields to my toText(selected of p)
		set end of fields to my toText(position of p)
		set end of fields to my toText(size of p)
	end tell
	repeat with one in extra
		set end of fields to my clean(one as text)
	end repeat
	return my joinList(fields, (character id 31))
end emit

on run argv
	set procName to item 1 of argv
	set maxNodes to (item 2 of argv) as integer
	set deadlineSeconds to (item 3 of argv) as integer
	set us to (character id 31)
	set rs to (character id 30)
	set evCount to 0
	set idOk to 0
	set idFail to 0
	set domOk to 0
	set domFail to 0
	set phOk to 0
	set phFail to 0
	set expOk to 0
	set expFail to 0
	set actOk to 0
	set actFail to 0
	set startedAt to (current date)
	set deadlineHit to false
	set truncated to false

	tell application "System Events"
		set procs to (every application process whose name is procName)
		if (count of procs) is 0 then return "ERR" & us & "no-process"
		set proc to item 1 of procs
		set wins to (every window of proc)
		if (count of wins) is 0 then return "ERR" & us & "no-window"
		set win to item 1 of wins
		set winTitle to ""
		try
			set winTitle to (value of attribute "AXTitle" of win) as text
		end try
		set evCount to evCount + 1
		set rootProps to properties of win
	end tell

	set out to {my emit(-1, rootProps, {"", "", "", "", ""})}
	set total to 1
	set queue to {{win, 0}}

	repeat while (count of queue) > 0
		if ((current date) - startedAt) ≥ deadlineSeconds then
			set deadlineHit to true
			exit repeat
		end if
		set job to item 1 of queue
		if (count of queue) is 1 then
			set queue to {}
		else
			set queue to items 2 thru -1 of queue
		end if
		set parentEl to item 1 of job
		set parentIndex to item 2 of job

		set kidProps to {}
		set evCount to evCount + 1
		tell application "System Events"
			try
				set kidProps to properties of every UI element of parentEl
			end try
		end tell
		set n to (count of kidProps)
		if n > 0 then
			set kidKids to my bulkAttr(parentEl, "AXChildren", n)

			set anyInteractive to false
			set roles to {}
			tell application "System Events"
				repeat with i from 1 to n
					set end of roles to my toText(role of (item i of kidProps))
				end repeat
			end tell
			repeat with i from 1 to n
				if my interactive(item i of roles) then set anyInteractive to true
			end repeat

			set ids to missing value
			set domIds to missing value
			set phs to missing value
			set exps to missing value
			set acts to missing value
			if anyInteractive then
				if my wanted(idOk, idFail) then
					set ids to my bulkAttr(parentEl, "AXIdentifier", n)
					if ids is missing value then
						set idFail to idFail + 1
					else
						set idOk to idOk + 1
					end if
				end if
				if my wanted(domOk, domFail) then
					set domIds to my bulkAttr(parentEl, "AXDOMIdentifier", n)
					if domIds is missing value then
						set domFail to domFail + 1
					else
						set domOk to domOk + 1
					end if
				end if
				if my wanted(phOk, phFail) then
					set phs to my bulkAttr(parentEl, "AXPlaceholderValue", n)
					if phs is missing value then
						set phFail to phFail + 1
					else
						set phOk to phOk + 1
					end if
				end if
				if my wanted(expOk, expFail) then
					set exps to my bulkAttr(parentEl, "AXExpanded", n)
					if exps is missing value then
						set expFail to expFail + 1
					else
						set expOk to expOk + 1
					end if
				end if
				if my wanted(actOk, actFail) then
					set acts to my bulkActions(parentEl, n)
					if acts is missing value then
						set actFail to actFail + 1
					else
						set actOk to actOk + 1
					end if
				end if
			end if

			repeat with i from 1 to n
				if total ≥ maxNodes then
					set truncated to true
					exit repeat
				end if
				set extra to {my pick(ids, i), my pick(domIds, i), my pick(phs, i), my pick(exps, i), my pick(acts, i)}
				set end of out to my emit(parentIndex, item i of kidProps, extra)
				set total to total + 1
				set hasKids to true
				if kidKids is not missing value then
					set hasKids to false
					try
						if (count of (item i of kidKids)) > 0 then set hasKids to true
					end try
				end if
				if hasKids then
					tell application "System Events"
						set childRef to a reference to UI element i of parentEl
					end tell
					set end of queue to {childRef, total - 1}
				end if
			end repeat
		end if
		if truncated then exit repeat
	end repeat

	set flags to ""
	if truncated then set flags to flags & "T"
	if deadlineHit then set flags to flags & "D"
	set header to my joinList({"OK", my clean(winTitle), flags, evCount as text, (count of out) as text}, us)
	return header & rs & my joinList(out, rs)
end run
`;

/** Field order of one node record, as `WINDOW_SCRIPT` writes it. */
const enum Field {
  Parent = 0,
  Role = 1,
  Subrole = 2,
  Title = 3,
  Description = 4,
  Value = 5,
  Name = 6,
  Help = 7,
  Enabled = 8,
  Focused = 9,
  Selected = 10,
  Position = 11,
  Size = 12,
  Identifier = 13,
  DomIdentifier = 14,
  Placeholder = 15,
  Expanded = 16,
  Actions = 17,
}

/** Record and field separators: ASCII 30 and 31, which no AX string carries. */
const RECORD_SEPARATOR = "\u001e";
const UNIT_SEPARATOR = "\u001f";

const text = (value: string | undefined): string | undefined =>
  value === undefined || value === "" ? undefined : value;

const flag = (value: string | undefined): boolean | undefined =>
  value === "1" ? true : value === "0" ? false : undefined;

const pair = (value: string | undefined): [number, number] | undefined => {
  if (value === undefined || value === "") return undefined;
  const parts = value.split(",").map((one) => Number(one));
  if (parts.length !== 2 || parts.some((one) => !Number.isFinite(one))) return undefined;
  return [parts[0]!, parts[1]!];
};

/** Roles whose `AXValue` is a tick rather than a string (LLD §3.2 `checked`). */
const CHECKABLE = new Set(["AXCheckBox", "AXRadioButton", "AXMenuItem", "AXToggle"]);

/**
 * Read `WINDOW_SCRIPT`'s answer.
 *
 * Delimiter-separated rather than JSON because AppleScript has no JSON writer
 * and hand-rolling string escaping in it is how a tree gets lost to one quote
 * mark. ASCII 30 and 31 are the separators the format was invented for, an AX
 * string never contains one, and the script replaces them with spaces if one
 * ever does.
 */
export function parseWindow(stdout: string): {
  ok: boolean;
  error?: string;
  title: string;
  truncated: boolean;
  deadlineHit: boolean;
  appleEvents: number;
  nodes: AxNode[];
} {
  const records = stdout.split(RECORD_SEPARATOR);
  const header = (records[0] ?? "").split(UNIT_SEPARATOR);
  if (header[0] !== "OK") {
    return {
      ok: false,
      ...(header[1] === undefined ? {} : { error: header[1] }),
      title: "",
      truncated: false,
      deadlineHit: false,
      appleEvents: 0,
      nodes: [],
    };
  }
  const flags = header[2] ?? "";
  const nodes: AxNode[] = [];
  for (const record of records.slice(1)) {
    if (record === "") continue;
    const fields = record.split(UNIT_SEPARATOR);
    const role = fields[Field.Role] ?? "AXUnknown";
    const value = text(fields[Field.Value]);
    const box = ((): readonly [number, number, number, number] | undefined => {
      const position = pair(fields[Field.Position]);
      const size = pair(fields[Field.Size]);
      if (position === undefined || size === undefined) return undefined;
      return [position[0], position[1], size[0], size[1]];
    })();
    const actions = text(fields[Field.Actions])?.split(",").filter((one) => one !== "");
    const checked = CHECKABLE.has(role)
      ? value === "1" || value === "true"
        ? true
        : value === "0" || value === "false"
          ? false
          : undefined
      : undefined;
    nodes.push({
      parent: Number(fields[Field.Parent] ?? "-1"),
      role: role === "" ? "AXUnknown" : role,
      ...(text(fields[Field.Subrole]) === undefined ? {} : { subrole: fields[Field.Subrole]! }),
      ...(text(fields[Field.Title]) === undefined ? {} : { title: fields[Field.Title]! }),
      ...(text(fields[Field.Description]) === undefined
        ? {}
        : { description: fields[Field.Description]! }),
      ...(value === undefined ? {} : { value }),
      ...(text(fields[Field.Identifier]) === undefined
        ? {}
        : { identifier: fields[Field.Identifier]! }),
      ...(text(fields[Field.DomIdentifier]) === undefined
        ? {}
        : { domIdentifier: fields[Field.DomIdentifier]! }),
      ...(text(fields[Field.Help]) === undefined ? {} : { help: fields[Field.Help]! }),
      ...(text(fields[Field.Placeholder]) === undefined
        ? {}
        : { placeholder: fields[Field.Placeholder]! }),
      ...(flag(fields[Field.Enabled]) === undefined ? {} : { enabled: flag(fields[Field.Enabled])! }),
      ...(flag(fields[Field.Focused]) === undefined ? {} : { focused: flag(fields[Field.Focused])! }),
      ...(flag(fields[Field.Selected]) === undefined
        ? {}
        : { selected: flag(fields[Field.Selected])! }),
      ...(flag(fields[Field.Expanded]) === undefined
        ? {}
        : { expanded: flag(fields[Field.Expanded])! }),
      ...(checked === undefined ? {} : { checked }),
      ...(box === undefined ? {} : { box }),
      ...(actions === undefined || actions.length === 0 ? {} : { actions }),
    });
  }
  return {
    ok: true,
    title: header[1] ?? "",
    truncated: flags.includes("T"),
    deadlineHit: flags.includes("D"),
    appleEvents: Number(header[3] ?? "0"),
    nodes,
  };
}

/**
 * One command.
 *
 * An element is addressed by its **path** — the child index at each level from
 * the window down — rather than by a handle, because AppleScript object
 * specifiers do not survive between `osascript` processes. The path is what the
 * snapshot's walk already produced, so it costs nothing to carry.
 */
const PERFORM_SCRIPT = `function run(argv) {
  const command = JSON.parse(argv[0]);
  const se = Application("System Events");

  if (command.kind === "activate") {
    se.applicationProcesses.byName(command.process).frontmost = true;
    return JSON.stringify({ ok: true });
  }
  if (command.kind === "keystroke") {
    se.keystroke(command.text, command.using === undefined ? {} : { using: command.using });
    return JSON.stringify({ ok: true });
  }
  if (command.kind === "keycode") {
    se.keyCode(command.code, command.using === undefined ? {} : { using: command.using });
    return JSON.stringify({ ok: true });
  }
  if (command.kind === "click") {
    se.click({ at: command.at });
    return JSON.stringify({ ok: true });
  }

  const proc = se.applicationProcesses.byName(command.process);
  let element = proc.windows()[0];
  if (element === undefined) return JSON.stringify({ ok: false, error: "no-window" });
  for (const step of command.path) {
    const children = element.uiElements();
    if (step >= children.length) return JSON.stringify({ ok: false, error: "stale-path" });
    element = children[step];
  }

  try {
    if (command.kind === "action") element.actions.byName(command.action).perform();
    else if (command.kind === "setValue") element.attributes.byName("AXValue").value = command.value;
    else if (command.kind === "focus") element.attributes.byName("AXFocused").value = true;
  } catch (e) {
    return JSON.stringify({ ok: false, error: String(e) });
  }
  return JSON.stringify({ ok: true });
}`;

export interface OsascriptBridgeOptions {
  /** The application process to drive: the ADE is `Svatah ADE` (LLD §16). */
  readonly process: string;
  /** How long one Apple event may take. Default 20 s; `permission()` uses 5 s. */
  readonly timeoutMs?: number;
  /**
   * The budget for one `window()` read, which §7.5 sets at the surface's
   * default deadline of 10 s for a 400-node window. The script stops itself a
   * second inside it so the answer carries numbers rather than being a killed
   * process.
   */
  readonly windowDeadlineMs?: number;
  /** For tests: run a script without spawning anything. */
  readonly run?: typeof runOsascript;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const PERMISSION_TIMEOUT_MS = 5_000;
/** LLD §7.5: "the surface's default deadline of 10 s". */
const WINDOW_DEADLINE_MS = 10_000;

/** The real bridge: `osascript`, System Events, and this machine. */
export function osascriptBridge(options: OsascriptBridgeOptions): AxBridge {
  const run = options.run ?? runOsascript;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /*
   * What the last `permission()` answered, so a slow window read can say which
   * of the two things it is. `AxSurface.open` checks the permission before it
   * takes a snapshot, so by the time a `window()` is slow this is known.
   */
  let lastPermission: AxPermissionState | undefined;

  const bridgeTimeout = (
    processName: string,
    wallMs: number,
    deadlineMs: number,
    cost: AxSnapshotCost | undefined,
  ): AxBridgeError => {
    const measured =
      cost === undefined
        ? "no nodes came back"
        : `${cost.nodes} nodes in ${cost.wallMs} ms (${cost.msPerNode} ms per node, ` +
          `${cost.appleEvents} Apple events, ${cost.invocations} osascript invocation)`;
    if (lastPermission === "granted") {
      return new AxBridgeError(
        `The accessibility bridge did not finish reading the window of "${processName}" within ` +
          `${deadlineMs} ms: ${measured}. The Accessibility permission is granted, so this is ` +
          "the bridge's own budget (LLD §7.5), not a permission prompt.",
      );
    }
    return new AxBridgeError(
      `The accessibility call did not answer within ${deadlineMs} ms (${measured}). The ` +
        "Accessibility permission has not been confirmed for this program, and an unanswered " +
        "prompt looks exactly like this: run `svatah surface doctor`.",
    );
  };

  const call = async (script: string, argument: unknown, ms: number): Promise<unknown> => {
    const result = await run(script, argument, ms);
    if (result.timedOut) {
      throw new AxBridgeError(
        `The accessibility call did not answer within ${ms} ms. On macOS that is what an ` +
          "unanswered Accessibility permission prompt looks like: run `svatah surface doctor`.",
      );
    }
    if (result.code !== 0) {
      throw new AxBridgeError(
        "osascript refused the accessibility call.",
        result.stderr.trim() || result.stdout.trim(),
      );
    }
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch {
      throw new AxBridgeError("osascript answered something that is not JSON.", result.stdout);
    }
  };

  return {
    async permission(): Promise<AxPermission> {
      if (process.platform !== "darwin") {
        lastPermission = "unsupported";
        return {
          state: "unsupported",
          advice:
            "The macOS Accessibility adapter runs on macOS only. Use `--adapter uia` on " +
            "Windows, or `--adapter playwright` for a web application.",
        };
      }
      const result = await run(PERMISSION_SCRIPT, {}, PERMISSION_TIMEOUT_MS);
      if (result.timedOut) {
        lastPermission = "prompt-pending";
        return { state: "prompt-pending", advice: PROMPT_ADVICE };
      }
      if (result.code === 0 && result.stdout.includes('"ok":true')) {
        lastPermission = "granted";
        return { state: "granted", advice: "The Accessibility permission is granted." };
      }
      const detail = (result.stderr || result.stdout).trim();
      /*
       * `-1743` is "Not authorised to send Apple events"; `-25211` is
       * "not allowed assistive access", which is the accessibility API's own
       * refusal and the one this adapter runs into. Anything else that fails
       * here is treated as the prompt, because a first run on a clean machine
       * produces a timeout rather than either code, and telling someone
       * "denied" when they have simply not been asked yet sends them to the
       * wrong screen.
       */
      const denied =
        detail.includes("-1743") ||
        detail.includes("-25211") ||
        detail.includes("assistive access");
      lastPermission = denied ? "denied" : "prompt-pending";
      return {
        state: lastPermission,
        advice: denied ? DENIED_ADVICE : PROMPT_ADVICE,
        ...(detail === "" ? {} : { detail }),
      };
    },

    async window(request): Promise<AxWindow> {
      const deadlineMs = options.windowDeadlineMs ?? WINDOW_DEADLINE_MS;
      const startedAt = Date.now();
      /*
       * The script's own budget is a second inside the caller's, so the normal
       * way to exceed it is the script answering with the `D` flag and its
       * numbers — not the runner killing a process that has nothing to say.
       * The hard kill stays as the backstop for an `osascript` that blocks
       * before it starts (an unanswered permission prompt does exactly that).
       */
      const softSeconds = Math.max(1, Math.floor((deadlineMs - 1_000) / 1_000));
      const result = await run(
        WINDOW_SCRIPT,
        [request.process, String(request.maxNodes), String(softSeconds)],
        deadlineMs,
        "AppleScript",
      );
      const wallMs = Date.now() - startedAt;

      if (result.timedOut) throw bridgeTimeout(request.process, wallMs, deadlineMs, undefined);
      if (result.code !== 0) {
        throw new AxBridgeError(
          "osascript refused the accessibility call.",
          result.stderr.trim() || result.stdout.trim(),
        );
      }

      const answer = parseWindow(result.stdout);
      if (!answer.ok) {
        throw new AxBridgeError(
          answer.error === "no-window"
            ? `The process "${request.process}" has no window. Is it running, and not minimised?`
            : answer.error === "no-process"
              ? `No application process is named "${request.process}". Is it running?`
              : `The accessibility call failed: ${answer.error ?? "unknown"}.`,
        );
      }

      const cost: AxSnapshotCost = {
        nodes: answer.nodes.length,
        wallMs,
        msPerNode:
          answer.nodes.length === 0
            ? wallMs
            : Math.round((wallMs / answer.nodes.length) * 100) / 100,
        invocations: 1,
        appleEvents: answer.appleEvents,
      };

      /*
       * §7.5, the sentence this exists for: a deadline exceeded after `doctor`
       * said `granted` is a *bridge* timeout, with the numbers, and never the
       * permission prompt. Phase 6's message said the opposite and sent the
       * verifier to System Settings for a defect that was in this file.
       */
      if (answer.deadlineHit) throw bridgeTimeout(request.process, wallMs, deadlineMs, cost);

      return {
        process: request.process,
        title: answer.title,
        nodes: answer.nodes,
        truncated: answer.truncated,
        cost,
      };
    },

    async perform(command): Promise<void> {
      const answer = (await call(
        PERFORM_SCRIPT,
        { ...command, process: options.process },
        timeoutMs,
      )) as { ok: boolean; error?: string };
      if (!answer.ok) {
        throw new AxBridgeError(`The accessibility action failed: ${answer.error ?? "unknown"}.`);
      }
    },

    async screenshot(path, box): Promise<void> {
      /*
       * `screencapture` rather than an accessibility call: AX has no way to
       * render an element, and the Screen Recording permission is a separate
       * grant from the Accessibility one, so a failure here must not be read as
       * an accessibility failure.
       */
      const args = ["-x", ...(box === undefined ? [] : ["-R", box.join(",")]), path];
      await new Promise<void>((resolve) => {
        const child = spawn("screencapture", args, { stdio: "ignore" });
        const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
        child.on("error", () => {
          clearTimeout(timer);
          resolve();
        });
        child.on("close", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    },
  };
}

const PROMPT_ADVICE =
  "The Accessibility permission has not been granted to the program running Svatah. " +
  "Open System Settings → Privacy & Security → Accessibility, add the terminal (or the " +
  "test runner) you are running from, and switch it on. macOS asks once and remembers " +
  "the answer per program, so a permission granted to Terminal does not carry to iTerm, " +
  "to VS Code, or to a CI agent.";

const DENIED_ADVICE =
  "The Accessibility permission was refused for the program running Svatah. Open System " +
  "Settings → Privacy & Security → Accessibility, switch it on for that program, and " +
  "restart it — macOS does not re-read the setting for a process that is already running.";
