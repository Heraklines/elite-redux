/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// THREE-ENGINE co-op M5 N-CLIENT CONVERGENCE PROOF (#633 M5; see
// docs/plans/2026-07-02-coop-authoritative-replication-redesign.md sections 3.4 + 3.6).
//
// M5 generalizes role/ownership to SEATS (authority = seat 0, renderers = seats 1..N-1). The
// convergence architecture is N-client by construction: every renderer BOOTS from the SAME
// authoritative launch snapshot (M4) and computes NOTHING of its own - so N renderers cannot
// diverge from the authority or from EACH OTHER. This is the real three-engine proof:
//
//   1 AUTHORITY (the host GameManager engine) + 2 RENDERERS (two more real BattleScenes),
//   each renderer DELIBERATELY PERTURBED differently off the host state (so the assertion is
//   meaningful, not a vacuous initial-mirror match), then:
//     - renderer 1 receives the launch snapshot over the REAL loopback WIRE
//       (sendLaunchSnapshot -> awaitLaunchSnapshot, the M4 production path), and
//     - renderer 2 boots from the SAME snapshot bytes directly (path-independence),
//   and ALL THREE full-state checksums (which include per-move PP) are byte-equal.
//
// Layer contract (#710 CLAUDE.md): this swaps the Layer-B drivers for the real M4 push-snapshot
// launch path and carries the Layer-C convergence assertion (checksum equality) over to 3 clients,
// exactly as planned for the M5 moment. Layer-A substrate (withClient / buildDuo / buildGuestScene)
// is reused untouched.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-trio-launch-convergence.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import {
  captureCoopChecksum,
  captureCoopChecksumState,
  captureCoopSaveDataNormalized,
} from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, getCoopBattleStreamer, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { coopRoleOfSeat, coopSeatIsAuthority } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  buildGuestScene,
  buildRuntime,
  type ClientCtx,
  drainLoopback,
  emptyGhostSnapshot,
  installDuoLogCapture,
  mirrorHostBattleToGuest,
  withClient,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Serialize the host's coherent session EXACTLY as `EncounterPhase.broadcastCoopLaunchSnapshot` does. */
function serializeHostLaunchSnapshot(hostScene: BattleScene): string {
  return JSON.stringify(hostScene.gameData.getSessionSaveData(), (_k, v: unknown) =>
    typeof v === "bigint" ? v.toString() : v,
  );
}

/** Flip a freshly-built scene into the co-op game mode (shared by all three clients). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op TRIO M5: 1 authority + 2 renderers converge from one launch snapshot (#633 M5)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`trio-launch-${Date.now()}`);
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
    // #710 harness-citizenship: restore the host GameManager scene (extra BattleScenes were built).
    initGlobalScene(game.scene);
  });

  it("BOTH perturbed renderers snap byte-equal to the authority (one over the real wire, one direct)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

    // SEAT MODEL (#633 M5): the trio's seat layout - seat 0 is the sole authority, seats 1..2
    // are renderers (both map to the binary "guest" role until N distinct wire roles land).
    expect(coopSeatIsAuthority(0)).toBe(true);
    expect([1, 2].some(s => coopSeatIsAuthority(s))).toBe(false);
    expect([coopRoleOfSeat(0), coopRoleOfSeat(1), coopRoleOfSeat(2)]).toEqual(["host", "guest", "guest"]);

    // SECOND isolated renderer replica: its own real BattleScene + an independently authenticated runtime
    // on another loopback pair. P33 deliberately refuses snapshot materialization on an unbound controller,
    // so the replica must prove the same Host/Guest run identity before applying the same immutable bytes.
    // This remains a renderer-projection proof; distinct third-seat membership belongs to the topology lane.
    const pair2 = createLoopbackPair();
    const host2Runtime = buildRuntime(pair2.host, "Host", "authoritative");
    const guest2Runtime = buildRuntime(pair2.guest, "Guest", "authoritative");
    host2Runtime.controller.role = "host";
    guest2Runtime.controller.role = "guest";
    expect(
      host2Runtime.controller.restoreCheckpointIdentity(
        rig.hostRuntime.controller.runId,
        rig.hostRuntime.controller.checkpointRevision,
        "isolated-renderer-replica",
      ),
      "the isolated authority endpoint shares the exact launch lineage",
    ).toBe(true);
    setCoopRuntime(host2Runtime);
    host2Runtime.controller.connect();
    setCoopRuntime(guest2Runtime);
    guest2Runtime.controller.connect();
    await drainLoopback();
    const guest2Scene = buildGuestScene(game);
    const guest2Ctx: ClientCtx = {
      label: "guest",
      scene: guest2Scene,
      runtime: guest2Runtime,
      rndState: Phaser.Math.RND.state(),
      ghost: emptyGhostSnapshot(),
      moduleLets: structuredClone(rig.hostCtx.moduleLets!),
      // World-map/biome module state is always isolated, independently of the optional broader
      // module-let isolation switch. Without an owned snapshot, applyCoopLaunchSession restored the
      // host map only into the ambient process global and the next guest-2 swap observed stale state.
      biomeState: structuredClone(rig.hostCtx.biomeState!),
    };
    await withClient(guest2Ctx, () => {
      toCoop(guest2Scene);
      mirrorHostBattleToGuest(rig.hostScene, guest2Scene);
      const gf = guest2Scene.getPlayerField();
      gf[0].coopOwner = "host";
      gf[1].coopOwner = "guest";
    });

    // AUTHORITY: serialize its coherent launch session + capture its checksum (includes per-move PP).
    const wave = rig.hostScene.currentBattle.waveIndex;
    const hostJson = await withClient(rig.hostCtx, () => serializeHostLaunchSnapshot(rig.hostScene));
    const hostChecksum = await withClient(rig.hostCtx, () => captureCoopChecksum());
    const hostState = await withClient(rig.hostCtx, () => structuredClone(captureCoopChecksumState()));
    const hostSaveState = await withClient(rig.hostCtx, () => structuredClone(captureCoopSaveDataNormalized()));

    // PERTURB both renderers DIFFERENTLY so all three states diverge pairwise - the 3-way
    // convergence below is then meaningful (each renderer provably reconstructed, not matched).
    await withClient(rig.guestCtx, () => {
      rig.guestScene.money += 999_999;
    });
    await withClient(guest2Ctx, () => {
      guest2Scene.money += 123_456;
      const lead = guest2Scene.getPlayerField()[0];
      lead.hp = Math.max(1, lead.hp - 5);
    });
    const g1Before = await withClient(rig.guestCtx, () => captureCoopChecksum());
    const g2Before = await withClient(guest2Ctx, () => captureCoopChecksum());
    expect(g1Before, "renderer 1 diverges from the authority before boot").not.toBe(hostChecksum);
    expect(g2Before, "renderer 2 diverges from the authority before boot").not.toBe(hostChecksum);
    expect(g1Before, "the two renderers also diverge from EACH OTHER before boot").not.toBe(g2Before);

    // RENDERER 1: receive the snapshot over the REAL WIRE (the M4 production path) and boot from it.
    const guest1Streamer = await withClient(rig.guestCtx, () => getCoopBattleStreamer());
    expect(guest1Streamer, "renderer 1 has a live battle streamer").not.toBeNull();
    const wireWait = guest1Streamer!.awaitLaunchSnapshot(wave, 10_000);
    await withClient(rig.hostCtx, () => {
      getCoopBattleStreamer()!.sendLaunchSnapshot(wave, hostJson);
    });
    await drainLoopback();
    const wireJson = await wireWait;
    expect(wireJson, "the launch snapshot arrived over the wire byte-identical").toBe(hostJson);
    const booted1 = await withClient(rig.guestCtx, () =>
      rig.guestScene.gameData.applyCoopLaunchSession(wireJson as string),
    );
    expect(booted1, "renderer 1 booted from the wire-received snapshot").toBe(true);

    // RENDERER 2: boot from the SAME snapshot bytes directly (path-independence).
    const booted2 = await withClient(guest2Ctx, () => guest2Scene.gameData.applyCoopLaunchSession(hostJson));
    expect(booted2, "renderer 2 booted from the same snapshot bytes").toBe(true);

    // THE M5 N-CLIENT GUARANTEE: all three full-state checksums are byte-equal (PP included).
    const g1After = await withClient(rig.guestCtx, () => captureCoopChecksum());
    const g2After = await withClient(guest2Ctx, () => captureCoopChecksum());
    const g2State = await withClient(guest2Ctx, () => structuredClone(captureCoopChecksumState()));
    const g2SaveState = await withClient(guest2Ctx, () => structuredClone(captureCoopSaveDataNormalized()));
    expect(g1After, "renderer 1 == authority after boot").toBe(hostChecksum);
    expect(g2SaveState, "renderer 2 exact normalized save state == authority after boot").toEqual(hostSaveState);
    expect(g2State, "renderer 2 exact checksum preimage == authority after boot").toEqual(hostState);
    expect(g2After, "renderer 2 == authority after boot").toBe(hostChecksum);
    expect(g1After, "renderer 1 == renderer 2 (the pairwise N-client convergence)").toBe(g2After);

    logs.flush();
  }, 300_000);
});
