/**
 * The one element every overlay in the design system is portalled into
 * (P10-F2, T11.1).
 *
 * Radix's `Portal` mounts its own `<div>` into `<body>` when an overlay opens
 * and leaves it there when it closes. That is invisible on the web and is not
 * invisible to a desktop adapter: Chromium's accessibility tree reflects the
 * shape of `<body>`, so the ancestry of *every control in the application*
 * gains a level the first time anybody opens a menu — permanently.
 *
 * `controlPath` and `rolePath` are the desktop candidates (LLD §7.5) and both
 * are derived from that ancestry, so a recorded desktop binding silently stops
 * matching the moment a person presses ⌘K or opens a select. The live gate
 * found it twice, as a healing case that would not relocalize: the fingerprint
 * was recorded through `document/group/navigation/button` and matched against
 * `document/group/group/navigation/button`.
 *
 * One host, created on the first render of the first component that needs it
 * and never removed, makes the shape the same whatever anyone has pressed.
 */

/** The id of the element every overlay in the ADE is portalled into. */
export const PORTAL_HOST_ID = "sv-portal-host";

export function portalHost(): HTMLElement | undefined {
  if (typeof document === "undefined") return undefined;
  const existing = document.getElementById(PORTAL_HOST_ID);
  if (existing !== null) return existing;
  const host = document.createElement("div");
  host.id = PORTAL_HOST_ID;
  document.body.appendChild(host);
  return host;
}
