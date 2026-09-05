/**
 * The disk cache (T3.1: "disk cache", "cache hit costs zero").
 *
 * Two things it is for. Re-recording a project after changing one step should not
 * re-pay for the twenty steps that did not change; and a pull-request CI job
 * should be able to run the grounding eval without a credential and without
 * spending, from answers a scheduled job with a credential already committed.
 *
 * A hit is free, and the accounting says so: the provenance of a cached answer
 * carries the token counts of the call that produced it — that is what it cost,
 * once — with `costUsd: 0`, because this call cost nothing. Reporting the
 * original price again would inflate every eval that reran.
 *
 * ## The key
 *
 * Everything that could change the answer: the model, the prompt version, the
 * instructions, the question, and the schema the answer must fit. Not the
 * effort, and not `max_tokens` — a stricter budget does not make a *different*
 * question — and not the wall clock, which is what makes a cache a cache.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { provenanceSchema, type Provenance } from "@svatah/schema";

export interface CacheEntry {
  readonly value: unknown;
  readonly provenance: Provenance;
}

export interface GatewayCache {
  get(key: string): CacheEntry | undefined;
  put(key: string, entry: CacheEntry): void;
}

export interface CacheKeyParts {
  readonly model: string;
  readonly promptVersion: string;
  readonly system: string;
  readonly user: string;
  readonly schema: unknown;
  readonly images?: readonly { readonly base64: string }[];
  readonly scope?: string;
}

export function cacheKey(parts: CacheKeyParts): string {
  const hash = createHash("sha256");
  hash.update(parts.model);
  hash.update(" ");
  hash.update(parts.promptVersion);
  hash.update(" ");
  hash.update(parts.system);
  hash.update(" ");
  hash.update(parts.user);
  hash.update(" ");
  hash.update(JSON.stringify(parts.schema));
  for (const image of parts.images ?? []) {
    hash.update(" ");
    hash.update(createHash("sha256").update(image.base64).digest("hex"));
  }
  if (parts.scope !== undefined) {
    hash.update(" ");
    hash.update(parts.scope);
  }
  return hash.digest("hex");
}

/** A cache that keeps nothing. The default when no directory is configured. */
export const NO_CACHE: GatewayCache = {
  get: () => undefined,
  put: () => undefined,
};

/** Answers in memory, for tests and for one process's repeated questions. */
export class MemoryCache implements GatewayCache {
  private readonly entries = new Map<string, CacheEntry>();

  get(key: string): CacheEntry | undefined {
    return this.entries.get(key);
  }

  put(key: string, entry: CacheEntry): void {
    this.entries.set(key, entry);
  }

  get size(): number {
    return this.entries.size;
  }
}

/**
 * One JSON file per answer, under a directory the caller names.
 *
 * A directory of small files rather than one index: two recordings running at
 * once write different keys and never the same byte, so no locking is needed,
 * and a corrupt entry costs one answer rather than the whole cache. A file that
 * will not parse is treated as a miss and overwritten — a cache that refuses to
 * run because of its own bookkeeping is worse than a cache that re-asks.
 */
export class DiskCache implements GatewayCache {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private pathFor(key: string): string {
    return join(this.dir, `${key}.json`);
  }

  get(key: string): CacheEntry | undefined {
    const path = this.pathFor(key);
    if (!existsSync(path)) return undefined;
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as {
        value: unknown;
        provenance: unknown;
      };
      return { value: raw.value, provenance: provenanceSchema.parse(raw.provenance) };
    } catch {
      return undefined;
    }
  }

  put(key: string, entry: CacheEntry): void {
    // Written beside and renamed: a reader must never see half a file, and
    // `rename` is atomic within a directory on every platform this runs on.
    const path = this.pathFor(key);
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(entry, null, 2)}\n`, "utf8");
    renameSync(temporary, path);
  }
}
