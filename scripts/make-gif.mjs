#!/usr/bin/env node
/**
 * Turn PNG frames into one animated GIF.
 *
 *   node scripts/make-gif.mjs out.gif 60 a.png b.png c.png
 *
 * The delay is in hundredths of a second, per frame.
 *
 * ## Why this exists
 *
 * The documentation shows Yam driving a real site, and a still picture cannot
 * show a sequence. This machine has no `ffmpeg`, no ImageMagick and no
 * `gifsicle`, and adding a dependency to the workspace so that the README can
 * have a picture is the wrong trade. Node ships `zlib`, which is the only hard
 * part of reading a PNG, and GIF is a small format.
 *
 * Three steps, each plain:
 *
 *   1. read the PNGs Playwright wrote (8-bit, non-interlaced, RGB or RGBA);
 *   2. pick 256 colours for all the frames together, by median cut, so the
 *      palette does not shift between frames and make the animation flicker;
 *   3. write GIF89a with a Netscape loop block and LZW-compressed frames.
 *
 * It is deliberately small rather than general. It reads the PNG shapes
 * Playwright produces and nothing else, and says so when it is given another.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

/* ── reading a PNG ────────────────────────────────────────────────────────── */

/** One PNG, as width, height and RGBA bytes. */
function readPng(path) {
  const file = readFileSync(path);
  if (file.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path} is not a PNG`);

  let at = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colour = 0;
  const parts = [];
  while (at < file.length) {
    const length = file.readUInt32BE(at);
    const kind = file.toString("ascii", at + 4, at + 8);
    const body = file.subarray(at + 8, at + 8 + length);
    if (kind === "IHDR") {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      depth = body[8];
      colour = body[9];
      if (depth !== 8 || (colour !== 2 && colour !== 6)) {
        throw new Error(`${path}: only 8-bit RGB and RGBA are read, not depth ${depth} colour ${colour}`);
      }
      if (body[12] !== 0) throw new Error(`${path}: interlaced PNGs are not read`);
    } else if (kind === "IDAT") {
      parts.push(body);
    } else if (kind === "IEND") {
      break;
    }
    at += 12 + length;
  }

  const channels = colour === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(parts));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);

  /*
   * Undo the per-row filters (PNG spec §9). Each row begins with a filter byte
   * and refers to the pixel to its left and the row above, so the rows have to
   * be walked in order and in place.
   */
  const line = Buffer.alloc(stride);
  const previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const start = y * (stride + 1);
    const filter = raw[start];
    raw.copy(line, 0, start + 1, start + 1 + stride);
    for (let i = 0; i < stride; i += 1) {
      const a = i >= channels ? line[i - channels] : 0;
      const b = previous[i];
      const c = i >= channels ? previous[i - channels] : 0;
      if (filter === 1) line[i] = (line[i] + a) & 0xff;
      else if (filter === 2) line[i] = (line[i] + b) & 0xff;
      else if (filter === 3) line[i] = (line[i] + ((a + b) >> 1)) & 0xff;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const near = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        line[i] = (line[i] + near) & 0xff;
      }
    }
    line.copy(previous);
    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      out[to] = line[from];
      out[to + 1] = line[from + 1];
      out[to + 2] = line[from + 2];
      out[to + 3] = channels === 4 ? line[from + 3] : 255;
    }
  }
  return { width, height, pixels: out };
}

/** Halve the size, averaging each 2×2 block, `times` times over. */
function shrink(frame, times) {
  let { width, height, pixels } = frame;
  for (let round = 0; round < times; round += 1) {
    const w = Math.floor(width / 2);
    const h = Math.floor(height / 2);
    const out = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        for (let c = 0; c < 4; c += 1) {
          const a = pixels[((y * 2) * width + x * 2) * 4 + c];
          const b = pixels[((y * 2) * width + x * 2 + 1) * 4 + c];
          const d = pixels[((y * 2 + 1) * width + x * 2) * 4 + c];
          const e = pixels[((y * 2 + 1) * width + x * 2 + 1) * 4 + c];
          out[(y * w + x) * 4 + c] = (a + b + d + e) >> 2;
        }
      }
    }
    width = w;
    height = h;
    pixels = out;
  }
  return { width, height, pixels };
}

/* ── choosing 256 colours ─────────────────────────────────────────────────── */

/**
 * Median cut over every frame at once.
 *
 * One palette for the whole animation: a palette per frame is smaller but the
 * colours shift from frame to frame, and flat interface colours shifting by a
 * shade between frames reads as flicker.
 */
function paletteFor(frames, size = 256) {
  const seen = new Map();
  for (const frame of frames) {
    for (let i = 0; i < frame.pixels.length; i += 4) {
      /* Five bits a channel: enough for flat interface colours, small enough to count. */
      const key =
        ((frame.pixels[i] >> 3) << 10) | ((frame.pixels[i + 1] >> 3) << 5) | (frame.pixels[i + 2] >> 3);
      const had = seen.get(key);
      if (had === undefined) seen.set(key, { count: 1, r: frame.pixels[i], g: frame.pixels[i + 1], b: frame.pixels[i + 2] });
      else had.count += 1;
    }
  }

  let boxes = [[...seen.values()]];
  while (boxes.length < size) {
    /* Split the box with the widest channel, which is where the error is. */
    let pick = -1;
    let widest = 0;
    let channel = "r";
    boxes.forEach((box, at) => {
      if (box.length < 2) return;
      for (const c of ["r", "g", "b"]) {
        let low = 255;
        let high = 0;
        for (const one of box) {
          if (one[c] < low) low = one[c];
          if (one[c] > high) high = one[c];
        }
        if (high - low > widest) {
          widest = high - low;
          pick = at;
          channel = c;
        }
      }
    });
    if (pick < 0) break;
    const box = boxes[pick].sort((a, b) => a[channel] - b[channel]);
    const half = Math.floor(box.length / 2);
    boxes = [...boxes.slice(0, pick), box.slice(0, half), box.slice(half), ...boxes.slice(pick + 1)];
  }

  return boxes.map((box) => {
    let total = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const one of box) {
      total += one.count;
      r += one.r * one.count;
      g += one.g * one.count;
      b += one.b * one.count;
    }
    return total === 0
      ? [0, 0, 0]
      : [Math.round(r / total), Math.round(g / total), Math.round(b / total)];
  });
}

/** The nearest palette entry, remembered so each colour is searched once. */
function indexer(palette) {
  const known = new Map();
  return (r, g, b) => {
    const key = (r << 16) | (g << 8) | b;
    const had = known.get(key);
    if (had !== undefined) return had;
    let best = 0;
    let closest = Infinity;
    for (let i = 0; i < palette.length; i += 1) {
      const dr = r - palette[i][0];
      const dg = g - palette[i][1];
      const db = b - palette[i][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < closest) {
        closest = d;
        best = i;
      }
    }
    known.set(key, best);
    return best;
  };
}

/* ── writing the GIF ──────────────────────────────────────────────────────── */

/** LZW, as GIF uses it: variable code width, clear and end codes. */
function lzw(indices, minimumCodeSize) {
  const clear = 1 << minimumCodeSize;
  const end = clear + 1;
  let width = minimumCodeSize + 1;
  let next = end + 1;
  let table = new Map();

  const out = [];
  let bits = 0;
  let held = 0;
  const push = (code) => {
    held |= code << bits;
    bits += width;
    while (bits >= 8) {
      out.push(held & 0xff);
      held >>= 8;
      bits -= 8;
    }
  };

  push(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i += 1) {
    const k = indices[i];
    const key = prefix * 4096 + k;
    const found = table.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    push(prefix);
    table.set(key, next);
    next += 1;
    /*
     * One later than it looks, and this is the whole of GIF's LZW.
     *
     * A decoder adds no entry for the first code after a clear, so its table is
     * always one behind the encoder's. If the encoder widens the code when its
     * own `next` reaches `1 << width`, it writes the next code at the new width
     * while the decoder is still reading at the old one, and everything after
     * that is noise. Measured: a 32-pixel test image decoded nine pixels and
     * stopped, and a real screenshot showed ten correct rows and then flat
     * grey.
     */
    if (next === (1 << width) + 1) {
      if (width < 12) width += 1;
      else {
        push(clear);
        table = new Map();
        next = end + 1;
        width = minimumCodeSize + 1;
      }
    }
    prefix = k;
  }
  push(prefix);
  push(end);
  if (bits > 0) out.push(held & 0xff);
  return Buffer.from(out);
}

function gif(frames, palette, delay) {
  const { width, height } = frames[0];
  const bits = Math.max(2, Math.ceil(Math.log2(Math.max(2, palette.length))));
  const slots = 1 << bits;
  const parts = [];

  const header = Buffer.alloc(13);
  header.write("GIF89a", 0, "ascii");
  header.writeUInt16LE(width, 6);
  header.writeUInt16LE(height, 8);
  header[10] = 0xf0 | (bits - 1); /* global table, `bits` per colour */
  header[11] = 0;
  header[12] = 0;
  parts.push(header);

  const table = Buffer.alloc(slots * 3);
  palette.forEach(([r, g, b], i) => {
    table[i * 3] = r;
    table[i * 3 + 1] = g;
    table[i * 3 + 2] = b;
  });
  parts.push(table);

  /* Loop for ever: the Netscape application extension, which every reader takes. */
  parts.push(Buffer.from([0x21, 0xff, 0x0b]));
  parts.push(Buffer.from("NETSCAPE2.0", "ascii"));
  parts.push(Buffer.from([0x03, 0x01, 0x00, 0x00, 0x00]));

  const nearest = indexer(palette);
  for (const frame of frames) {
    const control = Buffer.alloc(8);
    control[0] = 0x21;
    control[1] = 0xf9;
    control[2] = 0x04;
    control[3] = 0x04; /* leave the frame in place */
    control.writeUInt16LE(delay, 4);
    control[6] = 0;
    control[7] = 0;
    parts.push(control);

    const descriptor = Buffer.alloc(10);
    descriptor[0] = 0x2c;
    descriptor.writeUInt16LE(0, 1);
    descriptor.writeUInt16LE(0, 3);
    descriptor.writeUInt16LE(frame.width, 5);
    descriptor.writeUInt16LE(frame.height, 7);
    descriptor[9] = 0;
    parts.push(descriptor);

    const indices = new Uint8Array(frame.width * frame.height);
    for (let i = 0, p = 0; i < indices.length; i += 1, p += 4) {
      indices[i] = nearest(frame.pixels[p], frame.pixels[p + 1], frame.pixels[p + 2]);
    }

    const minimum = Math.max(2, bits);
    parts.push(Buffer.from([minimum]));
    const data = lzw(indices, minimum);
    for (let at = 0; at < data.length; at += 255) {
      const block = data.subarray(at, at + 255);
      parts.push(Buffer.from([block.length]));
      parts.push(block);
    }
    parts.push(Buffer.from([0x00]));
  }

  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
}

/* ── the command ──────────────────────────────────────────────────────────── */

export { readPng, shrink, paletteFor, gif };

/*
 * Only when run, not when imported. `test/make-gif.test.ts` imports these to
 * put a known image through the encoder and read it back with a real decoder,
 * which is the only way to tell a GIF that is merely well formed from one that
 * holds the right pixels.
 */
const invoked = process.argv[1] !== undefined && process.argv[1].endsWith("make-gif.mjs");
if (invoked) {
  const [out, delayText, ...sources] = process.argv.slice(2);
  if (out === undefined || sources.length === 0) {
    process.stderr.write("usage: make-gif.mjs <out.gif> <delay in 1/100 s> <frame.png…>\n");
    process.exit(64);
  }
  const halvings = Number(process.env["GIF_HALVINGS"] ?? "1");
  const frames = sources.map((one) => shrink(readPng(one), halvings));
  const sizes = new Set(frames.map((one) => `${one.width}x${one.height}`));
  if (sizes.size > 1) {
    process.stderr.write(`the frames are different sizes: ${[...sizes].join(", ")}\n`);
    process.exit(1);
  }
  const palette = paletteFor(frames);
  writeFileSync(out, gif(frames, palette, Number(delayText)));
  process.stderr.write(
    `wrote ${out}: ${frames.length} frames, ${frames[0].width}x${frames[0].height}, ${palette.length} colours\n`,
  );
}
