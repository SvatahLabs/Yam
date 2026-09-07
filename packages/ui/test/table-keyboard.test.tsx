/**
 * A selectable row is a keyboard target (SF-18).
 *
 * Wave 3's first cut gave rows a click handler and nothing else, so the one
 * list on Surfaces a person chooses among — the open sessions — could not be
 * reached without a mouse. The keyboard-only journey the requirement names
 * (connect, select, act, check, close) broke at "select" whenever there was
 * more than one session to choose from.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Table } from "../src/index.js";

afterEach(cleanup);

const columns = [{ key: "id", header: "id", cell: (row: { id: string }) => row.id }];
const rows = [{ id: "a" }, { id: "b" }];

describe("a selectable row is reachable and choosable by keyboard", () => {
  it("is in the tab order, and Enter or Space chooses it", () => {
    const onSelect = vi.fn();
    render(
      <Table id="sessions" label="Sessions" rows={rows} rowKey={(row) => row.id} selected="" onSelect={onSelect} columns={columns} />,
    );
    const [first, second] = screen.getAllByRole("row").slice(1);
    expect(first!.getAttribute("tabindex")).toBe("0");
    fireEvent.keyDown(first!, { key: "Enter" });
    expect(onSelect).toHaveBeenLastCalledWith("a");
    fireEvent.keyDown(second!, { key: " " });
    expect(onSelect).toHaveBeenLastCalledWith("b");
  });

  it("the arrows walk the rows", () => {
    render(
      <Table id="sessions" label="Sessions" rows={rows} rowKey={(row) => row.id} selected="" onSelect={() => undefined} columns={columns} />,
    );
    const [first, second] = screen.getAllByRole("row").slice(1);
    first!.focus();
    fireEvent.keyDown(first!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(second);
    fireEvent.keyDown(second!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(first);
  });

  it("a row nobody can choose is not a tab stop", () => {
    render(<Table id="sessions" label="Sessions" rows={rows} rowKey={(row) => row.id} columns={columns} />);
    const [first] = screen.getAllByRole("row").slice(1);
    expect(first!.getAttribute("tabindex")).toBeNull();
  });
});
