import { applyAbAttrs } from "#abilities/apply-ab-attrs";
import { allAbilities, allMoves } from "#data/data-lists";
import { claimCommandAbilityProvenance } from "#data/elite-redux/ability-upgrades/attrs/index";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { NumberHolder } from "#utils/common";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

describe("Abilities - Quick Draw", () => {
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
      .ability(AbilityId.QUICK_DRAW)
      .moveset([MoveId.TACKLE, MoveId.TAIL_WHIP])
      .enemyLevel(100)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset([MoveId.TACKLE]);

    vi.spyOn(
      allAbilities[AbilityId.QUICK_DRAW].getAttrs("BypassSpeedChanceAbAttr")[0],
      "chance",
      "get",
    ).mockReturnValue(100);
  });

  it("makes pokemon go first in its priority bracket", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const pokemon = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    pokemon.hp = 1;
    enemy.hp = 1;

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("FaintPhase", false);

    expect(pokemon.isFainted()).toBe(false);
    expect(enemy.isFainted()).toBe(true);
    expect(pokemon.waveData.abilitiesApplied).toContain(AbilityId.QUICK_DRAW);
  });

  it("is not triggered by non damaging moves", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const pokemon = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    pokemon.hp = 1;
    enemy.hp = 1;

    game.move.select(MoveId.TAIL_WHIP);
    await game.phaseInterceptor.to("FaintPhase", false);

    expect(pokemon.isFainted()).toBe(true);
    expect(enemy.isFainted()).toBe(false);
    expect(pokemon.waveData.abilitiesApplied).not.toContain(AbilityId.QUICK_DRAW);
  });

  it("does not increase priority", async () => {
    game.override.enemyMoveset([MoveId.EXTREME_SPEED]);

    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    const pokemon = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    pokemon.hp = 1;
    enemy.hp = 1;

    game.move.select(MoveId.TACKLE);
    await game.phaseInterceptor.to("FaintPhase", false);

    expect(pokemon.isFainted()).toBe(true);
    expect(enemy.isFainted()).toBe(false);
    expect(pokemon.waveData.abilitiesApplied).toContain(AbilityId.QUICK_DRAW);
  });

  it("doubles a procced attack only against another eligible Quick Draw holder", async () => {
    game.override.enemyAbility(AbilityId.QUICK_DRAW);
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const pokemon = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();
    const power = new NumberHolder(40);

    claimCommandAbilityProvenance(pokemon, "quick-draw:proc");
    applyAbAttrs("MovePowerBoostAbAttr", {
      pokemon,
      opponent: enemy,
      move: allMoves[MoveId.TACKLE],
      power,
    });

    expect(power.value).toBe(80);
    enemy.summonData.abilitySuppressed = true;
    power.value = 40;
    applyAbAttrs("MovePowerBoostAbAttr", {
      pokemon,
      opponent: enemy,
      move: allMoves[MoveId.TACKLE],
      power,
    });
    expect(power.value).toBe(40);
  });
});
