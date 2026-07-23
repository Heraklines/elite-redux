/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";
import { captureCoopChecksum } from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import { applyShowdownSyncCommand } from "#data/elite-redux/showdown/showdown-sync-command";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { PokemonMove } from "#data/moves/pokemon-move";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectStarterPhase } from "#phases/select-starter-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildShowdownDuo,
  drainLoopback,
  driveClientPhaseQueueTo,
  installDuoLogCapture,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { generateStarters } from "#test/utils/game-manager-utils";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

const magikarp = (): ShowdownMonManifest => ({
  speciesId: SpeciesId.MAGIKARP,
  formIndex: 0,
  level: 100,
  shiny: false,
  variant: 0,
  abilityIndex: 0,
  nature: 0,
  ivs: [31, 31, 31, 31, 31, 31],
  moveset: [MoveId.SPLASH, MoveId.TACKLE, MoveId.FLAIL, MoveId.BOUNCE],
  item: "LEFTOVERS",
  rootSpeciesId: SpeciesId.MAGIKARP,
  erBlackShiny: false,
  baseCost: 4,
});

function toShowdown(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.SHOWDOWN);
}

function installTurnStart(scene: BattleScene): void {
  const manager = scene.phaseManager;
  manager.clearAllPhases();
  const phase = manager.create("TurnStartPhase");
  (manager as unknown as { currentPhase: Phase }).currentPhase = phase;
  phase.start();
}

describe.skipIf(!RUN)("Showdown Sync - canonical dual-engine simulation", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let previousScene: BattleScene;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    previousScene = globalScene as BattleScene;
    logs = installDuoLogCapture(`showdown-sync-duo-${Date.now()}`);
  });

  afterEach(() => {
    logs.dispose();
    endShowdownBattle();
    clearCoopRuntime();
    initGlobalScene(previousScene);
  });

  it("exchanges both human commands and resolves the same turn on both canonical engines", async () => {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      toShowdown(game.scene);
      beginShowdownBattle([magikarp()], [magikarp()]);
      const starters = generateStarters(game.scene, [SpeciesId.PIKACHU]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    await game.phaseInterceptor.to("CommandPhase");
    game.scene.getPlayerParty()[0].moveset = [
      new PokemonMove(MoveId.TACKLE),
      new PokemonMove(MoveId.SPLASH),
      new PokemonMove(MoveId.THUNDER_WAVE),
      new PokemonMove(MoveId.QUICK_ATTACK),
    ];

    const pair = createLoopbackPair();
    const rig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown, { netcodeMode: "lockstep" });
    const hostStart = await withClient(rig.hostCtx, () => captureCoopChecksum());
    const guestStart = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestStart).toBe(hostStart);
    expect(rig.guestScene.getPlayerParty()[0].species.speciesId).toBe(SpeciesId.PIKACHU);
    expect(rig.guestScene.getEnemyParty()[0].species.speciesId).toBe(SpeciesId.MAGIKARP);

    const turn = rig.hostScene.currentBattle.turn;
    const playerCommand = {
      command: Command.FIGHT,
      cursor: 0,
      moveId: MoveId.TACKLE,
      targets: [BattlerIndex.ENEMY],
      useMode: MoveUseMode.NORMAL,
    };
    const enemyCommand = {
      command: Command.FIGHT,
      cursor: 0,
      moveId: MoveId.SPLASH,
      targets: [BattlerIndex.PLAYER],
      useMode: MoveUseMode.NORMAL,
    };

    const hostAwait = rig.hostRelay.awaitCommand(turn);
    const guestAwait = rig.guestPeer.awaitCommand(turn);
    rig.hostRelay.sendCommand(turn, playerCommand);
    rig.guestPeer.sendCommand(turn, enemyCommand);
    await drainLoopback();
    const [enemyAtHost, playerAtGuest] = await Promise.all([hostAwait, guestAwait]);
    expect(enemyAtHost).toEqual(enemyCommand);
    expect(playerAtGuest).toEqual(playerCommand);
    if (enemyAtHost == null || playerAtGuest == null) {
      throw new Error("Sync command exchange unexpectedly timed out");
    }

    await withClient(rig.hostCtx, () => {
      expect(applyShowdownSyncCommand("player", 0, playerCommand)).toBe(true);
      expect(applyShowdownSyncCommand("enemy", 0, enemyAtHost)).toBe(true);
      installTurnStart(rig.hostScene);
    });
    await withClient(rig.guestCtx, () => {
      expect(applyShowdownSyncCommand("player", 0, playerAtGuest)).toBe(true);
      expect(applyShowdownSyncCommand("enemy", 0, enemyCommand)).toBe(true);
      installTurnStart(rig.guestScene);
    });

    await withClient(rig.hostCtx, () => driveClientPhaseQueueTo(rig.hostScene, "TurnEndPhase"));
    await withClient(rig.guestCtx, () => driveClientPhaseQueueTo(rig.guestScene, "TurnEndPhase"));

    const hostEnd = await withClient(rig.hostCtx, () => ({
      checksum: captureCoopChecksum(),
      playerHp: rig.hostScene.getPlayerField()[0].hp,
      enemyHp: rig.hostScene.getEnemyField()[0].hp,
      enemyMaxHp: rig.hostScene.getEnemyField()[0].getMaxHp(),
    }));
    const guestEnd = await withClient(rig.guestCtx, () => ({
      checksum: captureCoopChecksum(),
      playerHp: rig.guestScene.getPlayerField()[0].hp,
      enemyHp: rig.guestScene.getEnemyField()[0].hp,
      enemyMaxHp: rig.guestScene.getEnemyField()[0].getMaxHp(),
    }));
    expect(guestEnd).toEqual(hostEnd);
    expect(hostEnd.enemyHp).toBeLessThan(hostEnd.enemyMaxHp);
    logs.flush();
  }, 300_000);

  it("relays the guest's forced replacement and seats the same bench mon on both engines", async () => {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      toShowdown(game.scene);
      beginShowdownBattle([magikarp()], [magikarp(), magikarp()]);
      const starters = generateStarters(game.scene, [SpeciesId.PIKACHU]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    await game.phaseInterceptor.to("CommandPhase");

    const pair = createLoopbackPair();
    const rig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown, { netcodeMode: "lockstep" });
    const hostReplacementId = rig.hostScene.getEnemyParty()[1].id;
    const guestReplacementId = rig.guestScene.getEnemyParty()[1].id;
    expect(guestReplacementId).toBe(hostReplacementId);

    const installReplacementPhase = (scene: BattleScene): Phase => {
      scene.getEnemyParty()[0].hp = 0;
      scene.phaseManager.clearAllPhases();
      const phase = scene.phaseManager.create("ShowdownEnemyFaintSwitchPhase", 0);
      (scene.phaseManager as unknown as { currentPhase: Phase }).currentPhase = phase;
      return phase;
    };
    const hostPhase = withClientSync(rig.hostCtx, () => installReplacementPhase(rig.hostScene));
    const guestPhase = withClientSync(rig.guestCtx, () => installReplacementPhase(rig.guestScene));

    // Keep the host context ambient while loopback microtasks deliver the guest's choice.
    initGlobalScene(rig.hostScene);
    setCoopRuntime(rig.hostRuntime);
    withClientSync(rig.hostCtx, () => hostPhase.start());
    withClientSync(rig.guestCtx, () => {
      guestPhase.start();
      const handler = rig.guestScene.ui.handlers[UiMode.SHOWDOWN_SYNC_COMMAND] as unknown as {
        processInput(button: Button): boolean;
      };
      expect(handler.processInput(Button.ACTION)).toBe(true);
    });
    await drainLoopback();

    await withClient(rig.hostCtx, () => driveClientPhaseQueueTo(rig.hostScene, "TurnInitPhase"));
    await withClient(rig.guestCtx, () => driveClientPhaseQueueTo(rig.guestScene, "TurnInitPhase"));

    expect(rig.hostScene.getEnemyParty()[0].id).toBe(hostReplacementId);
    expect(rig.guestScene.getEnemyParty()[0].id).toBe(guestReplacementId);
    expect(rig.hostScene.getEnemyField()[0].id).toBe(hostReplacementId);
    expect(rig.guestScene.getEnemyField()[0].id).toBe(guestReplacementId);
    logs.flush();
  }, 300_000);
});
