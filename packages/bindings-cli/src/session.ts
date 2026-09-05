/**
 * Where a session opens (LLD §15, Draft 2.5; Phase 3 verification F2).
 *
 * > Base URL and storage state precedence, applied identically by every command
 * > that opens a session (`run`, `record`, `heal`, `bindings verify`,
 * > `surface conform`, `eval`, `repl`): the `--base-url` / `--storage-state`
 * > flag, then the `SVATAH_BASE_URL` / `SVATAH_STORAGE_STATE` environment
 * > variable, then `config.app`. A command that opens a session and ignores any
 * > of the three is a defect.
 *
 * Phase 3 had three different answers: `run` and `record` read the environment
 * and the config but had no flag, `heal --run` read the flag and the config but
 * not the environment, and `surface conform`, `bindings verify` and `eval` read
 * the flag and a hard-coded default and neither of the others. So a run started
 * against an ephemeral port could not be healed without repeating the flag —
 * the failure the verifier hit.
 *
 * One function, so the three sources are ordered in one place. Every command
 * calls it; a command that does not is the defect the spec names.
 */
import { stringOption, type ParsedArgs } from "./args.js";
import { appConfig } from "./config.js";

export interface SessionTarget {
  readonly baseUrl?: string;
  readonly storageState?: string;
}

export interface SessionTargetSources {
  /** Defaults to `process.env`; injected in tests. */
  readonly env?: NodeJS.ProcessEnv;
  /** `config.app`, when the caller has already loaded the config. */
  readonly config?: SessionTarget;
  /**
   * A project directory to read `config.app` from, when the caller has not.
   *
   * Ignored when `config` is given, so a command that loaded the project does
   * not read the file twice and cannot disagree with itself.
   */
  readonly root?: string;
  /**
   * Where the sample application is served, for commands that must open
   * *something* — `surface conform` has no project to fall back on (LLD §16).
   * Below `config.app`, so it is never preferred to a real answer.
   */
  readonly fallbackBaseUrl?: string;
}

/** `SVATAH_BASE_URL`, the environment half of the precedence. */
export const BASE_URL_ENV = "SVATAH_BASE_URL";
/** `SVATAH_STORAGE_STATE`, the environment half of the precedence. */
export const STORAGE_STATE_ENV = "SVATAH_STORAGE_STATE";

/** An empty environment variable is not an answer; treat it as unset. */
function fromEnv(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  return value === undefined || value.trim() === "" ? undefined : value;
}

/**
 * The base URL and storage state a session should open with.
 *
 * `explicit` is the flag layer — what the caller was told directly. Then the
 * environment, then `config.app`, then the fallback. A trailing slash is trimmed
 * from the base URL wherever it came from: `http://host:4173/` and
 * `http://host:4173` name the same deployment, and only one of them concatenates
 * with a path correctly.
 *
 * Taking the flag layer as values rather than as `ParsedArgs` is what lets the
 * service and the host reach the same precedence without inventing a command
 * line: `runProject` is called by `svatah run` and by `POST /run`, and both must
 * open in the same place (LLD §13.5).
 */
export function resolveSessionTarget(
  explicit: SessionTarget,
  sources: SessionTargetSources = {},
): SessionTarget {
  const env = sources.env ?? process.env;
  const config = sources.config ?? (sources.root === undefined ? {} : appConfig(sources.root));

  const baseUrl =
    explicit.baseUrl ?? fromEnv(env, BASE_URL_ENV) ?? config.baseUrl ?? sources.fallbackBaseUrl;

  const storageState =
    explicit.storageState ?? fromEnv(env, STORAGE_STATE_ENV) ?? config.storageState;

  return {
    ...(baseUrl === undefined ? {} : { baseUrl: baseUrl.replace(/\/+$/, "") }),
    ...(storageState === undefined ? {} : { storageState }),
  };
}

/** `resolveSessionTarget` with the flag layer read off a command line. */
export function sessionTarget(
  args: ParsedArgs,
  sources: SessionTargetSources = {},
): SessionTarget {
  const flag = stringOption(args, "base-url");
  const state = stringOption(args, "storage-state");
  return resolveSessionTarget(
    {
      ...(flag === undefined ? {} : { baseUrl: flag }),
      ...(state === undefined ? {} : { storageState: state }),
    },
    sources,
  );
}
