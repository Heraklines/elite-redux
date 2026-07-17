/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Omniform teach-path via LearnMovePhase (TM Case / Learner's Shroom / etc).
//
// A taught move (LearnMoveType.TM here, mirroring the TM Case / Learner's Shroom
// modifier-apply) on an Omniform mon opens an evolution picker (OPTION_SELECT),
// and picking a non-base evolution routes the teach through learnMoveForEvolution
// into that evolution's OWN stored moveset. Verifies the picker opens with the
// right options and the teach lands per evolution.
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
import type { AbstractOptionSelectUiHandler } from "#ui/abstract-option-select-ui-handler";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function partnerFormIndex(): number {
  return getPokemonSpecies(SpeciesId.EEVEE).forms.findIndex(f => f.formKey === "partner");
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

describe.skipIf(!RUN)("ER Omniform teach path (LearnMovePhase evolution picker)", () => {
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

  it("a taught move opens the evolution picker; a non-base pick learns into that evolution", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const mon = game.field.getPlayerPokemon();
    ensureOmniformFormMovesets(mon);

    const forms = omniformFamilyForms(mon);
    const baseForm = forms[0];
    const evoForm = forms[1];
    // A move BOTH base and the evolution can learn, unknown to both, so the picker
    // lists [base, evolution, ...] and the evolution sits at option index 1.
    const evoLearnable = omniformFormLearnableMoves(evoForm);
    const shared = [...omniformFormLearnableMoves(baseForm)].filter(m => m !== MoveId.NONE && evoLearnable.has(m));
    expect(shared.length).toBeGreaterThanOrEqual(2);
    const teachMove = shared[0];
    // Control both movesets so neither knows teachMove (base stays in the offer list)
    // and the evolution has a free slot (teach lands without a forget-picker).
    mon.moveset.splice(0, mon.moveset.length, new PokemonMove(shared[1]));
    mon.customPokemonData.erOmniformMovesets ??= {};
    mon.customPokemonData.erOmniformMovesets[omniformFormKey(evoForm.speciesId, evoForm.formIndex)] = [[shared[1], 0]];
    // Confirm the picker order: base first, evolution at index 1.
    const canLearn = listOmniformEvolutionsForMove(mon, teachMove).filter(o => o.canLearn);
    expect(canLearn[0].form.speciesId).toBe(baseForm.speciesId);
    expect(canLearn[1].form.speciesId).toBe(evoForm.speciesId);

    // Drive a LearnMovePhase as a TM Case / Learner's Shroom would (LearnMoveType.TM).
    game.scene.phaseManager.create("LearnMovePhase", 0, teachMove, LearnMoveType.TM).start();
    // The phase opens the evolution picker (a message prompt then OPTION_SELECT).
    for (let i = 0; i < 20 && game.scene.ui.getMode() !== UiMode.OPTION_SELECT; i++) {
      game.scene.ui.processInput(Button.ACTION); // advance the "wants to learn" prompt
      await sleep(5);
    }
    expect(game.scene.ui.getMode(), "the evolution picker (OPTION_SELECT) opened").toBe(UiMode.OPTION_SELECT);

    // Options are base-first; pick the 2nd (the non-base evolution) and confirm.
    const handler = game.scene.ui.getHandler() as AbstractOptionSelectUiHandler;
    handler.setCursor(1);
    handler.processInput(Button.ACTION);
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
  });
});
