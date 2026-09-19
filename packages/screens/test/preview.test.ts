/**
 * The screenshot preview: reading a PNG's size, inferring the scale between a
 * snapshot's boxes and the picture, and which control a point is (T15, SF-10).
 */
import { describe, expect, it } from "vitest";
import { base64, pngDataUrl, pngInfo, previewScale, refAt, type SurfaceTreeLine } from "../src/index.js";

/** A PNG's chunk: length, type, data, and a CRC nothing here checks. */
function chunk(type: string, data: number[]): number[] {
  const length = data.length;
  return [
    (length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff,
    ...[...type].map((one) => one.charCodeAt(0)),
    ...data,
    0, 0, 0, 0,
  ];
}

const u32 = (value: number): number[] => [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];

/** A PNG header with a size and, optionally, a density — enough for `pngInfo`. */
function png(width: number, height: number, pixelsPerMetre?: number): Uint8Array {
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ...chunk("IHDR", [...u32(width), ...u32(height), 8, 6, 0, 0, 0]),
    ...(pixelsPerMetre === undefined ? [] : chunk("pHYs", [...u32(pixelsPerMetre), ...u32(pixelsPerMetre), 1])),
    ...chunk("IDAT", []),
    ...chunk("IEND", []),
  ]);
}

const line = (ref: string, box: SurfaceTreeLine["box"], depth = 1, role = "button"): SurfaceTreeLine => ({
  ref,
  role,
  depth,
  states: [],
  selected: false,
  ...(box === undefined ? {} : { box }),
});

describe("what a PNG says about itself", () => {
  it("reads its size", () => {
    expect(pngInfo(png(3024, 1964))).toEqual({ width: 3024, height: 1964 });
  });

  it("reads its density in pixels per inch, when it gives one in metres", () => {
    // 5669 pixels per metre is 144 per inch: how macOS marks a Retina capture.
    expect(pngInfo(png(3024, 1964, 5669))?.pixelsPerInch).toBe(144);
    expect(pngInfo(png(1920, 1080, 2835))?.pixelsPerInch).toBe(72);
  });

  it("is not fooled by bytes that are not a PNG", () => {
    expect(pngInfo(new TextEncoder().encode('{"status":"refused","error":{"message":"no"}}'))).toBeUndefined();
    expect(pngInfo(new Uint8Array([0x89, 0x50]))).toBeUndefined();
  });

  it("encodes base64 exactly as Node does, for every padding", () => {
    for (let length = 0; length < 12; length += 1) {
      const bytes = new Uint8Array(Array.from({ length }, (_, at) => (at * 97 + 13) & 0xff));
      expect(base64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    }
    expect(pngDataUrl(new Uint8Array([1, 2, 3]))).toBe("data:image/png;base64,AQID");
  });
});

describe("the scale between the boxes and the picture is inferred, and says how (T15)", () => {
  it("is exact when a box at the corner has the picture's proportions — a phone's application node", () => {
    const scale = previewScale({
      kind: "mobile",
      lines: [line("a0", [0, 0, 393, 852], 0, "application"), line("a1", [20, 100, 353, 44])],
      width: 1179,
      height: 2556,
    });
    expect(scale.scale).toBe(3);
    expect(scale.basis).toContain("393×852");
    expect(scale.selectable).toBe(true);
  });

  it("assumes one pixel per CSS pixel for a page, and says a joined browser may differ", () => {
    const scale = previewScale({ kind: "web", lines: [line("r1", [10, 10, 100, 30])], width: 1280, height: 720 });
    expect(scale.scale).toBe(1);
    expect(scale.basis).toContain("CSS pixels");
    expect(scale.basis).toContain("will not line up");
  });

  it("reads a Retina capture's density for a desktop surface", () => {
    const scale = previewScale({
      kind: "desktop",
      lines: [line("w1", [300, 200, 800, 600], 0, "window")],
      width: 3024,
      height: 1964,
      pixelsPerInch: 144,
    });
    expect(scale.scale).toBe(2);
    expect(scale.basis).toContain("144 pixels per inch");
  });

  it("says one was assumed when nothing says otherwise", () => {
    const scale = previewScale({
      kind: "desktop",
      lines: [line("w1", [300, 200, 800, 600], 0, "window")],
      width: 1920,
      height: 1080,
      pixelsPerInch: 96,
    });
    expect(scale.scale).toBe(1);
    expect(scale.basis).toContain("one is assumed");
  });

  it("counts the boxes that fall off the picture, and can select nothing when none land on it", () => {
    const some = previewScale({
      kind: "web",
      lines: [line("r1", [10, 10, 100, 30]), line("r2", [10, 2000, 100, 30])],
      width: 1280,
      height: 720,
    });
    expect(some.basis).toContain("1 of 2 boxes fall outside the picture");
    expect(some.selectable).toBe(true);

    const none = previewScale({ kind: "web", lines: [line("r2", [10, 2000, 100, 30])], width: 1280, height: 720 });
    expect(none.selectable).toBe(false);
  });

  it("cannot select anything when the adapter gave no boxes", () => {
    const scale = previewScale({ kind: "web", lines: [line("r1", undefined), line("r2", [0, 0, 0, 0])], width: 10, height: 10 });
    expect(scale.selectable).toBe(false);
    expect(scale.basis).toContain("no element boxes");
  });
});

describe("the control under a point is the smallest box that contains it (T15)", () => {
  const lines = [
    line("form", [0, 0, 400, 300], 0, "form"),
    line("field", [20, 40, 200, 30], 1, "textbox"),
    line("button", [20, 100, 80, 30], 1),
    line("empty", [20, 40, 0, 0], 2),
    line("nobox", undefined, 2),
  ];

  it("picks the innermost of nested boxes", () => {
    expect(refAt(lines, 30, 50, 1)?.ref).toBe("field");
    expect(refAt(lines, 300, 250, 1)?.ref).toBe("form");
  });

  it("answers nothing outside every box", () => {
    expect(refAt(lines, 500, 500, 1)).toBeUndefined();
  });

  it("maps picture pixels through the scale", () => {
    // At 2×, the field's box is 40–440 × 80–140 in the picture.
    expect(refAt(lines, 60, 100, 2)?.ref).toBe("field");
    expect(refAt(lines, 30, 50, 2)?.ref).toBe("form");
  });

  it("gives an edge two boxes share to one of them", () => {
    const side = [line("left", [0, 0, 50, 50]), line("right", [50, 0, 50, 50])];
    expect(refAt(side, 50, 10, 1)?.ref).toBe("right");
    expect(refAt(side, 49.9, 10, 1)?.ref).toBe("left");
  });

  it("prefers the deeper of two boxes the same size, which is the one on top", () => {
    const same = [line("outer", [0, 0, 50, 50], 1), line("inner", [0, 0, 50, 50], 2)];
    expect(refAt(same, 10, 10, 1)?.ref).toBe("inner");
  });

  it("never chooses from a scale that is not one", () => {
    expect(refAt(lines, 30, 50, 0)).toBeUndefined();
    expect(refAt(lines, Number.NaN, 50, 1)).toBeUndefined();
  });
});
