#!/usr/bin/env node
/**
 * Generate the app's service client from `GET /openapi.json` (T3.6, LLD §13.6).
 *
 *   node scripts/generate-app-client.mjs [--out apps/desktop/src/renderer/client.generated.ts]
 *
 * "React renderer with a client generated from `GET /openapi.json`."
 *
 * ## Why generated, and why committed
 *
 * The app is the service's reference client (REQ-ADE-1), and a reference client
 * that hand-writes its own idea of the API is a second specification. Generating
 * it means the renderer can only call routes the service publishes: a screen
 * cannot invent an endpoint, and a route that is renamed breaks the app's build
 * rather than its runtime.
 *
 * The output is committed and a test regenerates it and diffs, so the drift is a
 * red build rather than a discovery. That also keeps the renderer buildable
 * without a running service.
 *
 * ## What it does not do
 *
 * It does not generate types for request and response bodies. Those are
 * `@svatah/yam-schema`'s — `StepResult`, `Summary`, `BindingFile` — and re-deriving
 * them from a JSON Schema round-trip would produce a second, subtly different
 * set of the same types. The client returns `unknown` and the screens parse with
 * the schema package, which is the one source REQ-STD-1 names.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openApiDocument } from "@svatah/yam-service";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const outArg = process.argv.indexOf("--out");
const OUT = resolve(
  ROOT,
  outArg > 0 ? process.argv[outArg + 1] : "apps/desktop/src/renderer/client.generated.ts",
);

const document = openApiDocument("0.1.0");

/** `GET /runs/{id}/results` → `getRunsByIdResults`. Deterministic, not clever. */
function methodName(verb, path) {
  const parts = path
    .split("/")
    .filter((one) => one !== "")
    .map((one) =>
      one.startsWith("{") ? `By${capital(one.slice(1, -1))}` : capital(one.replace(/\W+/g, "")),
    );
  return verb + parts.join("");
}

function capital(text) {
  return text.length === 0 ? "" : text[0].toUpperCase() + text.slice(1);
}

/** `{id}` and `{file}`, in the order they appear. */
function pathParams(path) {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
}

const VERBS = ["get", "post", "put", "delete", "patch"];

const endpoints = [];
for (const [path, operations] of Object.entries(document.paths)) {
  for (const verb of VERBS) {
    const operation = operations[verb];
    if (operation === undefined) continue;
    endpoints.push({
      id: methodName(verb, path),
      verb,
      path,
      summary: operation.summary ?? "",
      params: pathParams(path),
      hasBody: operation.requestBody !== undefined,
      /** Text routes return a string; everything else returns JSON. */
      /*
       * Any `text/*` answer is text, not only `text/plain` — `GET /bindings/:id`
       * answers `text/yaml`, and a client that ran `JSON.parse` over it threw on
       * every call (T10.1). `scripts/generate-clients.mjs` reads the same rule.
       */
      text:
        Object.keys(operation.responses?.["200"]?.content ?? {}).some((one) =>
          one.startsWith("text/"),
        ) ||
        Object.keys(operations[verb]?.requestBody?.content ?? {}).some((one) =>
          one.startsWith("text/"),
        ),
    });
  }
}
endpoints.sort((a, b) => (a.id < b.id ? -1 : 1));

const lines = [];
lines.push("/*");
lines.push(" * GENERATED FILE — do not edit.");
lines.push(" *");
lines.push(" * `node scripts/generate-app-client.mjs` writes this from the service's own");
lines.push(" * OpenAPI description (`GET /openapi.json`, LLD §13.5). It is committed so the");
lines.push(" * renderer builds without a running service, and a test regenerates it and diffs,");
lines.push(" * so drift between the app and the service is a red build rather than a discovery.");
lines.push(" *");
lines.push(" * Bodies are `unknown` on purpose: their types are `@svatah/yam-schema`'s, and");
lines.push(" * re-deriving them here would make a second, subtly different set of the same");
lines.push(" * types (REQ-STD-1).");
lines.push(" */");
lines.push("");
lines.push("/** One route the service publishes. The static check reads this list. */");
lines.push("export interface ServiceEndpoint {");
lines.push("  readonly id: string;");
lines.push('  readonly verb: "get" | "post" | "put" | "delete" | "patch";');
lines.push("  readonly path: string;");
lines.push("  readonly summary: string;");
lines.push("}");
lines.push("");
lines.push("export const ENDPOINTS: readonly ServiceEndpoint[] = [");
for (const one of endpoints) {
  lines.push(
    `  { id: ${JSON.stringify(one.id)}, verb: ${JSON.stringify(one.verb)}, ` +
      `path: ${JSON.stringify(one.path)}, summary: ${JSON.stringify(one.summary)} },`,
  );
}
lines.push("];");
lines.push("");
lines.push("export interface ServiceConnection {");
lines.push("  readonly url: string;");
lines.push("  readonly token: string;");
lines.push("}");
lines.push("");
lines.push("/** Everything the renderer can ask the service. Nothing else exists. */");
lines.push("export class GeneratedServiceClient {");
lines.push("  constructor(protected readonly connection: ServiceConnection) {}");
lines.push("");
lines.push("  protected async call(");
lines.push('    verb: string,');
lines.push("    path: string,");
lines.push("    options: { body?: unknown; text?: boolean } = {},");
lines.push("  ): Promise<unknown> {");
lines.push("    const response = await fetch(`${this.connection.url}${path}`, {");
lines.push("      method: verb.toUpperCase(),");
lines.push("      headers: {");
lines.push("        authorization: `Bearer ${this.connection.token}`,");
lines.push('        ...(options.body === undefined');
lines.push("          ? {}");
lines.push('          : { "content-type": options.text ? "text/plain" : "application/json" }),');
lines.push("      },");
lines.push("      ...(options.body === undefined");
lines.push("        ? {}");
lines.push("        : {");
lines.push("            body:");
lines.push("              typeof options.body === \"string\" ? options.body : JSON.stringify(options.body),");
lines.push("          }),");
lines.push("    });");
lines.push("");
lines.push("    const raw = await response.text();");
lines.push("    if (!response.ok) {");
lines.push("      throw new ServiceError(response.status, path, raw);");
lines.push("    }");
lines.push("    if (options.text === true) return raw;");
lines.push("    return raw === \"\" ? undefined : (JSON.parse(raw) as unknown);");
lines.push("  }");
lines.push("");
for (const one of endpoints) {
  const args = [
    ...one.params.map((name) => `${name}: string`),
    ...(one.hasBody ? ["body?: unknown"] : []),
  ];
  const template = one.path.replace(/\{([^}]+)\}/g, (_, name) => `\${encodeURIComponent(${name})}`);
  lines.push(`  /** \`${one.verb.toUpperCase()} ${one.path}\` — ${one.summary} */`);
  lines.push(`  async ${one.id}(${args.join(", ")}): Promise<unknown> {`);
  lines.push(
    `    return await this.call(${JSON.stringify(one.verb)}, \`${template}\`, {` +
      (one.hasBody ? " body," : "") +
      (one.text ? " text: true," : "") +
      " });",
  );
  lines.push("  }");
  lines.push("");
}
lines.push("}");
lines.push("");
lines.push("/** A non-2xx answer, with the body the service sent. */");
lines.push("export class ServiceError extends Error {");
lines.push("  constructor(");
lines.push("    readonly status: number,");
lines.push("    readonly path: string,");
lines.push("    readonly body: string,");
lines.push("  ) {");
lines.push("    super(`${path} answered ${status}: ${body.slice(0, 400)}`);");
lines.push('    this.name = "ServiceError";');
lines.push("  }");
lines.push("}");

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, `${lines.join("\n")}\n`, "utf8");
process.stderr.write(`wrote ${endpoints.length} endpoint(s) to ${OUT}\n`);
