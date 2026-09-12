/**
 * Who is connected over MCP, across processes (TV-M05, TV-13, SF-07, SF-08).
 *
 * The model knew what tools were exposed and what had been called, and nothing
 * about *who was connected* — so the cockpit and the app could not say that an
 * agent was driving, which is the thing SF-13 requires to be visible before a
 * handoff can mean anything.
 *
 * An MCP server is its own process: `yam mcp` speaks stdio to one client and
 * `yam mcp --http` holds several, and neither is the service. So a connection is
 * recorded the way the broker records itself — a small file in the user's state
 * directory, written when a client arrives and removed when it leaves — and the
 * service reads the directory. A process that dies without cleaning up leaves a
 * stale file, which is why every record carries a heartbeat and a reader drops
 * what has gone quiet rather than reporting a client that is not there.
 */
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { brokerStateDir } from "./broker.js";

/** One connected MCP client, as a person reads it. */
export interface AgentClient {
  /** What the client called itself at initialize; the transport's id otherwise. */
  readonly name: string;
  readonly transport: "stdio" | "http";
  /** The MCP protocol version negotiated, when the client named one. */
  readonly protocol?: string;
  /** Which tool profile it was given: what it may call. */
  readonly profile: string;
  /** When it connected, as an instant. How long ago is the renderer's. */
  readonly since: string;
  /** The session it holds, when it holds one (SF-13). */
  readonly holds?: string;
  /** Its own id, which is also its file's name. */
  readonly id: string;
}

/** How long a record may go unrefreshed before a reader stops believing it. */
export const CLIENT_STALE_MS = 30_000;

const clientsDir = (stateDir?: string): string => join(stateDir ?? brokerStateDir(), "clients");

/** Record a client, or refresh one. Returns the path, for the caller to remove. */
export function writeClient(client: AgentClient, stateDir?: string): string {
  const dir = clientsDir(stateDir);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = join(dir, `${client.id}.json`);
  writeFileSync(path, JSON.stringify({ ...client, at: Date.now() }, null, 2), { mode: 0o600 });
  return path;
}

/** Forget a client. Missing is not an error: a second disconnect is a disconnect. */
export function removeClient(id: string, stateDir?: string): void {
  rmSync(join(clientsDir(stateDir), `${id}.json`), { force: true });
}

/**
 * Everyone connected, newest first, without the ones that have gone quiet.
 *
 * A stale record is dropped *and deleted*: a client that died is not a client,
 * and leaving the file would make the next reader wait the same thirty seconds
 * to decide the same thing.
 */
export function readClients(stateDir?: string, now: number = Date.now()): AgentClient[] {
  const dir = clientsDir(stateDir);
  let names: string[];
  try {
    names = readdirSync(dir).filter((one) => one.endsWith(".json"));
  } catch {
    return [];
  }
  const found: AgentClient[] = [];
  for (const name of names) {
    const path = join(dir, name);
    try {
      const raw = JSON.parse(readFileSync(path, "utf8")) as AgentClient & { at?: number };
      if (typeof raw.at === "number" && now - raw.at > CLIENT_STALE_MS) {
        rmSync(path, { force: true });
        continue;
      }
      const { at, ...client } = raw;
      void at;
      found.push(client);
    } catch {
      /* A half-written file is not a client either. */
      rmSync(path, { force: true });
    }
  }
  return found.sort((a, b) => (a.since < b.since ? 1 : -1));
}
