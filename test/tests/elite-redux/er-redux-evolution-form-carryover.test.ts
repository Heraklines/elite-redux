import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { AbilityId } from "#enums/ability-id";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Regression: a Redux-form Krabby (formIndex 1 = "redux") that evolves into
 * Kingler via the plain level-up evolution (preFormKey/evoFormKey both null)
 * must NOT carry its form index over onto Kingler's mismatched form layout.
 *
 * KRABBY forms : [0:"", 1:"redux"]
 * KINGLER forms: [0:"", 1:"gigantamax", 2:"mega", 3:"redux"]
 *
 * Before the fix, the carried-over formIndex 1 landed on Kingler's
 * "gigantamax" form — a transient battle-only form that should never be an
 * evolution destination (and whose cross-origin sprite crashed EvolutionPhase).
 */
describe("ER - Redux evolution form carryover", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  const BATTLE_ONLY_FORM_KEYS: string[] = [
    SpeciesFormKey.MEGA,
    SpeciesFormKey.MEGA_X,
    SpeciesFormKey.MEGA_Y,
    SpeciesFormKey.PRIMAL,
    SpeciesFormKey.GIGANTAMAX,
    SpeciesFormKey.GIGANTAMAX_SINGLE,
    SpeciesFormKey.GIGANTAMAX_RAPID,
    SpeciesFormKey.ETERNAMAX,
  ];

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyAbility(AbilityId.BALL_FETCH)
      .startingLevel(60);
  });

  it("Redux Krabby must not evolve into a Gigantamax Kingler form", async () => {
    await game.classicMode.runToSummon(SpeciesId.KRABBY);

    const krabby = game.field.getPlayerPokemon();
    // Put Krabby into its Redux form (formIndex 1).
    krabby.formIndex = 1;
    expect(krabby.getSpeciesForm().formKey).toBe("redux");

    await krabby.evolve(pokemonEvolutions[SpeciesId.KRABBY][0], krabby.getSpeciesForm());

    expect(krabby.species.speciesId).toBe(SpeciesId.KINGLER);
    const evolvedFormKey = krabby.getSpeciesForm().formKey;
    expect(BATTLE_ONLY_FORM_KEYS).not.toContain(evolvedFormKey);
  });

  it("base-form Krabby evolves into base-form Kingler", async () => {
    await game.classicMode.runToSummon(SpeciesId.KRABBY);

    const krabby = game.field.getPlayerPokemon();
    krabby.formIndex = 0;

    await krabby.evolve(pokemonEvolutions[SpeciesId.KRABBY][0], krabby.getSpeciesForm());

    expect(krabby.species.speciesId).toBe(SpeciesId.KINGLER);
    expect(krabby.getSpeciesForm().formKey).toBe("");
  });
});
