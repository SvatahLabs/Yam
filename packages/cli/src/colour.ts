/**
 * How an ordinary command says a status word (TV-C03, TV-17).
 *
 * The same tone, the same colour, the same capability detection as `yam ui` —
 * from `@svatah/yam-ui-tokens`, which both read — because `yam run` printing one
 * green and the cockpit printing another would be two products wearing one name.
 *
 * And the same rule: a tone never arrives without its word. `paint` wraps what
 * the caller already wrote; there is no way to ask this file for a colour on its
 * own, which is what stops one being used instead of saying something.
 */
import { capabilitiesOf, depthFor, tone, type ColourDepth, type StatusTone } from "@svatah/yam-ui-tokens";

/** How much colour this process should send. Measured once, per process. */
export function depthOf(
  stdout: { isTTY?: boolean } = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
  asked = env["YAM_COLOR"],
): ColourDepth {
  return depthFor(capabilitiesOf(stdout, env), asked);
}

let depth: ColourDepth | undefined;

/** A status word, in the colour the design system gives that tone. */
export function paint(what: StatusTone, text: string): string {
  depth ??= depthOf();
  return tone(what, text, depth);
}

/** For a test that wants to state a terminal rather than be run in one. */
export function withDepth(next: ColourDepth | undefined): void {
  depth = next;
}
