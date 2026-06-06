import { SpeciesFormChangeAbilityTrigger } from "#data/form-change-triggers";
import { pokemonFormChanges, SpeciesFormChange } from "#data/pokemon-forms";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Regression: the Battle Bond ability must perform its KO form change for ANY
 * species that has a {@linkcode SpeciesFormChangeAbilityTrigger} form change
 * registered — not only Greninja. Elite Redux relies on this for Battle-Bond
 * builds such as Darmanitan Redux Bond -> Blunder.
 *
 * We exercise the generalized code path with a synthetic Battle Bond form
 * change registered on a multi-form species (Deoxys: normal -> attack), then
 * clean it up. The species choice is incidental; the point is that a
 * non-Greninja Battle Bond user transitions on a KO when, and only when, it has
 * a Battle Bond form change available.
 */
describe("ER - Battle Bond generic form change", () => {
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
      .ability(AbilityId.BATTLE_BOND)
      .startingLevel(100)
      .enemyLevel(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH);
  });

  afterEach(() => {
    // Remove any synthetic Battle Bond form change we registered on Deoxys so we
    // do not leak state into other tests.
    const fcs = pokemonFormChanges[SpeciesId.DEOXYS] as SpeciesFormChange[] | undefined;
    if (fcs) {
      for (let i = fcs.length - 1; i >= 0; i--) {
        if (fcs[i].preFormKey === "normal" && fcs[i].formKey === "attack") {
          fcs.splice(i, 1);
        }
      }
    }
  });

  it("transforms a non-Greninja Battle Bond user into its bonded form on a KO", async () => {
    // Register a Battle Bond ability-trigger form change: normal -> attack.
    if (!pokemonFormChanges[SpeciesId.DEOXYS]) {
      (pokemonFormChanges as Record<number, SpeciesFormChange[]>)[SpeciesId.DEOXYS] = [];
    }
    (pokemonFormChanges[SpeciesId.DEOXYS] as SpeciesFormChange[]).push(
      new SpeciesFormChange(SpeciesId.DEOXYS, "normal", "attack", new SpeciesFormChangeAbilityTrigger(), true),
    );

    await game.classicMode.startBattle(SpeciesId.DEOXYS);

    const player = game.field.getPlayerPokemon();
    expect(player.getFormKey()).toBe("normal");

    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    // Battle Bond should have transitioned Deoxys into its "attack" form on KO.
    expect(player.getFormKey()).toBe("attack");
  });

  it("still grants the stat boost to a Battle Bond user with no form change", async () => {
    await game.classicMode.startBattle(SpeciesId.MILOTIC);

    const player = game.field.getPlayerPokemon();
    game.move.use(MoveId.TACKLE);
    await game.toEndOfTurn();

    // No form change exists for Milotic, so the vanilla stat-boost branch applies.
    expect(player).toHaveStatStage(Stat.ATK, 1);
    expect(player).toHaveStatStage(Stat.SPATK, 1);
    expect(player).toHaveStatStage(Stat.SPD, 1);
  });
});
