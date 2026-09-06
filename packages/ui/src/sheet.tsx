/**
 * The component sheet (T9.2, LLD §13.7; the `Tokens` artboard).
 *
 * > a component sheet page rendering all of them in both themes that the
 * > accessibility adapters can read.
 *
 * Every component in the package, once per theme, on one page. Three things use
 * it:
 *
 *   * the accessibility audit (`scripts/audit-sheet.mjs`), which reads the
 *     rendered page and checks the rules of §13.7 — every interactive control
 *     named and id'd, every status word beside its colour, every field labelled,
 *     no duplicate ids, contrast at or above WCAG AA;
 *   * `test/sheet.test.tsx`, which renders it in jsdom and asserts the
 *     accessible names the mockups name;
 *   * a person, who opens `sheet/index.html` and looks at it.
 *
 * It is a component rather than a static page so that it cannot drift: a
 * component whose props changed and whose sheet entry did not would not compile.
 */
import { useState } from "react";
import { STATUS_TONES, THEMES, TYPE, type Theme } from "@svatah/yam-ui-tokens";
import { Button, Chooser, Field, Kbd } from "./components/controls.js";
import {
  Alert,
  Chip,
  InspectorSection,
  KeyValues,
  Pill,
  RailItem,
  TabStrip,
  Table,
} from "./components/display.js";
import { CommandPalette } from "./components/palette.js";

interface Row {
  element: string;
  state: "verified" | "unverified";
  score: string;
}

const ROWS: Row[] = [
  { element: "nav.book-a-slot-link", state: "verified", score: "0.98" },
  { element: "checkout.pay-button", state: "unverified", score: "—" },
];

/**
 * One theme's half of the sheet.
 *
 * `data-theme` on a wrapper rather than on `<html>`, because the whole point of
 * the sheet is that both themes are on the page at once and can be compared —
 * and because a component that read the theme from anywhere would fail T9.2's
 * "the two themes differ only in tokens".
 */
function Half({ theme }: { readonly theme: Theme }): React.JSX.Element {
  const suffix = theme === "dark" ? "" : "-light";
  const [paletteOpen, setPaletteOpen] = useState(false);

  /*
   * Every section's heading says which theme it belongs to (P9-F3, T10.4).
   *
   * `InspectorSection` renders a `<section aria-labelledby>`, which is a
   * `region` landmark, and the sheet draws each of the eleven twice — once per
   * theme. Two landmarks with the same role and the same accessible name are
   * indistinguishable to anyone navigating by landmark, which is axe-core's
   * `landmark-unique` and eleven violations of it on this page (the Phase 9
   * verification, F3).
   *
   * The name is made unique by saying the true thing rather than by hiding a
   * label: this *is* the dark half's Buttons section, and a reader jumping to
   * "Buttons — Light" gets the one they meant. LLD §13.7's rule that a visible
   * label is the accessible name is kept — the heading reads what the landmark
   * is called.
   */
  const named = (title: string): string => `${title} — ${theme === "dark" ? "Dark" : "Light"}`;

  return (
    <section
      data-theme={theme}
      className="sv-sheet-half"
      aria-labelledby={`sheet-${theme}-heading`}
    >
      <h2 id={`sheet-${theme}-heading`} className="sv-sheet-heading">
        {theme === "dark" ? "Dark" : "Light"}
      </h2>

      <InspectorSection id={`sheet-buttons${suffix}`} title={named("Buttons")}>
        <div className="sv-sheet-row">
          <Button id={`sheet-run${suffix}`} label="Run" variant="primary" accelerator="⌘↵" />
          <Button id={`sheet-record${suffix}`} label="Record" accelerator="R" />
          <Button id={`sheet-reject${suffix}`} label="Reject" variant="danger" accelerator="X" />
          <Button id={`sheet-open-folder${suffix}`} label="Open folder" variant="ghost" />
          <Button id={`sheet-disabled${suffix}`} label="Resume from step 5" disabled />
        </div>
      </InspectorSection>

      <InspectorSection id={`sheet-fields${suffix}`} title={named("Fields")}>
        <div className="sv-sheet-row">
          <Field id={`sheet-filter${suffix}`} label="Filter flows" placeholder="Filter flows…" />
          <Chooser
            id={`sheet-gateway${suffix}`}
            label="Gateway"
            value="fake"
            options={[
              { value: "anthropic", label: "anthropic — no credential on this service", disabled: true },
              { value: "fake", label: "fake — committed answers from evals/grounding/cases" },
            ]}
          />
        </div>
      </InspectorSection>

      <InspectorSection id={`sheet-status${suffix}`} title={named("Status")}>
        <div className="sv-sheet-row">
          {STATUS_TONES.map((tone) => (
            <Pill key={tone} tone={tone} label={WORD[tone]} glyph />
          ))}
        </div>
        <div className="sv-sheet-row">
          <Chip tone="pass">service 127.0.0.1:55702</Chip>
          <Chip>page: all</Chip>
          <Kbd>⌘K</Kbd>
          <Kbd>Esc</Kbd>
        </div>
      </InspectorSection>

      <InspectorSection id={`sheet-rail${suffix}`} title={named("Rail")}>
        <nav className="sv-sheet-rail" aria-label={`Sections (${theme})`}>
          <RailItem id={`sheet-rail-flows${suffix}`} label="Flows" count={7} />
          <RailItem id={`sheet-rail-runs${suffix}`} label="Runs" count={12} active />
          <RailItem id={`sheet-rail-bindings${suffix}`} label="Bindings" count={41} />
        </nav>
      </InspectorSection>

      <InspectorSection id={`sheet-table${suffix}`} title={named("Table")}>
        <Table<Row>
          id={`sheet-bindings-table${suffix}`}
          label="Bindings"
          rows={ROWS}
          rowKey={(row) => row.element}
          selected="nav.book-a-slot-link"
          columns={[
            { key: "element", header: "element", monospace: true, cell: (row) => row.element },
            {
              key: "state",
              header: "state",
              cell: (row) => (
                <Pill
                  tone={row.state === "verified" ? "pass" : "abort"}
                  label={row.state}
                />
              ),
            },
            { key: "score", header: "score", align: "right", cell: (row) => row.score },
          ]}
        />
      </InspectorSection>

      <InspectorSection id={`sheet-tabs${suffix}`} title={named("Tabs")}>
        <TabStrip
          id={`sheet-tabstrip${suffix}`}
          label="Flow views"
          value={`sheet-tab-editor${suffix}`}
          onChange={() => undefined}
          tabs={[
            {
              id: `sheet-tab-editor${suffix}`,
              label: "guards-and-compensation.flow",
              content: <p className="sv-mono">story: I want to see guards decide</p>,
            },
            { id: `sheet-tab-plan${suffix}`, label: "Plan", content: <p>Compiled steps.</p> },
            { id: `sheet-tab-history${suffix}`, label: "History", content: <p>Past runs.</p> },
          ]}
        />
      </InspectorSection>

      <InspectorSection id={`sheet-inspector${suffix}`} title={named("Inspector")}>
        <KeyValues
          rows={[
            { key: "Compiles at", value: "Tier 1 · grammar, pattern 28" },
            { key: "Target", value: <span className="sv-mono">booking.cancel-booking-button</span> },
            { key: "Binding", value: <Pill tone="pass" label="verified" /> },
            { key: "Guard", value: 'onlyIf · scope · {status} = "Cancelled"' },
          ]}
        />
      </InspectorSection>

      <InspectorSection id={`sheet-alerts${suffix}`} title={named("Alerts")}>
        <Alert id={`sheet-alert-fail${suffix}`} tone="fail">
          The Yam ADE could not find a Node 22 or newer to run{" "}
          <span className="sv-mono">yam serve</span>. It looked in three places: YAM_NODE,
          PATH, resources/yam/node.
        </Alert>
        <Alert id={`sheet-alert-warn${suffix}`} tone="abort">
          “the pay button” is bound to <span className="sv-mono">checkout.pay-button</span>, which
          no recording has verified. Record the story or run a dry resolve.
        </Alert>
      </InspectorSection>

      <InspectorSection id={`sheet-type${suffix}`} title={named("Type ramp")}>
        <ul className="sv-sheet-type">
          {Object.entries(TYPE).map(([name, ramp]) => (
            <li key={name} style={{ fontSize: `${ramp.size}px`, fontWeight: ramp.weight }}>
              {name} — {ramp.size} / {ramp.weight}
            </li>
          ))}
        </ul>
      </InspectorSection>

      <InspectorSection id={`sheet-palette${suffix}`} title={named("Command palette")}>
        <Button
          id={`sheet-open-palette${suffix}`}
          label="Open the command palette"
          accelerator="⌘K"
          onPress={() => setPaletteOpen(true)}
        />
        <CommandPalette
          id={`sheet-command-palette${suffix}`}
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onChoose={() => setPaletteOpen(false)}
          rows={[
            {
              id: "run.flow",
              label: "Run guards-and-compensation.flow",
              group: "Actions",
              area: "run",
              key: "⌘↵",
              cli: "yam run --flow flows/guards-and-compensation.flow",
              available: true,
            },
            {
              id: "heal.run",
              label: "Heal run comp",
              group: "Actions",
              area: "heal",
              key: "H",
              cli: "yam heal --run comp",
              available: true,
            },
            {
              id: "go.runs",
              label: "Run comp",
              group: "Go to",
              area: "runs",
              detail: "aborted 4 min ago",
              available: true,
            },
          ]}
        />
      </InspectorSection>

      <InspectorSection id={`sheet-tokens${suffix}`} title={named("Tokens")}>
        <ul className="sv-sheet-swatches">
          {Object.entries(THEMES[theme]).map(([name, value]) => (
            <li key={name}>
              <span
                className="sv-sheet-swatch"
                style={{ background: value }}
                aria-hidden="true"
              />
              <span className="sv-mono">
                {name} {value}
              </span>
            </li>
          ))}
        </ul>
      </InspectorSection>
    </section>
  );
}

/** The word beside each status colour. Never a colour on its own (LLD §13.7). */
const WORD: Record<(typeof STATUS_TONES)[number], string> = {
  pass: "passed",
  fail: "failed",
  skip: "skipped",
  healed: "healed",
  abort: "aborted",
  info: "running",
  neutral: "not run",
};

/** The whole sheet: every component, both themes, on one page. */
export function ComponentSheet(): React.JSX.Element {
  return (
    <main className="sv-sheet" aria-labelledby="sheet-heading">
      <h1 id="sheet-heading">Yam design system · component sheet</h1>
      <p className="sv-sheet-intro">
        Every component in <span className="sv-mono">@svatah/yam-ui</span>, in both themes. Every
        interactive control here has a visible label that is its accessible name and an id in the{" "}
        <span className="sv-mono">automationId</span> form; every status colour has a word beside
        it. Those two rules are what the desktop adapters and a screen reader both depend on.
      </p>
      <Half theme="dark" />
      <Half theme="light" />
    </main>
  );
}
