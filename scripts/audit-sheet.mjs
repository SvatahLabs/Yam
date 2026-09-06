#!/usr/bin/env node
/**
 * The component sheet's accessibility audit (T9.2, LLD §13.7, REQ-ADE-12).
 *
 *   pnpm sheet:audit                       # audit the rendered sheet
 *   pnpm sheet:audit --json                # the findings as JSON
 *   pnpm sheet:audit --axe <axe.min.js>    # additionally run axe-core
 *
 * ## Why this exists rather than axe-core alone
 *
 * T9.2's Validate says "the sheet passes an axe-core run with zero violations".
 * axe-core is **MPL-2.0**, and REQ-PKG-3 admits MIT, Apache-2.0 and BSD only —
 * `scripts/check-licenses.mjs` refuses MPL by name. The two requirements cannot
 * both be satisfied by adding the dependency, and the phase's working rules say
 * "permissive licences only", so this is a check of our own over the rules the
 * sheet actually has to keep, and `--axe` is how axe-core runs beside it. The
 * deviation is recorded in `docs/spec/progress/phase-9.md`.
 *
 * ## The audit and axe must agree (Draft 2.12 §13.7, P9-F3)
 *
 * > The sheet's accessibility audit implements every axe-core rule the sheet has
 * > ever failed, `landmark-unique` included, and CI fetches axe-core at test
 * > time, outside the dependency tree, to run beside it; a rule axe reports and
 * > the audit does not is a defect in the audit.
 *
 * The Phase 9 verification ran a real axe-core against a sheet this audit called
 * clean and found eleven `landmark-unique` violations — two landmarks per
 * component section, one for each theme, with the same role and the same name.
 * `a11y-landmark-unique` below is that rule, implemented here; `--axe` is what
 * proves the two agree, and `tools/repo-checks/test/sheet-audit.test.ts` fetches
 * axe-core at test time so CI runs both.
 *
 * ## The rules
 *
 * Not "every axe rule": the ones LLD §13.7's accessibility contract names, plus
 * the ones a component library can actually violate. Each is a *rule* with an
 * id, so a failure names something rather than pointing at a node.
 *
 *   a11y-name        every interactive element has an accessible name
 *   a11y-id          every interactive element has an automationId-form id
 *   a11y-unique-id   no id appears twice in the document
 *   a11y-label       every input is named by a <label for> or an aria-label
 *   a11y-button-type every <button> says what kind it is
 *   a11y-heading     headings descend without skipping a level
 *   a11y-landmark    the page has a main landmark and a heading
 *   a11y-landmark-unique  no two landmarks share a role and an accessible name
 *   a11y-contrast    text meets WCAG AA against what is behind it
 *   a11y-colour-word no status colour appears without a word beside it
 *   a11y-lang        the document declares a language
 *
 * The contrast rule is the one worth explaining. It resolves each element's
 * colour and background through the token tables — the same values `tokens.css`
 * declares — rather than through a layout engine, because a static page has no
 * computed style. That makes it a check of the *palette*, which is what the
 * design system is; a check of the rendered pixels is what a browser-based axe
 * run adds, and `--axe` is where that goes.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";
import { DARK, LIGHT } from "@svatah/yam-ui-tokens";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const option = (name) => {
  const at = argv.indexOf(`--${name}`);
  return at < 0 ? undefined : argv[at + 1];
};
const asJson = argv.includes("--json");
const sheet = resolve(option("sheet") ?? join(ROOT, "packages", "ui", "sheet", "index.html"));

if (!existsSync(sheet)) {
  process.stderr.write(
    `${sheet} does not exist. Run \`pnpm --filter @svatah/yam-ui sheet\` first.\n`,
  );
  process.exit(2);
}

const dom = new JSDOM(readFileSync(sheet, "utf8"));
const { document, CSS } = dom.window;
const findings = [];
const fail = (rule, message, node) => {
  findings.push({
    rule,
    message,
    node: node === undefined ? undefined : outline(node),
  });
};

/** `<button id="run-flow" class="sv-btn">` — enough to find it, not the subtree. */
function outline(node) {
  const attrs = [...node.attributes]
    .filter((one) => ["id", "class", "role", "aria-label", "type", "for"].includes(one.name))
    .map((one) => ` ${one.name}="${one.value}"`)
    .join("");
  return `<${node.tagName.toLowerCase()}${attrs}>`;
}

/* ── the accessible name, as far as a static document can compute it ───────── */

const INTERACTIVE = "button, a[href], input, select, textarea, [role='button'], [role='option'], [role='tab'], [role='combobox'], [role='link'], [role='checkbox'], [role='switch']";

function accessibleName(node) {
  const aria = node.getAttribute("aria-label");
  if (aria !== null && aria.trim() !== "") return aria.trim();

  const labelledBy = node.getAttribute("aria-labelledby");
  if (labelledBy !== null) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent ?? "")
      .join(" ")
      .trim();
    if (text !== "") return text;
  }

  if (node.id !== "") {
    const label = document.querySelector(`label[for="${CSS.escape(node.id)}"]`);
    if (label !== null && (label.textContent ?? "").trim() !== "") {
      return (label.textContent ?? "").trim();
    }
  }

  const closest = node.closest("label");
  if (closest !== null && (closest.textContent ?? "").trim() !== "") {
    return (closest.textContent ?? "").trim();
  }

  /*
   * The element's own text, minus anything hidden from the tree. A button whose
   * only visible text is `aria-hidden` — an icon, an accelerator — has no name,
   * and that is exactly the defect this rule is about.
   */
  const clone = node.cloneNode(true);
  for (const hidden of clone.querySelectorAll("[aria-hidden='true']")) hidden.remove();
  const own = (clone.textContent ?? "").replace(/\s+/g, " ").trim();
  if (own !== "") return own;

  const placeholder = node.getAttribute("placeholder");
  return placeholder === null ? "" : placeholder.trim();
}

const ID_FORM = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

/* ── rules ────────────────────────────────────────────────────────────────── */

/**
 * Is this element in the accessibility tree at all?
 *
 * Radix's `Select` renders a hidden native `<select>` beside the button it
 * actually draws, so a form submission carries the value. It is `aria-hidden`
 * and `tabIndex={-1}`: no screen reader reads it and no adapter can reach it,
 * so an audit that demanded a name for it would be demanding a name for
 * something that does not exist as far as the contract is concerned.
 *
 * The rule is the accessibility tree's own: `aria-hidden="true"` on the element
 * or on any ancestor removes the subtree, and so does the `hidden` attribute.
 */
function inTheTree(node) {
  for (let one = node; one !== null; one = one.parentElement) {
    if (one.getAttribute?.("aria-hidden") === "true") return false;
    if (one.hasAttribute?.("hidden")) return false;
  }
  return true;
}

const interactive = [...document.querySelectorAll(INTERACTIVE)].filter(inTheTree);
if (interactive.length === 0) fail("a11y-name", "The sheet has no interactive elements at all.");

for (const node of interactive) {
  const name = accessibleName(node);
  if (name === "") fail("a11y-name", "An interactive element has no accessible name.", node);

  const id = node.getAttribute("id") ?? "";
  if (id === "") {
    fail("a11y-id", "An interactive element has no id for the desktop adapters.", node);
  } else if (!ID_FORM.test(id)) {
    fail("a11y-id", `The id "${id}" is not in the automationId form.`, node);
  }

  if (node.tagName === "BUTTON" && node.getAttribute("type") === null) {
    fail("a11y-button-type", "A <button> with no type submits its form.", node);
  }
}

/* Every input is named by something a form control can be named by. */
for (const node of [...document.querySelectorAll("input, select, textarea")].filter(inTheTree)) {
  const byLabel =
    node.id !== "" && document.querySelector(`label[for="${CSS.escape(node.id)}"]`) !== null;
  const byAria =
    (node.getAttribute("aria-label") ?? "").trim() !== "" ||
    node.getAttribute("aria-labelledby") !== null;
  if (!byLabel && !byAria) {
    fail("a11y-label", "A form control has neither a <label for> nor an aria-label.", node);
  }
}

/* No id twice. Two elements with one id is one element the adapters can find. */
const seen = new Map();
for (const node of document.querySelectorAll("[id]")) {
  const id = node.getAttribute("id");
  if (seen.has(id)) {
    fail("a11y-unique-id", `The id "${id}" appears more than once.`, node);
  }
  seen.set(id, node);
}

/* Headings descend one level at a time. */
let previous = 0;
for (const heading of document.querySelectorAll("h1, h2, h3, h4, h5, h6")) {
  const level = Number(heading.tagName.slice(1));
  if (previous !== 0 && level > previous + 1) {
    fail(
      "a11y-heading",
      `A heading jumps from h${previous} to h${level}; a screen reader's outline has a hole in it.`,
      heading,
    );
  }
  previous = level;
}

if (document.querySelector("main") === null) {
  fail("a11y-landmark", "The page has no <main> landmark.");
}

/*
 * Two landmarks with one name (axe-core's `landmark-unique`, P9-F3).
 *
 * A landmark is how someone navigating without a pointer jumps around a page,
 * and two regions called "Buttons" are two destinations with one name. The
 * sheet draws every component section twice — once per theme — so this is the
 * rule it is most able to break, and it broke it eleven times before the
 * headings started saying which half they belong to.
 *
 * `<section>` and `<form>` are landmarks *only when named*, which is why the
 * name is computed first and an unnamed one is skipped rather than counted as a
 * collision of empties.
 */
const LANDMARKS = {
  main: "main",
  nav: "navigation",
  aside: "complementary",
  header: "banner",
  footer: "contentinfo",
  form: "form",
  section: "region",
};

const landmarks = new Map();
for (const node of document.querySelectorAll(
  "main, nav, aside, header, footer, form, section, [role]",
)) {
  if (!inTheTree(node)) continue;
  const explicit = (node.getAttribute("role") ?? "").trim();
  const role = explicit === "" ? LANDMARKS[node.tagName.toLowerCase()] : explicit;
  if (role === undefined || !Object.values(LANDMARKS).includes(role)) continue;
  const name = accessibleName(node);
  // An unnamed `<section>` or `<form>` is not a landmark at all, and an unnamed
  // `<nav>` is one landmark of its kind — neither is a duplicate name.
  if (name === "") continue;
  const key = `${role}\u0000${name.toLowerCase()}`;
  if (landmarks.has(key)) {
    fail(
      "a11y-landmark-unique",
      `Two "${role}" landmarks are both called "${name}"; landmark navigation cannot ` +
        "tell them apart.",
      node,
    );
  }
  landmarks.set(key, node);
}
if (document.querySelector("h1") === null) {
  fail("a11y-landmark", "The page has no level-1 heading.");
}
if ((document.documentElement.getAttribute("lang") ?? "") === "") {
  fail("a11y-lang", "The document does not declare a language.");
}

/* ── colour never carries meaning alone ───────────────────────────────────── */

for (const pill of document.querySelectorAll(".sv-pill, .sv-alert")) {
  const clone = pill.cloneNode(true);
  for (const hidden of clone.querySelectorAll("[aria-hidden='true']")) hidden.remove();
  if ((clone.textContent ?? "").trim() === "") {
    fail(
      "a11y-colour-word",
      "A status colour appears with no word beside it (LLD §13.7).",
      pill,
    );
  }
}

/* ── contrast, through the tokens ─────────────────────────────────────────── */

/** `#0f1216` or `rgba(…)` → `[r, g, b, a]`. */
function rgba(value) {
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex !== null) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 1];
  }
  const parts = /^rgba?\(([^)]+)\)$/i.exec(value.trim());
  if (parts === null) return undefined;
  const numbers = parts[1].split(",").map((one) => Number(one.trim()));
  if (numbers.length < 3 || numbers.some((one) => !Number.isFinite(one))) return undefined;
  return [numbers[0], numbers[1], numbers[2], numbers[3] ?? 1];
}

/** Composite a translucent colour over an opaque one. */
function over(front, back) {
  const a = front[3];
  return [
    front[0] * a + back[0] * (1 - a),
    front[1] * a + back[1] * (1 - a),
    front[2] * a + back[2] * (1 - a),
    1,
  ];
}

function luminance([r, g, b]) {
  const channel = (one) => {
    const c = one / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(front, back) {
  const a = luminance(front) + 0.05;
  const b = luminance(back) + 0.05;
  return a > b ? a / b : b / a;
}

/**
 * Every text colour that appears on the sheet, against what it appears on.
 *
 * The pairs are declared rather than discovered: a static document has no
 * computed style, and guessing an ancestor's background from a class name would
 * be a check that passes because it looked in the wrong place. These are the
 * pairs `ui.css` actually produces.
 */
const PAIRS = [
  ["fg", "bg0", 4.5, "body text"],
  ["fg", "bg1", 4.5, "text on a panel"],
  ["fg", "bg2", 4.5, "text on a button"],
  ["fg2", "bg0", 4.5, "secondary text"],
  ["fg2", "bg3", 4.5, "a key cap"],
  ["muted", "bg0", 4.5, "meta text"],
  ["dim", "bg0", 3, "a section label"],
  ["accent-ink", "accent", 4.5, "the primary button"],
  ["pass", "bg0", 3, "the pass pill"],
  ["fail", "bg0", 3, "the fail pill"],
  ["skip", "bg0", 3, "the skip pill"],
  ["healed", "bg0", 3, "the healed pill"],
  ["abort", "bg0", 3, "the abort pill"],
  ["info", "bg0", 3, "the running pill"],
  ["accent", "bg0", 3, "the focus ring"],
];

for (const [theme, table] of [
  ["dark", DARK],
  ["light", LIGHT],
]) {
  const base = rgba(table["bg0"]);
  for (const [front, back, minimum, what] of PAIRS) {
    const backing = rgba(table[back]);
    const text = rgba(table[front]);
    if (text === undefined || backing === undefined) {
      fail("a11y-contrast", `${theme}: --${front} or --${back} is not a colour.`);
      continue;
    }
    const measured = ratio(over(text, over(backing, base)), over(backing, base));
    if (measured < minimum) {
      fail(
        "a11y-contrast",
        `${theme}: ${what} is ${measured.toFixed(2)}:1 (--${front} on --${back}), ` +
          `below the ${minimum}:1 this text size needs.`,
      );
    }
  }
}

/* ── axe-core, when a verifier supplies one ───────────────────────────────── */

const axePath = option("axe");
if (axePath !== undefined) {
  /*
   * axe-core is MPL-2.0 and is therefore not a dependency of this repository
   * (REQ-PKG-3). A verifier who wants the third-party confirmation downloads it
   * and passes the path; the audit above is what runs in CI.
   */
  const window = new JSDOM(readFileSync(sheet, "utf8"), { runScripts: "outside-only" }).window;
  window.eval(readFileSync(resolve(axePath), "utf8"));
  const result = await window.axe.run(window.document);
  for (const violation of result.violations) {
    fail(`axe:${violation.id}`, `${violation.help} (${violation.nodes.length} node(s))`);
  }
  process.stderr.write(`axe-core ${window.axe.version}: ${result.violations.length} violation(s)\n`);
}

/* ── the report ───────────────────────────────────────────────────────────── */

const checked = {
  interactive: interactive.length,
  ids: seen.size,
  pills: document.querySelectorAll(".sv-pill").length,
  themes: 2,
  contrastPairs: PAIRS.length * 2,
  landmarks: landmarks.size,
};

if (asJson) {
  process.stdout.write(`${JSON.stringify({ sheet, checked, findings }, null, 2)}\n`);
} else if (findings.length === 0) {
  process.stdout.write(
    `${sheet}: 0 violations — ${checked.interactive} interactive elements named and id'd, ` +
      `${checked.ids} unique ids, ${checked.pills} status pills each with a word, ` +
      `${checked.landmarks} distinctly named landmarks, ` +
      `${checked.contrastPairs} contrast pairs across both themes.\n`,
  );
} else {
  process.stderr.write(`${sheet}: ${findings.length} violation(s)\n\n`);
  for (const one of findings) {
    process.stderr.write(`  ${one.rule}  ${one.message}\n${one.node === undefined ? "" : `      ${one.node}\n`}`);
  }
}

process.exit(findings.length === 0 ? 0 : 1);
