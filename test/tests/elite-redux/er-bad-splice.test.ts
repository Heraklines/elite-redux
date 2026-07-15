import { ER_BAD_SPLICE_ABILITY_ID, erBadSpliceOnLeaveField } from "#data/elite-redux/abilities/bad-splice";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const BAD_SPLICE = ER_BAD_SPLICE_ABILITY_ID as AbilityId;

// The Bad Splice holder is the ENEMY (so its opponents — the PLAYER party — can
// carry the multi-member bench the splice draws from). The player's active mon
// is Charizard (Fire/Flying); its only other living party member is Blastoise
// (Water), so the seeded pick is deterministic: Charizard gains Water.
describe.skipIf(!RUN)("ER Bad Splice (5932)", () => {
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
      .enemyAbility(BAD_SPLICE)
      .enemyMoveset(MoveId.SPLASH)
      .ability(AbilityId.BALL_FETCH)
      .moveset(MoveId.SPLASH);
  });

  it("grafts a random other living party member's types onto each opponent on entry", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARIZARD, SpeciesId.BLASTOISE);
    const active = game.field.getPlayerPokemon();

    // Charizard gained Water from its benched Blastoise, keeping its own typing.
    expect(active.isOfType(PokemonType.WATER)).toBe(true);
    expect(active.isOfType(PokemonType.FIRE)).toBe(true);
    expect(active.isOfType(PokemonType.FLYING)).toBe(true);
  });

  it("removes the splice and restores exact prior typing when the holder leaves the field", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARIZARD, SpeciesId.BLASTOISE);
    const active = game.field.getPlayerPokemon();
    const holder = game.field.getEnemyPokemon();
    expect(active.isOfType(PokemonType.WATER)).toBe(true);

    // Holder leaves -> Bad Splice un-grafts only what it added.
    erBadSpliceOnLeaveField(holder);
    expect(active.isOfType(PokemonType.WATER)).toBe(false);
    expect(active.isOfType(PokemonType.FIRE)).toBe(true);
    expect(active.isOfType(PokemonType.FLYING)).toBe(true);
  });

  it("no splice when the opponent has no other living party member", async () => {
    await game.classicMode.startBattle(SpeciesId.CHARIZARD);
    const active = game.field.getPlayerPokemon();

    // Lone party member: nothing to splice from.
    expect(active.isOfType(PokemonType.WATER)).toBe(false);
    expect(active.getTypes()).toEqual(expect.arrayContaining([PokemonType.FIRE, PokemonType.FLYING]));
  });
});
