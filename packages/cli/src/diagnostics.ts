/**
 * The diagnostics that name the next verb (T14.4, REQ-CLI-5, LLD §15.1).
 *
 * Every row is a condition a newcomer can reach, one sentence, and the verb
 * that resolves it. A command prints a row on stderr as `message → next`, or
 * as `{ code, message, next }` on stdout under `--json`. The catalogue is the
 * one place these words live, and a test produces every row from the real
 * condition.
 */
import { boolOption, type CommandIo, type ParsedArgs } from "@svatah/yam-bindings-cli";

export interface Diagnostic {
  readonly code: DiagnosticCode;
  readonly message: string;
  readonly next: string;
}

const CATALOGUE = {
  "no-project": () => ({ message: "No Yam project here.", next: "yam init" }),
  "no-flows": () => ({ message: "The project has no flows yet.", next: "write one under flows/; `yam help flows` shows how" }),
  "unbound-target": (phrase: string, id: string) => ({ message: `No binding for \`${phrase}\` (${id}).`, next: "yam record" }),
  "stale-plan": () => ({ message: "The plan is older than the flows.", next: "yam check" }),
  "no-plan": () => ({ message: "There is no plan yet.", next: "yam check" }),
  "secret-unset": (path: string, variable: string) => ({
    message: `\`${path}\` reads \`$${variable}\`, which is not set.`,
    next: `export ${variable}=… before the step that needs it`,
  }),
  "no-browser": (which: string) => ({ message: `No ${which} for Playwright.`, next: `npx playwright install ${which.toLowerCase()}` }),
  "host-not-ready": (line: string, adapter: string) => ({ message: line, next: `yam surface doctor --adapter ${adapter}` }),
  "no-display": () => ({
    message: "Recording as a person needs a terminal and a display.",
    next: "--gateway fake, or a model credential",
  }),
  "cannot-pick": (adapter: string) => ({
    message: `The ${adapter} adapter cannot take a click.`,
    next: "--gateway anthropic, or re-pick after a model's proposal",
  }),
  "cannot-resume": () => ({ message: "The plan or the bindings changed since the checkpoint.", next: "yam run, without --resume" }),
  "not-idempotent": (story: string) => ({
    message: `\`${story}\` is not marked idempotent and this is production.`,
    next: "--allow-side-effects to run it anyway, or `story (idempotent=true): …` in the flow if running it twice is the same as once",
  }),
} as const;

export type DiagnosticCode = keyof typeof CATALOGUE;

/** A row of the catalogue, with its parameters filled in. */
export function diagnostic<C extends DiagnosticCode>(code: C, ...params: Parameters<(typeof CATALOGUE)[C]>): Diagnostic {
  const row = (CATALOGUE[code] as (...args: string[]) => { message: string; next: string })(...(params as string[]));
  return { code, ...row };
}

/** Print a row the way the command's output mode wants it. */
export function say(io: CommandIo, args: ParsedArgs, one: Diagnostic): void {
  if (boolOption(args, "json")) io.out(JSON.stringify(one));
  else io.err(`${one.message} → ${one.next}`);
}

/** Every row with example parameters, for the vocabulary check and the docs. */
export const DIAGNOSTICS: readonly Diagnostic[] = [
  diagnostic("no-project"),
  diagnostic("no-flows"),
  diagnostic("unbound-target", "the username field", "login.username-field"),
  diagnostic("stale-plan"),
  diagnostic("no-plan"),
  diagnostic("secret-unset", "user.password", "YAM_INPUT_PASSWORD"),
  diagnostic("no-browser", "Chromium"),
  diagnostic("host-not-ready", "ax/accessibility refused", "ax"),
  diagnostic("no-display"),
  diagnostic("cannot-pick", "http"),
  diagnostic("cannot-resume"),
  diagnostic("not-idempotent", "Book a slot"),
];

/** The `${NAME}` a data path reads, out of the lint's own warning text. */
export function secretVariable(warning: string): { path: string; variable: string } | undefined {
  const match = /^(\S+) reads \$\{?([A-Za-z_][A-Za-z0-9_]*)\}?, which is not set/.exec(warning);
  return match === null ? undefined : { path: match[1]!, variable: match[2]! };
}
