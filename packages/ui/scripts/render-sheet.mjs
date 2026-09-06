#!/usr/bin/env node
/**
 * Render the component sheet to a static page (T9.2, LLD §13.7).
 *
 *   pnpm --filter @svatah/ui sheet            # writes sheet/index.html
 *   pnpm --filter @svatah/ui sheet --open     # and prints the file:// URL
 *
 * > a component sheet page rendering all of them in both themes that the
 * > accessibility adapters can read.
 *
 * Server-rendered, and that is the point: the page has no bundler, no
 * `<script>` and no network, so `scripts/audit-sheet.mjs` reads it with a DOM
 * parser and a person opens it in any browser — including the packaged ADE's,
 * which is what "the accessibility adapters can read" means.
 *
 * The interactive parts (the palette opens; the tabs switch) are what the ADE
 * itself exercises under Playwright in T9.4. A static sheet is for the *shapes*:
 * every control's role, name and id, in both themes, in one document.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComponentSheet } from "../dist/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE = join(HERE, "..");
const OUT = join(PACKAGE, "sheet");

const tokens = readFileSync(join(PACKAGE, "..", "ui-tokens", "tokens.css"), "utf8");
const ui = readFileSync(join(PACKAGE, "ui.css"), "utf8");

/*
 * The fonts are referenced from `../ui-tokens/fonts/`, because the sheet is
 * written beside the package rather than into it. A relative URL keeps the page
 * openable from the filesystem, which is how anyone will actually look at it.
 */
const styles = tokens.split('url("./fonts/').join('url("../../ui-tokens/fonts/');

const body = renderToStaticMarkup(createElement(ComponentSheet));

const html = `<!doctype html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Svatah design system — component sheet</title>
  <style>
${styles}
${ui}
  </style>
</head>
<body class="sv-root">
${body}
</body>
</html>
`;

mkdirSync(OUT, { recursive: true });
const file = join(OUT, "index.html");
writeFileSync(file, html, "utf8");
process.stderr.write(`wrote ${file}\n`);
if (process.argv.includes("--open")) process.stdout.write(`file://${file}\n`);
