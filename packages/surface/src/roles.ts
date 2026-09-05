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

/** The three published mapping tables, keyed by the adapter family they belong to. */
export const ROLE_MAPS = {
  uia: UIA_ROLE_MAP,
  ax: AX_ROLE_MAP,
  appium: APPIUM_ANDROID_ROLE_MAP,
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
