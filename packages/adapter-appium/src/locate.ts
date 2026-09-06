/**
 * `Candidate` → an Appium locator strategy (T4.2, LLD §7.4, REQ-ADP-5).
 *
 * > webview contexts use web candidate kinds; native contexts use
 * > `accessibilityId`, `resourceId`, `xpath`.
 *
 * Two tables, because a session on a phone is two different things depending on
 * which context it is in. Inside a webview it is a browser and every web
 * candidate means what it means anywhere else. Inside the native app there is no
 * CSS, no ARIA role attribute and no label element, and the three kinds
 * REQ-ADP-5 names are what a native binding is made of.
 *
 * A candidate a context cannot honour is refused with the reason, never silently
 * matched against nothing: "no element found" and "that kind of candidate does
 * not exist here" are different answers, and only the first one means the screen
 * changed.
 */
import type { Candidate } from "@svatah/yam-schema";
import { APPIUM_ANDROID_ROLE_MAP, LocateError } from "@svatah/yam-surface";

/** One W3C `using` / `value` pair, as `POST /session/:id/elements` takes it. */
export interface Strategy {
  readonly using: string;
  readonly value: string;
}

/** Quote a value for an XPath predicate, including one that contains quotes. */
export function xpathLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  // Neither quote works alone, so build it from pieces: XPath 1.0 has no escape.
  return `concat('${value.split("'").join("',\"'\",'")}')`;
}

function requireValue(candidate: Candidate): string {
  if (candidate.value === undefined || candidate.value === "") {
    throw new LocateError(`A "${candidate.by}" candidate must carry a value.`, {
      adapter: "appium",
    });
  }
  return candidate.value;
}

/** Candidate kinds that belong to another adapter entirely. */
const FOREIGN_KINDS: Record<string, string> = {
  automationId: "the UIA and AX adapters",
  controlPath: "the UIA and AX adapters",
};

/**
 * The strategy for a candidate in a **native** context.
 *
 * `accessibilityId` and `resourceId` are the two identities a well-built Android
 * screen actually has, and they come first in synthesis for that reason.
 * Everything else is derived from what is on the screen, which is to say from
 * things that change when the screen changes.
 */
export function nativeStrategy(candidate: Candidate): Strategy {
  const foreign = FOREIGN_KINDS[candidate.by];
  if (foreign !== undefined) {
    throw new LocateError(
      `A "${candidate.by}" candidate belongs to ${foreign}; the Appium adapter cannot honour it.`,
      { adapter: "appium" },
    );
  }

  switch (candidate.by) {
    case "accessibilityId":
      return { using: "accessibility id", value: requireValue(candidate) };
    case "resourceId":
      // Appium's own strategy for it; `-android uiautomator` would also work and
      // is slower, because it compiles a UiSelector on the device.
      return { using: "id", value: requireValue(candidate) };
    case "id":
      // A web binding's `id` and a native `resource-id` are the same idea, and a
      // binding recorded in a webview must still resolve if the same screen is
      // later driven natively.
      return { using: "id", value: requireValue(candidate) };
    case "xpath":
      return { using: "xpath", value: requireValue(candidate) };
    case "text":
      return {
        using: "xpath",
        value: `//*[@text=${xpathLiteral(requireValue(candidate))} or @label=${xpathLiteral(requireValue(candidate))}]`,
      };
    case "name":
      return {
        using: "xpath",
        value: `//*[@content-desc=${xpathLiteral(requireValue(candidate))}]`,
      };
    case "role": {
      /*
       * A role is not a native concept; it is what the *snapshot* calls a class.
       * Matching it means matching the classes that map onto it, and a role
       * candidate with a name is the common recorded shape ("the button named
       * Sign in"), so both halves are honoured.
       */
      if (candidate.role === undefined) {
        throw new LocateError('A "role" candidate must carry a role.', { adapter: "appium" });
      }
      const classes = classesForRole(candidate.role);
      if (classes.length === 0) {
        throw new LocateError(
          `No native class maps onto the role "${candidate.role}", so a native context cannot ` +
            "resolve this candidate. Record the element again on the platform it runs on.",
          { adapter: "appium" },
        );
      }
      const byClass = classes.map((c) => `@class=${xpathLiteral(c)}`).join(" or ");
      const named =
        candidate.name === undefined
          ? ""
          : ` and (@content-desc=${xpathLiteral(candidate.name)} or @text=${xpathLiteral(candidate.name)} or @label=${xpathLiteral(candidate.name)})`;
      return { using: "xpath", value: `//*[(${byClass})${named}]` };
    }
    default:
      throw new LocateError(
        `A "${candidate.by}" candidate is a web locator and a native context has no DOM to ` +
          "apply it to. Native bindings use accessibilityId, resourceId or xpath (REQ-ADP-5).",
        { adapter: "appium" },
      );
  }
}

/**
 * The strategy for a candidate in a **webview** context.
 *
 * A webview is a browser, so the web kinds mean what they mean everywhere else —
 * expressed as CSS or XPath, which is all a WebDriver-classic endpoint takes.
 * Role and label have no protocol-level equivalent, so they become the selector
 * that answers the same question.
 */
export function webviewStrategy(
  candidate: Candidate,
  testIdAttributes: readonly string[],
): Strategy {
  const foreign = FOREIGN_KINDS[candidate.by];
  if (foreign !== undefined) {
    throw new LocateError(
      `A "${candidate.by}" candidate belongs to ${foreign}; the Appium adapter cannot honour it.`,
      { adapter: "appium" },
    );
  }
  const css = (value: string): string => value.replace(/(["\\])/g, "\\$1");

  switch (candidate.by) {
    case "css":
      return { using: "css selector", value: requireValue(candidate) };
    case "xpath":
      return { using: "xpath", value: requireValue(candidate) };
    case "id":
      return { using: "css selector", value: `[id="${css(requireValue(candidate))}"]` };
    case "name":
      return { using: "css selector", value: `[name="${css(requireValue(candidate))}"]` };
    case "testid": {
      const attribute = candidate.attribute ?? testIdAttributes[0] ?? "data-testid";
      return {
        using: "css selector",
        value: `[${attribute}="${css(requireValue(candidate))}"]`,
      };
    }
    case "placeholder":
      return { using: "css selector", value: `[placeholder="${css(requireValue(candidate))}"]` };
    case "altText":
      return { using: "css selector", value: `[alt="${css(requireValue(candidate))}"]` };
    case "title":
      return { using: "css selector", value: `[title="${css(requireValue(candidate))}"]` };
    case "label": {
      // `label[for=x]` names the control rather than being it, so the selector
      // has to go through the label to the field it labels.
      const wanted = xpathLiteral(requireValue(candidate));
      return {
        using: "xpath",
        value:
          `//*[@aria-label=${wanted}]` +
          ` | //label[normalize-space(.)=${wanted}]//input` +
          ` | //label[normalize-space(.)=${wanted}]//textarea` +
          ` | //label[normalize-space(.)=${wanted}]//select` +
          ` | //input[@id=//label[normalize-space(.)=${wanted}]/@for]` +
          ` | //textarea[@id=//label[normalize-space(.)=${wanted}]/@for]` +
          ` | //select[@id=//label[normalize-space(.)=${wanted}]/@for]`,
      };
    }
    case "text": {
      const wanted = xpathLiteral(requireValue(candidate));
      // The deepest element whose text matches, so "Sign in" on a link inside a
      // nav does not also match the nav and the body.
      return { using: "xpath", value: `//*[normalize-space(text())=${wanted}]` };
    }
    case "role": {
      if (candidate.role === undefined) {
        throw new LocateError('A "role" candidate must carry a role.', { adapter: "appium" });
      }
      const tags = TAGS_FOR_ROLE[candidate.role] ?? [];
      const byRole = [
        `@role=${xpathLiteral(candidate.role)}`,
        ...tags.map((t) => `local-name()=${xpathLiteral(t)}`),
      ].join(" or ");
      const named =
        candidate.name === undefined
          ? ""
          : ` and (normalize-space(.)=${xpathLiteral(candidate.name)}` +
            ` or @aria-label=${xpathLiteral(candidate.name)}` +
            ` or @value=${xpathLiteral(candidate.name)})`;
      return { using: "xpath", value: `//*[(${byRole})${named}]` };
    }
    default:
      throw new LocateError(
        `A "${candidate.by}" candidate has no webview equivalent (REQ-ADP-5).`,
        { adapter: "appium" },
      );
  }
}

/** The HTML elements that carry a role natively, for the webview `role` kind. */
const TAGS_FOR_ROLE: Readonly<Record<string, readonly string[]>> = {
  button: ["button"],
  link: ["a"],
  textbox: ["input", "textarea"],
  checkbox: [],
  radio: [],
  combobox: ["select"],
  heading: ["h1", "h2", "h3", "h4", "h5", "h6"],
  img: ["img"],
  list: ["ul", "ol"],
  listitem: ["li"],
  navigation: ["nav"],
  main: ["main"],
  table: ["table"],
  row: ["tr"],
  cell: ["td"],
  option: ["option"],
};

/**
 * The native classes that map onto an ARIA role.
 *
 * The inverse of `APPIUM_ANDROID_ROLE_MAP`, derived rather than written out, so
 * a class added to the published table is matchable the moment it is added.
 */
export function classesForRole(role: string): string[] {
  return Object.entries(APPIUM_ANDROID_ROLE_MAP)
    .filter(([, mapped]) => mapped === role)
    .map(([className]) => className)
    .sort();
}

/** Which context a name refers to: Appium calls the native one `NATIVE_APP`. */
export function isNativeContext(context: string): boolean {
  return context === "" || context.toUpperCase() === "NATIVE_APP";
}

/** The strategy for a candidate, given which context the session is in. */
export function strategyFor(
  candidate: Candidate,
  context: string,
  testIdAttributes: readonly string[],
): Strategy {
  return isNativeContext(context)
    ? nativeStrategy(candidate)
    : webviewStrategy(candidate, testIdAttributes);
}
