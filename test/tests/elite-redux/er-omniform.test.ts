import { allMoves } from "#data/data-lists";
import {
  clearOmniformRegistry,
  ER_OMNIFORM_ABILITY_ID,
  erOmniformOnMoveStart,
  registerOmniformMapping,
} from "#data/elite-redux/abilities/omniform";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const OMNIFORM = ER_OMNIFORM_ABILITY_ID as AbilityId;

// Test-only mappings (production registers NONE — normal eeveelutions unaffected):
//   Eevee + Water  -> Vaporeon
//   Vaporeon + Fire -> Flareon   (proves free chaining)
describe.skipIf(!RUN)("ER Omniform (5929)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    clearOmniformRegistry();
    registerOmniformMapping(SpeciesId.EEVEE, 0, PokemonType.WATER, SpeciesId.VAPOREON);
    registerOmniformMapping(SpeciesId.VAPOREON, 0, PokemonType.FIRE, SpeciesId.FLAREON);
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
      .moveset([MoveId.WATER_GUN, MoveId.EMBER, MoveId.TACKLE, MoveId.SPLASH]);
  });

  afterEach(() => {
    clearOmniformRegistry();
  });

  it("transforms mega-style on using a mapped-type move, recomputing stats/speed and preserving the used move", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.EEVEE);
    const spdBefore = holder.getStat(Stat.SPD);
    const beforeMoves = holder
      .getMoveset()
      .map(m => m.moveId)
      .join(",");

    game.move.select(MoveId.WATER_GUN);
    await game.toEndOfTurn();

    // Transformed into the mapped form; stats (and thus speed order input) recomputed.
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.VAPOREON);
    expect(holder.getStat(Stat.SPD)).not.toBe(spdBefore);
    // The move being used stays in the moveset; the others were replaced.
    const afterMoves = holder.getMoveset().map(m => m.moveId);
    expect(afterMoves).toContain(MoveId.WATER_GUN);
    expect(afterMoves.join(",")).not.toBe(beforeMoves);
  });

  it("chains freely: a second mapped-type move transforms again (no lock)", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();

    // First transform: Eevee -> Vaporeon (Water).
    erOmniformOnMoveStart(holder, allMoves[MoveId.WATER_GUN]);
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.VAPOREON);

    // Chained transform: Vaporeon -> Flareon (Fire), no lock.
    erOmniformOnMoveStart(holder, allMoves[MoveId.EMBER]);
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.FLAREON);
  });

  it("reverts to the pre-battle form when summon data is reset (wave/battle end)", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();

    erOmniformOnMoveStart(holder, allMoves[MoveId.WATER_GUN]);
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.VAPOREON);

    holder.resetSummonData();
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.EEVEE);
  });

  it("does nothing for an unmapped move type (general: no forced transform)", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();

    // Normal-type Tackle has no mapping for Eevee.
    erOmniformOnMoveStart(holder, allMoves[MoveId.TACKLE]);
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.EEVEE);
  });
});
