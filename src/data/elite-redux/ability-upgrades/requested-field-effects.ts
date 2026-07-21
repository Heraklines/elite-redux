/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import { allAbilities } from "#data/data-lists";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { AbilityId } from "#enums/ability-id";
import { ArenaTagSide } from "#enums/arena-tag-side";
import { ArenaTagType } from "#enums/arena-tag-type";
import { BattlerTagType } from "#enums/battler-tag-type";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { WeatherType } from "#enums/weather-type";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";

function erAbilityId(draftId: number): AbilityId | undefined {
  return ER_ID_MAP.abilities[draftId] as AbilityId | undefined;
}

function activeFieldHasDraftAbility(draftId: number, predicate?: (holder: Pokemon) => boolean): boolean {
  const abilityId = erAbilityId(draftId);
  return (
    abilityId !== undefined
    && globalScene.getField(true).some(holder => (!predicate || predicate(holder)) && holder.hasAbility(abilityId))
  );
}

const FOOD_SPECIES_NAMES = new Set([
  "alcremie",
  "appletun",
  "applin",
  "arboliva",
  "bounsweet",
  "capsakid",
  "cherubi",
  "cherrim",
  "dachsbun",
  "dipplin",
  "dolliv",
  "exeggcute",
  "fidough",
  "flapple",
  "hydrapple",
  "milcery",
  "poltchageist",
  "polteageist",
  "scovillain",
  "sinistcha",
  "sinistea",
  "slurpuff",
  "smoliv",
  "steenee",
  "swirlix",
  "tropius",
  "tsareena",
  "vanillish",
  "vanillite",
  "vanilluxe",
]);

export function isRequestedFoodPokemon(pokemon: Pokemon): boolean {
  return FOOD_SPECIES_NAMES.has(pokemon.species.name.toLowerCase());
}

/** Returns the active opposing Salt Circle source that an escaping battler bypassed. */
export function getSaltCircleEscapeSource(leavingPokemon: Pokemon): Pokemon | undefined {
  const saltCircleId = erAbilityId(546);
  if (saltCircleId === undefined) {
    return;
  }
  return leavingPokemon.getOpponents().find(opponent => opponent.hasAbility(saltCircleId));
}

/**
 * Dynamic field suppression requested for Aura Break and Lunar Affinity.
 * The suppressors themselves are excluded from their own target sets, avoiding
 * recursion while active ability sources are resolved.
 */
export function isSuppressedByRequestedFieldAbility(pokemon: Pokemon, abilityId: AbilityId): boolean {
  const battleAura = erAbilityId(637);
  const auraArmor = erAbilityId(1021);
  if (
    (abilityId === battleAura || abilityId === auraArmor)
    && globalScene.getField(true).some(holder => holder.isOpponent(pokemon) && holder.hasAbility(AbilityId.AURA_BREAK))
  ) {
    return true;
  }

  const lunarAffinity = erAbilityId(711);
  if (abilityId === lunarAffinity) {
    return false;
  }
  const abilityName = allAbilities[abilityId]?.name ?? "";
  return (
    /(?:lunar|moon|star)/i.test(abilityName) && activeFieldHasDraftAbility(711, holder => holder.isOpponent(pokemon))
  );
}

/** Field-wide requested damage modifiers that are relative to the attacker. */
export function getRequestedFieldDamageMultiplier(source: Pokemon, target: Pokemon, move: Move): number {
  let multiplier = 1;

  if (
    /\baura\b/i.test(move.name)
    && globalScene.getField(true).some(holder => holder.hasAbility(AbilityId.AURA_BREAK))
  ) {
    multiplier *= 0.75;
  }
  if (activeFieldHasDraftAbility(369, holder => holder !== source)) {
    multiplier *= 0.67;
  }
  if (isReleasedCommander(source)) {
    multiplier *= 0.5;
  }
  const sugarRushId = erAbilityId(652);
  if (sugarRushId !== undefined) {
    if (source.hasAbility(sugarRushId) && isRequestedFoodPokemon(target)) {
      multiplier *= 1.5;
    }
    if (target.hasAbility(sugarRushId) && isRequestedFoodPokemon(source)) {
      multiplier *= 0.5;
    }
  }

  return multiplier;
}

/** A Commander source may act once its commanded Dondozo reaches half HP. */
export function isReleasedCommander(pokemon: Pokemon): boolean {
  return pokemon
    .getAllies()
    .some(
      ally =>
        ally.getTag(BattlerTagType.COMMANDED)?.sourceId === pokemon.id && ally.hp > 0 && ally.hp <= ally.getMaxHp() / 2,
    );
}

/** Transfers actual confusion self-damage to every opposing Entrance holder. */
export function healEntranceFromConfusion(victim: Pokemon, damage: number): void {
  const entranceId = erAbilityId(611);
  if (damage <= 0 || entranceId === undefined) {
    return;
  }
  for (const holder of victim.getOpponents().filter(opponent => opponent.hasAbility(entranceId))) {
    globalScene.phaseManager.unshiftNew(
      "PokemonHealPhase",
      holder.getBattlerIndex(),
      damage,
      `${holder.getNameToRender()} absorbed the confusion damage!`,
      true,
    );
  }
}

/** Dust Cloud restores ordinary accuracy checks for ability-provided no-miss effects. */
export function requestedFieldNormalizesAbilityAccuracy(): boolean {
  return activeFieldHasDraftAbility(479);
}

/** Keeps Blistering Sun's harsh sun and own-side Tailwind on one shared lifetime. */
export function syncBlisteringSunFieldPair(): void {
  const holders = globalScene.getField(true).filter(holder => {
    const blisteringSunId = erAbilityId(869);
    return blisteringSunId !== undefined && holder.hasAbility(blisteringSunId);
  });
  for (const holder of holders) {
    const side = holder.isPlayer() ? ArenaTagSide.PLAYER : ArenaTagSide.ENEMY;
    const hasTailwind = globalScene.arena.getTagOnSide(ArenaTagType.TAILWIND, side) !== undefined;
    const hasHarshSun = globalScene.arena.weatherType === WeatherType.HARSH_SUN;
    if (hasTailwind && !hasHarshSun) {
      globalScene.arena.trySetWeather(WeatherType.HARSH_SUN, holder);
    } else if (!hasTailwind && hasHarshSun) {
      globalScene.arena.trySetWeather(WeatherType.NONE);
    }
  }
}

const MIMICRY_TERRAIN_PULSE_TYPES = [
  PokemonType.PSYCHIC,
  PokemonType.FAIRY,
  PokemonType.POISON,
  PokemonType.ELECTRIC,
  PokemonType.GRASS,
] as const;

/** Resolves Mimicry's Terrain Pulse to the strongest legal type against this target. */
export function resolveRequestedMoveType(
  source: Pokemon,
  target: Pokemon,
  move: Move,
  defaultType: PokemonType,
): PokemonType {
  if (move.id !== MoveId.TERRAIN_PULSE || !source.hasAbility(AbilityId.MIMICRY)) {
    return defaultType;
  }
  let bestType: PokemonType = MIMICRY_TERRAIN_PULSE_TYPES[0];
  let bestMultiplier = -1;
  for (const type of MIMICRY_TERRAIN_PULSE_TYPES) {
    const multiplier = target.getAttackTypeEffectiveness(type, { source, move });
    if (multiplier > bestMultiplier) {
      bestType = type;
      bestMultiplier = multiplier;
    }
  }
  return bestType;
}
