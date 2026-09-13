#!/usr/bin/env node
/**
 * Halve a PNG, in place or to a new file.
 *
 *   node scripts/shrink-png.mjs docs/images/app-flows.png
 *   node scripts/shrink-png.mjs in.png out.png
 *
 * The screenshots are taken on a 2x display, so they arrive at 2560 px wide and
 * about 290 KB each. A documentation page shows them at around 1280, so half
 * the pixels is the same picture at a quarter of the bytes. Thirteen of them in
 * a repository is the difference between 3.8 MB and under one.
 *
 * The reading and the halving are `make-gif.mjs`'s, which already had to do
 * both. What is here is the writing: IHDR, one zlib-deflated IDAT with no row
 * filtering, IEND, and the CRC each chunk carries.
 */
import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { readPng, shrink } from "./make-gif.mjs";

/** The CRC-32 PNG puts after every chunk. */
const table = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(bytes) {
  let c = -1;
  for (const byte of bytes) c = table[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(kind, body) {
  const out = Buffer.alloc(body.length + 12);
  out.writeUInt32BE(body.length, 0);
  out.write(kind, 4, "ascii");
  body.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
  return out;
}

function writePng(path, { width, height, pixels }) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; /* eight bits a channel */
  header[9] = 6; /* RGBA */
  header[10] = 0;
  header[11] = 0;
  header[12] = 0;

  /* One filter byte a row, always zero: the deflate does the work. */
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 4 + 1)] = 0;
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }

  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(raw, { level: 9 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

const [input, output] = process.argv.slice(2);
if (input === undefined) {
  process.stderr.write("usage: shrink-png.mjs <in.png> [out.png]\n");
  process.exit(64);
}
const halvings = Number(process.env["PNG_HALVINGS"] ?? "1");
const small = shrink(readPng(input), halvings);
writePng(output ?? input, small);
process.stderr.write(`${output ?? input}: ${small.width}x${small.height}\n`);
