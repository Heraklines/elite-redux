/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER Omniform level-up batch panel (Partner Eevee, phase 2 UI).
//
// Drives the REAL LearnMoveBatchUiHandler for an Omniform mon through its public
// input path (setMode -> processInput) and asserts the per-evolution teach flow:
//   - an offered move is learned onto the BASE form (the mon's live moveset)...
//   - ...AND, independently, the SAME move onto a non-base evolution (its OWN
//     stored moveset) - "expanded per evolution, not in total";
//   - once-per-evolution: the move now reads as already-known for that evolution
//     (canLearn false), and a second teach is rejected;
//   - illegal-target absence: a move outside the evolution's learnable set is not
//     offered to it (offer.learnable false).
//
// Gated behind ER_SCENARIO=1 (needs the ER species/registry init).
// =============================================================================

import { allMoves } from "#data/data-lists";
import { ER_PARTNER_EEVEE_ABILITY_ID } from "#data/elite-redux/abilities/composite-newcomers";
import { erOmniformOnMoveStart } from "#data/elite-redux/abilities/omniform";
import { ER_PARTNER_VAPOREON_SPECIES_ID } from "#data/elite-redux/er-newcomer-species";
import {
  ensureOmniformFormMovesets,
  getOrRollFormMoveset,
  isErOmniformMon,
  learnMoveForEvolution,
  listOmniformEvolutionsForMove,
  omniformFamilyForms,
  omniformFormKey,
  omniformFormLearnableMoves,
} from "#data/elite-redux/omniform-movesets";
import { AbilityId } from "#enums/ability-id";
import { Button } from "#enums/buttons";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { PokemonMove } from "#moves/pokemon-move";
import type { LearnMoveBatchDeps } from "#phases/learn-move-batch-phase";
import { GameManager } from "#test/framework/game-manager";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The vanilla Eevee "partner" form index (Partner Eevee IS this form). */
function partnerFormIndex(): number {
  return getPokemonSpecies(SpeciesId.EEVEE).forms.findIndex(f => f.formKey === "partner");
}

describe.skipIf(!RUN)("ER Omniform level-up batch panel (per-evolution teach)", () => {
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

  it("offer a move; learn it onto BASE + the SAME move onto an evolution; once-per-evo + illegal absence", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const mon = game.field.getPlayerPokemon();
    expect(isErOmniformMon(mon)).toBe(true);
    ensureOmniformFormMovesets(mon);

    const forms = omniformFamilyForms(mon);
    const baseForm = forms[0];
    const evoForm = forms[1]; // a non-base partner eeveelution

    // A move BOTH the base and the evolution can legally learn (a shared TM/level move).
    const baseLearnable = omniformFormLearnableMoves(baseForm);
    const evoLearnable = omniformFormLearnableMoves(evoForm);
    const shared = [...baseLearnable].filter(m => m !== MoveId.NONE && evoLearnable.has(m));
    expect(shared.length).toBeGreaterThanOrEqual(5);
    const moveA = shared[0];
    const others = shared.filter(m => m !== moveA);

    // Control the movesets so `moveA` is UNKNOWN to both, with a free slot each (no
    // replace prompt): base = 2 live moves; the evolution store = 2 stored moves.
    mon.moveset.splice(0, mon.moveset.length, new PokemonMove(others[0]), new PokemonMove(others[1]));
    mon.customPokemonData.erOmniformMovesets ??= {};
    mon.customPokemonData.erOmniformMovesets[omniformFormKey(evoForm.speciesId, evoForm.formIndex)] = [
      [others[2], 0],
      [others[3], 0],
    ];

    // A move the EVOLUTION cannot legally learn (illegal-target absence check).
    const illegalMove = [MoveId.SEED_FLARE, MoveId.DOODLE, MoveId.BEHEMOTH_BLADE, MoveId.FLEUR_CANNON].find(
      m => !evoLearnable.has(m),
    )!;
    expect(illegalMove).toBeDefined();

    const deps: LearnMoveBatchDeps = {
      pokemon: mon,
      learnableIds: [moveA, illegalMove],
      omniform: true,
      assign: (moveId, slotIndex) => mon.setMove(slotIndex, moveId),
      revert: () => {},
      done: () => {},
      fallback: () => {},
    };

    await game.scene.ui.setMode(UiMode.LEARN_MOVE_BATCH, deps);
    expect(game.scene.ui.getMode()).toBe(UiMode.LEARN_MOVE_BATCH);

    // Base form selected by default (index 0). ACTION on the first offer (moveA) with
    // a free slot -> learned onto the mon's LIVE moveset (the base path).
    game.scene.ui.processInput(Button.ACTION);
    expect(
      mon.getMoveset(true).some(m => m.moveId === moveA),
      "base form learned moveA onto its live moveset",
    ).toBe(true);
    // The evolution has NOT learned it yet - per-evolution, not in total.
    expect(getOrRollFormMoveset(mon, evoForm).some(([m]) => m === moveA)).toBe(false);

    // Cycle to the evolution, then ACTION on moveA again -> learned onto ITS OWN stored
    // moveset (the free slot). The SAME move now lives on both, independently.
    game.scene.ui.processInput(Button.CYCLE_FORM);
    game.scene.ui.processInput(Button.ACTION);
    expect(
      getOrRollFormMoveset(mon, evoForm).some(([m]) => m === moveA),
      "evolution learned the SAME moveA",
    ).toBe(true);
    expect(
      mon.getMoveset(true).some(m => m.moveId === moveA),
      "base form still knows moveA",
    ).toBe(true);

    // Once-per-evolution: the evolution now reads moveA as already-known (not offerable),
    // and a direct re-teach is rejected.
    const evoOffer = listOmniformEvolutionsForMove(mon, moveA).find(
      o => o.form.speciesId === evoForm.speciesId && o.form.formIndex === evoForm.formIndex,
    );
    expect(evoOffer?.alreadyKnown).toBe(true);
    expect(evoOffer?.canLearn).toBe(false);
    const dup = learnMoveForEvolution(mon, evoForm, moveA, 0);
    expect(dup.ok).toBe(false);
    expect(dup.reason).toBe("already-known");

    // Illegal-target absence: the illegal move is offered but NOT learnable by the evolution.
    const illegalOffer = listOmniformEvolutionsForMove(mon, illegalMove).find(
      o => o.form.speciesId === evoForm.speciesId && o.form.formIndex === evoForm.formIndex,
    );
    expect(illegalOffer?.learnable).toBe(false);
    expect(illegalOffer?.canLearn).toBe(false);
  });

  it("opened while the mon is TRANSFORMED, the strip defaults to the CURRENT evolution (not base)", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const mon = game.field.getPlayerPokemon();
    expect(isErOmniformMon(mon)).toBe(true);
    ensureOmniformFormMovesets(mon);

    // Transform Partner Eevee -> Partner Vaporeon so the mon is CURRENTLY a non-base form.
    erOmniformOnMoveStart(mon, allMoves[MoveId.WATER_GUN]);
    const sf = mon.getSpeciesForm();
    expect(sf.speciesId).toBe(ER_PARTNER_VAPOREON_SPECIES_ID);

    // The family list is base-first, so the current (Vaporeon) form is NOT index 0.
    const forms = omniformFamilyForms(mon);
    const currentIdx = forms.findIndex(f => f.speciesId === sf.speciesId && f.formIndex === mon.formIndex);
    expect(currentIdx).toBeGreaterThan(0);

    // Two real, resolvable offers so render() doesn't choke; content is irrelevant here.
    const deps: LearnMoveBatchDeps = {
      pokemon: mon,
      learnableIds: [MoveId.TACKLE, MoveId.QUICK_ATTACK],
      omniform: true,
      assign: (moveId, slotIndex) => mon.setMove(slotIndex, moveId),
      revert: () => {},
      done: () => {},
      fallback: () => {},
    };

    await game.scene.ui.setMode(UiMode.LEARN_MOVE_BATCH, deps);
    expect(game.scene.ui.getMode()).toBe(UiMode.LEARN_MOVE_BATCH);

    // The panel's initial evolution selection defaults to the mon's CURRENT form, so
    // the strip's offers/columns operate on the eeveelution it is wearing, not base.
    const handler = game.scene.ui.getHandler() as unknown as { omniformSel: number };
    expect(handler.omniformSel).toBe(currentIdx);
  });

  it("the REAL LearnMoveBatchPhase opens the Omniform panel and learns per evolution", async () => {
    await game.classicMode.startBattle(SpeciesId.EEVEE);
    const mon = game.field.getPlayerPokemon();
    ensureOmniformFormMovesets(mon);

    const forms = omniformFamilyForms(mon);
    const baseForm = forms[0];
    const evoForm = forms[1];
    const shared = [...omniformFormLearnableMoves(baseForm)].filter(
      m => m !== MoveId.NONE && omniformFormLearnableMoves(evoForm).has(m),
    );
    expect(shared.length).toBeGreaterThanOrEqual(4);
    const moveA = shared[0];
    const others = shared.filter(m => m !== moveA);

    // Free slot on both so a learn lands directly (no replace prompt to drive).
    mon.moveset.splice(0, mon.moveset.length, new PokemonMove(others[0]));
    mon.customPokemonData.erOmniformMovesets ??= {};
    mon.customPokemonData.erOmniformMovesets[omniformFormKey(evoForm.speciesId, evoForm.formIndex)] = [[others[1], 0]];

    // Drive the REAL phase (what LevelUpPhase unshifts on a new-move level-up). It
    // detects the Omniform mon, builds the omniform deps, and opens the panel.
    game.scene.phaseManager.create("LearnMoveBatchPhase", 0, [moveA]).start();
    expect(game.scene.ui.getMode(), "the real batch phase opened the Omniform panel").toBe(UiMode.LEARN_MOVE_BATCH);

    // Base learn, then cycle to the evolution + learn the SAME move; B closes the panel.
    game.scene.ui.processInput(Button.ACTION);
    game.scene.ui.processInput(Button.CYCLE_FORM);
    game.scene.ui.processInput(Button.ACTION);

    expect(
      mon.getMoveset(true).some(m => m.moveId === moveA),
      "base learned via the real phase",
    ).toBe(true);
    expect(
      getOrRollFormMoveset(mon, evoForm).some(([m]) => m === moveA),
      "evolution learned via the real phase",
    ).toBe(true);
  });
});
