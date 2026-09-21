# The Yam agent surface

The contract an adapter implements.

Everything above this line — the compiler, the recorder, the executor, the healer,
the behaviors — knows nothing about locators, protocols or platforms. It calls
`snapshot`, `act`, `read`, `check`, `locate`, `describe`, `state` and `restore`,
and addresses elements by reference or by a stored candidate. That is the whole
boundary (REQ-SURF-2, REQ-SURF-5).

The TypeScript interface lives in
[`@svatah/yam-surface`](../packages/surface/src/surface.ts). The wire shapes are
generated from Zod and published as JSON Schema under
[`packages/schema/json/`](../packages/schema/json/), so an adapter written in
another language has the same contract without reading TypeScript.

- Design: [LLD §2](spec/lld.md), [HLD §5.1](spec/hld.md)
- Requirements: REQ-SURF-1, REQ-SURF-2, REQ-SURF-3, REQ-SURF-4, REQ-SURF-5

---

## 1. The interface

```ts
interface AgentSurface {
  readonly kind: "web" | "mobile" | "desktop" | "http";

  capabilities(): Capabilities;
  open(session: SessionInit): Promise<void>;
  close(): Promise<void>;

  snapshot(opts?: { root?: Ref; maxNodes?: number; interactiveOnly?: boolean }): Promise<Snapshot>;
  act(action: SurfaceAction, ref?: Ref, args?: ActArgs, ref2?: Ref): Promise<ActResult>;
  read(kind: "text" | "value" | "attribute" | "title" | "url" | "result", ref?: Ref, name?: string): Promise<unknown>;
  check(predicate: Predicate, subject: "ref" | "page" | "dialog", ref?: Ref): Promise<CheckResult>;

  locate(candidate: Candidate): Promise<Ref[]>;
  describe(ref: Ref): Promise<ElementDescription>;
  screenshot(path: string, mask?: Ref[]): Promise<void>;
  state(): Promise<SessionState>;
  restore(state: SessionState): Promise<void>;

  trace?(start: boolean, path?: string): Promise<void>;
  request?(req: ApiRequest, opts: { withSessionCookies: boolean }): Promise<ApiResponse>;
  pick?(phrase: string, opts?: { id?: string; timeoutMs?: number; signal?: AbortSignal }): Promise<Ref | undefined>;
  observe?(handler: (event: ObservedEvent) => void | Promise<void>, opts?: { signal?: AbortSignal }): Promise<void>;
  cookies?(url: string): Promise<Record<string, string>>;
}
```

### Every method

| Method | Required | What it must do | Wire schema |
|---|---|---|---|
| `capabilities` | yes | Return which optional features this adapter has. Must be cheap and callable before `open`. | `surface.capabilities.schema.json` |
| `open` | yes | Start a session: launch or attach, apply `storageState` / `appPath` / `processName` / `baseUrl`. Throw `SessionError` on failure. | `surface.session-init.schema.json` |
| `close` | yes | End the session and release the driver. Must be safe to call twice. | — |
| `snapshot` | yes | Return the normalised semantic tree with stable references. See §2. | `surface.snapshot.schema.json` |
| `act` | yes | Perform one action, by reference. See §4. | `surface.act.schema.json` |
| `read` | yes | Read one value: element text or value, an attribute, the page title or URL, or the last action's result. | `surface.read.schema.json` |
| `check` | yes | Evaluate one predicate against an element, the page or a dialog. Return `{ ok }` — do not throw when the predicate is simply false. | `surface.check.schema.json` |
| `locate` | yes | Turn one stored `Candidate` into 0, 1 or many references. The resolver requires exactly one. See §5. | `surface.locate.schema.json` |
| `describe` | yes | Return everything candidate synthesis and fingerprinting need for one element. | `surface.element-description.schema.json` |
| `screenshot` | yes | Write a screenshot to `path`, blanking the boxes in `mask`. Masking is how secret-injecting steps stay out of artifacts (REQ-NFR-6). | — |
| `state` | yes | Return the restorable subset of session state. This is what a checkpoint stores. | `surface.session-state.schema.json` |
| `restore` | yes | Put the session back into a previously returned state. | `surface.session-state.schema.json` |
| `trace` | optional | Start or stop adapter tracing. Present only when `capabilities().trace`. | — |
| `request` | optional | Execute a named HTTP request, optionally sharing the web session's cookies (REQ-ADP-3). | `surface.api-request.schema.json`, `surface.api-response.schema.json` |
| `pick` | optional | Put an overlay over the application naming `phrase`, wait for a person's click, and return the element clicked as a reference; `undefined` when the person cancelled. `opts.id` is the element id, so a scripted pick can answer it. Present only when `capabilities().pick` (Draft 2.21, REQ-REC-12). | — |
| `observe` | optional | Report what a person does in the session — each click, value typed, choice, key and navigation — as an `ObservedEvent` with the element acted on as a reference, as it happens; resolve when the session closes or `opts.signal` aborts. Present only when `capabilities().observe` (Draft 2.23, REQ-REC-13). | — |
| `cookies` | optional | The cookies the session would send to `url`, by name: what an API step `with the session cookies` sends as the signed-in person (REQ-ADP-3). A surface with no cookie jar omits it. | — |

An adapter that does not implement `trace`, `request`, `pick`, `observe` or `cookies` must omit them, not
implement them as throwing stubs — callers check for presence.

### Every capability flag

`capabilities()` returns exactly these twelve booleans. Default every one to `false`
and opt in to what you actually support: the executor checks a plan against them
**before the run starts**, so a missing feature is a refusal to begin rather than a
failure halfway through a flow (LLD §2.4).

| Flag | Meaning | Actions it gates |
|---|---|---|
| `dialogs` | Native dialogs can be observed and answered. | `dialog` |
| `frames` | The session has addressable frames. | `switchFrame` |
| `windows` | The session can have more than one window or page. | `switchWindow`, `closeOtherWindows`, `resizeWindow` |
| `upload` | Files can be attached to a file control. | `upload` |
| `drag` | One element can be dragged onto another. | `dragTo` |
| `trace` | `trace()` is implemented. | — |
| `pick` | The adapter can overlay the application and take a person's click as an element; what the recorder's human gateway needs (Draft 2.21). The Playwright adapter has it. | — |
| `observe` | The adapter can report what a person does in the session as events on elements; what `yam record` captures a flow from (Draft 2.23). The Playwright adapter has it. | — |
| `windowChrome` | The snapshot carries the window's own close, minimise and zoom controls (Draft 2.29). `ax` publishes them as subroles of the window and `uia` as the window element's `WindowPattern`. `atspi` answers `false`: on Linux the decorations belong to the window manager's process and are in no application's tree. A page or a phone screen has none. | — |
| `webmcp` | The adapter can read a page's declared tools and call one (REQ-ADP-9). Says nothing about whether the *current* page declares any — that is `locate({ by: "webmcp" })`, asked per resolution. | — |
| `screenshot` | `screenshot()` produces an image. | `screenshot` |
| `restore` | `restore()` can put the session back into a stored state. | — |

Everything not listed above — clicking, typing, navigating, scrolling, reading,
waiting — every adapter must support.

---

## 2. The snapshot

`snapshot()` is the primary input to grounding (REQ-REC-2) and the source of the
context hash (LLD §6.2). Its shape is identical whether the tree came from ARIA,
UIA, AX, AT-SPI or an Appium page source (REQ-SURF-4). The AT-SPI adapter is
implemented and has not yet been driven against a live accessibility bus (see
the [support matrix](reference/generated/support-matrix.md)).

```ts
interface Snapshot { ref: Ref; nodes: SnapshotNode[]; text: string; tokensEstimate: number; hash: string; }

interface SnapshotNode {
  ref: Ref;                     // "r12" style; opaque above the surface
  role: string;                 // always an ARIA role — see §3
  name?: string; value?: string; description?: string;
  states: Array<"disabled" | "checked" | "unchecked" | "selected" | "expanded"
               | "collapsed" | "focused" | "required" | "hidden" | "readonly">;
  box?: [number, number, number, number];
  depth: number; parent?: Ref;
  native?: Record<string, string>;
}
```

Rules an adapter must honour:

1. **References are stable within a snapshot** and map back to the same element for
   as long as the snapshot is current. They are opaque above the surface: never
   encode a locator in one.
2. **Nodes are in document order**, parents before children, so the rendering is
   deterministic.
3. **`role` is always an ARIA role.** Map your platform's vocabulary with the tables
   in §3. An unmapped control becomes `generic` and still appears — never drop it.
4. **`native` carries adapter-specific extras** (`data-testid`, `AutomationId`,
   `resource-id`). Nothing above the surface reads it except candidate synthesis.
5. **`text` is the rendering below**, produced by `renderSnapshot` from
   `@svatah/yam-surface` so every adapter's prompt input reads the same.
6. **`hash` is the structural hash** of LLD §6.2, computed from this tree rather
   than from the DOM, which is what makes it adapter-neutral.

The rendering is one node per line, indented by depth, with the reference last:

```
- form "Sign in" [ref=r1]
  - textbox "Username": atul [required] [ref=r2]
  - button "Sign in" [disabled, focused] [ref=r3]
```

Use `buildSnapshot(root, nodes, hash)` rather than assembling `text` and
`tokensEstimate` yourself.

---

## 3. Role mapping

`SnapshotNode.role` is an ARIA role whatever the source tree was. These tables are
generated from [`packages/surface/src/roles.ts`](../packages/surface/src/roles.ts),
which is the source of truth; a test regenerates them and fails if this document
drifts. Anything absent from a table maps to `generic`.

Webview contexts already expose ARIA roles and need no mapping.

### 3.1 Windows UI Automation (REQ-ADP-6)

<!-- generated:uia -->
| UIA `ControlType` | Surface role |
|---|---|
| `AppBar` | `toolbar` |
| `Button` | `button` |
| `Calendar` | `grid` |
| `CheckBox` | `checkbox` |
| `ComboBox` | `combobox` |
| `Custom` | `generic` |
| `DataGrid` | `grid` |
| `DataItem` | `row` |
| `Document` | `document` |
| `Edit` | `textbox` |
| `Group` | `group` |
| `Header` | `rowgroup` |
| `HeaderItem` | `columnheader` |
| `Hyperlink` | `link` |
| `Image` | `img` |
| `List` | `listbox` |
| `ListItem` | `option` |
| `Menu` | `menu` |
| `MenuBar` | `menubar` |
| `MenuItem` | `menuitem` |
| `Pane` | `group` |
| `ProgressBar` | `progressbar` |
| `RadioButton` | `radio` |
| `ScrollBar` | `scrollbar` |
| `Separator` | `separator` |
| `Slider` | `slider` |
| `Spinner` | `spinbutton` |
| `SplitButton` | `button` |
| `StatusBar` | `status` |
| `Tab` | `tablist` |
| `TabItem` | `tab` |
| `Table` | `table` |
| `Text` | `text` |
| `Thumb` | `generic` |
| `TitleBar` | `banner` |
| `ToolBar` | `toolbar` |
| `ToolTip` | `tooltip` |
| `Tree` | `tree` |
| `TreeItem` | `treeitem` |
| `Window` | `window` |
<!-- /generated:uia -->

Candidate kinds on this platform: `automationId` (from `AutomationId`),
`controlPath` (`Window[name]/Pane[2]/Button[name]`), then `coords`.

### 3.2 macOS Accessibility (REQ-ADP-7)

<!-- generated:ax -->
| macOS `AXRole` | Surface role |
|---|---|
| `AXApplication` | `application` |
| `AXBrowser` | `group` |
| `AXBusyIndicator` | `progressbar` |
| `AXButton` | `button` |
| `AXCell` | `cell` |
| `AXCheckBox` | `checkbox` |
| `AXColorWell` | `button` |
| `AXColumn` | `group` |
| `AXComboBox` | `combobox` |
| `AXDisclosureTriangle` | `button` |
| `AXDrawer` | `group` |
| `AXGroup` | `group` |
| `AXGrowArea` | `generic` |
| `AXHeading` | `heading` |
| `AXHelpTag` | `tooltip` |
| `AXImage` | `img` |
| `AXIncrementor` | `spinbutton` |
| `AXLink` | `link` |
| `AXList` | `listbox` |
| `AXMenu` | `menu` |
| `AXMenuBar` | `menubar` |
| `AXMenuButton` | `button` |
| `AXMenuItem` | `menuitem` |
| `AXOutline` | `tree` |
| `AXOutlineRow` | `treeitem` |
| `AXPopUpButton` | `combobox` |
| `AXProgressIndicator` | `progressbar` |
| `AXRadioButton` | `radio` |
| `AXRadioGroup` | `radiogroup` |
| `AXRow` | `row` |
| `AXScrollArea` | `group` |
| `AXScrollBar` | `scrollbar` |
| `AXSecureTextField` | `textbox` |
| `AXSheet` | `dialog` |
| `AXSlider` | `slider` |
| `AXSplitGroup` | `group` |
| `AXSplitter` | `separator` |
| `AXStaticText` | `text` |
| `AXTabGroup` | `tablist` |
| `AXTable` | `table` |
| `AXTextArea` | `textbox` |
| `AXTextField` | `textbox` |
| `AXToolbar` | `toolbar` |
| `AXUnknown` | `generic` |
| `AXValueIndicator` | `generic` |
| `AXWebArea` | `document` |
| `AXWindow` | `window` |
<!-- /generated:ax -->

Candidate kinds: `automationId` (from `AXIdentifier`, falling back to
`aria-label`), `controlPath`, then `coords`. The adapter must document the
accessibility permission grant and offer `yam surface doctor` to check it.

### 3.3 Appium, native Android (REQ-ADP-5)

<!-- generated:appium -->
| Android class | Surface role |
|---|---|
| `android.app.Dialog` | `dialog` |
| `android.view.View` | `generic` |
| `android.view.ViewGroup` | `group` |
| `android.webkit.WebView` | `document` |
| `android.widget.Button` | `button` |
| `android.widget.CheckBox` | `checkbox` |
| `android.widget.CheckedTextView` | `option` |
| `android.widget.EditText` | `textbox` |
| `android.widget.FrameLayout` | `group` |
| `android.widget.HorizontalScrollView` | `group` |
| `android.widget.ImageButton` | `button` |
| `android.widget.ImageView` | `img` |
| `android.widget.LinearLayout` | `group` |
| `android.widget.ListView` | `list` |
| `android.widget.NumberPicker` | `spinbutton` |
| `android.widget.ProgressBar` | `progressbar` |
| `android.widget.RadioButton` | `radio` |
| `android.widget.RadioGroup` | `radiogroup` |
| `android.widget.RatingBar` | `slider` |
| `android.widget.RelativeLayout` | `group` |
| `android.widget.ScrollView` | `group` |
| `android.widget.SearchView` | `searchbox` |
| `android.widget.SeekBar` | `slider` |
| `android.widget.Spinner` | `combobox` |
| `android.widget.Switch` | `switch` |
| `android.widget.TabWidget` | `tablist` |
| `android.widget.TextView` | `text` |
| `android.widget.ToggleButton` | `switch` |
| `android.widget.Toolbar` | `toolbar` |
| `androidx.recyclerview.widget.RecyclerView` | `list` |
<!-- /generated:appium -->

Names come from `content-desc`, falling back to `text`; boxes come from `bounds`.
Candidate kinds: `accessibilityId`, `resourceId`, `xpath`. iOS is not scheduled and
has no table yet.

### 3.4 AT-SPI, the Linux desktop (REQ-ADP-7, SF-23)

AT-SPI2 publishes an application's tree on a D-Bus of its own; the role is the
phrase `Accessible.getRoleName()` returns.

<!-- generated:atspi -->
| AT-SPI role name | Surface role |
|---|---|
| `application` | `application` |
| `check box` | `checkbox` |
| `check menu item` | `menuitemcheckbox` |
| `column header` | `columnheader` |
| `combo box` | `combobox` |
| `dialog` | `dialog` |
| `document` | `document` |
| `document frame` | `document` |
| `document web` | `document` |
| `entry` | `textbox` |
| `filler` | `generic` |
| `frame` | `window` |
| `heading` | `heading` |
| `icon` | `img` |
| `image` | `img` |
| `label` | `text` |
| `link` | `link` |
| `list` | `list` |
| `list box` | `listbox` |
| `list item` | `listitem` |
| `menu` | `menu` |
| `menu bar` | `menubar` |
| `menu item` | `menuitem` |
| `page tab` | `tab` |
| `page tab list` | `tablist` |
| `panel` | `group` |
| `password text` | `textbox` |
| `progress bar` | `progressbar` |
| `push button` | `button` |
| `radio button` | `radio` |
| `radio menu item` | `menuitemradio` |
| `row header` | `rowheader` |
| `scroll bar` | `scrollbar` |
| `scroll pane` | `group` |
| `section` | `group` |
| `separator` | `separator` |
| `slider` | `slider` |
| `spin button` | `spinbutton` |
| `split pane` | `group` |
| `statusbar` | `status` |
| `table` | `table` |
| `table cell` | `cell` |
| `table column header` | `columnheader` |
| `table row` | `row` |
| `table row header` | `rowheader` |
| `text` | `text` |
| `toggle button` | `button` |
| `tool bar` | `toolbar` |
| `tool tip` | `tooltip` |
| `tree` | `tree` |
| `tree item` | `treeitem` |
| `tree table` | `treegrid` |
| `viewport` | `group` |
| `window` | `window` |
<!-- /generated:atspi -->

Names come from `Accessible.Name`, falling back to the description and then to
the element's text; the `automationId` comes from the `accessible-id` object
attribute (GTK) or `id` (Qt), which is the same fact `AXIdentifier` carries on
macOS and `AutomationId` on Windows. Boxes come from `Component.GetExtents`.
Candidate kinds: `automationId`, `role`, `name`, `text`, `label`.

The adapter is **implemented and unvalidated here**: its tree mapping,
reference scope, state inversion, action selection and refusals are driven by
`packages/adapter-atspi/test/tree.test.ts` against recorded trees, and its
conversation with a live registry is not, because no Linux runner is
provisioned. The generated support matrix says the same thing with what would
have to be true beside it.

---

## 4. Actions

`act(action, ref, args, ref2)` takes the IR action set minus `api`, `custom` and
`expect`, which the executor handles itself. `ref2` is only used by two-element
actions such as `dragTo`.

| Group | Actions |
|---|---|
| Navigation | `navigate`, `back`, `forward`, `refresh` |
| Pointer | `click`, `doubleClick`, `rightClick`, `hover`, `hoverAndClick`, `pressAndHold`, `release`, `dragTo` |
| Keyboard and input | `type`, `clear`, `press`, `keyDown`, `keyUp`, `submit`, `upload` |
| Selection | `selectOption`, `deselectOption`, `deselectAll`, `setChecked` |
| Scrolling | `scrollIntoView`, `scrollToTop`, `scrollToBottom` |
| Waiting | `sleep`, `waitFor` — on an element with a reference, or on the page with `text`, `url` or `title` and none |
| Windows and frames | `switchWindow`, `closeOtherWindows`, `switchFrame`, `resizeWindow` |
| Application lifecycle | `quit` |
| Dialogs | `dialog` |
| Reading and diagnostics | `read`, `evaluate`, `screenshot` |
| Story composition | `invoke` |

An adapter must implement every action its capabilities claim. Actions that need a
capability it does not have are never sent, because the executor refuses the plan
at start.

**`quit` is a desktop action** (T11.2, LLD §13.9). A desktop adapter ends the
session through the application's own graceful route — an Apple-event `quit` on
macOS, `CloseMainWindow` on Windows — then a signal, then `SIGKILL`, and *fails*
when the process survives all three: a signal that ends a main process where it
stands leaves whatever it had spawned behind. A web adapter refuses it, exactly
as a desktop adapter refuses `navigate` (REQ-SURF-5): a browser tab is not an
application a flow closes, and a silent no-op would let a desktop flow "pass"
against something it never quit.

The other half is `app.launch`: a desktop session **opens by launching** when no
process of that name owns a window. "Owns a window", not "is running" — a
process that is still exiting and a helper that shares its application's name are
both running and neither can be driven. A session that found the application
already up does not remember a launch and will not quit it.

---

## 5. `locate` and candidates

`locate(candidate)` is how the resolver replays a stored binding. It returns every
reference the candidate matches — 0, 1 or many — and does **not** throw when there
is no match; the resolver decides what a zero or a multiple means (LLD §6.3).

| Group | Kinds |
|---|---|
| Web | `role`, `label`, `placeholder`, `testid`, `text`, `altText`, `title`, `css`, `xpath`, `id`, `name` |
| Mobile | `accessibilityId`, `resourceId` |
| Desktop | `automationId`, `controlPath` |
| Declared tools | `webmcp` |
| Last resort | `coords` |

An adapter implements the kinds its platform has and returns an empty array for a
kind it cannot express. It must never fall back to a different kind silently: the
matched `by` is recorded in the results and compared across runtimes (REQ-STD-3).

### `webmcp` is the one kind that does not name an element

A `webmcp` candidate names a **tool the page declared**, so `locate` answers with
a reference no `describe` will accept and no element backs — the Playwright
adapter mints `wN` for it, and `act` on that reference calls the tool rather than
clicking anything.

Two properties follow, and both are LLD §6.3:

* **The resolver prefers it**, ahead of every locator, in a branch of its own
  rather than by score. The site is telling you what the control does; a locator
  is telling you where it was.
* **It is asked per resolution.** A page that has stopped declaring the tool
  answers `locate` with nothing, and the locators recorded behind it in the same
  binding are tried instead — in the same run, with nothing re-recorded. That is
  what makes preferring a draft web API safe.

---

## 6. Errors

Adapters throw typed errors. Each carries the failure class the executor records,
so LLD §8.4's mapping is data on the error rather than a switch above the surface.

| Error | Failure class | Throw it when |
|---|---|---|
| `LocateError` | `locator` | A reference is unknown, or a candidate matched the wrong number of elements. |
| `ActionabilityError` | `timeout` | The element exists but is not in a state that permits the action. |
| `TimeoutError` | `timeout` | An operation exceeded its timeout. |
| `CheckError` | `assertion` | A predicate could not be evaluated. A predicate that is simply false returns `{ ok: false }` instead. |
| `DialogError` | `dialog` | A dialog was expected and absent, unexpected and present, or unanswerable. |
| `NavigationError` | `navigation` | Navigation failed, timed out, or landed somewhere unexpected. |
| `ScriptError` | `script` | An injected or evaluated script threw. |
| `SessionError` | `infrastructure` | The session could not be opened, was lost, or the driven process crashed. |
| `DataError` | `data` | A value was missing or of the wrong type. |
| `UnsupportedError` | `infrastructure` | This adapter cannot perform the action at all. The broker answers `UNSUPPORTED_OPERATION`, refused, because nothing was dispatched. |
| `PermissionError` | `infrastructure` | A platform permission, such as macOS Accessibility, is not granted to the program that is driving. A `SessionError`; the broker answers `PERMISSION_REQUIRED`. |

Anything that is not a `SurfaceError` is classified `unknown`, so a leaked native
error shows up in the results rather than being silently miscategorised.

---

## 7. Registration

```ts
import { registerAdapter } from "@svatah/yam-surface";

registerAdapter("playwright", (config) => new PlaywrightSurface(config));
```

Only the CLI registers adapters; the import-boundary lint forbids every other
package from importing an `adapter-*` package (REQ-SURF-2). Registering the same
name twice is an error rather than a silent replacement, because which
implementation ran must not depend on import order.

`createSurface(config)` builds the adapter named by `config.adapter`.

---

## 8. Conformance

An adapter is **conformant** only when the surface conformance suite passes against
it (REQ-SURF-3, LLD §14):

```bash
yam surface conform --adapter <name>
```

The suite is a fixed script of surface calls per sample page with expected snapshot
invariants, expected effects, and expected error types. It ships in
`@svatah/yam-conformance` and is runnable by third parties (REQ-STD-2). The suite and
the `yam surface conform` command are built in T1.2; Phase 0 publishes the
contract they check.

## 9. Checklist for a new adapter

1. Implement every required method in §1; omit `trace`, `request`, `pick` and `observe` if you do not
   have them.
2. Return honest `capabilities()`.
3. Normalise roles with the tables in §3; map unknowns to `generic`, never drop.
4. Build snapshots with `buildSnapshot` so the rendering matches every other adapter.
5. Implement the candidate kinds your platform has; return `[]` for the rest.
6. Throw the typed errors in §6 — never a bare `Error`.
7. Register the adapter from the CLI only.
8. Pass `yam surface conform --adapter <name>`.
