/**
 * The cookies a browser would send with a request, by name (RFC 6265 §5.4,
 * REQ-ADP-3).
 *
 * One rule for every adapter that has a cookie jar: the BiDi adapter matched
 * cookies this way, the Playwright adapter used Playwright's own filter — which
 * sends a host-only cookie to every subdomain, matches `/admin` against
 * `/administrator` and sends a `Secure` cookie over plain http to localhost — and
 * the HTTP adapter kept a jar per host that ignored `Domain` altogether. A
 * cookie is sent where a browser would send it, whichever adapter holds it.
 *
 * - **Domain.** A domain cookie is stored with a leading dot and goes to its
 *   domain and every subdomain; a host-only cookie has no dot and goes to that
 *   host alone.
 * - **Path.** The request's path is the cookie's, or starts with it at a `/`.
 * - **Secure.** Only over `https:`.
 *
 * Two cookies of one name on different paths are both sent, the longer path
 * first, and a server reading the header takes the first; so the longer path
 * wins in the record too.
 */

/** A cookie as a jar keeps it. `domain` has a leading dot for a domain cookie. */
export interface StoredCookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path?: string;
  readonly secure?: boolean;
}

export function cookiesFor(url: string, cookies: readonly StoredCookie[]): Record<string, string> {
  const target = new URL(url);
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const path = target.pathname === "" ? "/" : target.pathname;
  const sent = cookies
    .filter((cookie) => {
      const domain = cookie.domain.toLowerCase().replace(/^\[|\]$/g, "");
      const domainMatches = domain.startsWith(".")
        ? host === domain.slice(1) || host.endsWith(domain)
        : host === domain;
      const cookiePath = cookie.path ?? "/";
      const pathMatches =
        path === cookiePath ||
        (path.startsWith(cookiePath) && (cookiePath.endsWith("/") || path[cookiePath.length] === "/"));
      return domainMatches && pathMatches && (cookie.secure !== true || target.protocol === "https:");
    })
    .sort((a, b) => (a.path ?? "/").length - (b.path ?? "/").length);
  const byName: Record<string, string> = {};
  for (const cookie of sent) byName[cookie.name] = cookie.value;
  return byName;
}
