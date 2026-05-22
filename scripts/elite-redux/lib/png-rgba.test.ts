/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { describe, expect, it } from "vitest";
import { decodePngToRgba, downsampleNearest, encodeRgbaToPng, stackVertical } from "./png-rgba.mjs";

/**
 * Build a tiny synthetic RGBA test image: 4×4 with distinct corner pixels.
 * Used to verify round-trip encode/decode without relying on vendor assets.
 */
function makeTestImage(): { width: number; height: number; pixels: Buffer } {
  const w = 4;
  const h = 4;
  const pixels = Buffer.alloc(w * h * 4);
  // Fill with predictable RGBA values: pixel[y][x] = (y*16, x*16, (y+x)*8, 255)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      pixels[o + 0] = y * 16;
      pixels[o + 1] = x * 16;
      pixels[o + 2] = (y + x) * 8;
      pixels[o + 3] = 255;
    }
  }
  return { width: w, height: h, pixels };
}

describe("encodeRgbaToPng + decodePngToRgba", () => {
  it("round-trips a 4x4 RGBA image with bit-exact pixels", () => {
    const orig = makeTestImage();
    const png = encodeRgbaToPng(orig);
    expect(png[0]).toBe(0x89);
    expect(png[1]).toBe(0x50);
    expect(png[2]).toBe(0x4e);
    expect(png[3]).toBe(0x47);
    const decoded = decodePngToRgba(png);
    expect(decoded.width).toBe(4);
    expect(decoded.height).toBe(4);
    expect(decoded.pixels.equals(orig.pixels)).toBe(true);
  });

  it("decodes a 1x1 RGBA pixel", () => {
    const orig = {
      width: 1,
      height: 1,
      pixels: Buffer.from([128, 64, 32, 200]),
    };
    const png = encodeRgbaToPng(orig);
    const decoded = decodePngToRgba(png);
    expect(decoded.width).toBe(1);
    expect(decoded.height).toBe(1);
    expect(Array.from(decoded.pixels)).toEqual([128, 64, 32, 200]);
  });

  it("preserves transparency (alpha=0)", () => {
    const orig = {
      width: 2,
      height: 1,
      pixels: Buffer.from([255, 0, 0, 0, 0, 255, 0, 255]), // transparent red, opaque green
    };
    const png = encodeRgbaToPng(orig);
    const decoded = decodePngToRgba(png);
    expect(decoded.pixels[3]).toBe(0);
    expect(decoded.pixels[7]).toBe(255);
  });

  it("throws on bad signature", () => {
    const notPng = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
    expect(() => decodePngToRgba(notPng)).toThrow(/bad signature/);
  });

  it("rejects mismatched buffer size on encode", () => {
    const bad = { width: 4, height: 4, pixels: Buffer.alloc(8) };
    expect(() => encodeRgbaToPng(bad)).toThrow(/pixel buffer size/);
  });
});

describe("downsampleNearest", () => {
  it("halves dimensions with nearest-neighbour", () => {
    // 4x4 → 2x2: each output pixel pulls from one of 4 source pixels.
    const src = makeTestImage();
    const small = downsampleNearest(src, 2, 2);
    expect(small.width).toBe(2);
    expect(small.height).toBe(2);
    // Centre-of-cell sampling: dst(0,0) maps to src floor((0+0.5)*4/2)=src(1,1)
    // src(1,1) = (16, 16, 16, 255) per makeTestImage formula.
    expect(small.pixels[0]).toBe(16);
    expect(small.pixels[1]).toBe(16);
    expect(small.pixels[2]).toBe(16);
    expect(small.pixels[3]).toBe(255);
  });

  it("preserves the source when dimensions match", () => {
    const src = makeTestImage();
    const same = downsampleNearest(src, 4, 4);
    expect(same.pixels.equals(src.pixels)).toBe(true);
  });

  it("clamps out-of-range indices at the right/bottom edges", () => {
    // 2x2 → 3x3 upsample: don't crash, sample from the source somehow.
    const src = {
      width: 2,
      height: 2,
      pixels: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 128, 128, 128, 255]),
    };
    const out = downsampleNearest(src, 3, 3);
    expect(out.width).toBe(3);
    expect(out.height).toBe(3);
    expect(out.pixels.length).toBe(3 * 3 * 4);
  });
});

describe("stackVertical", () => {
  it("stacks two same-width images vertically", () => {
    const top = { width: 2, height: 1, pixels: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) };
    const bottom = { width: 2, height: 1, pixels: Buffer.from([9, 10, 11, 12, 13, 14, 15, 16]) };
    const stacked = stackVertical(top, bottom);
    expect(stacked.width).toBe(2);
    expect(stacked.height).toBe(2);
    expect(Array.from(stacked.pixels)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
  });

  it("throws on width mismatch", () => {
    const a = { width: 2, height: 1, pixels: Buffer.alloc(8) };
    const b = { width: 3, height: 1, pixels: Buffer.alloc(12) };
    expect(() => stackVertical(a, b)).toThrow(/width mismatch/);
  });
});

describe("decodePngToRgba — indexed-colour PNGs", () => {
  it("decodes a 4-bit indexed PNG with embedded PLTE (palette-swap fast path source)", async () => {
    // Use a real upstream indexed PNG as ground-truth input.
    const { existsSync } = await import("node:fs");
    const { readFile } = await import("node:fs/promises");
    const { resolve } = await import("node:path");
    const src = resolve(__dirname, "../../../vendor/elite-redux/sprites/graphics/pokemon/bulbasaur/front.png");
    if (!existsSync(src)) {
      // Vendor not checked out — skip.
      return;
    }
    const buf = await readFile(src);
    const img = decodePngToRgba(buf);
    expect(img.width).toBe(64);
    expect(img.height).toBe(64);
    expect(img.pixels.length).toBe(64 * 64 * 4);
    // Every alpha byte should be either 0 (transparent index) or 255 (opaque).
    // We don't know exactly which colour, but the round-trip should be valid.
    for (let i = 3; i < img.pixels.length; i += 4) {
      const a = img.pixels[i];
      expect(a === 0 || a === 255).toBe(true);
    }
  });
});
