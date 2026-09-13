/**
 * T05 — Broker discovery and session lifecycle (SF-04, SF-05, SF-13, SF-15).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import {
  acquireStartLock,
  brokerStateDir,
  discoverBroker,
  generateToken,
  readBrokerDescriptor,
  removeBrokerDescriptor,
  type BrokerDescriptor,
  writeBrokerDescriptor,
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

/*
 * A broker that is not the machine's (`YAM_BROKER_STATE_DIR`).
 *
 * "One broker per machine" is the product's property and is the default. The
 * escape hatch exists because this repository's own suites run several packages
 * concurrently against the machine's single broker, and a session opened by one
 * package's test could be closed by another's — `SESSION_NOT_FOUND` about one
 * full-suite run in three, in whichever package drew the short straw. A shared
 * mutable fixture that nothing declares is a defect in the layout.
 */
describe("the state directory can be stated (YAM_BROKER_STATE_DIR)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the stated directory when one is given", () => {
    vi.stubEnv("YAM_BROKER_STATE_DIR", "/tmp/a-broker-of-my-own");
    expect(brokerStateDir()).toBe("/tmp/a-broker-of-my-own");
  });

  it("falls back to the machine's when it is unset or empty", () => {
    vi.stubEnv("YAM_BROKER_STATE_DIR", "");
    const machine = brokerStateDir();
    expect(machine).not.toBe("");
    expect(machine).toContain("yam");
    vi.stubEnv("YAM_BROKER_STATE_DIR", "   ");
    expect(brokerStateDir()).toBe(machine);
  });

  it("puts the descriptor and the lock in the same place", () => {
    vi.stubEnv("YAM_BROKER_STATE_DIR", tmpDir);
    const lock = acquireStartLock();
    try {
      expect(lock, "the lock could not be taken in the stated directory").toBeDefined();
      expect(existsSync(join(tmpDir, "broker.lock"))).toBe(true);
    } finally {
      lock?.release();
    }
  });
});
