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
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { buildDuo, type DuoRig, installDuoLogCapture, withClient } from "#test/tools/coop-duo-harness";
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

  function wireGuestCommand(rig: DuoRig): void {
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.TACKLE,
      targets: [BattlerIndex.ENEMY_2],
    }));
  }

  it("a Roar-induced wild flee broadcasts waveResolved('flee') to the guest (no strand)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    // Spy on the host's authoritative wave-resolved send (the exact wire call broadcastCoopWaveResolved
    // makes). Before the #838 fix this fired for win/capture/AttemptRunPhase-flee but NEVER for the
    // Roar-induced wild flee, so the guest stranded.
    const sendSpy = vi.spyOn(rig.hostRuntime.battleStream, "sendWaveResolved");

    await withClient(rig.hostCtx, async () => {
      // Partner (guest slot) TACKLEs enemy 2 -> KO; host lead ROARs enemy 1 -> it flees LAST (no ally).
      game.move.select(MoveId.ROAR, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("BattleEndPhase", false);
    });

    const fleeCalls = sendSpy.mock.calls.filter(([, outcome]) => outcome === "flee");
    expect(fleeCalls.length, "the host broadcast waveResolved('flee') for the wild flee").toBeGreaterThan(0);
    logs.flush();
  }, 300_000);
});
