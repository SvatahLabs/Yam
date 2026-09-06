/**
 * The fake gateway (T3.1, T3.2's Validate, and the credential-free contract).
 *
 * Not a stub bolted on for tests. Three things need a model that answers without
 * one:
 *
 * 1. **The contract.** `pnpm install && pnpm browsers && pnpm -r build &&
 *    pnpm -r test` must be green on a clean checkout with no credential, so
 *    everything the recorder does has to be exercisable without spending money.
 * 2. **Determinism.** A test that asserts the recorder wrote a particular
 *    binding cannot depend on a model agreeing with it today.
 * 3. **Honesty in reports.** `real: false` travels with the gateway, so an eval
 *    report can state which gateway produced its numbers rather than leaving a
 *    reader to guess (REQ-PKG-4).
 *
 * The provenance it writes names itself — `fake:<label>` — so an artifact
 * recorded this way can never be mistaken for one a model produced. That is
 * REQ-AGT-3 taken literally: provenance says what made this, and "a fake did"
 * is a true and useful answer.
 */
import { provenanceSchema, type Provenance } from "@svatah/yam-schema";
import { assertNoSecret, render } from "./render.js";
import {
  emptyUsage,
  GatewayRefusal,
  GatewayShapeError,
  type Gateway,
  type GatewayAnswer,
  type GatewayRequest,
  type GatewayUsage,
} from "./types.js";

export interface FakeGatewayOptions {
  /**
   * The answer, given the question. Return `null` to refuse (which raises
   * `GatewayRefusal`, exactly as a real refusal does).
   */
  readonly answer: (request: GatewayRequest<unknown>) => unknown;
  /** Distinguishes one fake from another in provenance and in a report. */
  readonly label?: string;
  readonly secrets?: ReadonlySet<string>;
  /** Every request that was made, in order. What the redaction tests read. */
  readonly captured?: unknown[];
}

export function fakeGateway(options: FakeGatewayOptions): Gateway {
  const label = options.label ?? "fake";
  const totals: GatewayUsage = emptyUsage();

  return {
    name: `fake:${label}`,
    model: `fake:${label}`,
    real: false,
    usage: () => ({ ...totals }),

    async ask<T>(request: GatewayRequest<T>): Promise<GatewayAnswer<T>> {
      /*
       * The real request is rendered even though nothing is sent.
       *
       * Two reasons. The redaction assertion in `render()` runs, so a test with
       * the fake gateway still catches a secret reaching a prompt; and
       * `captured` holds the same bytes the Anthropic backend would have sent,
       * so a request-shape test does not need a credential.
       */
      const body = render(request, {
        model: `fake:${label}`,
        ...(options.secrets === undefined ? {} : { secrets: options.secrets }),
      });
      assertNoSecret(body, options.secrets, `prompt ${request.promptVersion}`);
      options.captured?.push(body);

      const raw = options.answer(request as GatewayRequest<unknown>);
      if (raw === null) {
        throw new GatewayRefusal(
          `The fake gateway declined prompt ${request.promptVersion}.`,
          { category: "fake" },
        );
      }

      const parsed = request.answer.safeParse(raw);
      if (!parsed.success) {
        throw new GatewayShapeError(
          `The fake gateway answered prompt ${request.promptVersion} outside its schema: ` +
            parsed.error.issues
              .map((issue) => `${issue.path.join(".") || "(root)"} ${issue.message}`)
              .join("; "),
          JSON.stringify(raw),
        );
      }

      totals.calls += 1;

      const provenance: Provenance = provenanceSchema.parse({
        model: `fake:${label}`,
        promptVersion: request.promptVersion,
        at: new Date().toISOString(),
        tokensIn: 0,
        tokensOut: 0,
        costUsd: 0,
      });

      return { value: parsed.data, provenance, cached: false };
    },
  };
}
