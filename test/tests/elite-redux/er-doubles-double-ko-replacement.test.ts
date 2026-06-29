/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Bug #7 ("fainted Pokemon on the battlefield") - hypothesis A (switch logic).
//
// The report was a CHALLENGE DOUBLES (Doubles Only) trainer fight where, after a
// KO, a fainted enemy stayed visible on the field. The suspected mechanism: a
// double KO of both enemy field mons in ONE turn queues TWO enemy replacement
// SwitchSummonPhases (each with a lazy slotIndex -1). Trainer.getNextSummonIndex
// /getPartyMemberMatchupScores resolve the slot from `party.slice(battlerCount)`
// and return a LIVE `party.indexOf`, while SwitchSummonPhase.switchAndSummon
// swaps party slots - so a stale index could re-summon an already-fainted mon or
// duplicate one, leaving a fainted mon in an on-field slot (party[0]/party[1]).
//
// This drives exactly that: a forced-DOUBLE trainer battle with TWO bench
// reserves (one per enemy field slot), double-KOs both field foes in a single
// turn, runs through both end-of-turn replacement switches, and asserts the
// enemy field afterwards holds TWO distinct LIVING mons with NO fainted mon in a
// field slot. It also keeps the #400 empty-bench guard honest (the battle keeps
// going, it does not freeze).
//
// Result: this PASSES on the current switch logic - i.e. hypothesis A does NOT
// reproduce the reported "fainted on the battlefield". The real cause is the
// browser-only evolution-background cross-origin crash (hypothesis B), fixed in
// loading-scene.ts (`evo_bg` crossOrigin), which cannot be reproduced headlessly
// (WebGL/video/CORS is out of scope for the harnesses - see CLAUDE.md). This
// test stays as a regression guard for the double-KO replacement path.
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { BattleType } from "#enums/battle-type";
import { BattlerIndex } from "#enums/battler-index";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { TrainerType } from "#enums/trainer-type";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER doubles double-KO enemy replacement (no fainted mon left on field, #7)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleType(BattleType.TRAINER)
      .randomTrainer({ trainerType: TrainerType.ACE_TRAINER })
      .battleStyle("double")
      .criticalHits(false)
      .startingLevel(100)
      .enemyLevel(50)
      // Foes only buff themselves: they never damage the player and never KO each
      // other, so the only faints are the two the player's leads inflict.
      .enemyMoveset(MoveId.HARDEN)
      .moveset([MoveId.TACKLE]);
  });

  afterAll(() => {
    phaserGame.destroy(true);
  });

  it("replaces BOTH double-KO'd foes - field ends with two distinct living mons, none fainted", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.SNORLAX);

    expect(globalScene.currentBattle.double).toBe(true);

    const field = globalScene.getEnemyField();
    expect(field).toHaveLength(2);

    // Build a deterministic bench: keep only the two front mons, then add exactly
    // one reserve per enemy field slot, matching that slot's trainerSlot so the
    // faint-phase reserve check + getNextSummonIndex slot filter both see it.
    // (The forced-double trainer rolls its own bench at random sizes/slots; this
    // pins the scenario to a clean [F0, F1, R0(slotF0), R1(slotF1)] party.) These
    // reserves are the mons the replacement switches must bring in.
    const battle = globalScene.currentBattle;
    battle.enemyParty.length = 2;
    const reserveSpecies = [SpeciesId.SHUCKLE, SpeciesId.MAGIKARP];
    for (let i = 0; i < 2; i++) {
      const reserve = globalScene.addEnemyPokemon(getPokemonSpecies(reserveSpecies[i]), 50, field[i].trainerSlot);
      battle.enemyParty.push(reserve);
    }

    const fieldIds = field.map(p => p.id);
    expect(globalScene.getEnemyParty()).toHaveLength(4);

    // Make both front foes one-hit KOs in the SAME turn (the double KO).
    field[0].hp = 1;
    field[1].hp = 1;

    game.move.select(MoveId.TACKLE, 0, BattlerIndex.ENEMY);
    game.move.select(MoveId.TACKLE, 1, BattlerIndex.ENEMY_2);

    // Run through the double faint, both VictoryPhases, and both end-of-turn
    // enemy replacement SwitchSummonPhases, landing at the next turn's init.
    await game.phaseInterceptor.to("TurnInitPhase");

    const afterField = globalScene.getEnemyField();

    // Two slots are still filled...
    expect(afterField).toHaveLength(2);
    // ...by the live bench reserves (the original front mons were KO'd)...
    for (const id of afterField.map(p => p.id)) {
      expect(fieldIds).not.toContain(id);
    }
    // ...and they are two DISTINCT mons...
    expect(afterField[0].id).not.toBe(afterField[1].id);
    // ...both ALIVE and genuinely on the field (the bug = a fainted mon here)...
    for (const p of afterField) {
      expect(p.isFainted()).toBe(false);
      expect(p.isOnField()).toBe(true);
    }
    // ...and the battle did NOT freeze (it reached the next turn).
    expect(globalScene.currentBattle.double).toBe(true);
  });
});
