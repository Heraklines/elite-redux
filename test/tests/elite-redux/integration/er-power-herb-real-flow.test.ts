/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
// Live report (#406 follow-up): "power herb doesnt work properly, just works
// endlessly, doesnt deplete". The unit test called erTryConsumePowerHerb
// directly - this one drives the REAL battle flow (shop-built modifier, real
// MoveChargePhase via Solar Beam) and the session save/load round-trip.
// Gated behind ER_SCENARIO=1.
import { globalScene } from "#app/global-scene";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { ErCommunityItemModifier } from "#modifiers/modifier";
import { erCommunityItemModifierType } from "#modifiers/modifier-type";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Power Herb real battle flow (#406 live report)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .enemySpecies(SpeciesId.CHANSEY)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SOFT_BOILED)
      .enemyLevel(100)
      .startingLevel(50)
      .moveset([MoveId.SOLAR_BEAM]);
  });

  it("depletes one charge per skipped charge turn in REAL battles, then stops skipping at 0", async () => {
    await game.classicMode.startBattle(SpeciesId.VENUSAUR);
    const player = game.scene.getPlayerPokemon()!;
    const enemy = game.scene.getEnemyPokemon()!;

    const herb = erCommunityItemModifierType("powerHerb").newModifier(player) as ErCommunityItemModifier;
    globalScene.addModifier(herb, true);
    expect(herb.charges).toBe(2);

    // Turn 1: Solar Beam fires the SAME turn (herb skip), one charge spent.
    game.move.use(MoveId.SOLAR_BEAM);
    await game.toEndOfTurn();
    expect(enemy.getInverseHp()).toBeGreaterThan(0);
    expect(herb.charges).toBe(1);

    // Turn 2: second skip, herb empty.
    enemy.hp = enemy.getMaxHp();
    game.move.use(MoveId.SOLAR_BEAM);
    await game.toEndOfTurn();
    expect(enemy.getInverseHp()).toBeGreaterThan(0);
    expect(herb.charges).toBe(0);

    // Turn 3: NO skip left - this turn only charges up (no damage dealt).
    enemy.hp = enemy.getMaxHp();
    game.move.use(MoveId.SOLAR_BEAM);
    await game.toEndOfTurn();
    expect(enemy.getInverseHp()).toBe(0);
    expect(herb.charges).toBe(0);
  });

  it("charges survive the session save/load round-trip exactly as spent", async () => {
    await game.classicMode.startBattle(SpeciesId.VENUSAUR);
    const player = game.scene.getPlayerPokemon()!;
    const herb = erCommunityItemModifierType("powerHerb").newModifier(player) as ErCommunityItemModifier;
    herb.charges = 1;
    herb.waveProgress = 4;

    // The session loader does Reflect.construct(ctor, [type, ...args, stackCount]).
    const rebuilt = Reflect.construct(ErCommunityItemModifier, [
      herb.type,
      ...herb.getArgs(),
      herb.stackCount,
    ]) as ErCommunityItemModifier;
    expect(rebuilt.kind).toBe("powerHerb");
    expect(rebuilt.charges).toBe(1);
    expect(rebuilt.waveProgress).toBe(4);
  });
});
