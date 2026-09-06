import { randomUUID } from "node:crypto";
import type { AgentSurface } from "@svatah/yam-surface";

export type SessionStatus = "connecting" | "ready" | "busy" | "disconnected" | "closed";

export interface SessionEntry {
  sessionId: string;
  surface: AgentSurface;
  adapter: string;
  status: SessionStatus;
  targetId?: string;
  createdAt: string;
  lastActivity?: string;
}

export interface SessionStore {
  create(surface: AgentSurface, adapter: string): string;
  get(sessionId: string): SessionEntry | undefined;
  list(): Array<{
    sessionId: string;
    adapter: string;
    kind: string;
    status: SessionStatus;
    targetId?: string;
    createdAt: string;
  }>;
  remove(sessionId: string): void;
  closeAll(): Promise<void>;
}

export function createSessionStore(): SessionStore {
  const sessions = new Map<string, SessionEntry>();

  return {
    create(surface: AgentSurface, adapter: string): string {
      const sessionId = `s_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
      sessions.set(sessionId, {
        sessionId,
        surface,
        adapter,
        status: "ready",
        createdAt: new Date().toISOString(),
      });
      return sessionId;
    },

    get(sessionId: string): SessionEntry | undefined {
      return sessions.get(sessionId);
    },

    list() {
      return [...sessions.values()].map((e) => ({
        sessionId: e.sessionId,
        adapter: e.adapter,
        kind: e.surface.kind,
        status: e.status,
        targetId: e.targetId,
        createdAt: e.createdAt,
      }));
    },

    remove(sessionId: string): void {
      sessions.delete(sessionId);
    },

    async closeAll(): Promise<void> {
      const entries = [...sessions.values()];
      sessions.clear();
      await Promise.allSettled(entries.map((e) => e.surface.close()));
    },
  };
}
