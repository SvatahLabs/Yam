/**
 * The rule every interactive component in this package obeys (T9.2, REQ-ADE-12,
 * LLD §13.7).
 *
 * > every component requiring a visible label and an id
 *
 * > Every button, link, tab, field, and row action has a visible label that is
 * > its accessible name, and an id in the `automationId` form the desktop
 * > adapters read; the desktop snapshot case fails on an unnamed interactive
 * > control.
 *
 * This is the same rule the Phase 8 verification found three violations of, and
 * the reason it found them is that nothing enforced it. Now something does, in
 * three places at once:
 *
 * 1. **The types.** `Named` is required on every interactive component, so an
 *    unnamed one does not compile.
 * 2. **This function, in development.** A `label` that is the empty string, or
 *    whitespace, or an id that is not in the `automationId` form, throws where
 *    the component is written rather than showing up in a conformance report a
 *    week later. It is a no-op in production, because a shipped ADE should not
 *    take its window down over a label — the ADE renders an alert for a screen
 *    that could not load, and this is a developer's mistake, not a user's.
 * 3. **`packages/ui/test/named.test.ts`.** Every component is rendered without a
 *    label and expected to throw, so the rule is demonstrated rather than
 *    asserted.
 *
 * ## What counts as an id
 *
 * `screen-flows`, `run-again`, `binding-verify`: lower-case, hyphenated, no
 * spaces. That is what Chromium publishes as `AXDOMIdentifier` on macOS and as
 * `AutomationId` on Windows, and what `automationIdOf` in the desktop adapters
 * reads first after `AXIdentifier` (LLD §7.5). An id with a space in it is not
 * wrong so much as a candidate that will be quoted differently by two adapters.
 */

/** Everything interactive takes these two, and neither is optional. */
export interface Named {
  /**
   * The visible text, which is also the accessible name.
   *
   * Not `aria-label`: LLD §13.7 says "a visible label that is its accessible
   * name", and a control whose accessible name is a hidden attribute is one a
   * person and a flow sentence disagree about.
   */
  readonly label: string;
  /** The `automationId` the desktop adapters bind by. Stable across rewordings. */
  readonly id: string;
}

const ID_FORM = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/**
 * Is this build a development one?
 *
 * `process.env.NODE_ENV` in a bundle, `import.meta.env.DEV` under Vite. Read
 * defensively because this module is imported by an Electron renderer, a
 * Node test, and a static page, and exactly one of them has `process`.
 */
function isDevelopment(): boolean {
  try {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
      ?.env;
    if (env?.["NODE_ENV"] !== undefined) return env["NODE_ENV"] !== "production";
  } catch {
    // No `process`: fall through to the default below.
  }
  // A renderer with no NODE_ENV is a development build being run by hand.
  return true;
}

export class UnnamedControlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnnamedControlError";
  }
}

/**
 * Throw, in development, when a control has no name or no id.
 *
 * Returns the label so it can be used inline:
 * `<button id={id}>{requireNamed("Button", props)}</button>`.
 */
export function requireNamed(component: string, named: Partial<Named>): string {
  const label = (named.label ?? "").trim();
  const id = (named.id ?? "").trim();

  if (!isDevelopment()) return named.label ?? "";

  if (label === "") {
    throw new UnnamedControlError(
      `<${component}> has no label. Every interactive control carries a visible label that is ` +
        "its accessible name (LLD §13.7); the desktop conformance suite's snapshot case fails " +
        "on an unnamed control (LLD §7.5). If the control is genuinely iconographic, give it a " +
        "label and hide it visually — never give it none.",
    );
  }
  if (id === "") {
    throw new UnnamedControlError(
      `<${component} label="${label}"> has no id. The desktop adapters bind by the id ` +
        "(`automationId`, LLD §7.5), which is what survives someone rewording the label — and " +
        "rewording it is exactly what the healing cases do.",
    );
  }
  if (!ID_FORM.test(id)) {
    throw new UnnamedControlError(
      `<${component} id="${id}"> is not in the automationId form. Use lower-case words joined ` +
        'by hyphens ("run-again", "screen-flows"): that is what Chromium publishes as ' +
        "AXDOMIdentifier and as AutomationId, and an id with a space is a candidate two " +
        "adapters would quote differently.",
    );
  }
  return named.label ?? "";
}

/** The id form, exported so the ADE and the TUI can check their own ids. */
export const AUTOMATION_ID_FORM = ID_FORM;
