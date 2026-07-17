import { allMoves } from "#data/data-lists";
import {
  ER_OMNIFORM_ABILITY_ID,
  erOmniformOnMoveStart,
  erOmniformRevertOnLeaveField,
} from "#data/elite-redux/abilities/omniform";
import { clearOmniformRegistry, registerOmniformMapping } from "#data/elite-redux/abilities/omniform-registry";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { PokemonType } from "#enums/pokemon-type";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

  it("reverts to the pre-battle form + stats when the holder leaves the field (wave/battle end)", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    const spdBefore = holder.getStat(Stat.SPD);

    erOmniformOnMoveStart(holder, allMoves[MoveId.WATER_GUN]);
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.VAPOREON);
    expect(holder.getStat(Stat.SPD)).not.toBe(spdBefore);

    // leaveField (switch-out / wave end) reverts the species + stats.
    holder.resetSummonData();
    erOmniformRevertOnLeaveField(holder);
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.EEVEE);
    expect(holder.getStat(Stat.SPD)).toBe(spdBefore);
  });

  it("chained revert restores the ORIGINAL pre-battle form, not an intermediate, across a wave boundary", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();

    // First transform on the current wave: Eevee -> Vaporeon.
    erOmniformOnMoveStart(holder, allMoves[MoveId.WATER_GUN]);
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.VAPOREON);

    // Advance the wave index, THEN chain: Vaporeon -> Flareon. The old per-wave
    // snapshot guard re-captured the INTERMEDIATE form (Vaporeon) here because the
    // wave changed, so revert landed on Vaporeon instead of Eevee. The snapshot
    // must be taken once on the FIRST transform per battle and survive the chain.
    game.scene.currentBattle.waveIndex += 1;
    erOmniformOnMoveStart(holder, allMoves[MoveId.EMBER]);
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.FLAREON);

    // Revert (leaveField at battle end) must go all the way back to the original.
    holder.resetSummonData();
    erOmniformRevertOnLeaveField(holder);
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.EEVEE);
  });

  it("swaps the live moveset in place (what the fight menu rebuilds from), keeping the used move in its slot and executing the CURRENT slot on a chain", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();

    const waterSlot = holder.getMoveset().findIndex(m => m?.moveId === MoveId.WATER_GUN);
    expect(waterSlot).toBeGreaterThanOrEqual(0);

    // Eevee -> Vaporeon: the used move stays in its slot; the rest are the new
    // form's moves. `getMoveset()` is exactly what `FightUiHandler.refreshMoves`
    // reads, so displayed == current after the transform.
    erOmniformOnMoveStart(holder, allMoves[MoveId.WATER_GUN]);
    const afterFirst = holder.getMoveset();
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.VAPOREON);
    expect(afterFirst[waterSlot]?.moveId).toBe(MoveId.WATER_GUN);
    // The other slots changed away from Eevee's kit (EMBER/TACKLE/SPLASH replaced).
    expect(afterFirst.some(m => m?.moveId !== MoveId.WATER_GUN)).toBe(true);

    // Chained transform executes on the CURRENT (Vaporeon) form and keeps its move.
    erOmniformOnMoveStart(holder, allMoves[MoveId.EMBER]);
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.FLAREON);
    expect(holder.getMoveset().map(m => m?.moveId)).toContain(MoveId.EMBER);
  });

  it("does nothing for an unmapped move type (general: no forced transform)", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();

    // Normal-type Tackle has no mapping for Eevee.
    erOmniformOnMoveStart(holder, allMoves[MoveId.TACKLE]);
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.EEVEE);
  });

  it("is a TOTAL no-op when the mapped target IS the holder's current form (already that form)", async () => {
    // Jolteon mapping Electric -> Jolteon: using an Electric move while ALREADY
    // Jolteon must not re-adapt (the maintainer's report). No message, no FX/wait
    // phase, no moveset re-derive - the move just plays.
    registerOmniformMapping(SpeciesId.JOLTEON, 0, PokemonType.ELECTRIC, SpeciesId.JOLTEON);
    await game.classicMode.startBattle(SpeciesId.JOLTEON);
    const holder = game.field.getPlayerPokemon();
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.JOLTEON);

    const movesBefore = holder.getMoveset().map(m => m?.moveId);
    const queueMessage = vi.spyOn(game.scene.phaseManager, "queueMessage");
    const unshiftNew = vi.spyOn(game.scene.phaseManager, "unshiftNew");

    // Thunder Shock is Electric; Jolteon maps Electric -> Jolteon (itself).
    erOmniformOnMoveStart(holder, allMoves[MoveId.THUNDER_SHOCK]);

    // Still Jolteon, moveset byte-identical, and NOTHING was queued.
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.JOLTEON);
    expect(holder.getMoveset().map(m => m?.moveId)).toEqual(movesBefore);
    expect(queueMessage).not.toHaveBeenCalled();
    expect(unshiftNew.mock.calls.some(call => call[0] === "ErOmniformTransformWaitPhase")).toBe(false);
  });

  it("a Normal STATUS move while ALREADY on base is a no-op (the revert seam)", async () => {
    // Never transformed => on base. A Normal status move routes through the revert
    // path, which must be inert (no snapshot to revert to): no message, no wait phase.
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const holder = game.field.getPlayerPokemon();
    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.EEVEE);

    const movesBefore = holder.getMoveset().map(m => m?.moveId);
    const queueMessage = vi.spyOn(game.scene.phaseManager, "queueMessage");
    const unshiftNew = vi.spyOn(game.scene.phaseManager, "unshiftNew");

    // Growl is a Normal-type status move.
    erOmniformOnMoveStart(holder, allMoves[MoveId.GROWL]);

    expect(holder.getSpeciesForm().speciesId).toBe(SpeciesId.EEVEE);
    expect(holder.getMoveset().map(m => m?.moveId)).toEqual(movesBefore);
    expect(queueMessage).not.toHaveBeenCalled();
    expect(unshiftNew.mock.calls.some(call => call[0] === "ErOmniformTransformWaitPhase")).toBe(false);
  });
});
