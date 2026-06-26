/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite/Hell classic final boss = Cascoon → Primal Cascoon (drop-in for
// Eternatus → Eternamax). Verifies the difficulty gate and that the two-phase
// transform is wired: Cascoon must carry a "" → "primal" manual form change so
// BattleScene.initFinalBossPhaseTwo()'s generic
// triggerPokemonFormChange(SpeciesFormChangeManualTrigger) promotes phase 1 into
// phase 2 (otherwise the forced phase-1 survive-at-1HP logic would softlock).
//
// Gated behind ER_SCENARIO=1.
// =============================================================================

import { getErFinalBossSpecies, isErFinalBossSpecies } from "#data/elite-redux/er-final-boss";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { pokemonFormChanges } from "#data/pokemon-forms";
import { SpeciesFormChangeManualTrigger } from "#data/pokemon-forms/form-change-triggers";
import { AbilityId } from "#enums/ability-id";
import { MoveId } from "#enums/move-id";
import { SpeciesFormKey } from "#enums/species-form-key";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, test, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("ER Elite/Hell final boss (Cascoon → Primal Cascoon)", () => {
  afterEach(() => {
    setErDifficulty("ace"); // don't leak difficulty into other suites
  });

  it("replaces Eternatus with Cascoon on Elite and Hell, keeps Eternatus on Ace", () => {
    setErDifficulty("ace");
    expect(getErFinalBossSpecies()).toBeNull();

    setErDifficulty("elite");
    expect(getErFinalBossSpecies()?.speciesId).toBe(SpeciesId.CASCOON);

    setErDifficulty("hell");
    expect(getErFinalBossSpecies()?.speciesId).toBe(SpeciesId.CASCOON);

    expect(isErFinalBossSpecies(SpeciesId.CASCOON)).toBe(true);
    expect(isErFinalBossSpecies(SpeciesId.ETERNATUS)).toBe(false);
  });

  it("Cascoon has a '' → 'primal' manual form change (the phase-1 → phase-2 transform)", () => {
    const changes = pokemonFormChanges[SpeciesId.CASCOON] ?? [];
    // There may be multiple "" → "primal" entries (an item-stone trigger from the
    // ER primal bridge AND our manual trigger). The final-boss transform needs the
    // MANUAL-trigger one specifically.
    const phaseTwo = changes.find(
      fc =>
        fc.preFormKey === "" && fc.formKey === SpeciesFormKey.PRIMAL && fc.findTrigger(SpeciesFormChangeManualTrigger),
    );
    expect(phaseTwo, "Cascoon must have a ''→'primal' MANUAL form change registered").toBeDefined();
  });

  it("the Primal phase-2 form is the BST-726 jump (mirrors Eternatus → Eternamax)", () => {
    setErDifficulty("elite");
    const cascoon = getErFinalBossSpecies();
    expect(cascoon).not.toBeNull();
    const primal = cascoon?.forms.find(f => f.formKey === SpeciesFormKey.PRIMAL);
    expect(primal).toBeDefined();
    expect(primal!.baseTotal).toBe(726);
    // Phase 1 (default form) is the weak Cascoon.
    expect(cascoon!.forms[0].baseTotal).toBe(205);
  });
});

// #94 phase-2 self-death repro: when phase-1 Cascoon (forced to a sliver of HP by
// the final-boss survive-at-1HP cap) transforms into Primal Cascoon, it must be
// HEALED to full for stage 2 - otherwise it starts on 1 HP and dies to the next
// chip, which reads as an instant "second-stage win". The enemy form change runs
// through QuietFormChangePhase, whose end() heals any isClassicFinalBoss enemy.
describe.skipIf(!RUN)("ER final boss: Primal Cascoon survives the stage-2 transform (#94)", () => {
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
      .startingLevel(50)
      .enemyLevel(50)
      .enemySpecies(SpeciesId.CASCOON)
      .ability(AbilityId.BALL_FETCH)
      .enemyAbility(AbilityId.BALL_FETCH)
      .enemyMoveset(MoveId.SPLASH)
      .moveset(MoveId.SPLASH);
  });

  afterEach(() => {
    setErDifficulty("ace");
  });

  test("Cascoon -> Primal form change in the final-boss context heals to full (no self-death)", async () => {
    setErDifficulty("elite");
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const scene = game.scene;
    const cascoon = game.field.getEnemyPokemon();
    expect(cascoon.species.speciesId).toBe(SpeciesId.CASCOON);
    expect(cascoon.formIndex).toBe(0); // phase 1

    // Reproduce the phase-1 state: a classic final boss whittled down to 1 HP.
    // (isClassicFinalBoss is a computed getter, so spy it rather than assign.)
    vi.spyOn(scene.currentBattle, "isClassicFinalBoss", "get").mockReturnValue(true);
    cascoon.hp = 1;

    // Drive the SAME enemy form change initFinalBossPhaseTwo runs on the Elite path.
    const changed = scene.triggerPokemonFormChange(cascoon, SpeciesFormChangeManualTrigger, false);
    expect(changed, "the ''->'primal' manual form change must fire").toBe(true);

    // Drive the phase loop (it is parked at CommandPhase): the unshifted
    // QuietFormChangePhase + the PokemonHealPhase it unshifts in end() resolve as the
    // turn proceeds. Both sides Splash, so no damage interferes with the heal check.
    game.move.select(MoveId.SPLASH);
    await game.phaseInterceptor.to("TurnEndPhase");

    // THE FIX (#94): it transformed to Primal (BST 726) AND was healed up to (near)
    // full for stage 2, so it does NOT start on the 1 HP sliver and instantly die
    // (which read as an immediate "second-stage win"). A few HP may be shaved by
    // end-of-turn effects; the point is it is nowhere near the death sliver.
    expect(cascoon.formIndex).toBe(1); // primal
    expect(cascoon.hp).toBeGreaterThan(cascoon.getMaxHp() * 0.8);
  });
});
