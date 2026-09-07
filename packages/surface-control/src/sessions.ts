import { randomUUID } from "node:crypto";
import type { AgentSurface } from "@svatah/yam-surface";

export type SessionStatus = "connecting" | "ready" | "busy" | "disconnected" | "closed";
export type SessionMode = "launch" | "attach";

export interface SessionEntry {
  sessionId: string;
  surface: AgentSurface;
  adapter: string;
  status: SessionStatus;
  mode: SessionMode;
  targetId?: string;
  createdAt: string;
  lastActivity: string;
  ttlMs?: number;
}

export interface SessionStore {
  create(surface: AgentSurface, adapter: string, options?: { mode?: SessionMode; ttlMs?: number }): string;
  get(sessionId: string): SessionEntry | undefined;
  touch(sessionId: string): void;
  list(): Array<{
    sessionId: string;
    adapter: string;
    kind: string;
    status: SessionStatus;
    mode: SessionMode;
    targetId?: string;
    createdAt: string;
    lastActivity: string;
  }>;
  remove(sessionId: string): void;
  closeAll(): Promise<void>;
  expireSessions(): Promise<string[]>;
}

const DEFAULT_TTL_MS = 30 * 60 * 1000;

export function createSessionStore(): SessionStore {
  const sessions = new Map<string, SessionEntry>();

  return {
    create(surface: AgentSurface, adapter: string, options?: { mode?: SessionMode; ttlMs?: number }): string {
      const sessionId = `s_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      const now = new Date().toISOString();
      sessions.set(sessionId, {
        sessionId,
        surface,
        adapter,
        status: "ready",
        mode: options?.mode ?? "launch",
        createdAt: now,
        lastActivity: now,
        ttlMs: options?.ttlMs ?? DEFAULT_TTL_MS,
      });
      return sessionId;
    },

    get(sessionId: string): SessionEntry | undefined {
      return sessions.get(sessionId);
    },

    touch(sessionId: string): void {
      const entry = sessions.get(sessionId);
      if (entry) entry.lastActivity = new Date().toISOString();
    },

    list() {
      return [...sessions.values()].map((e) => ({
        sessionId: e.sessionId,
        adapter: e.adapter,
        kind: e.surface.kind,
        status: e.status,
        mode: e.mode,
        targetId: e.targetId,
        createdAt: e.createdAt,
        lastActivity: e.lastActivity,
      }));
    },

    remove(sessionId: string): void {
      sessions.delete(sessionId);
    },

    /*
     * Close every session's surface, and let the adapter decide what closing
     * one means (T00, SF-05).
     *
     * This used to close only the sessions whose mode was `launch`, on the
     * reasoning that an attached application is the user's and must not be
     * quit. The reasoning is right and the place was wrong: the adapter already
     * makes that distinction — an attached browser is *disconnected from*, not
     * closed — and skipping the entry here leaks whatever the session was
     * holding instead. It did not show while `connect` recorded every session
     * as `launch` whatever it had done, which is the defect beside this one.
     */
    async closeAll(): Promise<void> {
      const entries = [...sessions.values()];
      sessions.clear();
      await Promise.allSettled(entries.map((e) => e.surface.close()));
    },

    async expireSessions(): Promise<string[]> {
      const now = Date.now();
      const expired: string[] = [];
      for (const [id, entry] of sessions) {
        if (entry.ttlMs === undefined) continue;
        const lastMs = new Date(entry.lastActivity).getTime();
        if (now - lastMs >= entry.ttlMs) {
          expired.push(id);
          sessions.delete(id);
          // The same rule as `closeAll`: close it, and let the adapter decide
          // whether closing means quitting a target Yam started or letting go
          // of one it only attached to.
          await entry.surface.close().catch(() => {});
        }
      }
      return expired;
    },
  };
}
