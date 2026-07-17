/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { setErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { GameModes } from "#enums/game-modes";
import { SpeciesId } from "#enums/species-id";
import { TrainerSlot } from "#enums/trainer-slot";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import { buildDuo, drainLoopback, withClient } from "#test/tools/coop-duo-harness";
import { getPokemonSpecies } from "#utils/pokemon-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op classic finale stage-one normalization", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setErDifficulty("ace");
    game = new GameManager(phaserGame);
    game.override.battleStyle("double").startingWave(200);
  });

  afterEach(() => {
    setErDifficulty("ace");
    clearCoopRuntime();
    initGlobalScene(game.scene);
    vi.restoreAllMocks();
  });

  it("starts the co-op finale as one canonical Eternatus instead of two random bosses", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);

    expect(game.scene.currentBattle.isClassicFinalBoss).toBe(true);
    expect(game.scene.currentBattle.double, "phase one is single; initFinalBossPhaseTwo enables double").toBe(false);
    expect(game.scene.currentBattle.enemyParty).toHaveLength(1);
    expect(game.scene.currentBattle.enemyParty[0]?.species.speciesId).toBe(SpeciesId.ETERNATUS);
  });

  it("does not grant finale immortality to an unrelated segmented enemy", async () => {
    await game.classicMode.startBattle(SpeciesId.MAGIKARP);
    const unrelatedBoss = game.scene.addEnemyPokemon(getPokemonSpecies(SpeciesId.DODRIO), 200, TrainerSlot.NONE);
    unrelatedBoss.setBoss(true, 2);
    unrelatedBoss.hp = unrelatedBoss.getMaxHp();

    unrelatedBoss.damage(unrelatedBoss.hp, true, true, true);

    expect(unrelatedBoss.hp, "only Eternatus/Cascoon stage one may be held at 1 HP").toBe(0);
  });

  it("opens the host command without a fabricated guest rendezvous while stage one has no guest slot", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, scene => {
      scene.gameMode = getGameMode(GameModes.COOP);
    });
    expect(
      rig.hostScene.getPlayerParty().some(mon => mon.coopOwner === "guest" && !mon.isFainted()),
      "the partner has healthy bench Pokemon, so only exact stage-one geometry may bypass the wait",
    ).toBe(true);
    const point = `cmd:${rig.hostScene.currentBattle.waveIndex}:${rig.hostScene.currentBattle.turn}`;
    const rendezvousSpy = vi.spyOn(rig.hostRuntime.rendezvous, "rendezvous");
    const arriveSpy = vi.spyOn(rig.hostRuntime.rendezvous, "arrive");

    await withClient(rig.hostCtx, async () => {
      const command = rig.hostScene.phaseManager.getCurrentPhase();
      expect(command.phaseName).toBe("CommandPhase");
      command.start();
      await drainLoopback();
    });

    expect(
      rendezvousSpy,
      "final-boss stage one cannot wait for a guest CommandPhase that does not exist",
    ).not.toHaveBeenCalled();
    expect(arriveSpy, "the host still publishes its exact command boundary").toHaveBeenCalledWith(point);
    expect(rig.hostScene.ui.getMode(), "the host's real command UI opened").toBe(UiMode.COMMAND);
  });
});
