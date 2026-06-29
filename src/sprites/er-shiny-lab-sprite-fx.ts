import { globalScene } from "#app/global-scene";
import {
  decodeErShinyLabLoadout,
  decodeErShinyLabParams,
  decodeErShinyLabSavedLook,
  type ErShinyLabCategory,
  type ErShinyLabLoadout,
  type ErShinyLabNameStyle,
  type ErShinyLabParams,
  type ErShinyLabSavedLook,
  getErShinyLabNameStyle,
  getErShinyLabOwnedSet,
  isErShinyLabNameFxUnlocked,
  sanitizeErShinyLabLoadout,
} from "#data/elite-redux/er-shiny-lab-effects";
import {
  ER_SHINY_LAB_RENDER_PAD,
  type ErShinyLabRenderedPixels,
  type ErShinyLabSourcePixels,
  renderErShinyLabLook,
} from "#data/elite-redux/er-shiny-lab-renderer";
import { Gender } from "#data/gender";
import type { PokemonSpecies } from "#data/pokemon-species";
import type { Variant } from "#sprites/variant";

export const ER_SHINY_LAB_MINI_ICON_RENDER_PAD = 4;

interface PokemonSpriteFormLike {
  getIconAtlasKey(formIndex?: number, shiny?: boolean, variant?: number): string;
  getIconId(female: boolean, formIndex?: number, shiny?: boolean, variant?: number): string;
  getSpriteAtlasPath(female: boolean, formIndex?: number, shiny?: boolean, variant?: number, back?: boolean): string;
  getSpriteId(female: boolean, formIndex?: number, shiny?: boolean, variant?: number, back?: boolean): string;
  getSpriteKey(female: boolean, formIndex?: number, shiny?: boolean, variant?: number): string;
}

type PokemonLike = {
  species: PokemonSpecies;
  formIndex: number;
  variant: Variant;
  shiny: boolean;
  customPokemonData?: { erShinyLab?: ErShinyLabSavedLook | undefined; erShinyLabSuppressLocal?: boolean } | null;
  summonData?: { illusion?: { formIndex?: number; variant?: Variant } | null };
  getBattleSpriteKey(back?: boolean, ignoreOverride?: boolean): string;
  getBattleSpriteAtlasPath(back?: boolean, ignoreOverride?: boolean): string;
  getGender(ignoreOverride?: boolean, useIllusion?: boolean): Gender;
  getIconAtlasKey(ignoreOverride?: boolean, useIllusion?: boolean): string;
  getIconId(ignoreOverride?: boolean, useIllusion?: boolean): string;
  getSpeciesForm(ignoreOverride?: boolean, useIllusion?: boolean): PokemonSpriteFormLike;
  getSpriteAtlasPath(ignoreOverride?: boolean): string;
  getSpriteKey(ignoreOverride?: boolean): string;
};

export interface ErShinyLabSpriteFxLook {
  loadout: ErShinyLabLoadout;
  params: ErShinyLabParams;
}

export interface ErShinyLabSpriteSourceRef {
  key: string;
  frame?: string | number | null;
  atlasPath?: string;
}

interface SpriteFxData {
  key?: string | null;
  sourceKey?: string | null;
  sourceFrame?: string | number | null;
  sourceOriginX?: number;
  sourceOriginY?: number;
  state?: string | undefined;
}

interface ApplySpriteFxOptions {
  source?: ErShinyLabSpriteSourceRef | null;
  keyPrefix: string;
  time?: number;
  state?: string;
  renderPad?: number;
}

interface RenderedTextureApplyOptions {
  keyPrefix: string;
  sourceWidth: number;
  sourceHeight: number;
  sourceOriginX: number;
  sourceOriginY: number;
  cacheKey?: string;
}

type CachedSourcePixels = ErShinyLabSourcePixels & { frame: Phaser.Textures.Frame };

interface RenderTextureCacheEntry {
  textureKey: string;
  lastUsed: number;
  refCount: number;
}

const ER_SHINY_LAB_RENDER_TEXTURE_CACHE_MAX = 240;
const sourcePixelCache = new Map<string, CachedSourcePixels>();
const renderTextureCache = new Map<string, RenderTextureCacheEntry>();
const renderTextureKeyToCacheKey = new Map<string, string>();
let renderTextureCacheClock = 0;

function spriteFxData(sprite: Phaser.GameObjects.Sprite): SpriteFxData {
  const data = sprite.pipelineData as Record<string, unknown>;
  const existing = data.erShinyLabFx as SpriteFxData | undefined;
  if (existing) {
    return existing;
  }
  const created: SpriteFxData = {};
  data.erShinyLabFx = created;
  return created;
}

function nextTextureKey(prefix: string): string {
  const textures = globalScene.textures;
  let i = 0;
  let key = "";
  do {
    key = `${prefix}-${Date.now().toString(36)}-${++i}`;
  } while (textures.exists(key));
  return key;
}

function removeTextureNow(key?: string | null): void {
  if (!key) {
    return;
  }
  try {
    const textures = globalScene.textures as Phaser.Textures.TextureManager & { remove?: (key: string) => unknown };
    if (textures.exists(key)) {
      textures.remove?.(key);
    }
  } catch {
    // Texture cleanup is best-effort; stale generated keys should not break rendering.
  }
}

function evictRenderTextureCache(): void {
  if (renderTextureCache.size <= ER_SHINY_LAB_RENDER_TEXTURE_CACHE_MAX) {
    return;
  }
  const evictable = [...renderTextureCache.entries()]
    .filter(([, entry]) => entry.refCount <= 0)
    .sort(([, a], [, b]) => a.lastUsed - b.lastUsed);
  for (const [cacheKey, entry] of evictable) {
    if (renderTextureCache.size <= ER_SHINY_LAB_RENDER_TEXTURE_CACHE_MAX) {
      return;
    }
    renderTextureCache.delete(cacheKey);
    renderTextureKeyToCacheKey.delete(entry.textureKey);
    removeTextureNow(entry.textureKey);
  }
}

function releaseGeneratedTexture(key?: string | null): void {
  if (!key) {
    return;
  }
  const cacheKey = renderTextureKeyToCacheKey.get(key);
  if (!cacheKey) {
    removeTextureNow(key);
    return;
  }
  const entry = renderTextureCache.get(cacheKey);
  if (!entry) {
    renderTextureKeyToCacheKey.delete(key);
    removeTextureNow(key);
    return;
  }
  entry.refCount = Math.max(0, entry.refCount - 1);
  entry.lastUsed = ++renderTextureCacheClock;
  evictRenderTextureCache();
}

function spriteSourceRef(key: string, frame?: string | number | null): ErShinyLabSpriteSourceRef {
  return frame == null ? { key } : { key, frame };
}

function frameName(frame?: Phaser.Textures.Frame | null): string | number | null {
  return frame?.name ?? null;
}

function resolveFrame(texture: Phaser.Textures.Texture, frame?: string | number | null): Phaser.Textures.Frame | null {
  const frames = (texture as Phaser.Textures.Texture & { frames?: Record<string, Phaser.Textures.Frame> }).frames ?? {};
  if (frame != null && frame !== "__BASE") {
    const exact = frames[String(frame)];
    if (exact) {
      return exact;
    }
  }
  return (
    (texture.firstFrame && texture.firstFrame !== "__BASE" ? frames[texture.firstFrame] : null)
    ?? Object.entries(frames).find(([name]) => name !== "__BASE")?.[1]
    ?? frames.__BASE
    ?? null
  );
}

function textureSourceImage(texture: Phaser.Textures.Texture): CanvasImageSource | null {
  const tex = texture as Phaser.Textures.Texture & {
    getSourceImage?: () => unknown;
    source?: { image?: CanvasImageSource } | { image?: CanvasImageSource }[];
  };
  const source = tex.source as unknown as { image?: CanvasImageSource } | { image?: CanvasImageSource }[] | undefined;
  const sourceImage = tex.getSourceImage?.() as CanvasImageSource | null | undefined;
  return sourceImage ?? (Array.isArray(source) ? source[0]?.image : source?.image) ?? null;
}

function sourcePixelCacheKey(source: ErShinyLabSpriteSourceRef, frame: Phaser.Textures.Frame): string {
  return [
    source.key,
    frame.name,
    frame.cutX,
    frame.cutY,
    frame.cutWidth,
    frame.cutHeight,
    frame.width,
    frame.height,
    frame.x,
    frame.y,
  ].join("|");
}

function renderTextureCacheKey(
  source: ErShinyLabSpriteSourceRef,
  look: ErShinyLabSpriteFxLook,
  pad: number,
  time: number,
): string {
  const finiteTime = Number.isFinite(time) ? time : 0;
  return `${erShinyLabSpriteFxStateKey(source, look)}|pad=${pad}|t=${finiteTime.toFixed(2)}`;
}

export function readErShinyLabSpriteSourcePixels(
  source: ErShinyLabSpriteSourceRef,
): (ErShinyLabSourcePixels & { frame: Phaser.Textures.Frame }) | null {
  try {
    if (typeof document === "undefined" || !globalScene.textures.exists(source.key)) {
      return null;
    }
    const texture = globalScene.textures.get(source.key);
    const frame = resolveFrame(texture, source.frame);
    const image = textureSourceImage(texture) as (CanvasImageSource & { width?: number; height?: number }) | null;
    if (!frame || !image) {
      return null;
    }
    const cacheKey = sourcePixelCacheKey(source, frame);
    const cached = sourcePixelCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const cutWidth = Math.floor(frame.cutWidth ?? frame.width ?? image.width ?? 0);
    const cutHeight = Math.floor(frame.cutHeight ?? frame.height ?? image.height ?? 0);
    const drawX = Math.floor(frame.x ?? 0);
    const drawY = Math.floor(frame.y ?? 0);
    const width = Math.max(Math.floor(frame.width ?? cutWidth), drawX + cutWidth, cutWidth);
    const height = Math.max(Math.floor(frame.height ?? cutHeight), drawY + cutHeight, cutHeight);
    if (width <= 0 || height <= 0) {
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
    ctx.drawImage(image, frame.cutX ?? 0, frame.cutY ?? 0, cutWidth, cutHeight, drawX, drawY, cutWidth, cutHeight);
    const pixels = { width, height, data: ctx.getImageData(0, 0, width, height).data, frame };
    sourcePixelCache.set(cacheKey, pixels);
    return pixels;
  } catch {
    return null;
  }
}

function textureFromRenderedPixels(
  rendered: ErShinyLabRenderedPixels,
  keyPrefix: string,
  cacheKey?: string,
): string | null {
  try {
    if (typeof document === "undefined") {
      return null;
    }
    const textures = globalScene.textures as Phaser.Textures.TextureManager & {
      addCanvas?: (key: string, canvas: HTMLCanvasElement) => Phaser.Textures.CanvasTexture | null;
    };
    if (!textures.addCanvas) {
      return null;
    }

    if (cacheKey) {
      const cached = renderTextureCache.get(cacheKey);
      if (cached && textures.exists(cached.textureKey)) {
        cached.refCount++;
        cached.lastUsed = ++renderTextureCacheClock;
        return cached.textureKey;
      }
      if (cached) {
        renderTextureCache.delete(cacheKey);
        renderTextureKeyToCacheKey.delete(cached.textureKey);
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = rendered.width;
    canvas.height = rendered.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return null;
    }
    const image = ctx.createImageData(rendered.width, rendered.height);
    image.data.set(rendered.data);
    ctx.putImageData(image, 0, 0);
    const key = nextTextureKey(cacheKey ? "er-shiny-lab-fx-cache" : keyPrefix);
    const texture = textures.addCanvas(key, canvas);
    texture?.refresh();
    if (cacheKey) {
      renderTextureCache.set(cacheKey, { textureKey: key, lastUsed: ++renderTextureCacheClock, refCount: 1 });
      renderTextureKeyToCacheKey.set(key, cacheKey);
      evictRenderTextureCache();
    }
    return key;
  } catch {
    return null;
  }
}

function applyRenderedTextureToSprite(
  sprite: Phaser.GameObjects.Sprite,
  rendered: ErShinyLabRenderedPixels,
  options: RenderedTextureApplyOptions,
): string | null {
  const key = textureFromRenderedPixels(rendered, options.keyPrefix, options.cacheKey);
  if (!key) {
    return null;
  }
  const originX = (rendered.padding + options.sourceOriginX * options.sourceWidth) / rendered.width;
  const originY = (rendered.padding + options.sourceOriginY * options.sourceHeight) / rendered.height;
  sprite.setTexture(key).setOrigin(originX, originY);
  return key;
}

function ownedSets(save: unknown): Record<ErShinyLabCategory, Set<string>> {
  return {
    palette: getErShinyLabOwnedSet(save as never, "palette"),
    surface: getErShinyLabOwnedSet(save as never, "surface"),
    around: getErShinyLabOwnedSet(save as never, "around"),
  };
}

export function getErShinyLabSpriteFxLookForSpecies(speciesId: number, shiny: boolean): ErShinyLabSpriteFxLook | null {
  if (!shiny) {
    return null;
  }
  const save = globalScene.gameData?.getStarterDataEntry(speciesId)?.erShinyLab;
  if (!save) {
    return null;
  }
  const loadout = sanitizeErShinyLabLoadout(decodeErShinyLabLoadout(save.l), ownedSets(save));
  if (!loadout.palette && !loadout.surface && !loadout.around) {
    return null;
  }
  const params = decodeErShinyLabParams(save.q);
  params.nameFx = params.nameFx && isErShinyLabNameFxUnlocked(save);
  return { loadout, params };
}

export function getErShinyLabSpriteFxLookForPokemon(pokemon: {
  species: { speciesId: number };
  shiny: boolean;
  customPokemonData?: { erShinyLab?: ErShinyLabSavedLook | undefined; erShinyLabSuppressLocal?: boolean } | null;
}): ErShinyLabSpriteFxLook | null {
  if (!pokemon.shiny) {
    return null;
  }
  const carriedLook = decodeErShinyLabSavedLook(pokemon.customPokemonData?.erShinyLab);
  if (carriedLook) {
    return carriedLook;
  }
  if (pokemon.customPokemonData?.erShinyLabSuppressLocal) {
    return null;
  }
  return getErShinyLabSpriteFxLookForSpecies(pokemon.species.speciesId, pokemon.shiny);
}

/**
 * The Name FX style for a battle Pokemon: the equipped palette's color (or a named-combo
 * signature) whenever the mon is a shiny that has Name FX unlocked + enabled. NO earned-tier
 * gate - the player explicitly equipped + toggled Name FX, so it must show on the name
 * regardless of the mon's shiny variant (the prior `< 3` gate silently hid it on ordinary
 * shinies - the "Name FX doesn't work" report). Cheap (a lookup), safe per render. Callers
 * apply `.color` to the NAME TEXT only - never a box/panel tint.
 */
export function getErShinyLabNameStyleForPokemon(pokemon: {
  species: { speciesId: number };
  shiny: boolean;
  variant?: number;
  customPokemonData?: {
    erShinyLab?: ErShinyLabSavedLook | undefined;
    erShinyLabSuppressLocal?: boolean;
    erBlackShiny?: boolean | undefined;
  } | null;
}): ErShinyLabNameStyle | null {
  const look = getErShinyLabSpriteFxLookForPokemon(pokemon);
  if (!look?.params.nameFx) {
    return null;
  }
  return getErShinyLabNameStyle(look.loadout);
}

/**
 * The Name FX style for a species + its shiny view state (Starter Select). Shows whenever the
 * shiny form has Name FX unlocked + enabled (the unlock is already required for `nameFx` to be
 * true here, via getErShinyLabSpriteFxLookForSpecies). No earned-tier gate. null otherwise.
 */
export function getErShinyLabNameStyleForSpecies(speciesId: number, shiny: boolean): ErShinyLabNameStyle | null {
  const look = getErShinyLabSpriteFxLookForSpecies(speciesId, shiny);
  if (!look?.params.nameFx) {
    return null;
  }
  return getErShinyLabNameStyle(look.loadout);
}

export function hasErShinyLabAnySpriteFx(
  look: ErShinyLabSpriteFxLook | null | undefined,
): look is ErShinyLabSpriteFxLook {
  return !!(look?.loadout.palette || look?.loadout.surface || look?.loadout.around);
}

export function hasErShinyLabExactSpriteFx(
  look: ErShinyLabSpriteFxLook | null | undefined,
): look is ErShinyLabSpriteFxLook {
  return !!(look?.loadout.surface || look?.loadout.around);
}

export function erShinyLabSpriteFxStateKey(
  source: ErShinyLabSpriteSourceRef,
  look: ErShinyLabSpriteFxLook | null | undefined,
): string {
  if (!look) {
    return `${source.key}|${source.frame ?? ""}`;
  }
  const { loadout, params } = look;
  return [
    source.key,
    source.frame ?? "",
    loadout.palette ?? "",
    loadout.surface ?? "",
    loadout.around ?? "",
    params.palAmt,
    params.surfAmt,
    params.aroAmt,
    params.scale,
    params.seed,
    params.tintMode,
    params.protectBlack ? 1 : 0,
    params.protectWhite ? 1 : 0,
  ].join("|");
}

export function getErShinyLabSpriteFxTime(): number {
  const now =
    globalScene.time?.now
    ?? (typeof performance !== "undefined" && Number.isFinite(performance.now()) ? performance.now() : Date.now());
  return Math.floor(now / 100) / 10;
}

function baseVariantForPalette(look: ErShinyLabSpriteFxLook | null | undefined, variant: Variant): Variant {
  return look?.loadout.palette ? 0 : variant;
}

function baseShinyForPalette(look: ErShinyLabSpriteFxLook | null | undefined, shiny: boolean): boolean {
  return look?.loadout.palette ? false : shiny;
}

export function getErShinyLabPokemonBattleSource(
  pokemon: PokemonLike,
  back?: boolean,
  ignoreOverride?: boolean,
  look = getErShinyLabSpriteFxLookForPokemon(pokemon),
): ErShinyLabSpriteSourceRef {
  const useBaseSource = !!look?.loadout.palette;
  if (!useBaseSource) {
    return {
      key: pokemon.getBattleSpriteKey(back, ignoreOverride),
      atlasPath: pokemon.getBattleSpriteAtlasPath(back, ignoreOverride),
    };
  }
  const isBack = back ?? false;
  const illusion = pokemon.summonData?.illusion;
  const formIndex = illusion?.formIndex ?? pokemon.formIndex;
  const form = pokemon.getSpeciesForm(ignoreOverride, true);
  const female = pokemon.getGender(ignoreOverride, true) === Gender.FEMALE;
  return {
    key: `pkmn__${form.getSpriteId(female, formIndex, false, 0, isBack)}`,
    atlasPath: form.getSpriteAtlasPath(female, formIndex, false, 0, isBack),
  };
}

export function getErShinyLabPokemonSpriteSource(
  pokemon: PokemonLike,
  ignoreOverride?: boolean,
  look = getErShinyLabSpriteFxLookForPokemon(pokemon),
): ErShinyLabSpriteSourceRef {
  if (!look?.loadout.palette) {
    return {
      key: pokemon.getSpriteKey(ignoreOverride),
      atlasPath: pokemon.getSpriteAtlasPath(ignoreOverride),
    };
  }
  const form = pokemon.getSpeciesForm(ignoreOverride, false);
  const female = pokemon.getGender(ignoreOverride) === Gender.FEMALE;
  return {
    key: form.getSpriteKey(female, pokemon.formIndex, false, 0),
    atlasPath: form.getSpriteAtlasPath(female, pokemon.formIndex, false, 0),
  };
}

export function getErShinyLabPokemonIconSource(
  pokemon: PokemonLike,
  ignoreOverride = true,
  useIllusion = false,
  look = getErShinyLabSpriteFxLookForPokemon(pokemon),
): ErShinyLabSpriteSourceRef {
  if (!look?.loadout.palette) {
    return {
      key: pokemon.getIconAtlasKey(ignoreOverride, useIllusion),
      frame: pokemon.getIconId(ignoreOverride, useIllusion),
    };
  }
  const illusion = useIllusion ? pokemon.summonData?.illusion : null;
  const formIndex = illusion?.formIndex ?? pokemon.formIndex;
  const form = pokemon.getSpeciesForm(ignoreOverride, useIllusion);
  const female = pokemon.getGender(ignoreOverride, useIllusion) === Gender.FEMALE;
  return {
    key: form.getIconAtlasKey(formIndex, false, 0),
    frame: form.getIconId(female, formIndex, false, 0),
  };
}

export function getErShinyLabSpeciesIconSource(
  species: PokemonSpecies,
  female: boolean,
  formIndex: number,
  shiny: boolean,
  variant: Variant,
  look = getErShinyLabSpriteFxLookForSpecies(species.speciesId, shiny),
): ErShinyLabSpriteSourceRef {
  const textureShiny = baseShinyForPalette(look, shiny);
  const textureVariant = baseVariantForPalette(look, variant);
  return {
    key: species.getIconAtlasKey(formIndex, textureShiny, textureVariant),
    frame: species.getIconId(female, formIndex, textureShiny, textureVariant),
  };
}

export function clearErShinyLabSpriteFxTexture(sprite: Phaser.GameObjects.Sprite, restoreSource = true): void {
  const data = spriteFxData(sprite);
  const oldKey = data.key;
  if (restoreSource && data.sourceKey && globalScene.textures.exists(data.sourceKey)) {
    sprite.setTexture(data.sourceKey, data.sourceFrame ?? undefined);
    if (data.sourceOriginX != null && data.sourceOriginY != null) {
      sprite.setOrigin(data.sourceOriginX, data.sourceOriginY);
    }
  }
  data.key = null;
  data.state = undefined;
  releaseGeneratedTexture(oldKey);
}

export function applyErShinyLabSpriteFxTexture(
  sprite: Phaser.GameObjects.Sprite,
  look: ErShinyLabSpriteFxLook,
  options: ApplySpriteFxOptions,
): boolean {
  const data = spriteFxData(sprite);
  const source =
    options.source
    ?? (data.sourceKey
      ? spriteSourceRef(data.sourceKey, data.sourceFrame)
      : spriteSourceRef(sprite.texture.key, frameName(sprite.frame)));
  const state = options.state ?? erShinyLabSpriteFxStateKey(source, look);
  if (data.state === state && data.key && globalScene.textures.exists(data.key)) {
    return true;
  }

  const sourcePixels = readErShinyLabSpriteSourcePixels(source);
  if (!sourcePixels) {
    clearErShinyLabSpriteFxTexture(sprite, true);
    return false;
  }
  const rendered = renderErShinyLabLook(
    sourcePixels,
    look.loadout,
    look.params,
    options.time ?? 0,
    options.renderPad == null ? undefined : { pad: options.renderPad },
  );
  if (!rendered) {
    clearErShinyLabSpriteFxTexture(sprite, true);
    return false;
  }

  const oldKey = data.key;
  const renderPad = options.renderPad ?? ER_SHINY_LAB_RENDER_PAD;
  const sourceOriginX = data.sourceOriginX ?? sprite.originX;
  const sourceOriginY = data.sourceOriginY ?? sprite.originY;
  const key = applyRenderedTextureToSprite(sprite, rendered, {
    keyPrefix: options.keyPrefix,
    sourceWidth: sourcePixels.width,
    sourceHeight: sourcePixels.height,
    sourceOriginX,
    sourceOriginY,
    cacheKey: renderTextureCacheKey(source, look, renderPad, options.time ?? 0),
  });
  if (!key) {
    clearErShinyLabSpriteFxTexture(sprite, true);
    return false;
  }
  data.key = key;
  data.sourceKey = source.key;
  data.sourceFrame = source.frame ?? frameName(sourcePixels.frame);
  data.sourceOriginX = sourceOriginX;
  data.sourceOriginY = sourceOriginY;
  data.state = state;
  if (oldKey === key) {
    releaseGeneratedTexture(key);
  } else {
    releaseGeneratedTexture(oldKey);
  }
  return true;
}

export class ErShinyLabSpriteFxOverlay {
  private readonly sprite: Phaser.GameObjects.Sprite;
  private readonly baseSprite: Phaser.GameObjects.Sprite;
  private readonly keyPrefix: string;
  private key: string | null = null;
  private state: string | null = null;

  constructor(baseSprite: Phaser.GameObjects.Sprite, keyPrefix: string) {
    this.baseSprite = baseSprite;
    this.keyPrefix = keyPrefix;
    this.sprite = globalScene.add.sprite(baseSprite.x, baseSprite.y, "unknown").setVisible(false);
  }

  getSprite(): Phaser.GameObjects.Sprite {
    return this.sprite;
  }

  isVisible(): boolean {
    return this.sprite.visible && !!this.key;
  }

  copyTextureTo(target: Phaser.GameObjects.Sprite | null | undefined): boolean {
    if (!target || !this.key || !globalScene.textures.exists(this.key)) {
      return false;
    }
    target.setTexture(this.key).setOrigin(this.sprite.originX, this.sprite.originY);
    return true;
  }

  private syncFromBase(): void {
    this.sprite
      .setPosition(this.baseSprite.x, this.baseSprite.y)
      .setScale(this.baseSprite.scaleX || 1, this.baseSprite.scaleY || this.baseSprite.scaleX || 1)
      .setAlpha(this.baseSprite.alpha)
      .setFlip(this.baseSprite.flipX, this.baseSprite.flipY)
      .setVisible(true);
  }

  refresh(look: ErShinyLabSpriteFxLook, source: ErShinyLabSpriteSourceRef, time = 0): boolean {
    const state = renderTextureCacheKey(source, look, ER_SHINY_LAB_RENDER_PAD, time);
    if (this.state === state && this.key && globalScene.textures.exists(this.key)) {
      this.syncFromBase();
      return true;
    }

    const sourcePixels = readErShinyLabSpriteSourcePixels(source);
    if (!sourcePixels) {
      this.hide();
      return false;
    }
    const rendered = renderErShinyLabLook(sourcePixels, look.loadout, look.params, time);
    if (!rendered) {
      this.hide();
      return false;
    }
    const oldKey = this.key;
    const key = applyRenderedTextureToSprite(this.sprite, rendered, {
      keyPrefix: this.keyPrefix,
      sourceWidth: sourcePixels.width,
      sourceHeight: sourcePixels.height,
      sourceOriginX: this.baseSprite.originX,
      sourceOriginY: this.baseSprite.originY,
      cacheKey: state,
    });
    if (!key) {
      this.hide();
      return false;
    }
    this.key = key;
    this.state = state;
    this.syncFromBase();
    if (oldKey === key) {
      releaseGeneratedTexture(key);
    } else {
      releaseGeneratedTexture(oldKey);
    }
    return true;
  }

  hide(showBase = true): void {
    this.sprite.setVisible(false);
    releaseGeneratedTexture(this.key);
    this.key = null;
    this.state = null;
    if (showBase) {
      this.baseSprite.setVisible(true);
    }
  }

  destroy(): void {
    this.hide(false);
    this.sprite.destroy();
  }
}
