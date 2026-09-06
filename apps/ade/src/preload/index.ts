/**
 * The bridge, and the whole of it (T3.6, REQ-ADE-2, LLD §13.6).
 *
 * "Typed preload bridge exposing only `openProject`, `serviceInfo`, `pickFile`,
 * `preferences`."
 *
 * Four functions. Not four *kinds* of function — four. There is no generic
 * `invoke(channel, args)`, because one would make this file a description of
 * nothing: the renderer could then reach any handler the main process ever
 * grows, and the bridge's surface would be whatever `ipcMain` happens to have.
 *
 * Everything else the ADE does goes over HTTP to the local service, with the
 * token this bridge hands out. That is REQ-ADE-1's "the service is the only
 * integration point" taken literally, and it is why the ADE can claim to show
 * nothing the CLI cannot produce: it has no other way to find anything out.
 *
 * `contextBridge` copies values across a boundary, so what the renderer receives
 * is data rather than a live reference into the main process's heap.
 */
import { contextBridge, ipcRenderer } from "electron";

export interface ServiceInfo {
  readonly url: string;
  readonly token: string;
  readonly project: string;
  /** True when the ADE connected to a service it did not start. */
  readonly adopted: boolean;
}

export interface Preferences {
  readonly theme: "system" | "light" | "dark";
  readonly window: { readonly width: number; readonly height: number };
  readonly recentProjects: readonly string[];
}

export interface AdeBridge {
  /** Start (or adopt) the service for a project directory. */
  openProject(directory: string): Promise<ServiceInfo>;
  /** The current connection, or null when no project is open. */
  serviceInfo(): Promise<ServiceInfo | null>;
  /** A native chooser. The only way a path enters the ADE. */
  pickFile(kind: "directory" | "file"): Promise<string | null>;
  /** Read preferences, or merge a change and read them back. */
  preferences(next?: Partial<Preferences>): Promise<Preferences>;
  /** Lines the service wrote to stderr while starting. */
  onServiceLog(listener: (line: string) => void): () => void;
  /**
   * The result of a project opened by the *main* process (T8.1, §13.6).
   *
   * `YAM_ADE_PROJECT=<dir>` opens a project on ready, before the renderer
   * exists, so there is no call for the renderer to await. This carries the
   * answer — a connection, or the message the Project screen shows as its
   * alert — to a screen that did not ask for it.
   *
   * One way, no arguments, no handler on the other end: it can start nothing
   * and read nothing, which is what keeps the bridge's shape (§13.6) an
   * honest description of what the renderer can do.
   */
  onServiceOpened(
    listener: (event: { connection?: ServiceInfo; error?: string }) => void,
  ): () => void;
}

const bridge: AdeBridge = {
  openProject: (directory) => ipcRenderer.invoke("ade:openProject", directory) as Promise<ServiceInfo>,
  serviceInfo: () => ipcRenderer.invoke("ade:serviceInfo") as Promise<ServiceInfo | null>,
  pickFile: (kind) => ipcRenderer.invoke("ade:pickFile", kind) as Promise<string | null>,
  preferences: (next) => ipcRenderer.invoke("ade:preferences", next ?? null) as Promise<Preferences>,
  onServiceLog: (listener) => {
    const handler = (_event: unknown, line: string): void => listener(line);
    ipcRenderer.on("service:log", handler);
    return () => ipcRenderer.off("service:log", handler);
  },
  onServiceOpened: (listener) => {
    const handler = (_event: unknown, payload: { connection?: ServiceInfo; error?: string }): void =>
      listener(payload);
    ipcRenderer.on("service:opened", handler);
    return () => ipcRenderer.off("service:opened", handler);
  },
};

contextBridge.exposeInMainWorld("ade", bridge);
