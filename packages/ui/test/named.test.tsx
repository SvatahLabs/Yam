/**
 * T9.2 Validate — "every interactive component throws in development without a
 * label and an id".
 *
 * The rule is LLD §13.7's accessibility contract, and the reason it is a test
 * rather than a review note is P8-F3: the app's Project screen shipped with
 * three unnamed buttons and the only thing that noticed was a verifier reading
 * an accessibility tree by hand a phase later.
 *
 * Every named component is rendered four ways — with both, without the label,
 * without the id, and with an id that is not in the `automationId` form — and
 * the last three must throw. `NAMED_COMPONENTS` is walked rather than a list
 * written here, so a component added without the rule fails this file.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  Button,
  Chooser,
  Field,
  NAMED_COMPONENTS,
  Pill,
  RailItem,
  TabStrip,
  Table,
  UnnamedControlError,
} from "../src/index.js";

/*
 * Vitest is not running with `globals: true`, so Testing Library's automatic
 * cleanup is not registered and one render would leak into the next — which
 * reads as "found multiple elements" rather than as the leak it is.
 */
afterEach(cleanup);

/** Each component, rendered with whatever `label` and `id` it is given. */
const RENDERERS: Record<string, (named: { label?: string; id?: string }) => ReactElement> = {
  Button: (named) => <Button label={named.label!} id={named.id!} />,
  Field: (named) => <Field label={named.label!} id={named.id!} />,
  Chooser: (named) => (
    <Chooser label={named.label!} id={named.id!} options={[{ value: "a", label: "A" }]} />
  ),
  Table: (named) => (
    <Table<{ a: string }>
      label={named.label!}
      id={named.id!}
      rows={[]}
      rowKey={(row) => row.a}
      columns={[{ key: "a", header: "A", cell: (row) => row.a }]}
    />
  ),
  RailItem: (named) => <RailItem label={named.label!} id={named.id!} />,
  TabStrip: (named) => (
    <TabStrip
      label={named.label!}
      id={named.id!}
      value="one"
      onChange={() => undefined}
      tabs={[{ id: "one", label: "One", content: null }]}
    />
  ),
};

describe("every interactive component demands a label and an id (T9.2)", () => {
  it("has a renderer here for every component the package declares named", () => {
    // The list is the package's, so a component added without the rule is a
    // failing test rather than a component nobody checked.
    expect(Object.keys(RENDERERS).sort()).toEqual([...NAMED_COMPONENTS].sort());
  });

  for (const name of NAMED_COMPONENTS) {
    describe(name, () => {
      const make = RENDERERS[name]!;

      it("renders with both, and the label is the accessible name", () => {
        const { container } = render(make({ label: "Run again", id: "run-again" }));
        /*
         * The name reaches the accessibility tree one of three ways, and which
         * one is a property of the role rather than a choice:
         *
         *   * visible text, for a button and a rail item;
         *   * a `<label for>`, for a field and a chooser;
         *   * `aria-label` on a container — a `tablist` and a `table` caption
         *     name a group, and there is no text node that is "the tab strip".
         */
        const named =
          screen.queryByText("Run again") ??
          screen.queryByLabelText("Run again") ??
          container.querySelector('[aria-label="Run again"]');
        expect(named, `${name} has no accessible name`).not.toBeNull();
      });

      it("throws without a label", () => {
        expect(() => render(make({ label: "", id: "run-again" }))).toThrow(UnnamedControlError);
      });

      it("throws on a label that is only whitespace, which is the same thing", () => {
        expect(() => render(make({ label: "   ", id: "run-again" }))).toThrow(UnnamedControlError);
      });

      it("throws without an id", () => {
        expect(() => render(make({ label: "Run again", id: "" }))).toThrow(/has no id/);
      });

      it("throws on an id that is not in the automationId form", () => {
        expect(() => render(make({ label: "Run again", id: "Run Again" }))).toThrow(
          /automationId form/,
        );
      });
    });
  }
});

describe("a status colour never appears alone (LLD §13.7)", () => {
  it("renders the word beside the colour", () => {
    render(<Pill tone="fail" label="failed" />);
    expect(screen.getByText("failed")).toBeDefined();
  });

  it("refuses a pill with no word", () => {
    expect(() => render(<Pill tone="fail" label="" />)).toThrow(/never appears without a word/);
  });

  it("hides the glyph from the accessibility tree, because the word is the name", () => {
    const { container } = render(<Pill tone="pass" label="passed" glyph />);
    const glyph = container.querySelector(".sv-pill-glyph");
    expect(glyph?.getAttribute("aria-hidden")).toBe("true");
    expect(container.textContent).toContain("passed");
  });
});

describe("the accelerator is drawn and not announced (LLD §13.7)", () => {
  it("keeps the accessible name to the label", () => {
    render(<Button label="Run" id="run-flow" accelerator="⌘↵" />);
    const button = screen.getByRole("button");
    // "Run", not "Run ⌘↵": the shortcut is decoration beside the name, and the
    // keys sheet is where they are announced.
    expect(button.textContent).toContain("Run");
    expect(button.querySelector("kbd")?.getAttribute("aria-hidden")).toBe("true");
  });
});
