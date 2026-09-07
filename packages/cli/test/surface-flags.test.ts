/**
 * `yam surface` refuses a flag the catalogue does not declare (T18, SF-06).
 *
 * The defect: `yam surface control --action take` parsed, ignored `--action`
 * entirely — the command line spells that operation `--take` — reported the
 * *status* of the lease, and exited 0. The caller who meant to take control was
 * told nobody held it, which is true and is not the answer to the question
 * asked. It is the same family as the two other silent-argument defects wave 4
 * found: an argument nobody understood, dropped, and reported as success.
 *
 * These run the built binary, because the parsing under test is the binary's.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "dist", "bin.js");

function yam(...argv: string[]): { status: number | null; out: string; err: string } {
  const ran = spawnSync(process.execPath, [CLI, ...argv], { encoding: "utf8" });
  return { status: ran.status, out: ran.stdout ?? "", err: ran.stderr ?? "" };
}

describe("unknown flags are a usage error, not silence (SF-06)", () => {
  it("names the flag, the subcommand and what it does take", () => {
    const ran = yam("surface", "control", "--session", "s_none", "--action", "take", "--json");
    expect(ran.status, "exit 64 is the usage code").toBe(64);
    expect(ran.err).toContain("--action is not a flag of `yam surface control`");
    expect(ran.err, "it says what to use instead").toContain("--take");
    expect(ran.out, "nothing was dispatched, so nothing is on stdout").toBe("");
  });

  it("refuses --holder on connect, which does not take one", () => {
    /*
     * A session is not held until somebody takes it, so `connect` declares no
     * holder. This case exists because the T18 suite sent one and this check is
     * what told it not to.
     */
    const ran = yam("surface", "connect", "--holder", "somebody", "--json");
    expect(ran.status).toBe(64);
    expect(ran.err).toContain("--holder is not a flag of `yam surface connect`");
  });

  it("accepts every flag the catalogue does declare for connect", () => {
    /*
     * `--url` and `--app` together are refused by the *broker*, with
     * INVALID_ARGUMENT — a different refusal, and the right one: they are both
     * flags of this subcommand and naming two targets is a domain error, not a
     * parsing one. Here only the parse is under test, so the flags are checked
     * against the catalogue rather than run.
     */
    const help = yam("surface", "--help");
    for (const flag of ["--url", "--app", "--attach", "--adapter", "--headed"]) {
      expect(`${help.out}${help.err}`, `${flag} is missing from the help`).toContain(flag);
    }
  });

  it("still accepts --json everywhere", () => {
    const ran = yam("surface", "sessions", "--json");
    expect(ran.status, "--json is every operation's").not.toBe(64);
  });
});
