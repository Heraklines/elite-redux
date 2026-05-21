/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Palette utilities for Elite Redux's 3-tier shiny renderer.
 *
 * Upstream Elite-Redux ships sprites as 4-bit indexed-color PNGs (16-color
 * palette, type 3) accompanied by two JASC-PAL text palette files per
 * species: `normal.pal` (the front/back PNG's embedded palette) and
 * `shiny.pal` (the alt palette for the in-game shiny form).
 *
 * Pokerogue uses 3 shiny tiers (regular/+/++). To approximate that without
 * hand-painting palettes, we render:
 *   - tier 1 (regular shiny) — exact upstream shiny.pal swap
 *   - tier 2 (shiny+)        — shiny.pal hue-rotated ~120°
 *   - tier 3 (shiny++)       — shiny.pal hue-rotated ~240°
 *
 * Both colour-space conversion (RGB↔HSV) and PNG palette-swap below are pure
 * — palette.test.ts exercises them on known inputs so the renderer's chunked
 * I/O stays trivially correct.
 */

// =============================================================================
// JASC-PAL parsing
// =============================================================================

/**
 * Parse a JASC-PAL (Paint Shop Pro) palette file. The format:
 *
 *   line 1: "JASC-PAL"
 *   line 2: version (always "0100")
 *   line 3: number of colours (typically "16" for GBA palettes)
 *   line 4+: "R G B" entries (decimal, 0-255 each)
 *
 * Throws on malformed input rather than silently returning a partial palette
 * — the renderer needs all 16 entries to do a 1:1 index swap.
 *
 * @param {string} text raw file contents (any line endings)
 * @returns {Array<{ r: number, g: number, b: number }>}
 */
export function parseJascPal(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  if (lines[0] !== "JASC-PAL") {
    throw new Error(`expected JASC-PAL header, got: ${lines[0]}`);
  }
  if (lines[1] !== "0100") {
    throw new Error(`expected JASC-PAL version 0100, got: ${lines[1]}`);
  }
  const count = Number.parseInt(lines[2], 10);
  if (!Number.isFinite(count) || count <= 0) {
    throw new Error(`invalid JASC-PAL count: ${lines[2]}`);
  }
  /** @type {Array<{ r: number, g: number, b: number }>} */
  const colors = [];
  for (let i = 0; i < count; i++) {
    const line = lines[3 + i];
    if (!line) {
      throw new Error(`JASC-PAL truncated at colour ${i} (expected ${count})`);
    }
    const parts = line.trim().split(/\s+/).map(Number);
    if (parts.length !== 3 || parts.some(n => !Number.isFinite(n) || n < 0 || n > 255)) {
      throw new Error(`JASC-PAL line ${3 + i}: expected "R G B" 0-255, got: ${line}`);
    }
    colors.push({ r: parts[0], g: parts[1], b: parts[2] });
  }
  return colors;
}

// =============================================================================
// HSV ↔ RGB
// =============================================================================

/**
 * Convert sRGB (0-255 ints) → HSV.
 *   h ∈ [0, 360)  (degrees)
 *   s ∈ [0, 1]
 *   v ∈ [0, 1]
 *
 * Standard Smith-1978 conversion. Achromatic colours get h=0.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {{ h: number, s: number, v: number }}
 */
export function rgbToHsv(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rn) {
      h = ((gn - bn) / delta) % 6;
    } else if (max === gn) {
      h = (bn - rn) / delta + 2;
    } else {
      h = (rn - gn) / delta + 4;
    }
    h *= 60;
    if (h < 0) {
      h += 360;
    }
  }
  const s = max === 0 ? 0 : delta / max;
  return { h, s, v: max };
}

/**
 * HSV → sRGB (0-255 ints), clamped + rounded.
 * @param {number} h hue degrees (any sign; will be normalised)
 * @param {number} s saturation 0-1
 * @param {number} v value 0-1
 * @returns {{ r: number, g: number, b: number }}
 */
export function hsvToRgb(h, s, v) {
  // Normalise hue into [0, 360).
  let hh = h % 360;
  if (hh < 0) {
    hh += 360;
  }
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let rp;
  let gp;
  let bp;
  if (hh < 60) {
    [rp, gp, bp] = [c, x, 0];
  } else if (hh < 120) {
    [rp, gp, bp] = [x, c, 0];
  } else if (hh < 180) {
    [rp, gp, bp] = [0, c, x];
  } else if (hh < 240) {
    [rp, gp, bp] = [0, x, c];
  } else if (hh < 300) {
    [rp, gp, bp] = [x, 0, c];
  } else {
    [rp, gp, bp] = [c, 0, x];
  }
  return {
    r: Math.max(0, Math.min(255, Math.round((rp + m) * 255))),
    g: Math.max(0, Math.min(255, Math.round((gp + m) * 255))),
    b: Math.max(0, Math.min(255, Math.round((bp + m) * 255))),
  };
}

/**
 * Hue-rotate every colour in a palette by `degrees` while preserving each
 * colour's saturation + value. Used to derive shiny+/shiny++ from the
 * upstream shiny.pal: the perceptual brightness stays similar but the
 * dominant hue shifts, giving distinct visual tiers without hand-painting.
 *
 * Achromatic colours (s=0) are left untouched — rotating grey/black/white
 * produces the same RGB anyway, but explicit pass-through avoids any
 * rounding drift.
 *
 * @param {Array<{ r: number, g: number, b: number }>} palette
 * @param {number} degrees
 */
export function rotateHue(palette, degrees) {
  return palette.map(({ r, g, b }) => {
    const { h, s, v } = rgbToHsv(r, g, b);
    if (s === 0) {
      return { r, g, b };
    }
    return hsvToRgb(h + degrees, s, v);
  });
}

// =============================================================================
// PNG palette swap (chunk-level rewrite — no zlib needed)
// =============================================================================

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Compute CRC32 of a buffer using the IEEE 802.3 polynomial (the PNG one). */
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[n] = c >>> 0;
  }
  return t;
})();

/**
 * @param {Buffer} buf
 * @param {number} start inclusive
 * @param {number} end exclusive
 */
export function crc32(buf, start = 0, end = buf.length) {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * @typedef {Object} PngChunk
 * @property {number} offset start of the 4-byte length field within the file
 * @property {number} length payload length (matches the length field)
 * @property {string} type chunk type ascii (e.g. "PLTE", "IDAT")
 * @property {number} dataStart offset of the chunk payload's first byte
 */

/**
 * Walk a PNG buffer's chunks. Throws on signature mismatch — the caller
 * should validate inputs come from a real PNG.
 * @param {Buffer} buf
 * @returns {PngChunk[]}
 */
export function readChunks(buf) {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error("not a PNG (bad signature)");
  }
  /** @type {PngChunk[]} */
  const chunks = [];
  let i = 8;
  while (i < buf.length) {
    const length = buf.readUInt32BE(i);
    const type = buf.toString("ascii", i + 4, i + 8);
    chunks.push({ offset: i, length, type, dataStart: i + 8 });
    i += 12 + length; // length(4) + type(4) + data + crc(4)
    if (type === "IEND") {
      break;
    }
  }
  return chunks;
}

/**
 * Produce a new PNG buffer with the PLTE chunk replaced by `newPalette`.
 * Preserves every other chunk byte-for-byte (including tRNS/transparency),
 * which is the entire reason this approach works without decompressing
 * IDAT: the pixel data is just palette indices.
 *
 * Throws when the source PNG has no PLTE chunk (i.e. it's not indexed-
 * colour) or when newPalette has a different colour count than the original
 * — same-size guarantees the IDAT indices stay valid.
 *
 * @param {Buffer} src raw PNG bytes
 * @param {Array<{ r: number, g: number, b: number }>} newPalette
 */
export function swapPalette(src, newPalette) {
  const chunks = readChunks(src);
  const plte = chunks.find(c => c.type === "PLTE");
  if (!plte) {
    throw new Error("PNG has no PLTE chunk (not indexed-colour?)");
  }
  if (plte.length % 3 !== 0) {
    throw new Error(`PLTE length ${plte.length} not a multiple of 3`);
  }
  const srcColors = plte.length / 3;
  if (newPalette.length !== srcColors) {
    throw new Error(`palette size mismatch: PNG has ${srcColors} colours, new palette has ${newPalette.length}`);
  }

  // Build the new chunk: same length, same type, new data, new CRC.
  const out = Buffer.from(src); // copy
  for (let i = 0; i < newPalette.length; i++) {
    const { r, g, b } = newPalette[i];
    out[plte.dataStart + i * 3 + 0] = r;
    out[plte.dataStart + i * 3 + 1] = g;
    out[plte.dataStart + i * 3 + 2] = b;
  }
  // CRC covers TYPE + DATA (not the 4-byte length field), per the PNG spec.
  const crcStart = plte.offset + 4;
  const crcEnd = plte.dataStart + plte.length;
  const crc = crc32(out, crcStart, crcEnd);
  out.writeUInt32BE(crc, crcEnd);
  return out;
}
