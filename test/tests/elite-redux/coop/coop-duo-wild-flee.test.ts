/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #838 VERIFY-1 - a forced WILD flee must broadcast waveResolved("flee") to the co-op guest.
//
// A Roar / Whirlwind / Dragon Tail against the LAST wild enemy ends the battle through
// BattleEndPhase + NewBattlePhase DIRECTLY (move.ts ForceSwitchOutAttr), BYPASSING AttemptRunPhase
// (the only other place that broadcasts "flee"). Without the fix the host never tells the guest the
// wave resolved, so the pure-renderer guest - which advances the wave ONLY on a host waveResolved -
// strands on the resolved wave forever (P1). This proves the host now broadcasts "flee" on that path.
//
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-wild-flee.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { getCoopStagedWaveAdvanceTransaction } from "#data/elite-redux/coop/coop-wave-operation";
import { BattlerIndex } from "#enums/battler-index";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  driveClientPhaseQueueTo,
  driveDuoGuestTackleThroughPublicUi,
  installDuoLogCapture,
  withClient,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("#838 VERIFY-1: co-op wild-flee wave-advance broadcast", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setCoopWaveBarrierMs(50);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`wild-flee-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      // ROAR (negative priority) resolves LAST, after the partner's TACKLE has KOd the other enemy,
      // so the roared enemy has no active ally -> the wild-flee branch ends the battle.
      .moveset([MoveId.TACKLE, MoveId.ROAR])
      .disableTrainerWaves();
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    logs.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  it("a Roar-induced wild flee reaches the guest's real next-wave COMMAND and completes retained readiness", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

    // A directly-constructed guest BattleScene begins on its inert boot/onboarding queue. Production has
    // already crossed that queue before a live battle; align the harness through its established engine
    // initialization seam so shiftPhase selects the real TurnInit -> Command queue for mirrored wave 1.
    await withClient(rig.guestCtx, () => {
      rig.guestScene.phaseManager.clearAllPhases();
      rig.guestScene.phaseManager.shiftPhase();
    });

    // Submit the guest-owned Tackle through its real reciprocal COMMAND/FIGHT/TARGET_SELECT handlers before
    // the host chooses Roar. This is the same two-engine public-input path used by the multiwave journeys;
    // no command-request stub or detached phase stands in for the guest player.
    await driveDuoGuestTackleThroughPublicUi(game, rig, { restartAlreadyOpenHost: true });

    // Spy on the host's authoritative wave-resolved send (the exact wire call broadcastCoopWaveResolved
    // makes). Before the #838 fix this fired for win/capture/AttemptRunPhase-flee but NEVER for the
    // Roar-induced wild flee, so the guest stranded.
    const sendSpy = vi.spyOn(rig.hostRuntime.battleStream, "sendWaveResolved");

    await withClient(rig.hostCtx, async () => {
      // The guest's public UI already committed TACKLE on enemy 2. Host lead ROARs enemy 1, resolving
      // last after that KO so the remaining wild has no active ally and the forced-flee branch fires.
      game.move.select(MoveId.ROAR, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      await game.phaseInterceptor.to("BattleEndPhase", false);
    });

    const fleeCalls = sendSpy.mock.calls.filter(([, outcome]) => outcome === "flee");
    expect(fleeCalls.length, "the host broadcast waveResolved('flee') for the wild flee").toBeGreaterThan(0);

    // Cross the host's real BattleEnd -> NewBattle -> Encounter queue. BattleEnd commits the retained
    // WAVE_ADVANCE DATA image; stopping before CommandPhase starts guarantees no public continuation has
    // opened yet. This is the no-shop route that the old broadcast-only test never exercised.
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("CommandPhase", false);
    });
    const guestCommand = await withClient(rig.guestCtx, () =>
      driveClientPhaseQueueTo(rig.guestScene, "guest-owned next-wave CommandPhase", {
        matches: phase =>
          phase.phaseName === "CommandPhase"
          && (phase as unknown as { getFieldIndex(): number }).getFieldIndex() === COOP_GUEST_FIELD_INDEX,
      }),
    );
    expect(guestCommand.phaseName, "the guest crossed its real flee tail to CommandPhase").toBe("CommandPhase");
    expect(rig.hostScene.currentBattle.waveIndex, "the host advanced beyond the fled wave").toBe(2);
    expect(rig.guestScene.currentBattle.waveIndex, "the guest advanced beyond the fled wave").toBe(2);

    const stagedBeforeCommand = getCoopStagedWaveAdvanceTransaction(1, rig.guestRuntime.waveOperationBinding);
    expect(stagedBeforeCommand?.dataApplied, "BattleEnd applied the exact retained wave-1 DATA image").toBe(true);
    expect(
      stagedBeforeCommand?.continuationReady,
      "a merely-current CommandPhase is not public continuation evidence",
    ).toBe(false);

    // Start both prepared command phases through the established two-engine public-UI driver. Its COMMAND
    // click is accepted only after the reciprocal rendezvous opens the real active handler, which is the
    // production Ui.coopAuthoritySurfaceReady -> battle-stream notification chain under test.
    await driveDuoGuestTackleThroughPublicUi(game, rig);

    const stagedAfterCommand = getCoopStagedWaveAdvanceTransaction(1, rig.guestRuntime.waveOperationBinding);
    expect(stagedAfterCommand?.dataApplied).toBe(true);
    expect(
      stagedAfterCommand?.continuationReady,
      "the real wave-2 COMMAND handler completes retained flee continuation readiness",
    ).toBe(true);
    expect(
      rig.guestRuntime.battleStream.retainedAuthorityDiagnostics().waiters,
      "the next public command releases retained battle-stream authority too",
    ).toBe(0);
    logs.flush();
  }, 300_000);
});
