import type { AdapterName, Config } from "@svatah/schema";
import { SessionError } from "./errors.js";
import type { AgentSurface } from "./surface.js";

/**
 * Adapter registration and selection (LLD §2.4, REQ-SURF-2).
 *
 * Adapters are registered by name and selected by configuration. The compiler,
 * recorder, executor, healer and behaviors depend only on `AgentSurface`; only the
 * CLI registers adapters, which is why the import-boundary lint forbids everyone
 * else from importing an `adapter-*` package.
 */

export type AdapterFactory = (config: Config) => AgentSurface | Promise<AgentSurface>;

const registry = new Map<string, AdapterFactory>();

/**
 * Register an adapter under a name. Registering the same name twice is an error:
 * silently replacing an adapter would make which implementation ran depend on
 * import order, and replay must not depend on that.
 */
export function registerAdapter(name: string, factory: AdapterFactory): void {
  if (name.trim() === "") {
    throw new SessionError("An adapter name must not be empty.");
  }
  if (registry.has(name)) {
    throw new SessionError(
      `Adapter "${name}" is already registered. Call unregisterAdapter("${name}") first if replacing it is intended.`,
    );
  }
  registry.set(name, factory);
}

/** Remove a registration. Returns false when the name was not registered. */
export function unregisterAdapter(name: string): boolean {
  return registry.delete(name);
}

/** Every registered adapter name, sorted. */
export function listAdapters(): string[] {
  return [...registry.keys()].sort();
}

export function hasAdapter(name: string): boolean {
  return registry.has(name);
}

/** Drop every registration. For tests and for the REPL's session teardown. */
export function clearAdapters(): void {
  registry.clear();
}

/** The factory registered under a name, or `undefined`. */
export function adapterFactory(name: string): AdapterFactory | undefined {
  return registry.get(name);
}

/**
 * Build the surface the configuration selects (LLD §2.4).
 *
 * Fails with the list of what is registered, because the usual cause is a missing
 * adapter package rather than a typo.
 */
export async function createSurface(config: Config): Promise<AgentSurface> {
  const name: AdapterName = config.adapter;
  const factory = registry.get(name);
  if (factory === undefined) {
    const known = listAdapters();
    throw new SessionError(
      `No adapter registered under "${name}". Registered: ${known.length > 0 ? known.join(", ") : "(none)"}.`,
    );
  }
  return await factory(config);
}
