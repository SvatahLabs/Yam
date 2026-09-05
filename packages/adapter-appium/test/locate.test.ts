/**
 * Candidate → locator strategy (T4.2, LLD §7.4, REQ-ADP-5).
 *
 * > webview contexts use web candidate kinds; native contexts use
 * > `accessibilityId`, `resourceId`, `xpath`.
 *
 * The mapping is a pure function of the candidate and the context, so this is
 * the half of the adapter a device would tell you nothing more about. What a
 * device *would* tell you is that the selectors are ones Appium accepts, which
 * is the emulator gate in `README.md`.
 */
import { describe, expect, it } from "vitest";
import { LocateError } from "@svatah/surface";
import type { Candidate } from "@svatah/schema";
import {
  classesForRole,
  isNativeContext,
  nativeStrategy,
  strategyFor,
  webviewStrategy,
  xpathLiteral,
} from "../src/locate.js";

const candidate = (partial: Partial<Candidate> & { by: Candidate["by"] }): Candidate =>
  ({ score: 1, ...partial }) as Candidate;

describe("which context a session is in", () => {
  it("knows Appium's name for the native one", () => {
    expect(isNativeContext("NATIVE_APP")).toBe(true);
    expect(isNativeContext("native_app")).toBe(true);
    expect(isNativeContext("")).toBe(true);
    expect(isNativeContext("WEBVIEW_chrome")).toBe(false);
    expect(isNativeContext("WEBVIEW_com.svatah.sample")).toBe(false);
  });
});

describe("native strategies (REQ-ADP-5)", () => {
  it("maps the three kinds a native binding is made of", () => {
    expect(nativeStrategy(candidate({ by: "accessibilityId", value: "Sign in button" }))).toEqual({
      using: "accessibility id",
      value: "Sign in button",
    });
    expect(nativeStrategy(candidate({ by: "resourceId", value: "com.svatah:id/submit" }))).toEqual({
      using: "id",
      value: "com.svatah:id/submit",
    });
    expect(nativeStrategy(candidate({ by: "xpath", value: "//android.widget.Button[1]" }))).toEqual({
      using: "xpath",
      value: "//android.widget.Button[1]",
    });
  });

  it("treats a web `id` as a resource id, so a webview binding still resolves", () => {
    expect(nativeStrategy(candidate({ by: "id", value: "submit" })).using).toBe("id");
  });

  it("turns a role into the classes that map onto it", () => {
    const { using, value } = nativeStrategy(candidate({ by: "role", role: "button" }));
    expect(using).toBe("xpath");
    // Derived from the published table, so a class added there is matchable at
    // once rather than after someone remembers to update a second list.
    expect(value).toContain("android.widget.Button");
    expect(value).toContain("@class=");
  });

  it("adds the name to a role candidate, matching either way a phone spells it", () => {
    const { value } = nativeStrategy(candidate({ by: "role", role: "button", name: "Sign In" }));
    expect(value).toContain("@content-desc='Sign In'");
    expect(value).toContain("@text='Sign In'");
    expect(value).toContain("@label='Sign In'");
  });

  it("refuses a role no native class maps onto, with the reason", () => {
    // Not "found nothing": a `searchbox` role recorded on the web is a candidate
    // this context cannot express, and the two answers mean different things.
    expect(() => nativeStrategy(candidate({ by: "role", role: "rowheader" }))).toThrow(
      /No native class maps onto the role/,
    );
  });

  it("refuses a web-only kind, naming what a native binding uses instead", () => {
    for (const by of ["css", "placeholder", "altText", "label", "testid"] as const) {
      expect(() => nativeStrategy(candidate({ by, value: "x" })), by).toThrow(
        /accessibilityId, resourceId or xpath/,
      );
    }
  });

  it("refuses a kind that belongs to the desktop adapters", () => {
    expect(() => nativeStrategy(candidate({ by: "automationId", value: "x" }))).toThrow(
      /UIA and AX/,
    );
    expect(() => nativeStrategy(candidate({ by: "controlPath", value: "x" }))).toThrow(LocateError);
  });

  it("refuses a candidate with no value", () => {
    expect(() => nativeStrategy(candidate({ by: "accessibilityId" }))).toThrow(
      /must carry a value/,
    );
  });
});

describe("webview strategies (REQ-ADP-5)", () => {
  const web = (partial: Partial<Candidate> & { by: Candidate["by"] }) =>
    webviewStrategy(candidate(partial), ["data-testid"]);

  it("maps every web kind onto a selector a WebDriver endpoint takes", () => {
    expect(web({ by: "css", value: "#username" })).toEqual({
      using: "css selector",
      value: "#username",
    });
    expect(web({ by: "id", value: "username" })).toEqual({
      using: "css selector",
      value: '[id="username"]',
    });
    expect(web({ by: "name", value: "username" })).toEqual({
      using: "css selector",
      value: '[name="username"]',
    });
    expect(web({ by: "testid", value: "sign-in" })).toEqual({
      using: "css selector",
      value: '[data-testid="sign-in"]',
    });
    expect(web({ by: "placeholder", value: "you@example.com" }).using).toBe("css selector");
    expect(web({ by: "xpath", value: "//button" })).toEqual({ using: "xpath", value: "//button" });
  });

  it("honours a testid candidate's own attribute over the project's", () => {
    expect(web({ by: "testid", value: "x", attribute: "data-qa" }).value).toBe('[data-qa="x"]');
  });

  it("goes through the label to the control it labels", () => {
    // `label[for=x]` names the field rather than being it, so a `label`
    // candidate that resolved to the label would resolve to the wrong element.
    const { using, value } = web({ by: "label", value: "Username" });
    expect(using).toBe("xpath");
    expect(value).toContain("@aria-label='Username'");
    expect(value).toContain("//input[@id=//label[normalize-space(.)='Username']/@for]");
  });

  it("escapes a value that contains a quote", () => {
    expect(xpathLiteral("it's")).toBe(`"it's"`);
    expect(xpathLiteral('say "hi"')).toBe(`'say "hi"'`);
    // Neither quote works alone; XPath 1.0 has no escape, so it is built up.
    expect(xpathLiteral(`it's "both"`)).toContain("concat(");
  });

  it("escapes a CSS value that contains a quote or a backslash", () => {
    expect(web({ by: "id", value: 'a"b' }).value).toBe('[id="a\\"b"]');
  });
});

describe("strategyFor picks the table the context calls for", () => {
  it("uses the native table in a native context", () => {
    expect(strategyFor(candidate({ by: "accessibilityId", value: "x" }), "NATIVE_APP", []).using).toBe(
      "accessibility id",
    );
  });

  it("uses the web table in a webview", () => {
    expect(strategyFor(candidate({ by: "css", value: "#x" }), "WEBVIEW_chrome", []).using).toBe(
      "css selector",
    );
  });

  it("refuses a CSS candidate in a native context and honours it in a webview", () => {
    // The same stored binding, two contexts, two different right answers. This
    // is why the strategy depends on the context and not only on the candidate.
    const css = candidate({ by: "css", value: "#username" });
    expect(() => strategyFor(css, "NATIVE_APP", [])).toThrow(LocateError);
    expect(strategyFor(css, "WEBVIEW_chrome", []).value).toBe("#username");
  });
});

describe("classesForRole is derived from the published table", () => {
  it("finds every class that maps onto a role", () => {
    expect(classesForRole("button")).toContain("android.widget.Button");
    expect(classesForRole("textbox")).toContain("android.widget.EditText");
    expect(classesForRole("list")).toContain("androidx.recyclerview.widget.RecyclerView");
  });

  it("is empty for a role no native class means", () => {
    expect(classesForRole("rowheader")).toEqual([]);
  });
});
