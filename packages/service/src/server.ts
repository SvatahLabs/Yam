/**
 * The local service (REQ-ADE-1, REQ-ADE-7, LLD §13.5).
 *
 * "`svatah serve --project <dir> --port <p> [--token <t>]` starts a Fastify
 * server bound to `127.0.0.1` with a bearer token printed on stdout. Every
 * handler calls the same functions the CLI calls; no logic lives in the service."
 *
 * ## No logic here, and the boundary that keeps it that way
 *
 * A handler reads its arguments, calls one function from `@svatah/cli`, and
 * shapes the answer. That is the whole rule, and LLD §1's import boundary is
 * what enforces it: `service` may import `cli` and `schema` and nothing else. If
 * the service could reach the compiler or the runtime directly, it would grow a
 * second implementation of `run`, and the ADE and the CLI would start disagreeing
 * about what a run is.
 *
 * ## Bound to loopback, behind a token
 *
 * This is a developer's own machine, and the service can compile, run and edit
 * files in a project. Two things make that acceptable: it listens on 127.0.0.1
 * only, and every route but `/health` and `/openapi.json` needs a bearer token
 * that is generated per process and printed once on stdout — which is how the
 * ADE reads it from the child process it spawned. It is not a server, it has no
 * users, and REQ-ADE-7 says it never becomes one.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, normalize, relative, resolve, sep } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import websocket from "@fastify/websocket";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import type { ProjectHandle, ServiceApi } from "./api.js";
import { EventBus, type ServiceEvent } from "./events.js";
import { openApiDocument } from "./openapi.js";

export interface ServeOptions {
  /** The project directory. Everything the service reads and writes is under it. */
  readonly project: string;
  /**
   * The CLI's own functions (LLD §13.5).
   *
   * Injected rather than imported: see `api.ts`. The dependency points one way,
   * and a handler literally cannot reach the compiler or the executor.
   */
  readonly api: ServiceApi;
  /** 0 asks the OS for a free port, which is what the ADE wants. */
  readonly port?: number;
  /** Supplied only by a test; otherwise generated per process. */
  readonly token?: string;
  readonly version?: string;
  readonly logger?: boolean;
}

export interface RunningService {
  readonly url: string;
  readonly port: number;
  readonly token: string;
  readonly events: EventBus;
  readonly fastify: FastifyInstance;
  close(): Promise<void>;
}

/** A path inside the project, or nothing. */
function insideProject(root: string, relativePath: string): string | undefined {
  const target = resolve(root, normalize(relativePath));
  const inside = relative(root, target);
  // A path that climbs out with `..`, or that is absolute, is refused. The
  // service edits a project; it is not a file browser.
  if (inside.startsWith("..") || inside.startsWith(sep) || inside === "") return undefined;
  return target;
}

export async function createService(options: ServeOptions): Promise<RunningService> {
  const root = resolve(options.project);
  const token = options.token ?? randomBytes(24).toString("base64url");
  const events = new EventBus();

  const fastify = Fastify({ logger: options.logger ?? false });
  await fastify.register(websocket);

  /* ── the token, on every route but the two a client needs before it has one ── */

  const OPEN = new Set(["/health", "/openapi.json"]);

  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    if (OPEN.has(request.url.split("?")[0] ?? "")) return;
    const header = request.headers.authorization ?? "";
    const given = header.startsWith("Bearer ") ? header.slice(7) : request.headers["x-svatah-token"];
    if (given !== token) {
      await reply.code(401).send({
        error: "unauthorised",
        message:
          "This service needs the bearer token it printed on stdout when it started. " +
          "It is generated per process and is not stored anywhere.",
      });
    }
  });

  /* ── project ────────────────────────────────────────────────────────────── */

  const { api } = options;
  const load = async (): Promise<ProjectHandle> => await api.loadProject(root);

  fastify.get("/health", async () => ({ ok: true, project: root }));
  fastify.get("/openapi.json", async () => openApiDocument(options.version ?? "0.1.0"));

  fastify.get("/project", async () => {
    const loaded = await load();
    return {
      root,
      config: loaded.config,
      flows: loaded.project.flows.map((flow) => flow.file),
      stories: [...loaded.project.stories.entries()].map(([name, { story, file }]) => ({
        name,
        file,
        kind: story.kind,
        steps: story.steps.length,
        ...(story.signature === undefined ? {} : { signature: story.signature }),
      })),
      compositions: Object.fromEntries(
        [...loaded.project.compositions].map(([name, c]) => [name, c.names]),
      ),
      runs: Object.fromEntries(loaded.project.runs),
      apis: [...loaded.project.apis.requests.keys()],
      customSteps: loaded.steps.ids(),
      diagnostics: loaded.diagnostics,
    };
  });

  fastify.get<{ Params: { "*": string } }>("/flows/*", async (request, reply) => {
    const path = insideProject(root, join("flows", request.params["*"]));
    if (path === undefined || !existsSync(path)) return reply.code(404).send({ error: "not-found" });
    return reply.type("text/plain; charset=utf-8").send(readFileSync(path, "utf8"));
  });

  fastify.put<{ Params: { "*": string }; Body: string }>("/flows/*", async (request, reply) => {
    const path = insideProject(root, join("flows", request.params["*"]));
    if (path === undefined) return reply.code(400).send({ error: "outside-project" });
    writeFileSync(path, typeof request.body === "string" ? request.body : String(request.body), "utf8");
    return { ok: true, file: relative(root, path).split(sep).join("/") };
  });

  fastify.post("/compile", async () => {
    const loaded = await load();
    const compiled = api.compileProject(loaded, { stable: true });
    const diagnostics = [...loaded.diagnostics, ...compiled.diagnostics];
    return {
      ok: !diagnostics.some((d) => d.severity === "error"),
      plan: { hash: compiled.plan.hash, stories: compiled.plan.stories.length },
      errors: diagnostics.filter((d) => d.severity === "error"),
      warnings: diagnostics.filter((d) => d.severity === "warning"),
    };
  });

  /**
   * The compiled plan itself (T3.7).
   *
   * `POST /compile` answers with a reference — the hash and a count — because
   * that is what a caller checking whether a project compiles wants. The ADE's
   * Plan screen wants the steps: their tier, their confidence, and which targets
   * are still `unbound`. That is exactly the object `svatah compile` writes to
   * `.svatah/plan.json`, so serving it keeps the screen rule (T3.7: "every screen
   * renders a service response or a project file and nothing the CLI cannot
   * produce") rather than bending it.
   */
  fastify.get("/plan", async () => {
    const loaded = await load();
    return api.compileProject(loaded, { stable: true }).plan;
  });

  /* ── runs ───────────────────────────────────────────────────────────────── */

  fastify.post<{ Body?: { flows?: string[]; stories?: string[]; inputs?: Record<string, unknown> } }>(
    "/run",
    async (request, reply) => {
      const body = request.body ?? {};

      /*
       * Missing inputs are a 400, before anything starts (Draft 2.4, LLD §13.5).
       *
       * A story with a signature is a function (REQ-AUTO-5), and calling one
       * without its arguments is a mistake in the call, not a run that failed.
       * Answering 202 and letting the executor fail on the first step would give
       * the ADE a red run to display and a person a screenshot of a login page
       * to puzzle over — when what happened is that nobody typed a password.
       *
       * `GET /project` carries each story's signature so a client can ask for
       * them first; this is what happens when it did not.
       */
      const loadedForCheck = await load();
      const missing = missingInputs(loadedForCheck, body);
      if (missing.length > 0) {
        return reply.code(400).send({
          error: "missing-inputs",
          missing,
          message:
            `This run needs ${missing.length === 1 ? "an input" : "inputs"} nothing supplied: ` +
            `${missing.map((m) => `"${m.story}".${m.name}`).join(", ")}. ` +
            "Every story's signature is in GET /project.",
        });
      }

      const runId = api.newRunId();

      /*
       * Started, then answered. A client gets the run id immediately and
       * watches the stream; blocking until a browser run finished would make
       * the ADE's Run screen a spinner (REQ-ADE-3).
       */
      void (async () => {
        try {
          const loaded = await load();
          events.emit({ kind: "run.started", runId, flows: body.flows ?? loaded.project.flows.map((f) => f.file) });
          const outcome = await api.runProject(loaded, {
            runId,
            ...(body.flows === undefined ? {} : { flows: body.flows }),
            ...(body.stories === undefined ? {} : { stories: body.stories }),
            ...(body.inputs === undefined ? {} : { inputs: body.inputs }),
            onResult: (result) => events.emit({ kind: "step.result", runId, result }),
          });
          events.emit({ kind: "run.summary", runId, summary: outcome.summary });
        } catch (error) {
          events.emit({
            kind: "run.failed",
            runId,
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })();

      return reply.code(202).send({ runId });
    },
  );

  const runsDir = async (): Promise<string> => join(root, (await load()).config.run.outputDir);


  fastify.get("/runs", async () => {
    const dir = await runsDir();
    if (!existsSync(dir)) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "summary.json")))
      .map((entry) => JSON.parse(readFileSync(join(dir, entry.name, "summary.json"), "utf8")) as unknown)
      .sort((a, b) => String((b as { runId: string }).runId).localeCompare(String((a as { runId: string }).runId)));
  });

  const runFile = async (id: string, name: string): Promise<string | undefined> => {
    const path = insideProject(root, join(relative(root, await runsDir()), id, name));
    return path !== undefined && existsSync(path) ? path : undefined;
  };

  fastify.get<{ Params: { id: string } }>("/runs/:id", async (request, reply) => {
    const path = await runFile(request.params.id, "summary.json");
    if (path === undefined) return reply.code(404).send({ error: "not-found" });
    return JSON.parse(readFileSync(path, "utf8")) as unknown;
  });

  const lines = (path: string): unknown[] =>
    readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter((line) => line !== "")
      .map((line) => JSON.parse(line) as unknown);

  fastify.get<{ Params: { id: string } }>("/runs/:id/results", async (request, reply) => {
    const path = await runFile(request.params.id, "results.jsonl");
    if (path === undefined) return reply.code(404).send({ error: "not-found" });
    return lines(path);
  });

  fastify.get<{ Params: { id: string } }>("/runs/:id/audit", async (request, reply) => {
    const path = await runFile(request.params.id, "audit.jsonl");
    if (path === undefined) return reply.code(404).send({ error: "not-found" });
    return lines(path);
  });

  /* ── bindings, data, api ────────────────────────────────────────────────── */

  const bindingFiles = async (): Promise<Array<{ id: string; file: string; text: string }>> => {
    const loaded = await load();
    const dir = join(root, loaded.config.bindings.dir);
    const out: Array<{ id: string; file: string; text: string }> = [];
    const walk = (current: string): void => {
      if (!existsSync(current)) return;
      for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (entry.name.endsWith(".yaml")) {
          const text = readFileSync(path, "utf8");
          out.push({
            id: /^id: "(.+)"$/m.exec(text)?.[1] ?? entry.name.replace(/\.yaml$/, ""),
            file: relative(root, path).split(sep).join("/"),
            text,
          });
        }
      }
    };
    walk(dir);
    return out;
  };

  fastify.get("/bindings", async () =>
    (await bindingFiles()).map(({ id, file }) => ({ id, file })),
  );

  fastify.get<{ Params: { id: string } }>("/bindings/:id", async (request, reply) => {
    const found = (await bindingFiles()).find((one) => one.id === request.params.id);
    if (found === undefined) return reply.code(404).send({ error: "not-found" });
    return reply.type("text/yaml; charset=utf-8").send(found.text);
  });

  fastify.get("/data", async () => {
    const loaded = await load();
    /*
     * Secrets are redacted on read (LLD §13.5).
     *
     * The ADE shows a data editor, and a value that is a `${ENV}` indirection is
     * a name rather than a secret — but a *resolved* one is the secret itself,
     * and it must not travel to a renderer that could log it (REQ-NFR-6).
     */
    const redact = (tree: Record<string, unknown>, prefix = ""): Record<string, unknown> =>
      Object.fromEntries(
        Object.entries(tree).map(([key, value]) => {
          const path = prefix === "" ? key : `${prefix}.${key}`;
          if (typeof value === "object" && value !== null && !Array.isArray(value)) {
            return [key, redact(value as Record<string, unknown>, path)];
          }
          return [key, loaded.project.data.secrets.has(path) ? REDACTED : value];
        }),
      );

    return {
      values: redact(loaded.project.data.values as Record<string, unknown>),
      secrets: [...loaded.project.data.secrets],
    };
  });

  fastify.get("/api", async () => {
    const loaded = await load();
    return [...loaded.project.apis.requests.values()];
  });

  /**
   * Write `data.yaml`, keeping the secrets the read redacted (LLD §13.5).
   *
   * `GET /data` replaces every resolved secret with `«redacted»` so it never
   * reaches a renderer (REQ-NFR-6). A naive write-back would then store that
   * marker over the real value and quietly destroy it, so a value that comes
   * back still redacted means "unchanged" and the file keeps what it had. The
   * only way to change a secret is to change the environment it indirects to,
   * which is where a secret belongs.
   */
  fastify.put<{ Body: { values?: Record<string, unknown> } }>("/data", async (request, reply) => {
    const loaded = await load();
    const file = join(root, String((loaded.config as { data?: { file?: string } }).data?.file ?? "data.yaml"));

    const supplied = request.body?.values;
    if (supplied === undefined || typeof supplied !== "object") {
      return reply.code(400).send({ error: "no-values", message: "Send { values: { … } }." });
    }

    /*
     * Merged over the file as it is on disk, not over the project as loaded.
     *
     * The loaded project has every `${ENV}` indirection *resolved*, so merging
     * over it and writing the result would put the plaintext secret into
     * `data.yaml` — the opposite of what the redaction is for. The raw file has
     * `${SVATAH_SAMPLE_PASSWORD}`, which is exactly what has to stay.
     *
     * `secrets:` is a key of the same file, and it is not a value the editor
     * shows; it is carried across untouched, because a save that dropped it
     * would un-declare every secret in the project.
     */
    const raw = (existsSync(file) ? (parseYaml(readFileSync(file, "utf8")) as unknown) : {}) ?? {};
    const onDisk = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
    const { secrets, ...values } = onDisk;

    const merged = keepRedacted(supplied, values, loaded.project.data.secrets);

    writeFileSync(
      file,
      stringifyYaml(secrets === undefined ? merged : { ...merged, secrets }),
      "utf8",
    );
    return { ok: true, file: relative(root, file).split(sep).join("/") };
  });

  /** Save a named request under `api/<name>.yaml` (LLD §13.5). */
  fastify.put<{ Params: { name: string }; Body: unknown }>(
    "/api/:name",
    async (request, reply) => {
      const loaded = await load();
      const dir = String((loaded.config as { api?: { dir?: string } }).api?.dir ?? "api");
      const path = insideProject(root, join(dir, `${request.params.name}.yaml`));
      if (path === undefined) return reply.code(400).send({ error: "outside-project" });

      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, stringifyYaml(request.body), "utf8");
      return { ok: true, file: relative(root, path).split(sep).join("/") };
    },
  );

  /**
   * Execute one request ad hoc, for the ADE's API client (LLD §13.5).
   *
   * Through the same function `svatah run` uses for an `api` step, injected like
   * every other. An ADE that had its own HTTP client would have its own idea of
   * a header, a redirect and a cookie, and "the API client agrees with the run"
   * would be a coincidence.
   */
  fastify.post<{ Body: { request?: unknown; withSessionCookies?: boolean } }>(
    "/api/request",
    async (request, reply) => {
      if (api.apiRequest === undefined) {
        return reply
          .code(501)
          .send({ error: "no-http-adapter", message: "This service was started without one." });
      }
      const body = request.body ?? {};
      if (body.request === undefined) {
        return reply.code(400).send({ error: "no-request", message: "Send { request: { … } }." });
      }
      try {
        return await api.apiRequest(await load(), body.request, {
          withSessionCookies: body.withSessionCookies === true,
        });
      } catch (error) {
        return reply.code(400).send({
          error: "request-failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  /** A screenshot a run wrote (LLD §13.5). Bounded to the run's own directory. */
  fastify.get<{ Params: { id: string; name: string } }>(
    "/runs/:id/screenshots/:name",
    async (request, reply) => {
      const path = await runFile(request.params.id, join("screenshots", request.params.name));
      if (path === undefined) return reply.code(404).send({ error: "not-found" });
      return reply.type("image/png").send(readFileSync(path));
    },
  );

  /* ── the event stream ───────────────────────────────────────────────────── */

  fastify.get("/events", { websocket: true }, (socket) => {
    const unsubscribe = events.subscribe((event: ServiceEvent) => {
      socket.send(JSON.stringify(event));
    });
    socket.on("close", unsubscribe);
  });

  fastify.get("/events/sse", (request, reply) => {
    /*
     * `hijack()` hands the socket over: Fastify must not try to send a body of
     * its own after this, because the body *is* the stream and never ends.
     */
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      // Some proxies buffer a stream into nothing without this.
      "x-accel-buffering": "no",
    });
    // A comment line, so the client sees the stream open before anything is
    // emitted — `fetch` does not resolve a body until the first byte arrives.
    reply.raw.write(": open\n\n");

    const unsubscribe = events.subscribe((event) => {
      reply.raw.write(`event: ${event.kind}\ndata: ${JSON.stringify(event)}\n\n`);
    });
    request.raw.on("close", () => {
      unsubscribe();
      reply.raw.end();
    });
  });

  await fastify.listen({ host: "127.0.0.1", port: options.port ?? 0 });
  const address = fastify.server.address();
  const port = typeof address === "object" && address !== null ? address.port : (options.port ?? 0);

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    token,
    events,
    fastify,
    close: async () => {
      await fastify.close();
    },
  };
}

/**
 * Merge an edited data tree over the file's own, keeping every secret as it was.
 *
 * A path the project declared secret always takes the file's value, whatever the
 * editor sent. That is stronger than checking for the `«redacted»` marker and it
 * is the rule stated plainly: the editor never saw the secret, so it has nothing
 * to say about it, and the only way to change one is to change the environment it
 * indirects to.
 *
 * `onDisk` must be the *raw* tree — `${SVATAH_SAMPLE_PASSWORD}`, not what that
 * resolves to — or this would write the plaintext into a committed file.
 *
 * Recursive, because a secret can be nested (`user.password`).
 */
export function keepRedacted(
  supplied: Record<string, unknown>,
  onDisk: Record<string, unknown>,
  secrets: ReadonlySet<string>,
  prefix = "",
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(supplied)) {
    const path = prefix === "" ? key : `${prefix}.${key}`;
    const existing = onDisk[key];

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      out[key] = keepRedacted(
        value as Record<string, unknown>,
        (typeof existing === "object" && existing !== null ? existing : {}) as Record<
          string,
          unknown
        >,
        secrets,
        path,
      );
      continue;
    }

    out[key] = secrets.has(path) || value === REDACTED ? existing : value;
  }
  return out;
}

/** What `GET /data` puts where a resolved secret was. */
export const REDACTED = "«redacted»";

/* ── run inputs ───────────────────────────────────────────────────────────── */

/** One input a story declared and the run did not supply. */
export interface MissingInput {
  readonly story: string;
  readonly name: string;
  readonly type: string;
}

/**
 * The stories a run invokes directly (Draft 2.4, LLD §13.5).
 *
 * `--story` names them outright. Otherwise it is the run blocks of the flows in
 * scope, with compositions expanded — the same order the executor derives, and
 * the same set, because a run block naming a composition runs its stories.
 *
 * "Directly" is the word that matters: a story reached through an `invoke` step
 * gets its inputs from the calling step, not from the run, so requiring them
 * here would refuse a run that was always going to work.
 */
export function storiesInvokedDirectly(
  loaded: ProjectHandle,
  body: { flows?: readonly string[]; stories?: readonly string[] },
): string[] {
  if (body.stories !== undefined && body.stories.length > 0) return [...body.stories];

  const flows =
    body.flows === undefined || body.flows.length === 0
      ? loaded.project.flows.map((flow) => flow.file)
      : [...body.flows];

  const names: string[] = [];
  for (const flow of flows) {
    for (const entry of loaded.project.runs.get(flow) ?? []) {
      const composition = loaded.project.compositions.get(entry);
      for (const name of composition?.names ?? [entry]) {
        if (!names.includes(name)) names.push(name);
      }
    }
  }
  return names;
}

/**
 * The declared inputs with no default that the run did not supply.
 *
 * Empty is the answer for a story with no signature, which is most of them: a
 * story that never declared an input cannot be missing one.
 */
export function missingInputs(
  loaded: ProjectHandle,
  body: { flows?: readonly string[]; stories?: readonly string[]; inputs?: Record<string, unknown> },
): MissingInput[] {
  const supplied = body.inputs ?? {};
  const missing: MissingInput[] = [];

  for (const name of storiesInvokedDirectly(loaded, body)) {
    const signature = loaded.project.stories.get(name)?.story.signature as
      | { inputs?: Record<string, { type: string; default?: unknown }> }
      | undefined;

    for (const [input, declared] of Object.entries(signature?.inputs ?? {})) {
      if (declared.default !== undefined) continue;
      if (Object.prototype.hasOwnProperty.call(supplied, input)) continue;
      missing.push({ story: name, name: input, type: declared.type });
    }
  }
  return missing;
}
