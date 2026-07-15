/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Two-engine Commander automatic commands must be identified by the serialized source Pokemon id. The two
// authoritative clients can hold different presentation objects for that same id; object identity
// is therefore not a valid command-ownership predicate.

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { BattlerTagType, CommandedTag } from "#data/battler-tags";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { CommandPhase } from "#phases/command-phase";
import { GameManager } from "#test/framework/game-manager";
import { buildDuo, drainLoopback, installDuoLogCapture, withClient } from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op Commander automatic command materialization", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setCoopRendezvousWaitMs(60_000);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`commander-command-phase-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    logs?.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    resetCoopRendezvousWaitMs();
  });

  it.each([
    { ownerRole: "host" as const, fieldIndex: COOP_HOST_FIELD_INDEX },
    { ownerRole: "guest" as const, fieldIndex: COOP_GUEST_FIELD_INDEX },
  ])("$ownerRole-owned Commander source crosses the exact barrier without exposing local command UI", async ({
    ownerRole,
    fieldIndex,
  }) => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    const ownerCtx = ownerRole === "host" ? rig.hostCtx : rig.guestCtx;
    const ownerScene = ownerRole === "host" ? rig.hostScene : rig.guestScene;
    const ownerRuntime = ownerRole === "host" ? rig.hostRuntime : rig.guestRuntime;
    const peerCtx = ownerRole === "host" ? rig.guestCtx : rig.hostCtx;
    const peerRuntime = ownerRole === "host" ? rig.guestRuntime : rig.hostRuntime;
    const wave = ownerScene.currentBattle.waveIndex;
    const turn = ownerScene.currentBattle.turn;
    const point = `cmd:${wave}:${turn}`;

    await withClient(peerCtx, () => {
      peerRuntime.rendezvous.arrive(point);
    });
    await drainLoopback();

    const arriveSpy = vi.spyOn(ownerRuntime.rendezvous, "arrive");
    const broadcastSpy = vi.spyOn(ownerRuntime.battleSync, "broadcastLocalCommand");
    let commandUiOpened = false;
    let sourceObjectsWereDistinct = false;

    await withClient(ownerCtx, async () => {
      const commander = ownerScene.getPlayerField()[fieldIndex];
      const commandedAlly = commander.getAllies()[0];
      const separatelyMaterializedCommander = { id: commander.id };
      sourceObjectsWereDistinct = !Object.is(separatelyMaterializedCommander, commander);

      const commandedTag = new CommandedTag(commander.id);
      vi.spyOn(commandedTag, "getSourcePokemon").mockReturnValue(separatelyMaterializedCommander as never);
      vi.spyOn(commandedAlly, "getTag").mockReturnValue(commandedTag as never);
      const setModeSpy = vi.spyOn(ownerScene.ui, "setMode");

      ownerScene.currentBattle.turnCommands = {};
      new CommandPhase(fieldIndex).start();
      await Promise.resolve();

      commandUiOpened = setModeSpy.mock.calls.some(
        ([mode, openedFieldIndex]) =>
          (mode === UiMode.COMMAND || mode === UiMode.FIGHT) && openedFieldIndex === fieldIndex,
      );
    });

    expect(sourceObjectsWereDistinct, "the regression uses distinct objects for one durable Pokemon id").toBe(true);
    expect(
      arriveSpy.mock.calls.map(call => String(call[0])),
      "the automatic Commander command still announces its owned reciprocal boundary",
    ).toContain(point);
    expect(ownerScene.currentBattle.turnCommands[fieldIndex]).toMatchObject({
      command: Command.FIGHT,
      move: { move: MoveId.NONE },
      skip: true,
    });
    expect(commandUiOpened, "a Commander automatic skip never exposes actionable local input").toBe(false);
    expect(
      broadcastSpy,
      "the inert Commander skip is not relayed as a selectable MoveId.NONE command",
    ).not.toHaveBeenCalled();

    logs.flush();
  }, 120_000);

  it("reclassifies a guest-owned Commander skip materialized while its reciprocal barrier is closed", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    const wave = rig.guestScene.currentBattle.waveIndex;
    const turn = rig.guestScene.currentBattle.turn;
    const point = `cmd:${wave}:${turn}`;
    const commander = rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
    const commandedAlly = commander.getAllies()[0];
    const commandedTag = new CommandedTag(commander.id);
    let authoritativeTagReady = false;
    const originalGetTag = commandedAlly.getTag.bind(commandedAlly);
    const getTagSpy = vi
      .spyOn(commandedAlly, "getTag")
      .mockImplementation(tagType =>
        tagType === BattlerTagType.COMMANDED && authoritativeTagReady
          ? (commandedTag as never)
          : originalGetTag(tagType),
      );
    const setModeSpy = vi.spyOn(rig.guestScene.ui, "setMode");

    rig.guestScene.currentBattle.turnCommands = {};
    await withClient(rig.guestCtx, async () => {
      new CommandPhase(COOP_GUEST_FIELD_INDEX).start();
      await Promise.resolve();
    });
    expect(
      rig.guestScene.currentBattle.turnCommands[COOP_GUEST_FIELD_INDEX],
      "the early guest check legitimately precedes the host's post-summon Commander materialization",
    ).toBeUndefined();

    // This models the host's post-summon refresh becoming authoritative while the guest is sealed at
    // cmd:<wave>:<turn>. The arrival releases that same boundary; no local command UI may flash open.
    authoritativeTagReady = true;
    await withClient(rig.hostCtx, () => {
      rig.hostRuntime.rendezvous.arrive(point);
    });
    await withClient(rig.guestCtx, async () => {
      await drainLoopback();
      await Promise.resolve();
    });

    expect(getTagSpy.mock.calls.length, "Commander ownership is re-evaluated after reciprocal release").toBeGreaterThan(
      1,
    );
    expect(rig.guestScene.currentBattle.turnCommands[COOP_GUEST_FIELD_INDEX]).toMatchObject({
      command: Command.FIGHT,
      move: { move: MoveId.NONE },
      skip: true,
    });
    expect(
      setModeSpy.mock.calls.some(
        ([mode, openedFieldIndex]) =>
          (mode === UiMode.COMMAND || mode === UiMode.FIGHT) && openedFieldIndex === COOP_GUEST_FIELD_INDEX,
      ),
      "a late authoritative Commander tag closes the boundary without exposing selectable input",
    ).toBe(false);

    logs.flush();
  }, 120_000);
});
