/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// #837 - the systemic desync-blind-spot closer. The per-turn co-op checksum now folds a NORMALIZED
// digest of getSessionSaveData() (the saveDataDigest field), so every run-state substrate the session
// save serializes - money-streak, ward-stone charges, relic-battle-state, biome overstay anchor, and
// all player-wide modifiers as full ModifierData blobs incl. their getArgs internals - becomes
// desync-DETECTABLE and HEALABLE by construction (the [typeId,stackCount] modifier digest was blind to
// modifier-internal drift; three MODULE-LET substrates were in NO heal path at all). This file proves:
//   1. GUARD - the digest is DERIVED FROM the save-data serializer, so any NEW substrate is auto-covered.
//   2. NO FALSE DESYNC - two REAL engines sharing state legitimately produce the SAME digest each wave.
//   3. DIVERGE + HEAL - two engines with a deliberately diverged money-streak counter now MISMATCH and
//      heal to convergence THROUGH the existing full-snapshot resync (also overstay + relic).
//   4. STORM GUARD - the healed substrates CONVERGE (so a real drift does not loop); an unconvergeable
//      one still trips the untouched #793 give-up cap (asserted here by construction: the constant + the
//      keyed-by-host-checksum give-up logic are unchanged; the multiwave test's `resyncs <= WAVES` holds).
//   5. TRANSFORM (#836) - a host Ditto/Imposter transform (copied identity in summonData, invisible to
//      speciesId) now converges on the pure-renderer guest through the per-turn field-snapshot heal.
//
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-savedata-digest.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import {
  applyCoopFullSnapshot,
  captureCoopChecksumState,
  captureCoopFieldSnapshot,
  captureCoopFullSnapshot,
  captureCoopSaveDataDigest,
  captureCoopSaveDataNormalized,
} from "#data/elite-redux/coop/coop-battle-engine";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { erBiomeOverstayAnchor, setErBiomeOverstayAnchor } from "#data/elite-redux/er-biome-structure";
import { getErMoneyStreakEntries, restoreErMoneyStreaks } from "#data/elite-redux/er-money-streak";
import { getErRelicBattleState, restoreErRelicBattleState } from "#data/elite-redux/er-relic-battle-state";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveHostRewardShopOwner,
  installDuoLogCapture,
  remirrorWave,
  type ShopPhaseSeam,
  setCoopHarnessModuleLetIsolation,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("#837 co-op full-save-data checksum digest + heal", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setCoopWaveBarrierMs(50);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`savedata-digest-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .moveset([MoveId.TACKLE, MoveId.SPLASH, MoveId.TRANSFORM])
      .disableTrainerWaves();
  });

  afterEach(() => {
    setCoopWaveBarrierMs(60_000);
    setCoopHarnessModuleLetIsolation(false);
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

  async function hostPlayWave(rig: DuoRig): Promise<void> {
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("TurnEndPhase");
    });
  }

  async function leaveRewardShop(rig: DuoRig): Promise<void> {
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const hostOwns = counterBefore % 2 === 0;
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
    const guestShop = withClientSync(rig.guestCtx, () => new SelectModifierPhase()) as unknown as ShopPhaseSeam;
    if (hostOwns) {
      await withClient(rig.hostCtx, () => driveHostRewardShopOwner(hostShop, { takeReward: false }));
      await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop));
    } else {
      await withClient(rig.guestCtx, () => driveHostRewardShopOwner(guestShop, { takeReward: false }));
      await withClient(rig.hostCtx, () => driveGuestRewardWatch(hostShop));
    }
  }

  it("GUARD: the digest is DERIVED FROM getSessionSaveData (new substrate auto-covered) + detects a substrate change", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    await withClient(rig.hostCtx, () => {
      // Every key the normalized view hashes MUST be a real key of getSessionSaveData() - i.e. the digest
      // is a PROJECTION of the serializer's output, never a hand-maintained parallel field list. This is
      // what makes a NEW substrate added to SessionSaveData automatically covered (it is not on the
      // exclusion denylist, so it flows straight into the digest).
      const session = globalScene.gameData.getSessionSaveData() as unknown as Record<string, unknown>;
      const normalized = captureCoopSaveDataNormalized();
      for (const key of Object.keys(normalized)) {
        expect(Object.hasOwn(session, key), `normalized key '${key}' is a real getSessionSaveData key`).toBe(true);
      }
      // The blind-spot substrates the fix targets MUST be present in the hashed view (not excluded).
      for (const key of ["erMoneyStreaks", "erRelicBattleState", "erMapState", "modifiers", "erWardStones"]) {
        expect(Object.hasOwn(normalized, key), `blind-spot substrate '${key}' is hashed by the digest`).toBe(true);
      }
      // DETECTION: mutating a substrate the base checksum is blind to (money-streak) changes the digest.
      const before = captureCoopSaveDataDigest();
      const saved = getErMoneyStreakEntries();
      restoreErMoneyStreaks([[424242, 9]]);
      expect(captureCoopSaveDataDigest(), "a money-streak change moves the save-data digest").not.toBe(before);
      restoreErMoneyStreaks(saved);
      expect(captureCoopSaveDataDigest(), "restoring the money-streak restores the digest").toBe(before);
    });
    logs.flush();
  }, 300_000);

  it("NO FALSE DESYNC: two real engines produce the SAME save-data digest at each wave boundary", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    const WAVES = 3;
    for (let w = 1; w <= WAVES; w++) {
      if (w > 1) {
        await remirrorWave(rig);
      }
      // The full checksum states (which now INCLUDE saveDataDigest) match host-vs-guest at wave start.
      const hostStart = await withClient(rig.hostCtx, () => captureCoopChecksumState());
      const guestStart = await withClient(rig.guestCtx, () => captureCoopChecksumState());
      expect(guestStart.saveDataDigest, `wave ${w}: save-data digest matches host at wave start`).toBe(
        hostStart.saveDataDigest,
      );

      const turn = rig.hostScene.currentBattle.turn;
      await hostPlayWave(rig);
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });

      const hostPost = await withClient(rig.hostCtx, () => captureCoopSaveDataDigest());
      const guestPost = await withClient(rig.guestCtx, () => captureCoopSaveDataDigest());
      expect(guestPost, `wave ${w}: save-data digest matches host post-turn`).toBe(hostPost);

      await leaveRewardShop(rig);
      if (w < WAVES) {
        await withClient(rig.hostCtx, async () => {
          await game.phaseInterceptor.to("CommandPhase");
        });
      }
    }
    logs.flush();
  }, 300_000);

  it("DIVERGE + HEAL: a deliberately diverged money-streak / overstay / relic MISMATCHES then heals to convergence via the resync", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    // Turn ON faithful per-client module-let isolation so the two engines can hold DIFFERENT module state
    // (production has one process per client; the shared-state default would collapse them onto one map).
    setCoopHarnessModuleLetIsolation(true);

    // Seed a KNOWN authoritative host state for the three module-let substrates.
    withClientSync(rig.hostCtx, () => {
      restoreErMoneyStreaks([
        [111, 4],
        [222, 7],
      ]);
      setErBiomeOverstayAnchor(13);
      restoreErRelicBattleState({ wave: 1, lists: { cursedIdol: [111, 222] } });
    });
    // Deliberately DIVERGE the guest's copies (a real host-vs-guest drift).
    withClientSync(rig.guestCtx, () => {
      restoreErMoneyStreaks([[999, 1]]);
      setErBiomeOverstayAnchor(null);
      restoreErRelicBattleState({ wave: 1, lists: {} });
    });

    const hostDigest = await withClient(rig.hostCtx, () => captureCoopSaveDataDigest());
    const guestDigestDiverged = await withClient(rig.guestCtx, () => captureCoopSaveDataDigest());
    expect(guestDigestDiverged, "the diverged guest digest MISMATCHES the host").not.toBe(hostDigest);

    // The host builds the authoritative full-snapshot (what the resync sends); the guest APPLIES it (the
    // exact production resync heal path). This is host-state -> wire -> guest-apply across two real engines.
    const snapshot = await withClient(rig.hostCtx, () => captureCoopFullSnapshot());
    expect(snapshot, "host built a full snapshot").not.toBeNull();
    expect(snapshot?.erMoneyStreaks, "the snapshot carries the host money-streak").toEqual([
      [111, 4],
      [222, 7],
    ]);
    expect(snapshot?.biomeOverstayAnchor, "the snapshot carries the host overstay anchor").toBe(13);

    const healed = withClientSync(rig.guestCtx, () => {
      applyCoopFullSnapshot(snapshot!, /* authoritativeGuest */ true, /* suppressResummon */ false);
      return {
        digest: captureCoopSaveDataDigest(),
        streaks: getErMoneyStreakEntries(),
        overstay: erBiomeOverstayAnchor(),
        relic: getErRelicBattleState(),
      };
    });
    expect(healed.digest, "the guest digest CONVERGED to the host after the resync heal").toBe(hostDigest);
    expect(healed.streaks, "money-streak healed through restoreErMoneyStreaks").toEqual([
      [111, 4],
      [222, 7],
    ]);
    expect(healed.overstay, "overstay anchor healed through setErBiomeOverstayAnchor").toBe(13);
    expect(healed.relic.lists.cursedIdol, "relic-battle-state healed through restoreErRelicBattleState").toEqual([
      111, 222,
    ]);
    logs.flush();
  }, 300_000);

  it("TRANSFORM (#836): a host Ditto/Imposter transform converges on the pure-renderer guest through the field-snapshot heal", async () => {
    await game.classicMode.startBattle(SpeciesId.DITTO, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    // Host lead (Ditto) TRANSFORMs into the enemy Magikarp; partner TACKLEs the other enemy.
    const turn = rig.hostScene.currentBattle.turn;
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TRANSFORM, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("TurnEndPhase");
    });

    // The host's lead is now transformed (copied identity in summonData, species stays DITTO).
    const hostLead = await withClient(rig.hostCtx, () => {
      const lead = rig.hostScene.getPlayerField()[0];
      return {
        species: lead.species.speciesId,
        transformed: lead.isTransformed(),
        formSpecies: lead.summonData.speciesForm?.speciesId ?? 0,
      };
    });
    expect(hostLead.species, "host lead is still base DITTO").toBe(SpeciesId.DITTO);
    expect(hostLead.transformed, "host lead transformed").toBe(true);
    expect(hostLead.formSpecies, "host lead copied MAGIKARP").toBe(SpeciesId.MAGIKARP);

    // The guest replays the turn; the per-turn field snapshot carries + applies the transform.
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });
    const guestLead = await withClient(rig.guestCtx, () => {
      const lead = rig.guestScene.getPlayerField()[0];
      return { transformed: lead.isTransformed(), formSpecies: lead.summonData.speciesForm?.speciesId ?? 0 };
    });
    expect(guestLead.transformed, "the guest's lead CONVERGED to transformed").toBe(true);
    expect(guestLead.formSpecies, "the guest's lead copied the SAME species (MAGIKARP) as the host").toBe(
      SpeciesId.MAGIKARP,
    );
    logs.flush();
  }, 300_000);

  it("TRANSFORM round-trip: readFullMon captures + applyFullMon restores the copied summonData identity", async () => {
    // A focused single-engine proof that the snapshot carry+restore is exact: transform a mon, capture the
    // field snapshot, CLEAR the summonData transform (simulate a not-yet-transformed guest), re-apply, and
    // assert the copied identity is restored byte-for-byte through the same production readFullMon/applyFullMon.
    await game.classicMode.startBattle(SpeciesId.DITTO);
    game.move.select(MoveId.TRANSFORM, 0, BattlerIndex.ENEMY);
    await game.phaseInterceptor.to("TurnEndPhase");

    const lead = globalScene.getPlayerField()[0];
    expect(lead.isTransformed(), "the Ditto transformed").toBe(true);
    const copiedSpecies = lead.summonData.speciesForm?.speciesId ?? 0;
    expect(copiedSpecies, "copied a real species").toBeGreaterThan(0);
    const copiedMoves = lead.getMoveset().map(m => m.moveId);

    const fieldSnap = captureCoopFieldSnapshot();
    expect(fieldSnap, "captured a field snapshot").not.toBeNull();
    const leadSnap = fieldSnap!.find(s => s.bi === lead.getBattlerIndex());
    expect(leadSnap?.transform?.speciesId, "the snapshot carried the copied species").toBe(copiedSpecies);

    // Wipe the guest-side transform, then heal from the snapshot.
    lead.summonData.speciesForm = null;
    lead.summonData.moveset = null;
    lead.summonData.types = [];
    expect(lead.isTransformed(), "cleared the transform").toBe(false);

    // Apply the ORIGINAL (transformed) snapshot back onto the mon via the full-snapshot resync path.
    applyCoopFullSnapshot(
      {
        tick: 999_999,
        field: [leadSnap!],
        weather: globalScene.arena.weather?.weatherType ?? 0,
        weatherTurnsLeft: 0,
        terrain: globalScene.arena.terrain?.terrainType ?? 0,
        terrainTurnsLeft: 0,
        arenaTags: [],
        party: globalScene.getPlayerParty().map(p => p.species.speciesId),
        money: globalScene.money,
        modifiers: [],
      },
      true,
      false,
    );
    const restored = globalScene.getPlayerField()[0];
    expect(restored.isTransformed(), "the transform was RESTORED by the heal").toBe(true);
    expect(restored.summonData.speciesForm?.speciesId ?? 0, "restored the same copied species").toBe(copiedSpecies);
    expect(
      restored.getMoveset().map(m => m.moveId),
      "restored the copied moveset",
    ).toEqual(copiedMoves);
  }, 300_000);
});
