/**
 * The app's accessibility variants (Draft 2.8 LLD §16, T7.1).
 *
 * > Desktop healing cases (Draft 2.8, T6.1's "healing variant subset" made
 * > concrete): the app gains `YAM_A11Y_VARIANT=1|2`, where variant 1 renames
 * > one screen tab and one button on the Project screen and variant 2 moves the
 * > Record screen's gateway control into a different panel; a binding recorded
 * > at variant 0 must relocalize on both through the desktop adapter with the
 * > same weights and threshold as the web healing eval, and the desktop
 * > conformance report records the outcome per case.
 *
 * This is the desktop half of what `apps/sample-web`'s `?variant=1..20` is for
 * the web: a deliberate, documented change to the interface that breaks a
 * recorded binding in one specific way, so that relocalization can be *measured*
 * rather than asserted. Variant 1 breaks the name a binding matched on and
 * leaves the structure; variant 2 leaves the name and breaks the structure. A
 * healer that recovers from one and not the other has told you which of its five
 * similarity measures is carrying it.
 *
 * ## Why it arrives as a query parameter and not through the bridge
 *
 * LLD §13.6 says the preload bridge exposes `openProject`, `serviceInfo`,
 * `pickFile` and `preferences` — "only" those four. A fifth function for a test
 * fixture would widen the one surface in the app that is deliberately narrow. The
 * main process reads `YAM_A11Y_VARIANT` and puts it on the renderer's URL
 * instead, which costs nothing and changes no contract.
 */

/** Which variant this window is showing. `0` is the real interface. */
export type A11yVariant = 0 | 1 | 2;

export function a11yVariant(): A11yVariant {
  if (typeof window === "undefined") return 0;
  const raw = new URLSearchParams(window.location.search).get("a11yVariant");
  return raw === "1" ? 1 : raw === "2" ? 2 : 0;
}
