/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";
import { assembleCoopRuntime, clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import { applyShowdownSyncCommand } from "#data/elite-redux/showdown/showdown-sync-command";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { SwitchType } from "#enums/switch-type";
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
import { PartyOption } from "#ui/handlers/party-ui-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

const pikachu = (): ShowdownMonManifest => ({
  ...magikarp(),
  speciesId: SpeciesId.PIKACHU,
  rootSpeciesId: SpeciesId.PIKACHU,
  moveset: [MoveId.TACKLE, MoveId.SPLASH, MoveId.THUNDER_WAVE, MoveId.QUICK_ATTACK],
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

async function connectSyncRuntimes(pair: ReturnType<typeof createLoopbackPair>) {
  const host = assembleCoopRuntime(pair.host, {
    username: "Host",
    netcodeMode: "lockstep",
    kind: "versus",
  });
  const guest = assembleCoopRuntime(pair.guest, {
    username: "Guest",
    netcodeMode: "lockstep",
    kind: "versus",
  });
  host.controller.role = "host";
  guest.controller.role = "guest";
  setCoopRuntime(host);
  host.controller.connect();
  setCoopRuntime(guest);
  guest.controller.connect();
  await drainLoopback();
  setCoopRuntime(host);
  return { host, guest };
}

function startWithHeadlessPartyPick(scene: BattleScene, phase: Phase, slotIndex: number): () => void {
  const ui = scene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
  const realSetMode = ui.setMode.bind(ui);
  ui.setMode = (...args: unknown[]): unknown => {
    if (args[0] === UiMode.PARTY) {
      (args[3] as (slot: number, option: PartyOption) => void)(slotIndex, PartyOption.SEND_OUT);
      return Promise.resolve();
    }
    if (args[0] === UiMode.MESSAGE) {
      return Promise.resolve();
    }
    return realSetMode(...args);
  };
  phase.start();
  return () => {
    ui.setMode = realSetMode;
  };
}

describe.skipIf(!RUN)("Showdown Sync - local-perspective dual-engine simulation", () => {
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

  it("fields each player's own team and resolves mirrored commands on both engines", async () => {
    const pair = createLoopbackPair();
    const connectedRuntimes = await connectSyncRuntimes(pair);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      toShowdown(game.scene);
      const own = [pikachu()];
      beginShowdownBattle(own, [magikarp()]);
      const starters = generateStarters(game.scene, [SpeciesId.PIKACHU]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters, true, undefined, own);
    });
    await game.phaseInterceptor.to("CommandPhase");

    const rig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown, {
      netcodeMode: "lockstep",
      connectedRuntimes,
    });
    expect(rig.hostScene.getPlayerParty()[0].species.speciesId).toBe(SpeciesId.PIKACHU);
    expect(rig.hostScene.getEnemyParty()[0].species.speciesId).toBe(SpeciesId.MAGIKARP);
    expect(rig.guestScene.getPlayerParty()[0].species.speciesId).toBe(SpeciesId.MAGIKARP);
    expect(rig.guestScene.getEnemyParty()[0].species.speciesId).toBe(SpeciesId.PIKACHU);

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
      expect(applyShowdownSyncCommand("player", 0, enemyCommand)).toBe(true);
      expect(applyShowdownSyncCommand("enemy", 0, playerAtGuest)).toBe(true);
      installTurnStart(rig.guestScene);
    });

    await withClient(rig.hostCtx, () => driveClientPhaseQueueTo(rig.hostScene, "TurnEndPhase"));
    await withClient(rig.guestCtx, () => driveClientPhaseQueueTo(rig.guestScene, "TurnEndPhase"));

    const hostEnd = await withClient(rig.hostCtx, () => ({
      playerHp: rig.hostScene.getPlayerField()[0].hp,
      enemyHp: rig.hostScene.getEnemyField()[0].hp,
      enemyMaxHp: rig.hostScene.getEnemyField()[0].getMaxHp(),
    }));
    const guestEnd = await withClient(rig.guestCtx, () => ({
      playerHp: rig.guestScene.getPlayerField()[0].hp,
      enemyHp: rig.guestScene.getEnemyField()[0].hp,
      enemyMaxHp: rig.guestScene.getEnemyField()[0].getMaxHp(),
    }));
    expect(guestEnd.playerHp).toBe(hostEnd.enemyHp);
    expect(guestEnd.enemyHp).toBe(hostEnd.playerHp);
    expect(guestEnd.enemyMaxHp).toBe(rig.hostScene.getPlayerField()[0].getMaxHp());
    expect(hostEnd.enemyHp).toBeLessThan(hostEnd.enemyMaxHp);
    logs.flush();
  }, 300_000);

  it("relays the guest's forced replacement and seats the same bench mon on both engines", async () => {
    const pair = createLoopbackPair();
    const connectedRuntimes = await connectSyncRuntimes(pair);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      toShowdown(game.scene);
      const own = [pikachu()];
      beginShowdownBattle(own, [magikarp(), magikarp()]);
      const starters = generateStarters(game.scene, [SpeciesId.PIKACHU]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters, true, undefined, own);
    });
    await game.phaseInterceptor.to("CommandPhase");

    const rig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown, {
      netcodeMode: "lockstep",
      connectedRuntimes,
    });
    const hostReplacementId = rig.hostScene.getEnemyParty()[1].id;
    const guestReplacementSpecies = rig.guestScene.getPlayerParty()[1].species.speciesId;
    expect(guestReplacementSpecies).toBe(rig.hostScene.getEnemyParty()[1].species.speciesId);

    const installHostReplacementPhase = (scene: BattleScene): Phase => {
      scene.getEnemyParty()[0].hp = 0;
      scene.phaseManager.clearAllPhases();
      const phase = scene.phaseManager.create("ShowdownEnemyFaintSwitchPhase", 0);
      (scene.phaseManager as unknown as { currentPhase: Phase }).currentPhase = phase;
      return phase;
    };
    const installGuestReplacementPhase = (scene: BattleScene): Phase => {
      scene.getPlayerParty()[0].hp = 0;
      scene.phaseManager.clearAllPhases();
      const phase = scene.phaseManager.create("SwitchPhase", 0, 0, true, false);
      (scene.phaseManager as unknown as { currentPhase: Phase }).currentPhase = phase;
      return phase;
    };
    const hostPhase = withClientSync(rig.hostCtx, () => installHostReplacementPhase(rig.hostScene));
    const guestPhase = withClientSync(rig.guestCtx, () => installGuestReplacementPhase(rig.guestScene));

    // Keep the host context ambient while loopback microtasks deliver the guest's choice.
    initGlobalScene(rig.hostScene);
    setCoopRuntime(rig.hostRuntime);
    withClientSync(rig.hostCtx, () => hostPhase.start());
    const restoreGuestUi = withClientSync(rig.guestCtx, () =>
      startWithHeadlessPartyPick(rig.guestScene, guestPhase, 1),
    );
    await drainLoopback();
    restoreGuestUi();

    await withClient(rig.hostCtx, () => driveClientPhaseQueueTo(rig.hostScene, "TurnInitPhase"));
    await withClient(rig.guestCtx, () => driveClientPhaseQueueTo(rig.guestScene, "TurnInitPhase"));

    expect(rig.hostScene.getEnemyParty()[0].id).toBe(hostReplacementId);
    expect(rig.guestScene.getPlayerParty()[0].species.speciesId).toBe(guestReplacementSpecies);
    expect(rig.hostScene.getEnemyField()[0].id).toBe(hostReplacementId);
    expect(rig.guestScene.getPlayerField()[0].species.speciesId).toBe(guestReplacementSpecies);
    logs.flush();
  }, 300_000);

  it("relays a Teleport replacement instead of letting the mirrored trainer AI choose", async () => {
    const pair = createLoopbackPair();
    const connectedRuntimes = await connectSyncRuntimes(pair);
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      toShowdown(game.scene);
      const own = [pikachu()];
      beginShowdownBattle(own, [magikarp(), magikarp(), magikarp()]);
      const starters = generateStarters(game.scene, [SpeciesId.PIKACHU]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters, true, undefined, own);
    });
    await game.phaseInterceptor.to("CommandPhase");

    const rig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown, {
      netcodeMode: "lockstep",
      connectedRuntimes,
    });
    const chosenPartyIndex = 2;
    const chosenId = rig.guestScene.getPlayerParty()[chosenPartyIndex].id;
    expect(rig.hostScene.getEnemyParty()[chosenPartyIndex].id).toBe(chosenId);

    const installEnemyWaiter = (scene: BattleScene): Phase => {
      scene.phaseManager.clearAllPhases();
      const phase = scene.phaseManager.create("ShowdownEnemyFaintSwitchPhase", 0);
      (scene.phaseManager as unknown as { currentPhase: Phase }).currentPhase = phase;
      return phase;
    };
    const installTeleportPicker = (scene: BattleScene): Phase => {
      scene.phaseManager.clearAllPhases();
      const phase = scene.phaseManager.create("SwitchPhase", SwitchType.SWITCH, 0, true, true, true);
      (scene.phaseManager as unknown as { currentPhase: Phase }).currentPhase = phase;
      return phase;
    };
    const enemyWaiter = withClientSync(rig.hostCtx, () => installEnemyWaiter(rig.hostScene));
    const teleportPicker = withClientSync(rig.guestCtx, () => installTeleportPicker(rig.guestScene));

    initGlobalScene(rig.hostScene);
    setCoopRuntime(rig.hostRuntime);
    withClientSync(rig.hostCtx, () => enemyWaiter.start());
    const restoreGuestUi = withClientSync(rig.guestCtx, () =>
      startWithHeadlessPartyPick(rig.guestScene, teleportPicker, chosenPartyIndex),
    );
    await drainLoopback();
    restoreGuestUi();

    await withClient(rig.hostCtx, () => driveClientPhaseQueueTo(rig.hostScene, "TurnInitPhase"));
    await withClient(rig.guestCtx, () => driveClientPhaseQueueTo(rig.guestScene, "TurnInitPhase"));

    expect(rig.hostScene.getEnemyParty()[0].id).toBe(chosenId);
    expect(rig.guestScene.getPlayerParty()[0].id).toBe(chosenId);
    expect(rig.hostScene.getEnemyField()[0].id).toBe(chosenId);
    expect(rig.guestScene.getPlayerField()[0].id).toBe(chosenId);

    const { allMoves } = await import("#data/data-lists");
    const teleport = allMoves[MoveId.TELEPORT];
    const forceSwitch = teleport.attrs.find(attr => attr.constructor.name === "ForceSwitchOutAttr");
    expect(forceSwitch).toBeDefined();

    const hostQueue = vi.spyOn(rig.hostScene.phaseManager, "queueDeferred").mockImplementation(() => undefined);
    withClientSync(rig.hostCtx, () => {
      const enemy = rig.hostScene.getEnemyField()[0];
      expect(forceSwitch!.apply(enemy, enemy, teleport, [])).toBe(true);
    });
    expect(hostQueue).toHaveBeenCalledWith("ShowdownEnemyFaintSwitchPhase", 0);
    hostQueue.mockRestore();

    const guestQueue = vi.spyOn(rig.guestScene.phaseManager, "queueDeferred").mockImplementation(() => undefined);
    withClientSync(rig.guestCtx, () => {
      const player = rig.guestScene.getPlayerField()[0];
      expect(forceSwitch!.apply(player, player, teleport, [])).toBe(true);
    });
    expect(guestQueue).toHaveBeenCalledWith("SwitchPhase", SwitchType.SWITCH, 0, true, true, true);
    guestQueue.mockRestore();
    logs.flush();
  }, 300_000);
});
