/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { type AbAttr, FetchBallAbAttr } from "#abilities/ab-attrs";
import { allAbilities } from "#data/data-lists";
import {
  BallRecoveryAbAttr,
  BiomeRevealBonusAbAttr,
  EncounterTypeWeightAbAttr,
  ExperienceGainMultiplierAbAttr,
  MoneyGainMultiplierAbAttr,
  suppressAbilityIdForTurns,
} from "#data/elite-redux/ability-upgrades/attrs/index";
import {
  recoverUsedPokeballsAfterBattle,
  snapshotBattleMoneyGainMultiplier,
} from "#data/elite-redux/archetypes/ability-meta-consumers";
import * as Archetypes from "#data/elite-redux/archetypes/index";
import { rollErNextBiomeNodes } from "#data/elite-redux/er-biome-routing";
import { ER_ID_MAP } from "#data/elite-redux/er-id-map";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { BiomeId } from "#enums/biome-id";
import { MoveId } from "#enums/move-id";
import { PokeballType } from "#enums/pokeball";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { BattleEndPhase } from "#phases/battle-end-phase";
import { ExpPhase } from "#phases/exp-phase";
import { MoneyRewardPhase } from "#phases/money-reward-phase";
import { ShowPartyExpBarPhase } from "#phases/show-party-exp-bar-phase";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

type MetaConsumerExports = {
  getEncounterSpeciesWeightMultiplier?: (species: ReturnType<typeof getPokemonSpecies>) => number;
};

const metaConsumers = Archetypes as unknown as MetaConsumerExports;

function requireMetaConsumer<K extends keyof MetaConsumerExports>(key: K): NonNullable<MetaConsumerExports[K]> {
  const value = metaConsumers[key];
  expect(value, `${String(key)} must be exported by the shared archetype surface`).toBeTypeOf("function");
  return value as NonNullable<MetaConsumerExports[K]>;
}

function markerAttrs<T extends AbAttr>(abilityId: number, attrType: abstract new (...args: never[]) => T): T[] {
  const ability = allAbilities[abilityId];
  expect(ability, `ability ${abilityId} must resolve`).toBeDefined();
  const matches: T[] = [];
  for (const attr of ability?.attrs ?? []) {
    if (attr instanceof attrType) {
      matches.push(attr);
    }
  }
  return matches;
}

function setTestPassives(pokemon: Pokemon, ids: readonly [AbilityId, AbilityId, AbilityId]): void {
  pokemon.customPokemonData.passive = ids[0];
  pokemon.customPokemonData.passive2 = ids[1];
  pokemon.customPokemonData.passive3 = ids[2];
}

function erAbilityId(draftId: number): number {
  const abilityId = ER_ID_MAP.abilities[draftId];
  expect(abilityId, `ER draft ability ${draftId} must resolve`).toBeDefined();
  return abilityId!;
}

function routeSeedWithAtLeast(current: BiomeId, count: number): string {
  for (let i = 0; i < 100; i++) {
    const seed = `meta-route-${i}`;
    if (rollErNextBiomeNodes(current, null, seed, 1).length >= count) {
      return seed;
    }
  }
  throw new Error(`No deterministic route seed produced at least ${count} nodes`);
}

describe("deferred ability meta consumers", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .moveset(MoveId.SPLASH)
      .enemyMoveset(MoveId.SPLASH)
      .enemySpecies(SpeciesId.MAGIKARP)
      .startingLevel(50)
      .enemyLevel(50);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("wires the requested vanilla and ER marker producers exactly once", () => {
    expect(markerAttrs(AbilityId.ANTICIPATION, BiomeRevealBonusAbAttr).map(attr => attr.getCount())).toEqual([1]);
    expect(markerAttrs(AbilityId.WANDERING_SPIRIT, BiomeRevealBonusAbAttr).map(attr => attr.getCount())).toEqual([1]);
    expect(markerAttrs(AbilityId.SUPER_LUCK, ExperienceGainMultiplierAbAttr).map(attr => attr.getMultiplier())).toEqual(
      [1.2],
    );
    expect(markerAttrs(erAbilityId(850), ExperienceGainMultiplierAbAttr).map(attr => attr.getMultiplier())).toEqual([
      1.2,
    ]);
    expect(markerAttrs(AbilityId.GOOD_AS_GOLD, MoneyGainMultiplierAbAttr).map(attr => attr.getMultiplier())).toEqual([
      1.2,
    ]);
    expect(markerAttrs(AbilityId.BALL_FETCH, BallRecoveryAbAttr).map(attr => attr.getRecoverableBalls())).toEqual([
      [PokeballType.POKEBALL, PokeballType.GREAT_BALL],
    ]);
    expect(allAbilities[AbilityId.BALL_FETCH].attrs.some(attr => attr instanceof FetchBallAbAttr)).toBe(false);
  });

  it("reveals one extra biome for one eligible Anticipation source and honors suppression", async () => {
    game.override.ability(AbilityId.ANTICIPATION).hasPassiveAbility(true);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    setTestPassives(pokemon, [AbilityId.ANTICIPATION, AbilityId.PICKUP, AbilityId.PRESSURE]);
    const seed = routeSeedWithAtLeast(BiomeId.PLAINS, 4);

    pokemon.summonData.abilitySuppressed = true;
    const suppressedCount = rollErNextBiomeNodes(BiomeId.PLAINS, null, seed, 1).filter(node => node.revealed).length;

    pokemon.summonData.abilitySuppressed = false;
    const eligibleCount = rollErNextBiomeNodes(BiomeId.PLAINS, null, seed, 1).filter(node => node.revealed).length;

    expect(eligibleCount).toBe(suppressedCount + 1);
  });

  it("weights matching encounter species once per eligible deduplicated source", async () => {
    game.override.ability(AbilityId.BALL_FETCH).hasPassiveAbility(true);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    setTestPassives(pokemon, [AbilityId.BALL_FETCH, AbilityId.PICKUP, AbilityId.PRESSURE]);
    const ability = allAbilities[AbilityId.BALL_FETCH];
    const attrs = (ability as unknown as { attrs: AbAttr[] }).attrs;
    const marker = new EncounterTypeWeightAbAttr(PokemonType.FAIRY, 2);
    attrs.push(marker);

    try {
      const getWeight = requireMetaConsumer("getEncounterSpeciesWeightMultiplier");
      expect(getWeight(getPokemonSpecies(SpeciesId.SYLVEON))).toBe(2);
      expect(getWeight(getPokemonSpecies(SpeciesId.SNORLAX))).toBe(1);

      pokemon.summonData.abilitySuppressed = true;
      expect(getWeight(getPokemonSpecies(SpeciesId.SYLVEON))).toBe(1);
    } finally {
      attrs.splice(attrs.indexOf(marker), 1);
    }
  });

  it("multiplies only the eligible holder's experience once across duplicate sources", async () => {
    game.override.ability(AbilityId.SUPER_LUCK).hasPassiveAbility(true);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    setTestPassives(pokemon, [AbilityId.SUPER_LUCK, AbilityId.PICKUP, AbilityId.PRESSURE]);
    const addExp = vi.spyOn(pokemon, "addExp");

    new ExpPhase(0, 100).start();

    expect(addExp).toHaveBeenCalledWith(120);
  });

  it("multiplies experience for an eligible holder receiving bench experience", async () => {
    game.override.ability(AbilityId.SUPER_LUCK);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU);
    const pokemon = game.scene.getPlayerParty()[1];
    expect(pokemon.isOnField()).toBe(false);
    const addExp = vi.spyOn(pokemon, "addExp");

    new ShowPartyExpBarPhase(1, 100).start();

    expect(addExp).toHaveBeenCalledWith(120);
  });

  it("does not multiply experience while the holder's ability is suppressed", async () => {
    game.override.ability(AbilityId.SUPER_LUCK);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    pokemon.summonData.abilitySuppressed = true;
    const addExp = vi.spyOn(pokemon, "addExp");

    new ExpPhase(0, 100).start();

    expect(addExp).toHaveBeenCalledWith(100);
  });

  it("captures Good as Gold only from an eligible active holder at battle end", async () => {
    game.override.ability(AbilityId.GOOD_AS_GOLD);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    const basePayout = game.scene.getWaveMoneyAmount(1);
    const addMoney = vi.spyOn(game.scene, "addMoney");

    new MoneyRewardPhase(1).start();
    expect(addMoney).toHaveBeenLastCalledWith(basePayout);

    snapshotBattleMoneyGainMultiplier();
    pokemon.summonData.abilitySuppressed = true;
    new MoneyRewardPhase(1).start();
    expect(addMoney).toHaveBeenLastCalledWith(Math.floor(basePayout * 1.2));
  });

  it("does not capture Good as Gold while the active holder is suppressed", async () => {
    game.override.ability(AbilityId.GOOD_AS_GOLD);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    const basePayout = game.scene.getWaveMoneyAmount(1);
    const addMoney = vi.spyOn(game.scene, "addMoney");

    pokemon.summonData.abilitySuppressed = true;
    snapshotBattleMoneyGainMultiplier();
    new MoneyRewardPhase(1).start();
    expect(addMoney).toHaveBeenLastCalledWith(basePayout);
  });

  it("applies the captured Good as Gold multiplier to scattered battle money", async () => {
    game.override.ability(AbilityId.GOOD_AS_GOLD);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const pokemon = game.field.getPlayerPokemon();
    const addMoney = vi.spyOn(game.scene, "addMoney");

    game.scene.currentBattle.moneyScattered = 100;
    snapshotBattleMoneyGainMultiplier();
    pokemon.summonData.abilitySuppressed = true;
    game.scene.currentBattle.pickUpScatteredMoney();

    expect(addMoney).toHaveBeenLastCalledWith(120);
  });

  it("recovers every used Poke Ball and Great Ball once after battle, but no higher-tier balls", async () => {
    game.override.ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const battle = game.scene.currentBattle;
    const recordUsedPokeball = Reflect.get(battle, "recordUsedPokeball");
    expect(recordUsedPokeball, "Battle.recordUsedPokeball must track every throw in this battle").toBeTypeOf(
      "function",
    );
    if (typeof recordUsedPokeball !== "function") {
      return;
    }

    recordUsedPokeball.call(battle, PokeballType.POKEBALL);
    recordUsedPokeball.call(battle, PokeballType.POKEBALL);
    recordUsedPokeball.call(battle, PokeballType.GREAT_BALL);
    recordUsedPokeball.call(battle, PokeballType.ULTRA_BALL);
    recordUsedPokeball.call(battle, PokeballType.MASTER_BALL);
    game.scene.pokeballCounts[PokeballType.POKEBALL] = 10;
    game.scene.pokeballCounts[PokeballType.GREAT_BALL] = 10;
    game.scene.pokeballCounts[PokeballType.ULTRA_BALL] = 10;
    game.scene.pokeballCounts[PokeballType.MASTER_BALL] = 10;

    new BattleEndPhase(true).start();

    expect(game.scene.pokeballCounts[PokeballType.POKEBALL]).toBe(12);
    expect(game.scene.pokeballCounts[PokeballType.GREAT_BALL]).toBe(11);
    expect(game.scene.pokeballCounts[PokeballType.ULTRA_BALL]).toBe(10);
    expect(game.scene.pokeballCounts[PokeballType.MASTER_BALL]).toBe(10);
  });

  it("recovers used balls when the Ball Fetch holder is benched", async () => {
    game.override.ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.PIKACHU);
    const active = game.scene.getPlayerParty()[0];
    active.setTempAbility(allAbilities[AbilityId.PICKUP]);
    const battle = game.scene.currentBattle;
    Reflect.get(battle, "recordUsedPokeball").call(battle, PokeballType.POKEBALL);
    game.scene.pokeballCounts[PokeballType.POKEBALL] = 2;

    recoverUsedPokeballsAfterBattle();

    expect(game.scene.getPlayerParty()[1].isOnField()).toBe(false);
    expect(game.scene.pokeballCounts[PokeballType.POKEBALL]).toBe(3);
  });

  it("recovers used balls when the Ball Fetch holder fainted", async () => {
    game.override.ability(AbilityId.BALL_FETCH);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const holder = game.field.getPlayerPokemon();
    const battle = game.scene.currentBattle;
    Reflect.get(battle, "recordUsedPokeball").call(battle, PokeballType.GREAT_BALL);
    game.scene.pokeballCounts[PokeballType.GREAT_BALL] = 2;
    holder.hp = 0;

    recoverUsedPokeballsAfterBattle();

    expect(holder.isFainted()).toBe(true);
    expect(game.scene.pokeballCounts[PokeballType.GREAT_BALL]).toBe(3);
  });

  it("freezes Toxic Terrain only while an eligible Stench holder is active", async () => {
    game.override.ability(AbilityId.STENCH).startingTerrain(TerrainType.TOXIC);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const terrain = game.scene.arena.terrain;
    const pokemon = game.field.getPlayerPokemon();
    expect(terrain?.terrainType).toBe(TerrainType.TOXIC);
    if (terrain) {
      terrain.turnsLeft = 3;
      terrain.maxDuration = 3;
    }
    const initialTurns = terrain?.turnsLeft ?? 0;

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(terrain?.turnsLeft).toBe(initialTurns);

    pokemon.summonData.abilitySuppressed = true;
    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();
    expect(terrain?.turnsLeft).toBe(initialTurns - 1);
  });

  it("keeps Stench suppressed through the terrain lapse on its final suppressed turn", async () => {
    game.override.ability(AbilityId.STENCH).startingTerrain(TerrainType.TOXIC);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const terrain = game.scene.arena.terrain;
    const pokemon = game.field.getPlayerPokemon();
    expect(terrain?.terrainType).toBe(TerrainType.TOXIC);
    if (terrain) {
      terrain.turnsLeft = 3;
      terrain.maxDuration = 3;
    }
    const initialTurns = terrain?.turnsLeft ?? 0;
    suppressAbilityIdForTurns(pokemon, AbilityId.STENCH, 1, AbilityId.BALL_FETCH);
    expect(pokemon.hasAbility(AbilityId.STENCH)).toBe(false);

    game.move.use(MoveId.SPLASH);
    await game.toEndOfTurn();

    expect(terrain?.turnsLeft).toBe(initialTurns - 1);
    expect(pokemon.hasAbility(AbilityId.STENCH)).toBe(true);
  });

  it("blocks Toxic Terrain replacement and clearing while Stench is eligible", async () => {
    game.override.ability(AbilityId.STENCH).startingTerrain(TerrainType.TOXIC);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);

    expect(game.scene.arena.trySetTerrain(TerrainType.GRASSY, true)).toBe(false);
    expect(game.scene.arena.trySetTerrain(TerrainType.NONE, true)).toBe(false);
    expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.TOXIC);
  });

  it("allows Toxic Terrain replacement once Stench is suppressed", async () => {
    game.override.ability(AbilityId.STENCH).startingTerrain(TerrainType.TOXIC);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    game.field.getPlayerPokemon().summonData.abilitySuppressed = true;

    expect(game.scene.arena.trySetTerrain(TerrainType.GRASSY, true)).toBe(true);
    expect(game.scene.arena.terrain?.terrainType).toBe(TerrainType.GRASSY);
  });
});
