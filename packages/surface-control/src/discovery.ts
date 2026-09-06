import { platform } from "node:os";

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
}

const ADAPTER_PLATFORMS: Record<string, string[]> = {
  playwright: ["darwin", "linux", "win32"],
  bidi: ["darwin", "linux", "win32"],
  appium: ["darwin", "linux", "win32"],
  ax: ["darwin"],
  uia: ["win32"],
  http: ["darwin", "linux", "win32"],
};

const ADAPTER_KINDS: Record<string, "browser" | "http" | "native"> = {
  playwright: "browser",
  bidi: "browser",
  appium: "native",
  ax: "native",
  uia: "native",
  http: "http",
};

const ADAPTER_PREREQUISITES: Record<string, string[]> = {
  playwright: ["Chromium browser (bundled)"],
  bidi: ["Chrome or Firefox with BiDi support"],
  appium: ["Appium server", "target device/emulator"],
  ax: ["Accessibility permission (macOS System Settings > Privacy & Security > Accessibility)"],
  uia: ["Windows UI Automation runtime"],
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
