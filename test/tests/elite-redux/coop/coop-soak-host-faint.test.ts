/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// REGRESSION for the #845 co-op SOAK "NO-PARK" host-faint strand (finding #845).
//
// The seeded two-engine soak stranded on a HOST-owned player faint: the host's real SwitchPhase opened its
// OWNER-path PARTY picker and NOTHING drove it, so PhaseInterceptor.to("CommandPhase") parked forever
// (fingerprint: hostPhase "SwitchPhase", UI mode PARTY). Root cause was a HARNESS DRIVING GAP, not a
// production bug: the soak driver armed its host faint auto-picker (registerHostFaintAutoPick) PREEMPTIVELY
// at the top of each turn while the host still sat at CommandPhase - and that picker's own expireFn drops it
// the instant a prompt tick sees CommandPhase, so it self-expired before the turn even resolved. The faint's
// SwitchPhase opens at TURN END (after TurnEndPhase, during the next crossing), by which point no picker was
// armed. It only surfaced once a real host faint finally happened - on a leaked FIXED trainer wave
// (rival / evil-grunt waves bypass .disableTrainerWaves() and are tough enough to KO the host).
//
// The fix arms the auto-picker POST-HOC (only after the turn has played, guarded by hostOwnedFaintPending),
// mirroring run-scenario.ts's registerFaintSwitch. This test forces a deterministic HOST-owned faint across
// two REAL engines and drives it EXACTLY as the fixed driver does, asserting the host crosses to CommandPhase
// (no strand) with its own-half bench replacement summoned.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-soak-host-faint.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveGuestReplayTurn,
  installDuoLogCapture,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { hostOwnedFaintPending, registerHostFaintAutoPick } from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Host owns EVEN party slots, guest owns ODD - the exact ownership tagging the soak uses. */
function tagOwnership(rig: DuoRig): void {
  for (const scene of [rig.hostScene, rig.guestScene]) {
    const party = scene.getPlayerParty();
    for (let i = 0; i < party.length; i++) {
      party[i].coopOwner = i % 2 === 0 ? "host" : "guest";
    }
  }
}

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op SOAK host-owned faint: the driver drives the host's PARTY picker (#845)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`soak-host-faint-${Date.now()}`);
    setCoopWaveBarrierMs(50);
    setCoopFaintSwitchWaitMs(4000);
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(100)
      .enemyMoveset(MoveId.GROWL)
      .startingLevel(50)
      .moveset([MoveId.EARTHQUAKE, MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    setCoopFaintSwitchWaitMs(60_000);
    logs.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  it("host-owned faint: POST-HOC auto-pick drives the SwitchPhase; the host crosses to CommandPhase", async () => {
    // Party: host slot 0 = SNORLAX, guest slot 1 = GENGAR, bench LAPRAS(2, host) + CHARIZARD(3, guest).
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.LAPRAS, SpeciesId.CHARIZARD);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    tagOwnership(rig);

    // The GUEST's own-slot command is EARTHQUAKE - a spread move that also hits its ALLY (the host's
    // field slot 0). Kept at 1 HP on BOTH engines, that host mon faints deterministically (no enemy AI,
    // no target rolls); the level-100 foes shrug the EQ off so the wave does not end early.
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots, offer }) => {
      const earthquake = offer?.moves.find(move => move.moveId === MoveId.EARTHQUAKE);
      return {
        command: Command.FIGHT,
        cursor: earthquake?.slot ?? moveSlots[0] ?? 0,
        moveId: MoveId.EARTHQUAKE,
        targets: [...(earthquake?.targetSets[0] ?? [BattlerIndex.ENEMY])],
      };
    });
    rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX].hp = 1;
    withClientSync(rig.guestCtx, () => {
      rig.guestScene.getPlayerField()[COOP_HOST_FIELD_INDEX].hp = 1;
    });

    const turn = rig.hostScene.currentBattle.turn;

    // TURN 1 on the HOST: its own slot 0 plays a harmless SPLASH; the guest slot's EARTHQUAKE (relayed)
    // faints the 1-HP host mon. Drive only to TurnEndPhase - the replacement SwitchPhase opens at TURN END.
    // This focused test drives only the host's phase queue, so explicitly materialize the replay guest at
    // the same next-command boundary instead of relying on the removed unilateral timeout continuation.
    const commandPoint = `cmd:${rig.hostScene.currentBattle.waveIndex}:${rig.hostScene.currentBattle.turn}`;
    withClientSync(rig.guestCtx, () => rig.guestRuntime.rendezvous.arrive(commandPoint));
    await drainLoopback();
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.SPLASH, COOP_HOST_FIELD_INDEX);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
    const hostSlotAfterFaint = rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX];
    expect(
      hostSlotAfterFaint == null || hostSlotAfterFaint.isFainted(),
      "the host-owned field slot was vacated by the faint on the host",
    ).toBe(true);
    expect(hostOwnedFaintPending(rig), "a host-owned faint is pending after the turn").toBe(true);

    // The GUEST renders turn 1 (a host-owned faint is host-chosen; the guest just replays it - no picker).
    await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));

    // THE FIX under test: arm the auto-picker POST-HOC (exactly as the fixed driver's armHostFaintAutoPick
    // does), THEN cross to the next CommandPhase. Before the fix the picker was armed preemptively and had
    // already self-expired, so this to("CommandPhase") parked at the open SwitchPhase (the #845 strand).
    await withClient(rig.hostCtx, async () => {
      if (hostOwnedFaintPending(rig)) {
        registerHostFaintAutoPick(game, rig);
      }
      await game.phaseInterceptor.to("CommandPhase");
    });
    await drainLoopback();
    const guestBoundary = await withClient(rig.guestCtx, () => rig.guestRuntime.rendezvous.awaitPartner(commandPoint));
    expect(guestBoundary.timedOut, "post-replacement command boundary was reciprocal").toBe(false);

    expect(
      rig.hostScene.phaseManager.getCurrentPhase()?.phaseName,
      "the host crossed to the next CommandPhase - no NO-PARK strand at the SwitchPhase",
    ).toBe("CommandPhase");
    const hostReplacement = rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX];
    expect(
      hostReplacement?.species.speciesId,
      "the auto-picker summoned the first legal HOST-owned bench mon (LAPRAS)",
    ).toBe(SpeciesId.LAPRAS);
    expect(hostReplacement?.isFainted(), "the replacement is battle-ready on the host").toBe(false);
    expect(hostReplacement?.coopOwner, "the replacement is a HOST-owned mon (owner-legal pick)").toBe("host");

    logs.flush();
  }, 240_000);
});
