/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { rgbHexToRgba } from "#utils/color-utils";

const PALETTE_COLOR_LIMIT = 32;
const RGBA_CHANNELS = 4;
const UNIFORM_LENGTH = PALETTE_COLOR_LIMIT * RGBA_CHANNELS;
const EMPTY_FLOAT_PALETTE = Object.freeze(new Array<number>(UNIFORM_LENGTH).fill(0));
const EMPTY_INT_PALETTE = Object.freeze(new Array<number>(UNIFORM_LENGTH).fill(0));

export interface SpriteFusionPaletteUniforms {
  spriteColors: readonly number[];
  fusionSpriteColors: readonly number[];
}

export interface SpriteVariantPaletteUniforms {
  baseVariantColors: readonly number[];
  variantColors: readonly number[];
}

interface FusionCacheEntry extends SpriteFusionPaletteUniforms {
  spriteSource: readonly (readonly number[])[];
  fusionSource: readonly (readonly number[])[];
}

const fusionUniformCache = new WeakMap<object, FusionCacheEntry>();
const variantUniformCache = new WeakMap<object, SpriteVariantPaletteUniforms>();

function flattenColors(colors: readonly (readonly number[])[], normalize: boolean): number[] {
  const result = new Array<number>(UNIFORM_LENGTH).fill(0);
  const count = Math.min(colors.length, PALETTE_COLOR_LIMIT);
  const divisor = normalize ? 255 : 1;
  for (let colorIndex = 0; colorIndex < count; colorIndex++) {
    const color = colors[colorIndex];
    const offset = colorIndex * RGBA_CHANNELS;
    for (let channel = 0; channel < RGBA_CHANNELS; channel++) {
      result[offset + channel] = (color[channel] ?? 0) / divisor;
    }
  }
  return result;
}

/**
 * Flatten fusion palettes once per sprite/palette identity instead of rebuilding and
 * allocating two 128-value arrays every render bind.
 */
export function getSpriteFusionPaletteUniforms(
  owner: object,
  spriteColors: readonly (readonly number[])[],
  fusionSpriteColors: readonly (readonly number[])[],
): SpriteFusionPaletteUniforms {
  const cached = fusionUniformCache.get(owner);
  if (cached?.spriteSource === spriteColors && cached.fusionSource === fusionSpriteColors) {
    return cached;
  }
  const entry: FusionCacheEntry = {
    spriteSource: spriteColors,
    fusionSource: fusionSpriteColors,
    spriteColors: spriteColors.length > 0 ? flattenColors(spriteColors, true) : EMPTY_FLOAT_PALETTE,
    fusionSpriteColors: fusionSpriteColors.length > 0 ? flattenColors(fusionSpriteColors, false) : EMPTY_INT_PALETTE,
  };
  fusionUniformCache.set(owner, entry);
  return entry;
}

/**
 * Convert a shiny variant palette once per immutable palette object. Active shiny
 * battlers otherwise parsed up to 64 hex colors and allocated 256+ values every frame,
 * which scaled directly with doubles/triples field width.
 */
export function getSpriteVariantPaletteUniforms(
  palette?: Readonly<Record<string, string>>,
): SpriteVariantPaletteUniforms {
  if (!palette) {
    return {
      baseVariantColors: EMPTY_FLOAT_PALETTE,
      variantColors: EMPTY_FLOAT_PALETTE,
    };
  }
  const cached = variantUniformCache.get(palette);
  if (cached) {
    return cached;
  }

  const baseVariantColors = new Array<number>(UNIFORM_LENGTH).fill(0);
  const variantColors = new Array<number>(UNIFORM_LENGTH).fill(0);
  const baseColors = Object.keys(palette).slice(0, PALETTE_COLOR_LIMIT);
  for (let colorIndex = 0; colorIndex < baseColors.length; colorIndex++) {
    const base = rgbHexToRgba(baseColors[colorIndex]);
    const variant = rgbHexToRgba(palette[baseColors[colorIndex]]);
    const offset = colorIndex * RGBA_CHANNELS;
    baseVariantColors[offset] = base.r / 255;
    baseVariantColors[offset + 1] = base.g / 255;
    baseVariantColors[offset + 2] = base.b / 255;
    baseVariantColors[offset + 3] = base.a / 255;
    variantColors[offset] = variant.r / 255;
    variantColors[offset + 1] = variant.g / 255;
    variantColors[offset + 2] = variant.b / 255;
    variantColors[offset + 3] = variant.a / 255;
  }
  const uniforms = { baseVariantColors, variantColors };
  variantUniformCache.set(palette, uniforms);
  return uniforms;
}
