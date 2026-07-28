/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Failure-first host regression for god-a seed 20260728, wave 115. A trainer Aegislash entered,
// changed to Blade Forme, then fainted. FaintPhase deliberately omitted the now-inert enemy revert,
// but its tween later called Pokemon.leaveField(), which recreated a root-delayed
// QuietFormChangePhase behind CoopTurnCommitPhase and safely terminalized the session as unsettled.

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import { beginCoopRecording, endCoopRecording } from "#data/elite-redux/coop/coop-turn-recorder";
import { AbilityId } from "#enums/ability-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import type { Pokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op recorded form changes settle before immutable turn commit", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(async () => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("single")
      .startingWave(145)
      .enemySpecies(SpeciesId.AEGISLASH)
      .enemyMoveset(MoveId.FLASH_CANNON)
      .moveset([MoveId.SPLASH]);
    await game.classicMode.startBattle(SpeciesId.AEGISLASH);
    game.scene.gameMode = getGameMode(GameModes.COOP);
    beginCoopRecording(globalScene.currentBattle.turn, "form-ordering-regression");
  });

  afterEach(() => {
    endCoopRecording();
    vi.restoreAllMocks();
  });

  function forceBladeForm(mon: Pokemon): void {
    const blade = mon.species.forms.findIndex(form => form.formKey === "blade");
    expect(blade, "the Aegislash fixture exposes its Blade Forme").toBeGreaterThanOrEqual(0);
    mon.formIndex = blade;
    const hasAbility = mon.hasAbility.bind(mon);
    vi.spyOn(mon, "hasAbility").mockImplementation((ability, canApply, ignoreOverride) =>
      ability === AbilityId.STANCE_CHANGE ? true : hasAbility(ability, canApply, ignoreOverride),
    );
  }

  it("does not queue the fainted enemy's inert revert behind CoopTurnCommitPhase", () => {
    const enemy = globalScene.getEnemyPokemon();
    expect(enemy, "the Aegislash enemy fixture is on the field").not.toBeNull();
    forceBladeForm(enemy!);

    globalScene.phaseManager.clearPhaseQueue();
    globalScene.phaseManager.pushNew("CoopTurnCommitPhase");
    enemy!.leaveField();

    expect(
      globalScene.phaseManager.getQueuedPhaseNames(),
      "leaveField cannot recreate the inert enemy QuietFormChangePhase that FaintPhase omitted",
    ).not.toContain("QuietFormChangePhase");
  });

  it("queues a material player revert inside the current subtree, ahead of the commit", () => {
    const player = globalScene.getPlayerPokemon();
    expect(player, "the player Aegislash fixture is on the field").not.toBeNull();
    forceBladeForm(player!);

    globalScene.phaseManager.clearPhaseQueue();
    globalScene.phaseManager.pushNew("CoopTurnCommitPhase");
    player!.leaveField();

    const queued = globalScene.phaseManager.getQueuedPhaseNames();
    expect(queued).toContain("QuietFormChangePhase");
    expect(
      queued.indexOf("QuietFormChangePhase"),
      "the material form mutation executes before immutable commit capture",
    ).toBeLessThan(queued.indexOf("CoopTurnCommitPhase"));
  });
});
