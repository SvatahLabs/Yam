import { platform } from "node:os";
import { probeAdapter, DRIVEN_RANGES, type AdapterProbe } from "./probes.js";

export interface DiscoveredTarget {
  id: string;
  name: string;
  kind: "browser" | "http" | "native" | "process";
  adapter: string;
  url?: string;
  application?: string;
  ready: boolean;
  reason?: string;
}

export interface AdapterReadiness {
  adapter: string;
  registered: boolean;
  available: boolean;
  platform: string[];
  reason?: string;
  prerequisites?: string[];
  /**
   * What the host said when it was asked (T23, SF-09).
   *
   * `available` used to mean "registered, and the platform table matches",
   * which is a claim about a `Record<string, string[]>` rather than about this
   * machine — `appium: available` with no Appium server anywhere. When a probe
   * has been run, `available` means the thing is actually reachable and
   * `version` is what it said its version was.
   */
  probe?: AdapterProbe;
  /** The versions this repository has driven. Not a claim about others. */
  range?: string;
}

const ADAPTER_PLATFORMS: Record<string, string[]> = {
  playwright: ["darwin", "linux", "win32"],
  bidi: ["darwin", "linux", "win32"],
  appium: ["darwin", "linux", "win32"],
  ax: ["darwin"],
  uia: ["win32"],
  http: ["darwin", "linux", "win32"],
  process: ["darwin", "linux"],
  atspi: ["linux"],
};

const ADAPTER_KINDS: Record<string, "browser" | "http" | "native" | "process"> = {
  playwright: "browser",
  bidi: "browser",
  appium: "native",
  ax: "native",
  uia: "native",
  atspi: "native",
  http: "http",
  process: "process",
};

const ADAPTER_PREREQUISITES: Record<string, string[]> = {
  playwright: ["Chromium browser (bundled)"],
  bidi: ["Chrome or Firefox with BiDi support"],
  appium: ["Appium server", "target device/emulator"],
  ax: ["Accessibility permission (macOS System Settings > Privacy & Security > Accessibility)"],
  uia: ["Windows UI Automation runtime"],
  atspi: [
    "a Linux session bus",
    "at-spi2-registryd running with toolkit accessibility on",
    "gdbus (GLib)",
  ],
  process: ["expect(1), or a python3 with its pty module"],
  http: [],
};

export function checkAdapterReadiness(
  adapter: string,
  registeredAdapters: string[],
): AdapterReadiness {
  const registered = registeredAdapters.includes(adapter);
  const platforms = ADAPTER_PLATFORMS[adapter] ?? [];
  const onPlatform = platforms.length === 0 || platforms.includes(platform());
  const available = registered && onPlatform;

  let reason: string | undefined;
  if (!registered) {
    reason = `Adapter "${adapter}" is not registered.`;
  } else if (!onPlatform) {
    reason = `Adapter "${adapter}" requires ${platforms.join(" or ")}; this host is ${platform()}.`;
  }

  return {
    adapter,
    registered,
    available,
    platform: platforms,
    reason,
    prerequisites: ADAPTER_PREREQUISITES[adapter],
  };
}

export function discoverAdapters(registeredAdapters: string[]): AdapterReadiness[] {
  const known = new Set([...Object.keys(ADAPTER_PLATFORMS), ...registeredAdapters]);
  return [...known].sort().map((name) => checkAdapterReadiness(name, registeredAdapters));
}

/**
 * Readiness with the host actually asked (T23, SF-09, SF-23).
 *
 * The asynchronous twin of `checkAdapterReadiness`, kept separate because the
 * synchronous one is on the path of every `connect` and a probe costs a process
 * spawn or an HTTP round trip. `doctor`, `targets` and the coverage report ask
 * for this one; a connect asks for the cheap one and then lets the adapter
 * refuse with its own sentence.
 */
export async function probeAdapters(registeredAdapters: string[]): Promise<AdapterReadiness[]> {
  const known = new Set([...Object.keys(ADAPTER_PLATFORMS), ...registeredAdapters]);
  return await Promise.all(
    [...known].sort().map(async (name) => {
      const table = checkAdapterReadiness(name, registeredAdapters);
      const probe = await probeAdapter(name);
      return {
        ...table,
        probe,
        /*
         * The probe has the last word: a table can say a platform matches and
         * a probe can say the program is not installed, and the second is the
         * one a caller is about to find out the hard way.
         */
        available: table.registered && probe.present,
        ...(probe.present ? {} : { reason: probe.reason ?? table.reason }),
        ...(DRIVEN_RANGES[name] === undefined ? {} : { range: DRIVEN_RANGES[name] }),
      } satisfies AdapterReadiness;
    }),
  );
}

export function selectAdapter(
  url?: string,
  explicitAdapter?: string,
  registeredAdapters: string[] = [],
): { adapter: string; ambiguous?: DiscoveredTarget[] } {
  if (explicitAdapter) {
    return { adapter: explicitAdapter };
  }

  if (url) {
    const browserAdapters = ["playwright", "bidi"].filter((a) =>
      registeredAdapters.includes(a) && (ADAPTER_PLATFORMS[a] ?? []).includes(platform()),
    );
    const httpAdapter = registeredAdapters.includes("http") ? "http" : undefined;

    if (browserAdapters.length === 1 && !httpAdapter) {
      return { adapter: browserAdapters[0]! };
    }
    if (browserAdapters.length === 0 && httpAdapter) {
      return { adapter: httpAdapter };
    }
    if (browserAdapters.length > 0) {
      return { adapter: browserAdapters[0]! };
    }
  }

  const available = discoverAdapters(registeredAdapters).filter((a) => a.available);
  if (available.length === 1) {
    return { adapter: available[0]!.adapter };
  }
  if (available.length === 0) {
    return { adapter: "playwright" };
  }
  return { adapter: available[0]!.adapter };
}

export function discoverTargets(
  registeredAdapters: string[],
  options?: { url?: string; adapter?: string },
): DiscoveredTarget[] {
  const targets: DiscoveredTarget[] = [];
  const adapters = discoverAdapters(registeredAdapters);

  for (const readiness of adapters) {
    if (options?.adapter && readiness.adapter !== options.adapter) continue;

    const kind = ADAPTER_KINDS[readiness.adapter] ?? "browser";

    if (options?.url && (kind === "browser" || kind === "http")) {
      targets.push({
        id: `${readiness.adapter}:${options.url}`,
        name: `${options.url} via ${readiness.adapter}`,
        kind,
        adapter: readiness.adapter,
        url: options.url,
        ready: readiness.available,
        reason: readiness.reason,
      });
    } else if (!options?.url) {
      targets.push({
        id: readiness.adapter,
        name: `${readiness.adapter} adapter`,
        kind,
        adapter: readiness.adapter,
        ready: readiness.available,
        reason: readiness.reason,
      });
    }
  }

  return targets;
}
