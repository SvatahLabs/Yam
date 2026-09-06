import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform } from "node:os";

export interface BrokerDescriptor {
  url: string;
  token: string;
  pid: number;
  startedAt: string;
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
