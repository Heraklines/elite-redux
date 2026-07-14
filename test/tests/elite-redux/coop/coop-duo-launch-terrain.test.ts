/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op LAUNCH-SNAPSHOT ARENA TERRAIN adoption (#920).
//
// THE BUG (#920, from a live browser capture): the co-op launch / first-save snapshot the GUEST boots
// from omitted `arena.terrain` (and `arena.weather`). At wave-1 / turn-1 command the HOST had
// terrain=GRASSY (a Grassy-Surge-class wave-1 enemy's on-entry innate set it) while the guest had
// terrain=NONE, a real Grassy heal/boost battle-math divergence. The captured snapshot had arena with
// NEITHER a terrain NOR a weather key: at serialize time both were `undefined`, and `JSON.stringify`
// DROPS an undefined key, so the guest booted terrain-less.
//
// THE INVARIANT THIS GUARDS: once the guest boots from the host's launch snapshot, the guest's arena
// terrain (both the live `arena.terrain.terrainType` AND the guest's own `getSessionSaveData().arena.
// terrain` - the exact serializer the launch snapshot rides on) must EQUAL the host's. No divergence.
//
// 🔴 WHY THE END-STATE INVARIANT (snapshot TIMING, not just serialization) - the load-bearing Part-2
// finding for #920: the landed `?? null` serialization guard in `arena-data.ts` (weather/terrain default
// to null instead of a dropped-undefined key) is NECESSARY but, alone, does NOT fix this divergence.
// The launch snapshot is serialized in `EncounterPhase.runEncounter` INSIDE the first-save `.then()`
// (`broadcastCoopLaunchSnapshot` -> `getSessionSaveData()` -> `new ArenaData(globalScene.arena)`), which
// runs BEFORE `enterEncounterPresentation()` -> `doEncounter()` -> the summon chain where the enemy's
// `PostSummonTerrainChangeAbAttr` (Grassy Surge) calls `arena.trySetTerrain(GRASSY)`. So at the exact
// serialize instant on the host, `arena.terrain` is still NONE/undefined; the host only reaches GRASSY
// LATER, in a PostSummonPhase the pure-renderer guest never runs. `?? null` therefore serializes null
// (correct for that instant) and the guest boots NONE - the host's later GRASSY is never in the snapshot.
// The correct fix must make the guest end up with the host's terrain at the turn-1 command boundary
// (snapshot AFTER on-entry abilities settle, or carry it in the pre-turn-1 checkpoint). This test asserts
// that END invariant, so it guards whatever the correct fix ends up being (it does NOT hard-code the
// serialization mechanism).
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-launch-terrain.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { GameManager } from "#test/framework/game-manager";
import { buildDuo, type DuoRig, installDuoLogCapture, withClient } from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO launch-snapshot: guest adopts the host's on-entry terrain (#920)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setCoopWaveBarrierMs(50);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`launch-terrain-${Date.now()}`);
    // Wave-1 wild DOUBLE where the enemy carries a Grassy-Surge-class on-entry innate. Forcing it as the
    // enemy's ACTIVE ability makes its `PostSummonTerrainChangeAbAttr` fire on summon -> arena GRASSY,
    // exactly the "wave-1 enemy innate set the terrain" situation from the #920 capture.
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .enemyAbility(AbilityId.GRASSY_SURGE)
      .startingLevel(50)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    logs.dispose();
    clearCoopRuntime();
    // #710 harness-citizenship: restore the host GameManager scene (buildDuo builds a 2nd BattleScene),
    // or the NEXT ER_SCENARIO file's GameManager reuses the stripped-down guest scene and crashes.
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  it("guest's launch-snapshot arena terrain equals the host's (GRASSY), no divergence", async () => {
    // HOST reaches wave-1 / turn-1 command. The enemy's Grassy-Surge innate fired in the encounter's
    // PostSummon chain, so the host arena is now GRASSY - the "host had terrain=3 GRASSY" side of #920.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const hostScene = game.scene;
    expect(
      hostScene.arena.terrain?.terrainType,
      "precondition: the wave-1 enemy's Grassy-Surge innate set the HOST arena to GRASSY",
    ).toBe(TerrainType.GRASSY);

    // The launch snapshot the guest boots from IS `getSessionSaveData()` (the exact complete serializer
    // `broadcastCoopLaunchSnapshot` sends over the wire). Its arena is `new ArenaData(globalScene.arena)`;
    // the landed `?? null` guard there is what keeps `terrain` from being dropped as an undefined key.
    const hostSnapshotTerrain = hostScene.gameData.getSessionSaveData().arena.terrain?.terrainType ?? TerrainType.NONE;
    expect(
      hostSnapshotTerrain,
      "the host launch-snapshot serializer carries the live GRASSY terrain (not a dropped/undefined key)",
    ).toBe(TerrainType.GRASSY);

    // GUEST boots from the host's mirror of that launch snapshot (adopts the host arena).
    const pair = createLoopbackPair();
    const rig: DuoRig = await buildDuo(game, pair, setCoopRuntime, toCoop);

    // END INVARIANT at the turn-1 command boundary: the guest must have ADOPTED the host's terrain, both
    // in the LIVE arena and in the guest's OWN launch-grade serializer (getSessionSaveData). Either being
    // NONE while the host is GRASSY is the #920 divergence.
    expect(
      rig.guestScene.arena.terrain?.terrainType ?? TerrainType.NONE,
      "guest live arena.terrain matches the host (GRASSY), no launch-snapshot divergence",
    ).toBe(hostScene.arena.terrain?.terrainType);

    const guestSnapshotTerrain = await withClient(
      rig.guestCtx,
      () => rig.guestScene.gameData.getSessionSaveData().arena.terrain?.terrainType ?? TerrainType.NONE,
    );
    expect(
      guestSnapshotTerrain,
      "guest getSessionSaveData().arena.terrain equals the host's (GRASSY) - the terrain round-trips",
    ).toBe(hostSnapshotTerrain);

    logs.flush();
  }, 300_000);
});
