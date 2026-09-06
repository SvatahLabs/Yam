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
      /*
       * Whether a model credential is present — not what it is (REQ-ADE-4,
       * Draft 2.7).
       *
       * The Record screen needs it to offer a gateway it can actually reach:
       * `anthropic` when this is true, `fake` when it is not. A boolean is all
       * that question needs, and it is all the service will say. The key never
       * crosses the wire.
       */
      gateway: { credential: api.hasModelCredential?.() ?? false },
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

  /**
   * The runs that are going, so one can be stopped (Draft 2.12 §13.5, T10.4).
   *
   * A run id maps to the `AbortController` its executor is watching, and the
   * entry is dropped when the run ends — so `POST /runs/:id/stop` for a run that
   * has finished is a 404 rather than a success that did nothing. The same shape
   * as the recording sessions' map below, for the same reason.
   */
  const running = new Map<string, AbortController>();

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
       * The handle `POST /runs/:id/stop` aborts (Draft 2.12 §13.5, T10.4).
       *
       * Held for as long as the run is going and dropped when it ends, so a run
       * id can only be stopped while there is something to stop — a stop for a
       * run that has finished is a 404 and not a silent success.
       */
      const stopper = new AbortController();
      running.set(runId, stopper);

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
            signal: stopper.signal,
          });
          events.emit({ kind: "run.summary", runId, summary: outcome.summary });
        } catch (error) {
          events.emit({
            kind: "run.failed",
            runId,
            message: error instanceof Error ? error.message : String(error),
          });
        } finally {
          running.delete(runId);
        }
      })();

      return reply.code(202).send({ runId });
    },
  );

  /**
   * Stop a run that is going (Draft 2.12 §13.5, T10.4).
   *
   * The executor cancels **between steps**: a step already under way has
   * touched the application and its result is the only account of what it did,
   * so it finishes and the steps after it are recorded `skipped`. The summary
   * says `stopped: true` and `audit.jsonl` gains a `stop` line naming the last
   * step that ran.
   *
   * 202 rather than 200: the run is *stopping*, and the caller learns it has
   * stopped from `run.summary` on the stream, exactly as it learns everything
   * else about a run.
   */
  fastify.post<{ Params: { id: string } }>("/runs/:id/stop", async (request, reply) => {
    const stopper = running.get(request.params.id);
    if (stopper === undefined) {
      return reply.code(404).send({
        error: "not-running",
        message:
          `No run "${request.params.id}" is going. A run that has already finished cannot be ` +
          "stopped; GET /runs/:id has its summary.",
      });
    }
    stopper.abort();
    return reply.code(202).send({ ok: true, runId: request.params.id });
  });

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

    /*
     * Where each secret is read from, and whether this service can read it
     * (T10.2, the `Data` artboard).
     *
     * The *name* of an environment variable is not a secret — it is what
     * `data.yaml` says on its face, and the screen has to show it or a reader
     * cannot tell a declared secret from a missing one. What never leaves is the
     * value: `set` is a boolean, computed here, exactly as `GET /project`'s
     * `gateway.credential` is (REQ-NFR-6, REQ-ADE-4).
     *
     * Read from the *raw* file rather than from the loaded project, because the
     * loaded one has every indirection already resolved — which is the thing
     * this must not look at.
     */
    const onDisk = rawData(loaded);
    const sources: Record<string, { reads?: string; set: boolean }> = {};
    for (const path of loaded.project.data.secrets) {
      const raw = readPath(onDisk, path);
      const reads = typeof raw === "string" ? /^\$\{([A-Za-z_][A-Za-z0-9_]*)\}$/.exec(raw)?.[1] : undefined;
      sources[path] = {
        ...(reads === undefined ? {} : { reads }),
        // A literal secret in the file is "set" by being there; an indirection
        // is set when the environment has it.
        set: reads === undefined ? raw !== undefined : process.env[reads] !== undefined,
      };
    }

    return {
      values: redact(loaded.project.data.values as Record<string, unknown>),
      secrets: [...loaded.project.data.secrets],
      secretSources: sources,
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

  /* ── T5.7: record with review (REQ-ADE-4, LLD §13.5) ────────────────────── */

  /**
   * One recording session at a time, and the reviewer it is waiting on.
   *
   * Held in memory rather than in the project, because it is a *session*: a
   * browser is open and a step is half-done. REQ-ADE-2's "the project directory
   * is the only source of truth" is about artifacts, and nothing here becomes
   * one until the session writes the store.
   */
  const recording = new Map<
    string,
    {
      readonly abort: AbortController;
      /** Set while a grounding is waiting for `POST /record/:id/decision`. */
      pending?: {
        readonly elementId: string;
        resolve(decision: unknown): void;
        /** Cleared when the decision arrives (LLD §13.5, Draft 2.7). */
        readonly deadline: ReturnType<typeof setTimeout>;
      };
      surface?: { snapshot(options?: unknown): Promise<unknown> };
    }
  >();

  /**
   * How long a pending decision may wait (LLD §13.5, Draft 2.7).
   *
   * `record.decisionDeadlineMs`, default ten minutes. Read from the project's
   * own config rather than a constant here, because how long a review takes is
   * a property of the project being reviewed — a fixture project in CI wants
   * seconds, a person reading candidate tables wants minutes.
   */
  const decisionDeadlineMs = (loaded: ProjectHandle): number => {
    const record = (loaded.config as { record?: { decisionDeadlineMs?: unknown } }).record;
    const configured = record?.decisionDeadlineMs;
    return typeof configured === "number" && configured > 0 ? configured : 600_000;
  };

  fastify.post<{
    Body?: {
      stories?: string[];
      flows?: string[];
      rebind?: boolean;
      headed?: boolean;
      gateway?: string;
      inputs?: Record<string, unknown>;
    };
  }>("/record", async (request, reply) => {
    if (api.record === undefined) {
      return reply.code(501).send({ error: "not-available", message: "This build has no recorder." });
    }
    if (recording.size > 0) {
      return reply.code(409).send({
        error: "already-recording",
        message: "A recording session is already open. Stop it before starting another.",
      });
    }

    const body = request.body ?? {};
    const sessionId = api.newRunId();
    const abort = new AbortController();
    const session: NonNullable<ReturnType<(typeof recording)["get"]>> = { abort };
    recording.set(sessionId, session);

    void (async () => {
      try {
        events.emit({ kind: "record.started", sessionId });
        const project = await load();
        const deadlineMs = decisionDeadlineMs(project);
        const report = await api.record!(project, {
          ...(body.stories === undefined ? {} : { stories: body.stories }),
          ...(body.flows === undefined ? {} : { flows: body.flows }),
          ...(body.rebind === undefined ? {} : { rebind: body.rebind }),
          ...(body.headed === undefined ? {} : { headed: body.headed }),
          ...(body.gateway === undefined ? {} : { gateway: body.gateway }),
          ...(body.inputs === undefined ? {} : { inputs: body.inputs }),
          signal: abort.signal,
          onSurface: (surface) => {
            session.surface = surface as { snapshot(options?: unknown): Promise<unknown> };
          },
          onStep: (step) => events.emit({ kind: "record.step", sessionId, step }),
          /*
           * The reviewer (REQ-ADE-4). The session blocks here until the client
           * answers, which is the whole point: a decision taken after the store
           * was written would be an undo, not a review.
           */
          review: (proposal) =>
            new Promise((resolveDecision) => {
              const one = proposal as {
                elementId: string;
                entry: { candidates: unknown[]; fingerprint: unknown };
              };
              /*
               * The deadline (LLD §13.5, Draft 2.7).
               *
               * A session blocked here holds a browser open and, because only
               * one session may be open at a time, answers 409 to everyone
               * else — so a reviewer who closes the ADE window without
               * deciding used to leave the service unusable until it was
               * restarted. On expiry the pending grounding is rejected and the
               * session is aborted, which stops it with a report: the same
               * path `POST /record/{id}/stop` takes, so nothing half-decided
               * reaches the store either way.
               */
              const deadline = setTimeout(() => {
                if (session.pending?.elementId !== one.elementId) return;
                session.pending = undefined;
                events.emit({
                  kind: "record.decision.expired",
                  sessionId,
                  elementId: one.elementId,
                  afterMs: deadlineMs,
                });
                resolveDecision({
                  accept: false,
                  why: `no decision within ${deadlineMs} ms (record.decisionDeadlineMs)`,
                });
                session.abort.abort();
              }, deadlineMs);
              // The timer must not keep the process alive on its own; a
              // service with an idle session is still a service that can exit.
              deadline.unref?.();
              session.pending = { elementId: one.elementId, resolve: resolveDecision, deadline };
              events.emit({ kind: "record.decision", sessionId, proposal });
              events.emit({
                kind: "record.candidates",
                sessionId,
                elementId: one.elementId,
                candidates: one.entry.candidates,
                fingerprint: one.entry.fingerprint,
              });
            }),
        });
        events.emit({ kind: "record.finished", sessionId, report });
      } catch (error) {
        events.emit({
          kind: "record.failed",
          sessionId,
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        recording.delete(sessionId);
      }
    })();

    return reply.code(202).send({ sessionId });
  });

  fastify.post<{
    Params: { id: string };
    Body?: { accept?: boolean; repick?: string; why?: string };
  }>("/record/:id/decision", async (request, reply) => {
    const session = recording.get(request.params.id);
    if (session?.pending === undefined) {
      return reply.code(404).send({
        error: "nothing-pending",
        message: "No grounding in this session is waiting for a decision.",
      });
    }
    const body = request.body ?? {};
    const pending = session.pending;
    clearTimeout(pending.deadline);
    session.pending = undefined;
    pending.resolve(
      body.accept === true
        ? { accept: true }
        : body.repick !== undefined
          ? { accept: false, repick: body.repick }
          : { accept: false, ...(body.why === undefined ? {} : { why: body.why }) },
    );
    return reply.code(202).send({ ok: true });
  });

  /**
   * The driven session's snapshot, so a reviewer can re-pick by clicking
   * (REQ-ADE-4, LLD §13.6's "`POST /surface/:session/snapshot` for re-pick").
   */
  fastify.post<{ Params: { session: string }; Body?: Record<string, unknown> }>(
    "/surface/:session/snapshot",
    async (request, reply) => {
      const recorder = recording.get(request.params.session);
      if (recorder?.surface !== undefined) {
        return await recorder.surface.snapshot(request.body ?? {});
      }
      const explorer = exploring.get(request.params.session);
      if (explorer !== undefined) return await explorer.call("snapshot", request.body ?? {});
      return reply.code(404).send({ error: "no-session", message: "No session by that id." });
    },
  );

  fastify.post<{ Params: { id: string } }>("/record/:id/stop", async (request, reply) => {
    const session = recording.get(request.params.id);
    if (session === undefined) {
      return reply.code(404).send({ error: "no-session" });
    }
    if (session.pending !== undefined) clearTimeout(session.pending.deadline);
    session.pending?.resolve({ accept: false, why: "the session was stopped" });
    session.pending = undefined;
    session.abort.abort();
    return reply.code(202).send({ ok: true });
  });

  /* ── T6.6: the prototype database import (REQ-ADE-9) ────────────────────── */

  fastify.post<{ Body?: { source?: string; project?: string } }>(
    "/migrate",
    async (request, reply) => {
      if (api.migrateFromAde === undefined) {
        return reply
          .code(501)
          .send({ error: "not-available", message: "This build has no migration." });
      }
      const source = request.body?.source;
      if (source === undefined || source.trim() === "") {
        return reply.code(400).send({
          error: "no-source",
          message: "`source` must be the path of the prototype's electron-db directory.",
        });
      }
      try {
        const result = await api.migrateFromAde(await load(), {
          source,
          ...(request.body?.project === undefined ? {} : { project: request.body.project }),
        });
        return reply.code(200).send(result);
      } catch (error) {
        /*
         * A 400, not a 500. Every way this fails is something about the
         * *input* — no `project` table, a project name that is not in the
         * database, a directory that is not one — and a 500 would send whoever
         * reads it looking at the service.
         */
        return reply.code(400).send({
          error: "import-failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  /* ── T5.7: bindings verify and heal review (REQ-ADE-5) ───────────────────── */

  fastify.post<{ Body?: { id?: string; headed?: boolean } }>(
    "/bindings/verify",
    async (request, reply) => {
      if (api.verifyBindings === undefined) {
        return reply.code(501).send({ error: "not-available" });
      }
      const body = request.body ?? {};
      return await api.verifyBindings(await load(), {
        ...(body.id === undefined ? {} : { id: body.id }),
        ...(body.headed === undefined ? {} : { headed: body.headed }),
      });
    },
  );

  fastify.post<{
    Body?: { runId?: string; useModel?: boolean; apply?: boolean; inputs?: Record<string, unknown> };
  }>("/heal", async (request, reply) => {
    if (api.heal === undefined) return reply.code(501).send({ error: "not-available" });
    const body = request.body ?? {};
    if (body.runId === undefined) {
      return reply.code(400).send({ error: "missing-run", message: "`runId` names the run to heal." });
    }

    const healId = api.newRunId();
    void (async () => {
      try {
        const report = await api.heal!(await load(), {
          runId: body.runId!,
          ...(body.useModel === undefined ? {} : { useModel: body.useModel }),
          ...(body.apply === undefined ? {} : { apply: body.apply }),
          ...(body.inputs === undefined ? {} : { inputs: body.inputs }),
          onProposal: (proposal) => events.emit({ kind: "heal.proposal", healId, proposal }),
        });
        events.emit({ kind: "heal.finished", healId, report });
      } catch (error) {
        events.emit({
          kind: "heal.failed",
          healId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();

    return reply.code(202).send({ healId });
  });

  /* ── T5.8: the surface explorer and the tool panel (REQ-ADE-8) ───────────── */

  /** Open surface sessions the explorer drives, keyed by the id it chose. */
  const exploring = new Map<
    string,
    Awaited<ReturnType<NonNullable<ServiceApi["openSurfaceSession"]>>>
  >();

  fastify.post<{ Params: { session: string }; Body?: { headed?: boolean } }>(
    "/surface/:session/open",
    async (request, reply) => {
      if (api.openSurfaceSession === undefined) {
        return reply.code(501).send({ error: "not-available" });
      }
      const id = request.params.session;
      const existing = exploring.get(id);
      if (existing !== undefined) return { sessionId: id, trajectory: existing.trajectoryPath };

      const session = await api.openSurfaceSession(await load(), {
        sessionId: id,
        ...(request.body?.headed === undefined ? {} : { headed: request.body.headed }),
      });
      exploring.set(id, session);
      return { sessionId: id, trajectory: session.trajectoryPath };
    },
  );

  for (const call of ["act", "read", "check"] as const) {
    fastify.post<{ Params: { session: string }; Body?: Record<string, unknown> }>(
      `/surface/:session/${call}`,
      async (request, reply) => {
        const session = exploring.get(request.params.session);
        if (session === undefined) {
          return reply.code(404).send({ error: "no-session", message: "Open the session first." });
        }
        /*
         * `intent` is required, on every call (LLD §13.4). An exploration whose
         * calls do not say what they were for is a log rather than something the
         * trajectory compiler can read, and the explorer is exactly the client
         * that would be tempted to leave it out.
         */
        const body = request.body ?? {};
        if (typeof body["intent"] !== "string" || body["intent"].trim() === "") {
          return reply.code(400).send({
            error: "missing-intent",
            message:
              "Every surface call needs an `intent`: what you are trying to do, in the words " +
              "you would use to describe the step to a person. It is the sentence this call " +
              "compiles into (LLD §13.4).",
          });
        }
        /*
         * Wrapped, always. `read` answers with a bare value — a string, a
         * number — and a bare string is not JSON, so a client that parses every
         * answer as JSON would choke on the one route that returns text.
         * `{ value }` costs a key and makes every surface route the same shape.
         */
        return { value: await session.call(call, body) };
      },
    );
  }

  fastify.post<{ Params: { session: string } }>("/surface/:session/close", async (request, reply) => {
    const session = exploring.get(request.params.session);
    if (session === undefined) return reply.code(404).send({ error: "no-session" });
    exploring.delete(request.params.session);
    await session.close();
    return reply.code(202).send({ ok: true });
  });

  fastify.post<{ Body?: { path?: string; name?: string } }>(
    "/trajectory/compile",
    async (request, reply) => {
      if (api.compileTrajectory === undefined) {
        return reply.code(501).send({ error: "not-available" });
      }
      const body = request.body ?? {};
      if (body.path === undefined) {
        return reply.code(400).send({ error: "missing-path" });
      }
      return await api.compileTrajectory(await load(), {
        path: body.path,
        ...(body.name === undefined ? {} : { name: body.name }),
      });
    },
  );

  /**
   * The tools a project would expose, and every invocation served so far.
   *
   * Read from each run's `summary.json` and `audit.jsonl` rather than from a
   * register the service keeps: "an MCP client invocation appears in the tool
   * panel with its audit record" (T5.8) is a fact about *files*, and reading
   * them means the panel shows invocations served by a `svatah tool serve`
   * running in another terminal too (REQ-ADE-2).
   */
  fastify.get<{ Querystring: { expose?: string } }>("/tools", async (request) => {
    const loaded = await load();
    const tools =
      api.toolsFor === undefined
        ? []
        : await api.toolsFor(loaded, {
            ...(request.query.expose === undefined ? {} : { expose: request.query.expose }),
          });

    const dir = join(root, loaded.config.run.outputDir);
    const invocations = !existsSync(dir)
      ? []
      : readdirSync(dir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .flatMap((entry) => {
            const summaryPath = join(dir, entry.name, "summary.json");
            if (!existsSync(summaryPath)) return [];
            const summary = JSON.parse(readFileSync(summaryPath, "utf8")) as {
              behavior?: string;
              runId?: string;
              invoker?: unknown;
              startedAt?: string;
              totals?: unknown;
              exitCode?: number;
            };
            if (summary.behavior !== "tool") return [];

            const auditPath = join(dir, entry.name, "audit.jsonl");
            const audit = existsSync(auditPath)
              ? readFileSync(auditPath, "utf8")
                  .trim()
                  .split("\n")
                  .filter((line) => line !== "")
                  .map((line) => JSON.parse(line) as unknown)
              : [];
            return [{ ...summary, audit }];
          })
          .sort((a, b) => String(b.runId).localeCompare(String(a.runId)));

    return { tools, invocations };
  });

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

/**
 * `data.yaml` as it is written, not as the project loaded it (T10.2).
 *
 * The loaded project has every `${ENV}` indirection resolved, which is the one
 * thing the Data screen must not be shown. `PUT /data` reads the raw file for
 * exactly the same reason; this is the read half of it.
 */
function rawData(loaded: ProjectHandle): Record<string, unknown> {
  const file = join(
    loaded.root,
    String((loaded.config as { data?: { file?: string } }).data?.file ?? "data.yaml"),
  );
  if (!existsSync(file)) return {};
  const parsed = (parseYaml(readFileSync(file, "utf8")) as unknown) ?? {};
  return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
}

/** `user.password` → the value at that dotted path, or `undefined`. */
function readPath(tree: Record<string, unknown>, path: string): unknown {
  let at: unknown = tree;
  for (const key of path.split(".")) {
    if (typeof at !== "object" || at === null) return undefined;
    at = (at as Record<string, unknown>)[key];
  }
  return at;
}

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
