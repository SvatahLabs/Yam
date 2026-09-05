/**
 * Filling module (a)'s grounding hole, because module (b) is installed
 * (T3.3, LLD §6.5, §10, §11).
 *
 * `bind()` in record mode asks a registered `BindGrounder` first and falls back
 * to a person clicking. Module (a) registers nothing, which is the whole of
 * "module (a) has no dependency on (b)".
 *
 * ## Why it lives in the CLI
 *
 * The obvious home is `@svatah/host-playwright`, since importing that package is
 * the moment a project has both modules. It is the wrong home: LLD §1 keeps the
 * host model-free, because the host is what *replays* a plan and REQ-RUN-1 says
 * replay makes no model calls. LLD §10 already names the right one — "module (b)
 * registers the recorder's implementation at CLI start" — and `@svatah/cli` is
 * the package allowed to import everything precisely so that wiring lives in one
 * place.
 *
 * A plain Playwright test in a flow project reaches it the same way:
 *
 * ```ts
 * // playwright.config.ts, or a global setup
 * import { installModelGrounding } from "@svatah/cli";
 * installModelGrounding({ cacheDir: ".svatah/model-cache" });
 * ```
 *
 * ## Why it is not an import side effect
 *
 * Importing a package should not start spending money. `installModelGrounding()`
 * is called explicitly, and it declines rather than throws when there is no
 * credential, so a project with no `ANTHROPIC_API_KEY` records the way module (a)
 * does instead of failing at the first `bind()`.
 */
import { registerBindGrounder, clearBindGrounder, hasBindGrounder } from "@svatah/playwright-test";
import {
  anthropicGateway,
  credentialInEnvironment,
  DiskCache,
  type Gateway,
} from "@svatah/gateway";
import { recorderBindGrounder } from "@svatah/recorder";

export interface ModelGroundingOptions {
  /** A gateway to use. Built from the environment when absent. */
  readonly gateway?: Gateway;
  /** `config.record.model`. */
  readonly model?: string;
  /** Where answers are cached, so a re-record pays for nothing it already asked. */
  readonly cacheDir?: string;
  readonly maxSnapshotTokens?: number;
  readonly testIdAttributes?: readonly string[];
  readonly ignoreAttributes?: readonly string[];
  readonly matchHost?: boolean;
  readonly environment?: "test" | "staging" | "production";
  readonly forceProduction?: boolean;
  /** Values that must never reach the model (REQ-NFR-6). */
  readonly secrets?: ReadonlySet<string>;
}

/**
 * Register the recorder's grounder for `bind()`'s record mode.
 *
 * Returns whether it was registered. `false` means there is no credential, and
 * the picker stays the answer — which is a working configuration, not a failure.
 */
export function installModelGrounding(options: ModelGroundingOptions = {}): boolean {
  const gateway =
    options.gateway ??
    (credentialInEnvironment()
      ? anthropicGateway({
          ...(options.model === undefined ? {} : { model: options.model }),
          ...(options.cacheDir === undefined ? {} : { cache: new DiskCache(options.cacheDir) }),
          ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
        })
      : undefined);

  if (gateway === undefined) return false;

  registerBindGrounder(
    recorderBindGrounder({
      gateway,
      ...(options.maxSnapshotTokens === undefined
        ? {}
        : { maxSnapshotTokens: options.maxSnapshotTokens }),
      ...(options.testIdAttributes === undefined
        ? {}
        : { testIdAttributes: options.testIdAttributes }),
      ...(options.ignoreAttributes === undefined
        ? {}
        : { ignoreAttributes: options.ignoreAttributes }),
      ...(options.matchHost === undefined ? {} : { matchHost: options.matchHost }),
      ...(options.environment === undefined ? {} : { environment: options.environment }),
      ...(options.forceProduction === undefined
        ? {}
        : { forceProduction: options.forceProduction }),
    }),
  );
  return true;
}

/** Put module (a)'s picker-only default back. */
export function uninstallModelGrounding(): void {
  clearBindGrounder();
}

/** Whether anything but the picker is registered. */
export { hasBindGrounder as hasModelGrounding };
