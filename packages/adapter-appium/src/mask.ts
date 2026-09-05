/**
 * Painting over the boxes of secret-injecting elements in a screenshot
 * (REQ-NFR-6, T4.2).
 *
 * > secrets never appear in plan, bindings, results, audit, traces or prompts;
 * > screenshots of secret-injecting steps are masked.
 *
 * The web adapters mask before the picture is taken — Playwright takes a mask
 * argument, and the BiDi adapter paints an overlay into the page. Appium takes a
 * screenshot of the *device*, so there is nothing to paint into: the masking has
 * to happen to the PNG that comes back.
 *
 * Hence a PNG rewriter, in about a page, with `node:zlib` doing the compression.
 * The alternative was an image dependency for one rectangle fill, or writing an
 * unmasked screenshot of a password field, and the second is not an option.
 *
 * It handles what Appium's drivers actually emit — 8-bit RGB and RGBA,
 * non-interlaced — and **refuses** anything else rather than writing a picture
 * it could not mask. A refusal is recoverable; a leaked secret is not.
 */
import { deflateSync, inflateSync } from "node:zlib";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** What this masker can rewrite, and why anything else is refused. */
export class UnsupportedPng extends Error {
  constructor(why: string) {
    super(
      `Cannot mask this screenshot: ${why}. Rather than write an unmasked picture of a ` +
        "secret-injecting step, the adapter refuses (REQ-NFR-6).",
    );
    this.name = "UnsupportedPng";
  }
}

interface Chunk {
  readonly type: string;
  readonly data: Buffer;
}

function readChunks(png: Buffer): Chunk[] {
  if (!png.subarray(0, 8).equals(SIGNATURE)) throw new UnsupportedPng("it is not a PNG");
  const chunks: Chunk[] = [];
  let at = 8;
  while (at + 8 <= png.length) {
    const length = png.readUInt32BE(at);
    const type = png.toString("ascii", at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    chunks.push({ type, data });
    at += 12 + length; // length, type, data, crc
    if (type === "IEND") break;
  }
  return chunks;
}

/** The CRC-32 the PNG format requires on every chunk. */
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

/** Undo one scanline's filter, in place, per the PNG specification. */
function unfilter(
  filter: number,
  line: Buffer,
  previous: Buffer | undefined,
  bytesPerPixel: number,
): void {
  const prior = (i: number): number => previous?.[i] ?? 0;
  switch (filter) {
    case 0:
      return;
    case 1:
      for (let i = bytesPerPixel; i < line.length; i += 1) {
        line[i] = (line[i]! + line[i - bytesPerPixel]!) & 0xff;
      }
      return;
    case 2:
      for (let i = 0; i < line.length; i += 1) line[i] = (line[i]! + prior(i)) & 0xff;
      return;
    case 3:
      for (let i = 0; i < line.length; i += 1) {
        const left = i >= bytesPerPixel ? line[i - bytesPerPixel]! : 0;
        line[i] = (line[i]! + ((left + prior(i)) >> 1)) & 0xff;
      }
      return;
    case 4:
      for (let i = 0; i < line.length; i += 1) {
        const a = i >= bytesPerPixel ? line[i - bytesPerPixel]! : 0;
        const b = prior(i);
        const c = i >= bytesPerPixel ? prior(i - bytesPerPixel) : 0;
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[i] = (line[i]! + predictor) & 0xff;
      }
      return;
    default:
      throw new UnsupportedPng(`it uses filter type ${filter}`);
  }
}

/**
 * Paint solid rectangles over a PNG.
 *
 * Boxes are `[x, y, width, height]` in device pixels, as `getRect` reports them.
 * A box outside the picture is clipped rather than refused: an element scrolled
 * half off the screen is a normal thing, and masking the visible half is the
 * right answer.
 */
export function maskPng(
  png: Buffer,
  boxes: ReadonlyArray<readonly [number, number, number, number]>,
  colour: readonly [number, number, number] = [255, 0, 255],
): Buffer {
  if (boxes.length === 0) return png;

  const chunks = readChunks(png);
  const header = chunks.find((c) => c.type === "IHDR");
  if (header === undefined) throw new UnsupportedPng("it has no IHDR chunk");

  const width = header.data.readUInt32BE(0);
  const height = header.data.readUInt32BE(4);
  const bitDepth = header.data.readUInt8(8);
  const colourType = header.data.readUInt8(9);
  const interlace = header.data.readUInt8(12);

  if (bitDepth !== 8) throw new UnsupportedPng(`it is ${bitDepth} bits per channel, not 8`);
  if (colourType !== 2 && colourType !== 6) {
    throw new UnsupportedPng(`its colour type is ${colourType}, not truecolour (2 or 6)`);
  }
  if (interlace !== 0) throw new UnsupportedPng("it is interlaced");

  const channels = colourType === 6 ? 4 : 3;
  const stride = width * channels;

  const compressed = Buffer.concat(chunks.filter((c) => c.type === "IDAT").map((c) => c.data));
  const raw = inflateSync(compressed);
  if (raw.length < height * (stride + 1)) {
    throw new UnsupportedPng("its pixel data is shorter than its dimensions claim");
  }

  // Undo the filters, so the pixels can be written to directly.
  const pixels = Buffer.alloc(height * stride);
  let previous: Buffer | undefined;
  for (let y = 0; y < height; y += 1) {
    const at = y * (stride + 1);
    const line = Buffer.from(raw.subarray(at + 1, at + 1 + stride));
    unfilter(raw[at]!, line, previous, channels);
    line.copy(pixels, y * stride);
    previous = line;
  }

  const [r, g, b] = colour;
  for (const [bx, by, bw, bh] of boxes) {
    const left = Math.max(0, Math.round(bx));
    const top = Math.max(0, Math.round(by));
    const right = Math.min(width, Math.round(bx + bw));
    const bottom = Math.min(height, Math.round(by + bh));
    for (let y = top; y < bottom; y += 1) {
      for (let x = left; x < right; x += 1) {
        const at = y * stride + x * channels;
        pixels[at] = r;
        pixels[at + 1] = g;
        pixels[at + 2] = b;
        if (channels === 4) pixels[at + 3] = 255;
      }
    }
  }

  // Re-filter with filter 0 (none) on every line: the picture is written once
  // and read by a person, so the few bytes a smarter filter would save are not
  // worth the code that would save them.
  const out = Buffer.alloc(height * (stride + 1));
  for (let y = 0; y < height; y += 1) {
    out[y * (stride + 1)] = 0;
    pixels.copy(out, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }

  return Buffer.concat([
    SIGNATURE,
    chunk("IHDR", header.data),
    // Every ancillary chunk between IHDR and IDAT is kept, so colour profiles
    // and physical dimensions survive the rewrite.
    ...chunks
      .filter((c) => c.type !== "IHDR" && c.type !== "IDAT" && c.type !== "IEND")
      .map((c) => chunk(c.type, c.data)),
    chunk("IDAT", deflateSync(out)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
