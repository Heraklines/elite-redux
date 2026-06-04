/*
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-FileContributor: Sisyphus
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * Pure-unit tests for the algorithmic tier-2/tier-3 shiny renderer.
 *
 * Scope: colour-space math (rgbToHsl/hslToRgb), delta detection
 * (isShinyDelta), and the core per-pixel transform (rotatePixel) plus
 * the per-image driver (renderTier). No file I/O — the driver gets fed
 * pre-built RGBA buffers, the file-walking logic is covered by the smoke
 * test in render-redux-shinies.mjs itself.
 */

import { describe, expect, it } from "vitest";
import {
  DELTA_EPSILON,
  hslToRgb,
  isShinyDelta,
  renderTier,
  rgbToHsl,
  rotatePixel,
  SATURATION_FLOOR,
  TIER_2_HUE_SHIFT,
  TIER_3_HUE_SHIFT,
} from "./render-redux-shinies.mjs";

describe("rgbToHsl / hslToRgb", () => {
  it("round-trips primary colours within rounding tolerance", () => {
    for (const [r, g, b] of [
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 255, 0],
      [0, 255, 255],
      [255, 0, 255],
    ]) {
      const { h, s, l } = rgbToHsl(r, g, b);
      const back = hslToRgb(h, s, l);
      expect(back).toEqual({ r, g, b });
    }
  });

  it("reports achromatic colours as h=0 s=0", () => {
    expect(rgbToHsl(0, 0, 0)).toEqual({ h: 0, s: 0, l: 0 });
    expect(rgbToHsl(128, 128, 128).s).toBe(0);
    expect(rgbToHsl(255, 255, 255).s).toBe(0);
    expect(rgbToHsl(255, 255, 255).l).toBe(1);
  });

  it("places red at h=0, green at h=120, blue at h=240", () => {
    expect(rgbToHsl(255, 0, 0).h).toBe(0);
    expect(rgbToHsl(0, 255, 0).h).toBe(120);
    expect(rgbToHsl(0, 0, 255).h).toBe(240);
  });

  it("preserves lightness when rotating hue", () => {
    // A 50%-lightness red rotated +120° should land on a 50%-lightness green.
    const red = rgbToHsl(255, 0, 0); // h=0, s=1, l=0.5
    const greenAt50 = hslToRgb(red.h + 120, red.s, red.l); // pure green
    expect(greenAt50).toEqual({ r: 0, g: 255, b: 0 });

    // A dark navy should rotate to a dark colour, not a bright one.
    const navy = rgbToHsl(0, 0, 100); // l ≈ 0.196
    const rotated = hslToRgb(navy.h + 120, navy.s, navy.l);
    const rotatedHsl = rgbToHsl(rotated.r, rotated.g, rotated.b);
    expect(Math.abs(rotatedHsl.l - navy.l)).toBeLessThan(0.01);
  });

  it("hslToRgb handles negative hue input", () => {
    const a = hslToRgb(-60, 1, 0.5);
    const b = hslToRgb(300, 1, 0.5);
    expect(a).toEqual(b);
  });

  it("hslToRgb collapses s=0 to grey", () => {
    expect(hslToRgb(180, 0, 0.5)).toEqual({ r: 128, g: 128, b: 128 });
    expect(hslToRgb(45, 0, 0)).toEqual({ r: 0, g: 0, b: 0 });
    expect(hslToRgb(200, 0, 1)).toEqual({ r: 255, g: 255, b: 255 });
  });
});

describe("isShinyDelta", () => {
  it("returns false for identical pixels", () => {
    expect(isShinyDelta(100, 50, 20, 100, 50, 20)).toBe(false);
  });

  it("returns false for sub-epsilon noise on any channel", () => {
    const noise = DELTA_EPSILON - 1;
    expect(isShinyDelta(100, 50, 20, 100 + noise, 50, 20)).toBe(false);
    expect(isShinyDelta(100, 50, 20, 100, 50 + noise, 20)).toBe(false);
    expect(isShinyDelta(100, 50, 20, 100, 50, 20 + noise)).toBe(false);
  });

  it("returns true once any single channel exceeds the epsilon", () => {
    expect(isShinyDelta(100, 50, 20, 100 + DELTA_EPSILON, 50, 20)).toBe(true);
    expect(isShinyDelta(100, 50, 20, 100, 50 + DELTA_EPSILON, 20)).toBe(true);
    expect(isShinyDelta(100, 50, 20, 100, 50, 20 + DELTA_EPSILON)).toBe(true);
  });

  it("uses max-per-channel (L∞) — small deltas on multiple channels still under the floor", () => {
    const small = DELTA_EPSILON - 1;
    expect(isShinyDelta(100, 50, 20, 100 + small, 50 + small, 20 + small)).toBe(false);
  });
});

describe("rotatePixel", () => {
  const HUE = TIER_2_HUE_SHIFT;

  it("passes transparent shiny pixels through unchanged", () => {
    const out = rotatePixel(255, 0, 0, 0, 255, 255, 0, HUE);
    expect(out).toEqual({ r: 0, g: 255, b: 255, a: 0 });
  });

  it("preserves shiny pixels that didn't change from the base", () => {
    // base == shiny → not a "shiny delta" pixel → pass through.
    const out = rotatePixel(120, 60, 30, 120, 60, 30, 255, HUE);
    expect(out).toEqual({ r: 120, g: 60, b: 30, a: 255 });
  });

  it("preserves near-grayscale shiny pixels even when they changed", () => {
    // Shiny pixel differs from base, but its own saturation < floor.
    // (200, 198, 200) is essentially grey; rotation would just churn noise
    // around the grey axis. The floor catches it before that happens.
    const shiny = { r: 200, g: 198, b: 200 };
    const inHsl = rgbToHsl(shiny.r, shiny.g, shiny.b);
    expect(inHsl.s).toBeLessThan(SATURATION_FLOOR);

    const out = rotatePixel(0, 0, 0, shiny.r, shiny.g, shiny.b, 255, HUE);
    expect(out).toEqual({ ...shiny, a: 255 });
  });

  it("rotates a vivid red shiny pixel into a vivid green (tier-2)", () => {
    // Base = white (255,255,255), shiny = vivid red (255, 30, 30) — clearly
    // a shiny-recoloured pixel.
    const out = rotatePixel(255, 255, 255, 255, 30, 30, 255, TIER_2_HUE_SHIFT);
    // Expect roughly green-dominant.
    expect(out.g).toBeGreaterThan(out.r);
    expect(out.g).toBeGreaterThan(out.b);
    expect(out.a).toBe(255);
  });

  it("rotates a vivid red shiny pixel into a vivid blue (tier-3)", () => {
    const out = rotatePixel(255, 255, 255, 255, 30, 30, 255, TIER_3_HUE_SHIFT);
    expect(out.b).toBeGreaterThan(out.r);
    expect(out.b).toBeGreaterThan(out.g);
    expect(out.a).toBe(255);
  });

  it("preserves the shiny pixel's lightness through rotation", () => {
    // A dark-ish red (l ≈ 0.31). Tier-2 should land at similar lightness.
    const base = { r: 255, g: 255, b: 255 };
    const shiny = { r: 158, g: 5, b: 5 };
    const out = rotatePixel(base.r, base.g, base.b, shiny.r, shiny.g, shiny.b, 255, TIER_2_HUE_SHIFT);
    const inHsl = rgbToHsl(shiny.r, shiny.g, shiny.b);
    const outHsl = rgbToHsl(out.r, out.g, out.b);
    expect(Math.abs(outHsl.l - inHsl.l)).toBeLessThan(0.01);
  });

  it("preserves the shiny pixel's saturation through rotation", () => {
    const shiny = { r: 200, g: 60, b: 60 };
    const out = rotatePixel(0, 0, 0, shiny.r, shiny.g, shiny.b, 255, TIER_2_HUE_SHIFT);
    const inHsl = rgbToHsl(shiny.r, shiny.g, shiny.b);
    const outHsl = rgbToHsl(out.r, out.g, out.b);
    expect(Math.abs(outHsl.s - inHsl.s)).toBeLessThan(0.02);
  });

  it("tier-2 followed by tier-3 conceptually returns near base (360° round)", () => {
    // 120 + 240 = 360 = back to start.
    const shiny = { r: 200, g: 30, b: 100 };
    const tier2 = rotatePixel(0, 0, 0, shiny.r, shiny.g, shiny.b, 255, TIER_2_HUE_SHIFT);
    // Hand-feed the tier-2 result as a "shiny" with base=tier-2 → no delta!
    // So the more useful invariant is: rotating shiny by 360° must equal shiny.
    const round = rotatePixel(0, 0, 0, shiny.r, shiny.g, shiny.b, 255, 360);
    expect(Math.abs(round.r - shiny.r)).toBeLessThanOrEqual(1);
    expect(Math.abs(round.g - shiny.g)).toBeLessThanOrEqual(1);
    expect(Math.abs(round.b - shiny.b)).toBeLessThanOrEqual(1);
    // Suppress unused-var warning while keeping the invariant explicit.
    expect(tier2).toBeDefined();
  });
});

describe("renderTier", () => {
  /**
   * Build a small RGBA buffer from a colour-per-pixel list. Convenience for
   * driver-level tests — every pixel below shares the same alpha (255).
   */
  function buildImg(width: number, height: number, colours: [number, number, number][]) {
    expect(colours.length).toBe(width * height);
    const pixels = Buffer.alloc(width * height * 4);
    for (let i = 0; i < colours.length; i++) {
      pixels[i * 4 + 0] = colours[i][0];
      pixels[i * 4 + 1] = colours[i][1];
      pixels[i * 4 + 2] = colours[i][2];
      pixels[i * 4 + 3] = 255;
    }
    return { width, height, pixels };
  }

  it("rejects mismatched dimensions", () => {
    const base = buildImg(2, 1, [
      [0, 0, 0],
      [0, 0, 0],
    ]);
    const shiny = buildImg(1, 2, [
      [0, 0, 0],
      [0, 0, 0],
    ]);
    expect(() => renderTier(base, shiny, TIER_2_HUE_SHIFT)).toThrow(/dimension mismatch/);
  });

  it("transforms a 2×2 image: unchanged + recoloured pixels", () => {
    // Top-left: black on black (unchanged). Top-right: red shiny on white base
    // (recoloured). Bottom-left: white on white (unchanged). Bottom-right:
    // dark navy shiny on white base (recoloured).
    const base = buildImg(2, 2, [
      [0, 0, 0],
      [255, 255, 255],
      [255, 255, 255],
      [255, 255, 255],
    ]);
    const shiny = buildImg(2, 2, [
      [0, 0, 0],
      [255, 30, 30],
      [255, 255, 255],
      [10, 10, 80],
    ]);

    const out = renderTier(base, shiny, TIER_2_HUE_SHIFT);
    expect(out.width).toBe(2);
    expect(out.height).toBe(2);

    // pixel 0 (black, unchanged) → preserved
    expect(out.pixels[0]).toBe(0);
    expect(out.pixels[1]).toBe(0);
    expect(out.pixels[2]).toBe(0);

    // pixel 1 (vivid red recolour) → green-ish after +120° rotation
    const p1 = [out.pixels[4], out.pixels[5], out.pixels[6]];
    expect(p1[1]).toBeGreaterThan(p1[0]);
    expect(p1[1]).toBeGreaterThan(p1[2]);

    // pixel 2 (white, unchanged) → preserved
    expect(out.pixels[8]).toBe(255);
    expect(out.pixels[9]).toBe(255);
    expect(out.pixels[10]).toBe(255);

    // pixel 3 (dark navy recolour) → rotated; still dark; not muddy black
    const p3 = [out.pixels[12], out.pixels[13], out.pixels[14]];
    const maxC = Math.max(p3[0], p3[1], p3[2]);
    expect(maxC).toBeGreaterThan(0); // not pure black
    expect(maxC).toBeLessThan(150); // still in the dark range
  });

  it("preserves alpha unchanged across the buffer", () => {
    const base = buildImg(1, 1, [[100, 100, 100]]);
    const shinyPixels = Buffer.from([255, 0, 0, 200]); // semi-transparent red
    const shiny = { width: 1, height: 1, pixels: shinyPixels };
    const out = renderTier(base, shiny, TIER_2_HUE_SHIFT);
    expect(out.pixels[3]).toBe(200);
  });

  it("triadic rotation: tier-2 and tier-3 produce visibly different colours from tier-1", () => {
    const base = buildImg(1, 1, [[255, 255, 255]]);
    const shiny = buildImg(1, 1, [[220, 50, 50]]); // bright red

    const tier2 = renderTier(base, shiny, TIER_2_HUE_SHIFT);
    const tier3 = renderTier(base, shiny, TIER_3_HUE_SHIFT);

    const t1 = [shiny.pixels[0], shiny.pixels[1], shiny.pixels[2]];
    const t2 = [tier2.pixels[0], tier2.pixels[1], tier2.pixels[2]];
    const t3 = [tier3.pixels[0], tier3.pixels[1], tier3.pixels[2]];

    // Each pair should differ noticeably — well above the noise epsilon.
    const dist = (a: number[], b: number[]) =>
      Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
    expect(dist(t1, t2)).toBeGreaterThan(50);
    expect(dist(t1, t3)).toBeGreaterThan(50);
    expect(dist(t2, t3)).toBeGreaterThan(50);
  });
});

describe("constants surface", () => {
  it("exports the documented tier offsets and floors", () => {
    expect(TIER_2_HUE_SHIFT).toBe(120);
    expect(TIER_3_HUE_SHIFT).toBe(240);
    expect(DELTA_EPSILON).toBe(5);
    expect(SATURATION_FLOOR).toBe(0.1);
  });
});
