/**
 * The terminal the cockpit borrows, and gives back (TV-T02, TV-03).
 *
 * `yam ui` drew into the scrollback: it rendered inline, so the shell prompt
 * stayed above it, the frame scrolled with history, and quitting left the last
 * frame behind like output. A cockpit is not output. This enters the alternate
 * screen, hides the cursor, turns on mouse reporting, and puts every one of
 * those back — on quit, on `SIGINT`, `SIGTERM` and `SIGHUP`, and on a throw
 * nobody caught.
 *
 * ## Restore is idempotent, and that is not fussiness
 *
 * The TV-T00 spike wrote the restore sequence twice, from `process.on("exit")`
 * and from the line after `waitUntilExit()`. Two resets are invisible on a good
 * day; on a bad one — a slow pipe, a terminal mid-redraw — they are a second
 * escape sequence arriving after the shell has drawn its prompt. So `restore()`
 * runs once whatever calls it.
 *
 * There is no Ink here and no React: this is `write` and `process`, so a test
 * can drive it against a fake stream and assert the bytes.
 */

/** What a terminal can do, as far as it will admit. */
export interface Capabilities {
  /** 24-bit colour, from `COLORTERM`. */
  readonly truecolor: boolean;
  /** 256 colours, from a `-256color` terminal name. */
  readonly ansi256: boolean;
  /** Colour at all: `NO_COLOR` and a pipe both mean no. */
  readonly colour: boolean;
  /** Mouse reporting is worth enabling. */
  readonly mouse: boolean;
}

const ALT_ON = "\u001b[?1049h";
const ALT_OFF = "\u001b[?1049l";
const CURSOR_OFF = "\u001b[?25l";
const CURSOR_ON = "\u001b[?25h";
/** X11 button events plus SGR extended coordinates, which is what a wide terminal needs. */
const MOUSE_ON = "\u001b[?1000h\u001b[?1006h";
const MOUSE_OFF = "\u001b[?1006l\u001b[?1000l";

export interface OwnOptions {
  readonly stdout?: NodeJS.WriteStream;
  readonly env?: NodeJS.ProcessEnv;
  /** Off for `--json` and for a capture that wants the frame in the scrollback. */
  readonly mouse?: boolean;
}

/**
 * What this terminal can do (TV-05).
 *
 * `COLORTERM` is the only reliable statement a terminal makes about 24-bit
 * colour, and `NO_COLOR` is the only reliable statement a *person* makes about
 * wanting none. Neither is guessed at: a wrong guess about colour is a frame
 * somebody cannot read, and `--color` overrides both.
 */
export function capabilitiesOf(
  stdout: NodeJS.WriteStream | undefined = process.stdout,
  env: NodeJS.ProcessEnv = process.env,
): Capabilities {
  const tty = stdout?.isTTY === true;
  const noColour = env["NO_COLOR"] !== undefined && env["NO_COLOR"] !== "";
  const term = env["TERM"] ?? "";
  const colorterm = env["COLORTERM"] ?? "";
  const truecolor = /truecolor|24bit/i.test(colorterm);
  const ansi256 = truecolor || /-256color|^xterm-kitty$|^alacritty/.test(term);
  return {
    truecolor: tty && !noColour && truecolor,
    ansi256: tty && !noColour && ansi256,
    colour: tty && !noColour && term !== "dumb",
    mouse: tty && term !== "dumb",
  };
}

/** A terminal the cockpit has taken, and the one call that gives it back. */
export interface Owned {
  readonly restore: () => void;
  readonly capabilities: Capabilities;
}

const SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;
/** A shell expects 128 + the signal; exiting 0 would report a run that did not finish. */
const CODES: Readonly<Record<(typeof SIGNALS)[number], number>> = {
  SIGINT: 130,
  SIGTERM: 143,
  SIGHUP: 129,
};

/**
 * Take the terminal, and answer with the way back.
 *
 * The handlers are registered here rather than by the caller because the caller
 * is a React tree, and a React tree that has crashed is not in a position to
 * clean up after itself.
 */
export function own(options: OwnOptions = {}): Owned {
  const stdout = options.stdout ?? process.stdout;
  const capabilities = capabilitiesOf(stdout, options.env ?? process.env);
  const wantsMouse = (options.mouse ?? true) && capabilities.mouse;
  const isTty = stdout.isTTY === true;

  if (isTty) stdout.write(ALT_ON + CURSOR_OFF + (wantsMouse ? MOUSE_ON : ""));

  const handlers: Partial<Record<(typeof SIGNALS)[number], () => void>> = {};
  let restored = false;

  const restore = (): void => {
    if (restored) return;
    restored = true;
    if (isTty) stdout.write((wantsMouse ? MOUSE_OFF : "") + CURSOR_ON + ALT_OFF);
    process.off("exit", onExit);
    process.off("uncaughtException", onThrow);
    for (const signal of SIGNALS) {
      const handler = handlers[signal];
      if (handler !== undefined) process.off(signal, handler);
    }
  };

  const onExit = (): void => restore();
  /*
   * A throw nobody caught. Without this the terminal keeps the alternate screen
   * and a hidden cursor, and the stack trace is printed into a buffer the shell
   * is about to discard — so a person sees a dead terminal and no reason for it.
   */
  const onThrow = (error: unknown): void => {
    restore();
    // eslint-disable-next-line no-console -- the frame is gone; this is stderr now.
    console.error(error);
    process.exit(1);
  };

  for (const signal of SIGNALS) {
    handlers[signal] = (): void => {
      restore();
      process.exit(CODES[signal]);
    };
    process.on(signal, handlers[signal]!);
  }
  process.on("exit", onExit);
  process.on("uncaughtException", onThrow);

  return { restore, capabilities };
}
