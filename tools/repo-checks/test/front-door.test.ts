/**
 * REQ-CLI-9 (Draft 2.20) — the words a person reads from the command line carry
 * none of the project's internal vocabulary. The help, every command's help,
 * every topic and `yam init`'s output are read from the built package; the
 * diagnostics catalogue joins them when it exists.
 */
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { fromRoot } from "../src/repo.js";

const BANNED: ReadonlyArray<[RegExp, string]> = [
  [/module \(a\)/, "module (a)"],
  [/module \(b\)/, "module (b)"],
  [/LLD §|HLD §/, "a design section"],
  [/REQ-[A-Z]+-\d/, "a requirement id"],
  [/\bDraft \d/, "a draft number"],
  [/\bT\d+\.\d+\b/, "a task id"],
  [/\bP\d+-F\d+\b/, "a finding id"],
];

describe("the front door speaks no internal vocabulary (REQ-CLI-9)", () => {
  it("in the help, the topics and init's output", async () => {
    const cli = (await import(pathToFileURL(fromRoot("packages", "cli", "dist", "index.js")).href)) as {
      userFacingHelpText: () => string;
      DIAGNOSTICS?: ReadonlyArray<{ message: string; next: string }>;
    };
    const texts = [cli.userFacingHelpText()];
    if (cli.DIAGNOSTICS !== undefined) texts.push(cli.DIAGNOSTICS.map((one) => `${one.message} ${one.next}`).join("\n"));
    const dir = mkdtempSync(join(tmpdir(), "yam-vocabulary-"));
    texts.push(
      execFileSync(process.execPath, [fromRoot("packages", "cli", "dist", "bin.js"), "init", dir], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
    // init prints to stderr; capture that too.
    const init = execFileSync("sh", ["-c", `"${process.execPath}" "${fromRoot("packages", "cli", "dist", "bin.js")}" init "${mkdtempSync(join(tmpdir(), "yam-vocabulary-"))}" 2>&1`], { encoding: "utf8" });
    texts.push(init);
    const text = texts.join("\n");
    expect(text.length).toBeGreaterThan(1000);
    for (const [pattern, what] of BANNED) {
      const hit = pattern.exec(text);
      expect(hit, `the front door says ${what}: "${hit?.[0] ?? ""}"`).toBeNull();
    }
  });
});
