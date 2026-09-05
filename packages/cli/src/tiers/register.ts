/**
 * Registering the model-backed tiers (T4.3, T4.4, LLD §4.3, §10).
 *
 * The compiler declares the tier interface and defaults to nothing. This is the
 * only place that fills it in, and it does so **only when asked**: `--tier2` and
 * `--tier3` are flags, and a project with neither compiles with the grammar
 * alone and reaches no network at all (REQ-NFR-3).
 *
 * That is the whole of privacy mode's compile half (T4.7): the default is
 * offline, `--tier2` reaches a server on localhost, and only `--tier3` reaches a
 * remote one.
 */
import { registerTier, clearTiers } from "@svatah/compiler";
import { credentialInEnvironment, GatewayUnavailable, type Gateway } from "@svatah/gateway";
import type { Config } from "@svatah/schema";
import { tier2 } from "./tier2.js";
import { tier3 } from "./tier3.js";

export interface RegisterTiersOptions {
  readonly config: Config;
  /** `--tier2`: ask the local model about sentences the grammar refused. */
  readonly wantTier2: boolean;
  /** `--tier3`: ask the frontier model about what Tier 2 could not place. */
  readonly wantTier3: boolean;
  /** `--allow-model-drift`: compile against weights that are not the pinned ones. */
  readonly allowDigestDrift?: boolean;
  /** Injected by the tests and by `eval compiler --gateway fake`. */
  readonly gateways?: { tier2?: Gateway; tier3?: Gateway };
  readonly onCall?: (line: string) => void;
}

export interface RegisteredTiers {
  readonly tier2: boolean;
  readonly tier3: boolean;
  /** Why a tier the caller asked for is not there, for a message a person reads. */
  readonly refusals: readonly string[];
}

/**
 * Register what the flags ask for and the configuration allows.
 *
 * A tier that cannot be built is a *refusal with a reason*, not a silent
 * absence: "compiled with the grammar alone because `compile.tier2` names no
 * server" and "compiled with the grammar alone because that is what you asked
 * for" are different facts, and a report that could not tell them apart would
 * be a report nobody could act on.
 */
export function registerModelTiers(options: RegisterTiersOptions): RegisteredTiers {
  clearTiers();
  const refusals: string[] = [];
  let haveTier2 = false;
  let haveTier3 = false;

  if (options.wantTier2) {
    const configured = options.config.compile.tier2;
    if (options.gateways?.tier2 !== undefined) {
      registerTier(
        tier2({
          provider: configured?.provider ?? "ollama",
          endpoint: configured?.endpoint ?? "http://127.0.0.1:11434",
          model: configured?.model ?? "(injected)",
          ...(configured?.digest === undefined ? {} : { digest: configured.digest }),
          gateway: options.gateways.tier2,
          ...(options.onCall === undefined ? {} : { onCall: options.onCall }),
        }),
      );
      haveTier2 = true;
    } else if (configured === undefined) {
      refusals.push(
        "--tier2 was asked for but `compile.tier2` names no local model server. " +
          "Add `compile: { tier2: { provider: ollama, endpoint: \"http://127.0.0.1:11434\", " +
          'model: "llama3.2:3b", digest: "…" } }` — see docs/local-model.md.',
      );
    } else {
      registerTier(
        tier2({
          provider: configured.provider,
          endpoint: configured.endpoint,
          model: configured.model,
          ...(configured.digest === undefined ? {} : { digest: configured.digest }),
          ...(options.allowDigestDrift === undefined
            ? {}
            : { allowDigestDrift: options.allowDigestDrift }),
          ...(options.onCall === undefined ? {} : { onCall: options.onCall }),
        }),
      );
      haveTier2 = true;
    }
  }

  if (options.wantTier3) {
    const configured = options.config.compile.tier3;
    if (options.gateways?.tier3 !== undefined) {
      registerTier(
        tier3({
          model: configured?.model ?? "claude-opus-5",
          ...(configured?.promptVersion === undefined
            ? {}
            : { promptVersion: configured.promptVersion }),
          gateway: options.gateways.tier3,
          ...(options.onCall === undefined ? {} : { onCall: options.onCall }),
        }),
      );
      haveTier3 = true;
    } else if (configured === undefined) {
      refusals.push(
        "--tier3 was asked for but `compile.tier3` is not configured. " +
          'Add `compile: { tier3: { provider: anthropic, model: "claude-opus-5", ' +
          'promptVersion: "c3-1" } }`.',
      );
    } else if (!credentialInEnvironment()) {
      refusals.push(
        "--tier3 was asked for but there is no credential. Set ANTHROPIC_API_KEY, or run " +
          "`ant auth login`; a credential is never written to the project (REQ-REC-7).",
      );
    } else {
      registerTier(
        tier3({
          model: configured.model,
          promptVersion: configured.promptVersion,
          ...(options.onCall === undefined ? {} : { onCall: options.onCall }),
        }),
      );
      haveTier3 = true;
    }
  }

  return { tier2: haveTier2, tier3: haveTier3, refusals };
}

/**
 * Whether an error means the pinned digest moved (REQ-COMP-3).
 *
 * A digest mismatch is the one model-tier failure that must stop a compile
 * rather than fall through to the next tier: the pin is what lets provenance say
 * *which weights* produced a step, and a server that has pulled a new build of
 * the same tag is a different model wearing the same name.
 */
export function isDigestMismatch(error: unknown): boolean {
  return error instanceof GatewayUnavailable && /digest/.test(error.message);
}
