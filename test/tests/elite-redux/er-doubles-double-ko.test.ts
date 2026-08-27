/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Regression (#400) - HARD FREEZE on a double KO in trainer doubles:
// a double KO queued TWO enemy replacement switches; when only one reserve
// existed, the second SwitchSummonPhase resolved no slot and crashed mid-
// phase, hanging the battle (every Doubles Only trainer fight risked it).
//
//  - Trainer.getNextSummonIndex with an EMPTY bench must return -1 (it threw
//    on `sortedPartyMemberScores[0][1]`).
//  - SwitchSummonPhase.switchAndSummon must end cleanly for an unresolvable
//    slot (the null-guard sat AFTER the first dereference).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { BattleType } from "#enums/battle-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { SwitchType } from "#enums/switch-type";
import { TrainerSlot } from "#enums/trainer-slot";
import { TrainerType } from "#enums/trainer-type";
import type { Pokemon } from "#field/pokemon";
import { resolveEnemySwitchSlot, resolvePlayerSwitchSlot, SwitchSummonPhase } from "#phases/switch-summon-phase";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe("ER simultaneous player double-KO replacement", () => {
  it("replaces a stale duplicate pick with the next living off-field reserve", () => {
    const mon = (allowed: boolean, onField: boolean): Pokemon =>
      ({ isAllowedInBattle: () => allowed, isOnField: () => onField }) as unknown as Pokemon;
    const party = [mon(false, false), mon(false, false), mon(false, false), mon(true, true), mon(true, false)];

    // Slot 3 was the first pick. By the time the second summon executes it is
    // already on the field, so slot 4 must be used instead.
    expect(resolvePlayerSwitchSlot(party, 3, 2)).toBe(4);
  });

  it("replaces a stale enemy switch slot that now contains the fainted former lead", () => {
    const mon = (allowed: boolean, onField: boolean): Pokemon =>
      ({ isAllowedInBattle: () => allowed, isOnField: () => onField }) as unknown as Pokemon;
    const party = [mon(true, true), mon(true, true), mon(false, false), mon(true, false), mon(true, false)];

    // The AI originally selected reserve slot 2. An earlier KO/replacement
    // transposed the fainted lead into that slot before this queued switch ran.
    expect(resolveEnemySwitchSlot(party, 2, 2)).toBe(3);
  });
});

describe.skipIf(!RUN)("ER doubles double-KO freeze (#400)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });
  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
      .moveset([MoveId.SPLASH])
      .enemyMoveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("getNextSummonIndex returns -1 (not a crash) when the bench is empty", () => {
    const trainer = globalScene.currentBattle.trainer!;
    expect(trainer.getNextSummonIndex(TrainerSlot.NONE, [])).toBe(-1);
  });

  it("an enemy SwitchSummonPhase with no resolvable slot ends cleanly instead of dereferencing undefined", () => {
    const phase = new SwitchSummonPhase(SwitchType.SWITCH, 0, -1, false, false);
    const endSpy = vi.spyOn(phase as unknown as { end: () => void }, "end").mockImplementation(() => {});
    // Direct call into the crash site: party[-1] is undefined; before the fix
    // this threw on `switchedInPokemon.resetSummonData()`.
    expect(() => (phase as unknown as { switchAndSummon: () => void }).switchAndSummon()).not.toThrow();
    expect(endSpy).toHaveBeenCalled();
  });
});
