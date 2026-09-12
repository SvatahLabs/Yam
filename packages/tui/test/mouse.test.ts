/**
 * Reading the mouse (TV-T15, TV-10).
 *
 * The spike proved the bytes arrive and that Ink drops them; what is asserted
 * here is that they are decoded into the right thing, and that a click lands on
 * the row a person aimed at rather than one above it.
 */
import { describe, expect, it } from "vitest";
import { decodeMouse, hitTest, isMouse } from "../src/mouse.js";

const press = (column: number, row: number): string => `\u001b[<0;${column};${row}M`;
const release = (column: number, row: number): string => `\u001b[<0;${column};${row}m`;

describe("SGR 1006, which is what a wide terminal sends", () => {
  it("reads a press and a release as two things", () => {
    const found = decodeMouse(press(30, 10) + release(30, 10));
    expect(found.map((one) => one.kind)).toEqual(["down", "up"]);
    expect(found[0]).toEqual({ kind: "down", column: 30, row: 10 });
  });

  it("reads the wheel, which rides in the button's high bits", () => {
    expect(decodeMouse("\u001b[<64;5;5M")[0]!.kind).toBe("wheel-up");
    expect(decodeMouse("\u001b[<65;5;5M")[0]!.kind).toBe("wheel-down");
  });

  it("reads a column past what the old encoding could carry", () => {
    /* X10 packed the column into a byte and gave up at 223; terminals are wider. */
    expect(decodeMouse(press(260, 4))[0]!.column).toBe(260);
  });

  it("finds nothing in something typed", () => {
    expect(decodeMouse("hello")).toEqual([]);
    expect(isMouse("hello")).toBe(false);
    expect(isMouse(press(1, 1))).toBe(true);
  });

  it("reads several events from one chunk, in order", () => {
    const found = decodeMouse(press(1, 1) + press(2, 2) + press(3, 3));
    expect(found.map((one) => one.column)).toEqual([1, 2, 3]);
  });
});

describe("which region was clicked", () => {
  const boxes = new Map([
    ["tree", { x: 0, y: 0, width: 30, height: 20 }],
    ["main", { x: 30, y: 0, width: 50, height: 20 }],
    ["audit", { x: 0, y: 20, width: 80, height: 8 }],
  ]);

  it("finds the region under the pointer", () => {
    expect(hitTest(boxes, { kind: "down", column: 5, row: 5 })!.id).toBe("tree");
    expect(hitTest(boxes, { kind: "down", column: 40, row: 5 })!.id).toBe("main");
    expect(hitTest(boxes, { kind: "down", column: 40, row: 25 })!.id).toBe("audit");
  });

  it("counts the border and the title before the first row of text", () => {
    /*
     * The terminal counts from one, a box from zero, and a frame spends a row on
     * its border and a row on its title. A click on the first line of text is
     * row 3 of the terminal, and it is row 0 of the list.
     */
    expect(hitTest(boxes, { kind: "down", column: 5, row: 3 })!.row).toBe(0);
    expect(hitTest(boxes, { kind: "down", column: 5, row: 8 })!.row).toBe(5);
  });

  it("takes the chrome above the regions into account", () => {
    /* One row of status bar means everything is one row further down. */
    expect(hitTest(boxes, { kind: "down", column: 5, row: 4 }, 1)!.row).toBe(0);
  });

  it("finds nothing outside every region", () => {
    expect(hitTest(boxes, { kind: "down", column: 200, row: 5 })).toBeUndefined();
  });
});
