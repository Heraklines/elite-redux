/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op M4 PUSH-SNAPSHOT LAUNCH (#633 M4; see
// docs/plans/2026-07-02-coop-authoritative-replication-redesign.md section 3.6).
//
// M4 makes launch DESYNC-PROOF BY CONSTRUCTION: the host serializes its coherent session
// (`getSessionSaveData()`) and PUSHES it; the guest BOOTS from that snapshot via the
// production-hardened resume machinery (`applyCoopLaunchSession`) and rolls NO enemy / arena /
// party of its own - so it can never diverge at launch. The old model had the guest re-derive
// its enemy/arena from a pinned seed (a latent desync surface); this replaces that with adopting
// the host's authoritative bytes.
//
// This is the REAL two-engine proof of the design's M4 assertion ("state converges at wave start"):
// a SECOND real engine (the guest BattleScene) that is DELIBERATELY PERTURBED off the host's state
// boots from the host's launch snapshot and its full-state checksum SNAPS BACK to equal the host's -
// proving the boot reconstructs the session, not a vacuous match. The wire half (the launchSnapshot
// round-trip + that the `requestEnemyParty` POLL is deleted) is pinned engine-free in
// coop-battle-stream.test.ts ("launch snapshot + poll deletion (#633 M4)").
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-launch-snapshot.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { captureCoopChecksum } from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { materializeCoopLoadedPlayerField } from "#phases/encounter-phase";
import { GameManager } from "#test/framework/game-manager";
import { buildDuo, installDuoLogCapture, withClient } from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Serialize the host's coherent session EXACTLY as `EncounterPhase.broadcastCoopLaunchSnapshot` does. */
function serializeHostLaunchSnapshot(hostScene: BattleScene): string {
  return JSON.stringify(hostScene.gameData.getSessionSaveData(), (_k, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO M4 push-snapshot launch: guest boots from the host snapshot (#633 M4)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`launch-snapshot-${Date.now()}`);
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
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene).
    initGlobalScene(game.scene);
  });

  it("a perturbed guest boots from the host launch snapshot and CONVERGES to the host wave-start state", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

    // HOST: serialize its coherent launch session (what broadcastCoopLaunchSnapshot pushes) + its checksum.
    const hostJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const hostChecksum = await withClient(rig.hostCtx, () => captureCoopChecksum());

    // PERTURB the guest so its state DIVERGES from the host - this makes the convergence assertion
    // MEANINGFUL (not a vacuous pass off buildDuo's initial mirror already matching).
    await withClient(rig.guestCtx, () => {
      rig.guestScene.money += 999_999;
    });
    const guestBefore = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(guestBefore, "the perturbed guest DIVERGES from the host before the boot").not.toBe(hostChecksum);

    // GUEST: BOOT from the host's launch snapshot (rolls nothing of its own).
    const booted = await withClient(rig.guestCtx, () => rig.guestScene.gameData.applyCoopLaunchSession(hostJson));
    expect(booted, "the guest booted from the host launch snapshot").toBe(true);

    // ... and it must now be BYTE-EQUAL to the host at wave start (the M4 convergence guarantee).
    const guestAfter = await withClient(rig.guestCtx, () => captureCoopChecksum());
    expect(
      guestAfter,
      "guest full-state checksum EQUALS the host's after booting from the snapshot (converged, generated nothing)",
    ).toBe(hostChecksum);

    // LIVE regression (2026-07-12): the launch snapshot is captured before the host's summon chain.
    // Restore therefore loads the party assets but leaves both co-op leads invisible and off-field. The
    // guest cannot run Summon/PostSummon (those derive shared effects), so its loaded EncounterPhase uses
    // the presentation-only materializer. Exercise that exact seam and require BOTH seats + UI bars.
    await withClient(rig.guestCtx, () => {
      const capacity = rig.guestScene.currentBattle.arrangement.playerCapacity;
      expect(materializeCoopLoadedPlayerField(), "both launch leads are materialized").toBe(capacity);
      const field = rig.guestScene.getPlayerField(true);
      expect(field, "guest renders every active co-op player seat").toHaveLength(capacity);
      for (const mon of field) {
        expect(mon.isOnField(), `${mon.name} is seated`).toBe(true);
        expect(mon.visible, `${mon.name} container is visible`).toBe(true);
        expect(mon.getSprite().visible, `${mon.name} sprite is visible`).toBe(true);
        expect(mon.getBattleInfo().visible, `${mon.name} battle UI is visible`).toBe(true);
      }
    });

    logs.flush();
  }, 300_000);
});
