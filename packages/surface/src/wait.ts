/**
 * Waiting for the page rather than for an element (SF-11, SF-16).
 *
 * `waitFor` took a reference, and a reference is to something already on the
 * screen, so the thing an agent most often waits for — the next page's heading,
 * the URL after a sign-in, a "Saved" that has not appeared yet — could not be
 * waited for at all. With no reference, `waitFor` waits for the surface:
 *
 * | argument | holds when |
 * |---|---|
 * | `text` (or `value`) | the surface's text contains it |
 * | `url` | the URL contains it |
 * | `title` | the title contains it |
 *
 * Every one given has to hold. One helper, so every adapter means the same thing
 * by it; an adapter passes `textOf` when it has a cheaper and truer reading of
 * its text than a snapshot's rendering — a browser's `innerText`.
 */
import type { ActArgs, ActResult } from "@svatah/yam-schema";
import { DataError, PermissionError, TimeoutError, UnsupportedError } from "./errors.js";
import type { AgentSurface } from "./surface.js";

/** How long a page wait waits when the caller does not say. */
export const DEFAULT_PAGE_WAIT_MS = 10_000;

export interface PageWaitOptions {
  /** The adapter's name, for the errors. */
  readonly adapter: string;
  /** The surface's text; its snapshot's rendering when not given. */
  readonly textOf?: () => Promise<string>;
  readonly everyMs?: number;
  /** The adapter's own action timeout, when `args.timeoutMs` does not say. */
  readonly defaultTimeoutMs?: number;
}

/** Whether `args` ask for a page wait at all. */
export function isPageWait(args: ActArgs | undefined): boolean {
  return ["text", "value", "url", "title"].some((key) => typeof args?.[key] === "string");
}

export async function waitForPage(
  surface: AgentSurface,
  args: ActArgs | undefined,
  options: PageWaitOptions,
): Promise<ActResult> {
  const text = typeof args?.["text"] === "string" ? args["text"] : typeof args?.["value"] === "string" ? args["value"] : undefined;
  const url = typeof args?.["url"] === "string" ? args["url"] : undefined;
  const title = typeof args?.["title"] === "string" ? args["title"] : undefined;
  if (text === undefined && url === undefined && title === undefined) {
    throw new DataError(
      "The waitFor action needs a reference to wait on an element, or `text`, `url` or `title` to " +
        "wait on the page.",
      { adapter: options.adapter },
    );
  }
  const fallback = options.defaultTimeoutMs ?? DEFAULT_PAGE_WAIT_MS;
  const asked = Number(args?.["timeoutMs"] ?? fallback);
  const timeoutMs = Number.isFinite(asked) && asked >= 0 ? asked : fallback;
  const deadline = Date.now() + timeoutMs;
  const every = options.everyMs ?? 200;
  const textOf = options.textOf ?? (async () => (await surface.snapshot()).text);
  const seen: { text?: string; url?: string; title?: string } = {};
  let lastError: unknown;

  /*
   * A read that fails is "not yet" — a page mid-navigation — but only for so
   * long, and never silently. A window that has gone, or a permission that was
   * revoked, used to look exactly like a slow page: the wait swallowed every
   * error and timed out saying the title was "". The last error is kept for the
   * timeout's message, and one that no amount of waiting fixes ends the wait.
   */
  const asking = async <T>(read: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await read();
    } catch (error) {
      if (error instanceof PermissionError || error instanceof UnsupportedError) throw error;
      lastError = error;
      return fallback;
    }
  };

  for (;;) {
    const holds: boolean[] = [];
    if (text !== undefined) {
      seen.text = await asking(textOf, "");
      holds.push(seen.text.includes(text));
    }
    if (url !== undefined) {
      seen.url = String((await asking(() => surface.read("url"), "")) ?? "");
      holds.push(seen.url.includes(url));
    }
    if (title !== undefined) {
      seen.title = String((await asking(() => surface.read("title"), "")) ?? "");
      holds.push(seen.title.includes(title));
    }
    if (holds.every(Boolean)) return { ok: true };
    if (Date.now() >= deadline) {
      const wanted = [
        text === undefined ? undefined : `the text "${text}"`,
        url === undefined ? undefined : `a URL containing "${url}" (it is ${JSON.stringify(seen.url)})`,
        title === undefined ? undefined : `a title containing "${title}" (it is ${JSON.stringify(seen.title)})`,
      ].filter((one) => one !== undefined);
      const because =
        lastError === undefined
          ? ""
          : ` The last read failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`;
      throw new TimeoutError(
        `Waited ${timeoutMs} ms for ${wanted.join(" and ")}, and it did not come.${because}`,
        { adapter: options.adapter, timeoutMs, ...(lastError === undefined ? {} : { cause: lastError }) },
      );
    }
    await new Promise<void>((done) => setTimeout(done, every));
  }
}
