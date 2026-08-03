/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import {
  getSpriteFusionPaletteUniforms,
  getSpriteVariantPaletteUniforms,
} from "#app/pipelines/sprite-palette-uniforms";
import { describe, expect, it } from "vitest";

describe("sprite palette uniform caches", () => {
  it("reuses fusion uniforms until either palette identity changes", () => {
    const owner = {};
    const base = [[255, 128, 0, 255]];
    const fusion = [[12, 34, 56, 255]];
    const first = getSpriteFusionPaletteUniforms(owner, base, fusion);
    const second = getSpriteFusionPaletteUniforms(owner, base, fusion);
    expect(second).toBe(first);
    expect(first.spriteColors.slice(0, 4)).toEqual([1, 128 / 255, 0, 1]);
    expect(first.fusionSpriteColors.slice(0, 4)).toEqual([12, 34, 56, 255]);

    const replacement = getSpriteFusionPaletteUniforms(owner, [...base], fusion);
    expect(replacement).not.toBe(first);
  });

  it("parses each immutable shiny palette once and preserves shader layout", () => {
    const palette = { ff0000: "00ff80", "112233": "aabbcc" };
    const first = getSpriteVariantPaletteUniforms(palette);
    const second = getSpriteVariantPaletteUniforms(palette);
    expect(second).toBe(first);
    // Integer-like object keys retain JavaScript's numeric-key ordering, matching
    // the old pipeline's Object.keys behavior exactly.
    expect(first.baseVariantColors.slice(0, 8)).toEqual([17 / 255, 34 / 255, 51 / 255, 1, 1, 0, 0, 1]);
    expect(first.variantColors.slice(0, 8)).toEqual([170 / 255, 187 / 255, 204 / 255, 1, 0, 1, 128 / 255, 1]);
    expect(first.baseVariantColors).toHaveLength(128);
    expect(first.variantColors).toHaveLength(128);
  });

  it("shares a zero-filled palette for non-shiny sprites", () => {
    const first = getSpriteVariantPaletteUniforms();
    const second = getSpriteVariantPaletteUniforms();
    expect(second.baseVariantColors).toBe(first.baseVariantColors);
    expect(second.variantColors).toBe(first.variantColors);
    expect(first.baseVariantColors.every(value => value === 0)).toBe(true);
  });
});
