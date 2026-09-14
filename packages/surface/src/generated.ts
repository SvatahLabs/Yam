/**
 * Names a build generated, and the classes worth fingerprinting (LLD §3.3).
 *
 * `@svatah/yam-bindings` refuses to bind to a generated id and the web adapters
 * leave generated classes out of `native.stableClasses`, both by this rule. It
 * lives here rather than in `bindings` because the desktop adapters need it too
 * and may not import `bindings`. The web adapters' page scripts carry their
 * own copy, because they run inside the page and import nothing.
 */

/**
 * Whether a value looks machine-generated and so is not worth binding to.
 *
 * A binding built on `:r3:` or `css-1x2y3z` breaks on the next build for no
 * reason a person would recognise.
 */
export function looksGenerated(value: string): boolean {
  return (
    // React's useId (`:r3:`), Ember (`ember42`), MUI (`mui-1234`), Radix
    // (`radix-:r1:`), styled-components (`sc-hAxLzW`), CSS-modules hashes
    // (`css-1x2y3z`, `_3fF4aQ`), and anything that is mostly hex.
    /^:r[0-9a-z]+:$/i.test(value) ||
    /^ember\d+$/i.test(value) ||
    /^(mui|radix|headlessui|reach|aria)[-_][:a-z0-9]+$/i.test(value) ||
    /^sc-[a-zA-Z]{6,}$/.test(value) ||
    /^(css|jsx|emotion)-[a-z0-9]{5,}$/i.test(value) ||
    /^_[a-zA-Z0-9]{5,}$/.test(value) ||
    /^[0-9a-f]{8,}$/i.test(value) ||
    /\d{5,}$/.test(value)
  );
}

/**
 * A class list without the classes a build generated, or nothing.
 *
 * What the web adapters publish as `native.stableClasses`, for an adapter that
 * reads the list from an accessibility API rather than from `classList`:
 * Chromium publishes an element's classes to macOS as `AXDOMClassList`. The
 * same rule as the page scripts', so a fingerprint's `class` means the same
 * thing whichever adapter recorded it.
 */
export function stableClassesOf(list: string | undefined): string | undefined {
  const kept = (list ?? "")
    .split(/\s+/)
    .filter((one) => one.length > 1 && !looksGenerated(one));
  return kept.length === 0 ? undefined : kept.join(" ");
}
