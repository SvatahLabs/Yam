/**
 * The one part of this adapter that touches Windows (T6.1, LLD §7.5,
 * REQ-ADP-6).
 *
 * > UIA: Node binding over the UI Automation COM API (or a wrapped driver with
 * > the same surface); `ControlType` → role map; `AutomationId` →
 * > `automationId` candidate; `controlPath` built from ancestor chain with names
 * > and sibling indices; `act` via UIA patterns (Invoke, Value, Toggle,
 * > Selection, Scroll) with a mouse/keyboard fallback at the element's box
 * > centre.
 *
 * ## Why PowerShell, and not a Node binding over COM
 *
 * §7.5 offers the choice: "a Node binding over the UI Automation COM API **or a
 * wrapped driver with the same surface**". A COM binding means `node-gyp`, a
 * compiler on every machine that installs the package, and a prebuild matrix —
 * and REQ-PKG-3 keeps the dependency tree permissive rather than merely
 * licensed. Windows already ships a client of exactly that API:
 * `UIAutomationClient`, in the .NET Framework, on every Windows installation
 * since Vista. Driving it through `powershell.exe` needs nothing installed and
 * nothing granted.
 *
 * This is the same trade the macOS adapter makes with System Events, and it
 * costs the same thing: a process per call, and a marshalled property read per
 * attribute. `docs/spec/progress/phase-6.md` records it as a deviation with the
 * measurement that is missing, because this host is not Windows.
 *
 * ## Why the bridge is an interface
 *
 * Everything above this file is a pure function of a `UiaNode[]`, so all of it
 * is testable against recorded trees on a machine that is not Windows — which
 * is the machine this was written on, and is why the interface exists rather
 * than being a convenience.
 */
import { spawn } from "node:child_process";
import { availableParallelism, loadavg } from "node:os";

/**
 * One automation element, flattened (LLD §7.5).
 *
 * Field names are UI Automation's own property names with the `UIA_`/`…Property`
 * decoration dropped, so a tree recorded from a real application can be read
 * against Microsoft's documentation without a translation table. Index 0 is the
 * root; `parent: -1` marks it.
 */
export interface UiaNode {
  /** Index of this node's parent in the same array; `-1` for the root. */
  readonly parent: number;
  /** `ControlType`, e.g. `Button`, with the `ControlType.` prefix dropped. */
  readonly controlType: string;
  /**
   * `LocalizedControlType`, when it says something the control type does not.
   *
   * Chromium publishes an ARIA `heading` as `ControlType.Text` and puts
   * "heading" here — UIA has no subrole, and this is where the refinement goes.
   */
  readonly localizedControlType?: string;
  /** `AutomationId` — on Windows, Chromium's is the DOM `id` (LLD §7.5). */
  readonly automationId?: string;
  /** `Name`: one name, wherever it came from. UIA has no title/description split. */
  readonly name?: string;
  /** `ClassName`, which for web content is Chromium's window class. */
  readonly className?: string;
  /** `HelpText`, which is a `title` attribute on the web. */
  readonly helpText?: string;
  /** `ValuePattern.Value` or `RangeValuePattern.Value`, as a string. */
  readonly value?: string;
  readonly isEnabled?: boolean;
  /** `IsOffscreen`: scrolled or clipped out of view. */
  readonly isOffscreen?: boolean;
  readonly hasKeyboardFocus?: boolean;
  /** `SelectionItemPattern.IsSelected`. */
  readonly isSelected?: boolean;
  /** `TogglePattern.ToggleState`. */
  readonly toggleState?: "On" | "Off" | "Indeterminate";
  /** `ExpandCollapsePattern.ExpandCollapseState`. */
  readonly expandCollapseState?: "Expanded" | "Collapsed" | "PartiallyExpanded" | "LeafNode";
  /** `BoundingRectangle`: `[x, y, width, height]`. */
  readonly box?: readonly [number, number, number, number];
  /** The control patterns the element supports: `Invoke`, `Value`, `Toggle`, … */
  readonly patterns?: readonly string[];
}

/**
 * What one `snapshot()` cost (Draft 2.8 §7.5).
 *
 * The same record the AX bridge publishes, and for the same reason: "The
 * desktop conformance report records nodes read, wall time, and milliseconds
 * per node." Both desktop reports then carry the same three numbers, so the two
 * bridges can be compared without reading either one's source.
 *
 * UI Automation is in-process COM inside one PowerShell invocation, so a
 * property read is a method call rather than an Apple event; there is no
 * per-attribute count to publish and `appleEvents` has no Windows equivalent.
 * The wall time and the cost per node are still what the ten-second surface
 * deadline is spent against, and are still measured on this side of the process
 * boundary, spawning PowerShell included.
 */
export interface UiaSnapshotCost {
  readonly nodes: number;
  readonly wallMs: number;
  readonly msPerNode: number;
  /** How many PowerShell processes the read took. One, by design. */
  readonly invocations: number;
  /**
   * The one-minute load average when the read finished (Draft 2.10 §7.5, P8-F2).
   *
   * The same reason as the AX bridge's: the budget is wall-clock, and a
   * wall-clock number with nothing beside it says as much about what else the
   * machine was running as about the bridge. Windows has no `getloadavg`, and
   * Node answers `[0, 0, 0]` there — which is reported as it is, a zero that
   * means "this platform does not have the number", rather than as a quiet
   * machine.
   */
  readonly loadAverage1m: number;
  /** How many logical CPUs that load is spread over. */
  readonly cpus: number;
}

/**
 * What the machine was doing when a read finished (Draft 2.10 §7.5, P8-F2).
 *
 * `loadavg()` is `[0, 0, 0]` on Windows, which is where this bridge runs. The
 * field is still recorded, because a report that carries the number on one
 * platform and omits it on another is two report formats, and because a UIA
 * bridge run through WSL or on a Windows build that grows the call would then
 * publish it without a change here.
 */
function machineLoad(): { loadAverage1m: number; cpus: number } {
  const [oneMinute = 0] = loadavg();
  return { loadAverage1m: Math.round(oneMinute * 100) / 100, cpus: availableParallelism() };
}

export interface UiaWindow {
  readonly process: string;
  /** The window's `Name`, which is what `state()` reports. */
  readonly title: string;
  readonly nodes: readonly UiaNode[];
  /** True when the walk stopped at `maxNodes` rather than at the leaves. */
  readonly truncated: boolean;
  readonly cost: UiaSnapshotCost;
}

/** Why UI Automation could not be reached. */
export type UiaAvailabilityState =
  | "available"
  /** Not Windows. */
  | "unsupported"
  /** Windows, but `UIAutomationClient` would not load. */
  | "unavailable";

export interface UiaAvailability {
  readonly state: UiaAvailabilityState;
  /** What to do about it, written for whoever ran `yam surface doctor`. */
  readonly advice: string;
  readonly detail?: string;
}

/** An action the bridge performs on one element, addressed by its path. */
export type UiaCommand =
  | { readonly kind: "pattern"; readonly path: readonly number[]; readonly pattern: string; readonly method: string; readonly argument?: string }
  | { readonly kind: "focus"; readonly path: readonly number[] }
  | { readonly kind: "keys"; readonly text: string }
  | { readonly kind: "click"; readonly at: readonly [number, number] }
  /** Give the main window a size (pattern 33, T12.7), through `MoveWindow`. */
  | { readonly kind: "setSize"; readonly size: readonly [number, number] }
  | { readonly kind: "activate" };

export interface UiaBridge {
  /** Is UI Automation reachable from here? */
  availability(): Promise<UiaAvailability>;
  window(request: { process: string; maxNodes: number }): Promise<UiaWindow>;
  perform(command: UiaCommand): Promise<void>;
  screenshot(path: string, box?: readonly [number, number, number, number]): Promise<void>;
}

export class UiaBridgeError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "UiaBridgeError";
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * The PowerShell runner.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * PowerShell's stderr, made readable (T7.2).
 *
 * When `powershell.exe` has its stderr redirected it does not write text: it
 * writes **CLIXML**, a serialised object stream that begins `#< CLIXML` and
 * carries the message inside `<S S="Error">` elements with control characters
 * escaped as `_x001B_`. The bridge put that straight into
 * `UiaBridgeError.detail`, so a real failure surfaced as a wall of XML with the
 * one useful sentence buried in it.
 *
 * Found by running these scripts against a real PowerShell, which is the first
 * time anything in this repository had (Phase 6 verification, F8/K10).
 */
export function readablePowershellError(stderr: string): string {
  const text = stderr.trim();
  if (!text.startsWith("#< CLIXML")) return stripAnsi(text);
  const parts = [...text.matchAll(/<S S="Error">([\s\S]*?)<\/S>/g)].map((m) => m[1] ?? "");
  const decoded = parts
    .join("")
    .replaceAll(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
  return stripAnsi(decoded).trim();
}

/** Colour codes belong to a terminal, not to an error message. */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replaceAll(/\u001b\[[0-9;]*m/g, "");
}

/**
 * The request, and the console, put where the script can reach them (T7.2).
 *
 * ## Why `-EncodedCommand` and not `-Command`
 *
 * The Phase 6 bridge spawned `powershell.exe -Command <script> -Request <json>`
 * and every script began with `param([string]$Request)`. That does not bind
 * anything. PowerShell's own documentation says it: when the value of
 * `-Command` is a *string*, "Command must be the last parameter in the command,
 * because any characters typed after the command are interpreted as the command
 * arguments" — so `-Request {"process":"Yam",…}` was appended to the
 * script as **text** and parsed as PowerShell.
 *
 * Run against a real PowerShell it fails before it reaches UI Automation at all:
 *
 * ```
 * ParserError:
 * Line |
 *    6 |  -Request {"process":"Yam","maxNodes":1500}
 *      |                     ~~~~~~~~~~~~~
 *      | Unexpected token ':"Yam"' in expression or statement.
 * ```
 *
 * Every UIA test injects its own runner, so nothing in this repository had ever
 * spawned the real thing, and the live Windows gate has never run (Phase 6
 * verification, F8/K10). This is the first defect T7.2's "fix what it finds"
 * found.
 *
 * `-EncodedCommand` takes base64 of UTF-16LE and has no argument list to get
 * wrong: the request is *assigned* in a preamble the encoder writes, with
 * single quotes doubled, which is PowerShell's own literal-string escape and
 * cannot be broken by anything JSON can contain.
 *
 * ## Why the preamble sets the console encoding
 *
 * A redirected `powershell.exe` writes stdout in the console code page, not
 * UTF-8, and Node reads UTF-8. The conformance target is an application whose
 * buttons are called "Open a project…" and "Import prototype database…" — every
 * one of those names would have arrived mangled. One line fixes it, and it has
 * to be the first line, before anything writes.
 */
export function encodePowershell(script: string, argument: unknown): string {
  const request = JSON.stringify(argument).replaceAll("'", "''");
  const preamble =
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n" +
    `$Request = '${request}'\n`;
  return Buffer.from(preamble + script, "utf16le").toString("base64");
}

/**
 * Run one PowerShell script, with a hard deadline.
 *
 * `-NoProfile` because a profile can print, and printed output would land in
 * the JSON. `-NonInteractive` because nobody is there to answer a prompt.
 * `-ExecutionPolicy Bypass` because the script arrives on the command line
 * rather than as a file, and a machine's policy is about files.
 *
 * `powershell.exe` rather than `pwsh`: `Add-Type -AssemblyName
 * UIAutomationClient` needs the .NET Framework assemblies, which PowerShell 7
 * does not carry. Windows PowerShell 5.1 is present on every Windows install.
 */
export async function runPowershell(
  script: string,
  argument: unknown,
  timeoutMs: number,
): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return await new Promise((resolve) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        encodePowershell(script, argument),
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
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

/** The smallest call that needs `UIAutomationClient` and nothing else. */
const AVAILABILITY_SCRIPT = `
try {
  Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
  Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  ConvertTo-Json -Compress @{ ok = $true; root = $root.Current.Name }
} catch {
  ConvertTo-Json -Compress @{ ok = $false; error = $_.Exception.Message }
}
`;

/**
 * One window's automation tree.
 *
 * Breadth-first with a node budget, so a truncated tree is the top of the
 * window rather than one deep branch of it. Every property read is guarded,
 * because an element that disappears between the walk finding it and the walk
 * reading it throws `ElementNotAvailableException` — a real and ordinary event
 * in a live application, and not a reason to lose the whole tree.
 */
const WINDOW_SCRIPT = `
$ErrorActionPreference = "Stop"
try {
  Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
  Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
} catch {
  # A host without UI Automation is a *host* answer, not a crash: without this
  # the script died with an unhandled Add-Type error, wrote nothing to stdout,
  # and the bridge reported "PowerShell answered something that is not JSON" —
  # a diagnostic that sends the reader to the wrong place. Found by running
  # these scripts against a real PowerShell (T7.2).
  ConvertTo-Json -Compress @{ ok = $false; error = "no-uiautomation: " + $_.Exception.Message }
  exit 0
}

$req = $Request | ConvertFrom-Json
$procs = Get-Process -Name $req.process -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 }
if (-not $procs) {
  ConvertTo-Json -Compress @{ ok = $false; error = "no-window" }
  exit 0
}
$handle = @($procs)[0].MainWindowHandle
$win = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
if ($null -eq $win) {
  ConvertTo-Json -Compress @{ ok = $false; error = "no-window" }
  exit 0
}

function Get-Prop($element, $property) {
  try { return $element.GetCurrentPropertyValue($property) } catch { return $null }
}
function Get-PatternNames($element) {
  $names = @()
  try {
    foreach ($p in $element.GetSupportedPatterns()) {
      $names += ($p.ProgrammaticName -replace "PatternIdentifiers.Pattern", "")
    }
  } catch { }
  # \`,\` keeps a one-element list a list. PowerShell unrolls a single-element
  # array on return, so an element supporting exactly one pattern answered
  # \`"Invoke"\` rather than \`["Invoke"]\` and \`ConvertTo-Json\` wrote a string —
  # which the adapter then called \`.includes()\` on, where it is a *substring*
  # test. The second defect T7.2 found (see \`encodePowershell\`).
  return ,@($names)
}

$AE = [System.Windows.Automation.AutomationElement]
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$nodes = New-Object System.Collections.ArrayList
$queue = New-Object System.Collections.Queue
$queue.Enqueue(@{ element = $win; parent = -1 })
$truncated = $false

while ($queue.Count -gt 0) {
  if ($nodes.Count -ge $req.maxNodes) { $truncated = $true; break }
  $item = $queue.Dequeue()
  $element = $item.element
  $index = $nodes.Count

  $rect = Get-Prop $element $AE::BoundingRectangleProperty
  $box = $null
  if ($null -ne $rect -and -not [double]::IsInfinity($rect.X)) {
    $box = @([int]$rect.X, [int]$rect.Y, [int]$rect.Width, [int]$rect.Height)
  }

  $controlType = Get-Prop $element $AE::ControlTypeProperty
  $node = @{
    parent      = $item.parent
    controlType = if ($null -eq $controlType) { "Custom" } else { $controlType.ProgrammaticName -replace "ControlType.", "" }
  }
  $localized = Get-Prop $element $AE::LocalizedControlTypeProperty
  if ($localized) { $node.localizedControlType = [string]$localized }
  $automationId = Get-Prop $element $AE::AutomationIdProperty
  if ($automationId) { $node.automationId = [string]$automationId }
  $name = Get-Prop $element $AE::NameProperty
  if ($name) { $node.name = [string]$name }
  $className = Get-Prop $element $AE::ClassNameProperty
  if ($className) { $node.className = [string]$className }
  $helpText = Get-Prop $element $AE::HelpTextProperty
  if ($helpText) { $node.helpText = [string]$helpText }
  $enabled = Get-Prop $element $AE::IsEnabledProperty
  if ($null -ne $enabled) { $node.isEnabled = [bool]$enabled }
  $offscreen = Get-Prop $element $AE::IsOffscreenProperty
  if ($null -ne $offscreen) { $node.isOffscreen = [bool]$offscreen }
  $focus = Get-Prop $element $AE::HasKeyboardFocusProperty
  if ($focus) { $node.hasKeyboardFocus = $true }
  if ($box) { $node.box = $box }

  $patterns = @(Get-PatternNames $element)
  if ($patterns.Count -gt 0) { $node.patterns = $patterns }

  try {
    $value = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($value) { $node.value = [string]$value.Current.Value }
  } catch { }
  try {
    $toggle = $element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    if ($toggle) { $node.toggleState = [string]$toggle.Current.ToggleState }
  } catch { }
  try {
    $sel = $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
    if ($sel) { $node.isSelected = [bool]$sel.Current.IsSelected }
  } catch { }
  try {
    $exp = $element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
    if ($exp) { $node.expandCollapseState = [string]$exp.Current.ExpandCollapseState }
  } catch { }

  [void]$nodes.Add($node)

  try {
    $child = $walker.GetFirstChild($element)
    while ($null -ne $child) {
      $queue.Enqueue(@{ element = $child; parent = $index })
      $child = $walker.GetNextSibling($child)
    }
  } catch { }
}

$title = Get-Prop $win $AE::NameProperty
ConvertTo-Json -Compress -Depth 6 @{
  ok        = $true
  process   = $req.process
  title     = if ($null -eq $title) { "" } else { [string]$title }
  nodes     = @($nodes)
  truncated = $truncated
}
`;

/**
 * One command.
 *
 * An element is addressed by its **path** — the child index at each level from
 * the window down — because a UIA `AutomationElement` is a COM object that does
 * not survive between PowerShell processes. The path is what the snapshot's
 * walk already produced.
 */
const PERFORM_SCRIPT = `
$ErrorActionPreference = "Stop"
try {
  Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
  Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
} catch {
  # A host without UI Automation is a *host* answer, not a crash: without this
  # the script died with an unhandled Add-Type error, wrote nothing to stdout,
  # and the bridge reported "PowerShell answered something that is not JSON" —
  # a diagnostic that sends the reader to the wrong place. Found by running
  # these scripts against a real PowerShell (T7.2).
  ConvertTo-Json -Compress @{ ok = $false; error = "no-uiautomation: " + $_.Exception.Message }
  exit 0
}
Add-Type -AssemblyName System.Windows.Forms

$cmd = $Request | ConvertFrom-Json
$procs = Get-Process -Name $cmd.process -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 }
if (-not $procs) { ConvertTo-Json -Compress @{ ok = $false; error = "no-window" }; exit 0 }
$handle = @($procs)[0].MainWindowHandle

if ($cmd.kind -eq "activate") {
  [void][System.Windows.Forms.SendKeys]::Flush()
  $win = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  try { $win.SetFocus() } catch { }
  ConvertTo-Json -Compress @{ ok = $true }
  exit 0
}
if ($cmd.kind -eq "setSize") {
  # "Resize the window to <w> by <h>" (pattern 33, T12.7). UIA's TransformPattern
  # is optional and Chromium's top-level window does not publish it, so the
  # window is moved through the same Win32 call a person's drag ends up in. The
  # position is left where it is: SWP_NOMOVE.
  Add-Type -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr a, int X, int Y, int cx, int cy, uint f);
"@ -Name Window -Namespace Yam
  [void][Yam.Window]::SetWindowPos($handle, [IntPtr]::Zero, 0, 0, $cmd.size[0], $cmd.size[1], 0x0006)
  ConvertTo-Json -Compress @{ ok = $true }
  exit 0
}
if ($cmd.kind -eq "keys") {
  [System.Windows.Forms.SendKeys]::SendWait($cmd.text)
  ConvertTo-Json -Compress @{ ok = $true }
  exit 0
}
if ($cmd.kind -eq "click") {
  Add-Type -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
[DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, uint d, int e);
"@ -Name Mouse -Namespace Yam
  [void][Yam.Mouse]::SetCursorPos($cmd.at[0], $cmd.at[1])
  [Yam.Mouse]::mouse_event(0x0002, 0, 0, 0, 0)
  [Yam.Mouse]::mouse_event(0x0004, 0, 0, 0, 0)
  ConvertTo-Json -Compress @{ ok = $true }
  exit 0
}

$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$element = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
foreach ($step in $cmd.path) {
  $child = $walker.GetFirstChild($element)
  for ($i = 0; $i -lt $step -and $null -ne $child; $i++) { $child = $walker.GetNextSibling($child) }
  if ($null -eq $child) { ConvertTo-Json -Compress @{ ok = $false; error = "stale-path" }; exit 0 }
  $element = $child
}

try {
  if ($cmd.kind -eq "focus") { $element.SetFocus() }
  elseif ($cmd.kind -eq "pattern") {
    switch ($cmd.pattern) {
      "Invoke" {
        $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
      }
      "Value" {
        $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($cmd.argument)
      }
      "Toggle" {
        $element.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern).Toggle()
      }
      "SelectionItem" {
        $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
      }
      "ExpandCollapse" {
        $p = $element.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)
        if ($cmd.method -eq "Collapse") { $p.Collapse() } else { $p.Expand() }
      }
      "Scroll" {
        $element.GetCurrentPattern([System.Windows.Automation.ScrollItemPattern]::Pattern).ScrollIntoView()
      }
      default { ConvertTo-Json -Compress @{ ok = $false; error = "no-such-pattern" }; exit 0 }
    }
  }
} catch {
  ConvertTo-Json -Compress @{ ok = $false; error = $_.Exception.Message }
  exit 0
}
ConvertTo-Json -Compress @{ ok = $true }
`;

const SCREENSHOT_SCRIPT = `
$ErrorActionPreference = "Stop"
try {
  Add-Type -AssemblyName System.Drawing -ErrorAction Stop
  Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
} catch {
  # Same rule as the other three (T7.2): a host that cannot do this answers,
  # rather than dying with a pipeline exception and no stdout.
  ConvertTo-Json -Compress @{ ok = $false; error = "no-drawing: " + $_.Exception.Message }
  exit 0
}
$req = $Request | ConvertFrom-Json
$bounds = if ($req.box) {
  New-Object System.Drawing.Rectangle($req.box[0], $req.box[1], $req.box[2], $req.box[3])
} else {
  [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
}
$bitmap = New-Object System.Drawing.Bitmap($bounds.Width, $bounds.Height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
$graphics.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$bitmap.Save($req.path, [System.Drawing.Imaging.ImageFormat]::Png)
$graphics.Dispose()
$bitmap.Dispose()
ConvertTo-Json -Compress @{ ok = $true }
`;

export interface PowershellBridgeOptions {
  /** The process to drive, without `.exe`: the app is `Yam`. */
  readonly process: string;
  readonly timeoutMs?: number;
  /** For tests: run a script without spawning anything. */
  readonly run?: typeof runPowershell;
  /**
   * For tests: the platform to answer for, `process.platform` unless given. The
   * "not Windows" test asked the machine it ran on, and on the Windows runner
   * the answer was Windows, so it reached a `run` that answers nothing.
   */
  readonly platform?: NodeJS.Platform;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const AVAILABILITY_TIMEOUT_MS = 10_000;

/** The real bridge: PowerShell, `UIAutomationClient`, and this machine. */
export function powershellBridge(options: PowershellBridgeOptions): UiaBridge {
  const run = options.run ?? runPowershell;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const platform = options.platform ?? process.platform;

  const call = async (script: string, argument: unknown, ms: number): Promise<unknown> => {
    const result = await run(script, argument, ms);
    if (result.timedOut) {
      throw new UiaBridgeError(
        `The UI Automation call did not answer within ${ms} ms. A window that is not ` +
          "responding, or a tree far larger than the node budget, both look like this.",
      );
    }
    if (result.code !== 0) {
      throw new UiaBridgeError(
        "PowerShell refused the UI Automation call.",
        readablePowershellError(result.stderr) || result.stdout.trim(),
      );
    }
    try {
      return JSON.parse(result.stdout) as unknown;
    } catch {
      throw new UiaBridgeError(
        "PowerShell answered something that is not JSON.",
        result.stdout.trim() || readablePowershellError(result.stderr),
      );
    }
  };

  return {
    async availability(): Promise<UiaAvailability> {
      if (platform !== "win32") {
        return {
          state: "unsupported",
          advice:
            "The Windows UI Automation adapter runs on Windows only. Use `--adapter ax` on " +
            "macOS, or `--adapter playwright` for a web application.",
        };
      }
      const result = await run(AVAILABILITY_SCRIPT, {}, AVAILABILITY_TIMEOUT_MS);
      if (!result.timedOut && result.code === 0 && result.stdout.includes('"ok":true')) {
        return { state: "available", advice: "UI Automation is reachable." };
      }
      const detail = readablePowershellError(result.stderr) || result.stdout.trim();
      return {
        state: "unavailable",
        advice:
          "`UIAutomationClient` would not load. It ships with the .NET Framework on every " +
          "Windows installation, so this usually means PowerShell itself is constrained: " +
          "check that `powershell.exe` is on PATH and that a Constrained Language Mode " +
          "policy is not in force. Unlike macOS, UI Automation needs no permission grant — " +
          "but a process running at a higher integrity level than Yam is invisible to " +
          "it, so an application started as administrator needs Yam started the same way.",
        ...(detail === "" ? {} : { detail }),
      };
    },

    async window(request): Promise<UiaWindow> {
      const startedAt = Date.now();
      const answer = (await call(WINDOW_SCRIPT, request, timeoutMs)) as {
        ok: boolean;
        error?: string;
        process?: string;
        title?: string;
        nodes?: UiaNode[];
        truncated?: boolean;
      };
      if (!answer.ok) {
        throw new UiaBridgeError(
          answer.error === "no-window"
            ? `The process "${request.process}" has no main window. Is it running, and not ` +
              "minimised to the tray? A process at a higher integrity level than Yam is " +
              "also invisible to UI Automation."
            : `The UI Automation call failed: ${answer.error ?? "unknown"}.`,
        );
      }
      const wallMs = Date.now() - startedAt;
      const nodes = answer.nodes ?? [];
      return {
        process: answer.process ?? request.process,
        title: answer.title ?? "",
        nodes,
        truncated: answer.truncated === true,
        cost: {
          nodes: nodes.length,
          wallMs,
          msPerNode: nodes.length === 0 ? wallMs : Math.round((wallMs / nodes.length) * 100) / 100,
          invocations: 1,
          ...machineLoad(),
        },
      };
    },

    async perform(command): Promise<void> {
      const answer = (await call(
        PERFORM_SCRIPT,
        { ...command, process: options.process },
        timeoutMs,
      )) as { ok: boolean; error?: string };
      if (!answer.ok) {
        throw new UiaBridgeError(`The UI Automation action failed: ${answer.error ?? "unknown"}.`);
      }
    },

    async screenshot(path, box): Promise<void> {
      await call(
        SCREENSHOT_SCRIPT,
        { path, ...(box === undefined ? {} : { box: [...box] }) },
        timeoutMs,
      ).catch(() => undefined);
    },
  };
}
