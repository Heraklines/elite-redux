import { ER_DRACONIC_VOODOO_ABILITY_ID } from "#data/elite-redux/abilities/draconic-voodoo";
import { clearGrafts, getGraftedTypes } from "#data/elite-redux/abilities/type-graft";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const DRACONIC_VOODOO = ER_DRACONIC_VOODOO_ABILITY_ID as AbilityId;

describe.skipIf(!RUN)("ER Draconic Voodoo (5930)", () => {
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
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(DRACONIC_VOODOO)
      .moveset([MoveId.BITE, MoveId.SPLASH]);
  });

  it("grafts Dragon onto the opponent directly across on entry (never Dragon before)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();

    // Snorlax is pure Normal; Draconic Voodoo added Dragon as an ADDITIONAL type.
    expect(enemy.isOfType(PokemonType.DRAGON)).toBe(true);
    expect(enemy.isOfType(PokemonType.NORMAL)).toBe(true);
    expect(enemy.getTypes()).toContain(PokemonType.DRAGON);
  });

  it("the graft persists across the target's summon-data reset (switch-out/in)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();
    expect(enemy.isOfType(PokemonType.DRAGON)).toBe(true);

    // A switch-out resets summonData; the graft substrate keys on the instance +
    // wave, so it survives.
    enemy.resetSummonData();
    expect(enemy.isOfType(PokemonType.DRAGON)).toBe(true);
  });

  it("on-hit: a biting move grafts Dragon onto the struck target", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();

    // Isolate the on-hit path: remove the entry graft first.
    clearGrafts(enemy);
    expect(enemy.isOfType(PokemonType.DRAGON)).toBe(false);

    game.move.select(MoveId.BITE);
    await game.toEndOfTurn();

    // Bite is a biting move -> the on-hit half re-grafts Dragon.
    expect(enemy.isOfType(PokemonType.DRAGON)).toBe(true);
  });

  it("does nothing to a target that is already Dragon-typed", async () => {
    game.override.enemySpecies(SpeciesId.DRATINI); // pure Dragon
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
    const enemy = game.field.getEnemyPokemon();

    // Already Dragon: no graft is applied at all (set semantics are a no-op).
    expect(enemy.isOfType(PokemonType.DRAGON)).toBe(true);
    expect(getGraftedTypes(enemy)).toHaveLength(0);
  });
});
