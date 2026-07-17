/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Omniform teach-path via LearnMovePhase (TM Case / Learner's Shroom / etc).
//
// A taught move (LearnMoveType.TM here, mirroring the TM Case / Learner's Shroom
// modifier-apply) on an Omniform mon converges on the SAME existing batch level-up
// panel (UiMode.LEARN_MOVE_BATCH) with that one move offered - not a separate
// picker. Cycling the strip to a non-base evolution and learning routes the teach
// through learnMoveForEvolution into that evolution's OWN stored moveset. Verifies
// the panel opens and the teach lands per evolution (and TM bookkeeping runs).
//
// Gated behind ER_SCENARIO=1 (needs the ER species/registry init).
// =============================================================================

import { ER_PARTNER_EEVEE_ABILITY_ID } from "#data/elite-redux/abilities/composite-newcomers";
import {
  ensureOmniformFormMovesets,
  getOrRollFormMoveset,
  listOmniformEvolutionsForMove,
  omniformFamilyForms,
  omniformFormKey,
  omniformFormLearnableMoves,
} from "#data/elite-redux/omniform-movesets";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { LearnMoveType } from "#enums/learn-move-type";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { PokemonMove } from "#moves/pokemon-move";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function partnerFormIndex(): number {
  return getPokemonSpecies(SpeciesId.EEVEE).forms.findIndex(f => f.formKey === "partner");
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe.skipIf(!RUN)("ER Omniform teach path (LearnMovePhase converges on the batch panel)", () => {
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
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .ability(ER_PARTNER_EEVEE_ABILITY_ID as unknown as AbilityId)
      .starterForms({ [SpeciesId.EEVEE]: partnerFormIndex() });
  });

  it("a taught move opens the SAME batch panel; a non-base pick learns into that evolution", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const mon = game.field.getPlayerPokemon();
    ensureOmniformFormMovesets(mon);

    const forms = omniformFamilyForms(mon);
    const evoForm = forms[1];
    // A move the 2nd evolution can legally learn but does not already know.
    const evoLearnable = omniformFormLearnableMoves(evoForm);
    const teachMove = [...evoLearnable].find(m => m !== MoveId.NONE && m !== MoveId.TACKLE)!;
    expect(teachMove).toBeDefined();
    // Free slot on the evolution so the teach lands without a forget prompt; base
    // moveset controlled so it does not already know teachMove.
    mon.moveset.splice(0, mon.moveset.length, new PokemonMove(MoveId.TACKLE));
    mon.customPokemonData.erOmniformMovesets ??= {};
    mon.customPokemonData.erOmniformMovesets[omniformFormKey(evoForm.speciesId, evoForm.formIndex)] = [
      [MoveId.TACKLE, 0],
    ];
    expect(
      listOmniformEvolutionsForMove(mon, teachMove).find(
        o => o.form.speciesId === evoForm.speciesId && o.form.formIndex === evoForm.formIndex,
      )?.canLearn,
    ).toBe(true);

    // Drive a LearnMovePhase as a TM Case / Learner's Shroom would (LearnMoveType.TM).
    // It converges on the SAME batch panel (UiMode.LEARN_MOVE_BATCH) - no separate picker.
    game.scene.phaseManager.create("LearnMovePhase", 0, teachMove, LearnMoveType.TM).start();
    for (let i = 0; i < 20 && game.scene.ui.getMode() !== UiMode.LEARN_MOVE_BATCH; i++) {
      await sleep(5);
    }
    expect(game.scene.ui.getMode(), "the shared batch panel opened").toBe(UiMode.LEARN_MOVE_BATCH);

    // Base is selected by default; cycle to the evolution (F), learn the move (ACTION),
    // then close (B - a committed learn finishes immediately).
    game.scene.ui.processInput(Button.CYCLE_FORM);
    game.scene.ui.processInput(Button.ACTION);
    game.scene.ui.processInput(Button.CANCEL);
    await sleep(20);

    // The move landed in the evolution's OWN stored moveset, NOT the base live moveset.
    expect(
      getOrRollFormMoveset(mon, evoForm).some(([m]) => m === teachMove),
      "evolution learned the taught move",
    ).toBe(true);
    expect(
      mon.getMoveset(true).some(m => m.moveId === teachMove),
      "base did NOT learn it",
    ).toBe(false);
    // A TM records into usedTMs (the reward-shop continuation bookkeeping ran).
    expect(mon.usedTMs?.includes(teachMove)).toBe(true);
  });
});
