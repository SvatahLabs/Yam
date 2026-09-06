#!/usr/bin/env node
/**
 * Generate the three clients from the service's OpenAPI description (T9.3,
 * REQ-SDK-1, REQ-SDK-2, LLD §13.8).
 *
 *   node scripts/generate-clients.mjs           # write all three
 *   node scripts/generate-clients.mjs --check   # regenerate and diff (drift)
 *   node scripts/generate-clients.mjs --only ts # one language
 *
 * > `@svatah/yam-sdk` (TypeScript): a typed client generated from the service's
 * > OpenAPI description at build time […] Nothing in it is hand-written that the
 * > description already states; a drift between the two fails the build.
 * > Generated clients for Python (`svatah-yam` on PyPI) and Java
 * > (`com.svatah.yam:svatah-yam`) from the same description.
 *
 * ## Why the generator is ours
 *
 * T9.3's environment note: "the generators must be permissively licensed
 * (REQ-PKG-3). If a generator cannot be found under a permissive licence, write
 * a minimal generator of your own from the OpenAPI description and say so."
 *
 * `openapi-generator` is Apache-2.0 and would satisfy the licence, but it is a
 * 30 MB Java jar fetched at build time from Maven Central — a network
 * dependency in the build of a project whose replay path has none (REQ-NFR-1),
 * and a second toolchain to pin. `openapi-typescript` and `orval` are MIT and
 * generate only TypeScript.
 *
 * What is actually needed is small. The description is 36 routes with path
 * parameters, a request body or not, and JSON or text back. Bodies are
 * deliberately *not* typed from the schemas: their types are `@svatah/yam-schema`'s
 * (`StepResult`, `Summary`, `BindingFile`), and re-deriving them from a JSON
 * Schema round-trip would produce a second, subtly different set of the same
 * types — the reasoning `scripts/generate-app-client.mjs` already records.
 *
 * So this is about two hundred lines that emit three files, and the drift check
 * is what makes it trustworthy: a route added to the service and not
 * regenerated fails `pnpm -r test`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { openApiDocument } from "@svatah/yam-service";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const check = argv.includes("--check");
const only = (() => {
  const at = argv.indexOf("--only");
  return at < 0 ? undefined : argv[at + 1];
})();

const document = openApiDocument("0.1.0");
const VERBS = ["get", "post", "put", "delete", "patch"];

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

const capital = (text) => (text.length === 0 ? "" : text[0].toUpperCase() + text.slice(1));

/** `getRunsByIdResults` → `get_runs_by_id_results`, which is what Python calls it. */
const snake = (name) => name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();

const pathParams = (path) => [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);

const endpoints = [];
for (const [path, operations] of Object.entries(document.paths)) {
  for (const verb of VERBS) {
    const operation = operations[verb];
    if (operation === undefined) continue;
    endpoints.push({
      id: methodName(verb, path),
      snake: snake(methodName(verb, path)),
      verb,
      path,
      summary: (operation.summary ?? "").replace(/\s+/g, " ").trim(),
      params: pathParams(path),
      hasBody: operation.requestBody !== undefined,
      /** Text routes send and receive a string; everything else is JSON. */
      /*
       * Any `text/*` answer is text, not only `text/plain`.
       *
       * `GET /bindings/:id` answers `text/yaml` — the file on disk — and a
       * client that ran `JSON.parse` over it threw on every call, silently, in
       * three languages: the app's Bindings inspector was empty against a real
       * service and full against the recorded fixtures, which is the worst way
       * for a defect to present itself (T10.1).
       */
      text:
        Object.keys(operation.responses?.["200"]?.content ?? {}).some((one) =>
          one.startsWith("text/"),
        ) ||
        Object.keys(operation.requestBody?.content ?? {}).some((one) => one.startsWith("text/")),
    });
  }
}
endpoints.sort((a, b) => (a.id < b.id ? -1 : 1));

/**
 * The event kinds, read from the description's own sentence (Draft 2.11).
 *
 * `GET /events/sse`'s `description` lists them — put there by
 * `packages/service/src/openapi.ts` from `SERVICE_EVENT_KINDS`, so this reads
 * the document rather than the package and the clients stay generated from one
 * source. A description that stopped listing them would produce clients with no
 * event kinds, which the drift check turns into a red build.
 */
const eventKinds = (() => {
  const described = document.paths["/events/sse"]?.get?.description ?? "";
  /*
   * The list, not every backticked word in the sentence. `log` is a kind and has
   * no dot in it, and `kind`, `ServiceEvent` and `@svatah/yam-service` are not kinds
   * and do — so the segment between the two fixed phrases is what is read, and a
   * description that stopped writing them fails loudly below.
   */
  const segment = /The kinds are: (.*?)\. Their shapes/s.exec(described)?.[1] ?? "";
  const found = [...segment.matchAll(/`([a-z][a-z.]*)`/g)].map((match) => match[1]);
  if (found.length === 0) {
    process.stderr.write(
      "GET /events/sse's description lists no event kinds. `openApiDocument` builds that " +
        "sentence from SERVICE_EVENT_KINDS (LLD §13.8); a client generated now would have none.\n",
    );
    process.exit(2);
  }
  return [...new Set(found)];
})();

const BANNER = [
  "GENERATED FILE — do not edit.",
  "",
  "`node scripts/generate-clients.mjs` writes this from the service's own OpenAPI",
  "description (`GET /openapi.json`, LLD §13.5, §13.8). It is committed so a client",
  "builds without a running service, and a test regenerates it and diffs, so drift",
  "between a client and the service is a red build rather than a discovery.",
  "",
  "Bodies are `unknown` on purpose: their types are `@svatah/yam-schema`'s, and",
  "re-deriving them here would make a second, subtly different set of the same",
  "types (REQ-STD-1).",
];

/* ────────────────────────────────────────────────────────────────────────────
 * TypeScript
 * ──────────────────────────────────────────────────────────────────────────── */

function typescript() {
  const lines = ["/*", ...BANNER.map((one) => (one === "" ? " *" : ` * ${one}`)), " */", ""];

  lines.push("/** One route the service publishes. `actions` and the drift check read this. */");
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
  lines.push("/** Every event kind the stream carries (LLD §13.5). */");
  lines.push(
    `export const EVENT_KINDS = [${eventKinds.map((one) => JSON.stringify(one)).join(", ")}] as const;`,
  );
  lines.push("export type EventKind = (typeof EVENT_KINDS)[number];");
  lines.push("");
  lines.push("export interface ServiceConnection {");
  lines.push("  readonly url: string;");
  lines.push("  readonly token: string;");
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
  lines.push("");
  lines.push("/** Everything the service publishes. Nothing else exists. */");
  lines.push("export class GeneratedClient {");
  lines.push("  constructor(protected readonly connection: ServiceConnection) {}");
  lines.push("");
  lines.push("  protected async call(");
  lines.push("    verb: string,");
  lines.push("    path: string,");
  lines.push("    options: { body?: unknown; text?: boolean } = {},");
  lines.push("  ): Promise<unknown> {");
  lines.push("    const response = await fetch(`${this.connection.url}${path}`, {");
  lines.push("      method: verb.toUpperCase(),");
  lines.push("      headers: {");
  lines.push("        authorization: `Bearer ${this.connection.token}`,");
  lines.push("        ...(options.body === undefined");
  lines.push("          ? {}");
  lines.push('          : { "content-type": options.text ? "text/plain" : "application/json" }),');
  lines.push("      },");
  lines.push("      ...(options.body === undefined");
  lines.push("        ? {}");
  lines.push("        : {");
  lines.push("            body:");
  lines.push(
    '              typeof options.body === "string" ? options.body : JSON.stringify(options.body),',
  );
  lines.push("          }),");
  lines.push("    });");
  lines.push("");
  lines.push("    const raw = await response.text();");
  lines.push("    if (!response.ok) throw new ServiceError(response.status, path, raw);");
  lines.push("    if (options.text === true) return raw;");
  lines.push('    return raw === "" ? undefined : (JSON.parse(raw) as unknown);');
  lines.push("  }");
  lines.push("");
  for (const one of endpoints) {
    const args = [
      ...one.params.map((name) => `${name}: string`),
      ...(one.hasBody ? ["body?: unknown"] : []),
    ];
    const template = one.path.replace(
      /\{([^}]+)\}/g,
      (_, name) => `\${encodeURIComponent(${name})}`,
    );
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
  return `${lines.join("\n")}\n`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Python
 * ──────────────────────────────────────────────────────────────────────────── */

function python() {
  const lines = ['"""', ...BANNER, '"""', ""];
  lines.push("from __future__ import annotations");
  lines.push("");
  lines.push("import json");
  lines.push("import urllib.error");
  lines.push("import urllib.request");
  lines.push("from dataclasses import dataclass");
  lines.push("from typing import Any, Iterator, Optional");
  lines.push("");
  lines.push("");
  lines.push("ENDPOINTS = [");
  for (const one of endpoints) {
    lines.push(
      `    {"id": ${JSON.stringify(one.id)}, "verb": ${JSON.stringify(one.verb)}, ` +
        `"path": ${JSON.stringify(one.path)}},`,
    );
  }
  lines.push("]");
  lines.push("");
  lines.push(`EVENT_KINDS = [${eventKinds.map((one) => JSON.stringify(one)).join(", ")}]`);
  lines.push("");
  lines.push("");
  lines.push("class ServiceError(RuntimeError):");
  lines.push('    """A non-2xx answer, with the body the service sent."""');
  lines.push("");
  lines.push("    def __init__(self, status: int, path: str, body: str) -> None:");
  lines.push("        super().__init__(f\"{path} answered {status}: {body[:400]}\")");
  lines.push("        self.status = status");
  lines.push("        self.path = path");
  lines.push("        self.body = body");
  lines.push("");
  lines.push("");
  lines.push("@dataclass(frozen=True)");
  lines.push("class ServiceConnection:");
  lines.push("    url: str");
  lines.push("    token: str");
  lines.push("");
  lines.push("");
  lines.push("class GeneratedClient:");
  lines.push('    """Everything the service publishes. Nothing else exists."""');
  lines.push("");
  lines.push("    def __init__(self, connection: ServiceConnection) -> None:");
  lines.push("        self._connection = connection");
  lines.push("");
  lines.push(
    "    def _call(self, verb: str, path: str, body: Any = None, text: bool = False) -> Any:",
  );
  lines.push("        headers = {\"authorization\": f\"Bearer {self._connection.token}\"}");
  lines.push("        data: Optional[bytes] = None");
  lines.push("        if body is not None:");
  lines.push('            headers["content-type"] = "text/plain" if text else "application/json"');
  lines.push("            raw = body if isinstance(body, str) else json.dumps(body)");
  lines.push('            data = raw.encode("utf-8")');
  lines.push("        request = urllib.request.Request(");
  lines.push("            f\"{self._connection.url}{path}\",");
  lines.push("            data=data,");
  lines.push("            headers=headers,");
  lines.push("            method=verb.upper(),");
  lines.push("        )");
  lines.push("        try:");
  lines.push("            with urllib.request.urlopen(request) as response:");
  lines.push('                answer = response.read().decode("utf-8")');
  lines.push("        except urllib.error.HTTPError as error:  # noqa: PERF203");
  lines.push('            raise ServiceError(error.code, path, error.read().decode("utf-8")) from error');
  lines.push("        if text:");
  lines.push("            return answer");
  lines.push('        return json.loads(answer) if answer != "" else None');
  lines.push("");
  lines.push("    def events(self) -> Iterator[dict]:");
  lines.push('        """`GET /events/sse`, one decoded JSON object per `data:` line."""');
  lines.push("        request = urllib.request.Request(");
  lines.push('            f"{self._connection.url}/events/sse",');
  lines.push("            headers={\"authorization\": f\"Bearer {self._connection.token}\"},");
  lines.push("        )");
  lines.push("        with urllib.request.urlopen(request) as stream:");
  lines.push("            for line in stream:");
  lines.push('                decoded = line.decode("utf-8").rstrip("\\n")');
  lines.push('                if decoded.startswith("data:"):');
  lines.push("                    yield json.loads(decoded[5:].strip())");
  lines.push("");
  for (const one of endpoints) {
    const args = ["self", ...one.params, ...(one.hasBody ? ["body: Any = None"] : [])];
    const template = one.path.replace(/\{([^}]+)\}/g, (_, name) => `{${name}}`);
    lines.push(`    def ${one.snake}(${args.join(", ")}) -> Any:`);
    lines.push(`        """\`${one.verb.toUpperCase()} ${one.path}\` — ${one.summary}"""`);
    lines.push(
      `        return self._call(${JSON.stringify(one.verb)}, f${JSON.stringify(template)}` +
        (one.hasBody ? ", body=body" : "") +
        (one.text ? ", text=True" : "") +
        ")",
    );
    lines.push("");
  }
  return `${lines.join("\n")}`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * Java
 * ──────────────────────────────────────────────────────────────────────────── */

/** `getRunsByIdResults` is already a Java method name; `id` is already a parameter. */
function java() {
  const lines = ["/*", ...BANNER.map((one) => (one === "" ? " *" : ` * ${one}`)), " */"];
  lines.push("package com.svatah.yam.sdk;");
  lines.push("");
  lines.push("import java.io.IOException;");
  lines.push("import java.net.URI;");
  lines.push("import java.net.URLEncoder;");
  lines.push("import java.net.http.HttpClient;");
  lines.push("import java.net.http.HttpRequest;");
  lines.push("import java.net.http.HttpResponse;");
  lines.push("import java.nio.charset.StandardCharsets;");
  lines.push("import java.time.Duration;");
  lines.push("import java.util.List;");
  lines.push("import java.util.stream.Stream;");
  lines.push("");
  lines.push("/** Everything the service publishes. Nothing else exists. */");
  lines.push("public class GeneratedClient {");
  lines.push("  /** Every route, for the drift check and for a caller listing them. */");
  lines.push("  public static final List<String> ENDPOINTS = List.of(");
  lines.push(
    endpoints
      .map((one) => `      ${JSON.stringify(`${one.verb.toUpperCase()} ${one.path}`)}`)
      .join(",\n"),
  );
  lines.push("  );");
  lines.push("");
  lines.push("  /** Every event kind the stream carries. */");
  lines.push("  public static final List<String> EVENT_KINDS = List.of(");
  lines.push(eventKinds.map((one) => `      ${JSON.stringify(one)}`).join(",\n"));
  lines.push("  );");
  lines.push("");
  lines.push("  private final String url;");
  lines.push("  private final String token;");
  lines.push("  private final HttpClient http;");
  lines.push("");
  lines.push("  public GeneratedClient(String url, String token) {");
  lines.push("    this.url = url;");
  lines.push("    this.token = token;");
  /*
   * HTTP/1.1, explicitly.
   *
   * `HttpClient`'s default is HTTP/2, and against an `http://` origin that means
   * it sends the HTTP/1.1 upgrade dance — `Connection: Upgrade, HTTP2-Settings`.
   * Fastify with `@fastify/websocket` mounted reads an `Upgrade` header it does
   * not recognise and answers 400 `Invalid Upgrade header`, so every request
   * from a default client failed. The service speaks HTTP/1.1 on loopback and
   * has no reason to speak anything else.
   */
  lines.push("    this.http =");
  lines.push("        HttpClient.newBuilder()");
  lines.push("            .version(HttpClient.Version.HTTP_1_1)");
  lines.push("            .connectTimeout(Duration.ofSeconds(10))");
  lines.push("            .build();");
  lines.push("  }");
  lines.push("");
  lines.push("  /** A non-2xx answer, with the body the service sent. */");
  lines.push("  public static class ServiceException extends RuntimeException {");
  lines.push("    public final int status;");
  lines.push("");
  lines.push("    public ServiceException(int status, String path, String body) {");
  lines.push('      super(path + " answered " + status + ": " + body);');
  lines.push("      this.status = status;");
  lines.push("    }");
  lines.push("  }");
  lines.push("");
  lines.push("  /** The raw body, as text. Callers parse with their own JSON library. */");
  lines.push("  protected String call(String verb, String path, String body, String contentType) {");
  lines.push("    HttpRequest.Builder request =");
  lines.push('        HttpRequest.newBuilder(URI.create(url + path)).header("authorization", "Bearer " + token);');
  lines.push("    if (body == null) {");
  lines.push("      request.method(verb.toUpperCase(), HttpRequest.BodyPublishers.noBody());");
  lines.push("    } else {");
  lines.push('      request.header("content-type", contentType);');
  lines.push("      request.method(verb.toUpperCase(), HttpRequest.BodyPublishers.ofString(body));");
  lines.push("    }");
  lines.push("    try {");
  lines.push(
    "      HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());",
  );
  lines.push("      if (response.statusCode() / 100 != 2) {");
  lines.push("        throw new ServiceException(response.statusCode(), path, response.body());");
  lines.push("      }");
  lines.push("      return response.body();");
  lines.push("    } catch (IOException | InterruptedException cause) {");
  lines.push("      throw new RuntimeException(path + \" could not be reached\", cause);");
  lines.push("    }");
  lines.push("  }");
  lines.push("");
  lines.push("  /** `GET /events/sse`, one JSON object per `data:` line. */");
  lines.push("  public Stream<String> events() {");
  lines.push("    HttpRequest request =");
  lines.push("        HttpRequest.newBuilder(URI.create(url + \"/events/sse\"))");
  lines.push('            .header("authorization", "Bearer " + token)');
  lines.push("            .build();");
  lines.push("    try {");
  lines.push(
    "      HttpResponse<Stream<String>> response = http.send(request, HttpResponse.BodyHandlers.ofLines());",
  );
  lines.push('      return response.body().filter(line -> line.startsWith("data:"))');
  lines.push('          .map(line -> line.substring(5).trim());');
  lines.push("    } catch (IOException | InterruptedException cause) {");
  lines.push('      throw new RuntimeException("the event stream could not be reached", cause);');
  lines.push("    }");
  lines.push("  }");
  lines.push("");
  lines.push("  protected static String segment(String value) {");
  lines.push(
    '    return URLEncoder.encode(value, StandardCharsets.UTF_8).replace("+", "%20");',
  );
  lines.push("  }");
  lines.push("");
  for (const one of endpoints) {
    const args = [
      ...one.params.map((name) => `String ${name}`),
      ...(one.hasBody ? ["String body"] : []),
    ];
    const expression = one.path
      .split(/(\{[^}]+\})/)
      .filter((part) => part !== "")
      .map((part) =>
        part.startsWith("{") ? `segment(${part.slice(1, -1)})` : JSON.stringify(part),
      )
      .join(" + ");
    lines.push(`  /** {@code ${one.verb.toUpperCase()} ${one.path}} — ${one.summary} */`);
    lines.push(`  public String ${one.id}(${args.join(", ")}) {`);
    lines.push(
      `    return call(${JSON.stringify(one.verb)}, ${expression}, ` +
        (one.hasBody ? "body" : "null") +
        ", " +
        (one.text ? '"text/plain"' : '"application/json"') +
        ");",
    );
    lines.push("  }");
    lines.push("");
  }
  lines.push("}");
  return `${lines.join("\n")}\n`;
}

/* ────────────────────────────────────────────────────────────────────────────
 * write, or diff
 * ──────────────────────────────────────────────────────────────────────────── */

const outputs = [
  { language: "ts", path: join(ROOT, "packages/sdk/src/generated.ts"), text: typescript() },
  {
    language: "py",
    path: join(ROOT, "clients/python/svatah_yam/generated.py"),
    text: python(),
  },
  {
    language: "java",
    path: join(ROOT, "clients/java/src/main/java/com/svatah/yam/sdk/GeneratedClient.java"),
    text: java(),
  },
].filter((one) => only === undefined || one.language === only);

let drifted = 0;
for (const one of outputs) {
  if (check) {
    const committed = existsSync(one.path) ? readFileSync(one.path, "utf8") : "";
    if (committed !== one.text) {
      drifted += 1;
      process.stderr.write(
        `${relative(ROOT, one.path)} is not what the description generates.\n` +
          `  ${committed === "" ? "It does not exist." : "It differs."} Run \`pnpm clients\` and read the diff.\n`,
      );
    }
    continue;
  }
  mkdirSync(dirname(one.path), { recursive: true });
  writeFileSync(one.path, one.text, "utf8");
  process.stderr.write(`wrote ${relative(ROOT, one.path)}\n`);
}

if (check) {
  if (drifted > 0) process.exit(1);
  process.stdout.write(
    `${outputs.length} client(s) match the description: ${endpoints.length} route(s), ` +
      `${eventKinds.length} event kind(s)\n`,
  );
} else {
  process.stdout.write(
    `${endpoints.length} route(s), ${eventKinds.length} event kind(s) → ${outputs.length} client(s)\n`,
  );
}
