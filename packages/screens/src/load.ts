/**
 * The small things every `load()` does the same way (T9.1, LLD §13.7).
 *
 * A screen's `load` is "call the service, turn the answers into rows". Two
 * details are worth having in one place rather than twelve:
 *
 * 1. **A failed call is state, not an exception.** A renderer that had to catch
 *    would be a renderer with logic in it; the mockups draw a failed load as an
 *    alert on the screen, which is a value. `collect()` records what it asked
 *    for and what refused.
 * 2. **The screen rule is visible.** Every state carries `sources`: the
 *    endpoints it was built from, in call order (§13.6's "every screen renders a
 *    service response or a project file and nothing the CLI cannot produce").
 *    `svatah ui --json` prints them, so an agent reading the model can see where
 *    each number came from.
 */
import type { ScreenStateBase } from "./types.js";

/** Collects the endpoints a load touched and the first thing that went wrong. */
export class Sources {
  private readonly names: string[] = [];
  private failure: string | undefined;

  /**
   * Call one endpoint, record its name, and answer with `fallback` if it threw.
   *
   * The fallback matters: a project whose `runs/` is empty answers 404 for a
   * run, and a screen that showed nothing at all would be indistinguishable
   * from a screen that could not reach the service.
   */
  async get<T>(name: string, call: () => Promise<unknown>, fallback: T): Promise<T> {
    this.names.push(name);
    try {
      const value = await call();
      return (value ?? fallback) as T;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      this.failure ??= `${name} failed: ${message}`;
      return fallback;
    }
  }

  /** Like `get`, but a 404 is an expected answer and not a failure. */
  async optional<T>(name: string, call: () => Promise<unknown>, fallback: T): Promise<T> {
    this.names.push(name);
    try {
      return ((await call()) ?? fallback) as T;
    } catch {
      return fallback;
    }
  }

  base(
    screen: ScreenStateBase["screen"],
    title: string,
    subtitle: string,
    status: string,
  ): ScreenStateBase {
    return {
      screen,
      title,
      subtitle,
      status,
      sources: [...this.names],
      ...(this.failure === undefined ? {} : { error: this.failure }),
    };
  }
}

/** `["a", "b"]` → `"a · b"`, dropping the empties. The mockups' subtitle style. */
export const dotted = (...parts: ReadonlyArray<string | undefined>): string =>
  parts.filter((one) => one !== undefined && one !== "").join(" · ");

/** `1`/`2` → `"1 story"`/`"2 stories"`. */
export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`;
