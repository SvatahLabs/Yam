/**
 * `yam surface grant` — ask macOS for the permissions, from the program that
 * will actually be granted them (native-feedback D6).
 *
 * ## Why a command and not an installer step
 *
 * macOS attaches Accessibility and Screen Recording to the **responsible
 * process**: the application that owns the process tree, never the Node script
 * inside it. At `npm install` time there is no such application worth granting
 * — whatever ran `npm` is usually not what will later run `yam mcp` — so an
 * install-time prompt grants the wrong program and, worse, teaches whoever ran
 * it that they have already answered. The earliest moment the question can be
 * asked *correctly* is the first time Yam runs from the program that will drive
 * the desktop, and this is the command that asks it then.
 *
 * ## Once, and only once
 *
 * macOS shows each prompt once per application per service. A program that was
 * refused, or that dismissed the dialog, will never see it again however many
 * times this is run — so when the answer is still `false` afterwards, this says
 * so plainly and sends the reader to System Settings instead of pretending
 * another attempt would help.
 */
import { EXIT, boolOption, type CommandIo, type ExitCode, type ParsedArgs } from "@svatah/yam-bindings-cli";

export async function surfaceGrantCommand(args: ParsedArgs, io: CommandIo): Promise<ExitCode> {
  if (process.platform !== "darwin") {
    io.out(
      process.platform === "win32"
        ? "Windows grants no desktop permission: UI Automation is available to any process. " +
            "Run `yam surface doctor --adapter uia` to check the host."
        : "Linux grants no desktop permission through a prompt: AT-SPI needs toolkit " +
            "accessibility switched on and `at-spi2-registryd` running. Run " +
            "`yam surface doctor --adapter atspi` to check the host.",
    );
    return EXIT.ok;
  }

  const { accessibilityGranted, nameFor, requestAccessibility, requestScreenRecording, responsibleProgram, screenRecordingGranted } =
    await import("@svatah/yam-adapter-ax");

  const who = responsibleProgram();
  const json = boolOption(args, "json");
  /*
   * `--dry-run` asks nothing.
   *
   * The prompt is a once-per-application event that cannot be undone: a dialog
   * dismissed by accident is a program that macOS will never offer the choice
   * to again. Anything that wants to know the state without spending that one
   * chance — a CI job, a setup script, someone reading before clicking — asks
   * for it here, and `yam surface doctor` is the same answer in context.
   */
  const dryRun = boolOption(args, "dry-run");

  if (!json) {
    io.out(`macOS grants these to ${nameFor(who)}, not to Yam — Yam is a script it starts.`);
    if (!who.isApplication) {
      io.out(
        "No application owns this process (an ssh session, cron or a CI runner). A permission " +
          "granted here would have nothing to attach to.",
      );
    }
    io.out("");
  }

  /*
   * Preflight first, so a host that is already set up is not asked anything.
   * A prompt that appears when nothing is wrong is how people learn to dismiss
   * prompts.
   */
  const before = {
    accessibility: accessibilityGranted(),
    screenRecording: screenRecordingGranted(),
  };

  const after = dryRun
    ? before
    : {
        accessibility:
          before.accessibility === true ? true : (requestAccessibility() ?? before.accessibility),
        screenRecording:
          before.screenRecording === true
            ? true
            : (requestScreenRecording() ?? before.screenRecording),
      };

  const rows = [
    {
      permission: "accessibility",
      required: true,
      granted: after.accessibility,
      what: "reading and driving other applications' windows",
    },
    {
      permission: "screen-recording",
      required: false,
      granted: after.screenRecording,
      what: "screenshots; the accessibility tree reads without it",
    },
  ];

  if (json) {
    io.out(
      JSON.stringify(
        { program: who, dryRun, permissions: rows.map((row) => ({ ...row, granted: row.granted ?? null })) },
        null,
        2,
      ),
    );
  } else {
    for (const row of rows) {
      const mark = row.granted === true ? "ok  " : row.granted === false ? (row.required ? "FAIL" : "warn") : "?   ";
      io.out(`${mark}  ${row.permission.padEnd(18)} ${row.granted === true ? "granted" : row.granted === false ? "not granted" : "could not be asked"} — ${row.what}`);
    }
    if (dryRun && rows.some((row) => row.granted !== true)) {
      io.out("");
      io.out(
        "This was `--dry-run`: nothing was asked. Run `yam surface grant` to be prompted for " +
          "what is missing above.",
      );
    } else if (rows.some((row) => row.granted !== true)) {
      io.out("");
      io.out(
        "A prompt appears once per application. If none appeared, this one has been asked " +
          "before and the answer is remembered — open System Settings → Privacy & Security, " +
          `switch the entry on for ${who.isApplication ? who.name : "the program running Yam"}, ` +
          "and restart it. macOS does not re-read the setting for a running process.",
      );
    }
  }

  // Accessibility is the one a desktop session cannot run without; Screen
  // Recording only costs screenshots, so it may not fail the command.
  return after.accessibility === true ? EXIT.ok : EXIT.failed;
}
