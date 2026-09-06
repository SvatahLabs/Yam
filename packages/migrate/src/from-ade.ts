/**
 * `yam migrate --from-ade <path>` (T6.6, REQ-ADE-9, LLD §13.5).
 *
 * > Prototype database import (`yam migrate --from-ade <path>`, P2) maps the
 * > prototype's electron-db records: `project` → `yam.config.yaml` (name,
 * > browser, threadCount → workers, url → baseUrl, takeStepScreenshot →
 * > screenshots), `flows` → `flows/<filename>` then v2→v3 migration,
 * > `project.locatorFile` JSON → `.locator` → seed bindings, `config.dataFile`
 * > JSON → `data.yaml`, `apirequests` → `api/<name>.yaml`. Results and images
 * > are not imported.
 *
 * ## The shape this reads
 *
 * electron-db is a directory of `<table>.json` files, each
 * `{ "<table>": [ …rows ] }`. The tables and their columns are the prototype's
 * own (`src/js/dbclient.js` in `github.com/a-t-u-l/svatahADE`):
 *
 * | table | columns this reads |
 * |---|---|
 * | `project` | `name`, `locatorFile`, `configName` |
 * | `config` | `name`, `browser`, `threadCount`, `url`, `projectName`, `takeStepScreenshot`, `dataFile` |
 * | `flows` | `flowFile`, `flowFileName`, `projectName` |
 * | `api` | `name`, `projectName`, `httpMethod`, `uri`, `requestBody`, `headers`, `contentType`, `followRedirect` |
 *
 * `locatorFile` and `dataFile` are **JSON strings inside a column**, each an
 * array of one-key-per-field objects — `[{"locator identifier": …, "locator
 * details": …}]` and `[{"variable name": …, "variable value": …}]`. The
 * prototype's own reader is where those key names come from; nothing else in
 * this repository would tell you they have spaces in them.
 *
 * LLD §13.5 names the table `apirequests`; the prototype calls it `api`. Both
 * are read, because the spec's name is what a reader will look for and the
 * prototype's is what is on disk.
 *
 * ## What is not imported, and why it is not a gap
 *
 * `results`, `images`, `executionHistory`, `apihistory` and `settings`.
 * REQ-ADE-9 says so: "Results and screenshots from the prototype are not
 * imported." A run is a record of one execution against one build of an
 * application, and a `runs/` directory reconstructed from a different tool's
 * database would look like something a person could re-run and diff, and would
 * be neither.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { canonicalYaml, SCHEMA_VERSION } from "@svatah/yam-schema";
import type { ReviewNote } from "./report.js";

/** One electron-db table, as rows. */
export type Table = ReadonlyArray<Record<string, unknown>>;

export interface AdeDatabase {
  readonly project: Table;
  readonly config: Table;
  readonly flows: Table;
  readonly api: Table;
  /** Tables that were on disk and are deliberately not imported. */
  readonly ignored: readonly string[];
}

/** Tables REQ-ADE-9 excludes. Listed, not silently skipped. */
export const NOT_IMPORTED = ["results", "images", "executionHistory", "apihistory", "settings"];

/**
 * Read an electron-db directory.
 *
 * A missing table is an empty one rather than an error: the prototype creates
 * every table on first run, but a database copied out of an application may
 * carry only what was used.
 */
export function readAdeDatabase(path: string): AdeDatabase {
  const table = (...names: string[]): Table => {
    for (const name of names) {
      const file = join(path, `${name}.json`);
      if (!existsSync(file)) continue;
      const parsed = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
      const rows = parsed[name];
      if (Array.isArray(rows)) return rows as Table;
    }
    return [];
  };

  const present = existsSync(path)
    ? readdirSync(path)
        .filter((name) => name.endsWith(".json"))
        .map((name) => name.replace(/\.json$/, ""))
    : [];

  return {
    project: table("project"),
    config: table("config"),
    flows: table("flows"),
    // The spec's name and the prototype's, in that order.
    api: table("apirequests", "api"),
    ignored: present.filter((name) => NOT_IMPORTED.includes(name)),
  };
}

export interface FromAdeOptions {
  /** The electron-db directory. */
  readonly source: string;
  /** Where the project directory is written. */
  readonly destination: string;
  /** Which project in the database, when it holds more than one. */
  readonly project?: string;
}

export interface FromAdeResult {
  /** Files written, relative to the destination, sorted. */
  readonly files: readonly string[];
  readonly notes: readonly ReviewNote[];
  /** The project that was imported. */
  readonly project: string;
  /** `flows/<name>` for each flow written, so the caller can migrate them. */
  readonly flowFiles: readonly string[];
  /** The `.locator` text, also written to `.imported.locator`. */
  readonly locatorFile?: string;
  /** The intermediates the caller should remove once `migrate` has read them. */
  readonly intermediates: readonly string[];
}

const text = (row: Record<string, unknown>, key: string): string =>
  typeof row[key] === "string" ? (row[key] as string) : "";

/**
 * Extract the prototype's database into the *inputs* a v2 migration takes.
 *
 * Two steps, deliberately, and this is the first: a `.flow` file, a `.locator`
 * file and a `data.yaml` are what `migrate` already converts, and the prototype
 * is not a second dialect — it is the same v2 files kept in a database instead
 * of on disk. Doing the conversion here as well would be a second implementation
 * of the flow rewriter, which would drift.
 */
export function extractAdeProject(options: FromAdeOptions): FromAdeResult {
  const db = readAdeDatabase(options.source);
  const notes: ReviewNote[] = [];
  const files: string[] = [];

  if (db.project.length === 0) {
    throw new Error(
      `No \`project\` table in ${options.source}. An electron-db directory holds one ` +
        "`<table>.json` per table; this one has none, so there is nothing to import.",
    );
  }

  const chosen =
    options.project === undefined
      ? db.project[0]!
      : db.project.find((row) => text(row, "name") === options.project);
  if (chosen === undefined) {
    throw new Error(
      `No project named "${options.project}" in ${options.source}. It holds: ` +
        db.project.map((row) => `"${text(row, "name")}"`).join(", "),
    );
  }
  const projectName = text(chosen, "name");

  if (db.project.length > 1 && options.project === undefined) {
    notes.push({
      file: "project",
      line: 0,
      kind: "ade-multiple-projects",
      message:
        `The database holds ${db.project.length} projects and none was named, so "${projectName}" ` +
        `was imported. Use --project to choose another: ` +
        db.project.map((row) => `"${text(row, "name")}"`).join(", "),
    });
  }

  const configName = text(chosen, "configName");
  const config =
    db.config.find((row) => text(row, "name") === configName && text(row, "projectName") === projectName) ??
    db.config.find((row) => text(row, "projectName") === projectName) ??
    db.config[0];

  mkdirSync(join(options.destination, "flows"), { recursive: true });

  /* ── the config (LLD §13.5's mapping) ───────────────────────────────────── */

  const workers = Number(config === undefined ? NaN : config["threadCount"]);
  const screenshots = String(config?.["takeStepScreenshot"] ?? "").toLowerCase();
  const browser = String(config?.["browser"] ?? "").toLowerCase();

  const yamConfig: Record<string, unknown> = {
    schemaVersion: SCHEMA_VERSION,
    project: projectName,
    environment: "test",
    adapter: "playwright",
    app: { baseUrl: text(config ?? {}, "url") },
    flows: { dir: "flows" },
    steps: { dir: "steps" },
    bindings: { dir: "bindings", testIdAttributes: ["data-testid", "data-test", "data-qa"] },
    data: { file: "data.yaml" },
    api: { dir: "api" },
    run: {
      workers: Number.isFinite(workers) && workers > 0 ? Math.trunc(workers) : 4,
      /*
       * The prototype's browser names are Selenium's. `chrome` is `chromium`
       * to Playwright and `edge` is a channel of it; neither is a lie, and a
       * browser this cannot map is dropped with a note rather than passed
       * through to fail at run time.
       */
      ...(browser === "chrome" || browser === "chromium"
        ? { browser: "chromium" }
        : browser === "firefox"
          ? { browser: "firefox" }
          : browser === "safari" || browser === "webkit"
            ? { browser: "webkit" }
            : {}),
      headless: true,
      stepTimeoutMs: 10_000,
      candidateTimeoutMs: 2_000,
      // `takeStepScreenshot` is a boolean; `screenshots` is a policy. `true`
      // means every step, which is `always`.
      screenshots: screenshots === "true" || screenshots === "yes" ? "always" : "onFailure",
      trace: false,
      outputDir: "runs",
      checkpoints: true,
      audit: true,
    },
    compile: { confidenceThreshold: 0.8 },
    record: {
      model: "claude-opus-5",
      maxSnapshotTokens: 8_000,
      visionFallback: false,
      decisionDeadlineMs: 600_000,
    },
    heal: { onFail: false, relocalizeThreshold: 0.72, margin: 0.1, useModel: false },
  };

  if (browser !== "" && !["chrome", "chromium", "firefox", "safari", "webkit"].includes(browser)) {
    notes.push({
      file: "config",
      line: 0,
      kind: "ade-unknown-browser",
      message:
        `The prototype's browser "${config?.["browser"]}" has no Playwright equivalent, so ` +
        "`run.browser` was left unset and the default (chromium) applies.",
    });
  }

  writeFileSync(
    join(options.destination, "yam.config.yaml"),
    `# Imported from a Yam ADE prototype database (REQ-ADE-9, LLD §13.5).\n` +
      `# Source: ${options.source}\n` +
      `# Results and screenshots are deliberately not imported.\n` +
      canonicalYaml(yamConfig),
    "utf8",
  );
  files.push("yam.config.yaml");

  /* ── the flows ──────────────────────────────────────────────────────────── */

  const flowFiles: string[] = [];
  const mine = db.flows.filter((row) => text(row, "projectName") === projectName);
  if (mine.length === 0) {
    notes.push({
      file: "flows",
      line: 0,
      kind: "ade-no-flows",
      message: `The database has no flow for "${projectName}", so nothing was written to flows/.`,
    });
  }
  for (const row of mine) {
    const name = text(row, "flowFileName") || "imported";
    const file = name.endsWith(".flow") ? name : `${name}.flow`;
    /*
     * The prototype stored the flow as the *innerHTML* of a contenteditable and
     * stripped the tags on the way in, which leaves HTML entities behind. A
     * `&gt;` in a step is a `>` the author typed, and leaving it would put a
     * literal `&gt;` into a v3 sentence.
     */
    writeFileSync(join(options.destination, "flows", file), unescapeHtml(text(row, "flowFile")), "utf8");
    files.push(`flows/${file}`);
    flowFiles.push(`flows/${file}`);
  }

  /* ── the locators, as the `.locator` text the v2 migration reads ────────── */

  let locatorFile: string | undefined;
  const locatorJson = text(chosen, "locatorFile");
  if (locatorJson.trim() !== "") {
    const lines = rowsOf(locatorJson, "locator identifier", "locator details", notes, "locatorFile");
    if (lines.length > 0) {
      locatorFile = `${lines.map(([k, v]) => `${k} = ${v}`).join("\n")}\n`;
      /*
       * Written to disk, not just returned, because the second half of the
       * import is `migrate` reading this directory — and `.locator` is what it
       * reads. The dot-prefix says it is an intermediate: the caller deletes it
       * once the seed bindings exist, and a project directory that kept it
       * would have the old tool's file sitting beside the new store, which is
       * exactly the second source of truth ADR-17 rejected.
       */
      writeFileSync(join(options.destination, ".imported.locator"), locatorFile, "utf8");
      files.push(".imported.locator");
    }
  }

  /* ── the data ───────────────────────────────────────────────────────────── */

  const dataJson = text(config ?? {}, "dataFile");
  if (dataJson.trim() !== "") {
    const rows = rowsOf(dataJson, "variable name", "variable value", notes, "dataFile");
    if (rows.length > 0) {
      writeFileSync(
        join(options.destination, ".imported.data"),
        `${rows.map(([k, v]) => `${k} = ${v}`).join("\n")}\n`,
        "utf8",
      );
      files.push(".imported.data");
    }
  }

  /* ── the API requests (REQ-ADP-2) ───────────────────────────────────────── */

  const requests = db.api.filter(
    (row) => text(row, "projectName") === "" || text(row, "projectName") === projectName,
  );
  if (requests.length > 0) mkdirSync(join(options.destination, "api"), { recursive: true });
  for (const row of requests) {
    const name = text(row, "name") || "request";
    const request: Record<string, unknown> = {
      name,
      method: (text(row, "httpMethod") || "GET").toUpperCase(),
      url: text(row, "uri"),
    };
    const headers = parseHeaders(text(row, "headers"), text(row, "contentType"), notes, name);
    if (Object.keys(headers).length > 0) request["headers"] = headers;
    const body = text(row, "requestBody");
    if (body.trim() !== "") {
      try {
        request["json"] = JSON.parse(body);
      } catch {
        request["body"] = body;
      }
    }
    const follow = String(row["followRedirect"] ?? "").toLowerCase();
    if (follow !== "") request["followRedirects"] = follow === "true" || follow === "yes";
    if (String(row["acceptAllSslCert"] ?? "").toLowerCase() === "true") {
      /*
       * The one field with no equivalent. `ApiRequest` has TLS options in the
       * spec but the adapter does not implement "accept any certificate", and
       * writing it into the file would produce a request that fails to validate.
       */
      notes.push({
        file: `api/${name}`,
        line: 0,
        kind: "ade-unmapped-field",
        message:
          `"${name}" set acceptAllSslCert; v3 has no such option and it was dropped. A request ` +
          "against a self-signed certificate will fail until the certificate is trusted.",
      });
    }
    writeFileSync(
      join(options.destination, "api", `${slug(name)}.yaml`),
      `# Imported from a Yam ADE prototype database (REQ-ADE-9).\n${canonicalYaml(request)}`,
      "utf8",
    );
    files.push(`api/${slug(name)}.yaml`);
  }

  for (const table of db.ignored) {
    notes.push({
      file: table,
      line: 0,
      kind: "ade-not-imported",
      message:
        `\`${table}\` was not imported. REQ-ADE-9: results and screenshots stay in the ` +
        "prototype, because a run reconstructed from another tool's database would look like " +
        "something you could re-run and diff, and would be neither.",
    });
  }

  return {
    files: [...files].sort(),
    notes,
    project: projectName,
    flowFiles,
    ...(locatorFile === undefined ? {} : { locatorFile }),
    intermediates: files.filter((one) => one.startsWith(".imported.")),
  };
}

/** `[{"<key>": …, "<value>": …}]` → pairs, with a note for anything malformed. */
function rowsOf(
  json: string,
  keyField: string,
  valueField: string,
  notes: ReviewNote[],
  where: string,
): Array<[string, string]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    notes.push({
      file: where,
      line: 0,
      kind: "ade-unparseable",
      message:
        `${where} is not JSON (${cause instanceof Error ? cause.message : String(cause)}), so it ` +
        "was skipped. The prototype stored it as whatever was typed into the editor.",
    });
    return [];
  }
  if (!Array.isArray(parsed)) {
    notes.push({
      file: where,
      line: 0,
      kind: "ade-unparseable",
      message: `${where} is JSON but not an array of rows, so it was skipped.`,
    });
    return [];
  }
  const out: Array<[string, string]> = [];
  for (const row of parsed) {
    const one = row as Record<string, unknown>;
    const key = one[keyField];
    const value = one[valueField];
    if (typeof key !== "string" || key.trim() === "") continue;
    out.push([key.trim(), String(value ?? "")]);
  }
  return out;
}

/** The prototype stored headers as `k: v` lines, or as nothing. */
function parseHeaders(
  raw: string,
  contentType: string,
  notes: ReviewNote[],
  name: string,
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (contentType.trim() !== "") headers["content-type"] = contentType.trim();
  if (raw.trim() === "") return headers;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
      for (const [key, value] of Object.entries(parsed)) headers[key] = String(value);
      return headers;
    }
  } catch {
    // Not JSON; fall through to the line form below.
  }
  for (const line of raw.split(/\r?\n/)) {
    const at = line.indexOf(":");
    if (at <= 0) {
      if (line.trim() !== "") {
        notes.push({
          file: `api/${name}`,
          line: 0,
          kind: "ade-unparseable",
          message: `"${line.trim()}" is not a \`name: value\` header and was dropped.`,
        });
      }
      continue;
    }
    headers[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return headers;
}

function unescapeHtml(text_: string): string {
  return text_
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    // `&amp;` last, or `&amp;lt;` would become `<`.
    .replace(/&amp;/g, "&");
}

function slug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "request";
}
