/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE player-party ARRAY-ORDER transposition on a GUEST-owned VOLUNTARY SWITCH (#849, the
// deep-wave soak sibling of #836's host-owned FAINT-replacement transposition). When the GUEST
// voluntarily switches its field mon (Command.POKEMON), the host's SwitchSummonPhase SWAPS the party
// array (`party[fieldIndex] <-> party[slotIndex]`) so the replacement now sits at the front (field)
// slot and the switched-out mon moves to the bench slot the replacement vacated. The GUEST must end
// the turn with a BYTE-IDENTICAL party order, or the per-slot exp deltas / erMoneyStreaks / field
// presentation land on the wrong mon (the live "on-field slots 1 and 3 swapped after a voluntary
// switch" symptom -> a saveDataDigest divergence at a deep wave).
//
// This is the A/B DISCRIMINATOR the #849 investigation needs:
//   - If the guest CONVERGES to the host across the full production replay (checkpoint field reconcile
//     + the end-of-turn authoritative full-state reorder), then PRODUCTION heals a voluntary-switch
//     transposition and the soak finding is a DRIVER-FIDELITY gap (World A).
//   - If the guest DIVERGES, the guest does not mirror the host's voluntary-switch swap (World B) and
//     the fix belongs in the production switch/replay path.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-voluntary-switch-transposition.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { captureCoopChecksumState, summonCoopPlayerField } from "#data/elite-redux/coop/coop-battle-engine";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Move } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type CoopResyncProbe,
  type DuoRig,
  driveGuestReplayTurn,
  installCoopResyncProbe,
  installDuoLogCapture,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The guest voluntarily switches its field lead (slot 1) for the guest-owned bench mon at slot 3. */
const GUEST_SWITCH_TO_SLOT = 3;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

const order = (scene: BattleScene): number[] => scene.getPlayerParty().map(p => p.species?.speciesId ?? 0);

describe.skipIf(!RUN)(
  "co-op DUO voluntary switch transposition: a guest voluntary switch keeps the party order byte-identical (#849)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;
    let accuracySpy: MockInstance | undefined;
    let resyncProbe: CoopResyncProbe | undefined;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      // Force-hit so scripted damage is deterministic. A determinism knob (not required, but keeps the
      // enemy GROWL harmless and the wave from ending early through a stray miss).
      accuracySpy = vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
      setCoopFaintSwitchWaitMs(4000);
      setCoopWaveBarrierMs(50);
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`voluntary-switch-${Date.now()}`);
      game.override
        .battleStyle("double")
        .startingWave(1)
        .enemySpecies(SpeciesId.SHUCKLE)
        .enemyLevel(100)
        .enemyMoveset(MoveId.GROWL)
        .startingLevel(50)
        .moveset([MoveId.SPLASH, MoveId.EARTHQUAKE])
        .disableTrainerWaves();
    });

    afterEach(() => {
      setCoopFaintSwitchWaitMs(60_000);
      setCoopWaveBarrierMs(60_000);
      accuracySpy?.mockRestore();
      accuracySpy = undefined;
      resyncProbe?.restore();
      resyncProbe = undefined;
      logs.dispose();
      clearCoopRuntime();
      initGlobalScene(game.scene);
    });

    afterAll(() => {
      // best-effort
    });

    /** Wire the guest's OWN-slot command answer: a VOLUNTARY SWITCH to the guest-owned bench slot. */
    function wireGuestSwitch(rig: DuoRig): void {
      rig.guestRuntime.battleSync.onCommandRequest(() => ({
        command: Command.POKEMON,
        cursor: GUEST_SWITCH_TO_SLOT,
      }));
    }

    /** Tag co-op ownership the soak way: host owns EVEN party slots, guest owns ODD. */
    function tagOwnership(rig: DuoRig): void {
      for (const scene of [rig.hostScene, rig.guestScene]) {
        const party = scene.getPlayerParty();
        for (let i = 0; i < party.length; i++) {
          party[i].coopOwner = i % 2 === 0 ? "host" : "guest";
        }
      }
    }

    it("guest voluntary switch: guest party ARRAY ORDER matches the host after the turn (no transposition)", async () => {
      await game.classicMode.startBattle(
        SpeciesId.SNORLAX, // 0 host  (field lead - SPLASHes, harmless)
        SpeciesId.GENGAR, // 1 guest (field lead - VOLUNTARILY switches out)
        SpeciesId.LAPRAS, // 2 host  (bench)
        SpeciesId.CHARIZARD, // 3 guest (bench - the guest's switch TARGET; lands on the field)
        SpeciesId.VENUSAUR, // 4 host  (bench)
        SpeciesId.BLASTOISE, // 5 guest (bench)
      );
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestSwitch(rig);
      tagOwnership(rig);
      resyncProbe = installCoopResyncProbe(rig.guestRuntime);

      const turn = rig.hostScene.currentBattle.turn;

      // Both engines start byte-identical.
      expect(order(rig.hostScene), "engines start byte-identical").toEqual(
        withClientSync(rig.guestCtx, () => order(rig.guestScene)),
      );

      // TURN 1 on the HOST: host slot 0 SPLASHes (harmless); the guest slot rides the relay (a VOLUNTARY
      // SWITCH to GENGAR's bench mate CHARIZARD). The host's SwitchSummonPhase SWAPS party[1] <-> party[3].
      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.SPLASH, COOP_HOST_FIELD_INDEX);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      const hostOrderAfter = order(rig.hostScene);
      expect(hostOrderAfter[COOP_GUEST_FIELD_INDEX], "host swapped CHARIZARD onto the guest's field slot").toBe(
        SpeciesId.CHARIZARD,
      );
      expect(hostOrderAfter[GUEST_SWITCH_TO_SLOT], "host moved GENGAR to the vacated bench slot").toBe(
        SpeciesId.GENGAR,
      );

      // GUEST replays the turn through the FULL production path: the eager self-switch mirror
      // (mirrorGuestOwnSwitch, which turn-start-phase runs before diverting - the duo pump starts at
      // CoopReplayTurnPhase so we invoke its exact side-effect here), then the checkpoint field reconcile
      // + the end-of-turn authoritative full-state reorder inside CoopFinalizeTurnPhase.
      await withClient(rig.guestCtx, async () => {
        summonCoopPlayerField(COOP_GUEST_FIELD_INDEX, GUEST_SWITCH_TO_SLOT); // the eager mirror
        await driveGuestReplayTurn(rig.guestScene, turn);
      });

      // ASSERTION: the guest's party ARRAY order is byte-identical to the host - NO transposition.
      expect(
        withClientSync(rig.guestCtx, () => order(rig.guestScene)),
        "guest party order matches the host after a voluntary switch",
      ).toEqual(hostOrderAfter);

      // CHECKSUM CONVERGENCE on the exact fields the live capture diverged on.
      const hostCs = withClientSync(rig.hostCtx, () => captureCoopChecksumState());
      const guestCs = withClientSync(rig.guestCtx, () => captureCoopChecksumState());
      expect(guestCs.party, "party speciesId order matches (no transposition)").toEqual(hostCs.party);
      expect(guestCs.benchHp, "benchHp matches (no fainted/alive slot swap)").toEqual(hostCs.benchHp);

      // A voluntary switch is a player-facing interaction: it must converge with ZERO forced resyncs.
      expect(resyncProbe.count(), "the voluntary switch forced NO resync").toBe(0);

      logs.flush();
    }, 240_000);

    it("guest voluntary switch WITHOUT the eager mirror (soak path): the checkpoint reconcile still converges", async () => {
      await game.classicMode.startBattle(
        SpeciesId.SNORLAX,
        SpeciesId.GENGAR,
        SpeciesId.LAPRAS,
        SpeciesId.CHARIZARD,
        SpeciesId.VENUSAUR,
        SpeciesId.BLASTOISE,
      );
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestSwitch(rig);
      tagOwnership(rig);
      resyncProbe = installCoopResyncProbe(rig.guestRuntime);

      const turn = rig.hostScene.currentBattle.turn;

      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.SPLASH, COOP_HOST_FIELD_INDEX);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      const hostOrderAfter = order(rig.hostScene);

      // The soak / duo pump path: the guest does NOT eager-mirror (turn-start-phase is bypassed); it
      // relies ENTIRELY on the checkpoint field reconcile + the end-of-turn authoritative reorder.
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });

      expect(
        withClientSync(rig.guestCtx, () => order(rig.guestScene)),
        "guest party order matches the host WITHOUT the eager mirror (checkpoint reconcile heals it)",
      ).toEqual(hostOrderAfter);
      expect(resyncProbe.count(), "no forced resync on the soak-path voluntary switch").toBe(0);

      logs.flush();
    }, 240_000);

    it("guest voluntary switch on the WINNING turn (wave ends): the party order still converges (#836-analogous edge)", async () => {
      await game.classicMode.startBattle(
        SpeciesId.SNORLAX,
        SpeciesId.GENGAR,
        SpeciesId.LAPRAS,
        SpeciesId.CHARIZARD,
        SpeciesId.VENUSAUR,
        SpeciesId.BLASTOISE,
      );
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestSwitch(rig);
      tagOwnership(rig);
      resyncProbe = installCoopResyncProbe(rig.guestRuntime);

      const turn = rig.hostScene.currentBattle.turn;

      // Both enemies at 1 HP so the host's spread EARTHQUAKE KOs them THIS turn - the wave ends the same
      // turn the guest voluntarily switches (the "wave ends before the next turn arrives" edge #836 fixed
      // for faints). The switch resolves at turn-start BEFORE the KO, so the host still swaps the array.
      for (const e of rig.hostScene.getEnemyField()) {
        e.hp = 1;
      }
      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.EARTHQUAKE, COOP_HOST_FIELD_INDEX);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      const hostOrderAfter = order(rig.hostScene);
      expect(hostOrderAfter[COOP_GUEST_FIELD_INDEX], "host swapped CHARIZARD onto the guest's field slot").toBe(
        SpeciesId.CHARIZARD,
      );
      expect(
        rig.hostScene.getEnemyField().every(e => e == null || e.isFainted()),
        "the wave was won this turn (enemies fainted)",
      ).toBe(true);

      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });

      expect(
        withClientSync(rig.guestCtx, () => order(rig.guestScene)),
        "guest party order matches the host after a WINNING-turn voluntary switch",
      ).toEqual(hostOrderAfter);
      expect(resyncProbe.count(), "no forced resync on the winning-turn voluntary switch").toBe(0);

      logs.flush();
    }, 240_000);

    it("HOST voluntary switch: the guest mirrors the host's swap purely via the replay (no eager mirror exists)", async () => {
      await game.classicMode.startBattle(
        SpeciesId.SNORLAX, // 0 host - VOLUNTARILY switches out
        SpeciesId.GENGAR, // 1 guest - SPLASHes
        SpeciesId.LAPRAS, // 2 host - the host's switch TARGET
        SpeciesId.CHARIZARD, // 3 guest
        SpeciesId.VENUSAUR, // 4 host
        SpeciesId.BLASTOISE, // 5 guest
      );
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      // The guest slot just SPLASHes (a host-owned voluntary switch is the subject here).
      rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
        command: Command.FIGHT,
        cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
        moveId: MoveId.SPLASH,
        targets: [BattlerIndex.ENEMY],
      }));
      tagOwnership(rig);
      resyncProbe = installCoopResyncProbe(rig.guestRuntime);

      const turn = rig.hostScene.currentBattle.turn;
      const HOST_SWITCH_TO_SLOT = 2;

      // HOST voluntarily switches its own field lead (slot 0, SNORLAX) for its bench LAPRAS (slot 2).
      await withClient(rig.hostCtx, async () => {
        game.doSwitchPokemon(HOST_SWITCH_TO_SLOT);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      const hostOrderAfter = order(rig.hostScene);
      expect(hostOrderAfter[COOP_HOST_FIELD_INDEX], "host swapped LAPRAS onto its own field slot").toBe(
        SpeciesId.LAPRAS,
      );
      expect(hostOrderAfter[HOST_SWITCH_TO_SLOT], "host moved SNORLAX to the vacated bench slot").toBe(
        SpeciesId.SNORLAX,
      );

      // The guest is NOT the owner of slot 0, so mirrorGuestOwnSwitch does NOTHING - the guest mirrors the
      // host's voluntary switch ENTIRELY through the replay (checkpoint field reconcile + authoritative
      // reorder). This is the path a host voluntary switch ALWAYS takes in LIVE play (no eager mirror).
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });

      expect(
        withClientSync(rig.guestCtx, () => order(rig.guestScene)),
        "guest party order matches the host after a HOST voluntary switch",
      ).toEqual(hostOrderAfter);
      expect(resyncProbe.count(), "no forced resync on the host voluntary switch").toBe(0);

      logs.flush();
    }, 240_000);

    it("SYMPTOM DIRECTION: a guest that eager-swapped but whose host did NOT switch is REVERTED by the replay", async () => {
      // The live symptom shape (#849): host=[...,GENGAR@1,...,CHARIZARD@3] (un-switched) vs
      // guest=[...,CHARIZARD@1,...,GENGAR@3] (switched). The guest's eager self-switch mirror ran, but the
      // host did NOT execute the switch (both guest slot mons just FIGHT on the host). Production must
      // REVERT the guest's spurious eager swap to the host's authoritative order - proving the guest never
      // ends "ahead" of the host on a voluntary-switch transposition.
      await game.classicMode.startBattle(
        SpeciesId.SNORLAX,
        SpeciesId.GENGAR,
        SpeciesId.LAPRAS,
        SpeciesId.CHARIZARD,
        SpeciesId.VENUSAUR,
        SpeciesId.BLASTOISE,
      );
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      // The guest slot FIGHTS on the host (no switch executed authoritatively).
      rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
        command: Command.FIGHT,
        cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
        moveId: MoveId.SPLASH,
        targets: [BattlerIndex.ENEMY],
      }));
      tagOwnership(rig);
      resyncProbe = installCoopResyncProbe(rig.guestRuntime);

      const turn = rig.hostScene.currentBattle.turn;

      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.SPLASH, COOP_HOST_FIELD_INDEX);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      const hostOrderAfter = order(rig.hostScene);
      // The host did NOT switch: GENGAR stays on the guest's field slot.
      expect(hostOrderAfter[COOP_GUEST_FIELD_INDEX], "host did NOT switch (GENGAR stays on the field slot)").toBe(
        SpeciesId.GENGAR,
      );

      await withClient(rig.guestCtx, async () => {
        // The guest SPECULATIVELY eager-mirrors a switch the host never executed (the symptom root).
        summonCoopPlayerField(COOP_GUEST_FIELD_INDEX, GUEST_SWITCH_TO_SLOT);
        expect(order(rig.guestScene)[COOP_GUEST_FIELD_INDEX], "guest speculatively swapped CHARIZARD in").toBe(
          SpeciesId.CHARIZARD,
        );
        await driveGuestReplayTurn(rig.guestScene, turn);
      });

      expect(
        withClientSync(rig.guestCtx, () => order(rig.guestScene)),
        "the replay REVERTED the guest's spurious eager swap to the host's authoritative order",
      ).toEqual(hostOrderAfter);
      expect(resyncProbe.count(), "no forced resync reverting the spurious eager swap").toBe(0);

      logs.flush();
    }, 240_000);
  },
);
