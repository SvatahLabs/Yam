/**
 * Choosing the gateway a grounding command runs against (T3.3, T4.5, LLD §10).
 *
 * `svatah record` and `svatah repl` both ground unbound targets, and both have
 * to answer the same question first: which model, and is it a model at all. One
 * implementation, so the two cannot come to disagree about what `--gateway fake`
 * means or about when a credential is required.
 *
 * Three answers, and each is a decision the caller made rather than a default
 * that happened:
 *
 * * **`--gateway anthropic`**, or a credential in the environment. The real one.
 * * **`--gateway fake`**, which answers from the grounding eval's committed
 *   cases. A fixture, not a model, and everything it produces says so in its
 *   provenance (`fake:grounding-cases`).
 * * **nothing**, which is a refusal for `record` and an absence for `repl`: a
 *   recording session with no model has nothing to do, and a REPL session with
 *   no model can still drive an application through bindings it already has.
 */
import { join } from "node:path";
import {
  anthropicGateway,
  credentialInEnvironment,
  DiskCache,
  fakeGateway,
  GatewayUnavailable,
  type Gateway,
} from "@svatah/gateway";
import { stringOption, type CommandIo, type ParsedArgs } from "@svatah/bindings-cli";
import { groundingAnswers } from "./grounding-answers.js";
import type { LoadedProject } from "./project.js";

export interface GatewayChoiceOptions {
  /**
   * Return `undefined` instead of throwing when there is no model.
   *
   * `svatah record` requires one — a record session with no model grounds
   * nothing. `svatah repl` does not: a session can drive an application through
   * bindings that already exist, and only a sentence naming something new needs
   * a model at all.
   */
  readonly optional?: boolean;
}

export function gatewayForRecording(
  args: ParsedArgs,
  loaded: LoadedProject,
  io: CommandIo,
  options: GatewayChoiceOptions = {},
): Gateway | undefined {
  const asked = stringOption(args, "gateway") ?? (credentialInEnvironment() ? "anthropic" : "");

  if (asked === "none") return undefined;

  if (asked === "fake") {
    const answers = groundingAnswers();
    io.err(
      `using the fake gateway: ${answers.size} answer(s) from evals/grounding/cases. ` +
        "Nothing here measures a model.",
    );
    return fakeGateway({
      label: "grounding-cases",
      secrets: secretValues(loaded.project.data.values, loaded.project.data.secrets),
      answer: (request) =>
        answers.answer(request.user) ?? {
          ref: null,
          why: "no committed case covers this phrase on this page",
          confidence: 1,
        },
    });
  }

  if (asked !== "anthropic") {
    if (options.optional === true) return undefined;
    throw new GatewayUnavailable(
      "Recording needs a model. Set ANTHROPIC_API_KEY (or run `ant auth login`), or pass " +
        "--gateway fake to record from the grounding eval's committed answers — which is a " +
        "fixture, not a model, and the report will say so.",
    );
  }

  return anthropicGateway({
    model: loaded.config.record.model,
    cache: new DiskCache(join(loaded.root, ".svatah", "model-cache")),
    secrets: secretValues(loaded.project.data.values, loaded.project.data.secrets),
    onCall: (line) => io.err(`      ${line}`),
  });
}

/**
 * The *values* behind the declared secret paths.
 *
 * REQ-NFR-6 redacts by value rather than by name: the gateway is given the
 * strings themselves, so a password that reached a prompt through any path at
 * all is caught before the request is sent.
 */
export function secretValues(
  data: Readonly<Record<string, unknown>>,
  secrets: ReadonlySet<string>,
): Set<string> {
  const out = new Set<string>();
  for (const path of secrets) {
    let cursor: unknown = data;
    for (const segment of path.split(".")) {
      if (typeof cursor !== "object" || cursor === null) {
        cursor = undefined;
        break;
      }
      cursor = (cursor as Record<string, unknown>)[segment];
    }
    // Four characters is the floor: redacting "on" or "1" would blank half the
    // prompt and tell a reader nothing.
    if (typeof cursor === "string" && cursor.length >= 4) out.add(cursor);
  }
  return out;
}
