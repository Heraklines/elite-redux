import {
  BORROWED_TIME_DECAY_TURNS,
  ER_BORROWED_TIME_ABILITY_ID,
  erBorrowedTimeState,
} from "#data/elite-redux/abilities/borrowed-time";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Stat } from "#enums/stat";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const BORROWED_TIME = ER_BORROWED_TIME_ABILITY_ID as AbilityId;

/** Expected holder Speed after `elapsed` end-of-turn decay steps. */
function holderSpeedAt(holderBase: number, diff: number, elapsed: number): number {
  const remaining = BORROWED_TIME_DECAY_TURNS - elapsed;
  return Math.max(1, Math.round(holderBase - (diff * remaining) / BORROWED_TIME_DECAY_TURNS));
}

/** Expected partner Speed after `elapsed` end-of-turn decay steps. */
function partnerSpeedAt(partnerBase: number, diff: number, elapsed: number): number {
  const remaining = BORROWED_TIME_DECAY_TURNS - elapsed;
  return Math.max(1, Math.round(partnerBase + (diff * remaining) / BORROWED_TIME_DECAY_TURNS));
}

describe.skipIf(!RUN)("ER Borrowed Time (5910)", () => {
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
      // Ninjask (very fast) vs Shuckle (very slow) → a large, obvious swap.
      .enemySpecies(SpeciesId.NINJASK)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.CELEBRATE)
      .ability(BORROWED_TIME)
      .moveset(MoveId.CELEBRATE);
  });

  it("swaps raw Speed on entry, then returns 1/3 of the difference each turn until restored", async () => {
    await game.classicMode.startBattle(SpeciesId.SHUCKLE);
    const holder = game.field.getPlayerPokemon();
    const enemy = game.field.getEnemyPokemon();

    const state = erBorrowedTimeState(holder);
    expect(state).toBeDefined();
    const { holderBase, partnerBase, diff } = state!;
    // Sanity: the enemy really is the faster mon, so the swap is a big speed-up.
    expect(partnerBase).toBeGreaterThan(holderBase);

    // Turn 0 (just entered): fully swapped.
    expect(holder.getStat(Stat.SPD)).toBe(holderSpeedAt(holderBase, diff, 0));
    expect(enemy.getStat(Stat.SPD)).toBe(partnerSpeedAt(partnerBase, diff, 0));
    expect(holder.getStat(Stat.SPD)).toBe(partnerBase);

    // End of turn 1 → 1/3 of the difference has returned.
    game.move.select(MoveId.CELEBRATE);
    await game.toEndOfTurn();
    expect(holder.getStat(Stat.SPD)).toBe(holderSpeedAt(holderBase, diff, 1));
    expect(enemy.getStat(Stat.SPD)).toBe(partnerSpeedAt(partnerBase, diff, 1));

    // End of turn 2 → 2/3 returned.
    game.move.select(MoveId.CELEBRATE);
    await game.toEndOfTurn();
    expect(holder.getStat(Stat.SPD)).toBe(holderSpeedAt(holderBase, diff, 2));
    expect(enemy.getStat(Stat.SPD)).toBe(partnerSpeedAt(partnerBase, diff, 2));

    // End of turn 3 → fully restored and the state is cleared.
    game.move.select(MoveId.CELEBRATE);
    await game.toEndOfTurn();
    expect(holder.getStat(Stat.SPD)).toBe(holderBase);
    expect(enemy.getStat(Stat.SPD)).toBe(partnerBase);
    expect(erBorrowedTimeState(holder)).toBeUndefined();
  });
});
