/**
 * T9.2 Validate — "the sheet passes an accessibility run with zero violations",
 * and the run is one that can fail.
 *
 * Two claims, and the second is the one worth testing. An audit that reports
 * zero violations on a good page and zero on a bad one reports nothing; every
 * rule in `scripts/audit-sheet.mjs` is therefore shown to bite here, against a
 * page written to break exactly one of them.
 *
 * ## About axe-core
 *
 * The task's wording is "an axe-core run". axe-core is MPL-2.0 and REQ-PKG-3
 * admits MIT, Apache-2.0 and BSD — `scripts/check-licenses.mjs` refuses MPL by
 * name, and this phase's working rules say "permissive licences only". So the
 * audit is ours, `--axe <path>` runs axe-core beside it for a verifier who has
 * a copy, and the deviation is recorded in `docs/spec/progress/phase-9.md`.
 *
 * Refs: T9.2, REQ-ADE-12, REQ-PKG-3, LLD §13.7.
 */
import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fromRoot, REPO_ROOT } from "../src/repo.js";

const AUDIT = fromRoot("scripts/audit-sheet.mjs");
const SHEET = fromRoot("packages/ui/sheet/index.html");

interface Finding {
  rule: string;
  message: string;
  node?: string;
}

interface Report {
  sheet: string;
  checked: { interactive: number; ids: number; pills: number; contrastPairs: number };
  findings: Finding[];
}

/** Run the audit over a page and read its JSON, whatever the exit code. */
function audit(sheet: string): Report {
  try {
    return JSON.parse(
      execFileSync(process.execPath, [AUDIT, "--sheet", sheet, "--json"], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        maxBuffer: 32 * 1024 * 1024,
      }),
    ) as Report;
  } catch (error) {
    const out = (error as { stdout?: string }).stdout;
    if (typeof out === "string" && out.trim().startsWith("{")) return JSON.parse(out) as Report;
    throw error;
  }
}

const workspaces: string[] = [];
afterEach(() => {
  while (workspaces.length > 0) rmSync(workspaces.pop()!, { recursive: true, force: true });
});

/** Write a one-off page and audit it. */
function auditPage(body: string, options: { lang?: string } = {}): Report {
  const dir = mkdtempSync(join(tmpdir(), "svatah-sheet-"));
  workspaces.push(dir);
  const file = join(dir, "index.html");
  writeFileSync(
    file,
    `<!doctype html><html${options.lang === undefined ? ' lang="en"' : ` lang="${options.lang}"`}>` +
      `<head><meta charset="utf-8"><title>probe</title></head>` +
      `<body><main><h1>Probe</h1>${body}</main></body></html>`,
    "utf8",
  );
  return audit(file);
}

const rules = (report: Report): string[] => [...new Set(report.findings.map((one) => one.rule))];

describe("the component sheet passes the audit (T9.2)", () => {
  it("has been rendered — `pnpm sheet` writes it", () => {
    expect(existsSync(SHEET), "run `pnpm sheet` first").toBe(true);
  });

  it("reports zero violations", () => {
    const report = audit(SHEET);
    expect(report.findings, JSON.stringify(report.findings, null, 2)).toEqual([]);
  });

  it("checked something: every component, both themes", () => {
    const report = audit(SHEET);
    // Two halves of the sheet, so every control appears twice.
    expect(report.checked.interactive).toBeGreaterThanOrEqual(20);
    expect(report.checked.pills).toBeGreaterThanOrEqual(14);
    // Fifteen colour pairs in each of the two themes.
    expect(report.checked.contrastPairs).toBe(30);
  });
});

describe("every rule in the audit can fail (T9.2)", () => {
  it("a11y-name — a button whose only text is hidden from the tree", () => {
    const report = auditPage('<button type="button" id="run-flow"><span aria-hidden="true">▶</span></button>');
    expect(rules(report)).toContain("a11y-name");
  });

  it("a11y-id — a named button with no id for the desktop adapters", () => {
    const report = auditPage('<button type="button">Run</button>');
    expect(rules(report)).toContain("a11y-id");
  });

  it("a11y-id — an id that is not in the automationId form", () => {
    const report = auditPage('<button type="button" id="Run Again">Run again</button>');
    expect(report.findings.some((one) => one.rule === "a11y-id" && /automationId/.test(one.message))).toBe(
      true,
    );
  });

  it("a11y-unique-id — the same id twice", () => {
    const report = auditPage(
      '<button type="button" id="run-flow">Run</button>' +
        '<button type="button" id="run-flow">Run again</button>',
    );
    expect(rules(report)).toContain("a11y-unique-id");
  });

  it("a11y-label — a field with a placeholder and no label", () => {
    const report = auditPage('<input id="filter-flows" placeholder="Filter flows…">');
    expect(rules(report)).toContain("a11y-label");
  });

  it("a11y-button-type — a button that would submit its form", () => {
    const report = auditPage('<button id="run-flow">Run</button>');
    expect(rules(report)).toContain("a11y-button-type");
  });

  it("a11y-heading — an outline with a hole in it", () => {
    const report = auditPage("<h3>Candidates</h3>");
    expect(rules(report)).toContain("a11y-heading");
  });

  it("a11y-colour-word — a status colour with no word beside it", () => {
    const report = auditPage('<span class="sv-pill"><span aria-hidden="true">✓</span></span>');
    expect(rules(report)).toContain("a11y-colour-word");
  });

  it("a11y-lang — a document that does not say what language it is in", () => {
    const report = auditPage("<p>Nothing wrong but the language.</p>", { lang: "" });
    expect(rules(report)).toContain("a11y-lang");
  });

  it("says nothing about an element the accessibility tree cannot see", () => {
    /*
     * Radix's `Select` renders a hidden native `<select>` so a form submission
     * carries the value. It is `aria-hidden` and untabbable: demanding a name
     * for it would be demanding a name for something that is not in the tree.
     */
    const report = auditPage(
      '<div aria-hidden="true"><select><option>a</option></select></div>' +
        '<button type="button" id="run-flow">Run</button>',
    );
    expect(report.findings).toEqual([]);
  });
});
