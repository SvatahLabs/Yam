/**
 * Waiting for the page, not an element (SF-11, SF-16).
 *
 * A reference is to something already on the screen, so `waitFor` could not wait
 * for the thing an agent most often waits for: what comes next.
 */
import { describe, expect, it } from "vitest";
import { DataError, PermissionError, SessionError, TimeoutError } from "../src/errors.js";
import type { AgentSurface } from "../src/surface.js";
import { isPageWait, waitForPage } from "../src/wait.js";

/** A surface whose URL, title and text change on a schedule of reads. */
function changing(after: number): AgentSurface {
  let reads = 0;
  const later = () => reads >= after;
  return {
    snapshot: async () => {
      reads += 1;
      return { ref: "r0", nodes: [], text: later() ? "- heading \"Dashboard\"" : "- heading \"Sign in\"", tokensEstimate: 1, hash: "h" };
    },
    read: async (kind: string) => {
      reads += 1;
      if (kind === "url") return later() ? "http://app.test/dashboard" : "http://app.test/login";
      return later() ? "Dashboard" : "Sign in";
    },
  } as unknown as AgentSurface;
}

describe("waitFor with no reference waits for the page", () => {
  it("knows a page wait when it sees one", () => {
    expect(isPageWait({ text: "Saved" })).toBe(true);
    expect(isPageWait({ state: "visible" })).toBe(false);
    expect(isPageWait(undefined)).toBe(false);
  });

  it("returns once the text, the URL and the title all hold", async () => {
    const result = await waitForPage(
      changing(4),
      { text: "Dashboard", url: "/dashboard", title: "Dash", timeoutMs: 5_000 },
      { adapter: "test", everyMs: 1 },
    );
    expect(result).toEqual({ ok: true });
  });

  it("says what it waited for and what it saw, as a timeout", async () => {
    const waiting = waitForPage(changing(1_000), { url: "/dashboard", timeoutMs: 20 }, { adapter: "test", everyMs: 1 });
    await expect(waiting).rejects.toBeInstanceOf(TimeoutError);
    await expect(waiting).rejects.toThrow(/a URL containing "\/dashboard" \(it is "http:\/\/app.test\/login"\)/);
  });

  it("refuses a wait that names nothing to wait for", async () => {
    await expect(waitForPage(changing(0), {}, { adapter: "test" })).rejects.toBeInstanceOf(DataError);
  });
});

describe("a wait says why it ended, and does not wait out what waiting cannot fix", () => {
  it("names the last read that failed when it times out", async () => {
    const gone = {
      read: async () => {
        throw new SessionError("The window has gone.");
      },
    } as unknown as AgentSurface;
    await expect(waitForPage(gone, { title: "Inbox", timeoutMs: 10 }, { adapter: "test", everyMs: 1 })).rejects.toThrow(
      /The last read failed: The window has gone\./,
    );
  });

  it("stops at once on a permission nobody has granted", async () => {
    const denied = {
      read: async () => {
        throw new PermissionError("Accessibility is not granted.");
      },
    } as unknown as AgentSurface;
    await expect(waitForPage(denied, { title: "Inbox", timeoutMs: 60_000 }, { adapter: "test" })).rejects.toBeInstanceOf(
      PermissionError,
    );
  });

  it("takes the adapter's own timeout when the caller gives none, and never says NaN", async () => {
    const started = Date.now();
    const waiting = waitForPage(changing(1_000), { url: "/x", timeoutMs: "soon" as never }, { adapter: "test", everyMs: 1, defaultTimeoutMs: 20 });
    await expect(waiting).rejects.not.toThrow(/NaN/);
    const quick = waitForPage(changing(1_000), { url: "/x" }, { adapter: "test", everyMs: 1, defaultTimeoutMs: 20 });
    await expect(quick).rejects.toThrow(/Waited 20 ms/);
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});
