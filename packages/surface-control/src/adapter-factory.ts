import type { AgentSurface } from "@svatah/yam-surface";
import { DEFAULT_CONFIG, type Config } from "@svatah/yam-schema";

export interface ConnectOptions {
  headed?: boolean;
}

export type AdapterFactoryFn =
  (name: string, options?: ConnectOptions) => Promise<AgentSurface>;

export function createAdapterFactory(
  resolveAdapter: (name: string, config: Config) => AgentSurface | Promise<AgentSurface>,
  listRegistered: () => string[],
): AdapterFactoryFn {
  return async (name: string, options?: ConnectOptions): Promise<AgentSurface> => {
    const registered = listRegistered();
    if (!registered.includes(name)) {
      const available = registered.length > 0 ? registered.join(", ") : "(none)";
      throw new Error(
        `Adapter "${name}" is not registered. Available: ${available}.`,
      );
    }
    const config: Config = {
      ...DEFAULT_CONFIG,
      project: "surface-control",
      adapter: name as Config["adapter"],
      run: {
        ...DEFAULT_CONFIG.run,
        headless: options?.headed !== true,
      },
    };
    return await resolveAdapter(name, config);
  };
}
