/**
 * Copy command and Copy MCP call (T15, SF-06, SF-07, SF-10, SF-15).
 *
 * The claim is that a copied line does what **Act** does, so the command is not
 * only read here but *run*: through `sh`, with `yam` defined as a function that
 * prints what it was given on stdin and in its arguments. A heredoc that
 * expanded a `$`, or a pipeline that put the secret into the text, fails on the
 * bytes rather than on a reading of the string.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { isSecretField, type ElementDescription } from "@svatah/yam-schema";
import {
  actionCommands,
  secretField,
  shellWord,
  SECRET_PLACEHOLDER,
  SECRET_VARIABLE,
} from "../src/index.js";

/** What `yam` saw when the copied command ran: its stdin and its arguments. */
function runCopied(cli: string, env: Record<string, string> = {}): { stdin: string; argv: string[]; status: number | null; stderr: string } {
  const script = [
    // A stand-in for the real command: stdin, then one argument per line after a marker.
    `yam() { cat; printf '\\n--argv--\\n'; for one in "$@"; do printf '%s\\n' "$one"; done; }`,
    cli,
  ].join("\n");
  const done = spawnSync("sh", ["-c", script], {
    encoding: "utf8",
    env: { PATH: process.env["PATH"] ?? "", ...env },
  });
  const [stdin = "", rest = ""] = done.stdout.split("\n--argv--\n");
  return { stdin, argv: rest.split("\n").filter((one) => one !== ""), status: done.status, stderr: done.stderr };
}

const posix = process.platform !== "win32";

describe("the copied command line (T15, SF-06)", () => {
  it("names the session, the action, the control and its snapshot, and nothing else for a click", () => {
    const { cli } = actionCommands({ session: "s_1", action: "click", ref: "r2", args: {}, snapshotId: "snap_1" });
    expect(cli).toBe("yam surface act --session s_1 --action click --ref r2 --snapshot snap_1");
  });

  it("leaves an empty field out rather than sending it empty", () => {
    const { cli, mcp } = actionCommands({ session: "s_1", action: "dialog", args: { accept: "true", text: "" } });
    expect(cli).toContain('{"accept":"true"}');
    expect(cli).not.toContain("text");
    expect(JSON.parse(mcp).params.arguments.args).toEqual({ accept: "true" });
  });

  it("does not scope a reference-free action to a snapshot", () => {
    const { cli } = actionCommands({
      session: "s_1",
      action: "navigate",
      args: { url: "https://example.com/" },
      snapshotId: "snap_1",
    });
    expect(cli).not.toContain("--snapshot");
    expect(cli).not.toContain("--ref");
  });

  it.runIf(posix)("passes arguments through a quoted heredoc, byte for byte", () => {
    const value = `it's "quoted" $HOME \`whoami\` \\n and a\nnewline`;
    const { cli } = actionCommands({ session: "s 1", action: "type", ref: "r1", args: { value }, snapshotId: "snap_1" });
    expect(cli).toContain("--input - <<'JSON'");
    const seen = runCopied(cli);
    expect(seen.status, seen.stderr).toBe(0);
    expect(JSON.parse(seen.stdin)).toEqual({ value });
    expect(seen.argv).toEqual([
      "surface", "act", "--session", "s 1", "--action", "type", "--ref", "r1", "--snapshot", "snap_1", "--input", "-",
    ]);
  });

  it("quotes a word only when it has to", () => {
    expect(shellWord("snap_abc-1")).toBe("snap_abc-1");
    expect(shellWord("a b")).toBe("'a b'");
    expect(shellWord("it's")).toBe(`'it'\\''s'`);
    expect(shellWord("")).toBe("''");
  });
});

describe("a secret is written into neither (SF-15)", () => {
  const typed = "hunter2 'with' $quotes\"";

  it("reads the value from the environment and marks it with --secret", () => {
    const { cli, notes } = actionCommands({
      session: "s_1",
      action: "type",
      ref: "r3",
      args: { value: typed },
      snapshotId: "snap_1",
      secret: true,
    });
    expect(cli).not.toContain("hunter2");
    expect(cli).toContain(`--secret "$${SECRET_VARIABLE}"`);
    expect(cli).toContain(`\${${SECRET_VARIABLE}:?`);
    expect(notes.join(" ")).toContain("password field");
  });

  it.runIf(posix)("and the command that reads it sends exactly that value", () => {
    const { cli } = actionCommands({
      session: "s_1",
      action: "type",
      ref: "r3",
      args: { value: "ignored", other: "kept" },
      snapshotId: "snap_1",
      secret: true,
    });
    const seen = runCopied(cli, { [SECRET_VARIABLE]: typed });
    expect(seen.status, seen.stderr).toBe(0);
    expect(JSON.parse(seen.stdin)).toEqual({ other: "kept", value: typed });
    expect(seen.argv.slice(-3)).toEqual(["-", "--secret", typed]);
  });

  it.runIf(posix)("refuses to run with the variable unset, rather than typing nothing", () => {
    const { cli } = actionCommands({ session: "s_1", action: "type", ref: "r3", args: {}, secret: true });
    const seen = runCopied(cli);
    expect(seen.status).not.toBe(0);
    expect(seen.stderr).toContain(`set ${SECRET_VARIABLE} to the value first`);
    expect(seen.stdin).toBe("");
  });

  it("puts a placeholder in the MCP call's arguments and lists it in secrets", () => {
    const { mcp } = actionCommands({
      session: "s_1",
      action: "type",
      ref: "r3",
      args: { value: typed },
      snapshotId: "snap_1",
      secret: true,
    });
    expect(mcp).not.toContain("hunter2");
    const call = JSON.parse(mcp);
    expect(call).toMatchObject({ jsonrpc: "2.0", method: "tools/call", params: { name: "surface_act" } });
    expect(call.params.arguments).toEqual({
      session: "s_1",
      action: "type",
      ref: "r3",
      args: { value: SECRET_PLACEHOLDER },
      secrets: [SECRET_PLACEHOLDER],
    });
  });

  it("says nothing about secrets for a click on a password field, which carries none", () => {
    const { cli, mcp, notes } = actionCommands({ session: "s_1", action: "click", ref: "r3", secret: true });
    expect(cli).not.toContain(SECRET_VARIABLE);
    expect(JSON.parse(mcp).params.arguments.secrets).toBeUndefined();
    expect(notes.join(" ")).not.toContain("password");
  });
});

describe("the MCP call is the same act (SF-07)", () => {
  it("carries both references for a drag, and no snapshot, which surface_act does not take", () => {
    const { mcp } = actionCommands({ session: "s_1", action: "dragTo", ref: "r1", ref2: "r2", snapshotId: "snap_1" });
    expect(JSON.parse(mcp).params.arguments).toEqual({ session: "s_1", action: "dragTo", ref: "r1", ref2: "r2" });
  });
});

describe("the notes say what will stop either working (SF-10, SF-13)", () => {
  it("says a reference belongs to its snapshot and expires when the page changes", () => {
    const { notes } = actionCommands({ session: "s_1", action: "click", ref: "r2", snapshotId: "snap_1" });
    expect(notes[0]).toContain("snap_1");
    expect(notes[0]).toContain("expires when the page changes");
    expect(notes.join(" ")).toContain("`surface_act` names no snapshot");
  });

  it("names a holder, and a postcondition that is not included", () => {
    const { notes } = actionCommands({
      session: "s_1",
      action: "click",
      ref: "r2",
      holder: "agent-1",
      verify: true,
    });
    expect(notes.join(" ")).toContain("agent-1 holds this target");
    expect(notes.join(" ")).toContain("`yam surface check`");
  });
});

describe("the model and the broker agree about which field is a secret (SF-15)", () => {
  const base = {
    ref: "r1",
    role: "textbox",
    text: "",
    neighbours: { before: [], after: [] },
    rolePath: [],
    box: [0, 0, 10, 10] as [number, number, number, number],
    index: 0,
    states: [],
  };
  const cases: Array<Partial<ElementDescription>> = [
    { tag: "input", attrs: { type: "password" } },
    { tag: "input", attrs: { type: "PASSWORD" } },
    { tag: "input", attrs: { type: "text" } },
    { tag: "AXTextField", attrs: { AXSubrole: "AXSecureTextField" } },
    { tag: "AXTextField", attrs: {} },
    { tag: "XCUIElementTypeSecureTextField", attrs: {} },
    { tag: "android.widget.EditText", attrs: { password: "true" } },
    { tag: "android.widget.EditText", attrs: { password: "false" } },
  ];

  for (const one of cases) {
    const described = { ...base, ...one } as ElementDescription;
    it(`${described.tag} ${JSON.stringify(described.attrs)}`, () => {
      expect(secretField(described as unknown as Record<string, unknown>)).toBe(isSecretField(described));
    });
  }

  it("also reads a value the broker already withheld as a secret", () => {
    expect(secretField({ ...base, tag: "input", attrs: {}, value: "[REDACTED]" })).toBe(true);
  });
});
