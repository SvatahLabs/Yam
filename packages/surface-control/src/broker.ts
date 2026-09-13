import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeFileSync,
  writeSync,
  unlinkSync,
} from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

export interface BrokerDescriptor {
  url: string;
  token: string;
  pid: number;
  startedAt: string;
  /** Who started it: `@svatah/yam 0.1.0`, `Yam.app 0.1.0` (PK-08). */
  startedBy?: string;
}

const APP_NAME = "yam";

export function brokerStateDir(): string {
  const p = platform();
  if (p === "darwin") return join(homedir(), "Library", "Application Support", APP_NAME);
  if (p === "win32") return join(process.env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), APP_NAME);
  return join(process.env["XDG_STATE_HOME"] ?? join(homedir(), ".local", "state"), APP_NAME);
}

function descriptorPath(stateDir?: string): string {
  return join(stateDir ?? brokerStateDir(), "broker.json");
}

export function generateToken(): string {
  return randomUUID().replace(/-/g, "");
}

export function writeBrokerDescriptor(
  descriptor: BrokerDescriptor,
  stateDir?: string,
): string {
  const dir = stateDir ?? brokerStateDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = descriptorPath(dir);
  writeFileSync(path, JSON.stringify(descriptor, null, 2), { mode: 0o600 });
  return path;
}

export function readBrokerDescriptor(stateDir?: string): BrokerDescriptor | undefined {
  const path = descriptorPath(stateDir);
  if (!existsSync(path)) return undefined;
  try {
    const raw = readFileSync(path, "utf8");
    return JSON.parse(raw) as BrokerDescriptor;
  } catch {
    return undefined;
  }
}

export function removeBrokerDescriptor(stateDir?: string): void {
  const path = descriptorPath(stateDir);
  try {
    unlinkSync(path);
  } catch {
    // Already gone
  }
}

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function discoverBroker(stateDir?: string): BrokerDescriptor | undefined {
  const descriptor = readBrokerDescriptor(stateDir);
  if (descriptor === undefined) return undefined;
  if (!isProcessAlive(descriptor.pid)) {
    removeBrokerDescriptor(stateDir);
    return undefined;
  }
  return descriptor;
}

/**
 * One broker to a machine, enforced rather than hoped for (T00, SF-05, SF-13).
 *
 * ## What went wrong without this
 *
 * Starting a broker was "look for a descriptor; if there is none, spawn one and
 * wait for a descriptor to appear". Two clients that look at the same instant
 * both find none, and both spawn. Each broker binds a port of its own and
 * writes `broker.json`; the second write wins. The loser is still running, and
 * it is still holding whatever sessions were opened on it — but nothing can
 * address it any more, because the only way to find a broker is the descriptor
 * that now names the other one.
 *
 * That is not a hypothetical. Two clients ask for a broker at the same moment
 * on every run of the Yam-on-Yam suite: the command line driving the packaged
 * application, and the application's *own* service, which reaches the same
 * broker through the same catalogue. It is why the outer session used to
 * vanish with `SESSION_NOT_FOUND` "around the moment the application opens its
 * own inner session" — that moment is the first time the application's service
 * needs a broker, and so the first time two starters can race.
 *
 * ## How it is enforced
 *
 * `open(2)` with `O_CREAT | O_EXCL`, which the kernel makes atomic: exactly one
 * caller creates the file and every other gets `EEXIST`. The winner starts a
 * broker and publishes the descriptor; the losers wait for that descriptor
 * rather than starting a second one.
 *
 * A lock whose holder is gone is not a lock. It records the holder's pid, and a
 * lock naming a pid that is no longer alive is removed and retaken — otherwise
 * one crash would leave the machine unable to start a broker ever again.
 */
export interface StartLock {
  /** Give the lock up. Safe to call twice. */
  release(): void;
}

function lockPath(stateDir?: string): string {
  return join(stateDir ?? brokerStateDir(), "broker.lock");
}

/**
 * Take the exclusive right to start a broker, or answer that somebody else has
 * it. Never blocks: the caller decides whether to wait.
 */
export function acquireStartLock(stateDir?: string): StartLock | undefined {
  const dir = stateDir ?? brokerStateDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = lockPath(dir);
  const take = (): StartLock | undefined => {
    /*
     * `openSync` with `wx` is the atomic part — exactly one caller creates the
     * file — and the pid is written through the *same* descriptor before it is
     * closed. `writeFileSync(…, { flag: "wx" })` would do the same two steps,
     * and measured here it leaves a window in which the file exists and is
     * empty: a second caller that reads it in that window finds no pid, decides
     * the lock is the residue of a crash, removes it and takes it. Three of
     * five concurrent clients took the lock that way.
     */
    let fd;
    try {
      fd = openSync(path, "wx", 0o600);
    } catch {
      return undefined;
    }
    try {
      writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
    } finally {
      closeSync(fd);
    }
    let released = false;
    return {
      release(): void {
        if (released) return;
        released = true;
        try {
          unlinkSync(path);
        } catch {
          // Somebody cleared it as stale; there is nothing left to give up.
        }
      },
    };
  };

  const taken = take();
  if (taken !== undefined) return taken;

  /*
   * Held — but by whom? A lock naming a process that is gone is the residue of
   * a crash, and leaving it would make the machine permanently unable to start
   * a broker.
   *
   * An *unreadable* lock is not evidence of a crash. It is what a lock looks
   * like for the microseconds between its creation and its pid being written,
   * so a caller that reads one is asked to look again before concluding
   * anything. Only a lock that is still unreadable after that grace is broken.
   */
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let holder: number | undefined;
    try {
      holder = (JSON.parse(readFileSync(path, "utf8")) as { pid?: number }).pid;
    } catch {
      holder = undefined;
    }
    if (holder !== undefined) return isProcessAlive(holder) ? undefined : breakAndTake(path, take);
    if (!existsSync(path)) return take();
    sleepBriefly();
  }
  return breakAndTake(path, take);
}

/** Remove a lock whose holder is gone, and try once to take it. */
function breakAndTake(path: string, take: () => StartLock | undefined): StartLock | undefined {
  try {
    unlinkSync(path);
  } catch {
    // Somebody else got there first; the attempt below says so.
  }
  return take();
}

/**
 * Wait a few milliseconds without an `await`.
 *
 * `acquireStartLock` is synchronous because every one of its callers wants an
 * answer before it does anything else, and the wait here is bounded by twenty
 * turns of a microsecond-scale window.
 */
function sleepBriefly(): void {
  const until = Date.now() + 5;
  while (Date.now() < until) {
    // Spin: the window this covers is the gap between `open` and `write`.
  }
}

/** Whether a broker start is in progress in some other process. */
export function startLockHeld(stateDir?: string): boolean {
  const path = lockPath(stateDir);
  if (!existsSync(path)) return false;
  try {
    const holder = (JSON.parse(readFileSync(path, "utf8")) as { pid?: number }).pid;
    return holder !== undefined && isProcessAlive(holder);
  } catch {
    return false;
  }
}
