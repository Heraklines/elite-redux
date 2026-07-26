import { allMoves } from "#data/data-lists";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Moves - Beat Up", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({
      type: Phaser.HEADLESS,
    });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyLevel(100)
      .enemyMoveset([MoveId.SPLASH])
      .enemyAbility(AbilityId.INSOMNIA)
      .startingLevel(100)
      .moveset([MoveId.BEAT_UP]);
  });

  it("should hit once for each healthy player Pokemon", async () => {
    await game.classicMode.startBattle(
      SpeciesId.MAGIKARP,
      SpeciesId.BULBASAUR,
      SpeciesId.CHARMANDER,
      SpeciesId.SQUIRTLE,
      SpeciesId.PIKACHU,
      SpeciesId.EEVEE,
    );

    const playerPokemon = game.field.getPlayerPokemon();
    const enemyPokemon = game.field.getEnemyPokemon();
    let enemyStartingHp = enemyPokemon.hp;

    game.move.select(MoveId.BEAT_UP);

    await game.phaseInterceptor.to("MoveEffectPhase");

    expect(playerPokemon.turnData.hitCount).toBe(6);
    expect(enemyPokemon.hp).toBeLessThan(enemyStartingHp);

    while (playerPokemon.turnData.hitsLeft > 0) {
      enemyStartingHp = enemyPokemon.hp;
      await game.phaseInterceptor.to("MoveEffectPhase");
      expect(enemyPokemon.hp).toBeLessThan(enemyStartingHp);
    }
  });

  it("should not count player Pokemon with status effects towards hit count", async () => {
    await game.classicMode.startBattle(
      SpeciesId.MAGIKARP,
      SpeciesId.BULBASAUR,
      SpeciesId.CHARMANDER,
      SpeciesId.SQUIRTLE,
      SpeciesId.PIKACHU,
      SpeciesId.EEVEE,
    );

    const playerPokemon = game.field.getPlayerPokemon();

    game.scene.getPlayerParty()[1].doSetStatus(StatusEffect.BURN);

    game.move.select(MoveId.BEAT_UP);

    await game.phaseInterceptor.to("MoveEffectPhase");

    expect(playerPokemon.turnData.hitCount).toBe(5);
  });

  it("should not count fainted player Pokemon towards hit count", async () => {
    await game.classicMode.startBattle(
      SpeciesId.MAGIKARP,
      SpeciesId.BULBASAUR,
      SpeciesId.CHARMANDER,
      SpeciesId.SQUIRTLE,
    );

    const playerPokemon = game.field.getPlayerPokemon();
    game.scene.getPlayerParty()[1].hp = 0;

    game.move.select(MoveId.BEAT_UP);
    await game.phaseInterceptor.to("MoveEffectPhase");

    expect(playerPokemon.turnData.hitCount).toBe(3);
  });

  it("should use each eligible contributor once and floor its base Attack power", async () => {
    await game.classicMode.startBattle(
      SpeciesId.MAGIKARP,
      SpeciesId.BULBASAUR,
      SpeciesId.CHARMANDER,
      SpeciesId.SQUIRTLE,
    );

    const playerPokemon = game.field.getPlayerPokemon();
    const enemyPokemon = game.field.getEnemyPokemon();
    game.scene.getPlayerParty()[1].doSetStatus(StatusEffect.BURN);

    const beatUp = allMoves[MoveId.BEAT_UP];
    const beatUpAttr = beatUp.getAttrs("BeatUpAttr")[0];
    const powers: number[] = [];
    playerPokemon.turnData.hitCount = 3;

    for (const hitsLeft of [3, 2, 1]) {
      playerPokemon.turnData.hitsLeft = hitsLeft;
      const power = new NumberHolder(beatUp.power);
      beatUpAttr.apply(playerPokemon, enemyPokemon, beatUp, [power]);
      powers.push(power.value);

      if (hitsLeft === 3) {
        // Eligibility is snapshotted when the move starts, as in mainline.
        game.scene.getPlayerParty()[2].doSetStatus(StatusEffect.BURN);
        game.scene.getPlayerParty()[3].hp = 0;
      }
    }

    // Magikarp (10 Atk), Charmander (52 Atk), Squirtle (48 Atk).
    expect(powers).toEqual([6, 10, 9]);
  });
});
