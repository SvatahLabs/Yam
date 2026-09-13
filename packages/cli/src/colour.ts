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
import {
  appearanceOf,
  capabilitiesOf,
  depthFor,
  tone,
  type ColourDepth,
  type StatusTone,
  type Theme,
} from "@svatah/yam-ui-tokens";

/** How much colour this process should send. Measured once, per process. */
export function depthOf(
  stdout: { isTTY?: boolean } = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
  asked = env["YAM_COLOR"],
): ColourDepth {
  return depthFor(capabilitiesOf(stdout, env), asked);
}

let depth: ColourDepth | undefined;
let appearance: Theme | undefined;

/**
 * A status word, in the colour the design system gives that tone — for the
 * theme this terminal is on (`EX-02`).
 *
 * The cockpit learned to read `YAM_THEME` and `COLORFGBG`, and this did not: so
 * `yam ui` drew the light palette on a light terminal and `yam run`, one command
 * later, drew the dark one. Two products wearing one name is the thing this file
 * exists to prevent, and it was doing it in the other direction.
 */
export function paint(what: StatusTone, text: string): string {
  depth ??= depthOf();
  appearance ??= appearanceOf(process.env);
  return tone(what, text, depth, appearance);
}

/** For a test that wants to state a terminal rather than be run in one. */
export function withDepth(next: ColourDepth | undefined, theme?: Theme): void {
  depth = next;
  appearance = theme;
}
