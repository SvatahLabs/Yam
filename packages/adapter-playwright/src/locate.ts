/**
 * `Candidate` → Playwright `Locator` (LLD §7.1, REQ-RUN-5).
 *
 * Every candidate kind in `packages/schema/src/bindings.ts` that a web adapter
 * can honour has a row here. Mobile and desktop kinds (`accessibilityId`,
 * `resourceId`, `automationId`, `controlPath`) belong to other adapters and are
 * refused explicitly rather than silently matching nothing — a candidate that
 * cannot be honoured is a configuration mistake, not a missing element.
 *
 * `webmcp` returns no locator: the surface answers it through the WebMCP tool
 * declaration, and until that adapter work lands (REQ-ADP-9, P2) the resolver
 * falls through to the locator candidates behind it.
 */
import type { Frame, Locator } from "playwright";
import type { Candidate } from "@svatah/yam-schema";
import { LocateError } from "@svatah/yam-surface";

/** Candidate kinds this adapter cannot honour, and which adapter owns each. */
const FOREIGN_KINDS: Record<string, string> = {
  accessibilityId: "the Appium adapter",
  resourceId: "the Appium adapter",
  automationId: "the UIA and AX adapters",
  controlPath: "the UIA and AX adapters",
};

/** Escape a value for a CSS attribute selector. */
function css(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Build the locator a candidate names, or `null` when the candidate is one the
 * surface answers without a locator (`webmcp`).
 */
export function locatorFor(
  frame: Frame,
  candidate: Candidate,
  testIdAttributes: readonly string[],
): Locator | null {
  const foreign = FOREIGN_KINDS[candidate.by];
  if (foreign !== undefined) {
    throw new LocateError(
      `A "${candidate.by}" candidate belongs to ${foreign}; the Playwright adapter cannot honour it.`,
      { adapter: "playwright" },
    );
  }

  const exact = candidate.exact ?? true;

  switch (candidate.by) {
    case "role": {
      if (candidate.role === undefined) {
        throw new LocateError('A "role" candidate must carry a role.', { adapter: "playwright" });
      }
      const options: { name?: string | RegExp; exact?: boolean } = {};
      if (candidate.name !== undefined) {
        options.name = candidate.name;
        options.exact = exact;
      }
      return frame.getByRole(candidate.role as Parameters<Frame["getByRole"]>[0], options);
    }
    case "label":
      return frame.getByLabel(requireValue(candidate), { exact });
    case "placeholder":
      return frame.getByPlaceholder(requireValue(candidate), { exact });
    case "testid": {
      // `getByTestId` is bound to one configured attribute; the store may name a
      // different one, so the selector is built explicitly from the candidate's
      // own attribute, falling back to the project's first configured attribute.
      const attribute = candidate.attribute ?? testIdAttributes[0] ?? "data-testid";
      return frame.locator(`[${attribute}="${css(requireValue(candidate))}"]`);
    }
    case "text":
      return frame.getByText(requireValue(candidate), { exact });
    case "altText":
      return frame.getByAltText(requireValue(candidate), { exact });
    case "title":
      return frame.getByTitle(requireValue(candidate), { exact });
    case "css":
      return frame.locator(requireValue(candidate));
    case "xpath":
      return frame.locator(`xpath=${requireValue(candidate)}`);
    case "id":
      return frame.locator(`[id="${css(requireValue(candidate))}"]`);
    case "name":
      return frame.locator(`[name="${css(requireValue(candidate))}"]`);
    case "coords": {
      // Coordinates name no element; the surface acts on the point directly.
      return null;
    }
    case "webmcp":
      return null;
    default:
      // The mobile and desktop kinds are refused above; anything else is a kind
      // added to the schema without a row here.
      throw new LocateError(`Unknown candidate kind "${String(candidate.by)}".`, {
        adapter: "playwright",
      });
  }
}

function requireValue(candidate: Candidate): string {
  if (candidate.value === undefined || candidate.value === "") {
    throw new LocateError(`A "${candidate.by}" candidate must carry a value.`, {
      adapter: "playwright",
    });
  }
  return candidate.value;
}

/** `"x,y"` from a `coords` candidate. */
export function coordsOf(candidate: Candidate): { x: number; y: number } {
  const parts = (candidate.value ?? "").split(",").map((p) => Number(p.trim()));
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
    throw new LocateError('A "coords" candidate must carry a value of the form "x,y".', {
      adapter: "playwright",
    });
  }
  return { x: parts[0]!, y: parts[1]! };
}
