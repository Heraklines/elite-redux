/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { globalScene } from "#app/global-scene";
import type { PokemonSpecies } from "#data/pokemon-species";
import { AbilityId } from "#enums/ability-id";
import type { PokeballType } from "#enums/pokeball";
import type { PokemonType } from "#enums/pokemon-type";
import type { Pokemon } from "#field/pokemon";

interface AbilityMetaAttr {
  readonly erMetaKind: string;
  getCondition(): ((pokemon: Pokemon) => boolean) | null;
}

interface BiomeRevealMarker extends AbilityMetaAttr {
  readonly erMetaKind: "biome-reveal-bonus";
  getCount(): number;
}

interface EncounterTypeWeightMarker extends AbilityMetaAttr {
  readonly erMetaKind: "encounter-type-weight";
  getType(): PokemonType;
  getMultiplier(): number;
}

interface ExperienceGainMarker extends AbilityMetaAttr {
  readonly erMetaKind: "experience-gain-multiplier";
  getMultiplier(): number;
}

interface MoneyGainMarker extends AbilityMetaAttr {
  readonly erMetaKind: "money-gain-multiplier";
  getMultiplier(): number;
}

interface BallRecoveryMarker extends AbilityMetaAttr {
  readonly erMetaKind: "ball-recovery";
  getRecoverableBalls(): readonly PokeballType[];
}

function hasMetaKind<T extends AbilityMetaAttr>(attr: unknown, kind: T["erMetaKind"]): attr is T {
  return typeof attr === "object" && attr !== null && Reflect.get(attr, "erMetaKind") === kind;
}

function eligibleAttrs<T extends AbilityMetaAttr>(
  pokemon: Pokemon,
  kind: T["erMetaKind"],
  includeFainted = false,
): T[] {
  const matches: T[] = [];
  const sources = includeFainted ? pokemon.getPostBattleAbilitySources() : pokemon.getActiveAbilitySources();
  for (const source of sources) {
    for (const attr of source.ability.attrs) {
      if (!hasMetaKind<T>(attr, kind)) {
        continue;
      }
      const condition = attr.getCondition();
      if (condition == null || condition(pokemon)) {
        matches.push(attr);
      }
    }
  }
  return matches;
}

function livingPlayerParty(): readonly Pokemon[] {
  return globalScene.getPlayerParty().filter(pokemon => !pokemon.isFainted());
}

function activePlayerField(): readonly Pokemon[] {
  return globalScene.getPlayerField().filter(pokemon => !pokemon.isFainted());
}

function wholePlayerParty(): readonly Pokemon[] {
  return globalScene.getPlayerParty();
}

/** Sum the extra World Map destinations revealed by eligible player-party abilities. */
export function getBiomeRevealBonus(): number {
  return livingPlayerParty().reduce(
    (total, pokemon) =>
      total
      + eligibleAttrs<BiomeRevealMarker>(pokemon, "biome-reveal-bonus").reduce((sum, attr) => sum + attr.getCount(), 0),
    0,
  );
}

/** Multiply encounter weight modifiers for every eligible player-party source matching this species' types. */
export function getEncounterSpeciesWeightMultiplier(species: PokemonSpecies): number {
  return livingPlayerParty().reduce(
    (partyMultiplier, pokemon) =>
      partyMultiplier
      * eligibleAttrs<EncounterTypeWeightMarker>(pokemon, "encounter-type-weight").reduce(
        (pokemonMultiplier, attr) =>
          species.isOfType(attr.getType()) ? pokemonMultiplier * attr.getMultiplier() : pokemonMultiplier,
        1,
      ),
    1,
  );
}

/** Multiply all eligible experience modifiers carried by the Pokémon receiving experience. */
export function getExperienceGainMultiplier(pokemon: Pokemon): number {
  return eligibleAttrs<ExperienceGainMarker>(pokemon, "experience-gain-multiplier").reduce(
    (multiplier, attr) => multiplier * attr.getMultiplier(),
    1,
  );
}

/** Multiply all eligible money modifiers on the active player field at battle end. */
export function getBattleMoneyGainMultiplier(): number {
  return activePlayerField().reduce(
    (fieldMultiplier, pokemon) =>
      fieldMultiplier
      * eligibleAttrs<MoneyGainMarker>(pokemon, "money-gain-multiplier").reduce(
        (pokemonMultiplier, attr) => pokemonMultiplier * attr.getMultiplier(),
        1,
      ),
    1,
  );
}

/** Capture the field-qualified money multiplier before battle-end phases can change field state. */
export function snapshotBattleMoneyGainMultiplier(): number {
  const multiplier = getBattleMoneyGainMultiplier();
  globalScene.currentBattle.erBattleEndMoneyMultiplier = multiplier;
  globalScene.currentBattle.erBattleEndMoneyMultiplierCaptured = true;
  return multiplier;
}

/** Read the immutable multiplier captured by BattleEndPhase. Non-battle reward phases receive no bonus. */
export function getCapturedBattleMoneyGainMultiplier(): number {
  return globalScene.currentBattle.erBattleEndMoneyMultiplierCaptured
    ? globalScene.currentBattle.erBattleEndMoneyMultiplier
    : 1;
}

/** Whether an eligible active Stench source currently protects Toxic Terrain. */
export function isToxicTerrainProtected(): boolean {
  return globalScene.getField(true).some(pokemon => pokemon?.hasAbility(AbilityId.STENCH));
}

/**
 * Restore every ball used this battle whose type is approved by at least one
 * eligible player-party ability. A physical ball is consumed from the
 * battle ledger once, so duplicate sources and multiple holders cannot return it twice.
 * The holder need not remain active or conscious at battle end.
 */
export function recoverUsedPokeballsAfterBattle(): void {
  const recoverable = new Set<PokeballType>();
  for (const pokemon of wholePlayerParty()) {
    for (const attr of eligibleAttrs<BallRecoveryMarker>(pokemon, "ball-recovery", true)) {
      for (const ballType of attr.getRecoverableBalls()) {
        recoverable.add(ballType);
      }
    }
  }

  for (const ballType of recoverable) {
    const count = globalScene.currentBattle.consumeUsedPokeballs(ballType);
    if (count > 0) {
      globalScene.pokeballCounts[ballType] = (globalScene.pokeballCounts[ballType] ?? 0) + count;
    }
  }
}
