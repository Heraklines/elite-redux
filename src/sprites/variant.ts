import { globalScene } from "#app/global-scene";
import {
  buildErShinyLabVariantPalette,
  decodeErShinyLabLoadout,
  decodeErShinyLabSavedLook,
  type ErShinyLabSaveData,
  type ErShinyLabSavedLook,
  getErShinyLabOwnedSet,
} from "#data/elite-redux/er-shiny-lab-effects";
import { VariantTier } from "#enums/variant-tier";
import type { Pokemon } from "#field/pokemon";
import { hasExpSprite } from "#sprites/sprite-utils";
import { cachedFetch } from "#utils/fetch-utils";

export type Variant = 0 | 1 | 2;

export type VariantSet = [Variant, Variant, Variant];

export const variantData: any = {};

/** Caches variant colors that have been generated */
export const variantColorCache = {};

export function getVariantTint(variant: Variant): number {
  switch (variant) {
    case 0:
      return 0xf8c020;
    case 1:
      return 0x20f8f0;
    case 2:
      return 0xe81048;
  }
}

export function getVariantIcon(variant: Variant): number {
  switch (variant) {
    case 0:
      return VariantTier.STANDARD;
    case 1:
      return VariantTier.RARE;
    case 2:
      return VariantTier.EPIC;
  }
}

/** Delete all of the keys in variantData */
export function clearVariantData(): void {
  for (const key in variantData) {
    delete variantData[key];
  }
}

/** Update the variant data to use experiment sprite files for variants that have experimental sprites. */
export async function mergeExperimentalData(mainData: any, expData: any): Promise<void> {
  if (!expData) {
    return;
  }

  for (const key of Object.keys(expData)) {
    if (typeof expData[key] === "object" && !Array.isArray(expData[key])) {
      // If the value is an object, recursively merge.
      if (!mainData[key]) {
        mainData[key] = {};
      }
      mergeExperimentalData(mainData[key], expData[key]);
    } else {
      // Otherwise, replace the value
      mainData[key] = expData[key];
    }
  }
}

/**
 * Populate the variant color cache with the variant colors for this pokemon.
 * The global scene must be initialized before this function is called.
 */
export async function populateVariantColors(
  pokemon: Pokemon,
  isBackSprite = false,
  ignoreOverride = true,
): Promise<void> {
  const battleSpritePath = pokemon
    .getBattleSpriteAtlasPath(isBackSprite, ignoreOverride)
    .replace("variant/", "")
    .replace(/_[1-3]$/, "");
  let config = variantData;
  const useExpSprite =
    globalScene.experimentalSprites && hasExpSprite(pokemon.getBattleSpriteKey(isBackSprite, ignoreOverride));
  battleSpritePath.split("/").map(p => (config ? (config = config[p]) : null));
  const variantSet: VariantSet = config as VariantSet;
  if (!variantSet || variantSet[pokemon.variant] !== 1) {
    return;
  }
  const cacheKey = pokemon.getBattleSpriteKey(isBackSprite);
  if (!Object.hasOwn(variantColorCache, cacheKey)) {
    await populateVariantColorCache(cacheKey, useExpSprite, battleSpritePath);
  }
}

export function getErShinyLabPaletteIdFromSave(save?: ErShinyLabSaveData): string | null {
  const palette = decodeErShinyLabLoadout(save?.l).palette;
  return palette && getErShinyLabOwnedSet(save, "palette").has(palette) ? palette : null;
}

export function getErShinyLabPaletteIdForSpecies(speciesId: number): string | null {
  const save = globalScene.gameData?.getStarterDataEntry(speciesId).erShinyLab;
  return getErShinyLabPaletteIdFromSave(save);
}

export function getErShinyLabPaletteId(
  pokemon: Pokemon & {
    customPokemonData?: {
      erShinyLab?: ErShinyLabSavedLook | undefined;
      erShinyLabSuppressLocal?: boolean | undefined;
    };
  },
): string | null {
  const carriedLook = decodeErShinyLabSavedLook(pokemon.customPokemonData?.erShinyLab);
  if (carriedLook?.loadout.palette) {
    return carriedLook.loadout.palette;
  }
  if (pokemon.customPokemonData?.erShinyLabSuppressLocal) {
    return null;
  }
  return getErShinyLabPaletteIdForSpecies(pokemon.species.speciesId);
}

export function getErShinyLabVariantCacheKey(baseKey: string, paletteId: string): string {
  return `${baseKey}-erlab-${paletteId}`;
}

const syntheticErShinyLabVariantCacheKeys = new Set<string>();

function colorToHex(r: number, g: number, b: number): string {
  return `${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

function buildIdentityVariantPaletteFromTexture(baseKey: string): Record<number, Record<string, string>> | null {
  try {
    if (typeof document === "undefined" || !globalScene.textures.exists(baseKey)) {
      return null;
    }
    const texture = globalScene.textures.get(baseKey) as Phaser.Textures.Texture & {
      getSourceImage?: () => CanvasImageSource | null;
      source?: { image?: CanvasImageSource } | { image?: CanvasImageSource }[];
    };
    const textureSource = texture.source as unknown as
      | { image?: CanvasImageSource }
      | { image?: CanvasImageSource }[]
      | undefined;
    const source = (texture.getSourceImage?.()
      ?? (Array.isArray(textureSource) ? textureSource[0]?.image : textureSource?.image)
      ?? null) as CanvasImageSource & { width?: number; height?: number };
    const width = Math.floor(source?.width ?? 0);
    const height = Math.floor(source?.height ?? 0);
    if (!source || width <= 0 || height <= 0) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) {
      return null;
    }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(source, 0, 0);
    const pixels = ctx.getImageData(0, 0, width, height).data;
    const counts = new Map<string, number>();
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] <= 16) {
        continue;
      }
      const hex = colorToHex(pixels[i], pixels[i + 1], pixels[i + 2]);
      counts.set(hex, (counts.get(hex) ?? 0) + 1);
    }
    const colors = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 32)
      .map(([hex]) => hex);
    if (colors.length === 0) {
      return null;
    }
    const identity = Object.fromEntries(colors.map(hex => [hex, hex]));
    return { 0: identity, 1: identity, 2: identity };
  } catch {
    return null;
  }
}

export function ensureErShinyLabPaletteVariantCache(
  baseKey: string,
  paletteId: string | null,
  variant: Variant = 0,
): string | null {
  if (!paletteId) {
    return null;
  }
  const cacheKey = getErShinyLabVariantCacheKey(baseKey, paletteId);
  const hasRealBaseColors = Object.hasOwn(variantColorCache, baseKey);
  const shouldBuild =
    !Object.hasOwn(variantColorCache, cacheKey)
    || (syntheticErShinyLabVariantCacheKeys.has(cacheKey) && hasRealBaseColors);
  if (!shouldBuild) {
    return cacheKey;
  }

  const baseColors =
    (variantColorCache[baseKey] as Record<number, Record<string, string>> | undefined)
    ?? buildIdentityVariantPaletteFromTexture(baseKey);
  if (!baseColors) {
    return Object.hasOwn(variantColorCache, cacheKey) ? cacheKey : null;
  }

  const palette = buildErShinyLabVariantPalette(baseColors, paletteId, variant);
  if (Object.keys(palette[variant] ?? palette[0] ?? {}).length > 0) {
    variantColorCache[cacheKey] = palette;
    if (hasRealBaseColors) {
      syntheticErShinyLabVariantCacheKeys.delete(cacheKey);
    } else {
      syntheticErShinyLabVariantCacheKeys.add(cacheKey);
    }
  }
  return Object.hasOwn(variantColorCache, cacheKey) ? cacheKey : null;
}

export function getErShinyLabPaletteVariantCacheKey(pokemon: Pokemon, baseKey: string): string | null {
  const paletteId = getErShinyLabPaletteId(pokemon);
  return ensureErShinyLabPaletteVariantCache(baseKey, paletteId, pokemon.variant);
}

export function populateErShinyLabPaletteVariantColors(pokemon: Pokemon, isBackSprite = false): void {
  const paletteId = getErShinyLabPaletteId(pokemon);
  if (!paletteId) {
    return;
  }
  const baseKey = pokemon.getBattleSpriteKey(isBackSprite);
  ensureErShinyLabPaletteVariantCache(baseKey, paletteId, pokemon.variant);
}

/**
 * Gracefully handle errors loading a variant sprite. Log if it fails and attempt to fall back on
 * non-experimental sprites before giving up.
 *
 * @param cacheKey - The cache key for the variant color sprite
 * @param attemptedSpritePath - The sprite path that failed to load
 * @param useExpSprite - Was the attempted sprite experimental
 * @param battleSpritePath - The filename of the sprite
 * @param optionalParams - Any additional params to log
 */
async function fallbackVariantColor(
  cacheKey: string,
  attemptedSpritePath: string,
  useExpSprite: boolean,
  battleSpritePath: string,
  ...optionalParams: any[]
): Promise<void> {
  console.warn(`Could not load ${attemptedSpritePath}!`, ...optionalParams);
  if (useExpSprite) {
    await populateVariantColorCache(cacheKey, false, battleSpritePath);
  }
}

/**
 * Fetch a variant color sprite from the key and store it in the variant color cache.
 *
 * @param cacheKey - The cache key for the variant color sprite
 * @param useExpSprite - Should the experimental sprite be used
 * @param battleSpritePath - The filename of the sprite
 */
export async function populateVariantColorCache(
  cacheKey: string,
  useExpSprite: boolean,
  battleSpritePath: string,
): Promise<void> {
  const spritePath = `./images/pokemon/variant/${useExpSprite ? "exp/" : ""}${battleSpritePath}.json`;
  return cachedFetch(spritePath)
    .then(res => {
      // Prevent the JSON from processing if it failed to load
      if (!res.ok) {
        return fallbackVariantColor(cacheKey, res.url, useExpSprite, battleSpritePath, res.status, res.statusText);
      }
      return res.json();
    })
    .catch(error => {
      return fallbackVariantColor(cacheKey, spritePath, useExpSprite, battleSpritePath, error);
    })
    .then(c => {
      if (c != null) {
        variantColorCache[cacheKey] = c;
      }
    });
}
