/**
 * Element ids and where their files live (LLD §6.1).
 *
 * "`bindings/<app>/<page>/<element>.yaml`". An id is the same path written with
 * dots — `login.username-field` is `bindings/login/username-field.yaml`,
 * `shop.checkout.pay-button` is `bindings/shop/checkout/pay-button.yaml` — so the
 * store's layout is readable from an id and an id is readable from a path. That
 * matters because the whole store is committed and reviewed as files (REQ-REC-9).
 */
import { DataError } from "@svatah/surface";

/**
 * A segment is lower-case alphanumerics and hyphens: what a target phrase
 * normalises to (docs/flow-language.md §4).
 */
const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Whether a string is a well-formed element id. */
export function isElementId(id: string): boolean {
  const segments = id.split(".");
  return segments.length >= 1 && segments.every((s) => SEGMENT.test(s));
}

/** Throw unless `id` is well formed, naming what is wrong. */
export function assertElementId(id: string): void {
  if (isElementId(id)) return;
  throw new DataError(
    `"${id}" is not an element id. An id is dot-separated segments of lower-case ` +
      "letters, digits and hyphens, mirroring the path under the bindings " +
      'directory: "login.username-field" is bindings/login/username-field.yaml (LLD §6.1).',
  );
}

/** Path segments for an id, relative to the bindings directory; the last is the file. */
export function idToSegments(id: string): string[] {
  assertElementId(id);
  const segments = id.split(".");
  segments[segments.length - 1] = `${segments[segments.length - 1]!}.yaml`;
  return segments;
}

/** The id a path under the bindings directory belongs to. */
export function pathToId(relativePath: string): string {
  return relativePath
    .replace(/\\/g, "/")
    .replace(/\.yaml$/, "")
    .split("/")
    .filter((s) => s !== "")
    .join(".");
}

/**
 * The element id a target phrase normalises to (docs/flow-language.md §4): drop a
 * leading article, lower-case, and replace every run of non-alphanumerics with a
 * hyphen. *the sign in button* becomes `sign-in-button`.
 */
export function elementIdFromPhrase(phrase: string): string {
  return phrase
    .trim()
    .replace(/^(the|a|an)\s+/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
