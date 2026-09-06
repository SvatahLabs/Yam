/**
 * The record-mode picker (LLD §6.5).
 *
 * "Record mode (`YAM_MODE=record`): if the id is unbound in the current
 * context, calls the recorder's `ground()` (module (b) plugin, §9.2) if
 * installed; otherwise opens an interactive picker in headed mode (click the
 * element) and synthesises the binding with `provenance.model: "human"`. Module
 * (a) alone therefore records without any model."
 *
 * A person clicking an element is the grounding, which is why the provenance says
 * `human` rather than omitting the block: REQ-STD-4 rejects an artifact without
 * provenance, and "a person chose this" is a real answer to "where did this come
 * from".
 *
 * `YAM_PICK` is a **test affordance, not a user feature**: it names the
 * element for each id so record mode can be exercised headless in CI, where
 * nobody is there to click. It is documented as such and is not part of the
 * quick start.
 */
import type { Page } from "playwright";

/** How an element was chosen. */
export type PickSource = "human" | "programmatic";

export interface Pick {
  /** A CSS selector for the chosen element. */
  readonly selector: string;
  readonly source: PickSource;
}

/**
 * Read a pick's value as a selector.
 *
 * A bare word is a test id, so the common case stays short — `"username"` rather
 * than `'[data-testid="username"]'` — and anything else is a CSS selector as
 * written. Both `YAM_PICK` and the `yamPicks` fixture option go through
 * this, so the two cannot mean different things.
 */
export function pickSelector(value: string, testIdAttribute = "data-testid"): string {
  const trimmed = value.trim();
  return /^[a-zA-Z][\w-]*$/.test(trimmed) ? `[${testIdAttribute}="${trimmed}"]` : trimmed;
}

/**
 * Parse `YAM_PICK`: a JSON object of element id → selector.
 *
 * A bare word is read as a test id, so the common case stays short:
 * `YAM_PICK='{"login.username-field":"username"}'`.
 */
export function parseProgrammaticPicks(
  raw: string | undefined,
  testIdAttribute = "data-testid",
): Map<string, string> {
  const picks = new Map<string, string>();
  if (raw === undefined || raw.trim() === "") return picks;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `YAM_PICK is not valid JSON. It is an object of element id to selector, for example ` +
        `{"login.username-field":"username"}.`,
      { cause },
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("YAM_PICK must be a JSON object of element id to selector.");
  }

  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "string" || value.trim() === "") continue;
    picks.set(id, pickSelector(value, testIdAttribute));
  }
  return picks;
}

import { PICKER_SCRIPT } from "@svatah/yam-adapter-playwright";


/**
 * Ask a person to click the element, and return a selector for what they chose.
 *
 * The chosen element is stamped with `data-yam-picked` only long enough for a
 * selector to be built from it; the stamp is removed before anything describes
 * the element, so it never reaches a fingerprint.
 */
export async function pickInteractively(
  page: Page,
  id: string,
  timeoutMs: number,
): Promise<Pick | null> {
  const picked = await page.evaluate(
    ({ script, elementId }: { script: string; elementId: string }) =>
      (0, eval)(`(${script})`)(elementId) as Promise<boolean>,
    { script: PICKER_SCRIPT, elementId: id },
    // `evaluate` has no timeout of its own; the caller's is applied by the fixture.
  );
  void timeoutMs;
  if (picked !== true) return null;
  return { selector: `[data-yam-picked="${cssEscape(id)}"]`, source: "human" };
}

/** Remove the picker's stamp from wherever it landed. */
export async function clearPickerStamp(page: Page): Promise<void> {
  await page
    .evaluate(() => {
      for (const el of Array.from(document.querySelectorAll("[data-yam-picked]"))) {
        el.removeAttribute("data-yam-picked");
      }
    })
    .catch(() => undefined);
}

function cssEscape(value: string): string {
  return value.replace(/(["\\])/g, "\\$1");
}
