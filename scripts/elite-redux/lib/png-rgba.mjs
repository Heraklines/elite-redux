/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Minimal pure-JS PNG decode + encode helpers for RGBA pixel buffers.
 *
 * Scope: only the PNG subset the Elite-Redux asset pipeline emits or
 * consumes — 8-bit/channel RGBA (color type 6) and indexed-colour (color
 * type 3) sources, single IDAT block out, no interlacing. The combat
 * sprites from upstream eliteredux are 4-bit indexed; the ER-nextdex
 * dex backfills are 8-bit RGBA — `decodePngToRgba` accepts both and
 * always materialises a 32-bit RGBA buffer so downstream resample code
 * stays format-agnostic.
 *
 * Lives next to palette.mjs which handles the indexed→indexed palette-swap
 * fast path (no zlib). This file is the heavier "decode-resample-encode"
 * path used by the icon synthesiser for species the upstream repos never
 * shipped icon.png for (Hisuian, Paldean, ER-customs).
 *
 * IMPORTANT: this is not a general PNG decoder. It assumes:
 *   - Standard 8-byte signature
 *   - IHDR is the first chunk (PNG spec requires this)
 *   - Color type 6 (RGBA, 8-bit) OR color type 3 (palette, 4/8-bit)
 *   - No interlacing (interlace method 0)
 *   - PLTE precedes IDAT for indexed sources (PNG spec requires this)
 *   - tRNS chunk respected if present (per-palette-entry alpha for type 3)
 *
 * Throws on anything outside this subset rather than silently corrupting.
 */

import { deflateSync, inflateSync } from "node:zlib";
import { crc32 } from "./palette.mjs";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @typedef {Object} RgbaImage
 * @property {number} width
 * @property {number} height
 * @property {Buffer} pixels  width*height*4 bytes, row-major, RGBA8888
 */

// =============================================================================
// Decode: PNG → RGBA Buffer
// =============================================================================

/**
 * Decode a PNG buffer into a flat RGBA pixel array. Supports color type 6
 * (RGBA-8) and color type 3 (palette, 4/8-bit depth) — the two formats the
 * ER asset pipeline emits.
 *
 * @param {Buffer} buf raw PNG bytes
 * @returns {RgbaImage}
 */
export function decodePngToRgba(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG (bad signature)");
  }

  // Parse IHDR (first chunk, fixed offset 8).
  if (buf.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`expected IHDR at offset 8, got ${buf.toString("ascii", 12, 16)}`);
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const depth = buf.readUInt8(24);
  const colorType = buf.readUInt8(25);
  const interlace = buf.readUInt8(28);
  if (interlace !== 0) {
    throw new Error(`interlaced PNGs not supported (interlace=${interlace})`);
  }

  // Determine bytes-per-pixel from colorType/depth for the unfilter step.
  // Note: bpp for filtering uses ceil(bits-per-pixel / 8), min 1. Samples-per-pixel
  // varies by colorType (3=RGB, 4=RGBA, 1=palette/grayscale, 2=grayscale+alpha) and
  // gets folded directly into the depth multiplier below — we only ever need the
  // bits/bytes-per-pixel results downstream.
  let bitsPerPixel;
  if (colorType === 6) {
    // RGBA
    bitsPerPixel = depth * 4;
  } else if (colorType === 2) {
    // RGB
    bitsPerPixel = depth * 3;
  } else if (colorType === 3) {
    // Palette
    bitsPerPixel = depth;
  } else if (colorType === 0) {
    // Grayscale
    bitsPerPixel = depth;
  } else if (colorType === 4) {
    // Grayscale + alpha
    bitsPerPixel = depth * 2;
  } else {
    throw new Error(`unsupported color type: ${colorType}`);
  }
  const bytesPerPixel = Math.max(1, Math.ceil(bitsPerPixel / 8));
  const bytesPerRow = Math.ceil((width * bitsPerPixel) / 8);

  // Walk chunks to gather IDATs, PLTE, tRNS.
  /** @type {Buffer[]} */
  const idatChunks = [];
  /** @type {Buffer | undefined} */
  let plte;
  /** @type {Buffer | undefined} */
  let trns;
  let offset = 8;
  while (offset < buf.length) {
    const length = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    if (type === "IDAT") {
      idatChunks.push(buf.subarray(dataStart, dataStart + length));
    } else if (type === "PLTE") {
      plte = buf.subarray(dataStart, dataStart + length);
    } else if (type === "tRNS") {
      trns = buf.subarray(dataStart, dataStart + length);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (idatChunks.length === 0) {
    throw new Error("PNG has no IDAT chunk");
  }
  if (colorType === 3 && !plte) {
    throw new Error("indexed PNG missing PLTE chunk");
  }

  // Inflate concatenated IDAT data.
  const compressed = Buffer.concat(idatChunks);
  const inflated = inflateSync(compressed);
  const expectedSize = (bytesPerRow + 1) * height;
  if (inflated.length !== expectedSize) {
    throw new Error(
      `inflated IDAT size ${inflated.length} ≠ expected ${expectedSize} (${width}x${height} bpp=${bitsPerPixel})`,
    );
  }

  // Unfilter scanlines. PNG filtering: each row is prefixed by a filter type
  // byte (0=None, 1=Sub, 2=Up, 3=Average, 4=Paeth).
  /** @type {Buffer} */
  const unfiltered = Buffer.alloc(bytesPerRow * height);
  /** @type {Buffer} */
  let prevRow = Buffer.alloc(bytesPerRow); // zeros for first row
  for (let y = 0; y < height; y++) {
    const filterType = inflated[y * (bytesPerRow + 1)];
    const rowStart = y * (bytesPerRow + 1) + 1;
    const dstStart = y * bytesPerRow;
    for (let x = 0; x < bytesPerRow; x++) {
      const filt = inflated[rowStart + x];
      const left = x >= bytesPerPixel ? unfiltered[dstStart + x - bytesPerPixel] : 0;
      const up = prevRow[x];
      const upLeft = x >= bytesPerPixel ? prevRow[x - bytesPerPixel] : 0;
      /** @type {number} */
      let recon;
      switch (filterType) {
        case 0: // None
          recon = filt;
          break;
        case 1: // Sub
          recon = (filt + left) & 0xff;
          break;
        case 2: // Up
          recon = (filt + up) & 0xff;
          break;
        case 3: // Average
          recon = (filt + ((left + up) >> 1)) & 0xff;
          break;
        case 4: {
          // Paeth
          const p = left + up - upLeft;
          const pa = Math.abs(p - left);
          const pb = Math.abs(p - up);
          const pc = Math.abs(p - upLeft);
          const pr = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
          recon = (filt + pr) & 0xff;
          break;
        }
        default:
          throw new Error(`unknown filter type ${filterType} at row ${y}`);
      }
      unfiltered[dstStart + x] = recon;
    }
    prevRow = unfiltered.subarray(dstStart, dstStart + bytesPerRow);
  }

  // Expand to RGBA depending on colorType.
  const pixels = Buffer.alloc(width * height * 4);
  if (colorType === 6 && depth === 8) {
    // Already RGBA — straight copy.
    unfiltered.copy(pixels, 0, 0, width * height * 4);
  } else if (colorType === 2 && depth === 8) {
    // RGB → RGBA (alpha=255)
    for (let i = 0; i < width * height; i++) {
      pixels[i * 4 + 0] = unfiltered[i * 3 + 0];
      pixels[i * 4 + 1] = unfiltered[i * 3 + 1];
      pixels[i * 4 + 2] = unfiltered[i * 3 + 2];
      pixels[i * 4 + 3] = 255;
    }
  } else if (colorType === 3 && plte) {
    // Indexed → RGBA. Pack-bit if depth<8.
    const paletteRgb = plte;
    const transparencyAlpha = trns ?? Buffer.alloc(0);
    /**
     * @param {number} idx
     * @returns {[number, number, number, number]}
     */
    function lookup(idx) {
      const r = paletteRgb[idx * 3 + 0] ?? 0;
      const g = paletteRgb[idx * 3 + 1] ?? 0;
      const b = paletteRgb[idx * 3 + 2] ?? 0;
      // tRNS for indexed PNGs gives per-palette-entry alpha. Entries past
      // tRNS.length are treated as fully opaque.
      const a = idx < transparencyAlpha.length ? transparencyAlpha[idx] : 255;
      return [r, g, b, a];
    }
    if (depth === 8) {
      for (let i = 0; i < width * height; i++) {
        const [r, g, b, a] = lookup(unfiltered[i]);
        pixels[i * 4 + 0] = r;
        pixels[i * 4 + 1] = g;
        pixels[i * 4 + 2] = b;
        pixels[i * 4 + 3] = a;
      }
    } else if (depth === 4) {
      // Two pixels per byte, high nibble first.
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const byte = unfiltered[y * bytesPerRow + (x >> 1)];
          const idx = x & 1 ? byte & 0x0f : (byte >> 4) & 0x0f;
          const [r, g, b, a] = lookup(idx);
          const o = (y * width + x) * 4;
          pixels[o + 0] = r;
          pixels[o + 1] = g;
          pixels[o + 2] = b;
          pixels[o + 3] = a;
        }
      }
    } else if (depth === 2) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const byte = unfiltered[y * bytesPerRow + (x >> 2)];
          const shift = 6 - (x & 3) * 2;
          const idx = (byte >> shift) & 0x03;
          const [r, g, b, a] = lookup(idx);
          const o = (y * width + x) * 4;
          pixels[o + 0] = r;
          pixels[o + 1] = g;
          pixels[o + 2] = b;
          pixels[o + 3] = a;
        }
      }
    } else if (depth === 1) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const byte = unfiltered[y * bytesPerRow + (x >> 3)];
          const shift = 7 - (x & 7);
          const idx = (byte >> shift) & 0x01;
          const [r, g, b, a] = lookup(idx);
          const o = (y * width + x) * 4;
          pixels[o + 0] = r;
          pixels[o + 1] = g;
          pixels[o + 2] = b;
          pixels[o + 3] = a;
        }
      }
    } else {
      throw new Error(`unsupported palette depth: ${depth}`);
    }
  } else {
    throw new Error(`unsupported PNG variant: colorType=${colorType} depth=${depth}`);
  }

  return { width, height, pixels };
}

// =============================================================================
// Resample / compose
// =============================================================================

/**
 * Nearest-neighbour downsample. Picks the pixel at the centre of each
 * destination cell — for integer downsampling ratios (2x, 4x) this is
 * pixel-art faithful (no blending). Pokemon sprites at 64x64 → 32x32 are
 * the primary use case.
 *
 * @param {RgbaImage} src
 * @param {number} dstW
 * @param {number} dstH
 */
export function downsampleNearest(src, dstW, dstH) {
  const dst = Buffer.alloc(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    // Centre-of-cell sampling: srcY = (y + 0.5) * srcH / dstH - 0.5, rounded.
    const srcY = Math.min(src.height - 1, Math.max(0, Math.floor(((y + 0.5) * src.height) / dstH)));
    for (let x = 0; x < dstW; x++) {
      const srcX = Math.min(src.width - 1, Math.max(0, Math.floor(((x + 0.5) * src.width) / dstW)));
      const sOff = (srcY * src.width + srcX) * 4;
      const dOff = (y * dstW + x) * 4;
      dst[dOff + 0] = src.pixels[sOff + 0];
      dst[dOff + 1] = src.pixels[sOff + 1];
      dst[dOff + 2] = src.pixels[sOff + 2];
      dst[dOff + 3] = src.pixels[sOff + 3];
    }
  }
  return { width: dstW, height: dstH, pixels: dst };
}

/**
 * Stack two RGBA images vertically into a single sprite-sheet image. Both
 * inputs must share width. Used to build the 32×64 two-frame ER icon
 * format from a single 32×32 source.
 *
 * @param {RgbaImage} top
 * @param {RgbaImage} bottom
 */
export function stackVertical(top, bottom) {
  if (top.width !== bottom.width) {
    throw new Error(`stackVertical width mismatch: ${top.width} vs ${bottom.width}`);
  }
  const w = top.width;
  const h = top.height + bottom.height;
  const pixels = Buffer.alloc(w * h * 4);
  top.pixels.copy(pixels, 0);
  bottom.pixels.copy(pixels, top.pixels.length);
  return { width: w, height: h, pixels };
}

// =============================================================================
// Encode: RGBA → PNG
// =============================================================================

/**
 * Build a PNG chunk: length(4) + type(4) + data + crc(4). CRC covers
 * type + data (PNG spec §5.3).
 *
 * @param {string} type 4-char ascii chunk name
 * @param {Buffer} data payload
 */
function buildChunk(type, data) {
  if (type.length !== 4) {
    throw new Error(`chunk type must be 4 chars, got "${type}"`);
  }
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  // CRC covers type(4) + data
  const crc = crc32(out, 4, 8 + data.length);
  out.writeUInt32BE(crc, 8 + data.length);
  return out;
}

/**
 * Encode an RGBA image buffer to a standard PNG (color type 6, depth 8,
 * single IDAT, filter=None per row, no interlacing). Filter=None keeps
 * the encoder trivially correct; zlib still compresses sparse alpha
 * regions well enough — icon PNGs land at ~300-500 bytes.
 *
 * @param {RgbaImage} img
 * @returns {Buffer}
 */
export function encodeRgbaToPng(img) {
  const { width, height, pixels } = img;
  if (pixels.length !== width * height * 4) {
    throw new Error(`pixel buffer size ${pixels.length} ≠ ${width * height * 4} (${width}x${height})`);
  }

  // IHDR: 13 bytes (width 4, height 4, depth 1, colorType 1, compression 1, filter 1, interlace 1).
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // color type 6 = RGBA
  ihdr.writeUInt8(0, 10); // compression method (deflate)
  ihdr.writeUInt8(0, 11); // filter method
  ihdr.writeUInt8(0, 12); // interlace (none)

  // Build raw scanlines with filter-type=None prefix per row.
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (rowBytes + 1)] = 0; // filter: None
    pixels.copy(raw, y * (rowBytes + 1) + 1, y * rowBytes, (y + 1) * rowBytes);
  }
  const idat = deflateSync(raw, { level: 9 });

  return Buffer.concat([
    PNG_SIGNATURE,
    buildChunk("IHDR", ihdr),
    buildChunk("IDAT", idat),
    buildChunk("IEND", Buffer.alloc(0)),
  ]);
}
