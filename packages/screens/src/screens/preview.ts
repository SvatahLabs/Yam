/**
 * The screenshot preview, and which control a point on it is (T15, SF-10, SF-11).
 *
 * The tree is the half of a surface that is always there; a picture is the
 * half a person recognises. This joins them in one direction only: a point on
 * the picture **selects** the control whose box is under it — the same
 * selection a row of the tree makes — and never clicks the application. A
 * pixel action would be a different, lower-assurance thing, and nothing here
 * pretends to be one.
 *
 * ## Why the scale is inferred, and how far to trust it
 *
 * A box is in the adapter's units and a picture is in pixels, and the two are
 * not the same unit on any platform by construction:
 *
 * - **Web** (Playwright, BiDi): a box is CSS pixels of the viewport and the
 *   picture is that viewport at the page's device scale factor — 1 for a
 *   browser Yam launched, and whatever the display says for one it joined.
 * - **Desktop** (AX, UIA, AT-SPI): a box is screen coordinates and the picture
 *   is the whole screen. On macOS a coordinate is a *point*, and a Retina
 *   capture has two pixels per point.
 * - **Mobile** (Appium): a box is device points and the picture is the device's
 *   pixels, commonly three per point.
 *
 * No adapter reports the ratio, so it is inferred from evidence in the answer
 * itself, in this order, and `basis` says which one was used:
 *
 * 1. a box at the origin with the picture's proportions — a root element that
 *    *is* the screen, as Appium's application node is — gives it exactly;
 * 2. for a web page, one is assumed, which is what a launched browser draws;
 * 3. a PNG that says how many pixels it holds per inch (`pHYs`): macOS marks a
 *    Retina capture 144, twice the 72 of a point;
 * 4. otherwise one is assumed, and the sentence says it was.
 *
 * What can still be wrong: a joined browser with its own zoom, a Windows
 * display scaled by a fraction, a desktop capture of a secondary display, and a
 * page that moved between the snapshot and the picture (they are two calls).
 * None of that is hidden — hovering draws the box a click would choose, so a
 * mismatch is visible before anything is selected, and a wrong selection is a
 * selection the inspector names, not an action.
 */
import type { SurfaceTreeLine } from "./surfaces.js";

/** `[x, y, width, height]`, in the adapter's own units. */
export type SurfaceBox = readonly [number, number, number, number];

/** What the PNG's own header says about it. */
export interface PngInfo {
  readonly width: number;
  readonly height: number;
  /** From `pHYs`, when the file carries one in metres. */
  readonly pixelsPerInch?: number;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;

const u32 = (bytes: Uint8Array, at: number): number =>
  ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!;

/**
 * The width, height and density of a PNG, read from its chunks — or
 * `undefined` for bytes that are not one.
 *
 * Only `IHDR` and `pHYs` are read, and nothing is decoded: the renderer draws
 * the image; the model only needs its size to map a point.
 */
export function pngInfo(bytes: Uint8Array): PngInfo | undefined {
  if (bytes.length < 33) return undefined;
  if (PNG_SIGNATURE.some((one, at) => bytes[at] !== one)) return undefined;
  const type = (at: number): string => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (type(12) !== "IHDR") return undefined;
  const width = u32(bytes, 16);
  const height = u32(bytes, 20);
  let pixelsPerInch: number | undefined;
  // Chunks follow `IHDR` until `IDAT`; `pHYs` must come before the image data.
  let at = 8;
  while (at + 12 <= bytes.length) {
    const length = u32(bytes, at);
    const name = type(at + 4);
    if (name === "pHYs" && length >= 9 && at + 8 + 9 <= bytes.length) {
      const perMetre = u32(bytes, at + 8);
      // Unit 1 is the metre; unit 0 is an aspect ratio with no size in it.
      if (bytes[at + 16] === 1 && perMetre > 0) pixelsPerInch = Math.round(perMetre * 0.0254);
    }
    if (name === "IDAT" || name === "IEND") break;
    at += 12 + length;
  }
  return { width, height, ...(pixelsPerInch === undefined ? {} : { pixelsPerInch }) };
}

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Bytes as base64, without `Buffer` or `btoa`: the model runs in a renderer and in Node. */
export function base64(bytes: Uint8Array): string {
  let out = "";
  for (let at = 0; at < bytes.length; at += 3) {
    const a = bytes[at]!;
    const b = bytes[at + 1];
    const c = bytes[at + 2];
    out += BASE64[a >> 2]!;
    out += BASE64[((a & 0x03) << 4) | ((b ?? 0) >> 4)]!;
    out += b === undefined ? "=" : BASE64[((b & 0x0f) << 2) | ((c ?? 0) >> 6)]!;
    out += c === undefined ? "=" : BASE64[c & 0x3f]!;
  }
  return out;
}

/**
 * A PNG as a `data:` URL.
 *
 * `data:` rather than an object URL: the desktop's `img-src` allows both, and a
 * data URL is a value in the view — nothing to revoke when the view is
 * replaced, which a reload does on every selection.
 */
export function pngDataUrl(bytes: Uint8Array): string {
  return `data:image/png;base64,${base64(bytes)}`;
}

/** How many picture pixels one box unit is, and why that number. */
export interface PreviewScale {
  readonly scale: number;
  /** One sentence a person can check against the picture. */
  readonly basis: string;
  /** Whether any box lands on the picture at that scale, so a click can select. */
  readonly selectable: boolean;
}

const hasArea = (line: SurfaceTreeLine): line is SurfaceTreeLine & { box: SurfaceBox } =>
  line.box !== undefined && line.box[2] > 0 && line.box[3] > 0;

const area = (box: SurfaceBox): number => box[2] * box[3];

/** `1.5`, `2`, `1179/393` as `3`: two decimals, which is finer than any display scale. */
const tidy = (value: number): number => Math.round(value * 100) / 100;

/** Infer the scale between a snapshot's boxes and a picture of the same surface. */
export function previewScale(input: {
  readonly kind: string;
  readonly lines: readonly SurfaceTreeLine[];
  readonly width: number;
  readonly height: number;
  readonly pixelsPerInch?: number;
}): PreviewScale {
  const boxed = input.lines.filter(hasArea);
  if (boxed.length === 0 || input.width <= 0 || input.height <= 0) {
    return {
      scale: 1,
      basis:
        "The adapter gave no element boxes, so nothing on the picture can be selected; choose from the tree.",
      selectable: false,
    };
  }

  let scale: number;
  let basis: string;
  const proportions = input.width / input.height;
  const frame = boxed
    .filter(
      (line) =>
        Math.abs(line.box[0]) <= 1 &&
        Math.abs(line.box[1]) <= 1 &&
        Math.abs(line.box[2] / line.box[3] - proportions) / proportions <= 0.02,
    )
    .sort((a, b) => area(b.box) - area(a.box))[0];
  const ppi = input.pixelsPerInch;
  const density = ppi === undefined ? 0 : Math.round(ppi / 72);

  if (frame !== undefined) {
    scale = tidy(input.width / frame.box[2]);
    basis =
      `The ${frame.role}${frame.name === undefined ? "" : ` "${frame.name}"`} spans ` +
      `${frame.box[2]}×${frame.box[3]} from the corner, the proportions of the ` +
      `${input.width}×${input.height} picture, so one unit of a box is ${scale} pixels.`;
  } else if (input.kind === "web") {
    scale = 1;
    basis =
      "A page's boxes are CSS pixels, and a browser Yam launched draws one pixel per CSS pixel. " +
      "A browser joined with its own zoom or pixel density will not line up; hovering shows where each box lands.";
  } else if (ppi !== undefined && density >= 2 && Math.abs(ppi - density * 72) <= 2) {
    scale = density;
    basis =
      `The picture says it holds ${ppi} pixels per inch, which is how macOS marks a capture of a ` +
      `${density}× display, so one screen point is ${density} pixels.`;
  } else {
    scale = 1;
    basis =
      "The boxes are screen coordinates and nothing says how many pixels of this picture make one, " +
      "so one is assumed. On a high-density display they land at a fraction of their size; hovering shows where each one lands.";
  }

  const outside = boxed.filter(
    (line) =>
      line.box[0] * scale >= input.width ||
      line.box[1] * scale >= input.height ||
      (line.box[0] + line.box[2]) * scale <= 0 ||
      (line.box[1] + line.box[3]) * scale <= 0,
  ).length;
  if (outside > 0) {
    basis +=
      ` ${outside} of ${boxed.length} boxes fall outside the picture — scrolled out of view, or on ` +
      "another display — and can only be chosen from the tree.";
  }
  return { scale, basis, selectable: outside < boxed.length };
}

/**
 * The control under a point of the picture: the smallest box that contains it.
 *
 * `x` and `y` are picture pixels; `scale` is picture pixels per box unit, as
 * `previewScale` inferred it. The smallest, because boxes nest — a field sits
 * inside a form inside a page — and the one a person is pointing at is the
 * innermost. Of two the same size the deeper wins, then the later, which is
 * the one drawn on top. A line with no box, or an empty one, is never chosen:
 * it can only be selected from the tree.
 */
export function refAt(
  lines: readonly SurfaceTreeLine[],
  x: number,
  y: number,
  scale: number,
): (SurfaceTreeLine & { readonly box: SurfaceBox }) | undefined {
  if (!(scale > 0) || !Number.isFinite(x) || !Number.isFinite(y)) return undefined;
  const px = x / scale;
  const py = y / scale;
  let best: (SurfaceTreeLine & { readonly box: SurfaceBox }) | undefined;
  for (const line of lines) {
    if (!hasArea(line)) continue;
    const [left, top, width, height] = line.box;
    // Half-open, so a point on the edge two boxes share belongs to one of them.
    if (px < left || py < top || px >= left + width || py >= top + height) continue;
    if (
      best === undefined ||
      area(line.box) < area(best.box) ||
      (area(line.box) === area(best.box) && line.depth >= best.depth)
    ) {
      best = line;
    }
  }
  return best;
}
