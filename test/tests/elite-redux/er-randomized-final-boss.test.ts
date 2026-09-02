import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { StatusEffect } from "#enums/status-effect";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("ER randomized final-boss progression", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setErDifficulty("ace");
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingWave(200)
      .startingLevel(100)
      .enemyLevel(100)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .criticalHits(false);
  });

  afterEach(() => setErDifficulty("ace"));

  it.each([
    SpeciesId.SHUCKLE,
    SpeciesId.CASTFORM,
    SpeciesId.DITTO,
  ])("allows replacement species %s to take damage and be defeated without a phase-two loop", async species => {
    game.override.enemySpecies(species);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.species.speciesId).toBe(species);
    // Also represents reloading an older randomized finale after updating.
    vi.spyOn(game.scene.currentBattle, "isClassicFinalBoss", "get").mockReturnValue(true);
    enemy.setBoss(true, 3);
    enemy.bossSegmentIndex = 0;
    enemy.hp = Math.floor(enemy.getMaxHp() / 3);
    const hp = enemy.hp;
    const dialogue = vi.spyOn(game.scene.ui, "showDialogue");

    game.move.select(MoveId.TACKLE);
    await game.toNextTurn();
    expect(enemy.hp).toBeLessThan(hp);
    expect(enemy.isFainted()).toBe(false);
    expect(dialogue).not.toHaveBeenCalled();
    expect(enemy.bossSegmentIndex).toBe(0);

    enemy.hp = 1;
    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("VictoryPhase", false);
    expect(enemy.isFainted()).toBe(true);
    expect(dialogue).not.toHaveBeenCalled();
  });

  it("allows residual damage to finish on a randomized boss across consecutive turns", async () => {
    game.override.enemySpecies(SpeciesId.SHUCKLE);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const enemy = game.field.getEnemyPokemon();
    vi.spyOn(game.scene.currentBattle, "isClassicFinalBoss", "get").mockReturnValue(true);
    enemy.setBoss(true, 3);
    enemy.bossSegmentIndex = 0;
    enemy.hp = Math.floor(enemy.getMaxHp() / 3);
    enemy.trySetStatus(StatusEffect.BURN);
    const dialogue = vi.spyOn(game.scene.ui, "showDialogue");
    const hp = enemy.hp;

    for (let turn = 0; turn < 2; turn++) {
      game.move.select(MoveId.SPLASH);
      await game.toNextTurn();
    }

    expect(enemy.hp).toBeLessThan(hp);
    expect(dialogue).not.toHaveBeenCalled();
    expect(enemy.bossSegmentIndex).toBe(0);
  });

  it("still transforms the real Eternatus finale and heals its second phase", async () => {
    game.override.enemySpecies(SpeciesId.ETERNATUS);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.species.speciesId).toBe(SpeciesId.ETERNATUS);
    vi.spyOn(game.scene.currentBattle, "isClassicFinalBoss", "get").mockReturnValue(true);
    enemy.formIndex = 0;
    enemy.setBoss(true, 2);
    enemy.bossSegmentIndex = 0;
    enemy.hp = 1;

    game.scene.initFinalBossPhaseTwo(enemy);
    await game.phaseInterceptor.to("PokemonHealPhase");

    expect(enemy.formIndex).toBe(1);
    expect(enemy.hp).toBe(enemy.getMaxHp());
    expect(enemy.bossSegments).toBe(5);
    expect(enemy.bossSegmentIndex).toBe(4);
  });
});
