/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Relics (#439 biome overhaul) - PERMANENT, run-scoped, team-wide "buff"
// items that grant OUT-OF-COMBAT passive effects. Unlike held items they are
// not attached to a single Pokemon: they sit in the player's modifier list as
// relic icons (no pokemonId) and are queried by battle/egg hooks. This mirrors
// the er-community-items pattern, but team-wide.
//
// The modifier class `ErRelicModifier` lives in #modifiers/modifier and the
// ModifierType factory `erRelicModifierType` in #modifiers/modifier-type (both
// REQUIRED there so the vanilla save serializer can round-trip the relics).
//
// First relics:
//   - Field Medic     : every 3 turns, the benched player Pokemon in party
//                       slots 2 and 3 (the reserves) recover 1/12 of their max
//                       HP (a slow healing spring tending the back row).
//   - Warm Incubator  : all carried eggs hatch faster (an extra hatch-wave of
//                       progress each wave, applied to every egg).
//
// Icons: existing items-atlas frames + runtime tint (community-item precedent -
// no new atlas frames needed). PokeAPI-sourced bespoke icons are a later polish.
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";
import { ErRelicModifier } from "#modifiers/modifier";
import { toDmgValue } from "#utils/common";

export type ErRelicKind =
  | "fieldMedic"
  | "warmIncubator"
  | "coinPurse"
  | "mysteryCharm"
  | "moraleBanner"
  | "secondWind"
  | "twinLink"
  | "anchor"
  | "scrapMagnet"
  | "weathervane";

export interface ErRelicConfig {
  name: string;
  description: string;
  /** Items-atlas frame used as the summary/fallback icon (tinted). */
  icon: string;
  tint: number;
  maxStack: number;
  /** Standalone er-assets texture key (PokeAPI sprite) for the bar icon; omit to
   * use the tinted items-atlas frame above. */
  texture?: string;
}

export const ER_RELIC_CONFIG: Readonly<Record<ErRelicKind, ErRelicConfig>> = {
  fieldMedic: {
    name: "Field Medic",
    description: "Every 3 turns, your benched Pokémon in slots 2 and 3 recover 1/12 of their max HP.",
    icon: "healing_charm",
    tint: 0x88f0b0,
    maxStack: 1,
    texture: "er_field_medic",
  },
  warmIncubator: {
    name: "Warm Incubator",
    description: "All of your eggs hatch faster - every egg gains an extra wave of progress each wave.",
    icon: "charcoal",
    tint: 0xffb060,
    maxStack: 1,
    texture: "er_warm_incubator",
  },
  coinPurse: {
    name: "Coin Purse",
    description: "You earn 20% more money from all sources.",
    icon: "amulet_coin",
    tint: 0xf8d030,
    maxStack: 1,
  },
  mysteryCharm: {
    name: "Mystery Charm",
    description: "Mystery encounters appear more often while you hold this charm.",
    icon: "healing_charm",
    tint: 0xc080f8,
    maxStack: 1,
  },
  moraleBanner: {
    name: "Morale Banner",
    description: "While no Pokémon has fainted this biome, your whole team deals 15% more damage.",
    icon: "wide_lens",
    tint: 0xf85858,
    maxStack: 1,
  },
  secondWind: {
    name: "Second Wind",
    description: "Once per biome, the first of your Pokémon that would faint instead survives at 1 HP.",
    icon: "focus_band",
    tint: 0xf0e060,
    maxStack: 1,
  },
  twinLink: {
    name: "Twin Link",
    description: "If your party slots 2 and 3 share a type, your team's moves of that type deal 15% more damage.",
    icon: "soul_dew",
    tint: 0x80c0f8,
    maxStack: 1,
  },
  anchor: {
    name: "Anchor",
    description: "Once per biome, the first time your slot 6 Pokémon becomes your last one standing, it is fully healed.",
    icon: "big_root",
    tint: 0x9090a8,
    maxStack: 1,
  },
  scrapMagnet: {
    name: "Scrap Magnet",
    description: "Trainer battles have a 25% chance to drop one extra item reward.",
    icon: "metal_coat",
    tint: 0xb0b0c0,
    maxStack: 1,
  },
  weathervane: {
    name: "Weathervane",
    description: "Your Pokémon take no residual damage from sandstorm or hail.",
    icon: "never_melt_ice",
    tint: 0xc0d8f0,
    maxStack: 1,
  },
};

/** Every relic kind, in display order (used by the type registry). */
export const ER_RELIC_KINDS: readonly ErRelicKind[] = ["fieldMedic", "warmIncubator"];

/** Field Medic: heal cadence (every N turns) and heal fraction (1/denominator). */
const FIELD_MEDIC_TURN_CADENCE = 3;
const FIELD_MEDIC_HEAL_DENOM = 12;
/** Warm Incubator: extra hatch-wave progress per wave, per stack. */
const WARM_INCUBATOR_WAVES_PER_STACK = 1;
/** Coin Purse: percent money bonus per stack. */
const COIN_PURSE_PERCENT_PER_STACK = 20;
/** Mystery Charm: added ME spawn weight (out of 256) per stack. */
const MYSTERY_CHARM_WEIGHT_PER_STACK = 40;
/** Morale Banner: percent damage bonus while the team is faint-free this biome. */
const MORALE_BANNER_PERCENT = 15;
/** Twin Link: percent damage bonus for moves of the slot 2/3 shared type. */
const TWIN_LINK_PERCENT = 15;
/** Scrap Magnet: chance (out of 100) of an extra trainer-battle reward option. */
const SCRAP_MAGNET_CHANCE_PCT = 25;

/** Total stacks of the given relic the player currently holds (team-wide). */
export function getErRelicStacks(kind: ErRelicKind): number {
  let stacks = 0;
  for (const mod of globalScene?.findModifiers(
    m => m instanceof ErRelicModifier && (m as ErRelicModifier).kind === kind,
    true,
  ) ?? []) {
    stacks += (mod as ErRelicModifier).getStackCount();
  }
  return stacks;
}

/** True when the player currently holds at least one of the given relic. */
export function hasErRelic(kind: ErRelicKind): boolean {
  return getErRelicStacks(kind) > 0;
}

/**
 * Field Medic (relic): called ONCE per turn from TurnEndPhase. On every
 * {@linkcode FIELD_MEDIC_TURN_CADENCE}-th turn, heal the BENCHED player mons in
 * party slots 2 and 3 (array indices 1 and 2 - the reserves, never the active
 * mon on the field) for 1/12 of their max HP each. No-op when the relic isn't
 * held. Each reserve is skipped if it is missing, fainted, or already full.
 *
 * Benched mons are off-field, so the battler-index-keyed PokemonHealPhase does
 * not apply; we heal them directly via {@linkcode Pokemon.heal} (the same
 * hp-clamping mutation a party-targeted Potion uses) and refresh their info bar.
 */
export function erApplyFieldMedic(): void {
  if (!hasErRelic("fieldMedic")) {
    return;
  }
  const turn = globalScene.currentBattle?.turn ?? 0;
  if (turn < 1 || turn % FIELD_MEDIC_TURN_CADENCE !== 0) {
    return;
  }
  const party = globalScene.getPlayerParty();
  // Slots 2 and 3 only (party indices 1 and 2) - the back-row reserves.
  for (const index of [1, 2]) {
    const pokemon = party[index];
    if (!pokemon || pokemon.isFainted() || pokemon.isFullHp()) {
      continue;
    }
    const healed = pokemon.heal(toDmgValue(pokemon.getMaxHp() / FIELD_MEDIC_HEAL_DENOM));
    if (healed > 0) {
      pokemon.updateInfo();
      // ER custom relic - English-only (shared locales submodule). Silent on the
      // field log would be fine for a benched mon, but a brief named note helps
      // testers see the heal fire.
      globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} was tended by the Field Medic!`);
    }
  }
}

/**
 * Warm Incubator (relic): extra hatch-wave progress to apply to EVERY egg this
 * wave, on top of the normal -1. Returns 0 when the relic isn't held. Called
 * from EggLapsePhase.
 */
export function erWarmIncubatorBonus(): number {
  return getErRelicStacks("warmIncubator") * WARM_INCUBATOR_WAVES_PER_STACK;
}

/** Coin Purse (relic): percent money bonus applied to every money gain. */
export function erCoinPurseBonusPercent(): number {
  return getErRelicStacks("coinPurse") * COIN_PURSE_PERCENT_PER_STACK;
}

/** Mystery Charm (relic): added Mystery-Encounter spawn weight (out of 256). */
export function erMysteryCharmWeightBonus(): number {
  return getErRelicStacks("mysteryCharm") * MYSTERY_CHARM_WEIGHT_PER_STACK;
}

// =============================================================================
// Per-biome transient relic state (NOT saved - reset on every biome entry).
//
// Several relics are "once per biome" or "while a condition holds this biome".
// We track that in module-scoped flags that {@linkcode resetErRelicBiomeState}
// clears each time the player enters a new arena (called from
// `BattleScene.newArena`, the single choke-point for biome transitions). These
// flags are deliberately NOT serialised: a mid-biome reload re-arms the relic,
// which is the player-friendly direction and avoids touching the save schema.
// =============================================================================

/** True once any player Pokémon has fainted in the CURRENT biome (Morale Banner). */
let MORALE_BANNER_BROKEN = false;
/** True once Second Wind has saved a Pokémon in the CURRENT biome (one-shot). */
let SECOND_WIND_USED = false;
/** True once Anchor's last-stand full heal has fired in the CURRENT biome (one-shot). */
let ANCHOR_USED = false;
/** waveIndex -> rolled Scrap Magnet extra-reward result, cached so rerolls/copies are stable. */
let SCRAP_MAGNET_ROLLED_WAVE = -1;
let SCRAP_MAGNET_ROLL_RESULT = false;

/** Clear all per-biome relic flags. Called from `BattleScene.newArena`. */
export function resetErRelicBiomeState(): void {
  MORALE_BANNER_BROKEN = false;
  SECOND_WIND_USED = false;
  ANCHOR_USED = false;
  SCRAP_MAGNET_ROLLED_WAVE = -1;
  SCRAP_MAGNET_ROLL_RESULT = false;
}

/**
 * Record a player faint for the relic system. Breaks the Morale Banner's
 * faint-free condition for the rest of this biome. Called from FaintPhase for
 * player Pokémon (no-op for enemies / when no relevant relic is held).
 */
export function erRelicRecordPlayerFaint(): void {
  MORALE_BANNER_BROKEN = true;
}

/**
 * Morale Banner (relic): team-wide attack multiplier. Returns 1.15 while the
 * relic is held and NO player Pokémon has fainted yet this biome, else 1.
 * Queried from {@linkcode Pokemon.getAttackDamage} for player attackers.
 */
export function erMoraleBannerMultiplier(): number {
  if (MORALE_BANNER_BROKEN || !hasErRelic("moraleBanner")) {
    return 1;
  }
  return 1 + MORALE_BANNER_PERCENT / 100;
}

/**
 * The type shared by the player party's slot 2 and slot 3 mons (array indices
 * 1 and 2), or null if those slots don't exist or share no type. Twin Link's
 * bonus applies to moves of this type.
 */
function erTwinLinkSharedType(): PokemonType | null {
  const party = globalScene?.getPlayerParty?.() ?? [];
  const second = party[1];
  const third = party[2];
  if (!second || !third) {
    return null;
  }
  const secondTypes = second.getTypes(false, false, true);
  const thirdTypes = third.getTypes(false, false, true);
  for (const t of secondTypes) {
    if (thirdTypes.includes(t)) {
      return t;
    }
  }
  return null;
}

/**
 * Twin Link (relic): team-wide attack multiplier for moves of the type shared
 * by party slots 2 and 3. Returns 1.15 for matching move types while the relic
 * is held, else 1. Queried from {@linkcode Pokemon.getAttackDamage}.
 */
export function erTwinLinkMultiplier(moveType: PokemonType): number {
  if (!hasErRelic("twinLink")) {
    return 1;
  }
  const shared = erTwinLinkSharedType();
  if (shared === null || shared !== moveType) {
    return 1;
  }
  return 1 + TWIN_LINK_PERCENT / 100;
}

/**
 * Second Wind (relic): when a player Pokémon is about to take lethal damage,
 * returns true (consuming the once-per-biome charge) so the caller clamps it to
 * survive at 1 HP. Returns false if the relic isn't held, already used this
 * biome, or the Pokémon isn't a player mon at >=1 HP. Called from
 * {@linkcode Pokemon.damage}.
 */
export function erTrySecondWind(pokemon: Pokemon): boolean {
  if (SECOND_WIND_USED || !pokemon.isPlayer() || pokemon.hp < 1 || !hasErRelic("secondWind")) {
    return false;
  }
  SECOND_WIND_USED = true;
  // ER custom relic - English-only (shared locales submodule).
  globalScene.phaseManager.queueMessage(`${pokemon.getNameToRender()} held on with its Second Wind!`);
  return true;
}

/**
 * Anchor (relic): called from FaintPhase after a player faint resolves. If the
 * relic is held, hasn't fired yet this biome, and the ONLY surviving legal
 * player Pokémon is the slot 6 mon (party index 5), fully heal that mon (a last
 * stand). One-shot per biome. No-op otherwise.
 */
export function erTryAnchorLastStand(): void {
  if (ANCHOR_USED || !hasErRelic("anchor")) {
    return;
  }
  const party = globalScene.getPlayerParty();
  const anchorMon = party[5];
  if (!anchorMon || anchorMon.isFainted()) {
    return;
  }
  const survivors = party.filter(p => !p.isFainted());
  if (survivors.length !== 1 || survivors[0] !== anchorMon) {
    return;
  }
  ANCHOR_USED = true;
  anchorMon.hp = anchorMon.getMaxHp();
  anchorMon.resetStatus(true);
  anchorMon.updateInfo();
  // ER custom relic - English-only (shared locales submodule).
  globalScene.phaseManager.queueMessage(`${anchorMon.getNameToRender()} made its last stand, fully restored by the Anchor!`);
}

/**
 * Scrap Magnet (relic): how many EXTRA reward options to add to the reward
 * screen after a trainer battle. Rolls once per wave (cached so rerolls and the
 * copy phase stay consistent) with a {@linkcode SCRAP_MAGNET_CHANCE_PCT}% chance
 * of +1. Returns 0 when the relic isn't held or the result was a miss. The
 * caller is responsible for only invoking this on trainer-battle rewards.
 */
export function erScrapMagnetExtraRewards(): number {
  if (!hasErRelic("scrapMagnet")) {
    return 0;
  }
  const wave = globalScene.currentBattle?.waveIndex ?? -1;
  if (wave !== SCRAP_MAGNET_ROLLED_WAVE) {
    SCRAP_MAGNET_ROLLED_WAVE = wave;
    SCRAP_MAGNET_ROLL_RESULT = globalScene.randBattleSeedInt(100) < SCRAP_MAGNET_CHANCE_PCT;
  }
  return SCRAP_MAGNET_ROLL_RESULT ? 1 : 0;
}

/**
 * Weathervane (relic): true when the player holds the relic, meaning player
 * Pokémon ignore residual sandstorm/hail chip damage. Queried from
 * WeatherEffectPhase's per-Pokémon immunity check (gated on isPlayer there).
 */
export function erWeathervaneBlocksWeatherDamage(): boolean {
  return hasErRelic("weathervane");
}
