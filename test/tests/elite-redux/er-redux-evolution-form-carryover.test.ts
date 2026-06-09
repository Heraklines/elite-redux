import { pokemonEvolutions } from "#balance/pokemon-evolutions";
import { AbilityId } from "#enums/ability-id";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

/**
 * Regression (#325): a Redux-form Pokémon must KEEP its Redux form across a plain
 * level-up evolution (preFormKey/evoFormKey both null) — e.g. Kadabra-Redux →
 * Alakazam-Redux, Krabby-Redux → Kingler-Redux — NOT revert to the base form.
 *
 * The real EvolutionPhase calls `evolve(evolution, this.pokemon.species)` — i.e.
 * it passes a *PokemonSpecies* (which has no `formKey`) as `preEvolution`. The
 * old code derived the carry key from `preEvolution.formKey` → undefined → "" →
 * the Redux form was dropped to base (even though the evolution PREVIEW, which
 * reads `getFormKey()`, showed the correct Redux sprite). The fix captures the
 * live `getFormKey()` inside `evolve()` before mutating, so the form carries.
 *
 * These tests reproduce the real caller path (passing `.species`, not the form).
 */
describe("ER - Redux evolution form carryover (#325)", () => {
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

  it("Kadabra-Redux evolves into Alakazam-REDUX (real species-passing caller)", async () => {
    await game.classicMode.runToSummon(SpeciesId.KADABRA);
    const kadabra = game.field.getPlayerPokemon();
    const reduxIdx = kadabra.species.forms.findIndex(f => f.formKey === "redux");
    expect(reduxIdx, "Kadabra has a Redux form").toBeGreaterThan(0);
    kadabra.formIndex = reduxIdx;
    expect(kadabra.getSpeciesForm().formKey).toBe("redux");

    // Pass `.species` — exactly what EvolutionPhase does (the buggy path).
    await kadabra.evolve(pokemonEvolutions[SpeciesId.KADABRA][0], kadabra.species);

    expect(kadabra.species.speciesId).toBe(SpeciesId.ALAKAZAM);
    expect(kadabra.getSpeciesForm().formKey).toBe("redux");
  });

  it("Redux Krabby keeps Redux (not Gigantamax, not base) into Kingler", async () => {
    await game.classicMode.runToSummon(SpeciesId.KRABBY);
    const krabby = game.field.getPlayerPokemon();
    const reduxIdx = krabby.species.forms.findIndex(f => f.formKey === "redux");
    expect(reduxIdx, "Krabby has a Redux form").toBeGreaterThan(0);
    krabby.formIndex = reduxIdx;

    await krabby.evolve(pokemonEvolutions[SpeciesId.KRABBY][0], krabby.species);

    expect(krabby.species.speciesId).toBe(SpeciesId.KINGLER);
    const evolvedFormKey = krabby.getSpeciesForm().formKey;
    expect(BATTLE_ONLY_FORM_KEYS).not.toContain(evolvedFormKey);
    expect(evolvedFormKey).toBe("redux");
  });

  it("base-form Krabby evolves into base-form Kingler", async () => {
    await game.classicMode.runToSummon(SpeciesId.KRABBY);
    const krabby = game.field.getPlayerPokemon();
    krabby.formIndex = 0;

    await krabby.evolve(pokemonEvolutions[SpeciesId.KRABBY][0], krabby.species);

    expect(krabby.species.speciesId).toBe(SpeciesId.KINGLER);
    expect(krabby.getSpeciesForm().formKey).toBe("");
  });
});
