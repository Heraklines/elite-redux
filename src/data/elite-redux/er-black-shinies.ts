/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Black Shinies (#349) — the t4 ultra-rare shiny tier.
//
// Maintainer spec (June 10):
//  - Base chance = 1/50 of a RED (epic, variant 2) shiny — hatch 1k-10k eggs.
//  - Normal ability + the 3 innates stay UNTOUCHED. The black bonus is the
//    GIFT: a 5th ability slot with 3 choices rolled from the curated pool
//    (approved June 10: CORE + BORDERLINE) that the player switches between;
//    the ACTIVE choice is shared with allies on the field (black shiny
//    Jigglypuff runs Lead Coat → its double-battle partner has Lead Coat too
//    while both are out). The Ability Randomizer can NEVER touch the gift.
//  - Max ONE black shiny per player team — your signature Pokémon.
//  - Visuals: "Ultra Segmented Black Shiny" sprites + smoke halo (see
//    docs/design/black-shiny-sprite-pipeline.md) — generated assets land in
//    er-assets; until then the battle sprite gets an interim obsidian tint.
//
// State lives on CustomPokemonData (erBlackShiny / erGiftAbilities /
// erGiftIndex + the passive/passive2/passive3 innate overrides), so it
// persists through PokemonData like every other per-mon customization.
// =============================================================================

import { globalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import {
  ER_BLACK_SHINY_POOL_BORDERLINE,
  ER_BLACK_SHINY_POOL_CORE,
} from "#data/elite-redux/er-black-shiny-gift-pool";
import {
  erBlackSpritePath,
  erBlackSpritePathFromBase,
} from "#data/elite-redux/er-black-sprite-manifest";
import { erBalanceNum } from "#data/elite-redux/er-balance-tuning";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import type { PokemonSpecies } from "#data/pokemon-species";
import type { Pokemon } from "#field/pokemon";
import { randSeedInt } from "#utils/common";

/**
 * APPROVED pool (maintainer, June 10): core + borderline, deduped — stored as
 * POKEROGUE ability ids (the curation doc lists ER-native ids; ER customs map
 * to bridged ids via ER_ID_MAP, which is what allAbilities and the
 * customPokemonData slot overrides expect).
 */
export const ER_BLACK_SHINY_ABILITY_POOL: readonly number[] = [
  ...new Set(
    [...ER_BLACK_SHINY_POOL_CORE, ...ER_BLACK_SHINY_POOL_BORDERLINE].map(erId => ER_ID_MAP.abilities[erId] ?? erId),
  ),
];

/** A red (epic) shiny upgrades to BLACK with probability 1/50. */
export const ER_BLACK_SHINY_DENOMINATOR = 50;

/** Interim battle-sprite tint until the generated t4 assets land. */
export const ER_BLACK_SHINY_TINT = 0x35323d;

/** Black Shinies always contribute five luck. */
export const ER_BLACK_SHINY_LUCK = 5;

export interface ErBlackShinySpriteSource {
  key: string;
  atlasPath: string;
}

interface ErBlackShinyStarterState {
  shiny?: boolean | undefined;
  variant?: number | undefined;
  erBlackShiny?: boolean | undefined;
}

/**
 * Resolve the generated FRONT atlas used by a Black Shiny outside battle.
 * Mirrors Pokemon's battle resolver: numeric base forms use `black/{id}`;
 * Redux/custom forms use their plain slug atlas under `black/`.
 */
export function getErBlackShinySpriteSource(
  species: PokemonSpecies,
  female: boolean,
  formIndex: number,
): ErBlackShinySpriteSource | null {
  const plainAtlasPath = species.getSpriteAtlasPath(female, formIndex, false, 0);
  const atlasPath =
    (formIndex === 0 ? erBlackSpritePath(species.speciesId, false) : null)
    ?? erBlackSpritePathFromBase(plainAtlasPath);
  if (!atlasPath) {
    return null;
  }
  return {
    key: `${species.getSpriteKey(female, formIndex, false, 0)}-erblack`,
    atlasPath,
  };
}

/** True only for a valid selected t4 starter state. */
export function isErBlackShinyStarterSelection(
  starter: ErBlackShinyStarterState,
): boolean {
  return starter.erBlackShiny === true && starter.shiny === true && starter.variant === 2;
}

/** Number of Black Shinies in a starter team. */
export function countErBlackShinyStarters(
  starters: readonly ErBlackShinyStarterState[],
): number {
  return starters.reduce((count, starter) => count + (starter.erBlackShiny === true ? 1 : 0), 0);
}

/**
 * Final fail-safe for restored/merged starter data: preserve the first selected
 * Black Shiny and demote every later one to its underlying epic shiny.
 */
export function enforceErBlackShinyStarterLimit<T extends ErBlackShinyStarterState>(
  starters: readonly T[],
): T[] {
  let found = false;
  return starters.map(starter => {
    if (starter.erBlackShiny !== true) {
      return starter;
    }
    if (!found) {
      found = true;
      return starter;
    }
    return { ...starter, erBlackShiny: false };
  });
}

/** True when this mon is a Black Shiny. */
export function isErBlackShiny(pokemon: Pokemon | null | undefined): boolean {
  return !!pokemon?.customPokemonData?.erBlackShiny;
}

/** The player team already fields a black shiny (max one per team). */
export function playerHasErBlackShiny(): boolean {
  try {
    return globalScene.getPlayerParty().some(p => isErBlackShiny(p));
  } catch {
    return false;
  }
}

/** Draw `count` DISTINCT ability ids from the pool (seeded RNG context). */
function drawDistinctFromPool(count: number, exclude: ReadonlySet<number> = new Set()): number[] {
  const picked: number[] = [];
  const taken = new Set(exclude);
  // Bounded resample: the pool (~130 ids) is far larger than count (3).
  for (let guard = 0; picked.length < count && guard < 200; guard++) {
    const id = ER_BLACK_SHINY_ABILITY_POOL[randSeedInt(ER_BLACK_SHINY_ABILITY_POOL.length)];
    if (!taken.has(id)) {
      taken.add(id);
      picked.push(id);
    }
  }
  return picked;
}

/**
 * Turn `pokemon` into a black shiny: roll its GIFT — 3 distinct pool choices
 * for the 5th ability slot. Normal ability + innates are untouched.
 * Idempotent.
 */
export function applyErBlackShinyKit(pokemon: Pokemon): void {
  const data = pokemon.customPokemonData;
  if (data.erBlackShiny) {
    return;
  }
  data.erBlackShiny = true;
  // The mon's normal ability and its 3 innates stay UNTOUCHED (maintainer
  // correction, June 10). The black bonus is ONLY the GIFT: a 5th ability
  // slot with 3 random pool choices the player switches between.
  data.erGiftAbilities = drawDistinctFromPool(3);
  data.erGiftIndex = 0;
}

/**
 * Roll the black upgrade for a freshly generated shiny. Requires an EPIC
 * (variant 2) shiny; succeeds 1/50 (seeded). The player team is capped at one
 * black shiny — a second player-side roll never upgrades. Returns whether the
 * mon is (now) black.
 */
export function maybeUpgradeToErBlackShiny(pokemon: Pokemon): boolean {
  try {
    // Dev-suite override: force the black roll at GENERATION so the black
    // atlas loads with the initial assets (no delayed mid-battle swap).
    // Checked BEFORE the already-black early-return so a re-roll that calls
    // this again still re-pins shiny/variant.
    const forcedSpecies = pokemon.isPlayer()
      ? Overrides.ER_BLACK_SHINY_PLAYER_OVERRIDE
      : Overrides.ER_BLACK_SHINY_ENEMY_OVERRIDE;
    if (forcedSpecies !== null && pokemon.species.speciesId === forcedSpecies) {
      pokemon.shiny = true;
      pokemon.variant = 2;
      applyErBlackShinyKit(pokemon);
      return true;
    }
    if (isErBlackShiny(pokemon)) {
      return true;
    }
    if (!pokemon.shiny || pokemon.variant !== 2) {
      return false;
    }
    if (pokemon.isPlayer() && playerHasErBlackShiny()) {
      return false;
    }
    if (randSeedInt(erBalanceNum("er.shiny.blackShinyDenominator")) !== 0) {
      return false;
    }
    applyErBlackShinyKit(pokemon);
    return true;
  } catch {
    // The shiny pipeline must never break on the upgrade roll.
    return false;
  }
}

/**
 * Drop any black state from a DISCARDED shiny roll. The EnemyPokemon
 * constructor re-rolls shiny/variant after the base constructor already
 * rolled (and possibly upgraded) them - without this, the stale kit would
 * dangle on a mon whose final roll is not an epic shiny at all.
 */
export function resetErBlackShinyState(pokemon: Pokemon): void {
  const data = pokemon.customPokemonData;
  if (data?.erBlackShiny) {
    data.erBlackShiny = false;
    data.erGiftAbilities = [];
    data.erGiftIndex = 0;
  }
}

/** The ACTIVE gift ability id of this black shiny, or null. */
export function getErActiveGiftAbilityId(pokemon: Pokemon): number | null {
  const data = pokemon.customPokemonData;
  if (!data?.erBlackShiny || !data.erGiftAbilities?.length) {
    return null;
  }
  const idx = Math.max(0, Math.min(data.erGiftAbilities.length - 1, data.erGiftIndex ?? 0));
  return data.erGiftAbilities[idx] ?? null;
}

/** Force a black shiny's active gift slot to a specific ability while preserving two backups. */
export function pinErBlackShinyGiftAbility(pokemon: Pokemon, abilityId: number): void {
  applyErBlackShinyKit(pokemon);
  const data = pokemon.customPokemonData;
  const remaining = (data.erGiftAbilities ?? []).filter(id => id !== abilityId);
  data.erGiftAbilities = [abilityId, ...remaining].slice(0, 3);
  data.erGiftIndex = 0;
}

/** Cycle the gift slot to the next of its 3 choices; returns the new id. */
export function cycleErGiftAbility(pokemon: Pokemon): number | null {
  const data = pokemon.customPokemonData;
  if (!data?.erBlackShiny || !data.erGiftAbilities?.length) {
    return null;
  }
  data.erGiftIndex = ((data.erGiftIndex ?? 0) + 1) % data.erGiftAbilities.length;
  return getErActiveGiftAbilityId(pokemon);
}

/**
 * Whether the gift slot may be CYCLED right now. Maintainer rule: ONLY in the
 * out-of-combat reward-shop check menus, NEVER mid-combat - the player must not
 * be able to swap the gift ability to game the current fight. The reward shop
 * runs SelectModifierPhase; any active battle phase (command / move / etc.)
 * blocks the cycle. Gates both the summary Abilities page and the in-battle
 * Info overlay (the latter is always mid-combat, so this is always false there).
 */
export function isErGiftCycleAllowed(): boolean {
  return globalScene.phaseManager.getCurrentPhase().is("SelectModifierPhase");
}

/**
 * GIFT SHARING — the extra ability ids active on `pokemon`:
 *  - its OWN active gift (if it is a black shiny), plus
 *  - the active gift of any black-shiny ALLY currently on the field with it.
 * Consumed by Pokemon.getPassiveAbilities, so combat and every
 * abilities-driven screen pick the gift up automatically.
 */
export function getErSharedGiftAbilityIdsFor(pokemon: Pokemon): number[] {
  const ids: number[] = [];
  const own = getErActiveGiftAbilityId(pokemon);
  if (own !== null) {
    ids.push(own);
  }
  try {
    if (pokemon.isOnField?.()) {
      const ally = pokemon.getAlly?.();
      if (ally && ally !== pokemon && ally.isOnField() && isErBlackShiny(ally)) {
        const gift = getErActiveGiftAbilityId(ally);
        if (gift !== null && !ids.includes(gift)) {
          ids.push(gift);
        }
      }
    }
  } catch {
    // Ally lookup is best-effort (no scene in some headless contexts).
  }
  return ids;
}

/**
 * Promote a mon to black shiny MID-BATTLE (dev scenarios + the hell finale's
 * stage 2). Setting the flags alone is not enough once the mon is already
 * summoned: the sprite keys change to the `-erblack` black atlas, which was
 * never loaded at summon time, so the sprite would go blank — and the
 * nameplate shiny star / sparkle never refresh. This reloads assets under the
 * new keys, re-plays the anim, re-inits the sparkle and updates the nameplate
 * (the same recipe breakIllusion uses for its live re-key).
 */
export function promoteToErBlackShinyInBattle(pokemon: Pokemon): void {
  pokemon.shiny = true;
  pokemon.variant = 2;
  applyErBlackShinyKit(pokemon);
  try {
    void pokemon
      .loadAssets(false)
      .then(() => {
        pokemon.playAnim();
        applyErBlackShinyInterimTint(pokemon);
        if (pokemon.isOnField()) {
          pokemon.initShinySparkle();
          pokemon.sparkle();
        }
        return pokemon.updateInfo(true);
      })
      .catch(() => {
        // Asset reload is best-effort: keep the promotion even if the black
        // atlas fails to fetch (the base sprite + tint still shows).
        applyErBlackShinyInterimTint(pokemon);
        void pokemon.updateInfo(true);
      });
  } catch {
    // Headless contexts have no loader/sprites.
  }
}

/** Interim visual: obsidian-tint the battle sprites until real t4 assets land. */
export function applyErBlackShinyInterimTint(pokemon: Pokemon): void {
  if (!isErBlackShiny(pokemon)) {
    return;
  }
  // The generated t4 atlas is already black — never tint on top of it
  // (numeric OR slug scheme; the resolved atlas path is authoritative).
  try {
    if (pokemon.getSpriteAtlasPath().startsWith("black/")) {
      return;
    }
  } catch {
    // Headless: no species-form sprite data — fall through to the tint try.
  }
  try {
    pokemon.getSprite()?.setTint(ER_BLACK_SHINY_TINT);
    pokemon.getTintSprite?.()?.setTint(ER_BLACK_SHINY_TINT);
  } catch {
    // Sprite may not exist yet (headless / pre-summon).
  }
}
