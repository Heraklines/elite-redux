/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { Ability } from "#abilities/ability";
import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import * as Archetypes from "#data/elite-redux/archetypes/index";
import { PokemonSummonData } from "#data/pokemon-data";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { Passive as PassiveAttr } from "#enums/passive";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

interface AbilitySource {
  readonly ability: Ability;
  readonly passive: boolean;
  readonly passiveSlot?: number;
}

type AbilityStateExports = {
  suppressInnateSlotUntilSwitch?: (pokemon: Pokemon, slot: 0 | 1 | 2) => void;
  isInnateSlotSuppressed?: (pokemon: Pokemon, slot: 0 | 1 | 2) => boolean;
  suppressAbilityIdForTurns?: (
    pokemon: Pokemon,
    abilityId: AbilityId,
    turns: number,
    sourceAbilityId: AbilityId,
  ) => void;
  isAbilityIdSuppressed?: (pokemon: Pokemon, abilityId: AbilityId) => boolean;
  lapseTimedAbilitySuppressions?: (pokemon: Pokemon) => readonly AbilityId[];
  claimSummonAbilityProvenance?: (pokemon: Pokemon, key: string) => boolean;
  hasSummonAbilityProvenance?: (pokemon: Pokemon, key: string) => boolean;
  claimCommandAbilityProvenance?: (pokemon: Pokemon, key: string) => boolean;
  hasCommandAbilityProvenance?: (pokemon: Pokemon, key: string) => boolean;
};

const abilityState = Archetypes as unknown as AbilityStateExports;

function requireStateExport<K extends keyof AbilityStateExports>(key: K): NonNullable<AbilityStateExports[K]> {
  const value = abilityState[key];
  expect(value, `${String(key)} must be exported by the shared archetype surface`).toBeTypeOf("function");
  return value as NonNullable<AbilityStateExports[K]>;
}

function getSources(pokemon: Pokemon, active: boolean): readonly AbilitySource[] {
  const methodName = active ? "getActiveAbilitySources" : "getAbilitySources";
  const method = Reflect.get(pokemon, methodName);
  expect(method, `Pokemon.${methodName} must be the centralized ability-source enumerator`).toBeTypeOf("function");
  if (typeof method !== "function") {
    return [];
  }
  return method.call(pokemon) as readonly AbilitySource[];
}

function setTestPassives(pokemon: Pokemon, ids: readonly [AbilityId, AbilityId, AbilityId]): void {
  pokemon.customPokemonData.passive = ids[0];
  pokemon.customPokemonData.passive2 = ids[1];
  pokemon.customPokemonData.passive3 = ids[2];
}

function sourceShape(source: AbilitySource): [AbilityId, boolean, number | undefined] {
  return [source.ability.id, source.passive, source.passiveSlot];
}

describe("centralized ability eligibility and suppression state", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let passiveAttrRestore: { root: SpeciesId; value: number } | undefined;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    passiveAttrRestore = undefined;
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .moveset(MoveId.SPLASH)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .enemyLevel(50);
  });

  afterEach(() => {
    if (passiveAttrRestore) {
      game.scene.gameData.starterData[passiveAttrRestore.root].passiveAttr = passiveAttrRestore.value;
    }
  });

  it("enumerates the active ability first, then each eligible innate slot", async () => {
    game.override.hasPassiveAbility(true);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    setTestPassives(pokemon, [AbilityId.RUN_AWAY, AbilityId.PICKUP, AbilityId.PRESSURE]);

    expect(getSources(pokemon, true).map(sourceShape)).toEqual([
      [AbilityId.BALL_FETCH, false, undefined],
      [AbilityId.RUN_AWAY, true, 0],
      [AbilityId.PICKUP, true, 1],
      [AbilityId.PRESSURE, true, 2],
    ]);
  });

  it("applies the enemy innate level limit through the same source enumeration", async () => {
    game.override.enemyLevel(14);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    setTestPassives(enemy, [AbilityId.RUN_AWAY, AbilityId.PICKUP, AbilityId.PRESSURE]);

    expect(getSources(enemy, true).map(source => source.ability.id)).toEqual([
      AbilityId.BALL_FETCH,
      AbilityId.RUN_AWAY,
    ]);

    enemy.level = 15;
    expect(getSources(enemy, true).map(source => source.ability.id)).toEqual([
      AbilityId.BALL_FETCH,
      AbilityId.RUN_AWAY,
      AbilityId.PICKUP,
    ]);

    enemy.level = 24;
    expect(getSources(enemy, true).map(source => source.ability.id)).toEqual([
      AbilityId.BALL_FETCH,
      AbilityId.RUN_AWAY,
      AbilityId.PICKUP,
      AbilityId.PRESSURE,
    ]);
  });

  it("keeps latent player innates in the raw source list but activates only unlocked slots", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    setTestPassives(pokemon, [AbilityId.RUN_AWAY, AbilityId.PICKUP, AbilityId.PRESSURE]);

    const root = pokemon.species.getRootSpeciesId();
    passiveAttrRestore = { root, value: game.scene.gameData.starterData[root].passiveAttr };
    game.scene.gameData.starterData[root].passiveAttr = 0;

    expect(getSources(pokemon, false).map(source => source.ability.id)).toEqual([
      AbilityId.BALL_FETCH,
      AbilityId.RUN_AWAY,
      AbilityId.PICKUP,
      AbilityId.PRESSURE,
    ]);
    expect(getSources(pokemon, true).map(source => source.ability.id)).toEqual([AbilityId.BALL_FETCH]);

    game.scene.gameData.starterData[root].passiveAttr =
      PassiveAttr.UNLOCKED_1 | PassiveAttr.ENABLED_1 | PassiveAttr.UNLOCKED_3 | PassiveAttr.ENABLED_3;

    expect(getSources(pokemon, true).map(source => source.ability.id)).toEqual([
      AbilityId.BALL_FETCH,
      AbilityId.RUN_AWAY,
      AbilityId.PRESSURE,
    ]);
  });

  it("deduplicates identical ability ids across the active and innate sources", async () => {
    game.override.hasPassiveAbility(true);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    setTestPassives(pokemon, [AbilityId.BALL_FETCH, AbilityId.RUN_AWAY, AbilityId.RUN_AWAY]);

    expect(getSources(pokemon, true).map(sourceShape)).toEqual([
      [AbilityId.BALL_FETCH, false, undefined],
      [AbilityId.RUN_AWAY, true, 1],
    ]);
  });

  it("uses a later duplicate source when the earlier innate slot is suppressed", async () => {
    game.override.hasPassiveAbility(true);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    setTestPassives(pokemon, [AbilityId.RUN_AWAY, AbilityId.RUN_AWAY, AbilityId.PRESSURE]);
    requireStateExport("suppressInnateSlotUntilSwitch")(pokemon, 0);

    expect(getSources(pokemon, true).map(sourceShape)).toEqual([
      [AbilityId.BALL_FETCH, false, undefined],
      [AbilityId.RUN_AWAY, true, 1],
      [AbilityId.PRESSURE, true, 2],
    ]);
    expect(pokemon.hasAbility(AbilityId.RUN_AWAY)).toBe(true);

    const chance = new NumberHolder(1);
    applyAbAttrs("RunSuccessAbAttr", { pokemon, chance });
    expect(chance.value).toBe(256);
  });

  it("removes one suppressed innate slot from every query, attribute, and dispatch path", async () => {
    game.override.hasPassiveAbility(true);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    setTestPassives(pokemon, [AbilityId.RUN_AWAY, AbilityId.PICKUP, AbilityId.PRESSURE]);
    const suppress = requireStateExport("suppressInnateSlotUntilSwitch");
    const isSuppressed = requireStateExport("isInnateSlotSuppressed");

    const before = new NumberHolder(1);
    applyAbAttrs("RunSuccessAbAttr", { pokemon, chance: before });
    expect(before.value).toBe(256);

    suppress(pokemon, 0);

    expect(isSuppressed(pokemon, 0)).toBe(true);
    expect(isSuppressed(pokemon, 1)).toBe(false);
    expect(pokemon.canApplyAbility(true, 0)).toBe(false);
    expect(pokemon.hasAbility(AbilityId.RUN_AWAY)).toBe(false);
    expect(pokemon.hasAbility(AbilityId.PICKUP)).toBe(true);
    expect(pokemon.hasAbilityWithAttr("RunSuccessAbAttr")).toBe(false);
    expect(pokemon.getAbilityAttrs("RunSuccessAbAttr")).toEqual([]);
    expect(pokemon.getAllActiveAbilityAttrs()).not.toContain(pokemon.getPassiveAbilities()[0]?.attrs[0]);
    expect(getSources(pokemon, true).map(source => source.ability.id)).not.toContain(AbilityId.RUN_AWAY);

    const after = new NumberHolder(1);
    applyAbAttrs("RunSuccessAbAttr", { pokemon, chance: after });
    expect(after.value).toBe(1);
  });

  it("round-trips innate-slot suppression with summon data and clears it on switch", async () => {
    game.override.hasPassiveAbility(true);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    const suppress = requireStateExport("suppressInnateSlotUntilSwitch");
    const isSuppressed = requireStateExport("isInnateSlotSuppressed");

    suppress(pokemon, 2);
    const restoredData = new PokemonSummonData(JSON.parse(JSON.stringify(pokemon.summonData)) as PokemonSummonData);
    const restoredPokemon = { summonData: restoredData } as Pokemon;

    expect(isSuppressed(restoredPokemon, 2)).toBe(true);

    restoredPokemon.summonData = new PokemonSummonData();
    expect(isSuppressed(restoredPokemon, 2)).toBe(false);
  });

  it("suppresses one ability id by source until every timed suppression expires", async () => {
    game.override.hasPassiveAbility(true);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    setTestPassives(pokemon, [AbilityId.RUN_AWAY, AbilityId.PICKUP, AbilityId.PRESSURE]);
    const suppress = requireStateExport("suppressAbilityIdForTurns");
    const isSuppressed = requireStateExport("isAbilityIdSuppressed");
    const lapse = requireStateExport("lapseTimedAbilitySuppressions");

    suppress(pokemon, AbilityId.BALL_FETCH, 1, AbilityId.TRACE);
    suppress(pokemon, AbilityId.BALL_FETCH, 2, AbilityId.MUMMY);

    expect(isSuppressed(pokemon, AbilityId.BALL_FETCH)).toBe(true);
    expect(pokemon.hasAbility(AbilityId.BALL_FETCH)).toBe(false);
    expect(pokemon.hasAbility(AbilityId.RUN_AWAY)).toBe(true);

    expect(lapse(pokemon)).toEqual([]);
    expect(isSuppressed(pokemon, AbilityId.BALL_FETCH)).toBe(true);

    expect(lapse(pokemon)).toEqual([AbilityId.BALL_FETCH]);
    expect(isSuppressed(pokemon, AbilityId.BALL_FETCH)).toBe(false);
    expect(pokemon.hasAbility(AbilityId.BALL_FETCH)).toBe(true);
  });

  it("lapses timed ability suppression once per real turn end", async () => {
    game.override.ability(AbilityId.RUN_AWAY);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    const suppress = requireStateExport("suppressAbilityIdForTurns");
    const isSuppressed = requireStateExport("isAbilityIdSuppressed");

    suppress(pokemon, AbilityId.RUN_AWAY, 2, AbilityId.TRACE);
    expect(pokemon.hasAbility(AbilityId.RUN_AWAY)).toBe(false);

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(isSuppressed(pokemon, AbilityId.RUN_AWAY)).toBe(true);
    expect(pokemon.hasAbility(AbilityId.RUN_AWAY)).toBe(false);

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(isSuppressed(pokemon, AbilityId.RUN_AWAY)).toBe(false);
    expect(pokemon.hasAbility(AbilityId.RUN_AWAY)).toBe(true);
  });

  it("resets summon provenance on switch and command provenance on the next command", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    const claimSummon = requireStateExport("claimSummonAbilityProvenance");
    const hasSummon = requireStateExport("hasSummonAbilityProvenance");
    const claimCommand = requireStateExport("claimCommandAbilityProvenance");
    const hasCommand = requireStateExport("hasCommandAbilityProvenance");

    expect(claimSummon(pokemon, "imposter:copied")).toBe(true);
    expect(claimSummon(pokemon, "imposter:copied")).toBe(false);
    expect(hasSummon(pokemon, "imposter:copied")).toBe(true);

    expect(claimCommand(pokemon, "quick-draw:proc")).toBe(true);
    expect(claimCommand(pokemon, "quick-draw:proc")).toBe(false);
    expect(hasCommand(pokemon, "quick-draw:proc")).toBe(true);

    const restoredData = new PokemonSummonData(JSON.parse(JSON.stringify(pokemon.summonData)) as PokemonSummonData);
    const restoredPokemon = { summonData: restoredData } as Pokemon;
    expect(hasSummon(restoredPokemon, "imposter:copied")).toBe(true);

    pokemon.resetTurnData();
    expect(hasCommand(pokemon, "quick-draw:proc")).toBe(false);

    pokemon.summonData = new PokemonSummonData();
    expect(hasSummon(pokemon, "imposter:copied")).toBe(false);
  });
});
