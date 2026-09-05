/**
 * Page source → the normalised snapshot (T4.2, LLD §7.4, REQ-SURF-4).
 *
 * The conversion is a pure function of the XML, which is why it can be held to
 * an exact answer without a device: no emulator was available to this phase, and
 * the emulator gate in `README.md` is what covers the half these cannot.
 *
 * Every assertion here is about the *contract* — roles from the published table,
 * names in the platform's own precedence, boxes as `[x, y, width, height]`,
 * states from the driver's booleans — rather than about the shape of the parser.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  boxOf,
  convertPageSource,
  nameOf,
  parseBounds,
  parsePageSource,
  roleOf,
  statesOf,
  unescapeXml,
  valueOf,
  xpathOf,
  type SourceNode,
} from "../src/page-source.js";

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const source = (name: string): SourceNode =>
  parsePageSource(readFileSync(join(FIXTURES, name), "utf8"));

describe("parsing an Appium page source", () => {
  it("keeps class names exactly as the driver wrote them", () => {
    // The whole reason this is not an HTML parser: `android.widget.TextView` and
    // `android.widget.textview` are not the same class, and the role table is
    // keyed on the first.
    const root = source("android-login.xml");
    expect(root.tag).toBe("android.widget.FrameLayout");
    const layout = root.children[0]!;
    expect(layout.children.map((c) => c.tag)).toEqual([
      "android.widget.TextView",
      "android.widget.EditText",
      "android.widget.EditText",
      "android.widget.CheckBox",
      "android.widget.Button",
      "android.widget.Button",
      "android.widget.TextView",
    ]);
  });

  it("unwraps the driver's root element", () => {
    // Android says `<hierarchy>`, iOS says `<AppiumAUT>`; the caller wants the
    // application either way.
    expect(source("ios-login.xml").tag).toBe("XCUIElementTypeApplication");
  });

  it("reads attributes, including XML-escaped text", () => {
    const error = source("android-login.xml").children[0]!.children[6]!;
    expect(error.attrs["text"]).toBe("Invalid credentials & try again");
    expect(error.attrs["resource-id"]).toBe("com.svatah.sample:id/error");
  });

  it("decodes every entity a label can contain", () => {
    expect(unescapeXml("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;")).toBe(`a & b <c> "d" 'e'`);
    expect(unescapeXml("line&#10;break")).toBe("line\nbreak");
    // An entity the table does not know is left alone rather than mangled.
    expect(unescapeXml("&unknown;")).toBe("&unknown;");
  });

  it("handles self-closing elements and an XML declaration", () => {
    const root = parsePageSource(
      `<?xml version='1.0'?><hierarchy><a x="1"/><b><c y="2"/></b></hierarchy>`,
    );
    expect(root.children.map((c) => c.tag)).toEqual(["a", "b"]);
    expect(root.children[1]!.children[0]!.attrs["y"]).toBe("2");
  });
});

describe("bounds and geometry (LLD §7.4)", () => {
  it("turns Android's [left,top][right,bottom] into [x, y, width, height]", () => {
    expect(parseBounds("[42,360][1038,504]")).toEqual([42, 360, 996, 144]);
  });

  it("reads a negative origin, which a scrolled row has", () => {
    expect(parseBounds("[-24,-100][76,0]")).toEqual([-24, -100, 100, 100]);
  });

  it("reads iOS's four separate attributes", () => {
    const field = source("ios-login.xml").children[0]!.children[1]!;
    expect(boxOf(field)).toEqual([16, 140, 358, 44]);
  });

  it("has no box for an element that reports neither", () => {
    expect(boxOf({ tag: "x", attrs: {}, children: [] })).toBeUndefined();
  });
});

describe("roles come from the published table (REQ-SURF-4)", () => {
  const cases: ReadonlyArray<[string, string]> = [
    ["android.widget.Button", "button"],
    ["android.widget.EditText", "textbox"],
    ["android.widget.CheckBox", "checkbox"],
    ["android.widget.TextView", "text"],
    ["androidx.recyclerview.widget.RecyclerView", "list"],
    ["XCUIElementTypeButton", "button"],
    ["XCUIElementTypeTextField", "textbox"],
    ["XCUIElementTypeSecureTextField", "textbox"],
    ["XCUIElementTypeSwitch", "switch"],
    ["XCUIElementTypeStaticText", "text"],
  ];

  for (const [tag, role] of cases) {
    it(`maps ${tag} onto "${role}"`, () => {
      expect(roleOf({ tag, attrs: {}, children: [] })).toBe(role);
    });
  }

  it("gives an application's own class a role from what it is", () => {
    /*
     * `com.svatah.sample.widget.FancyButton` is in no table and is a button to
     * anyone looking at the screen. A node that fell to `generic` would be one
     * the recorder cannot describe and a person cannot name.
     */
    expect(roleOf({ tag: "com.svatah.sample.widget.FancyButton", attrs: {}, children: [] })).toBe(
      "button",
    );
    expect(roleOf({ tag: "com.acme.ui.PrettyEditText", attrs: {}, children: [] })).toBe("textbox");
  });

  it("falls back to generic for a class that suggests nothing", () => {
    expect(roleOf({ tag: "com.acme.Thing", attrs: {}, children: [] })).toBe("generic");
  });
});

describe("accessible names follow the platform's own precedence", () => {
  it("prefers content-desc to text, because content-desc is set deliberately", () => {
    // The button says "Sign In" and is described as "Sign in button". A screen
    // reader announces the second, and so does the snapshot.
    const button = source("android-login.xml").children[0]!.children[4]!;
    expect(nameOf(button)).toBe("Sign in button");
  });

  it("falls back to text when there is no description", () => {
    const heading = source("android-login.xml").children[0]!.children[0]!;
    expect(nameOf(heading)).toBe("Sign in");
  });

  it("reads iOS's label", () => {
    const field = source("ios-login.xml").children[0]!.children[1]!;
    expect(nameOf(field)).toBe("Username");
  });

  it("reports a value only for controls that hold one", () => {
    const button = source("android-login.xml").children[0]!.children[4]!;
    expect(valueOf(button)).toBeUndefined();
    expect(
      valueOf({ tag: "android.widget.EditText", attrs: { text: "someone@example.com" }, children: [] }),
    ).toBe("someone@example.com");
  });

  it("does not report a hint as a value", () => {
    // A field whose `text` *is* its description is showing a placeholder.
    expect(
      valueOf({
        tag: "android.widget.EditText",
        attrs: { text: "Username", "content-desc": "Username" },
        children: [],
      }),
    ).toBeUndefined();
  });
});

describe("states come from the driver's booleans (LLD §2.2)", () => {
  const login = source("android-login.xml").children[0]!.children;

  it("reports an unticked checkbox as unchecked", () => {
    expect(statesOf(login[3]!)).toContain("unchecked");
  });

  it("reports a disabled control as disabled", () => {
    expect(statesOf(login[5]!)).toContain("disabled");
  });

  it("reports the focused field as focused", () => {
    expect(statesOf(login[1]!)).toContain("focused");
  });

  it("reports a password field as required, which is what it is", () => {
    expect(statesOf(login[2]!)).toContain("required");
  });

  it("reports an element with a zero box as hidden, whatever the tree says", () => {
    expect(statesOf(login[6]!)).toContain("hidden");
  });

  it("reads iOS's value=\"1\" as checked", () => {
    const off = source("ios-login.xml").children[0]!.children[3]!;
    expect(statesOf(off)).toContain("unchecked");
    expect(statesOf({ ...off, attrs: { ...off.attrs, value: "1" } })).toContain("checked");
  });
});

describe("the whole conversion (LLD §2.2)", () => {
  it("produces the snapshot shape every other adapter produces", () => {
    const nodes = convertPageSource(source("android-login.xml"));
    const shaped = nodes.map((n) => ({ ref: n.ref, role: n.role, name: n.name }));

    expect(shaped).toEqual([
      // The two layout containers: `group` from the published table, not
      // `generic` — a layout is a grouping, and the snapshot says so.
      { ref: "r0", role: "group", name: undefined },
      { ref: "r1", role: "group", name: undefined },
      { ref: "r2", role: "text", name: "Sign in" },
      { ref: "r3", role: "textbox", name: "Username" },
      { ref: "r4", role: "textbox", name: "Password" },
      { ref: "r5", role: "checkbox", name: "Remember me" },
      { ref: "r6", role: "button", name: "Sign in button" },
      { ref: "r7", role: "button", name: "Forgot password?" },
      { ref: "r8", role: "text", name: "Invalid credentials & try again" },
    ]);
    expect(nodes[3]!.box).toEqual([42, 360, 996, 144]);
    expect(nodes[3]!.native?.["resource-id"]).toBe("com.svatah.sample:id/username");
  });

  it("counts depth in nodes rather than in layout containers", () => {
    const nodes = convertPageSource(source("android-login.xml"));
    expect(nodes[0]!.depth).toBe(0);
    expect(nodes[1]!.depth).toBe(1);
    expect(nodes[2]!.depth).toBe(2);
    expect(nodes[2]!.parent).toBe("r1");
  });

  it("narrows to interactive controls when asked", () => {
    const nodes = convertPageSource(source("android-login.xml"), { interactiveOnly: true });
    expect(nodes.map((n) => n.role)).toEqual(["textbox", "textbox", "checkbox", "button", "button"]);
  });

  it("stops at maxNodes, so an enormous screen cannot fill a prompt", () => {
    expect(convertPageSource(source("android-login.xml"), { maxNodes: 3 })).toHaveLength(3);
  });

  it("never reports an ignored attribute (LLD §3.5)", () => {
    /*
     * `path` is the raw XML the conversion walked and is stripped before a node
     * reaches `Snapshot`; what a caller above the surface sees is the rest.
     * `test/surface.test.ts` checks the stripping itself, through `snapshot()`.
     */
    const nodes = convertPageSource(source("android-login.xml"), {
      ignoreAttributes: ["resource-id"],
    });
    const exposed = nodes.map(({ path: _path, ...node }) => node);
    expect(nodes[3]!.native?.["resource-id"]).toBeUndefined();
    expect(JSON.stringify(exposed)).not.toContain("com.svatah.sample:id/username");
  });
});

describe("the XPath a candidate is synthesised from (LLD §7.4)", () => {
  it("indexes siblings of the same class and leaves unique ones bare", () => {
    const nodes = convertPageSource(source("android-list.xml"));
    const buttons = nodes.filter((n) => n.role === "button" && n.name?.startsWith("Book"));
    expect(buttons).toHaveLength(2);

    // Two identical rows: the XPath is the only thing that can tell them apart,
    // which is exactly why it is the *last* candidate synthesis ranks.
    expect(buttons[0]!.native?.["xpath"]).toContain("android.widget.LinearLayout[1]");
    expect(buttons[1]!.native?.["xpath"]).toContain("android.widget.LinearLayout[2]");
    expect(buttons[0]!.native?.["xpath"]).not.toBe(buttons[1]!.native?.["xpath"]);
  });

  it("builds a path from the root, not from the element", () => {
    const root = source("android-list.xml");
    const list = root.children[0]!;
    const row = list.children[0]!;
    expect(xpathOf([root, list, row])).toBe(
      "//androidx.recyclerview.widget.RecyclerView/android.widget.LinearLayout[1]",
    );
  });
});
