/**
 * The service's OpenAPI describes the surface catalogue it serves (SF-03, T14).
 *
 * Wave 2 (T12) made `@svatah/yam-surface-control`'s one catalogue the source of
 * the routes the service serves over the broker. Wave 3 needs those routes in
 * the service's OpenAPI document too, because the desktop's client is generated
 * from it (LLD §13.6) — and the service may not import `surface-control`
 * (LLD §1), so the routes are hand-written in `packages/service/src/openapi.ts`.
 *
 * A hand-written copy is a place two things drift. This check reads both and
 * fails when they do: every catalogue operation's service method and bare path
 * must be a route the document describes. It is the same guard the whole of
 * `openapi.ts` relies on — "a test fails when a route exists it does not
 * describe" — applied across the package boundary the import rule forbids.
 *
 * It is deliberately one-directional: the document may describe more than the
 * catalogue (the project routes), but never less of the catalogue.
 */
import { describe, expect, it } from "vitest";
import { openApiDocument } from "@svatah/yam-service";
import { OPERATIONS } from "@svatah/yam-surface-control";

/** The catalogue writes `:session`; OpenAPI writes `{session}`. */
const toOpenApiPath = (path: string): string => path.replace(/:(\w+)/g, "{$1}");

describe("the OpenAPI document describes every catalogue operation (SF-03, T14)", () => {
  const document = openApiDocument("0.1.0") as {
    paths: Record<string, Record<string, unknown>>;
  };

  it("has the method and bare path of each surface operation", () => {
    for (const op of OPERATIONS) {
      const path = toOpenApiPath(op.service.path);
      const verb = op.service.method.toLowerCase();
      const entry = document.paths[path];
      expect(entry, `${op.name}: the document has no path ${path}`).toBeDefined();
      expect(
        entry![verb],
        `${op.name}: the document does not serve ${verb.toUpperCase()} ${path}`,
      ).toBeDefined();
    }
  });

  it("names a path the generated app client can turn into a method", () => {
    // The app client generator keys off `{param}` braces; a stray `:session`
    // would produce `/sessions/:session/...` and an uncallable method.
    for (const op of OPERATIONS) {
      const path = toOpenApiPath(op.service.path);
      expect(path, `${op.name}`).not.toContain(":");
    }
  });
});
