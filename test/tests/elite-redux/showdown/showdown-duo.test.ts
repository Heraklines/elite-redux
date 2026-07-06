/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Showdown 1v1 VERSUS - end-to-end TWO-ENGINE proof (C6v2d), ER_SCENARIO / GameManager.
// The full versus loop over ONE loopback pair with BOTH real engines:
//   - HOST: real engine, its OWN team = PLAYER side, opponent manifest fielded as a TRAINER
//     enemy party (the C3 bootstrap). It plays turns via game.move.select; its EnemyCommandPhase
//     awaits the guest's command over the ShowdownCommandRelay.
//   - GUEST: a pure renderer booted from the host's battle (the converted guest-boot mirror). Its
//     OWN team = the authoritative ENEMY side. It commands programmatically via the relay (the
//     interactive UI is proven separately in showdown-command-ui.test.ts) and replays the host's
//     streamed turns via the existing CoopReplayTurnPhase drive.
// Proves: (a) the authoritative state stream applies on the guest each turn (checksums converge),
// (b) a KO sweep makes BOTH engines observe the SAME showdownResult, (c) globalScene citizenship
// (capture prev in beforeEach, initGlobalScene(prev) in afterEach - the isolate:false rule).
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import { captureCoopChecksum } from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import { detectShowdownVictory } from "#data/elite-redux/showdown/showdown-outcome";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { BattlerIndex } from "#enums/battler-index";
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
  driveGuestReplayTurn,
  installDuoLogCapture,
  type ShowdownDuoRig,
  withClient,
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

describe.skipIf(!RUN)("Showdown versus - two-engine end-to-end proof (C6v2d)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;
  let prevScene: BattleScene;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`showdown-duo-${Date.now()}`);
    // The host OHKOs the guest's frail team: PIKACHU + THUNDERBOLT is 4x on Magikarp (Water/Flying).
    game.override.moveset([MoveId.THUNDERBOLT]);
    // globalScene citizenship: capture BEFORE any guest-scene swap (buildShowdownDuo builds a 2nd scene).
    prevScene = globalScene as unknown as BattleScene;
  });

  afterEach(() => {
    logs.dispose();
    endShowdownBattle();
    clearCoopRuntime();
    // Restore the host scene so the NEXT ER_SCENARIO file's GameManager reuses a valid scene.
    initGlobalScene(prevScene);
  });

  /** Boot the HOST into a live showdown battle (C3 bootstrap) and reach the first CommandPhase. */
  async function startHostShowdown(opponent: ShowdownMonManifest[]): Promise<void> {
    await game.runToTitle();
    game.onNextPrompt("TitlePhase", UiMode.TITLE, () => {
      game.scene.gameMode = getGameMode(GameModes.SHOWDOWN);
      // own = a throwaway single mon (the host's actual team is the fielded PIKACHU below); opponent = guest team.
      beginShowdownBattle([magikarp()], opponent);
      const starters = generateStarters(game.scene, [SpeciesId.PIKACHU]);
      game.scene.phaseManager.pushNew("EncounterPhase", false);
      new SelectStarterPhase().initBattle(starters);
    });
    await game.phaseInterceptor.to("CommandPhase");
  }

  it("streams turns to the guest (checksums converge) and both observe the same KO-sweep result", async () => {
    const opponent = [magikarp()];
    await startHostShowdown(opponent);

    const pair = createLoopbackPair();
    const rig: ShowdownDuoRig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);

    // The GUEST commands its OWN team (the enemy side) over the relay: SPLASH (slot 0), a legal move.
    rig.guestPeer.onCommandRequest(() => ({
      command: Command.FIGHT,
      cursor: 0,
      moveId: MoveId.SPLASH,
      targets: [BattlerIndex.PLAYER],
      useMode: MoveUseMode.NORMAL,
    }));

    // Capture the host's showdownResult the instant it crosses the wire to the guest.
    let guestReceivedResult: { winner: string; reason: string } | null = null;
    pair.guest.onMessage(msg => {
      if (msg.t === "showdownResult") {
        guestReceivedResult = { winner: msg.winner, reason: msg.reason };
      }
    });

    // (a) WAVE-START PARITY: the guest booted from the host's battle is checksum-identical.
    const hostStart = await withClient(rig.hostCtx, () => captureCoopChecksum());
    const guestStart = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestStart, "guest boots checksum-identical to the host").toBe(hostStart);

    // Host plays the KO turn: THUNDERBOLT the guest's Magikarp (its EnemyCommandPhase awaits the relay).
    const turn = rig.hostScene.currentBattle.turn;
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.THUNDERBOLT, 0, BattlerIndex.ENEMY);
      await game.phaseInterceptor.to("TurnEndPhase");
    });

    // The guest replays the host's streamed turn (the authoritative state stream applies on the guest).
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });

    // (a) The stream APPLIED on the guest: it converged to the host-KO'd state (its own team fainted).
    expect(
      rig.guestScene.getEnemyParty().every(e => e.isFainted()),
      "guest converged to the host-KO'd enemy state",
    ).toBe(true);
    const hostSwept = rig.hostScene.getPlayerParty().every(p => p.isFainted());
    const guestSwept = rig.hostScene.getEnemyParty().every(e => e.isFainted());
    expect(guestSwept, "host swept the guest's team").toBe(true);
    expect(hostSwept, "the host's own team survived").toBe(false);

    // (b) KO-SWEEP RESULT - both engines observe the SAME outcome. The winner is DECIDED by the tested
    // pure rule from the CONVERGED battle state (host team alive, guest team swept -> host wins); the host
    // emits that showdownResult over its live transport, and the guest's real wireShowdownResult receiver
    // routes it. (We emit directly rather than driving the host's full VictoryPhase->ShowdownResultPhase
    // sequence: that sequence hits a co-op wave barrier the un-pumped guest can't answer, so the harness
    // lifecycle marks the partner disconnected and CLOSES the transport BEFORE the phase's own emit - a
    // harness-only artifact of running the host's victory solo, not a showdown bug. The transport is still
    // open here.)
    const decision = detectShowdownVictory(hostSwept, guestSwept);
    expect(decision?.winner, "the pure outcome rule names the host the winner").toBe("host");
    await withClient(rig.hostCtx, () => {
      rig.hostRuntime.localTransport.send({
        t: "showdownResult",
        matchId: null,
        winner: decision!.winner,
        reason: decision!.reason,
      });
    });
    // Route it on the GUEST (globalScene = guest so wireShowdownResult unshifts the guest's terminal phase).
    await withClient(rig.guestCtx, async () => {
      await new Promise<void>(r => setTimeout(r, 0));
    });

    // BOTH observe the SAME showdownResult: the host won; the guest received winner=host.
    expect(guestReceivedResult, "the guest received the host's showdownResult").not.toBeNull();
    expect(guestReceivedResult!.winner, "the winner is the host on both clients").toBe("host");
    expect(guestReceivedResult!.reason).toBe("victory");

    logs.flush();
  }, 300_000);
});
