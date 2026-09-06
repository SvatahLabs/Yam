#!/usr/bin/env node
/**
 * Fetch axe-core at test time, outside the dependency tree (T10.4, P9-F3,
 * Draft 2.12 §13.7).
 *
 *   node scripts/fetch-axe.mjs            # print the path, downloading if needed
 *   node scripts/fetch-axe.mjs --print    # the same; the path is all it writes
 *
 * > CI fetches axe-core at test time, outside the dependency tree, to run beside
 * > it; a rule axe reports and the audit does not is a defect in the audit.
 *
 * ## Why it is fetched rather than depended on
 *
 * axe-core is **MPL-2.0** and REQ-PKG-3 admits MIT, Apache-2.0 and BSD only;
 * `scripts/check-licenses.mjs` refuses MPL by name. Adding it to any
 * `package.json` would fail that check, and disabling the check to run an
 * accessibility tool would be a worse trade than fetching one file.
 *
 * So this downloads a *pinned* build to the system temporary directory — never
 * into the repository, never into `node_modules` — and refuses anything whose
 * SHA-256 is not the one recorded here. A pinned digest is what makes a network
 * fetch reproducible: the file that runs is the file this repository was tested
 * against, or nothing runs at all.
 *
 * ## What happens without a network
 *
 * It exits 3 and says so. The caller — `tools/repo-checks/test/sheet-audit.test.ts`
 * — skips the axe half loudly, because a verifier working offline should be told
 * that the third-party confirmation did not run rather than shown a green suite
 * that quietly did less.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The build this repository is tested against (the Phase 9 verification's). */
export const AXE_VERSION = "4.10.3";
export const AXE_SHA256 = "880970c081707360e64f34cea25ff91892f5bc95675b0776925b9709dd8a68bb";
const AXE_URL = `https://cdn.jsdelivr.net/npm/axe-core@${AXE_VERSION}/axe.min.js`;

/** Outside the repository and outside `node_modules`, by name and by place. */
export function axePath() {
  return join(tmpdir(), "svatah-axe-core", `axe-${AXE_VERSION}.min.js`);
}

const digestOf = (text) => createHash("sha256").update(text, "utf8").digest("hex");

/**
 * The pinned axe-core, downloading it once per machine.
 *
 * Throws with a readable reason when there is no network or when the bytes are
 * not the pinned ones; the caller decides whether that is a skip or a failure.
 */
export async function ensureAxe() {
  const path = axePath();
  if (existsSync(path)) {
    const cached = readFileSync(path, "utf8");
    if (digestOf(cached) === AXE_SHA256) return path;
    // A truncated or tampered cache is re-fetched rather than trusted.
  }

  let response;
  try {
    response = await fetch(AXE_URL, { redirect: "follow" });
  } catch (cause) {
    throw new Error(
      `Could not reach ${AXE_URL}: ${cause instanceof Error ? cause.message : String(cause)}`,
    );
  }
  if (!response.ok) throw new Error(`${AXE_URL} answered ${response.status}.`);

  const text = await response.text();
  const digest = digestOf(text);
  if (digest !== AXE_SHA256) {
    throw new Error(
      `${AXE_URL} is not the pinned build: expected SHA-256 ${AXE_SHA256}, got ${digest}. ` +
        "The pin is what makes this fetch reproducible; update it deliberately or not at all.",
    );
  }

  mkdirSync(join(tmpdir(), "svatah-axe-core"), { recursive: true });
  // Written whole, so two test files racing leave no half a file behind.
  const staging = `${path}.${process.pid}.tmp`;
  writeFileSync(staging, text, "utf8");
  renameSync(staging, path);
  return path;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(`${await ensureAxe()}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(3);
  }
}
