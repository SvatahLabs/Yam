import { OPERATIONS, type OperationDescriptor } from "./catalogue.js";
import { zodToJsonSchema } from "zod-to-json-schema";

export interface OpenApiOperation {
  operationId: string;
  summary: string;
  method: string;
  path: string;
  requestBody?: Record<string, unknown>;
  responses: Record<string, unknown>;
}

export function generateOpenApiPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const op of OPERATIONS) {
    const method = op.service.method.toLowerCase();
    const path = `/surface${op.service.path}`;
    const schema = zodToJsonSchema(op.inputSchema, { target: "openApi3" });
    const outputSchema = zodToJsonSchema(op.outputSchema, { target: "openApi3" });

    const operation: Record<string, unknown> = {
      operationId: op.name,
      summary: op.description,
      tags: ["surface"],
      responses: {
        "200": {
          description: "Success",
          content: { "application/json": { schema: outputSchema } },
        },
      },
    };

    if (method === "post" || method === "put") {
      operation["requestBody"] = {
        required: true,
        content: { "application/json": { schema } },
      };
    } else if (method === "get") {
      const properties = (schema as Record<string, unknown>)["properties"] as Record<string, unknown> | undefined;
      if (properties && Object.keys(properties).length > 0) {
        operation["parameters"] = Object.entries(properties).map(([name, prop]) => ({
          name,
          in: "query",
          required: false,
          schema: prop,
        }));
      }
    }

    if (!paths[path]) paths[path] = {};
    paths[path]![method] = operation;
  }

  return paths;
}

export function generateOpenApiDocument(version: string): Record<string, unknown> {
  return {
    openapi: "3.0.3",
    info: {
      title: "Yam Surface Control API",
      version,
      description: "Surface control operations generated from the operation catalogue.",
    },
    paths: generateOpenApiPaths(),
  };
}

export function generateTypeScriptClient(): string {
  const lines: string[] = [
    "// Generated from the Yam surface operation catalogue. Do not edit.",
    "",
    "export interface SurfaceClient {",
    "  baseUrl: string;",
    "  token: string;",
    "}",
    "",
    "async function call(client: SurfaceClient, method: string, path: string, body?: unknown): Promise<unknown> {",
    "  const url = `${client.baseUrl}${path}`;",
    "  const response = await fetch(url, {",
    "    method,",
    '    headers: { "content-type": "application/json", authorization: `Bearer ${client.token}` },',
    "    body: body ? JSON.stringify(body) : undefined,",
    "  });",
    "  return response.json();",
    "}",
    "",
  ];

  for (const op of OPERATIONS) {
    const method = op.service.method;
    const path = `/surface${op.service.path}`;
    const paramNames = extractParams(op);

    lines.push(`export async function ${op.name}(`);
    lines.push(`  client: SurfaceClient,`);
    if (paramNames.length > 0 || method !== "GET") {
      lines.push(`  input: Record<string, unknown>,`);
    }
    lines.push(`): Promise<unknown> {`);

    let actualPath = `"${path}"`;
    if (path.includes(":session")) {
      actualPath = `"${path}".replace(":session", String(input.session))`;
    }

    if (method === "GET") {
      lines.push(`  return call(client, "${method}", ${actualPath});`);
    } else {
      lines.push(`  return call(client, "${method}", ${actualPath}, input);`);
    }
    lines.push("}");
    lines.push("");
  }

  return lines.join("\n");
}

export function generatePythonClient(): string {
  const lines: string[] = [
    "# Generated from the Yam surface operation catalogue. Do not edit.",
    "import requests",
    "",
    "",
    "class SurfaceClient:",
    "    def __init__(self, base_url: str, token: str):",
    "        self.base_url = base_url",
    "        self.token = token",
    "",
    '    def _call(self, method: str, path: str, body=None):',
    '        url = f"{self.base_url}{path}"',
    '        headers = {"Authorization": f"Bearer {self.token}", "Content-Type": "application/json"}',
    '        resp = requests.request(method, url, json=body, headers=headers)',
    "        return resp.json()",
    "",
  ];

  for (const op of OPERATIONS) {
    const method = op.service.method;
    const path = `/surface${op.service.path}`;
    const pyName = op.name.replace(/([A-Z])/g, "_$1").toLowerCase();

    if (method === "GET" && !op.requiresSession) {
      lines.push(`    def ${pyName}(self):`);
      lines.push(`        return self._call("${method}", "${path}")`);
    } else if (op.requiresSession) {
      lines.push(`    def ${pyName}(self, session: str, **kwargs):`);
      lines.push(`        path = "${path}".replace(":session", session)`);
      if (method === "GET") {
        lines.push(`        return self._call("${method}", path)`);
      } else {
        lines.push(`        return self._call("${method}", path, {"session": session, **kwargs})`);
      }
    } else {
      lines.push(`    def ${pyName}(self, **kwargs):`);
      lines.push(`        return self._call("${method}", "${path}", kwargs)`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

export function generateJavaClient(): string {
  const lines: string[] = [
    "// Generated from the Yam surface operation catalogue. Do not edit.",
    "package com.svatah.yam.surface;",
    "",
    "import java.net.http.*;",
    "import java.net.URI;",
    "",
    "public class SurfaceClient {",
    "    private final String baseUrl;",
    "    private final String token;",
    "    private final HttpClient client = HttpClient.newHttpClient();",
    "",
    "    public SurfaceClient(String baseUrl, String token) {",
    "        this.baseUrl = baseUrl;",
    "        this.token = token;",
    "    }",
    "",
    '    private String call(String method, String path, String body) throws Exception {',
    '        var builder = HttpRequest.newBuilder(URI.create(baseUrl + path))',
    '            .header("Authorization", "Bearer " + token)',
    '            .header("Content-Type", "application/json");',
    '        if ("GET".equals(method)) builder.GET();',
    '        else if ("DELETE".equals(method)) builder.DELETE();',
    '        else builder.method(method, HttpRequest.BodyPublishers.ofString(body != null ? body : "{}"));',
    "        return client.send(builder.build(), HttpResponse.BodyHandlers.ofString()).body();",
    "    }",
    "",
  ];

  for (const op of OPERATIONS) {
    const method = op.service.method;
    const path = `/surface${op.service.path}`;
    const javaName = op.name;

    if (op.requiresSession) {
      lines.push(`    public String ${javaName}(String session, String input) throws Exception {`);
      lines.push(`        return call("${method}", "${path}".replace(":session", session), input);`);
    } else {
      lines.push(`    public String ${javaName}(String input) throws Exception {`);
      lines.push(`        return call("${method}", "${path}", input);`);
    }
    lines.push("    }");
    lines.push("");
  }

  lines.push("}");
  return lines.join("\n");
}

function extractParams(op: OperationDescriptor): string[] {
  const path = op.service.path;
  const matches = path.match(/:(\w+)/g) ?? [];
  return matches.map((m) => m.slice(1));
}
