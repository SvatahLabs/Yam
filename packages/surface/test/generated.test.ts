/**
 * Names a build generated, and the classes a fingerprint keeps (LLD §3.3, §6.4).
 */
import { describe, expect, it } from "vitest";
import { looksGenerated, stableClassesOf } from "../src/index.js";

describe("the classes a fingerprint keeps", () => {
  it("keeps the ones a person wrote and drops the ones a build generated", () => {
    expect(stableClassesOf("sv-rail-item sv-rail-active css-1x2y3z :r3: x")).toBe(
      "sv-rail-item sv-rail-active",
    );
    // Whatever whitespace the accessibility API joined them with.
    expect(stableClassesOf("  sv-btn\tsv-btn-ghost \n")).toBe("sv-btn sv-btn-ghost");
  });

  it("answers nothing, rather than an empty class, when nothing is left", () => {
    // An empty `class` would make every element without one match every other.
    expect(stableClassesOf(undefined)).toBeUndefined();
    expect(stableClassesOf("")).toBeUndefined();
    expect(stableClassesOf("css-1x2y3z _3fF4aQ")).toBeUndefined();
  });

  it("uses the same rule as a generated id", () => {
    expect(looksGenerated(":r3:")).toBe(true);
    expect(looksGenerated("radix-:r1:")).toBe(true);
    expect(looksGenerated("sv-rail-item")).toBe(false);
  });
});
