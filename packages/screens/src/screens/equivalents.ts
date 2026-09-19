/**
 * Copy command and Copy MCP call — the inspector's form as something to run
 * elsewhere (T15, SF-03, SF-06, SF-07, SF-15).
 *
 * The palette has always shown each action's `cli`, and that is a *template*:
 * `yam surface act --session <id> --action <action> --ref <ref>`. A person who
 * has just filled a form in the inspector wants the line with their session,
 * their control and their value in it, and an agent author wants the same act
 * as the `tools/call` their client would send. Both are generated here from the
 * form's live values, so the two can never describe different acts.
 *
 * Three things make a copied line honest rather than merely plausible:
 *
 * 1. **Arguments never meet the shell.** They go through `--input -` from a
 *    quoted heredoc, which expands nothing — the same reason `--input` exists
 *    at all (SF-06): a value with quotes, `$` or a newline survives exactly.
 * 2. **A reference expires.** It belongs to the snapshot it was chosen from and
 *    is refused as stale once the page has moved on (SF-10); the notes say so,
 *    because a line copied now and run in an hour is a different request.
 * 3. **A secret is never written down** (SF-15). A value typed into a password
 *    field is read from an environment variable on the command line, and is a
 *    placeholder in the MCP call listed under `secrets`, so pasting either into
 *    a ticket, a chat or a shell history leaks nothing.
 *
 * Pure, and with no idea of a clipboard: the renderer copies what this returns.
 */

/** The environment variable a copied command reads a secret from. */
export const SECRET_VARIABLE = "YAM_SECRET";

/** What stands for the secret in a copied MCP call, in `args` and in `secrets`. */
export const SECRET_PLACEHOLDER = `<${SECRET_VARIABLE}>`;

/** The argument a secret is typed as: the one `withholdSecrets` withholds (SF-15). */
const SECRET_ARGUMENT = "value";

/** What the inspector's form holds at the moment Copy is pressed. */
export interface ActionCommandInput {
  readonly session: string;
  /** The catalogue's action name: `type`, not "Fill field". */
  readonly action: string;
  /** The selected control, when the action acts on one. */
  readonly ref?: string;
  /** The second control, for `dragTo`. */
  readonly ref2?: string;
  /** The form's fields, as typed. An empty field is left out, never sent empty. */
  readonly args?: Readonly<Record<string, unknown>>;
  /** The snapshot the reference was chosen from (SF-10). */
  readonly snapshotId?: string;
  /**
   * Whether the selected control is a password field (SF-15).
   *
   * `SurfaceElementView.secret`, from what `describe` said about it. When it is
   * true the value is withheld from both outputs, whatever was typed.
   */
  readonly secret?: boolean;
  /** Who holds the target, when somebody does (SF-13). */
  readonly holder?: string;
  /** Whether a postcondition was chosen, which is a second call neither line makes. */
  readonly verify?: boolean;
}

export interface ActionCommands {
  /** A POSIX shell command: `bash`, `zsh`, `sh`. */
  readonly cli: string;
  /** A JSON-RPC `tools/call` for `surface_act`, as an MCP client sends it. */
  readonly mcp: string;
  /** What a person has to know before running either, one sentence each. */
  readonly notes: readonly string[];
}

/** Characters a shell word may carry without quoting. Anything else is quoted. */
const PLAIN_WORD = /^[A-Za-z0-9_./:@%+=,-]+$/;

/** One shell word, single-quoted when it needs to be. */
export function shellWord(value: string): string {
  if (value !== "" && PLAIN_WORD.test(value)) return value;
  // Inside single quotes nothing is special but the quote itself, which ends
  // the quoting, is escaped, and starts it again.
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** The form's fields without the empty ones: an optional field left blank is not an argument. */
function argumentsOf(args: Readonly<Record<string, unknown>> | undefined): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(args ?? {}).filter(
      ([, value]) => value !== undefined && value !== null && !(typeof value === "string" && value === ""),
    ),
  );
}

/**
 * The command line and the MCP call for one act, and what to know about them.
 *
 * `cli` is what `yam surface act` would be given to do what **Act** does; `mcp`
 * is the `surface_act` call an agent's client would send. Neither includes the
 * postcondition, which is a separate `check`, and the notes say so when one
 * was chosen.
 */
export function actionCommands(input: ActionCommandInput): ActionCommands {
  const given = argumentsOf(input.args);
  /*
   * Withheld when the control is a password field and there is a value to type
   * into it — or will be, for `type`, whose value is required. A click on a
   * password field carries nothing secret and says nothing about secrets.
   */
  const withhold =
    input.secret === true && (input.action === "type" || given[SECRET_ARGUMENT] !== undefined);
  const { [SECRET_ARGUMENT]: _secret, ...rest } = given;
  const shown = withhold ? rest : given;
  const refs = [input.ref, input.ref2].filter((one): one is string => one !== undefined && one !== "");

  /* ── the command line ─────────────────────────────────────────────────── */

  const flags = [
    "yam surface act",
    `--session ${shellWord(input.session)}`,
    `--action ${shellWord(input.action)}`,
    ...(input.ref === undefined || input.ref === "" ? [] : [`--ref ${shellWord(input.ref)}`]),
    ...(input.ref2 === undefined || input.ref2 === "" ? [] : [`--ref2 ${shellWord(input.ref2)}`]),
    // The snapshot scopes a reference; with no reference it scopes nothing.
    ...(input.snapshotId === undefined || refs.length === 0 ? [] : [`--snapshot ${shellWord(input.snapshotId)}`]),
  ].join(" ");

  let cli: string;
  if (withhold) {
    /*
     * The value is assembled inside the pipeline from the environment, so it is
     * in no file, no heredoc and no history. `node` is the runtime `yam` itself
     * runs on, so it is there wherever this command can run; the other
     * arguments are a JSON literal in single quotes, which the shell does not
     * expand. `--secret` tells the broker which value to withhold from results
     * and events; it is the command line's only way to say so.
     */
    const script =
      `process.stdout.write(JSON.stringify(Object.assign(${JSON.stringify(rest)}, ` +
      `{ ${SECRET_ARGUMENT}: process.env.${SECRET_VARIABLE} })))`;
    cli = [
      `: "\${${SECRET_VARIABLE}:?set ${SECRET_VARIABLE} to the value first; it is not written in this command}"`,
      `${SECRET_VARIABLE}="$${SECRET_VARIABLE}" node -e ${shellWord(script)} \\`,
      `  | ${flags} --input - --secret "$${SECRET_VARIABLE}"`,
    ].join("\n");
  } else if (Object.keys(shown).length === 0) {
    cli = flags;
  } else {
    /*
     * A quoted delimiter (`<<'JSON'`) expands nothing, and `JSON.stringify`
     * writes one line with every newline escaped — so no line of the body can
     * be the delimiter, and no character of it can reach the shell.
     */
    cli = `${flags} --input - <<'JSON'\n${JSON.stringify(shown)}\nJSON`;
  }

  /* ── the MCP call ─────────────────────────────────────────────────────── */

  const mcpArgs = withhold ? { ...rest, [SECRET_ARGUMENT]: SECRET_PLACEHOLDER } : given;
  const mcp = JSON.stringify(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "surface_act",
        arguments: {
          session: input.session,
          action: input.action,
          ...(input.ref === undefined || input.ref === "" ? {} : { ref: input.ref }),
          ...(input.ref2 === undefined || input.ref2 === "" ? {} : { ref2: input.ref2 }),
          ...(Object.keys(mcpArgs).length === 0 ? {} : { args: mcpArgs }),
          ...(withhold ? { secrets: [SECRET_PLACEHOLDER] } : {}),
        },
      },
    },
    null,
    2,
  );

  /* ── what to know ─────────────────────────────────────────────────────── */

  const notes: string[] = [];
  if (refs.length > 0) {
    const named = refs.join(" and ");
    notes.push(
      input.snapshotId === undefined
        ? `The reference ${named} belongs to the snapshot it was chosen from and expires when the page changes; after that the act is refused as stale. Take a new snapshot and use its reference.`
        : `The reference ${named} belongs to snapshot ${input.snapshotId} and expires when the page changes; after that the act is refused as stale, never aimed at whatever is there now. Take a new snapshot and use its reference.`,
    );
    notes.push(
      "`surface_act` names no snapshot: the MCP call is accepted while a snapshot of the page as it is now contains the reference.",
    );
  }
  if (withhold) {
    notes.push(
      `The control is a password field, so its value is in neither. The command reads it from ${SECRET_VARIABLE} (set it first, for example with \`read -rs ${SECRET_VARIABLE}\`) and marks it with --secret; the MCP call has ${SECRET_PLACEHOLDER} in args.value and in secrets — put the value in both.`,
    );
  }
  if (input.holder !== undefined) {
    notes.push(
      `${input.holder} holds this target, so the act is refused from anyone else until control is given up (SF-13).`,
    );
  }
  if (input.verify === true) {
    notes.push(
      "The postcondition is not included: it is a separate call, `yam surface check` or `surface_check`.",
    );
  }
  if (cli.includes("\n") || cli.includes("'")) {
    notes.push("The command is for a POSIX shell (bash, zsh, sh): cmd and PowerShell have neither the heredoc nor the quoting.");
  }

  return { cli, mcp, notes };
}
