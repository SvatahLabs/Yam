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

    async closeAll(): Promise<void> {
      const entries = [...sessions.values()];
      sessions.clear();
      const launched = entries.filter((e) => e.mode === "launch");
      await Promise.allSettled(launched.map((e) => e.surface.close()));
    },

    async expireSessions(): Promise<string[]> {
      const now = Date.now();
      const expired: string[] = [];
      for (const [id, entry] of sessions) {
        if (entry.ttlMs === undefined) continue;
        const lastMs = new Date(entry.lastActivity).getTime();
        if (now - lastMs > entry.ttlMs) {
          expired.push(id);
          sessions.delete(id);
          if (entry.mode === "launch") {
            await entry.surface.close().catch(() => {});
          }
        }
      }
      return expired;
    },
  };
}
