/**
 * Masking a device screenshot (REQ-NFR-6, T4.2).
 *
 * > screenshots of secret-injecting steps are masked.
 *
 * The web adapters mask before the picture is taken. Appium screenshots the
 * device, so the masking has to happen to the PNG that comes back — which means
 * this file is the only place in the workspace that writes image bytes, and the
 * only place where "it looked fine" is not a test.
 *
 * The fixtures are therefore built here, byte by byte, rather than produced by
 * the encoder under test: a round trip through one's own writer would prove
 * nothing about whether the output is a PNG. Every input below is assembled from
 * the format's own definition and compressed with `node:zlib`, and every
 * assertion decodes the result the same way.
 */
import { describe, expect, it } from "vitest";
import { deflateSync, inflateSync } from "node:zlib";
import { maskPng, UnsupportedPng } from "../src/mask.js";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** A PNG assembled from the format's definition, with the pixels given. */
function png(options: {
  width: number;
  height: number;
  channels: 3 | 4;
  /** `(x, y) → [r, g, b, a]`. */
  pixel: (x: number, y: number) => readonly number[];
  bitDepth?: number;
  interlace?: number;
  colourType?: number;
  /** Which filter to write each scanline with, to prove they are undone. */
  filter?: (y: number) => number;
  extraChunks?: ReadonlyArray<{ type: string; data: Buffer }>;
}): Buffer {
  const { width, height, channels } = options;
  const stride = width * channels;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(options.bitDepth ?? 8, 8);
  header.writeUInt8(options.colourType ?? (channels === 4 ? 6 : 2), 9);
  header.writeUInt8(0, 10); // deflate
  header.writeUInt8(0, 11); // adaptive filtering
  header.writeUInt8(options.interlace ?? 0, 12);

  const raw = Buffer.alloc(height * (stride + 1));
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const line = Buffer.alloc(stride);
    for (let x = 0; x < width; x += 1) {
      const rgba = options.pixel(x, y);
      for (let c = 0; c < channels; c += 1) line[x * channels + c] = rgba[c] ?? 255;
    }
    const filter = options.filter?.(y) ?? 0;
    const encoded = Buffer.from(line);
    // Only the two filters the tests use; the point is to prove `unfilter`
    // reverses them, not to write a general encoder.
    if (filter === 1) {
      for (let i = stride - 1; i >= channels; i -= 1) {
        encoded[i] = (line[i]! - line[i - channels]!) & 0xff;
      }
    } else if (filter === 2) {
      for (let i = 0; i < stride; i += 1) encoded[i] = (line[i]! - previous[i]!) & 0xff;
    }
    raw[y * (stride + 1)] = filter;
    encoded.copy(raw, y * (stride + 1) + 1);
    previous = line;
  }

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header),
    ...(options.extraChunks ?? []).map((c) => chunk(c.type, c.data)),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Read a PNG back, undoing filter 0 only — which is all the masker writes. */
function pixelsOf(buffer: Buffer): { width: number; height: number; channels: number; at: (x: number, y: number) => number[] } {
  expect(buffer.subarray(0, 8).equals(SIGNATURE), "output is a PNG").toBe(true);
  const chunks: Array<{ type: string; data: Buffer }> = [];
  let cursor = 8;
  while (cursor + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(cursor);
    const type = buffer.toString("ascii", cursor + 4, cursor + 8);
    const data = buffer.subarray(cursor + 8, cursor + 8 + length);
    // Every chunk carries a CRC of its type and data; a rewriter that got that
    // wrong would produce a file every real decoder rejects.
    expect(buffer.readUInt32BE(cursor + 8 + length), `${type} CRC`).toBe(
      crc32(Buffer.concat([Buffer.from(type, "ascii"), data])),
    );
    chunks.push({ type, data });
    cursor += 12 + length;
    if (type === "IEND") break;
  }
  expect(cursor, "no trailing bytes").toBe(buffer.length);

  const header = chunks.find((c) => c.type === "IHDR")!.data;
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const channels = header.readUInt8(9) === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data)));

  return {
    width,
    height,
    channels,
    at: (x, y) => {
      expect(raw[y * (stride + 1)], "the masker writes filter 0").toBe(0);
      const start = y * (stride + 1) + 1 + x * channels;
      return [...raw.subarray(start, start + channels)];
    },
  };
}

const white = () => [255, 255, 255, 255];

describe("maskPng (REQ-NFR-6)", () => {
  it("paints over the box it was given and nothing else", () => {
    const before = png({ width: 8, height: 8, channels: 3, pixel: white });
    const after = maskPng(before, [[2, 3, 3, 2]]);
    const pixels = pixelsOf(after);

    expect(pixels.at(2, 3)).toEqual([255, 0, 255]);
    expect(pixels.at(4, 4)).toEqual([255, 0, 255]);
    // One pixel outside on every side.
    expect(pixels.at(1, 3)).toEqual([255, 255, 255]);
    expect(pixels.at(5, 3)).toEqual([255, 255, 255]);
    expect(pixels.at(2, 2)).toEqual([255, 255, 255]);
    expect(pixels.at(2, 5)).toEqual([255, 255, 255]);
  });

  it("keeps the alpha channel opaque, so the mask hides rather than tints", () => {
    const before = png({ width: 4, height: 4, channels: 4, pixel: () => [10, 20, 30, 0] });
    const pixels = pixelsOf(maskPng(before, [[0, 0, 2, 2]]));
    expect(pixels.at(0, 0)).toEqual([255, 0, 255, 255]);
    expect(pixels.at(3, 3)).toEqual([10, 20, 30, 0]);
  });

  it("undoes every scanline filter before painting", () => {
    /*
     * The one thing that would be wrong in a way nobody notices: a masker that
     * ignored the filters would paint the correct rectangle onto the *residuals*
     * and produce a picture of noise. Both filters a real encoder uses are
     * exercised, and the unmasked pixels have to come back unchanged.
     */
    const gradient = (x: number, y: number) => [x * 20, y * 20, (x + y) * 10, 255];
    const before = png({
      width: 6,
      height: 6,
      channels: 3,
      pixel: gradient,
      filter: (y) => (y === 0 ? 0 : y % 2 === 0 ? 1 : 2),
    });
    const pixels = pixelsOf(maskPng(before, [[0, 0, 1, 1]]));

    expect(pixels.at(0, 0)).toEqual([255, 0, 255]);
    for (const [x, y] of [
      [1, 0],
      [5, 3],
      [3, 5],
      [5, 5],
    ] as const) {
      expect(pixels.at(x, y), `${x},${y}`).toEqual(gradient(x, y).slice(0, 3));
    }
  });

  it("clips a box that hangs off the screen rather than refusing it", () => {
    // An element scrolled half out of view is normal; masking the visible half
    // is the right answer, and a crash is not.
    const before = png({ width: 4, height: 4, channels: 3, pixel: white });
    // x and y run from -2 to 2, so the visible part is the top-left 2×2.
    const pixels = pixelsOf(maskPng(before, [[-2, -2, 4, 4]]));
    expect(pixels.at(0, 0)).toEqual([255, 0, 255]);
    expect(pixels.at(1, 1)).toEqual([255, 0, 255]);
    expect(pixels.at(2, 2)).toEqual([255, 255, 255]);
  });

  it("paints several boxes", () => {
    const before = png({ width: 8, height: 4, channels: 3, pixel: white });
    const pixels = pixelsOf(maskPng(before, [[0, 0, 2, 1], [6, 3, 2, 1]]));
    expect(pixels.at(0, 0)).toEqual([255, 0, 255]);
    expect(pixels.at(7, 3)).toEqual([255, 0, 255]);
    expect(pixels.at(4, 2)).toEqual([255, 255, 255]);
  });

  it("returns the picture untouched when nothing is masked", () => {
    // Not "rewrites it identically": an unmasked screenshot must be the bytes
    // the device produced, so a difference is never something this introduced.
    const before = png({ width: 2, height: 2, channels: 3, pixel: white });
    expect(maskPng(before, [])).toBe(before);
  });

  it("keeps ancillary chunks, so a colour profile survives the rewrite", () => {
    const before = png({
      width: 2,
      height: 2,
      channels: 3,
      pixel: white,
      extraChunks: [{ type: "pHYs", data: Buffer.from([0, 0, 11, 19, 0, 0, 11, 19, 1]) }],
    });
    const after = maskPng(before, [[0, 0, 1, 1]]);
    expect(after.includes(Buffer.from("pHYs", "ascii"))).toBe(true);
  });

  it("refuses a picture it cannot mask rather than writing an unmasked one", () => {
    /*
     * The whole point. A refusal is recoverable; a screenshot of a password
     * field is not. Each of these is a PNG the masker does not understand.
     */
    expect(() => maskPng(Buffer.from("not a png at all"), [[0, 0, 1, 1]])).toThrow(UnsupportedPng);

    const paletted = png({ width: 2, height: 2, channels: 3, pixel: white, colourType: 3 });
    expect(() => maskPng(paletted, [[0, 0, 1, 1]])).toThrow(/colour type/);

    const deep = png({ width: 2, height: 2, channels: 3, pixel: white, bitDepth: 16 });
    expect(() => maskPng(deep, [[0, 0, 1, 1]])).toThrow(/bits per channel/);

    const interlaced = png({ width: 2, height: 2, channels: 3, pixel: white, interlace: 1 });
    expect(() => maskPng(interlaced, [[0, 0, 1, 1]])).toThrow(/interlaced/);
  });

  it("says why, in a message that names the requirement", () => {
    try {
      maskPng(Buffer.from("nope"), [[0, 0, 1, 1]]);
      expect.unreachable("should have refused");
    } catch (error) {
      expect((error as Error).message).toContain("REQ-NFR-6");
      expect((error as Error).message).toContain("it is not a PNG");
    }
  });
});
