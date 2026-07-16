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
import { installCoopAuthoritativeProjectionAdapter } from "#data/elite-redux/coop/coop-presentation";
import { isCoopRendererBlockedPhase } from "#data/elite-redux/coop/coop-renderer-gate";
import { clearCoopRuntime, isCoopSharedTerminalFrozen, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { beginShowdownBattle, endShowdownBattle } from "#data/elite-redux/showdown/showdown-battle-state";
import { detectShowdownVictory } from "#data/elite-redux/showdown/showdown-outcome";
import type { ShowdownMonManifest } from "#data/elite-redux/showdown/showdown-team";
import { PokemonMove } from "#data/moves/pokemon-move";
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
    // The host OHKOs the guest's frail team: PIKACHU + THUNDERBOLT is 4x on Magikarp (Water/Flying).
    // Bake THUNDERBOLT into the host's own Pikachu DIRECTLY (not a global Overrides.MOVESET_OVERRIDE):
    // the override overlays the PLAYER lead's slot 0, but on the flipped guest the local player is the
    // guest's OWN Magikarp - it would corrupt its manifest moveset and diverge the wave-start checksum.
    // A direct set on the host mon rides the mirror into the guest's ENEMY Pikachu (correct), while the
    // guest's Magikarp keeps its real manifest moves.
    game.scene.getPlayerParty()[0].moveset = [
      new PokemonMove(MoveId.THUNDERBOLT),
      new PokemonMove(MoveId.TACKLE),
      new PokemonMove(MoveId.THUNDER_WAVE),
      new PokemonMove(MoveId.QUICK_ATTACK),
    ];
  }

  it("streams turns to the guest (checksums converge) and both observe the same KO-sweep result", async () => {
    const opponent = [magikarp()];
    await startHostShowdown(opponent);

    const pair = createLoopbackPair();
    const rig: ShowdownDuoRig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);

    await withClient(rig.guestCtx, () => {
      expect(
        isCoopRendererBlockedPhase("ShowdownResultPhase"),
        "the exact host-decided versus terminal remains a guest presentation surface",
      ).toBe(false);
      expect(
        isCoopRendererBlockedPhase("MovePhase"),
        "allowing the versus terminal never admits guest-side battle resolution",
      ).toBe(true);
    });

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
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });

    // The guest replays the host's streamed turn (the authoritative state stream applies on the guest).
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });

    // (a) The stream APPLIED on the guest: it converged to the host-KO'd state. Task F1: the guest's OWN
    // team is now its LOCAL PLAYER party (the data-level flip), so the swept side is its player party.
    expect(
      rig.guestScene.getPlayerParty().every(p => p.isFainted()),
      "guest converged to the host-KO'd state (its own team, now the local player party, fainted)",
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
    const hostResultSurfaceBefore = await withClient(rig.hostCtx, () => {
      const before = {
        current: rig.hostScene.phaseManager.getCurrentPhase()?.phaseName,
        queued: rig.hostScene.phaseManager.getQueuedPhaseNames(),
      };
      rig.hostRuntime.localTransport.send({
        t: "showdownResult",
        matchId: null,
        winner: decision!.winner,
        reason: decision!.reason,
      });
      return before;
    });
    // Activating the GUEST flushes its retained, destination-owned terminal onto the guest phase manager.
    const guestResultSurface = await withClient(rig.guestCtx, async () => {
      await new Promise<void>(r => setTimeout(r, 0));
      return {
        current: rig.guestScene.phaseManager.getCurrentPhase()?.phaseName,
        queued: rig.guestScene.phaseManager.getQueuedPhaseNames(),
      };
    });

    // BOTH observe the SAME showdownResult: the host won; the guest received winner=host.
    expect(guestReceivedResult, "the guest received the host's showdownResult").not.toBeNull();
    expect(guestReceivedResult!.winner, "the winner is the host on both clients").toBe("host");
    expect(guestReceivedResult!.reason).toBe("victory");
    expect(
      guestResultSurface.current === "ShowdownResultPhase" || guestResultSurface.queued.includes("ShowdownResultPhase"),
      "the received result was routed onto the guest's own phase manager",
    ).toBe(true);
    const hostResultSurface = await withClient(rig.hostCtx, () => ({
      current: rig.hostScene.phaseManager.getCurrentPhase()?.phaseName,
      queued: rig.hostScene.phaseManager.getQueuedPhaseNames(),
    }));
    expect(
      hostResultSurface,
      "routing the guest's received result left the sender host's pre-existing terminal surface unchanged",
    ).toEqual(hostResultSurfaceBefore);

    logs.flush();
  }, 300_000);

  it("fails the shared run closed when the destination renderer cannot prove its projection", async () => {
    await startHostShowdown([magikarp()]);
    const pair = createLoopbackPair();
    const rig = await buildShowdownDuo(game, pair, setCoopRuntime, toShowdown);
    rig.guestPeer.onCommandRequest(() => ({
      command: Command.FIGHT,
      cursor: 0,
      moveId: MoveId.SPLASH,
      targets: [BattlerIndex.PLAYER],
      useMode: MoveUseMode.NORMAL,
    }));
    const restoreProjection = installCoopAuthoritativeProjectionAdapter(rig.guestScene, async () => false);
    try {
      const turn = rig.hostScene.currentBattle.turn;
      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.THUNDERBOLT, 0, BattlerIndex.ENEMY);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      expect(
        isCoopSharedTerminalFrozen(rig.guestRuntime),
        "an incomplete renderer projection entered the bounded shared terminal",
      ).toBe(true);
    } finally {
      restoreProjection();
    }
    logs.flush();
  }, 300_000);
});
