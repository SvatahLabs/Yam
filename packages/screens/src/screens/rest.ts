/**
 * The other ten screens (T9.1, LLD §13.7).
 *
 * Phase 9 *renders* two of the twelve — Flows and Run (T9.4) — and models all
 * twelve, because T9.1's Validate is "every screen loads against the fake
 * service in tests with the state the mockup shows for the fixtures project".
 * Phase 10 puts renderers on the rest; nothing here changes when it does, which
 * is the whole reason the model is a package and not a folder inside the ADE.
 *
 * Each of these is the same three steps as Flows and Run: ask the service for
 * what the artboard shows, turn it into rows, and say which endpoints it came
 * from. The ones whose subject is a *session* rather than a file — Record, Heal,
 * Explorer — load their static half and fill the rest from the event stream,
 * because there is no `GET /record` and inventing one would put state in the
 * service that the CLI cannot produce (§13.5's rule, read from the other side).
 */
import { Sources, dotted, plural } from "../load.js";
import { actionsForScreen } from "../registry.js";
import type { Pill, Screen, ScreenParams, ScreenStateBase } from "../types.js";
import { parseBinding } from "../bindings.js";
import type {
  ApiRequestResponse,
  BindingListRow,
  DataResponse,
  ProjectResponse,
  SummaryResponse,
  ToolsResponse,
} from "../shapes.js";

const PILL: Readonly<Record<string, Pill>> = {
  passed: { tone: "pass", label: "passed" },
  failed: { tone: "fail", label: "failed" },
  aborted: { tone: "abort", label: "aborted" },
  healed: { tone: "healed", label: "healed" },
  running: { tone: "info", label: "running" },
};
const NEUTRAL: Pill = { tone: "neutral", label: "not run" };

/* ────────────────────────────────────────────────────────────────────────────
 * runs — the list and its evidence (the `Results` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RunsRow {
  readonly runId: string;
  readonly status: Pill;
  readonly behavior: string;
  readonly invoker: string;
  readonly at: string;
  readonly passed: number;
  readonly failed: number;
  readonly durationMs?: number;
  readonly selected: boolean;
}

export interface RunsState extends ScreenStateBase {
  readonly screen: "runs";
  readonly rows: readonly RunsRow[];
  readonly runId?: string;
}

const runsScreen: Screen<RunsState> = {
  id: "runs",
  title: "Runs",
  actions: actionsForScreen("runs"),
  keys: [{ action: "go.run", key: "↵", terminal: "\r", description: "Open the selected run" }],
  async load(service, params: ScreenParams = {}): Promise<RunsState> {
    const sources = new Sources();
    const summaries = await sources.optional<SummaryResponse[]>(
      "GET /runs",
      () => service.getRuns(),
      [],
    );
    const selected = params.runId ?? summaries[0]?.runId;
    const rows: RunsRow[] = summaries.map((summary) => ({
      runId: summary.runId ?? "",
      status:
        PILL[
          Object.values(summary.flows ?? {}).some((one) => one.status === "aborted")
            ? "aborted"
            : (summary.totals?.failed ?? 0) > 0
              ? "failed"
              : "passed"
        ] ?? NEUTRAL,
      behavior: summary.behavior ?? "test",
      invoker: dotted(summary.invoker?.kind, summary.invoker?.id, summary.invoker?.via),
      at: summary.endedAt ?? summary.startedAt ?? "",
      passed: summary.totals?.passed ?? 0,
      failed: summary.totals?.failed ?? 0,
      ...(summary.startedAt === undefined || summary.endedAt === undefined
        ? {}
        : { durationMs: Date.parse(summary.endedAt) - Date.parse(summary.startedAt) }),
      selected: summary.runId === selected,
    }));
    return {
      ...sources.base(
        "runs",
        "Runs",
        rows.length === 0 ? "No runs yet" : plural(rows.length, "run"),
        rows.length === 0 ? "`svatah run` writes one" : plural(rows.length, "run"),
      ),
      screen: "runs",
      rows,
      ...(selected === undefined ? {} : { runId: selected }),
    };
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * bindings — the store, its resolver order and its verification
 * ──────────────────────────────────────────────────────────────────────────── */

export interface BindingRow {
  readonly elementId: string;
  readonly phrase?: string;
  readonly contexts: number;
  readonly verified: Pill;
  readonly candidates: number;
  readonly topCandidate?: string;
  readonly selected: boolean;
}

export interface BindingsState extends ScreenStateBase {
  readonly screen: "bindings";
  readonly rows: readonly BindingRow[];
  readonly bindingId?: string;
  readonly unverified: number;
}

const bindingsScreen: Screen<BindingsState> = {
  id: "bindings",
  title: "Bindings",
  actions: actionsForScreen("bindings"),
  keys: [
    { action: "bindings.verify", key: "V", terminal: "v", description: "Dry-resolve every binding" },
  ],
  async load(service, params: ScreenParams = {}): Promise<BindingsState> {
    const sources = new Sources();
    const list = await sources.optional<BindingListRow[]>(
      "GET /bindings",
      () => service.getBindings(),
      [],
    );

    /*
     * Every file, because this screen *is* the store.
     *
     * `GET /bindings` answers ids and paths; the candidates, the contexts and
     * the verification are in each file's YAML. The Bindings artboard shows a
     * table of all of them, so all of them are read — which is thirty small
     * requests against a loopback service for the fixtures project, and the
     * honest cost of a screen that shows the store rather than a summary of it.
     */
    const rows: BindingRow[] = [];
    for (const row of list) {
      if (row.id === undefined) continue;
      const file = parseBinding(
        await sources.optional<string>(
          `GET /bindings/${row.id}`,
          () => service.getBindingsById(row.id!),
          "",
        ),
      );
      const entries = file?.entries ?? [];
      const verified = entries.length > 0 && entries.every((one) => one.verified === true);
      const top = entries[0]?.candidates?.[0];
      rows.push({
        elementId: row.id,
        ...(file?.phrases?.[0] === undefined ? {} : { phrase: file.phrases[0] }),
        contexts: entries.length,
        verified: verified
          ? { tone: "pass", label: "verified" }
          : { tone: "abort", label: "unverified" },
        candidates: entries[0]?.candidates?.length ?? 0,
        ...(top === undefined
          ? {}
          : {
              topCandidate: dotted(
                top.by,
                top.value ?? dotted(top.role, top.name === undefined ? undefined : `"${top.name}"`),
              ),
            }),
        selected: false,
      });
    }

    const selected = params.bindingId ?? rows[0]?.elementId;
    const withSelection = rows.map((row) => ({ ...row, selected: row.elementId === selected }));
    const unverified = rows.filter((one) => one.verified.label === "unverified").length;

    return {
      ...sources.base(
        "bindings",
        "Bindings",
        `${plural(rows.length, "binding")}, ${unverified} unverified`,
        selected ?? "",
      ),
      screen: "bindings",
      rows: withSelection,
      ...(selected === undefined ? {} : { bindingId: selected }),
      unverified,
    };
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * record — the session, its decisions (the `RecordReview` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RecordState extends ScreenStateBase {
  readonly screen: "record";
  readonly sessionId?: string;
  /**
   * The gateways this service can actually reach (REQ-ADE-4, Draft 2.7).
   *
   * `anthropic` only when `GET /project` reports a credential — the screen
   * offers what it can do rather than an option that fails on submit — and
   * `fake` always, labelled as the committed answers it is.
   */
  readonly gateways: ReadonlyArray<{ id: string; label: string; available: boolean }>;
  readonly gateway: string;
  readonly flows: readonly string[];
  /** The grounding waiting on a reviewer, when one is. Filled by `record.decision`. */
  readonly decision?: unknown;
  readonly decisions: readonly unknown[];
}

const recordScreen: Screen<RecordState> = {
  id: "record",
  title: "Record review",
  actions: actionsForScreen("record"),
  keys: [
    { action: "record.accept", key: "A", terminal: "a", description: "Accept the grounding" },
    { action: "record.repick", key: "P", terminal: "p", description: "Re-pick in the session" },
    { action: "record.reject", key: "X", terminal: "x", description: "Reject the grounding" },
  ],
  async load(service, params: ScreenParams = {}): Promise<RecordState> {
    const sources = new Sources();
    const project = await sources.get<ProjectResponse>("GET /project", () => service.getProject(), {});
    const credential = project.gateway?.credential === true;
    return {
      ...sources.base(
        "record",
        "Record review",
        params.sessionId === undefined ? "No session" : `session ${params.sessionId}`,
        credential ? "a model credential is available" : "no model credential on this service",
      ),
      screen: "record",
      ...(params.sessionId === undefined ? {} : { sessionId: params.sessionId }),
      gateways: [
        {
          id: "anthropic",
          label: credential
            ? "anthropic — the service's credential"
            : "anthropic — no credential on this service",
          available: credential,
        },
        {
          id: "fake",
          label: "fake — committed answers from evals/grounding/cases",
          available: true,
        },
      ],
      gateway: credential ? "anthropic" : "fake",
      flows: project.flows ?? [],
      decisions: [],
    };
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * heal — proposals (the `HealReview` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface HealState extends ScreenStateBase {
  readonly screen: "heal";
  readonly runId?: string;
  /** Runs with a failure worth healing: what the screen offers to heal. */
  readonly candidates: ReadonlyArray<{ runId: string; failed: number; at: string }>;
  /** Proposals arrive on `heal.proposal`; there is no route that lists them. */
  readonly proposal?: unknown;
  readonly proposals: readonly unknown[];
}

const healScreen: Screen<HealState> = {
  id: "heal",
  title: "Heal review",
  actions: actionsForScreen("heal"),
  keys: [
    { action: "heal.apply", key: "A", terminal: "a", description: "Apply the proposal" },
    { action: "heal.run", key: "H", terminal: "h", description: "Heal the selected run" },
  ],
  async load(service, params: ScreenParams = {}): Promise<HealState> {
    const sources = new Sources();
    const summaries = await sources.optional<SummaryResponse[]>(
      "GET /runs",
      () => service.getRuns(),
      [],
    );
    const candidates = summaries
      .filter((one) => (one.totals?.failed ?? 0) > 0)
      .map((one) => ({
        runId: one.runId ?? "",
        failed: one.totals?.failed ?? 0,
        at: one.endedAt ?? "",
      }));
    const runId = params.runId ?? candidates[0]?.runId;
    return {
      ...sources.base(
        "heal",
        "Heal review",
        candidates.length === 0
          ? "No run has a locator failure to heal"
          : `${plural(candidates.length, "run")} with a failure`,
        runId ?? "",
      ),
      screen: "heal",
      ...(runId === undefined ? {} : { runId }),
      candidates,
      proposals: [],
    };
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * agents — the tool server and its invocations (the `Agents` artboard)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface AgentsState extends ScreenStateBase {
  readonly screen: "agents";
  readonly tools: ReadonlyArray<{ name: string; story: string; idempotent: boolean }>;
  readonly invocations: ReadonlyArray<{
    at: string;
    tool: string;
    invoker: string;
    runId?: string;
    status: Pill;
  }>;
}

const agentsScreen: Screen<AgentsState> = {
  id: "agents",
  title: "Agents and tools",
  actions: actionsForScreen("agents"),
  keys: [],
  async load(service): Promise<AgentsState> {
    const sources = new Sources();
    const tools = await sources.optional<ToolsResponse>("GET /tools", () => service.getTools(), {});
    return {
      ...sources.base(
        "agents",
        "Agents and tools",
        dotted(
          `${(tools.tools?.tools ?? []).length} exposed`,
          `${(tools.invocations ?? []).length} invocation(s)`,
        ),
        "`svatah tool serve` exposes them over MCP",
      ),
      screen: "agents",
      tools: (tools.tools?.tools ?? []).map((one) => ({
        name: one.name ?? "",
        story: one.story ?? one.name ?? "",
        idempotent: one.idempotent === true,
      })),
      invocations: (tools.invocations ?? []).map((one) => ({
        at: one.at ?? "",
        tool: one.tool ?? "",
        invoker: dotted(one.invoker?.kind, one.invoker?.id),
        ...(one.runId === undefined ? {} : { runId: one.runId }),
        status: PILL[one.status ?? ""] ?? NEUTRAL,
      })),
    };
  },
};

/* ────────────────────────────────────────────────────────────────────────────
 * api, data, explorer, import, settings (the `Secondary` wireframes)
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ApiState extends ScreenStateBase {
  readonly screen: "api";
  readonly requests: ReadonlyArray<{ name: string; method: string; url: string }>;
  readonly selected?: string;
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
    const rows = requests.map((one) => ({
      name: one.name ?? "",
      method: (one.method ?? "GET").toUpperCase(),
      url: one.url ?? "",
    }));
    return {
      ...sources.base("api", "API", plural(rows.length, "named request"), params.selected ?? ""),
      screen: "api",
      requests: rows,
      ...(params.selected === undefined ? {} : { selected: params.selected }),
    };
  },
};

export interface DataState extends ScreenStateBase {
  readonly screen: "data";
  /** Dotted paths and their values, secrets already redacted by the service. */
  readonly rows: ReadonlyArray<{ path: string; value: string; secret: boolean }>;
}

const dataScreen: Screen<DataState> = {
  id: "data",
  title: "Data",
  actions: actionsForScreen("data"),
  keys: [{ action: "data.save", key: "⌘S", terminal: "^s", description: "Save data.yaml" }],
  async load(service): Promise<DataState> {
    const sources = new Sources();
    const data = await sources.optional<DataResponse>("GET /data", () => service.getData(), {});
    const secrets = new Set(data.secrets ?? []);
    const rows: Array<{ path: string; value: string; secret: boolean }> = [];
    const walk = (tree: Record<string, unknown>, prefix: string): void => {
      for (const [key, value] of Object.entries(tree)) {
        const path = prefix === "" ? key : `${prefix}.${key}`;
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          walk(value as Record<string, unknown>, path);
          continue;
        }
        rows.push({ path, value: String(value), secret: secrets.has(path) });
      }
    };
    walk(data.values ?? {}, "");
    return {
      ...sources.base(
        "data",
        "Data",
        dotted(plural(rows.length, "value"), `${secrets.size} secret(s), redacted`),
        "data.yaml",
      ),
      screen: "data",
      rows,
    };
  },
};

export interface ExplorerState extends ScreenStateBase {
  readonly screen: "explorer";
  readonly sessionId?: string;
  readonly adapter: string;
  readonly baseUrl?: string;
  /** Every call needs an intent (REQ-BEH-4); the screen carries the last one. */
  readonly intent?: string;
  readonly trajectory?: string;
  readonly calls: readonly unknown[];
}

const explorerScreen: Screen<ExplorerState> = {
  id: "explorer",
  title: "Surface explorer",
  actions: actionsForScreen("explorer"),
  keys: [
    { action: "explorer.snapshot", key: "S", terminal: "s", description: "Snapshot the session" },
  ],
  async load(service, params: ScreenParams = {}): Promise<ExplorerState> {
    const sources = new Sources();
    const project = await sources.get<ProjectResponse>("GET /project", () => service.getProject(), {});
    return {
      ...sources.base(
        "explorer",
        "Surface explorer",
        dotted(project.config?.adapter ?? "playwright", project.config?.app?.baseUrl),
        "every call records an intent",
      ),
      screen: "explorer",
      ...(params.sessionId === undefined ? {} : { sessionId: params.sessionId }),
      adapter: project.config?.adapter ?? "playwright",
      ...(project.config?.app?.baseUrl === undefined
        ? {}
        : { baseUrl: project.config.app.baseUrl }),
      calls: [],
    };
  },
};

export interface ImportState extends ScreenStateBase {
  readonly screen: "import";
  readonly root?: string;
  /** What the last import produced, when one has run in this session. */
  readonly result?: unknown;
}

const importScreen: Screen<ImportState> = {
  id: "import",
  title: "Import prototype database",
  actions: actionsForScreen("import"),
  keys: [],
  async load(service): Promise<ImportState> {
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
    };
  },
};

export interface SettingsState extends ScreenStateBase {
  readonly screen: "settings";
  readonly rows: ReadonlyArray<{ label: string; value: string }>;
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
        { label: "Project", value: config.project ?? "" },
        { label: "Directory", value: project.root ?? "" },
        { label: "Environment", value: config.environment ?? "test" },
        { label: "Adapter", value: config.adapter ?? "playwright" },
        { label: "Base URL", value: config.app?.baseUrl ?? "" },
        { label: "Workers", value: String(config.run?.workers ?? 1) },
        { label: "Headless", value: String(config.run?.headless ?? true) },
        {
          label: "Model credential",
          value: project.gateway?.credential === true ? "available" : "none",
        },
      ],
    };
  },
};

export const OTHER_SCREENS = [
  runsScreen,
  bindingsScreen,
  recordScreen,
  healScreen,
  agentsScreen,
  apiScreen,
  dataScreen,
  explorerScreen,
  importScreen,
  settingsScreen,
] as const satisfies readonly Screen[];

