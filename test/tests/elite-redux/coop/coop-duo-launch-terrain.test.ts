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
// 🔴 GENERALIZED (#920 coordinator requirement): the fix (re-capture the WHOLE authoritative state after the
// PostSummon entry-ability chain settles and re-broadcast it via the existing enemyPartySync carrier) carries
// EVERY on-entry effect - terrain, weather, entry-hazard/screen arena tags, AND entry form changes - not
// terrain alone. So the sibling case below asserts the GENERAL invariant: the guest's wave-start arena
// entry-effect DIGEST (weather + terrain + tags, from the launch-grade `getSessionSaveData().arena`) EQUALS
// the host's post-PostSummon digest. It guards the whole class by construction (the comparator includes
// weather + tags), even though THIS scenario's driver is a terrain innate.
//
// HONEST CAVEAT: the duo harness's `mirrorHostBattleToGuest` copies the host's post-encounter arena to the
// guest DIRECTLY (coop-duo-harness.ts) rather than driving the real SelectStarter->launch handshake, so these
// END-invariant assertions hold today via that mirror and become a TRUE red->green regression for the
// production re-broadcast path once the real launch handshake is driven through the harness (Layer B). The
// end-state form is deliberate: it guards the guest's adopted state regardless of WHICH mechanism delivered it.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-launch-terrain.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import {
  captureCoopAuthoritativeBattleState,
  captureCoopEnemies,
  coopWaveStartEntryEffectSignature,
} from "#data/elite-redux/coop/coop-battle-engine";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import type { CoopAuthoritativeBattleStateV1 } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { TerrainType } from "#data/terrain";
import { AbilityId } from "#enums/ability-id";
import { ErAbilityId } from "#enums/er-ability-id";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import {
  captureCoopEncounterAuthority,
  rebroadcastCoopWaveStartAuthorityAfterEntryEffects,
} from "#phases/encounter-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveClientPhaseQueueTo,
  installDuoLogCapture,
  withClient,
} from "#test/tools/coop-duo-harness";
import { createScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/**
 * General wave-start ENTRY-EFFECT digest (#920 generality): the arena state an on-entry ability chain can
 * mutate between the pre-summon capture and the first CommandPhase - weather (type + turns), terrain (type +
 * turns), and arena TAGS (entry hazards / screens). Built from the launch-grade `getSessionSaveData().arena`
 * serializer, so a divergence in weather OR tags fails it too, not just terrain. Stable key/tag order for a
 * byte comparison. MUST be evaluated under the correct scene's `globalScene` (wrap the guest in withClient).
 */
function arenaEntryEffectDigest(scene: BattleScene): string {
  const arena = scene.gameData.getSessionSaveData().arena;
  return JSON.stringify({
    weather: arena.weather ? [arena.weather.weatherType, arena.weather.turnsLeft] : null,
    terrain: arena.terrain ? [arena.terrain.terrainType, arena.terrain.turnsLeft] : null,
    tags: (arena.tags ?? [])
      .map(t => [String(t.tagType), Number(t.side), Number(t.turnCount)] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1])),
  });
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

  it("treats every pre-command mechanical mutation as wave-start authority while ignoring publication tick", () => {
    const base = {
      version: 1,
      tick: 1,
      weather: 0,
      weatherTurnsLeft: 0,
      terrain: 0,
      terrainTurnsLeft: 0,
      arenaTags: [],
      playerParty: [
        {
          id: 1,
          hp: 20,
          status: 0,
          fainted: false,
          formIndex: 0,
          moveset: [{ moveId: 33, ppUsed: 0 }],
          summonData: { statStages: [0, 0, 0, 0, 0, 0, 0] },
        },
      ],
      enemyParty: [
        {
          id: 2,
          hp: 20,
          status: 0,
          fainted: false,
          formIndex: 0,
          moveset: [{ moveId: 10, ppUsed: 0 }],
          summonData: { statStages: [0, 0, 0, 0, 0, 0, 0] },
        },
      ],
    } as unknown as CoopAuthoritativeBattleStateV1;

    const mutations: ((state: CoopAuthoritativeBattleStateV1) => void)[] = [
      state => {
        state.playerParty[0].hp = 16;
      },
      state => {
        state.playerParty[0].status = 1;
      },
      state => {
        state.playerParty[0].fainted = true;
      },
      state => {
        (state.enemyParty[0].moveset as { ppUsed: number }[])[0].ppUsed = 1;
      },
      state => {
        const summon = state.enemyParty[0].summonData as { statStages: number[] };
        summon.statStages[1] = 1;
      },
    ];
    for (const mutate of mutations) {
      const afterEntry = structuredClone(base);
      mutate(afterEntry);
      expect(coopWaveStartEntryEffectSignature(afterEntry)).not.toBe(coopWaveStartEntryEffectSignature(base));
    }

    expect(coopWaveStartEntryEffectSignature({ ...base, tick: 99 })).toBe(coopWaveStartEntryEffectSignature(base));
  });

  it("captures live post-summon stat stages instead of the stale save projection", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const enemy = game.scene.getEnemyField()[1];
    expect(enemy).toBeDefined();
    enemy.getStatStages()[1] = 1;

    const state = captureCoopAuthoritativeBattleState(game.scene.currentBattle.turn);
    expect(state).not.toBeNull();
    const wireEnemy = state!.enemyParty.find(raw => raw.id === enemy.id);
    expect((wireEnemy?.summonData as { statStages?: number[] } | undefined)?.statStages?.[1]).toBe(1);
  });

  it("guest adopts a Cheap Tactics pre-command HP mutation from the refreshed retained carrier", async () => {
    game.override
      .enemySpecies(SpeciesId.SKWOVET)
      .enemyLevel(2)
      .enemyMoveset(MoveId.SCRATCH)
      .enemyAbility(ErAbilityId.CHEAP_TACTICS as unknown as AbilityId)
      .startingLevel(5);

    await game.classicMode.startBattle(SpeciesId.BULBASAUR, SpeciesId.CHARMANDER);
    const damagedHostHp = game.scene.getPlayerParty().map(mon => mon.hp);
    expect(
      damagedHostHp.some((hp, index) => hp < game.scene.getPlayerParty()[index].getMaxHp()),
      "precondition: Cheap Tactics dealt automatic PostSummon damage before the first command",
    ).toBe(true);

    const pair = createScheduledCoopPair({ automatic: true });
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    pair.setAutomaticDelivery(false);

    await withClient(rig.guestCtx, () => {
      for (const mon of rig.guestScene.getPlayerParty()) {
        mon.hp = mon.getMaxHp();
      }
    });

    const staleState = await withClient(rig.hostCtx, () => captureCoopAuthoritativeBattleState(1));
    expect(staleState).not.toBeNull();
    for (const raw of staleState!.playerParty) {
      const stats = raw.stats as number[];
      raw.hp = stats[0];
    }
    const wave = rig.hostScene.currentBattle.waveIndex;
    await withClient(rig.hostCtx, () => {
      const battle = rig.hostScene.currentBattle;
      const encounter = captureCoopEncounterAuthority(battle);
      rig.hostRuntime.battleStream.sendEnemyParty(
        wave,
        captureCoopEnemies(),
        encounter.mysteryEncounterType,
        battle.battleType,
        staleState!,
        encounter,
      );
      rebroadcastCoopWaveStartAuthorityAfterEntryEffects();
    });

    const refreshed = rig.hostRuntime.battleStream.peekSentEnemyPartyAuthoritativeState(wave);
    expect(refreshed, "host retained a post-Cheap-Tactics carrier").toBeDefined();
    expect(refreshed!.playerParty.map(raw => Number(raw.hp))).toEqual(damagedHostHp);

    await withClient(rig.guestCtx, async () => {
      await drainLoopback();
      rig.guestScene.phaseManager.clearAllPhases();
      rig.guestScene.phaseManager.shiftPhase();
      const command = await driveClientPhaseQueueTo(rig.guestScene, "CommandPhase");
      command.start();
      await drainLoopback();
    });
    expect(
      rig.guestScene.getPlayerParty().map(mon => mon.hp),
      "guest applies the refreshed automatic-move result before opening cmd:1:1",
    ).toEqual(damagedHostHp);

    logs.flush();
  }, 300_000);

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

  it("guest's wave-start arena entry-effect DIGEST equals the host's post-PostSummon (terrain+weather+tags) (#920)", async () => {
    // HOST reaches wave-1 / turn-1 command with the enemy's on-entry innate already fired in the PostSummon
    // chain (GRASSY here). The DIGEST generalizes the guard beyond terrain: it also compares weather and the
    // entry-hazard/screen arena tags, so ANY on-entry effect the guest fails to adopt (not just terrain) is
    // caught. This is the coordinator's "general property", not the terrain-only special case above.
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const hostScene = game.scene;
    expect(
      hostScene.arena.terrain?.terrainType,
      "precondition: the wave-1 enemy's on-entry innate mutated the HOST arena (GRASSY)",
    ).toBe(TerrainType.GRASSY);

    // GUEST boots from the host's mirror of the launch snapshot (adopts the host arena).
    const pair = createLoopbackPair();
    const rig: DuoRig = await buildDuo(game, pair, setCoopRuntime, toCoop);

    // END INVARIANT (Layer C, generalized): the guest's full wave-start entry-effect digest - weather +
    // terrain + entry-hazard tags, taken from the launch-grade getSessionSaveData().arena serializer - must
    // EQUAL the host's post-PostSummon digest. A byte difference is the #920 divergence class (terrain, but
    // now also weather / hazards / any on-entry arena mutation the guest did not adopt before its first command).
    const hostDigest = arenaEntryEffectDigest(hostScene);
    const guestDigest = await withClient(rig.guestCtx, () => arenaEntryEffectDigest(rig.guestScene));
    expect(
      guestDigest,
      "guest adopts the host's FULL on-entry arena state (terrain+weather+tags), no wave-start divergence (#920)",
    ).toBe(hostDigest);

    logs.flush();
  }, 300_000);
});
