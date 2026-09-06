/**
 * Agents and tools, API, Data, Surface explorer, Import, Settings (T10.2,
 * LLD §13.7).
 *
 * The six screens the `Agents` artboard and the four full artboards added in
 * this phase (`Api`, `Data`, `Explorer`, `Import`) describe. Everything on them
 * is a service answer or a project file: `GET /tools`, `GET /api`,
 * `POST /api/request`, `GET /data`, `POST /surface/:session/*`, `POST /migrate`,
 * `GET /project`.
 *
 * Two of them are about a *session* rather than a file — the explorer and the
 * import's preview — so they load their static half and fill the rest from what
 * an action answered, through `applyExplorerEvent` and the states' own
 * `result` fields. There is no `GET /explorer`, and inventing one would put
 * state in the service the CLI cannot produce.
 */
import { Sources, dotted, plural } from "../load.js";
import { actionsForScreen } from "../registry.js";
import type { ServiceEventLike } from "../service.js";
import type { Pill, Screen, ScreenParams, ScreenStateBase } from "../types.js";
import type {
  ApiRequestResponse,
  DataResponse,
  ProjectResponse,
  ToolsResponse,
} from "../shapes.js";

const PILL: Readonly<Record<string, Pill>> = {
  passed: { tone: "pass", label: "passed" },
  failed: { tone: "fail", label: "failed" },
  aborted: { tone: "abort", label: "aborted" },
  healed: { tone: "healed", label: "healed" },
  running: { tone: "info", label: "running" },
};
const NEUTRAL: Pill = { tone: "neutral", label: "—" };

/* ────────────────────────────────────────────────────────────────────────────
 * agents — the tool server and its invocations (the `Agents` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AgentsState extends ScreenStateBase {
  readonly screen: "agents";
  readonly tools: ReadonlyArray<{
    name: string;
    story: string;
    idempotent: boolean;
    inputs: readonly string[];
    selected: boolean;
  }>;
  /**
   * Stories the tool server would **not** expose, and why (REQ-AUTO-8).
   *
   * A non-idempotent story exposed as a tool is a lint warning, and the screen
   * that lists what an agent can call has to say what it deliberately cannot.
   */
  readonly refused: ReadonlyArray<{ story: string; reason: string }>;
  readonly invocations: ReadonlyArray<{
    at: string;
    tool: string;
    invoker: string;
    runId?: string;
    status: Pill;
  }>;
  readonly selected?: string;
}

const agentsScreen: Screen<AgentsState> = {
  id: "agents",
  title: "Agents and tools",
  actions: actionsForScreen("agents"),
  keys: [{ action: "go.run", key: "↵", terminal: "\r", description: "Open the invocation's run" }],
  async load(service, params: ScreenParams = {}): Promise<AgentsState> {
    const sources = new Sources();
    const tools = await sources.optional<ToolsResponse>("GET /tools", () => service.getTools(), {});
    const exposed = tools.tools?.tools ?? [];
    const selected = params.selected ?? exposed[0]?.name;
    return {
      ...sources.base(
        "agents",
        "Agents and tools",
        dotted(
          `${exposed.length} exposed`,
          `${(tools.tools?.refused ?? []).length} refused`,
          plural((tools.invocations ?? []).length, "invocation"),
        ),
        "`svatah tool serve` exposes them over MCP",
      ),
      screen: "agents",
      tools: exposed.map((one) => ({
        name: one.name ?? "",
        story: one.story ?? one.name ?? "",
        idempotent: one.idempotent === true,
        inputs: Object.keys(one.inputs ?? {}),
        selected: one.name === selected,
      })),
      refused: (tools.tools?.refused ?? []).map((one) => ({
        story: one.story ?? "",
        reason: one.reason ?? "",
      })),
      invocations: (tools.invocations ?? []).map((one) => ({
        at: one.at ?? "",
        tool: one.tool ?? "",
        invoker: dotted(one.invoker?.kind, one.invoker?.id),
        ...(one.runId === undefined ? {} : { runId: one.runId }),
        status: PILL[one.status ?? ""] ?? NEUTRAL,
      })),
      ...(selected === undefined ? {} : { selected }),
    };
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * api — the named requests and one response (the `Api` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ApiRequestRow {
  readonly name: string;
  readonly method: string;
  readonly url: string;
  readonly selected: boolean;
}

/** What `POST /api/request` answered, when one has been sent on this screen. */
export interface ApiResponseView {
  readonly status: number;
  readonly statusPill: Pill;
  readonly durationMs?: number;
  readonly bytes?: number;
  readonly headers: ReadonlyArray<{ key: string; value: string }>;
  /** The body, pretty-printed when it is JSON and left alone when it is not. */
  readonly body: string;
  /** The JSON paths a `Remember … as name` step could capture (REQ-LANG-8). */
  readonly paths: readonly string[];
}

export interface ApiState extends ScreenStateBase {
  readonly screen: "api";
  readonly requests: readonly ApiRequestRow[];
  readonly selected?: string;
  /** The selected request in full: what the editor shows. */
  readonly request?: {
    readonly name: string;
    readonly method: string;
    readonly url: string;
    readonly headers: ReadonlyArray<{ key: string; value: string }>;
    readonly body?: string;
    readonly file?: string;
  };
  readonly response?: ApiResponseView;
}

/** A response object → what the screen shows of it. */
export function apiResponseView(value: unknown): ApiResponseView | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const one = value as Record<string, unknown>;
  const status = typeof one["status"] === "number" ? one["status"] : 0;
  if (status === 0) return undefined;
  const body = one["body"];
  const text =
    typeof body === "string"
      ? body
      : body === undefined
        ? ""
        : JSON.stringify(body, null, 2);
  const headers = one["headers"];
  return {
    status,
    statusPill:
      status < 300
        ? { tone: "pass", label: String(status) }
        : status < 400
          ? { tone: "info", label: String(status) }
          : { tone: "fail", label: String(status) },
    ...(typeof one["durationMs"] === "number" ? { durationMs: one["durationMs"] } : {}),
    bytes: text.length,
    headers:
      typeof headers === "object" && headers !== null
        ? Object.entries(headers as Record<string, unknown>).map(([key, header]) => ({
            key,
            value: String(header),
          }))
        : [],
    body: text,
    /*
     * The top-level keys only. A picker that walked the whole document would be
     * a picker with an opinion about how deep is useful; `$.active` is what the
     * artboard shows and what a `Remember the response as activeCount` step
     * captures.
     */
    paths:
      typeof body === "object" && body !== null && !Array.isArray(body)
        ? Object.keys(body as Record<string, unknown>).map((key) => `$.${key}`)
        : [],
  };
}

const apiScreen: Screen<ApiState> = {
  id: "api",
  title: "API",
  actions: actionsForScreen("api"),
  keys: [{ action: "api.send", key: "⌘↵", terminal: "\r", description: "Send the request" }],
  async load(service, params: ScreenParams = {}): Promise<ApiState> {
    const sources = new Sources();
    const requests = await sources.optional<ApiRequestResponse[]>(
      "GET /api",
      () => service.getApi(),
      [],
    );
    const selected = params.selected ?? requests[0]?.name;
    const chosen = requests.find((one) => one.name === selected);
    return {
      ...sources.base(
        "api",
        "API",
        dotted(plural(requests.length, "named request"), "api/*.yaml"),
        selected ?? "`svatah run` calls them from a flow",
      ),
      screen: "api",
      requests: requests.map((one) => ({
        name: one.name ?? "",
        method: (one.method ?? "GET").toUpperCase(),
        url: one.url ?? "",
        selected: one.name === selected,
      })),
      ...(selected === undefined ? {} : { selected }),
      ...(chosen === undefined
        ? {}
        : {
            request: {
              name: chosen.name ?? "",
              method: (chosen.method ?? "GET").toUpperCase(),
              url: chosen.url ?? "",
              headers: Object.entries(chosen.headers ?? {}).map(([key, value]) => ({
                key,
                value: String(value),
              })),
              ...(chosen.body === undefined
                ? {}
                : {
                    body:
                      typeof chosen.body === "string"
                        ? chosen.body
                        : JSON.stringify(chosen.body, null, 2),
                  }),
              file: `api/${(chosen.name ?? "").replace(/\s+/g, "-")}.yaml`,
            },
          }),
    };
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * data — data.yaml, with the secrets named and never shown (the `Data` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface DataRow {
  readonly path: string;
  /** The value, or — for a secret — the variable it is read from. */
  readonly value: string;
  readonly secret: boolean;
  /** `${SVATAH_SAMPLE_PASSWORD}` → the name, when the value is an indirection. */
  readonly reads?: string;
  readonly kind: Pill;
  readonly selected: boolean;
}

export interface DataState extends ScreenStateBase {
  readonly screen: "data";
  readonly rows: readonly DataRow[];
  readonly selected?: string;
  readonly secrets: number;
  /** How many secrets name a variable this machine does not have set. */
  readonly unset: number;
}


const dataScreen: Screen<DataState> = {
  id: "data",
  title: "Data",
  actions: actionsForScreen("data"),
  keys: [{ action: "data.save", key: "⌘S", terminal: "^s", description: "Save data.yaml" }],
  async load(service, params: ScreenParams = {}): Promise<DataState> {
    const sources = new Sources();
    const data = await sources.optional<DataResponse>("GET /data", () => service.getData(), {});
    const secrets = new Set(data.secrets ?? []);
    const rows: DataRow[] = [];
    const walk = (tree: Record<string, unknown>, prefix: string): void => {
      for (const [key, value] of Object.entries(tree)) {
        const path = prefix === "" ? key : `${prefix}.${key}`;
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          walk(value as Record<string, unknown>, path);
          continue;
        }
        const secret = secrets.has(path);
        /*
         * A secret's *value* is never shown and never stored (REQ-NFR-6): the
         * service redacts it on read, so what arrives is `«redacted»` and there
         * is nothing here to leak. What the screen shows instead is the *name*
         * of the variable it is read from and whether the service could read it
         * — both of which the service computed and sent as `secretSources`,
         * because the loaded project has every indirection already resolved and
         * a screen that inferred the name from a redacted value would be a
         * screen guessing.
         */
        const source = data.secretSources?.[path];
        rows.push({
          path,
          value: String(value),
          secret,
          ...(source?.reads === undefined ? {} : { reads: source.reads }),
          kind: secret
            ? source?.set === true
              ? { tone: "pass", label: "secret · set" }
              : { tone: "abort", label: "secret · unset" }
            : { tone: "neutral", label: "string" },
          selected: false,
        });
      }
    };
    walk(data.values ?? {}, "");

    const selected = params.selected ?? rows[0]?.path;
    const withSelection = rows.map((one) => ({ ...one, selected: one.path === selected }));
    const unset = rows.filter((one) => one.kind.label === "secret · unset").length;

    return {
      ...sources.base(
        "data",
        "Data",
        dotted(
          plural(rows.length, "value"),
          `${secrets.size} secret(s), redacted`,
          unset === 0 ? undefined : `${unset} unset`,
        ),
        "data.yaml",
      ),
      screen: "data",
      rows: withSelection,
      ...(selected === undefined ? {} : { selected }),
      secrets: secrets.size,
      unset,
    };
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * explorer — the surface, call by call (the `Explorer` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

/** One line of the snapshot tree, as the screen draws it. */
export interface SnapshotLine {
  readonly depth: number;
  readonly role: string;
  readonly name?: string;
  readonly ref?: string;
  readonly selected: boolean;
}

/** One call the explorer made, as `trajectory.jsonl` records it (REQ-BEH-4). */
export interface TrajectoryCall {
  readonly seq: number;
  readonly call: string;
  readonly intent: string;
  readonly detail: string;
  readonly ok: boolean;
  readonly durationMs?: number;
}

export interface ExplorerState extends ScreenStateBase {
  readonly screen: "explorer";
  readonly sessionId?: string;
  readonly adapter: string;
  readonly baseUrl?: string;
  /** Every adapter this build registers, for the session picker. */
  readonly adapters: readonly string[];
  /** Every call needs an intent (REQ-BEH-4); the screen carries the next one. */
  readonly intent?: string;
  readonly trajectory?: string;
  readonly snapshot: readonly SnapshotLine[];
  readonly calls: readonly TrajectoryCall[];
  /** What was written when `trajectory.compile` last ran here. */
  readonly proposal?: string;
}

/** A `Snapshot` → the lines the tree pane draws. */
export function snapshotLines(value: unknown, selectedRef?: string): SnapshotLine[] {
  const lines: SnapshotLine[] = [];
  const walk = (node: unknown, depth: number): void => {
    if (typeof node !== "object" || node === null) return;
    const one = node as Record<string, unknown>;
    const ref = typeof one["ref"] === "string" ? one["ref"] : undefined;
    lines.push({
      depth,
      role: String(one["role"] ?? "node"),
      ...(typeof one["name"] === "string" && one["name"] !== "" ? { name: one["name"] } : {}),
      ...(ref === undefined ? {} : { ref }),
      selected: ref !== undefined && ref === selectedRef,
    });
    const children = one["children"];
    if (Array.isArray(children)) for (const child of children) walk(child, depth + 1);
  };
  const root = (value as { root?: unknown; tree?: unknown } | null)?.root ?? (value as { tree?: unknown } | null)?.tree ?? value;
  walk(root, 0);
  return lines;
}

const explorerScreen: Screen<ExplorerState> = {
  id: "explorer",
  title: "Surface explorer",
  actions: actionsForScreen("explorer"),
  keys: [
    { action: "explorer.snapshot", key: "S", terminal: "s", description: "Snapshot the session" },
    { action: "explorer.open", key: "O", terminal: "o", description: "Open a session" },
    {
      action: "trajectory.compile",
      key: "C",
      terminal: "c",
      description: "Compile the trajectory to a proposal",
    },
  ],
  async load(service, params: ScreenParams = {}): Promise<ExplorerState> {
    const sources = new Sources();
    const project = await sources.get<ProjectResponse>("GET /project", () => service.getProject(), {});
    const adapter =
      typeof params.adapter === "string" ? params.adapter : (project.config?.adapter ?? "playwright");
    return {
      ...sources.base(
        "explorer",
        "Surface explorer",
        dotted(
          adapter,
          project.config?.app?.baseUrl,
          params.sessionId === undefined ? "no session" : `session ${params.sessionId}`,
        ),
        "every call records an intent",
      ),
      screen: "explorer",
      ...(params.sessionId === undefined ? {} : { sessionId: params.sessionId }),
      adapter,
      adapters: ["playwright", "bidi", "appium", "http", "ax", "uia"],
      ...(project.config?.app?.baseUrl === undefined
        ? {}
        : { baseUrl: project.config.app.baseUrl }),
      ...(typeof params.intent === "string" ? { intent: params.intent } : {}),
      snapshot: [],
      calls: [],
    };
  },
};

/** Fold one explorer answer into its state. */
export function applyExplorerEvent(state: ExplorerState, event: ServiceEventLike): ExplorerState {
  if (event.kind === "surface.snapshot") {
    return { ...state, snapshot: snapshotLines(event["snapshot"], state.snapshot.find((one) => one.selected)?.ref) };
  }
  if (event.kind === "surface.call") {
    return {
      ...state,
      calls: [
        ...state.calls,
        {
          seq: state.calls.length + 1,
          call: String(event["call"] ?? ""),
          intent: String(event["intent"] ?? ""),
          detail: String(event["detail"] ?? ""),
          ok: event["ok"] !== false,
          ...(typeof event["durationMs"] === "number"
            ? { durationMs: event["durationMs"] }
            : {}),
        },
      ],
      ...(typeof event["trajectory"] === "string" ? { trajectory: event["trajectory"] } : {}),
    };
  }
  return state;
}

/* ────────────────────────────────────────────────────────────────────────────
 * import — a prototype database, previewed then written (the `Import` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ImportState extends ScreenStateBase {
  readonly screen: "import";
  /** The project this would write into — the one the service was opened on. */
  readonly root?: string;
  /** The electron-db directory somebody chose. */
  readonly source?: string;
  /** What the last import produced, when one has run in this window. */
  readonly result?: {
    readonly rows: ReadonlyArray<{ from: string; becomes: string; count: number; state: Pill }>;
    readonly notes: ReadonlyArray<{ where: string; text: string; needsDecision: boolean }>;
    readonly review?: string;
  };
}

/** `POST /migrate`'s answer → the rows the screen shows. */
export function importResultView(value: unknown): ImportState["result"] {
  if (typeof value !== "object" || value === null) return undefined;
  const one = value as Record<string, unknown>;
  const files = one["files"];
  const review = one["review"];
  const notes = Array.isArray(review) ? review : [];
  return {
    rows: [
      {
        from: "flows",
        becomes: "flows/*.flow",
        count: Number(one["stories"] ?? (Array.isArray(files) ? files.length : 0)),
        state: { tone: "pass", label: "new" },
      },
      {
        from: "project.locatorFile",
        becomes: "bindings/**/*.yaml",
        count: Number(one["bindings"] ?? 0),
        state: { tone: "abort", label: "unverified" },
      },
      {
        from: "apirequests",
        becomes: "api/*.yaml",
        count: Number(one["apis"] ?? 0),
        state: { tone: "pass", label: "new" },
      },
      {
        from: "results, images",
        becomes: "—",
        count: 0,
        state: { tone: "skip", label: "not imported" },
      },
    ],
    notes: notes.map((note) => {
      const row = (typeof note === "object" && note !== null ? note : {}) as Record<string, unknown>;
      return {
        where: String(row["where"] ?? row["file"] ?? ""),
        text: String(row["note"] ?? row["message"] ?? String(note)),
        needsDecision: row["unmapped"] === true || row["severity"] === "warning",
      };
    }),
    ...(typeof one["reviewPath"] === "string" ? { review: one["reviewPath"] } : {}),
  };
}

const importScreen: Screen<ImportState> = {
  id: "import",
  title: "Import prototype database",
  actions: actionsForScreen("import"),
  keys: [],
  async load(service, params: ScreenParams = {}): Promise<ImportState> {
    const sources = new Sources();
    const project = await sources.get<ProjectResponse>("GET /project", () => service.getProject(), {});
    return {
      ...sources.base(
        "import",
        "Import prototype database",
        "Reads a Svatah ADE prototype's electron-db into the open project",
        project.root ?? "",
      ),
      screen: "import",
      ...(project.root === undefined ? {} : { root: project.root }),
      ...(typeof params.source === "string" ? { source: params.source } : {}),
    };
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * settings — what this project and this service are
 * ──────────────────────────────────────────────────────────────────────────── */

export interface SettingsState extends ScreenStateBase {
  readonly screen: "settings";
  readonly rows: ReadonlyArray<{ group: string; label: string; value: string }>;
  /** The project's own diagnostics, which is what a settings screen is *for*. */
  readonly diagnostics: ReadonlyArray<{ severity: Pill; code: string; message: string }>;
}

const settingsScreen: Screen<SettingsState> = {
  id: "settings",
  title: "Settings",
  actions: actionsForScreen("settings"),
  keys: [],
  async load(service): Promise<SettingsState> {
    const sources = new Sources();
    const project = await sources.get<ProjectResponse>("GET /project", () => service.getProject(), {});
    const config = project.config ?? {};
    return {
      ...sources.base(
        "settings",
        "Settings",
        dotted(config.project, config.environment, config.adapter),
        project.root ?? "",
      ),
      screen: "settings",
      rows: [
        { group: "Project", label: "Name", value: config.project ?? "" },
        { group: "Project", label: "Directory", value: project.root ?? "" },
        { group: "Project", label: "Environment", value: config.environment ?? "test" },
        { group: "Project", label: "Flows", value: config.flows?.dir ?? "flows" },
        { group: "Project", label: "Bindings", value: config.bindings?.dir ?? "bindings" },
        { group: "Run", label: "Adapter", value: config.adapter ?? "playwright" },
        { group: "Run", label: "Base URL", value: config.app?.baseUrl ?? "" },
        { group: "Run", label: "Workers", value: String(config.run?.workers ?? 1) },
        { group: "Run", label: "Headless", value: String(config.run?.headless ?? true) },
        { group: "Run", label: "Output", value: config.run?.outputDir ?? "runs" },
        {
          group: "Service",
          label: "Model credential",
          value: project.gateway?.credential === true ? "available" : "none",
        },
        {
          group: "Service",
          label: "Custom steps",
          value: plural((project.customSteps ?? []).length, "definition"),
        },
      ],
      diagnostics: (project.diagnostics ?? []).map((one) => ({
        severity:
          one.severity === "error"
            ? { tone: "fail", label: "error" }
            : { tone: "abort", label: "warning" },
        code: one.code ?? "",
        message: dotted(one.file, one.line === undefined ? undefined : `line ${one.line}`, one.message),
      })),
    };
  },
};

export const SECONDARY_SCREENS = [
  agentsScreen,
  apiScreen,
  dataScreen,
  explorerScreen,
  importScreen,
  settingsScreen,
] as const satisfies readonly Screen[];
