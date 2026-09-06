/**
 * The preload bridge, as the renderer sees it.
 *
 * Four functions on `window.yam` and nothing else (LLD §13.6). Typed here rather
 * than imported from `../preload/index.js`, because the renderer must not import
 * from a module that imports `electron` — a bundler that followed that edge
 * would pull the main process's world into a browser.
 */
export interface ServiceInfo {
  readonly url: string;
  readonly token: string;
  readonly project: string;
  readonly adopted: boolean;
}

export interface Preferences {
  readonly theme: "system" | "light" | "dark";
  readonly window: { readonly width: number; readonly height: number };
  readonly recentProjects: readonly string[];
}

export interface AppBridge {
  openProject(directory: string): Promise<ServiceInfo>;
  serviceInfo(): Promise<ServiceInfo | null>;
  pickFile(kind: "directory" | "file"): Promise<string | null>;
  preferences(next?: Partial<Preferences>): Promise<Preferences>;
  onServiceLog(listener: (line: string) => void): () => void;
  /** A project the main process opened from `YAM_APP_PROJECT` (T8.1). */
  onServiceOpened(
    listener: (event: { connection?: ServiceInfo; error?: string }) => void,
  ): () => void;
}

declare global {
  interface Window {
    readonly yam: AppBridge;
  }
}

export function bridge(): AppBridge {
  if (typeof window === "undefined" || window.yam === undefined) {
    throw new Error(
      "The app bridge is missing. This build is meant to run inside Electron with the " +
        "preload script loaded (LLD §13.6).",
    );
  }
  return window.yam;
}
