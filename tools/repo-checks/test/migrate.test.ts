/**
 * T2.9 — the migration is pinned, and its output compiles (REQ-LANG-11).
 *
 * Two things live here rather than in `@svatah/yam-migrate`'s own tests:
 *
 * * **"compiles clean"** needs the compiler, and `@svatah/yam-migrate` must not
 *   depend on it (LLD §1 draws `migrate ─► spec, bindings`). This package has no
 *   boundary to keep, so it is where the two can meet.
 * * **the byte-for-byte comparison** is against `evals/migrate/expected`, which
 *   is committed. See that directory's README for why it is not against the
 *   hand-migrated fixtures: those carry decisions no converter can make — a
 *   typed `inputs:` signature invented from two literals, an element named "the
 *   schedule heading" where the original said `~xpath://h1~` — and a migrator
 *   that reproduced them would be one that had memorised four files.
 *
 * What *is* compared with the fixtures is the property migration is actually
 * responsible for: the same story names, in the same order, with the same number
 * of steps.
 */
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compile } from "@svatah/yam-compiler";
import { renderReviewReport } from "@svatah/yam-migrate";
import { formatDiagnostic, isStoryBlock, readFlow, readProject } from "@svatah/yam-spec";
import { fromRoot } from "../src/repo.js";
import { EXPECTED, migrateLegacy, snapshot } from "../../../scripts/migrate-legacy.mjs";

/** A fresh migration into a temporary directory, for comparison. */
function fresh(): Map<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "yam-migrate-check-"));
  try {
    migrateLegacy(dir);
    return snapshot(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const produced = fresh();
const committed = snapshot(fromRoot(EXPECTED));

describe("the committed migration output (T2.9)", () => {
  it("has files to compare, so this suite is not vacuous", () => {
    expect(committed.size).toBeGreaterThan(10);
  });

  it("produces exactly the files that are committed", () => {
    expect([...produced.keys()].sort()).toEqual([...committed.keys()].sort());
  });

  it.each([...committed.keys()].sort())("%s is byte-for-byte what migrate writes", (path) => {
    expect(produced.get(path), "run `node scripts/migrate-legacy.mjs`").toBe(committed.get(path));
  });
});

describe("the migrated flows compile clean (T2.9 Validate)", () => {
  const dir = fromRoot(EXPECTED, "flows");
  const flows = readdirSync(dir)
    .filter((name) => name.endsWith(".flow"))
    .sort()
    .map((name) => ({ file: `flows/${name}`, text: readFileSync(join(dir, name), "utf8") }));

  const { project, diagnostics: read } = readProject({ flows, env: {} });
  const compiled = compile({ project, projectName: "migrated", stable: true });

  it("reads with no errors", () => {
    expect(read.filter((d) => d.severity === "error").map(formatDiagnostic)).toEqual([]);
  });

  it("compiles with no errors", () => {
    expect(
      compiled.diagnostics.filter((d) => d.severity === "error").map(formatDiagnostic),
    ).toEqual([]);
  });

  it("leaves no step unconverted", () => {
    for (const flow of flows) {
      expect(flow.text, `${flow.file} has a TODO(migrate)`).not.toContain("TODO(migrate)");
    }
  });
});

describe("names and step counts match the originals (REQ-LANG-11)", () => {
  const SAMPLES = ["simple", "svatah", "execution", "natural_language_login"];

  /** Story headers and their step counts, read from a v1/v2 file. */
  function legacyStories(name: string): Array<{ name: string; steps: number }> {
    const text = readFileSync(
      fromRoot("evals", "migrate", "source", "sample", `${name}.flow`),
      "utf8",
    );
    const out: Array<{ name: string; steps: number }> = [];
    let current: { name: string; steps: number } | undefined;
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      const header = /^(story|scenario)\s*:\s*(.+)$/i.exec(line);
      if (header !== null) {
        current = { name: header[2]!.trim().replace(/\s+/g, " "), steps: 0 };
        out.push(current);
        continue;
      }
      if (/^(compose|test)\s*:/i.test(line)) {
        current = undefined;
        continue;
      }
      if (line === "" || line.startsWith("//") || line.startsWith("#")) continue;
      if (current !== undefined) current.steps += 1;
    }
    return out;
  }

  it.each(SAMPLES)("%s.flow: the same stories, in order, with the same step counts", (name) => {
    const migrated = readFlow(
      readFileSync(fromRoot(EXPECTED, "flows", `${name}.flow`), "utf8"),
      `${name}.flow`,
    ).flow.blocks.filter(isStoryBlock);

    const original = legacyStories(name);
    expect(migrated.map((b) => b.name)).toEqual(original.map((s) => s.name));
    expect(migrated.map((b) => b.steps.length)).toEqual(original.map((s) => s.steps));
  });

  it("the four fixtures and the migration agree on names and step counts", () => {
    // The fixtures are the *hand* migration and differ in wording; what they
    // must share with the converter's output is the shape.
    for (const name of SAMPLES) {
      const fixture = readFlow(
        readFileSync(fromRoot("evals", "fixtures", "flows", `${name}.flow`), "utf8"),
        name,
      ).flow.blocks.filter(isStoryBlock);
      const migrated = readFlow(
        readFileSync(fromRoot(EXPECTED, "flows", `${name}.flow`), "utf8"),
        name,
      ).flow.blocks.filter(isStoryBlock);

      expect(migrated.map((b) => b.name), name).toEqual(fixture.map((b) => b.name));
      expect(migrated.map((b) => b.steps.length), name).toEqual(fixture.map((b) => b.steps.length));
    }
  });
});

describe("the review report (REQ-LANG-11: verified by review)", () => {
  const report = readFileSync(fromRoot(EXPECTED, "migration-review.md"), "utf8");

  it("says what was written", () => {
    expect(report).toContain("# Migration review");
    expect(report).toContain("## What was written");
    expect(report).toContain("flows/simple.flow");
  });

  it("names the steps a reviewer has to look at", () => {
    expect(report).toContain("Steps that need a look");
    expect(report).toContain("derived from the locator");
  });

  it("names every value that became a secret indirection", () => {
    // The frozen project's `.data` file is empty, so the committed report has no
    // such section. The behaviour is still worth holding: nobody should discover
    // at run time that a password now reads a variable nobody set (REQ-NFR-6).
    const rendered = renderReviewReport({
      source: "src",
      destination: "dest",
      files: ["data.yaml"],
      notes: [
        {
          file: "store/svatah.data",
          line: 0,
          kind: "secret",
          message: '"user.password" looks like a secret, so it reads ${YAM_USER_PASSWORD}.',
        },
      ],
      unmapped: 0,
      stories: [],
    });
    expect(rendered).toContain("Values that became secrets");
    expect(rendered).toContain("YAM_USER_PASSWORD");
    expect(rendered).toContain("REQ-NFR-6");
  });

  it("says plainly when a step could not be converted", () => {
    const rendered = renderReviewReport({
      source: "src",
      destination: "dest",
      files: [],
      notes: [],
      unmapped: 2,
      stories: [],
    });
    // Left in the flow as a comment rather than dropped: a missing step is much
    // harder to notice than an obviously unfinished one.
    expect(rendered).toContain("2 step(s) could not be converted");
    expect(rendered).toContain("TODO(migrate)");
    expect(rendered).toContain("exit code is 8");
  });
});
