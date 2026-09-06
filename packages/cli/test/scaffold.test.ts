/**
 * Draft 2.22 — a stopped step in the example `yam init` wrote is named as the
 * example, and `init --force` retires the example an earlier init wrote.
 */
import { describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXIT } from "@svatah/yam-bindings-cli";
import { main } from "../src/index.js";
import { OLD_SCAFFOLD_MARKER, SCAFFOLD_MARKER, scaffoldStories, stoppedHint } from "../src/scaffold.js";

const OLD_EXAMPLE = `${OLD_SCAFFOLD_MARKER}
// (\`yam record\`, or \`YAM_MODE=record\` in a Playwright test).

story: Sign in
  Open "/login"
  Click the sign in button

test: Sign in
`;

describe("the example yam init wrote is recognised (REQ-CLI-11)", () => {
  it("finds the stories under either marker and no others", () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-scaffold-"));
    mkdirSync(join(dir, "flows", "nested"), { recursive: true });
    writeFileSync(join(dir, "flows", "sign-in.flow"), OLD_EXAMPLE, "utf8");
    writeFileSync(join(dir, "flows", "nested", "front.flow"), `${SCAFFOLD_MARKER}\nstory (tags=smoke): Open the front page\n  Go to "/"\ntest: Open the front page\n`, "utf8");
    writeFileSync(join(dir, "flows", "mine.flow"), 'story: Book a table\n  Go to "/"\ntest: Book a table\n', "utf8");
    const found = scaffoldStories(dir, "flows");
    expect(found.get("Sign in")).toBe(join("flows", "sign-in.flow"));
    expect(found.get("Open the front page")).toBe(join("flows", "nested", "front.flow"));
    expect(found.has("Book a table")).toBe(false);
    expect(scaffoldStories(dir, "elsewhere").size).toBe(0);
  });

  it("names a 404 and the example under a stopped step, and says nothing otherwise", () => {
    const scaffold = new Map([["Sign in", "flows/sign-in.flow"]]);
    const hint = stoppedHint(
      { story: "Sign in", failure: { class: "navigation", message: "Navigating to http://localhost:3000/login returned 404." } },
      scaffold,
    );
    expect(hint).toContain("answered 404 for that page");
    expect(hint).toContain('"Sign in" is the example `yam init` wrote');
    expect(hint).toContain("edit flows/sign-in.flow");
    expect(stoppedHint({ story: "Book a table", failure: { class: "locator", message: "No binding." } }, scaffold)).toBeUndefined();
    expect(stoppedHint({ story: "Book a table", failure: { class: "navigation", message: "Navigating to x returned 500." } }, scaffold)).toContain("answered 500");
  });

  it("init --force retires the earlier example and leaves a person's flow alone", async () => {
    const dir = mkdtempSync(join(tmpdir(), "yam-scaffold-"));
    mkdirSync(join(dir, "flows"), { recursive: true });
    writeFileSync(join(dir, "yam.config.yaml"), "old", "utf8");
    writeFileSync(join(dir, "flows", "sign-in.flow"), OLD_EXAMPLE, "utf8");
    writeFileSync(join(dir, "flows", "mine.flow"), 'story: Book a table\n  Go to "/"\ntest: Book a table\n', "utf8");
    let err = "";
    const code = await main(["init", dir, "--force", "--url", "http://localhost:3000"], { out: () => {}, err: (t) => (err += `${t}\n`) });
    expect(code).toBe(EXIT.ok);
    expect(existsSync(join(dir, "flows", "sign-in.flow"))).toBe(false);
    expect(existsSync(join(dir, "flows", "mine.flow"))).toBe(true);
    expect(err).toContain("Removed flows/sign-in.flow");

    // A sign-in.flow a person wrote carries no marker and stays.
    writeFileSync(join(dir, "flows", "sign-in.flow"), 'story: Sign in\n  Go to "/account"\ntest: Sign in\n', "utf8");
    await main(["init", dir, "--force", "--url", "http://localhost:3000"], { out: () => {}, err: () => {} });
    expect(existsSync(join(dir, "flows", "sign-in.flow"))).toBe(true);
  });
});
