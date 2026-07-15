// =============================================================================
// Elite Redux — Phase B Task B1b: register ER-custom species in `allSpecies`.
//
// Reads `er-species.ts` and, for every entry whose pokerogue id resolves to
// ≥ VANILLA_ID_CUTOFF (the ER-custom range — see `er-id-map.ts`), constructs
// a fresh `PokemonSpecies` instance and pushes it onto `allSpecies`.
//
// Vanilla species (id < VANILLA_ID_CUTOFF) are handled by B1a's
// `initEliteReduxSpecies()` and skipped here.
//
// Localization note: pokerogue's `PokemonSpecies.localize()` uses
// `SpeciesId[this.speciesId]` to look up the i18n key, but ER-custom ids
// are not in the `SpeciesId` enum. We override `localize()` in a thin
// subclass to take the draft name verbatim — Phase C will wire proper
// localization keys.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { starterColors } from "#app/global-vars/starter-colors";
import { allSpecies } from "#data/data-lists";
import { dexAbilityId } from "#data/elite-redux/er-ability-position-map";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import type { ErSpeciesDraft } from "#data/elite-redux/er-species";
import { ER_SPECIES } from "#data/elite-redux/er-species";
import { ER_SPRITE_MANIFEST } from "#data/elite-redux/er-sprite-manifest";
import { GrowthRate } from "#data/exp";
import { PokemonSpecies } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import { PokemonType } from "#enums/pokemon-type";
import type { Variant } from "#sprites/variant";
import { getPokemonSpecies } from "#utils/pokemon-utils";

/** Lookup: ER species id → kebab-case sprite slug ("phantowl", "abyssand"...). */
const ER_SPRITE_BY_SPECIES_ID = new Map<number, string>(ER_SPRITE_MANIFEST.map(e => [e.speciesId, e.slug]));

/**
 * Numeric cutoff for "vanilla pokerogue" species ids. ER-custom species are
 * assigned fresh ids ≥ 10000 by the id-map builder (see `er-id-map.ts`).
 * Mirrors B1a's constant — kept here as a local literal so the two files
 * don't import from one another.
 */
const VANILLA_ID_CUTOFF = 10000;

/** Aggregated result of a single `initEliteReduxCustomSpecies()` run. */
export interface InitEliteReduxCustomSpeciesResult {
  /** Number of ER-custom species newly constructed and pushed onto allSpecies. */
  customsAdded: number;
  /** Number of ER-custom species skipped because an entry already existed (idempotent re-run). */
  customsAlreadyPresent: number;
  /**
   * Number of degenerate placeholder entries skipped — ER ships a few orphan
   * "stub" species in its dump (all-zero base stats, no abilities/innates,
   * zero catchRate/baseExp). They are not real Pokémon and must NOT be
   * registered (they'd surface as junk obtainables, e.g. "Infernape Redux B").
   */
  skippedDegenerate: number;
  /** Non-fatal issues — e.g. constructor failures with a usable error message. */
  errors: string[];
}

/**
 * A degenerate placeholder entry from the ER dump: every base stat is 0 AND no
 * ability or innate slot is filled. These are orphan stubs (e.g. the abilities-
 * less "Infernape Redux B"), not playable species — registering them surfaces a
 * junk obtainable in the pokédex / starter grid / egg pool. `SPECIES_NONE`
 * (er id -1) is already filtered earlier by the id-map gate; this catches the
 * remaining in-range stubs. Legitimate ER customs (including real `_REDUX_B`
 * branch forms like Flygon/Mawile Redux B) ship real stats and abilities, so
 * they are unaffected.
 */
function isDegenerateDraft(draft: ErSpeciesDraft): boolean {
  const stats = draft.baseStats;
  const allStatsZero = Array.isArray(stats) && stats.length === 6 && stats.every(v => v === 0);
  if (!allStatsZero) {
    return false;
  }
  const noAbilities = (draft.abilities ?? []).every(a => a === 0);
  const noInnates = (draft.innates ?? []).every(a => a === 0);
  return noAbilities && noInnates;
}

/**
 * Per-species ER sprite-slug corrections. A handful of upstream ER sprite
 * directories ship the WRONG art (mislabeled / corrupt source frames), so the
 * manifest-derived slug points at art for a different creature. Each entry maps
 * the broken species const → a slug whose `elite-redux/<slug>/` directory holds
 * the correct, complete sprite set (front/back/icon + all shiny tiers).
 *
 * (Currently empty.) NOTE on Infernape Redux: its BASE sprite is missing from the
 * asset set. `infernape_redux/` and `infernape_redux_b/` both hold an unrelated
 * yellow winged bird (misfiled), and the blue bard in `infernape_redux_mega/` is
 * the MEGA form's art — not the base. There is no correct base sprite to point at
 * yet, so no override is applied (base falls back to its own `infernape_redux`
 * slug). Add an override here once the real base art is sourced.
 */
const ER_SPRITE_SLUG_OVERRIDES: Readonly<Record<string, string>> = {};

/**
 * Map ER's numeric type id (decoded by `ER_TYPE_NAMES` in `er-move-tables.ts`)
 * to pokerogue's `PokemonType` enum. Returns `null` for the ER sentinels
 * "Mystery" (18) and "None" (19) — `PokemonSpecies` accepts a nullable type2
 * for mono-typed mons.
 */
function mapType(erTypeId: number | null): PokemonType | null {
  if (erTypeId === null) {
    return null;
  }
  switch (erTypeId) {
    case 0:
      return PokemonType.NORMAL;
    case 1:
      return PokemonType.FIGHTING;
    case 2:
      return PokemonType.FIRE;
    case 3:
      return PokemonType.ICE;
    case 4:
      return PokemonType.ELECTRIC;
    case 5:
      return PokemonType.BUG;
    case 6:
      return PokemonType.FLYING;
    case 7:
      return PokemonType.STEEL;
    case 8:
      return PokemonType.GRASS;
    case 9:
      return PokemonType.GROUND;
    case 10:
      return PokemonType.POISON;
    case 11:
      return PokemonType.DARK;
    case 12:
      return PokemonType.WATER;
    case 13:
      return PokemonType.PSYCHIC;
    case 14:
      return PokemonType.ROCK;
    case 15:
      return PokemonType.DRAGON;
    case 16:
      return PokemonType.GHOST;
    case 17:
      return PokemonType.FAIRY;
    case 20:
      return PokemonType.STELLAR;
    // 18 Mystery, 19 None → treat as untyped (null)
    default:
      return null;
  }
}

/**
 * Resolve an ER ability id (0-N or 0 = "----" sentinel) to a pokerogue
 * `AbilityId`. Same shape as B1a's `mapAbilityId` — kept local to avoid a
 * cross-file import.
 */
function mapAbilityId(erAbilityId: number): AbilityId {
  if (erAbilityId === 0) {
    return AbilityId.NONE;
  }
  // er-species refs are array POSITIONS; ER_ID_MAP is keyed by the dex id-FIELD.
  // Translate before lookup (identity for all but 81 abilities). See
  // er-ability-position-map (same fix as init-elite-redux-species.mapAbilityId).
  const mapped = ER_ID_MAP.abilities[dexAbilityId(erAbilityId)];
  if (mapped === undefined) {
    return AbilityId.NONE;
  }
  return mapped as AbilityId;
}

/**
 * Map ER's `growthRate` index (0-5, see PokeEmerald `gGrowthRates`) to
 * pokerogue's `GrowthRate` enum. ER ships `0` in the v2.65 dump for every
 * species (the engine resolves growth elsewhere), so this is mostly a
 * defensive mapping — anything out of range falls back to MEDIUM_FAST.
 *
 * Gen3 mapping per upstream `gGrowthRates`:
 *  0 = Medium Fast, 1 = Erratic, 2 = Fluctuating, 3 = Medium Slow,
 *  4 = Fast, 5 = Slow
 */
function mapGrowthRate(erGrowthRate: number): GrowthRate {
  switch (erGrowthRate) {
    case 1:
      return GrowthRate.ERRATIC;
    case 2:
      return GrowthRate.FLUCTUATING;
    case 3:
      return GrowthRate.MEDIUM_SLOW;
    case 4:
      return GrowthRate.FAST;
    case 5:
      return GrowthRate.SLOW;
    default:
      return GrowthRate.MEDIUM_FAST;
  }
}

/**
 * Map ER's `genderRatio` (gen3-style 0-255 ratio, with 255 = genderless)
 * to pokerogue's `malePercent: number | null`. The v2.65 dump ships
 * placeholder values (e.g. Bulbasaur = 12700) for many species, so we
 * clamp out-of-range values to the safe 50/50 default. Real-data alignment
 * is Phase C work.
 */
function mapGenderRatio(erGender: number): number | null {
  if (erGender === 255) {
    return null;
  }
  if (erGender < 0 || erGender > 254) {
    // Out-of-range placeholder — default to 50% male.
    return 50;
  }
  // gen3 convention: gender value is the chance of being FEMALE in 256ths.
  // malePercent = 100 * (1 - gender/256).
  return Math.round((1 - erGender / 256) * 100);
}

/**
 * Thin `PokemonSpecies` subclass for ER-custom species. Overrides
 * `localize()` to take the draft's display name verbatim — the vanilla
 * implementation looks up `SpeciesId[this.speciesId]` which is `undefined`
 * for ids ≥ VANILLA_ID_CUTOFF.
 *
 * The display name is stored on the prototype (via the constructor) before
 * the base-class `localize()` call clobbers it; we restore it afterwards.
 */
class ErCustomSpecies extends PokemonSpecies {
  /** Fallback display name from the ER draft (set pre-construction). */
  private static readonly _draftNames = new Map<number, string>();
  /** Pokerogue speciesId → ER sprite slug (e.g. 10000 → "phantowl"). */
  private static readonly _spriteSlugs = new Map<number, string>();
  /**
   * Pokerogue speciesId → explicit cry-audio key. Used by hand-authored newcomer
   * species that ship their OWN cry asset (e.g. Tentalect). When absent,
   * `getCryKey` falls back to the crash-safe `cry/<id>` scheme below.
   */
  private static readonly _cryKeys = new Map<number, string>();
  /**
   * Pokerogue speciesId → explicit cry-audio FILE path (relative to the asset
   * root, e.g. `audio/cry/tentalect.wav`). When present, {@linkcode loadAssets}
   * queues the cry load from this exact path under the {@linkcode getCryKey} key —
   * the file base and/or extension can differ from the key (the published Tentalect
   * cry is `tentalect.wav`, keyed `cry/er_tentalect`, and .wav is not the default
   * `.m4a` the base loader assumes). Without this the ER-custom sprite-only load
   * path never queues any cry, so the mon is silent.
   */
  private static readonly _cryUrls = new Map<number, string>();
  /**
   * Pokerogue speciesId → a VANILLA base speciesId whose sprites/icon this custom
   * species ALIASES (reuses verbatim) instead of the `elite-redux/{slug}/…` scheme.
   * Used by the partner eeveelutions (transform-target species that render as their
   * base eeveelution — no bespoke art). When set, the sprite/icon/loadAssets
   * overrides delegate to the base species. Mutually exclusive with a sprite slug.
   */
  private static readonly _spriteAliases = new Map<number, number>();

  /**
   * Override of the base `localize()`. Looks up the draft name installed
   * by `registerDraftName()` before the constructor ran; falls back to
   * `Unknown` if absent.
   */
  override localize(): void {
    this.name = ErCustomSpecies._draftNames.get(this.speciesId) ?? "Unknown";
    this.category = "??? Pokémon";
  }

  /** Stash the draft name keyed by pokerogue species id before construction. */
  static registerDraftName(id: number, name: string): void {
    ErCustomSpecies._draftNames.set(id, name);
  }

  /** Register the ER sprite slug for a pokerogue species id. */
  static registerSpriteSlug(id: number, slug: string): void {
    ErCustomSpecies._spriteSlugs.set(id, slug);
  }

  /** Register an explicit cry-audio key for a pokerogue species id. */
  static registerCryKey(id: number, cryKey: string): void {
    ErCustomSpecies._cryKeys.set(id, cryKey);
  }

  /** Register the explicit cry-audio FILE path for a pokerogue species id. */
  static registerCryFile(id: number, cryFile: string): void {
    ErCustomSpecies._cryUrls.set(id, cryFile);
  }

  /** Registered cry-audio file path for a pokerogue species id, or undefined. */
  static getCryFile(id: number): string | undefined {
    return ErCustomSpecies._cryUrls.get(id);
  }

  /** Alias a custom species' sprites/icon to a VANILLA base species (no bespoke art). */
  static registerSpriteAlias(id: number, baseSpeciesId: number): void {
    ErCustomSpecies._spriteAliases.set(id, baseSpeciesId);
  }

  /** ER sprite slug for a pokerogue species id, or undefined if not an ER custom. */
  static getSpriteSlug(id: number): string | undefined {
    return ErCustomSpecies._spriteSlugs.get(id);
  }

  /**
   * Override the sprite atlas path so ER-custom species load from
   * `elite-redux/{slug}/{front,back,shiny,...}` instead of the vanilla
   * `images/pokemon/{id}` path (which has no asset on disk for id >= 10000).
   */
  override getSpriteAtlasPath(
    _female: boolean,
    _formIndex?: number,
    shiny?: boolean,
    variant?: number,
    back?: boolean,
  ): string {
    const alias = ErCustomSpecies._spriteAliases.get(this.speciesId);
    if (alias !== undefined) {
      return getPokemonSpecies(alias).getSpriteAtlasPath(_female, 0, shiny, variant, back);
    }
    const slug = ErCustomSpecies._spriteSlugs.get(this.speciesId);
    if (!slug) {
      // Fall through to vanilla path (will 404 — log once)
      return super.getSpriteAtlasPath(_female, _formIndex, shiny, variant, back);
    }
    // ER sprite directory layout (all relative to public root, hence the
    // leading `pokemon/elite-redux/{slug}/`):
    //   front.png  back.png  icon.png
    //   shiny.png  shiny-back.png         (tier 1)
    //   shiny-2.png  shiny-back-2.png     (tier 2 — variant === 1)
    //   shiny-3.png  shiny-back-3.png     (tier 3 — variant === 2)
    let filename: string;
    if (shiny) {
      const tier = variant ?? 0;
      const suffix = tier === 0 ? "" : `-${tier + 1}`;
      filename = back ? `shiny-back${suffix}` : `shiny${suffix}`;
    } else {
      filename = back ? "back" : "front";
    }
    return `elite-redux/${slug}/${filename}`;
  }

  /**
   * Override sprite ID/key to match the path scheme. Returns the slug-based
   * key so atlas-cache lookups (e.g. animation creation) use the same key
   * regardless of whether the sprite is being loaded or displayed.
   */
  override getSpriteId(
    _female: boolean,
    _formIndex?: number,
    shiny?: boolean,
    variant?: number,
    back?: boolean,
  ): string {
    const alias = ErCustomSpecies._spriteAliases.get(this.speciesId);
    if (alias !== undefined) {
      return getPokemonSpecies(alias).getSpriteId(_female, 0, shiny, variant ?? 0, back);
    }
    const slug = ErCustomSpecies._spriteSlugs.get(this.speciesId);
    if (!slug) {
      return super.getSpriteId(_female, _formIndex, shiny, variant ?? 0, back);
    }
    const suffix = shiny ? (variant ? `_shiny${variant + 1}` : "_shiny") : "";
    const backPrefix = back ? "back__" : "";
    return `${backPrefix}er__${slug}${suffix}`;
  }

  /**
   * Icons for ER-custom species live at `elite-redux/{slug}/icon.png`.
   * Use a per-slug atlas key so each one is loaded lazily by
   * `loadPokemonAtlas` rather than expecting the bundled `pokemon_icons_N`
   * sheet (which has no frames for id >= 10000).
   */
  override getIconAtlasKey(_formIndex?: number, _shiny?: boolean, _variant?: number): string {
    const alias = ErCustomSpecies._spriteAliases.get(this.speciesId);
    if (alias !== undefined) {
      return getPokemonSpecies(alias).getIconAtlasKey(0, _shiny, _variant);
    }
    const slug = ErCustomSpecies._spriteSlugs.get(this.speciesId);
    if (!slug) {
      return super.getIconAtlasKey(_formIndex, _shiny, _variant);
    }
    return `er_icon__${slug}`;
  }

  /**
   * Frame ID inside the per-slug icon atlas. Our generated atlas JSON has
   * a single frame "0001.png" — return that string.
   */
  override getIconId(female: boolean, formIndex?: number, shiny?: boolean, variant?: number): string {
    const alias = ErCustomSpecies._spriteAliases.get(this.speciesId);
    if (alias !== undefined) {
      return getPokemonSpecies(alias).getIconId(female, 0, shiny, variant);
    }
    const slug = ErCustomSpecies._spriteSlugs.get(this.speciesId);
    if (!slug) {
      return super.getIconId(female, formIndex, shiny, variant);
    }
    return "0001.png";
  }

  /**
   * Override base `getCryKey` so it doesn't crash on ER-custom species ids.
   *
   * The base implementation does `speciesId %= 2000` (meant for vanilla form ids
   * in the 2000–2999 range) and then `getPokemonSpecies(speciesId).forms` — for
   * an ER custom (id >= 10000) the modulo lands on an id that isn't a real
   * species, so `getPokemonSpecies(...)` is `undefined` and `.forms` throws
   * "Cannot read properties of undefined (reading 'forms')". That fired from
   * `cry()` on enemy entry and **froze the battle** (repro: Phantowl, #260).
   *
   * ER customs have no cry audio anyway (see {@linkcode loadAssets}), and
   * {@linkcode BattleScene.playSound} tolerates a missing key (warns + returns
   * null), so returning a well-formed key for our own id makes the cry simply
   * silent instead of crashing.
   */
  override getCryKey(_formIndex?: number): string {
    return ErCustomSpecies._cryKeys.get(this.speciesId) ?? `cry/${this.speciesId}`;
  }

  /**
   * Override base `getExpandedSpeciesName` so it doesn't crash on ER-custom
   * species ids (which aren't in the SpeciesId enum). The base looks up
   * `SpeciesId[this.speciesId].split("_")` — which is undefined for IDs
   * >= 10000 and throws "Cannot read properties of undefined (reading 'split')".
   */
  override getExpandedSpeciesName(): string {
    return this.name;
  }

  /**
   * Extend `loadAssets` to also preload the per-slug icon atlas alongside
   * the main sprite. The base `PokemonSpecies.loadAssets` (patched in R58
   * to use per-file events instead of the global COMPLETE event) handles
   * the actual sprite-load race correctly.
   */
  override async loadAssets(
    female = false,
    formIndex?: number,
    shiny = false,
    variant?: Variant,
    startLoad = false,
    back = false,
    // Accepted for signature parity with the base; ER customs always run
    // sprite-only regardless (see below), so the caller's value is irrelevant.
    _spriteOnly = false,
  ): Promise<void> {
    const alias = ErCustomSpecies._spriteAliases.get(this.speciesId);
    if (alias !== undefined) {
      // Render EXACTLY as the base eeveelution: delegate to its vanilla loadAssets
      // (real sprite atlas + shiny variant colours + bundled icon), NOT the slug scheme.
      return getPokemonSpecies(alias).loadAssets(female, 0, shiny, variant, startLoad, back, _spriteOnly);
    }
    const slug = ErCustomSpecies._spriteSlugs.get(this.speciesId);
    if (slug) {
      // Preload the icon atlas (key matches getIconAtlasKey output).
      const iconKey = `er_icon__${slug}`;
      if (!globalScene.textures.exists(iconKey)) {
        globalScene.loadPokemonAtlas(iconKey, `elite-redux/${slug}/icon`);
      }
    }
    // A hand-authored newcomer species may ship its OWN cry asset (Tentalect's
    // `audio/cry/tentalect.wav`). The base sprite-only path below deliberately
    // skips ALL cry loading (ER dump customs have none), so queue it here from the
    // registered file path under the getCryKey key. The file base/extension can
    // differ from the key, so we can't reuse the base `audio/<key>.m4a` scheme.
    // No-op for every custom without a registered cry file.
    const cryFile = ErCustomSpecies._cryUrls.get(this.speciesId);
    if (cryFile) {
      const cryKey = this.getCryKey(formIndex);
      if (!globalScene.cache.audio.exists(cryKey)) {
        globalScene.load.audio(cryKey, cryFile);
      }
    }
    // ER-custom species have NO cry audio and aren't in the vanilla `variantData`
    // colour-swap registry, so we ALWAYS load sprite-only (force `spriteOnly`):
    //  - queuing the nonexistent `audio/<key>.m4a` cry 404s AND burns shared-loader
    //    slots, starving real sprite atlases behind dozens of failed cry fetches —
    //    the root of "Missing animation / substitute shown" and inconsistent shiny
    //    sprites during rapid starter/pokédex/egg cycling (it also hurt vanilla
    //    species sharing the loader);
    //  - `loadVariantColors` is a no-op for ER customs anyway (no variantData entry).
    // The shiny variant sprite atlas (shiny/shiny-2/shiny-3) still loads — it's not
    // gated by spriteOnly — so ER custom shiny tiers render correctly.
    return super.loadAssets(female, formIndex, shiny, variant, startLoad, back, true);
  }
}

/**
 * The ER sprite slug for a pokerogue species id (e.g. 10065 → "wispywaspy"), or
 * undefined if the id is not an ER-custom species. Used by the form-sprite
 * redirect when injecting alternate forms onto ER-custom base species — the
 * injected `PokemonForm` objects don't inherit ErCustomSpecies' slug-based
 * sprite/icon overrides, so they must be redirected explicitly.
 */
export function getErSpriteSlug(speciesId: number): string | undefined {
  return ErCustomSpecies.getSpriteSlug(speciesId);
}

/**
 * The explicit cry-audio FILE path registered for an ER-custom species id (e.g.
 * `audio/cry/tentalect.wav`), or undefined when the species has no bespoke cry.
 * Used by the newcomer-species cry-wiring test to assert the published path is wired.
 */
export function getErCryFile(speciesId: number): string | undefined {
  return ErCustomSpecies.getCryFile(speciesId);
}

/** A fully-resolved editor-created mon (see init-elite-redux-custom-mons.ts). */
export interface ErEditorMonSpec {
  speciesId: number;
  name: string;
  /**
   * er-assets sprite directory slug (images/pokemon/elite-redux/<slug>/). Optional
   * when {@linkcode spriteAlias} is set (the sprite/icon then reuses a vanilla base).
   */
  slug?: string;
  /**
   * Alias this species' sprites/icon to a VANILLA base speciesId (reuse its art
   * verbatim) instead of `elite-redux/<slug>/…`. Mutually exclusive with `slug`.
   * Used by the partner eeveelutions (transform targets that render as their base).
   */
  spriteAlias?: number;
  type1: PokemonType;
  type2: PokemonType | null;
  baseStats: readonly [number, number, number, number, number, number];
  abilities: readonly [number, number, number];
  innates: readonly [number, number, number];
  catchRate: number;
  /** N-type static model: types 3..N (beyond type1/type2). Optional. */
  extraTypes?: readonly PokemonType[] | undefined;
  /** Explicit cry-audio key hook (hand-authored newcomer species with own cry). */
  cryKey?: string | undefined;
  /**
   * Explicit cry-audio FILE path (e.g. `audio/cry/tentalect.wav`). Loaded under
   * the {@linkcode cryKey} key by `loadAssets`. Required for the cry to actually
   * sound: the base ER-custom load path is sprite-only and queues no cry.
   */
  cryFile?: string | undefined;
}

/**
 * Register an EDITOR-CREATED custom mon (er-custom-mons.json) as a live
 * species, reusing the exact ErCustomSpecies plumbing the ER dump customs get
 * (slug-based sprites/icons, sprite-only asset loading, crash-safe cry/name).
 * Returns false when the id is already registered (idempotent re-init).
 */
export function registerErEditorMon(spec: ErEditorMonSpec): boolean {
  if (allSpecies.some(s => s.speciesId === spec.speciesId)) {
    return false;
  }
  ErCustomSpecies.registerDraftName(spec.speciesId, spec.name);
  const baseTotal = spec.baseStats.reduce((sum, n) => sum + n, 0);
  const species = new ErCustomSpecies(
    spec.speciesId,
    9,
    false,
    false,
    false,
    "??? Pokémon",
    spec.type1,
    spec.type2,
    1.0,
    30.0,
    spec.abilities[0],
    spec.abilities[1],
    spec.abilities[2],
    baseTotal,
    spec.baseStats[0],
    spec.baseStats[1],
    spec.baseStats[2],
    spec.baseStats[3],
    spec.baseStats[4],
    spec.baseStats[5],
    spec.catchRate,
    50,
    100,
    GrowthRate.MEDIUM_FAST,
    50,
    false,
    false,
  );
  species.setPassives([spec.innates[0], spec.innates[1], spec.innates[2]]);
  if (spec.extraTypes && spec.extraTypes.length > 0) {
    species.setExtraTypes(spec.extraTypes);
  }
  if (spec.cryKey) {
    ErCustomSpecies.registerCryKey(spec.speciesId, spec.cryKey);
  }
  if (spec.cryFile) {
    ErCustomSpecies.registerCryFile(spec.speciesId, spec.cryFile);
  }
  // Sprite source: a vanilla base alias (partner eeveelutions) OR the ER slug art.
  if (spec.spriteAlias !== undefined) {
    ErCustomSpecies.registerSpriteAlias(spec.speciesId, spec.spriteAlias);
  } else if (spec.slug) {
    ErCustomSpecies.registerSpriteSlug(spec.speciesId, spec.slug);
  }
  if (!starterColors[spec.speciesId]) {
    // Aliased species inherit the base's starter colours (its candy/egg palette);
    // slug species have no vanilla palette, so default to white as before.
    const base = spec.spriteAlias === undefined ? undefined : starterColors[spec.spriteAlias];
    starterColors[spec.speciesId] = base ?? ["ffffff", "ffffff"];
  }
  (allSpecies as PokemonSpecies[]).push(species);
  return true;
}

/**
 * Construct `PokemonSpecies` instances for the ER-custom species and push
 * them onto `allSpecies`. Idempotent: a re-run skips species that are
 * already present (by `speciesId` match).
 *
 * Order constraint: must run AFTER `initSpecies()` (so the vanilla baseline
 * is in place) and AFTER `initAbilities()` (so ability ids resolve at
 * activation time). Typically called from `init/init.ts:initializeGame()`
 * right after `initEliteReduxSpecies()`.
 */
export function initEliteReduxCustomSpecies(): InitEliteReduxCustomSpeciesResult {
  const result: InitEliteReduxCustomSpeciesResult = {
    customsAdded: 0,
    customsAlreadyPresent: 0,
    skippedDegenerate: 0,
    errors: [],
  };

  // Build a O(1) speciesId → bool lookup for idempotency.
  const existingIds = new Set<number>();
  for (const species of allSpecies) {
    existingIds.add(species.speciesId);
  }

  for (const draft of ER_SPECIES) {
    const pokerogueId = ER_ID_MAP.species[draft.id];
    if (pokerogueId === undefined) {
      // SPECIES_NONE sentinel falls here — B1a already reports it.
      continue;
    }
    if (pokerogueId < VANILLA_ID_CUTOFF) {
      // Vanilla — B1a's job.
      continue;
    }
    if (existingIds.has(pokerogueId)) {
      result.customsAlreadyPresent++;
      continue;
    }
    if (isDegenerateDraft(draft)) {
      // Orphan stub (all-zero stats, no abilities) — not a real species.
      // Skip registration entirely so it never surfaces as an obtainable
      // (e.g. the junk "Infernape Redux B").
      result.skippedDegenerate++;
      continue;
    }

    try {
      const species = buildCustomSpecies(draft, pokerogueId);
      species.setPassives([
        mapAbilityId(draft.innates[0]),
        mapAbilityId(draft.innates[1]),
        mapAbilityId(draft.innates[2]),
      ]);
      // Register the ER sprite slug for this species so getSpriteAtlasPath
      // resolves to assets/images/pokemon/elite-redux/{slug}/*. A per-species
      // override takes precedence over the manifest slug for entries whose own
      // upstream sprite directory ships the wrong art (see
      // ER_SPRITE_SLUG_OVERRIDES — e.g. Infernape Redux).
      const slug = ER_SPRITE_SLUG_OVERRIDES[draft.speciesConst] ?? ER_SPRITE_BY_SPECIES_ID.get(draft.id);
      if (slug) {
        ErCustomSpecies.registerSpriteSlug(pokerogueId, slug);
      }
      // Seed starterColors with a sensible default so UI code (candy
      // bar, hatch info, pokedex page) that reads starterColors[id][0/1]
      // doesn't crash on undefined. starterColors is otherwise populated
      // by an async fetch of starter-colors.json at scene boot, which
      // has no entries for ER ids >= 10000.
      if (!starterColors[pokerogueId]) {
        starterColors[pokerogueId] = ["ffffff", "ffffff"];
      }
      (allSpecies as PokemonSpecies[]).push(species);
      existingIds.add(pokerogueId);
      result.customsAdded++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(
        `Failed to construct species ${draft.speciesConst} (er id ${draft.id} → ${pokerogueId}): ${msg}`,
      );
    }
  }

  return result;
}

/**
 * Construct a single ER-custom `PokemonSpecies` (subclass) from its draft.
 * Defaults applied to fields ER does not ship per-species:
 *  - height: 1.0m, weight: 30.0kg (TODO: pull from ER dex hw[] in Phase C)
 *  - catchRate: 45 if draft.catchRate is 0 (ER ships 0 for most entries)
 *  - baseFriendship: 50 (vanilla default)
 *  - baseExp: 100 if draft.baseExp is 0
 *  - generation: 9 — all ER customs treated as gen9 for now (TODO: archetype)
 *
 * @param draft - ER species draft from `er-species.ts`
 * @param speciesId - pokerogue species id (≥ VANILLA_ID_CUTOFF) from `ER_ID_MAP.species`
 */
function buildCustomSpecies(draft: ErSpeciesDraft, speciesId: number): PokemonSpecies {
  const type1 = mapType(draft.types[0]) ?? PokemonType.NORMAL;
  const type2 = mapType(draft.types[1]);

  const baseTotal = draft.baseStats.reduce((sum, n) => sum + n, 0);

  // Pre-stash the display name so the constructor's localize() picks it up.
  ErCustomSpecies.registerDraftName(speciesId, draft.name);

  // PokemonSpecies constructor signature (verified against
  // src/data/pokemon-species.ts:823):
  //   id, generation, subLegendary, legendary, mythical,
  //   category, type1, type2, height, weight,
  //   ability1, ability2, abilityHidden,
  //   baseTotal, hp, atk, def, spatk, spdef, spd,
  //   catchRate, baseFriendship, baseExp,
  //   growthRate, malePercent, genderDiffs, canChangeForm, ...forms
  return new ErCustomSpecies(
    speciesId,
    9, // generation — TODO(B/C): derive from ER archetype/source-gen
    false, // subLegendary
    false, // legendary
    false, // mythical
    "??? Pokémon", // category — placeholder; localize() overrides
    type1,
    type2,
    1.0, // height (m) — TODO: extract from dex.hw[0]
    30.0, // weight (kg) — TODO: extract from dex.hw[1]
    mapAbilityId(draft.abilities[0]),
    mapAbilityId(draft.abilities[1]),
    mapAbilityId(draft.abilities[2]),
    baseTotal,
    draft.baseStats[0],
    draft.baseStats[1],
    draft.baseStats[2],
    draft.baseStats[3],
    draft.baseStats[4],
    draft.baseStats[5],
    draft.catchRate > 0 ? draft.catchRate : 45,
    draft.friendship > 0 ? draft.friendship : 50,
    draft.baseExp > 0 ? draft.baseExp : 100,
    mapGrowthRate(draft.growthRate),
    mapGenderRatio(draft.genderRatio),
    false, // genderDiffs
    false, // canChangeForm — TODO: support forms in Phase C
  );
}
