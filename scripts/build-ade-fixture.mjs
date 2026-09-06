#!/usr/bin/env node
/**
 * Build the prototype electron-db fixture (T6.6, REQ-ADE-9).
 *
 *   node scripts/build-ade-fixture.mjs [--out evals/migrate/ade-db]
 *
 * ## Why this is synthesised, and why it is still worth trusting
 *
 * No Svatah ADE prototype database was available on the machine T6.6 was
 * implemented on, and REQ-ADE-9's Validate needs one. So this builds one — and
 * neither its shape nor its content is invented:
 *
 * * The **tables and columns** are the prototype's own, read from
 *   `src/js/dbclient.js` in `github.com/a-t-u-l/svatahADE`. That is where the
 *   two JSON-inside-a-column fields come from and where their key names come
 *   from: nothing else would tell you that a locator row's keys are
 *   `"locator identifier"` and `"locator details"`, with spaces.
 * * The **flows and locators** are the real legacy files from
 *   `evals/migrate/source`, HTML-escaped the way the prototype's
 *   contenteditable editor stored them (`newproject.js` strips the tags on the
 *   way in and leaves the entities).
 *
 * What is synthetic is the packaging, and the packaging is exactly what the
 * importer reads. `docs/spec/progress/phase-6.md` records this as the
 * environment fallback it is.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const at = args.indexOf("--out");
const OUT = join(ROOT, at < 0 ? "evals/migrate/ade-db" : args[at + 1]);

mkdirSync(OUT, { recursive: true });

/** The prototype stored a flow as stripped innerHTML, entities and all. */
const escape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const FLOWS = ["simple", "svatah", "natural_language_login", "execution"];
const flows = FLOWS.map((name) => ({
  flowFile: escape(
    readFileSync(join(ROOT, "evals/migrate/source/sample", `${name}.flow`), "utf8"),
  ),
  flowFileName: `${name}.flow`,
  projectName: "Zoomcar regression",
}));

/** `.locator` lines → the JSON array the prototype kept in `project.locatorFile`. */
const locators = readFileSync(join(ROOT, "evals/migrate/source/locator/svatah.locator"), "utf8")
  .split("\n")
  .filter((line) => line.trim() !== "" && !line.trim().startsWith("#") && line.includes("="))
  .map((line) => {
    const equals = line.indexOf("=");
    return {
      "locator identifier": line.slice(0, equals).trim(),
      "locator details": line.slice(equals + 1).trim(),
    };
  });

const data = [
  { "variable name": "email", "variable value": "connected2atul@gmail.com" },
  { "variable name": "password", "variable value": "qwerty123" },
  { "variable name": "date", "variable value": "2026-09-03" },
];

const write = (table, rows) =>
  writeFileSync(
    join(OUT, `${table}.json`),
    `${JSON.stringify({ [table]: rows.map((row, index) => ({ id: index + 1, ...row })) }, null, 2)}\n`,
  );

write("project", [
  {
    name: "Zoomcar regression",
    locatorFile: JSON.stringify(locators, null, 2),
    configName: "regression",
  },
  // A second project, so `--project` has something to choose between and the
  // "more than one project" note has something to fire on.
  { name: "Smoke", locatorFile: "", configName: "smoke" },
]);

write("config", [
  {
    name: "regression",
    browser: "chrome",
    threadCount: "3",
    url: "http://localhost:4173",
    projectName: "Zoomcar regression",
    takeStepScreenshot: "true",
    dataFile: JSON.stringify(data, null, 2),
    screenDimension: "1920x1080",
  },
  {
    // `internet explorer` has no Playwright equivalent, so the import drops the
    // browser setting and says so. That path needs an input to exercise it.
    name: "smoke",
    browser: "internet explorer",
    threadCount: "1",
    url: "http://localhost:4173",
    projectName: "Smoke",
    takeStepScreenshot: "false",
    dataFile: "",
    screenDimension: "1920x1080",
  },
]);

write("flows", flows);

write("api", [
  {
    name: "active count",
    projectName: "Zoomcar regression",
    httpMethod: "GET",
    uri: "http://localhost:4173/api/active-count",
    requestBody: "",
    acceptAllSslCert: "false",
    headers: "accept: application/json",
    contentType: "",
    followRedirect: "true",
  },
  {
    // `acceptAllSslCert` is the one field with no v3 equivalent; it is dropped
    // with a note rather than written into a file that would fail to validate.
    name: "create booking",
    projectName: "Zoomcar regression",
    httpMethod: "POST",
    uri: "http://localhost:4173/api/bookings",
    requestBody: '{"location":"Indiranagar"}',
    acceptAllSslCert: "true",
    headers: "",
    contentType: "application/json",
    followRedirect: "false",
  },
]);

/* The tables REQ-ADE-9 excludes. Present on disk, so the import has to say so. */
write("results", [
  {
    uid: "r1",
    projectName: "Zoomcar regression",
    configName: "regression",
    url: "http://localhost:4173",
    browser: "chrome",
    startTime: "2023-02-11T09:00:00Z",
    endTime: "2023-02-11T09:04:00Z",
    timeTaken: "4m",
    passed: "18",
    failed: "2",
    skipped: "0",
  },
]);
write("images", [
  {
    resultId: "r1",
    flowName: "simple.flow",
    scenarioName: "I want to validate login",
    stepNumber: "3",
    imgString: "data:image/png;base64,iVBORw0KGgo=",
  },
]);
write("settings", [{ uid: "u1", darkmode: "true", takeTour: "false" }]);

process.stdout.write(
  `wrote 7 table(s) to ${OUT}: ${flows.length} flows, ${locators.length} locators, ` +
    `${data.length} data values\n`,
);
