/**
 * Role normalisation (LLD §2.2, REQ-SURF-4).
 *
 * `SnapshotNode.role` is always an ARIA role, whatever the source tree was. These
 * tables are the mapping each adapter applies, and they are the source of truth
 * for the tables printed in `docs/agent-surface.md` — a test regenerates the doc's
 * tables from here, so the two cannot drift.
 *
 * A source role with no entry maps to `FALLBACK_ROLE`. That is deliberate: an
 * unmapped control still appears in the snapshot with its name and states, so it
 * can be grounded and acted on, rather than vanishing.
 */

/** What an unmapped source role becomes. */
export const FALLBACK_ROLE = "generic";

/** Windows UI Automation `ControlType` → ARIA role (REQ-ADP-6). */
export const UIA_ROLE_MAP: Readonly<Record<string, string>> = {
  AppBar: "toolbar",
  Button: "button",
  Calendar: "grid",
  CheckBox: "checkbox",
  ComboBox: "combobox",
  Custom: "generic",
  DataGrid: "grid",
  DataItem: "row",
  Document: "document",
  Edit: "textbox",
  Group: "group",
  Header: "rowgroup",
  HeaderItem: "columnheader",
  Hyperlink: "link",
  Image: "img",
  List: "listbox",
  ListItem: "option",
  Menu: "menu",
  MenuBar: "menubar",
  MenuItem: "menuitem",
  Pane: "group",
  ProgressBar: "progressbar",
  RadioButton: "radio",
  ScrollBar: "scrollbar",
  Separator: "separator",
  Slider: "slider",
  Spinner: "spinbutton",
  SplitButton: "button",
  StatusBar: "status",
  Tab: "tablist",
  TabItem: "tab",
  Table: "table",
  Text: "text",
  Thumb: "generic",
  TitleBar: "banner",
  ToolBar: "toolbar",
  ToolTip: "tooltip",
  Tree: "tree",
  TreeItem: "treeitem",
  Window: "window",
};

/** macOS Accessibility `AXRole` → ARIA role (REQ-ADP-7). */
export const AX_ROLE_MAP: Readonly<Record<string, string>> = {
  AXApplication: "application",
  AXBrowser: "group",
  AXBusyIndicator: "progressbar",
  AXButton: "button",
  AXCell: "cell",
  AXCheckBox: "checkbox",
  AXColorWell: "button",
  AXColumn: "group",
  AXComboBox: "combobox",
  AXDisclosureTriangle: "button",
  AXDrawer: "group",
  AXGroup: "group",
  AXGrowArea: "generic",
  AXHeading: "heading",
  AXHelpTag: "tooltip",
  AXImage: "img",
  AXIncrementor: "spinbutton",
  AXLink: "link",
  AXList: "listbox",
  AXMenu: "menu",
  AXMenuBar: "menubar",
  AXMenuButton: "button",
  AXMenuItem: "menuitem",
  AXOutline: "tree",
  AXOutlineRow: "treeitem",
  AXPopUpButton: "combobox",
  AXProgressIndicator: "progressbar",
  AXRadioButton: "radio",
  AXRadioGroup: "radiogroup",
  AXRow: "row",
  AXScrollArea: "group",
  AXScrollBar: "scrollbar",
  AXSecureTextField: "textbox",
  AXSheet: "dialog",
  AXSlider: "slider",
  AXSplitGroup: "group",
  AXSplitter: "separator",
  AXStaticText: "text",
  AXTabGroup: "tablist",
  AXTable: "table",
  AXTextArea: "textbox",
  AXTextField: "textbox",
  AXToolbar: "toolbar",
  AXUnknown: "generic",
  AXValueIndicator: "generic",
  AXWebArea: "document",
  AXWindow: "window",
};

/**
 * Appium native Android class → ARIA role (REQ-ADP-5).
 *
 * Webview contexts already expose ARIA roles and need no mapping; this table is
 * for the native context only. iOS (`XCUIElementType*`) is not scheduled, so it
 * has no table yet.
 */
export const APPIUM_ANDROID_ROLE_MAP: Readonly<Record<string, string>> = {
  "android.app.Dialog": "dialog",
  "android.view.View": "generic",
  "android.view.ViewGroup": "group",
  "android.webkit.WebView": "document",
  "android.widget.Button": "button",
  "android.widget.CheckBox": "checkbox",
  "android.widget.CheckedTextView": "option",
  "android.widget.EditText": "textbox",
  "android.widget.FrameLayout": "group",
  "android.widget.HorizontalScrollView": "group",
  "android.widget.ImageButton": "button",
  "android.widget.ImageView": "img",
  "android.widget.LinearLayout": "group",
  "android.widget.ListView": "list",
  "android.widget.NumberPicker": "spinbutton",
  "android.widget.ProgressBar": "progressbar",
  "android.widget.RadioButton": "radio",
  "android.widget.RadioGroup": "radiogroup",
  "android.widget.RatingBar": "slider",
  "android.widget.RelativeLayout": "group",
  "android.widget.ScrollView": "group",
  "android.widget.SearchView": "searchbox",
  "android.widget.SeekBar": "slider",
  "android.widget.Spinner": "combobox",
  "android.widget.Switch": "switch",
  "android.widget.TabWidget": "tablist",
  "android.widget.TextView": "text",
  "android.widget.ToggleButton": "switch",
  "android.widget.Toolbar": "toolbar",
  "androidx.recyclerview.widget.RecyclerView": "list",
};

/**
 * AT-SPI role names, onto the same vocabulary (T23, SF-23).
 *
 * AT-SPI publishes a role as a lower-case phrase — `push button`, `page tab` —
 * rather than a camel-cased identifier, and the phrases are the ones
 * `Accessible.getRoleName()` returns. Mapping them here rather than in the
 * adapter is what keeps "one published interface, and each platform reaches it
 * through an adapter" true: a binding written against `button` finds a button
 * on macOS, on Windows and on Linux, because all three tables land on the same
 * word.
 */
export const ATSPI_ROLE_MAP: Readonly<Record<string, string>> = {
  application: "application",
  "check box": "checkbox",
  "check menu item": "menuitemcheckbox",
  "column header": "columnheader",
  "combo box": "combobox",
  dialog: "dialog",
  document: "document",
  "document frame": "document",
  "document web": "document",
  entry: "textbox",
  filler: "generic",
  frame: "window",
  heading: "heading",
  icon: "img",
  image: "img",
  label: "text",
  link: "link",
  list: "list",
  "list box": "listbox",
  "list item": "listitem",
  menu: "menu",
  "menu bar": "menubar",
  "menu item": "menuitem",
  "page tab": "tab",
  "page tab list": "tablist",
  panel: "group",
  "password text": "textbox",
  "progress bar": "progressbar",
  "push button": "button",
  "radio button": "radio",
  "radio menu item": "menuitemradio",
  "row header": "rowheader",
  "scroll bar": "scrollbar",
  "scroll pane": "group",
  section: "group",
  separator: "separator",
  slider: "slider",
  "spin button": "spinbutton",
  "split pane": "group",
  statusbar: "status",
  table: "table",
  "table cell": "cell",
  "table column header": "columnheader",
  "table row": "row",
  "table row header": "rowheader",
  text: "text",
  "toggle button": "button",
  "tool bar": "toolbar",
  "tool tip": "tooltip",
  tree: "tree",
  "tree item": "treeitem",
  "tree table": "treegrid",
  viewport: "group",
  window: "window",
};

/** The published mapping tables, keyed by the adapter family they belong to. */
export const ROLE_MAPS = {
  uia: UIA_ROLE_MAP,
  ax: AX_ROLE_MAP,
  appium: APPIUM_ANDROID_ROLE_MAP,
  atspi: ATSPI_ROLE_MAP,
} as const;

export type RoleMapName = keyof typeof ROLE_MAPS;

/** Map one source role onto the ARIA vocabulary, falling back to `generic`. */
export function normaliseRole(map: RoleMapName, sourceRole: string): string {
  return ROLE_MAPS[map][sourceRole] ?? FALLBACK_ROLE;
}

/** Every ARIA role any table maps onto, sorted. Useful for conformance assertions. */
export function normalisedRoles(): string[] {
  const roles = new Set<string>([FALLBACK_ROLE]);
  for (const map of Object.values(ROLE_MAPS)) {
    for (const role of Object.values(map)) roles.add(role);
  }
  return [...roles].sort();
}

/**
 * The roles that are worth acting on (LLD §2.2, §11).
 *
 * Used two ways, and they have to agree. `snapshot({ interactiveOnly: true })`
 * narrows to these, and the recorder's pruning keeps them when a snapshot is too
 * large for a grounding prompt — a page whose pruned form dropped its buttons
 * would be a page the model cannot ground anything in.
 *
 * The list is normalised ARIA roles, so it means the same thing whether the
 * source was ARIA, UIA, AX, AT-SPI or an Appium class name.
 */
export const INTERACTIVE_ROLES: ReadonlySet<string> = new Set([
  "button",
  "link",
  "textbox",
  "searchbox",
  "spinbutton",
  "checkbox",
  "radio",
  "combobox",
  "listbox",
  "option",
  "slider",
  "menuitem",
  "tab",
  "switch",
]);

export function isInteractiveRole(role: string): boolean {
  return INTERACTIVE_ROLES.has(role);
}

/* ────────────────────────────────────────────────────────────────────────────
 * Window chrome (P10-F2, LLD §7.5, §13.7)
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * The window's own buttons — close, minimise, zoom, full screen, collapse.
 *
 * They are interactive controls with accessible names, and they belong to the
 * *window manager*, not to the application: an application cannot give them an
 * `automationId` on any platform, because it does not create them. macOS names
 * them by subrole (`AXCloseButton`, and P8-F3's table), and Windows gives them
 * the fixed automation ids below.
 *
 * P10-F2: the desktop snapshot case's id rule fails on all three on every macOS
 * window in existence, which would make "every interactive control has an
 * automationId" a rule no application could ever satisfy. So the rule exempts
 * them — and only them: the exemption is a closed list of things the platform
 * owns, not a name pattern an application could accidentally fall into.
 */
export const AX_WINDOW_CHROME_SUBROLES: ReadonlySet<string> = new Set([
  "AXCloseButton",
  "AXMinimizeButton",
  "AXZoomButton",
  "AXFullScreenButton",
  "AXCollapseButton",
]);

/** What Windows calls the same three, as `AutomationId`s. */
export const UIA_WINDOW_CHROME_IDS: ReadonlySet<string> = new Set([
  "Close",
  "Minimize",
  "Maximize",
  "Restore",
  "SystemMenuBar",
]);

/**
 * Is this snapshot node one of the window manager's own controls?
 *
 * Reads the adapter's `native` bag rather than the node's name, because a name
 * is the application's to choose and a subrole or a system automation id is
 * not: a button an application labelled "Close" is the application's, and this
 * must not excuse it from carrying an id.
 */
export function isWindowChrome(node: {
  readonly native?: Readonly<Record<string, string>> | undefined;
}): boolean {
  const native = node.native ?? {};
  const subrole = native["axSubrole"];
  if (subrole !== undefined && AX_WINDOW_CHROME_SUBROLES.has(subrole)) return true;
  const id = native["automationId"];
  return id !== undefined && UIA_WINDOW_CHROME_IDS.has(id);
}
