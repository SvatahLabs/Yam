/**
 * What a gateway is, and what it refuses to be (LLD §10, REQ-AGT-3, REQ-NFR-2, 6).
 *
 * One interface over every backend — Anthropic, a local instruct model, and the
 * fake one the tests and the credential-free contract use. Everything above it
 * (the recorder, the healer's `Regrounder`, the evals) asks a *question with a
 * shape* and gets an answer of that shape plus its provenance; nothing above it
 * knows a wire format, and nothing above it can call a model any other way.
 *
 * That is the boundary REQ-RUN-1 depends on: `runtime`, `bindings` and the
 * replay path cannot import this package at all (LLD §1), so "the executor makes
 * no model calls" is a build-time fact rather than a promise.
 */
import type { Provenance } from "@svatah/yam-schema";
import type { ZodType } from "zod";

/** How hard the model should think (`output_config.effort`). */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

/** An image, for the vision fallback only (REQ-REC-2). */
export interface GatewayImage {
  readonly mediaType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  /** Base64, no data: prefix and no newlines. */
  readonly base64: string;
}

/**
 * One question.
 *
 * `system` is the *stable* half — the instructions, identical from call to call
 * — and is sent as a cached block. `user` is the volatile half: this step, this
 * snapshot. Keeping them apart is what makes the cache work at all; a prompt
 * that interpolates a snapshot into its instructions has a new prefix every
 * time and never reads from the cache (`shared/prompt-caching.md`).
 */
export interface GatewayRequest<T> {
  /** Identifies the prompt in provenance, e.g. `g-1` (REQ-AGT-3). */
  readonly promptVersion: string;
  /** The stable instruction block. Cached. */
  readonly system: string;
  /** The volatile part: what is being asked about. */
  readonly user: string;
  /** The answer's shape. The model is constrained to it, and it is re-validated here. */
  readonly answer: ZodType<T>;
  /** Screenshots, when the caller is allowed a vision fallback. */
  readonly images?: readonly GatewayImage[];
  readonly maxTokens?: number;
  readonly effort?: Effort;
  /**
   * Extra bytes folded into the cache key.
   *
   * Two callers asking the same question of the same model must share a cache
   * entry; two asking different questions must not. Everything that changes the
   * answer is already in the key — model, prompt version, system, user, schema —
   * so this is for the rare case something outside them does.
   */
  readonly cacheScope?: string;
}

/** An answer, with what it cost to get (REQ-AGT-3, REQ-NFR-2). */
export interface GatewayAnswer<T> {
  readonly value: T;
  readonly provenance: Provenance;
  /** True when this came from the disk cache and cost nothing. */
  readonly cached: boolean;
}

/** Running totals, for the per-invocation cost line REQ-NFR-2 asks for. */
export interface GatewayUsage {
  calls: number;
  cacheHits: number;
  tokensIn: number;
  tokensOut: number;
  cacheRead: number;
  costUsd: number;
}

export interface Gateway {
  /** The backend's name, for a report that has to say which produced a number. */
  readonly name: string;
  /** The model id recorded in provenance. */
  readonly model: string;
  /** Whether this is a real model. `false` for the fake gateway. */
  readonly real: boolean;
  ask<T>(request: GatewayRequest<T>): Promise<GatewayAnswer<T>>;
  usage(): Readonly<GatewayUsage>;
}

/**
 * The model declined (LLD §10: "refusal stop reason handled as a tier failure").
 *
 * A refusal is an answer, not an outage: the model understood and said no. So it
 * is never retried — a retry would spend money to be told no again — and it
 * never becomes a `null` that a caller could mistake for "no such element".
 */
export class GatewayRefusal extends Error {
  readonly category: string | undefined;
  readonly explanation: string | undefined;

  constructor(message: string, details?: { category?: string | null; explanation?: string | null }) {
    super(message);
    this.name = "GatewayRefusal";
    this.category = details?.category ?? undefined;
    this.explanation = details?.explanation ?? undefined;
  }
}

/**
 * A backend that was configured and could not be reached, or has no credential.
 *
 * Exit code 3 in LLD §15 ("a model backend was configured but unavailable"), and
 * distinct from a refusal: this one is worth trying again later.
 */
export class GatewayUnavailable extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "GatewayUnavailable";
  }
}

/** The model answered, and the answer was not the shape that was asked for. */
export class GatewayShapeError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message);
    this.name = "GatewayShapeError";
  }
}

export function emptyUsage(): GatewayUsage {
  return { calls: 0, cacheHits: 0, tokensIn: 0, tokensOut: 0, cacheRead: 0, costUsd: 0 };
}
