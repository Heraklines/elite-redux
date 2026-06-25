/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op GUEST = PURE RENDERER (#633, TRACK-2 Phase B). The structural fix: the guest
// resolves NOTHING. Its TurnStartPhase diverts the whole turn to CoopReplayTurnPhase,
// which awaits the host's authoritative turnResolution, renders it, and applies the
// checkpoint. The guest draws no RNG, runs no MovePhase, rolls no enemy AI.
//
// Single-engine harness: there is ONE globalScene; the local engine plays the GUEST by
// flipping the live controller's role to "guest". The host's turnResolution is injected
// over the loopback peer (the partnerTransport) so awaitTurn resolves - the faithful
// headless substitute for a second client. The load-bearing assertions:
//   - EnemyPokemon.getNextMove is NEVER called  (no enemy-AI RNG)
//   - no MovePhase is pushed                     (no move resolution)
//   - applyCoopCheckpoint IS called + the field converges to the streamed values
// That trio is the literal definition of "computes nothing, renders the host's outcome".
// A solo guard asserts the divert is skipped outside co-op (solo unaffected).
// Gated ER_SCENARIO=1 like the other ER engine tests.
// =============================================================================

import { getGameMode } from "#app/game-mode";
import { globalScene } from "#app/global-scene";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import {
  clearCoopRuntime,
  getCoopController,
  getCoopRuntime,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import type { CoopBattleCheckpoint } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { MoveUseMode } from "#enums/move-use-mode";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { EnemyPokemon } from "#field/pokemon";
import { GameManager } from "#test/framework/game-manager";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

describe.skipIf(!RUN)("co-op GUEST = pure renderer - real engine (#633, TRACK-2 Phase B)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    game.override
      .battleStyle("double")
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyMoveset(MoveId.SPLASH)
      .moveset([MoveId.TACKLE, MoveId.SPLASH]);
  });

  afterEach(() => {
    clearCoopRuntime();
  });

  /** Start a co-op double, then flip the LOCAL engine into the GUEST role. */
  const startCoopGuest = async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    // The pure-renderer behavior is the AUTHORITATIVE netcode; opt in explicitly since the
    // selectable default is now "lockstep" (#633, A/B - both engines resolve in lockstep).
    startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    game.scene.gameMode = getGameMode(GameModes.COOP);
    const field = game.scene.getPlayerField();
    field[COOP_HOST_FIELD_INDEX].coopOwner = "host";
    field[COOP_GUEST_FIELD_INDEX].coopOwner = "guest";
    // Flip the local controller to GUEST - the local engine now plays the renderer side.
    getCoopController()!.role = "guest";
    return field;
  };

  /** Build a checkpoint that snaps every field mon to an exact, recognizable hp. */
  const checkpointFromField = (hp: number): CoopBattleCheckpoint => {
    const field = globalScene.getField(true).filter(m => m != null);
    return {
      field: field.map(m => ({
        bi: m.getBattlerIndex(),
        hp,
        maxHp: m.getMaxHp(),
        status: 0,
        statStages: [0, 0, 0, 0, 0, 0, 0],
        fainted: false,
      })),
      weather: 0,
      weatherTurnsLeft: 0,
      terrain: 0,
      terrainTurnsLeft: 0,
    };
  };

  it("the guest's EnemyCommandPhase rolls NO AI (no getNextMove / RNG), writes an inert command", async () => {
    await startCoopGuest();
    globalScene.currentBattle.turnCommands = {};
    const getNextMoveSpy = vi.spyOn(EnemyPokemon.prototype, "getNextMove");

    const enemyPhase = game.scene.phaseManager.create("EnemyCommandPhase", 0);
    enemyPhase.start();

    // The guest must NOT roll enemy AI (that draws battle RNG -> desync).
    expect(getNextMoveSpy, "guest rolls no enemy AI").not.toHaveBeenCalled();
    // It wrote an inert, skipped command so the phase queue stays well-formed.
    const cmd = globalScene.currentBattle.turnCommands[BattlerIndex.ENEMY];
    expect(cmd?.skip).toBe(true);
    expect(cmd?.move?.move).toBe(MoveId.NONE);
  });

  it("the guest's host-slot CommandPhase auto-resolves to an inert command (no menu, no await)", async () => {
    await startCoopGuest();
    globalScene.currentBattle.turnCommands = {};
    const setModeSpy = vi.spyOn(globalScene.ui, "setMode");

    // Field slot 0 is the HOST's mon from the guest's POV: the guest must NOT open a menu
    // or await the host's command - it writes an inert skip and ends.
    const hostSlotPhase = game.scene.phaseManager.create("CommandPhase", COOP_HOST_FIELD_INDEX);
    hostSlotPhase.start();

    const cmd = globalScene.currentBattle.turnCommands[COOP_HOST_FIELD_INDEX];
    expect(cmd?.skip).toBe(true);
    const openedCommandMenu = setModeSpy.mock.calls.some(([mode]) => mode === UiMode.COMMAND);
    expect(openedCommandMenu, "guest opens no menu for the host's slot").toBe(false);
  });

  it("the guest's TurnStartPhase DIVERTS to CoopReplayTurnPhase: no MovePhase, no resolution", async () => {
    const field = await startCoopGuest();

    // Populate inert commands for all four battler slots (as the guest's command phases do),
    // so TurnStartPhase has a well-formed turnCommands to read before it diverts.
    const inert = {
      command: Command.FIGHT,
      move: { move: MoveId.NONE, targets: [], useMode: MoveUseMode.NORMAL },
      skip: true,
    };
    globalScene.currentBattle.turnCommands = {
      [COOP_HOST_FIELD_INDEX]: { ...inert },
      [COOP_GUEST_FIELD_INDEX]: { ...inert },
      [BattlerIndex.ENEMY]: { ...inert },
      [BattlerIndex.ENEMY_2]: { ...inert },
    };

    const pushNewSpy = vi.spyOn(globalScene.phaseManager, "pushNew");
    const turnStart = game.scene.phaseManager.create("TurnStartPhase");
    turnStart.start();

    // The guest queues the REPLAY phase and NOTHING that resolves the turn.
    const pushedReplay = pushNewSpy.mock.calls.some(([name]) => name === "CoopReplayTurnPhase");
    const pushedMove = pushNewSpy.mock.calls.some(([name]) => name === "MovePhase");
    expect(pushedReplay, "guest diverts to CoopReplayTurnPhase").toBe(true);
    expect(pushedMove, "guest queues no MovePhase").toBe(false);
    expect(field.length).toBe(2);
  });

  it("CoopReplayTurnPhase renders the host's outcome: applies the streamed checkpoint to the field", async () => {
    const field = await startCoopGuest();
    const turn = globalScene.currentBattle.turn;

    // Inject the host's authoritative turnResolution over the loopback peer so the replay
    // phase's awaitTurn resolves with it. The checkpoint snaps every mon to hp=7 - a value
    // the live engine never produces on its own, so reading 7 PROVES the guest applied it.
    const partner = getCoopRuntime()!.partnerTransport!;
    partner.send({
      t: "turnResolution",
      turn,
      events: [{ k: "message", text: "Magikarp used Splash!" }],
      checkpoint: checkpointFromField(7),
      checksum: coopEngine.captureCoopChecksum(),
    });
    await new Promise(r => setTimeout(r, 0));

    const pushNewSpy = vi.spyOn(globalScene.phaseManager, "pushNew");
    const replay = game.scene.phaseManager.create("CoopReplayTurnPhase", turn);
    replay.start();
    // Let the awaitTurn promise + render resolve.
    await new Promise(r => setTimeout(r, 0));

    // The field converged to the streamed checkpoint's hp (7) - the host's outcome rendered.
    for (const mon of field) {
      expect(mon.hp, "guest field snaps to the host's streamed checkpoint hp").toBe(7);
    }
    // The replay phase queued the guest's OWN turn-end phases so the run loops (no hang).
    const queuedTurnEnd = pushNewSpy.mock.calls.some(([name]) => name === "TurnEndPhase");
    expect(queuedTurnEnd, "replay phase queues the guest's turn-end (run loops)").toBe(true);
  });

  it("SOLO guard: outside co-op TurnStartPhase resolves normally (no divert, MovePhase pushed)", async () => {
    const field = await startCoopGuest();
    // Flip OUT of co-op: the guest-divert must be skipped, so the normal resolution runs -
    // proving the structural change never touches solo play.
    game.scene.gameMode = getGameMode(GameModes.CLASSIC);

    // A real FIGHT command for slot 0 so TurnStartPhase queues a MovePhase for it.
    globalScene.currentBattle.turnCommands = {
      [COOP_HOST_FIELD_INDEX]: {
        command: Command.FIGHT,
        move: {
          move: MoveId.SPLASH,
          targets: [field[COOP_HOST_FIELD_INDEX].getBattlerIndex()],
          useMode: MoveUseMode.NORMAL,
        },
      },
    };

    const pushNewSpy = vi.spyOn(globalScene.phaseManager, "pushNew");
    const turnStart = game.scene.phaseManager.create("TurnStartPhase");
    turnStart.start();

    const pushedReplay = pushNewSpy.mock.calls.some(([name]) => name === "CoopReplayTurnPhase");
    const pushedMove = pushNewSpy.mock.calls.some(([name]) => name === "MovePhase");
    expect(pushedReplay, "solo must not divert to the replay phase").toBe(false);
    expect(pushedMove, "solo resolves the turn normally (MovePhase pushed)").toBe(true);
  });
});
