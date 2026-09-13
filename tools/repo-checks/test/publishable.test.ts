/**
 * What a publish would actually put on the registry.
 *
 * Three facts, each of which was false when this file was written, and none of
 * which any existing check could see. They are grouped because they share a
 * cause: the release set, the licence and the script names are each derived
 * from something, and nothing compared the derivation to the claim.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fromRoot } from "../src/repo.js";

/** Every package under `packages/` that npm would accept, by name. */
function publishableManifests(): { name: string; dir: string }[] {
  const out: { name: string; dir: string }[] = [];
  for (const dir of readdirSync(fromRoot("packages"))) {
    const manifest = fromRoot("packages", dir, "package.json");
    if (!existsSync(manifest)) continue;
    const parsed = JSON.parse(readFileSync(manifest, "utf8")) as { name: string; private?: boolean };
    if (parsed.private === true) continue;
    out.push({ name: parsed.name, dir });
  }
  return out;
}

describe("a publish puts on the registry what the documents promise", () => {
  /*
   * Apache-2.0 §4(a): "You must give any other recipients of the Work a copy of
   * this License." Every manifest carried `"license": "Apache-2.0"` and not one
   * package directory carried the text, so every tarball would have shipped the
   * label without the licence. npm includes a `LICENSE` whether or not `files`
   * lists it, so the file existing is the whole fix — and its absence is
   * invisible to a manifest check, which is why this reads the directory.
   */
  it("every publishable package ships the licence it claims", () => {
    const packages = publishableManifests();
    expect(packages.length).toBeGreaterThan(30);
    const root = readFileSync(fromRoot("LICENSE"), "utf8");
    const wrong: string[] = [];
    for (const { name, dir } of packages) {
      const licence = fromRoot("packages", dir, "LICENSE");
      if (!existsSync(licence)) wrong.push(`${name}: no LICENSE`);
      else if (readFileSync(licence, "utf8") !== root) wrong.push(`${name}: LICENSE differs from the root's`);
    }
    expect(wrong).toEqual([]);
  });
});
