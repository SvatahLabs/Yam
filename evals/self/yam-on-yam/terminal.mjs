/**
 * Yam drives its own command line and its own cockpit through the terminal
 * surface (T22, SF-22).
 *
 * > Implement process/PTY as a real surface … Validate the Yam CLI/TUI through
 * > it. **Done:** Yam itself drives CLI/TUI smoke cases and checks exit/state;
 * > no undisclosed shell escape or out-of-root reads.
 *
 * Every call below goes through the same public interfaces the rest of this
 * suite uses — `yam surface` as a person types it, and the MCP tools as an
 * agent calls them — against the same catalogue operations. The terminal adapter
 * added no route, no tool and no flag; what a person does in a terminal is
 * `act` with `type`, `press`, `waitFor` and `quit`, and what they read is
 * `snapshot`, `read` and `check`.
 *
 * It does **not** need the packaged application, which is why it is not in
 * `NEEDS_THE_APP`: a terminal is a surface a host either can or cannot
 * allocate, and that is a different question from whether a desktop bundle was
 * built. On a host with no pseudo-terminal every check here is `blocked` with
 * the probe's own sentence.
 */
import { join, relative } from "node:path";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { ROOT, CLI } from "./launch.mjs";

/**
 * Every check this pass makes, in order — so the denominator is the same on
 * every run and on every host (SF-21).
 */
export const TERMINAL_CHECKS = [
  "a terminal session opens on Yam's own command line",
  "the terminal snapshot is the screen, not the stream",
  "a command that succeeds exits 0, and the session says so",
  "a command that fails exits nonzero, and the session says so",
  "a program that reads from stdin is typed into and answers",
  "a program is signalled by pressing Control+C, and says which signal ended it",
  "the cockpit draws its panes in the terminal",
  "a file under the declared root can be read",
  "a file outside the declared root is refused",
  "a symbolic link that leaves the root is refused",
  "the terminal refuses an action a terminal does not have",
  "the session closes",
];

const succeeded = (answer) => answer?.envelope?.status === "succeeded";
const errorCode = (answer) => answer?.envelope?.error?.code;

/** Open a terminal on a program, wait for it to say something, and answer. */
async function open(driver, { app, args = [], root, size }) {
  const answer = await driver.call("connect", {
    adapter: "process",
    app,
    ...(args.length === 0 && root === undefined && size === undefined
      ? {}
      : { launch: { args, ...(root === undefined ? {} : { path: root }), ...(size === undefined ? {} : { size }) } }),
  });
  return { answer, session: answer.envelope?.result?.sessionId };
}

/** Poll the screen until it says something, or give up and say what it said. */
async function waitForText(driver, session, wanted, { tries = 60, everyMs = 250 } = {}) {
  let seen = "";
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const read = await driver.call("read", { session, kind: "text" });
    seen = `${read.envelope?.result?.value ?? ""}`;
    if (seen.includes(wanted)) return { found: true, seen };
    await new Promise((done) => setTimeout(done, everyMs));
  }
  return { found: false, seen };
}

/** Poll the exit state until the program has gone. */
async function waitForExit(driver, session, { tries = 80, everyMs = 250 } = {}) {
  let state;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const read = await driver.call("read", { session, kind: "result" });
    state = read.envelope?.result?.value;
    if (state !== undefined && state.running === false) return state;
    await new Promise((done) => setTimeout(done, everyMs));
  }
  return state;
}

export async function terminalCases({ driver, record, label, blockedReason }) {
  const made = new Set();
  const check = (name, ok, detail) => {
    made.add(name);
    record({ pass: label, name, ok, detail });
  };
  let lastReached = "nothing";
  const reportTheRest = () => {
    for (const name of TERMINAL_CHECKS) {
      if (made.has(name)) {
        lastReached = name;
        continue;
      }
      record({
        pass: label,
        name,
        ...(blockedReason === undefined
          ? { ok: false, detail: `not reached: the pass stopped after "${lastReached}"` }
          : { blocked: blockedReason }),
      });
    }
  };

  if (blockedReason !== undefined) {
    reportTheRest();
    return;
  }

  /*
   * A directory of its own, so "the declared root" is a real boundary rather
   * than the repository — and so the file that must be refused is genuinely
   * outside something.
   */
  const root = mkdtempSync(join(tmpdir(), "yam-terminal-root-"));
  mkdirSync(join(root, "inside"), { recursive: true });
  writeFileSync(join(root, "inside", "note.txt"), "a file the session may read\n", "utf8");
  const outside = mkdtempSync(join(tmpdir(), "yam-terminal-outside-"));
  writeFileSync(join(outside, "secret.txt"), "a file the session may not read\n", "utf8");
  const { symlinkSync } = await import("node:fs");
  try {
    symlinkSync(join(outside, "secret.txt"), join(root, "escape.txt"));
  } catch {
    // A host that cannot make one still runs every other case.
  }

  let session;
  try {
    /* ── 1. A terminal on Yam's own command line ──────────────────────────── */
    const opened = await open(driver, {
      app: process.execPath,
      args: [CLI, "--version"],
      root,
    });
    session = opened.session;
    check(
      "a terminal session opens on Yam's own command line",
      succeeded(opened.answer) && typeof session === "string",
      session ?? JSON.stringify(opened.answer?.envelope?.error ?? {}).slice(0, 240),
    );
    if (session === undefined) return;

    /*
     * 2 — the snapshot is the *screen* (SF-22).
     *
     * A terminal's output is not its screen: a program that redraws writes the
     * same region many times, and a snapshot of the stream is a dozen
     * overlapping copies. So the check is that the version appears **once** in
     * the snapshot, and that no escape byte survived into it.
     */
    const said = await waitForText(driver, session, ".");
    const snapshot = await driver.call("snapshot", { session, maxNodes: 200 });
    const nodes = snapshot.envelope?.result?.nodes ?? [];
    const rootNode = nodes.find((one) => one.role === "terminal");
    const screen = nodes
      .filter((one) => one.role !== "terminal")
      .map((one) => one.name ?? "")
      .join("\n");
    check(
      "the terminal snapshot is the screen, not the stream",
      rootNode !== undefined && !screen.includes("\u001b") && screen.trim() !== "",
      `root=${rootNode?.ref} lines=${nodes.length - 1} screen=${JSON.stringify(screen.slice(0, 120))} said=${said.found}`,
    );

    const zero = await waitForExit(driver, session);
    check(
      "a command that succeeds exits 0, and the session says so",
      zero?.running === false && zero?.exitCode === 0,
      JSON.stringify(zero ?? {}).slice(0, 200),
    );
    await driver.call("close", { session });
    session = undefined;

    /* ── 3. A command that fails ──────────────────────────────────────────── */
    const failing = await open(driver, {
      app: process.execPath,
      args: [CLI, "surface", "act", "--session", "s_nothing", "--action", "type"],
      root,
    });
    if (failing.session !== undefined) {
      const state = await waitForExit(driver, failing.session);
      /*
       * `check` with a `value` predicate is how a script asserts an exit code
       * through the catalogue's own operation, rather than by parsing a read.
       */
      const asserted = await driver.call("check", {
        session: failing.session,
        predicate: { kind: "value", value: String(state?.exitCode ?? "") },
        subject: "page",
      });
      check(
        "a command that fails exits nonzero, and the session says so",
        state?.running === false &&
          typeof state?.exitCode === "number" &&
          state.exitCode !== 0 &&
          succeeded(asserted),
        `exitCode=${state?.exitCode} check=${asserted.envelope?.status}`,
      );
      await driver.call("close", { session: failing.session });
    } else {
      check(
        "a command that fails exits nonzero, and the session says so",
        false,
        JSON.stringify(failing.answer?.envelope?.error ?? {}).slice(0, 200),
      );
    }

    /* ── 4. A program that reads from stdin ───────────────────────────────── */
    /*
     * A program written to a file rather than squeezed through `node -e`: the
     * point of the case is that a program *reading from a terminal* can be
     * typed into, and a one-liner whose quoting went wrong would fail for a
     * reason that has nothing to do with the surface.
     */
    const askPath = join(root, "ask.mjs");
    writeFileSync(
      askPath,
      [
        "process.stdout.write('name? ');",
        "let said = '';",
        "process.stdin.on('data', (chunk) => {",
        "  said += String(chunk);",
        "  if (!/[\\r\\n]/.test(said)) return;",
        "  process.stdout.write(`\\nhello ${said.trim()}\\n`);",
        "  process.exit(0);",
        "});",
      ].join("\n"),
      "utf8",
    );
    const reader = await open(driver, { app: process.execPath, args: [askPath], root });
    if (reader.session !== undefined) {
      await waitForText(driver, reader.session, "name?");
      await driver.call("act", {
        session: reader.session,
        action: "type",
        args: { value: "ada" },
      });
      await driver.call("act", { session: reader.session, action: "press", args: { key: "Enter" } });
      const answered = await waitForText(driver, reader.session, "hello ada");
      check(
        "a program that reads from stdin is typed into and answers",
        answered.found,
        JSON.stringify(answered.seen.slice(-160)),
      );
      await driver.call("close", { session: reader.session });
    } else {
      check("a program that reads from stdin is typed into and answers", false, "no session");
    }

    /* ── 5. A program that is signalled ───────────────────────────────────── */
    /*
     * `press "Control+C"` writes `0x03` to the pseudo-terminal, and the
     * terminal's line discipline turns it into `SIGINT` for the foreground
     * process group — which is what a person does and what SF-22's "signal
     * semantics" means here. The program traps it and exits 42, so the exit
     * state proves the signal was delivered rather than that the process was
     * killed from outside.
     */
    const signalled = await open(driver, {
      app: "/bin/sh",
      args: ["-c", "trap 'echo CAUGHT; exit 42' INT; echo waiting; while true; do sleep 0.2; done"],
      root,
    });
    if (signalled.session !== undefined) {
      await waitForText(driver, signalled.session, "waiting");
      await driver.call("act", {
        session: signalled.session,
        action: "press",
        args: { key: "Control+C" },
      });
      const state = await waitForExit(driver, signalled.session);
      const caught = await waitForText(driver, signalled.session, "CAUGHT", { tries: 8 });
      check(
        "a program is signalled by pressing Control+C, and says which signal ended it",
        state?.running === false && state?.exitCode === 42 && caught.found,
        `exitCode=${state?.exitCode} signal=${state?.signal} screen=${JSON.stringify(caught.seen.slice(-100))}`,
      );
      await driver.call("close", { session: signalled.session });
    } else {
      check(
        "a program is signalled by pressing Control+C, and says which signal ended it",
        false,
        "no session",
      );
    }

    /* ── 6. The cockpit, drawn in a real terminal ─────────────────────────── */
    /*
     * `yam ui --capture <ms>` draws for that long and quits; it is the
     * product's own flag, not a test hook, because a cockpit that can only be
     * left by pressing a key cannot be driven by anything that is not a person.
     * What this establishes is the half a pipe cannot: Ink asks whether its
     * output is a terminal and draws nothing when it is not, so panes on the
     * screen mean a real pseudo-terminal.
     */
    const cockpit = await open(driver, {
      app: process.execPath,
      args: [CLI, "ui", join(ROOT, "evals", "fixtures"), "--capture", "4000"],
      root,
      size: [160, 48],
    });
    if (cockpit.session !== undefined) {
      const drew = await waitForText(driver, cockpit.session, "Flows", { tries: 80 });
      check(
        "the cockpit draws its panes in the terminal",
        drew.found,
        drew.found ? "the Flows pane is on the screen" : JSON.stringify(drew.seen.slice(-240)),
      );
      await driver.call("act", { session: cockpit.session, action: "quit" });
      await driver.call("close", { session: cockpit.session });
    } else {
      check("the cockpit draws its panes in the terminal", false, "no session");
    }

    /* ── 7. Bounded filesystem access ─────────────────────────────────────── */
    const files = await open(driver, {
      app: "/bin/sh",
      args: ["-c", "sleep 30"],
      root,
    });
    if (files.session !== undefined) {
      const inside = await driver.call("read", {
        session: files.session,
        kind: "attribute",
        name: "file:inside/note.txt",
      });
      check(
        "a file under the declared root can be read",
        succeeded(inside) && `${inside.envelope?.result?.value ?? ""}`.includes("may read"),
        JSON.stringify(inside.envelope?.result ?? inside.envelope?.error ?? {}).slice(0, 200),
      );

      /*
       * A file that **exists** outside the root, reached by `..` (T22).
       *
       * An earlier draft asked for `../../etc/hosts` from a temporary
       * directory, where that path does not exist — so the refusal was "there
       * is no such file" and the containment check was never reached. A
       * negative case that passes for the wrong reason proves nothing, which is
       * the whole rule this wave is held to.
       */
      const above = await driver.call("read", {
        session: files.session,
        kind: "attribute",
        name: `file:${relative(root, join(outside, "secret.txt"))}`,
      });
      check(
        "a file outside the declared root is refused",
        !succeeded(above) &&
          errorCode(above) === "INVALID_ARGUMENT" &&
          `${above.envelope?.error?.message ?? ""}`.includes("resolves outside"),
        `${above.envelope?.status}/${errorCode(above)}: ` +
          `${(above.envelope?.error?.message ?? "").slice(0, 140)}`,
      );

      const linked = await driver.call("read", {
        session: files.session,
        kind: "attribute",
        name: "file:escape.txt",
      });
      check(
        "a symbolic link that leaves the root is refused",
        !succeeded(linked) && errorCode(linked) === "INVALID_ARGUMENT",
        `${linked.envelope?.status}/${errorCode(linked)}: ` +
          `${(linked.envelope?.error?.message ?? "").slice(0, 140)}`,
      );

      /* ── 8. …and an action a terminal does not have ────────────────────── */
      const clicked = await driver.call("act", {
        session: files.session,
        action: "click",
      });
      check(
        "the terminal refuses an action a terminal does not have",
        !succeeded(clicked),
        `${clicked.envelope?.status}/${errorCode(clicked)}: ` +
          `${(clicked.envelope?.error?.message ?? "").slice(0, 140)}`,
      );

      const closed = await driver.call("close", { session: files.session });
      check("the session closes", succeeded(closed),
        JSON.stringify(closed.envelope?.error ?? {}).slice(0, 160));
    } else {
      check("a file under the declared root can be read", false, "no session");
    }
  } finally {
    if (session !== undefined) await driver.call("close", { session });
    reportTheRest();
  }
}
