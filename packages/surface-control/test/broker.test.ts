/**
 * T05 — Broker discovery and session lifecycle (SF-04, SF-05, SF-13, SF-15).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import {
  generateToken,
  writeBrokerDescriptor,
  readBrokerDescriptor,
  removeBrokerDescriptor,
  discoverBroker,
  type BrokerDescriptor,
} from "../src/broker.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "yam-broker-test-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("generateToken", () => {
  it("returns a 32-character hex string", () => {
    const token = generateToken();
    expect(token).toMatch(/^[a-f0-9]{32}$/);
  });

  it("returns unique values", () => {
    const tokens = new Set(Array.from({ length: 100 }, generateToken));
    expect(tokens.size).toBe(100);
  });
});

describe("broker descriptor", () => {
  const descriptor: BrokerDescriptor = {
    url: "http://127.0.0.1:9876",
    token: generateToken(),
    pid: process.pid,
    startedAt: new Date().toISOString(),
  };

  it("writes and reads a descriptor", () => {
    writeBrokerDescriptor(descriptor, tmpDir);
    const read = readBrokerDescriptor(tmpDir);
    expect(read).toEqual(descriptor);
  });

  it("creates the directory with owner-only permissions", () => {
    const subDir = join(tmpDir, "nested", "state");
    writeBrokerDescriptor(descriptor, subDir);
    if (platform() !== "win32") {
      const stats = statSync(subDir);
      expect(stats.mode & 0o777).toBe(0o700);
    }
  });

  it("writes the file with owner-only permissions", () => {
    writeBrokerDescriptor(descriptor, tmpDir);
    if (platform() !== "win32") {
      const stats = statSync(join(tmpDir, "broker.json"));
      expect(stats.mode & 0o777).toBe(0o600);
    }
  });

  it("returns undefined when no descriptor exists", () => {
    expect(readBrokerDescriptor(tmpDir)).toBeUndefined();
  });

  it("removes a descriptor", () => {
    writeBrokerDescriptor(descriptor, tmpDir);
    removeBrokerDescriptor(tmpDir);
    expect(readBrokerDescriptor(tmpDir)).toBeUndefined();
  });

  it("remove is idempotent", () => {
    removeBrokerDescriptor(tmpDir);
    expect(() => removeBrokerDescriptor(tmpDir)).not.toThrow();
  });
});

describe("discoverBroker", () => {
  it("discovers a running broker", () => {
    const descriptor: BrokerDescriptor = {
      url: "http://127.0.0.1:9876",
      token: generateToken(),
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };
    writeBrokerDescriptor(descriptor, tmpDir);
    const found = discoverBroker(tmpDir);
    expect(found).toEqual(descriptor);
  });

  it("cleans up a stale descriptor from a dead process", () => {
    const descriptor: BrokerDescriptor = {
      url: "http://127.0.0.1:9876",
      token: generateToken(),
      pid: 999999999,
      startedAt: new Date().toISOString(),
    };
    writeBrokerDescriptor(descriptor, tmpDir);
    const found = discoverBroker(tmpDir);
    expect(found).toBeUndefined();
    expect(existsSync(join(tmpDir, "broker.json"))).toBe(false);
  });

  it("returns undefined when no descriptor exists", () => {
    expect(discoverBroker(tmpDir)).toBeUndefined();
  });
});
