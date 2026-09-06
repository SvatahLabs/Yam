/**
 * The generated client is the service's, and stays that way (T3.6).
 *
 * "A client generated from `GET /openapi.json`" is only worth anything if the
 * committed file is still what the generator produces. Otherwise it is a
 * hand-written client with a comment claiming otherwise, and a route renamed in
 * the service breaks the ADE at run time instead of at build time.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { openApiDocument } from "@svatah/yam-service";
import { ENDPOINTS } from "../src/renderer/client.generated.js";

const ADE = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROOT = join(ADE, "..", "..");
const COMMITTED = join(ADE, "src", "renderer", "client.generated.ts");

describe("the committed client is what the generator writes (T3.6)", () => {
  it("regenerating produces the same bytes", () => {
    const out = mkdtempSync(join(tmpdir(), "yam-ade-client-"));
    try {
      const path = join(out, "client.generated.ts");
      execFileSync(
        process.execPath,
        [join(ROOT, "scripts", "generate-ade-client.mjs"), "--out", path],
        { cwd: ROOT, stdio: "pipe" },
      );
      expect(readFileSync(path, "utf8")).toBe(readFileSync(COMMITTED, "utf8"));
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);

  it("has one method per route the service publishes, and no others", () => {
    const published = new Set<string>();
    for (const [path, operations] of Object.entries(
      openApiDocument("0.1.0")["paths"] as Record<string, Record<string, unknown>>,
    )) {
      for (const verb of ["get", "post", "put", "delete", "patch"]) {
        if (operations[verb] !== undefined) published.add(`${verb} ${path}`);
      }
    }

    expect(new Set(ENDPOINTS.map((one) => `${one.verb} ${one.path}`))).toEqual(published);
  });

  it("names every route LLD §13.6 gives a screen", () => {
    const paths = new Set(ENDPOINTS.map((one) => `${one.verb} ${one.path}`));
    for (const route of [
      "get /project",
      "get /flows/{file}",
      "put /flows/{file}",
      "post /compile",
      "get /plan",
      "post /run",
      "get /runs",
      "get /runs/{id}/results",
      "get /runs/{id}/audit",
      "get /runs/{id}/screenshots/{name}",
      "get /api",
      "put /api/{name}",
      "post /api/request",
      "get /data",
      "put /data",
      "get /bindings",
      "get /events/sse",
    ]) {
      expect(paths.has(route), route).toBe(true);
    }
  });
});
