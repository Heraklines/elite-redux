import { allMoves } from "#data/data-lists";
import { ER_OMNIFORM_ABILITY_ID, erOmniformOnMoveStart } from "#data/elite-redux/abilities/omniform";
import { clearOmniformRegistry, registerOmniformMapping } from "#data/elite-redux/abilities/omniform-registry";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const OMNIFORM = ER_OMNIFORM_ABILITY_ID as AbilityId;

// Partner Eevee's Omniform ability adapts the mon by the TYPE of the move it uses.
// Its egg-move set (SPECIES_EEVEE, shared with the vanilla Eevee species the partner
// form lives on) now carries GLITZY_GLOW (Psychic) and BADDY_BAD (Dark) so a fresh
// Partner Eevee can unlock the Espeon/Umbreon transforms early. This proves the two
// egg-move-sourced moves drive the type-keyed transform through the pre-move seam.
//
// Uses TEST-ONLY mappings on base Eevee (form 0), the same harness pattern as
// er-omniform.test.ts (production registers the head mapping on the partner FORM).
describe.skipIf(!RUN)("ER Omniform — Glitzy Glow / Baddy Bad egg moves drive the transform", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    clearOmniformRegistry();
    // Psychic -> Espeon, Dark -> Umbreon (mirrors the production partner-family type map).
    registerOmniformMapping(SpeciesId.EEVEE, 0, PokemonType.PSYCHIC, SpeciesId.ESPEON);
    registerOmniformMapping(SpeciesId.EEVEE, 0, PokemonType.DARK, SpeciesId.UMBREON);
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(100)
      .enemySpecies(SpeciesId.SNORLAX)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(OMNIFORM)
      .moveset([MoveId.GLITZY_GLOW, MoveId.BADDY_BAD, MoveId.TACKLE, MoveId.SPLASH]);
  });

  afterEach(() => {
    clearOmniformRegistry();
  });

  it("Glitzy Glow (Psychic) transforms Eevee into Espeon", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.EEVEE);

    erOmniformOnMoveStart(holder, allMoves[MoveId.GLITZY_GLOW]);

    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.ESPEON);
    // The move being used stays in the moveset after the transform.
    expect(holder.getMoveset().map(m => m.moveId)).toContain(MoveId.GLITZY_GLOW);
  });

  it("Baddy Bad (Dark) transforms Eevee into Umbreon", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.EEVEE);

    erOmniformOnMoveStart(holder, allMoves[MoveId.BADDY_BAD]);

    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.UMBREON);
    expect(holder.getMoveset().map(m => m.moveId)).toContain(MoveId.BADDY_BAD);
  });
});
