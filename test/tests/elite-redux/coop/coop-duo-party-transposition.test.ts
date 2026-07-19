/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE player-party ARRAY-ORDER transposition on a HOST-owned faint-replacement (live seed
// lzvAD3J749mCz1eNGVBSKWXW, Youngster Wes, wave 5). When a HOST-owned FIELD lead faints, the host's
// SwitchSummonPhase SWAPS the party array (`party[slotIndex] = fainted; party[fieldIndex] = replacement`)
// so the replacement now sits at the front (field) slot and the fainted lead moves to the bench slot the
// replacement vacated. The WATCHER (the guest) used to mirror a host-owned faint only at the NEXT turn
// resolution, so between the faint and that turn - or forever, if the wave ends first - the guest kept the
// STALE order: its fainted lead still at the front slot, the replacement still on the bench. That party-order
// TRANSPOSITION is the ONE root of TWO live symptoms:
//   1. EXP/level desync ("my mon is a level behind my partner's"): the host commits the settled post-exp
//      state as Authority V2 wave material; the guest applies it at BattleEnd. Under the OLD per-slot
//      exp-delta relay a transposed slot held the WRONG species and the leveled bench mon's level-up was
//      SKIPPED and lost; the id-based V2 material apply mutates by Pokemon.id, so the level-up follows the mon.
//   2. Switch-in / faint presentation on the wrong mon: `getPlayerField()` reads `party.slice(0, capacity)`,
//      so a transposed array puts the wrong mon at a field slot (the "switch-in invisible then it fainted"
//      report).
//
// THE FIX (two layers):
//   SOURCE (switch-phase.ts OWNER branch): a HOST-owned faint-replacement pushes the SAME out-of-band
//     `CoopPushReplacementCheckpointPhase` the GUEST-owned path already pushes, so the guest materializes
//     the replacement + mirrors the array swap IMMEDIATELY - both engines' party order stays byte-identical.
//   BACKSTOP (coop-battle-engine.ts adoptCoopHostPlayerPartyOrder): a transient transposition ALWAYS heals
//     - the party-order adopt no longer PINS an on-field mon that sits at a BENCH array index (a misaligned
//     slot must be reorderable to the front), and the id-based wave-end full-state apply lands each mon's
//     level-up by Pokemon.id regardless of any residual slot skew.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-party-transposition.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { adoptCoopHostPlayerPartyOrder, captureCoopChecksumState } from "#data/elite-redux/coop/coop-battle-engine";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import {
  broadcastCoopWaveEndState,
  broadcastCoopWaveResolved,
  clearCoopRuntime,
  getCoopWaveBoundaryStatus,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { Move } from "#moves/move";
import { BattleEndPhase } from "#phases/battle-end-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type CoopResyncProbe,
  type DuoRig,
  driveClientPhaseQueueTo,
  driveGuestReplayTurn,
  installCoopResyncProbe,
  installDuoLogCapture,
  pumpDuoDestinations,
  setCoopHarnessLiveEvents,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { hostOwnedFaintPending, registerHostFaintAutoPick } from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

const order = (scene: BattleScene): number[] => scene.getPlayerParty().map(p => p.species?.speciesId ?? 0);

describe.skipIf(!RUN)(
  "co-op DUO party transposition: a host faint-replacement keeps the party order byte-identical",
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
      // Force-hit so the foe's spread ROCK_SLIDE reliably KOs the 1-HP host lead. A determinism knob.
      accuracySpy = vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
      setCoopFaintSwitchWaitMs(4000);
      setCoopWaveBarrierMs(50);
      // #839 next-command barrier: the harness drives the host's turn then replays on the guest (never
      // concurrent command points), so the host's barrier never sees the guest's arrival - fast-pass it
      // via the anti-hang timeout instead of the 60s live default (same pattern as the wave barrier).
      setCoopRendezvousWaitMs(50);
      setCoopHarnessLiveEvents(true);
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`party-transposition-${Date.now()}`);
      game.override
        .battleStyle("double")
        .startingWave(1)
        .enemySpecies(SpeciesId.SHUCKLE)
        .enemyLevel(100)
        .enemyMoveset(MoveId.ROCK_SLIDE)
        .startingLevel(50)
        .moveset([MoveId.SPLASH, MoveId.EARTHQUAKE])
        .disableTrainerWaves();
    });

    afterEach(() => {
      setCoopFaintSwitchWaitMs(60_000);
      setCoopWaveBarrierMs(60_000);
      resetCoopRendezvousWaitMs();
      setCoopHarnessLiveEvents(false);
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

    function wireGuestCommand(rig: DuoRig): void {
      rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
        command: Command.FIGHT,
        cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
        moveId: MoveId.SPLASH,
        targets: [COOP_HOST_FIELD_INDEX + 2],
      }));
    }

    it("host lead faints, host summons its bench replacement: the guest mirrors the array swap + the bench level-up lands (no transposition)", async () => {
      await game.classicMode.startBattle(
        SpeciesId.CHIKORITA, // 0 host  (FRAIL lead at 1 HP; faints - host auto-picks its replacement)
        SpeciesId.SNORLAX, // 1 guest (BULKY lead; survives the spread ROCK_SLIDE)
        SpeciesId.FENNEKIN, // 2 host  (bench - the host's replacement; it takes slot 0 + levels up)
        SpeciesId.CHARIZARD, // 3 guest (bench - alive)
        SpeciesId.LAPRAS, // 4 host  (bench - alive)
        SpeciesId.VENUSAUR, // 5 guest (bench - alive)
      );
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);

      // Host EVEN / guest ODD ownership (the soak's 3-per-player rule) on both engines.
      for (const scene of [rig.hostScene, rig.guestScene]) {
        const party = scene.getPlayerParty();
        for (let i = 0; i < party.length; i++) {
          party[i].coopOwner = i % 2 === 0 ? "host" : "guest";
        }
      }
      // Host lead (slot 0) at 1 HP on both engines so the foe's spread ROCK_SLIDE KOs it this turn.
      rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX].hp = 1;
      withClientSync(rig.guestCtx, () => {
        rig.guestScene.getPlayerField()[COOP_HOST_FIELD_INDEX].hp = 1;
      });

      const turn = rig.hostScene.currentBattle.turn;
      resyncProbe = installCoopResyncProbe(rig.guestRuntime);

      // Both engines start with the SAME order.
      expect(order(rig.hostScene), "engines start byte-identical").toEqual(
        withClientSync(rig.guestCtx, () => order(rig.guestScene)),
      );

      // TURN 1 on the HOST: the host lead SPLASHes (harmless); the foe's ROCK_SLIDE KOs the 1-HP host lead.
      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.SPLASH, COOP_HOST_FIELD_INDEX);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      expect(rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX]?.isFainted() ?? true, "the host lead fainted").toBe(
        true,
      );

      // GUEST renders turn 1 (the faint presentation).
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn);
      });

      // HOST: cross past its own SwitchPhase - it auto-picks FENNEKIN (slot 2), whose SwitchSummonPhase SWAPS
      // the array to [FENNEKIN@0, SNORLAX@1, CHIKORITA@2, ...], then pushes the out-of-band replacement
      // checkpoint (the SOURCE fix).
      await withClient(rig.hostCtx, async () => {
        if (hostOwnedFaintPending(rig)) {
          registerHostFaintAutoPick(game, rig);
        }
        await game.phaseInterceptor.to("CommandPhase", false);
      });
      const hostOrderAfter = order(rig.hostScene);
      expect(hostOrderAfter[0], "host swapped FENNEKIN into the front (field) slot").toBe(SpeciesId.FENNEKIN);
      expect(hostOrderAfter[2], "host moved the fainted CHIKORITA to the vacated bench slot").toBe(SpeciesId.CHIKORITA);

      // GUEST consumes the ordered Authority V2 REPLACEMENT_COMMIT through the real replay/finalize
      // ingress. It must materialize FENNEKIN and the same array swap without a compatibility checkpoint.
      await withClient(rig.guestCtx, async () => {
        // The focused rig has already drained turn N and is parked on its synthetic boot TitlePhase.
        // Production reaches the retained replacement through turn N+1's real replay wait, so drive that
        // same public replay ingress instead of waiting for a finalize phase that cannot exist until the
        // V2 carrier is consumed.
        rig.guestScene.currentBattle.turn = turn + 1;
        await driveGuestReplayTurn(rig.guestScene, turn + 1);
      });

      // LAYER 1 ASSERTION: the guest's party ARRAY order is byte-identical to the host - NO transposition.
      expect(
        withClientSync(rig.guestCtx, () => order(rig.guestScene)),
        "guest party order matches the host",
      ).toEqual(hostOrderAfter);

      // Start both real turn-N+1 command surfaces. This is the mechanical proof that retires the ordered
      // replacement entry; merely constructing/replaying up to CommandPhase is intentionally insufficient.
      const guestCommand = await withClient(rig.guestCtx, () =>
        driveClientPhaseQueueTo(rig.guestScene, "post-replacement guest CommandPhase", {
          matches: phase =>
            phase.phaseName === "CommandPhase"
            && (phase as unknown as { getFieldIndex(): number }).getFieldIndex() === COOP_GUEST_FIELD_INDEX,
        }),
      );
      await withClient(rig.guestCtx, () => {
        guestCommand.start();
      });
      await withClient(rig.hostCtx, () => {
        const hostCommand = rig.hostScene.phaseManager.getCurrentPhase();
        expect(hostCommand.phaseName, "the host retained its prepared post-replacement command").toBe("CommandPhase");
        hostCommand.start();
      });
      await pumpDuoDestinations(rig, 4);

      // The bench mon that took the field (FENNEKIN, host slot 0) fights on + levels up: settle it on the host,
      // then commit the host's complete settled image into an ordered V2 WAVE_ADVANCE and apply it at the
      // guest's retained BattleEnd boundary.
      rig.hostScene.getPlayerParty()[0].level = 55;
      rig.hostScene.getPlayerParty()[0].exp += 5000;
      rig.hostScene.getPlayerParty()[0].calculateStats();
      await withClient(rig.hostCtx, () => {
        broadcastCoopWaveResolved("win");
        broadcastCoopWaveEndState();
      });
      await pumpDuoDestinations(rig, 4);
      let released = 0;
      await withClient(rig.guestCtx, () => {
        const boundary = new BattleEndPhase(true);
        rig.guestScene.phaseManager.clearPhaseQueue();
        rig.guestScene.phaseManager.unshiftPhase(boundary);
        rig.guestScene.phaseManager.shiftPhase();
        expect(rig.guestScene.phaseManager.getCurrentPhase(), "the V2 BattleEnd boundary is current").toBe(boundary);
        vi.spyOn(boundary, "end").mockImplementation(() => {
          released += 1;
        });
        boundary.start();
      });
      expect(released, "the V2 boundary releases only after the settled image applies").toBe(1);
      expect(
        withClientSync(rig.guestCtx, () => getCoopWaveBoundaryStatus(1, rig.guestRuntime)),
        "the guest adopted the host's ordered V2 wave material",
      ).toMatchObject({ authority: "v2", dataApplied: true });

      // LAYER 2 ASSERTION: the leveled mon's level-up LANDED on the guest FENNEKIN. The id-based wave-end
      // apply mutates by Pokemon.id, so the level-up follows the mon regardless of any residual slot skew
      // (PRE-FIX the OLD per-slot exp-delta relay SKIPPED the transposed slot and FENNEKIN stayed a level behind).
      const guestFennekinLevel = withClientSync(rig.guestCtx, () => {
        const fen = rig.guestScene.getPlayerParty().find(p => p.species?.speciesId === SpeciesId.FENNEKIN);
        return fen?.level ?? -1;
      });
      expect(guestFennekinLevel, "the guest's FENNEKIN received the host's level-up (no lost exp)").toBe(55);

      // CHECKSUM CONVERGENCE: the exact fields the live capture diverged on (party / partyLevels / benchHp)
      // now MATCH the host with ZERO residual divergence.
      const hostCs = withClientSync(rig.hostCtx, () => captureCoopChecksumState());
      const guestCs = withClientSync(rig.guestCtx, () => captureCoopChecksumState());
      expect(guestCs.party, "party speciesId order matches (no transposition)").toEqual(hostCs.party);
      expect(guestCs.partyLevels, "partyLevels match (the bench level-up landed)").toEqual(hostCs.partyLevels);
      expect(guestCs.benchHp, "benchHp matches (no fainted/alive slot swap)").toEqual(hostCs.benchHp);

      // ZERO forced resyncs across the faint-replacement (a resync is a player-facing divergence).
      expect(resyncProbe.count(), "the faint-replacement forced NO resync").toBe(0);

      logs.flush();
    }, 240_000);

    it("BACKSTOP: a MISALIGNED on-field transposition (alive mon at a bench array index) heals on the party-order adopt", async () => {
      await game.classicMode.startBattle(
        SpeciesId.CHIKORITA, // 0 host
        SpeciesId.SNORLAX, // 1 guest
        SpeciesId.FENNEKIN, // 2 host
        SpeciesId.CHARIZARD, // 3 guest
        SpeciesId.LAPRAS, // 4 host
        SpeciesId.VENUSAUR, // 5 guest
      );
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);
      for (const scene of [rig.hostScene, rig.guestScene]) {
        const party = scene.getPlayerParty();
        for (let i = 0; i < party.length; i++) {
          party[i].coopOwner = i % 2 === 0 ? "host" : "guest";
        }
      }

      // The HOST is authoritative: FENNEKIN took the field slot 0 (front), fainted CHIKORITA on the bench slot 2.
      const hostTargetOrder = [
        SpeciesId.FENNEKIN,
        SpeciesId.SNORLAX,
        SpeciesId.CHIKORITA,
        SpeciesId.CHARIZARD,
        SpeciesId.LAPRAS,
        SpeciesId.VENUSAUR,
      ];

      // Construct the exact MISALIGNED live state on the GUEST: FENNEKIN's SPRITE is on the field (its object
      // stays field-resident) but its ARRAY index is a BENCH slot (2), while the fainted CHIKORITA holds the
      // FRONT slot (0). This is the un-healable case: pinning the on-field FENNEKIN at its bench array index
      // froze the transposition. We swap ONLY the array (not the field membership) to reproduce it.
      const healed = withClientSync(rig.guestCtx, () => {
        const party = rig.guestScene.getPlayerParty();
        // party currently [CHIKORITA@0 (on-field bi0), SNORLAX@1 (on-field bi1), FENNEKIN@2 (bench), ...].
        // Build the misaligned live state: faint CHIKORITA at the FRONT array slot but leave its sprite
        // field-resident, and put FENNEKIN's SPRITE on the field WITHOUT swapping the array (so FENNEKIN is
        // on-field at the BENCH array index 2 - the exact "alive mon at a bench array index" transposition).
        party[0].hp = 0; // CHIKORITA fainted, still holding the front array slot
        const fennekin = party[2];
        rig.guestScene.field.add(fennekin);
        fennekin.switchOutStatus = false;
        expect(party[2].species?.speciesId, "FENNEKIN sits at the BENCH array index").toBe(SpeciesId.FENNEKIN);
        expect(fennekin.isOnField(), "FENNEKIN's sprite is on the field (misaligned)").toBe(true);
        // THE BACKSTOP: adopt the host's authoritative order. PRE-FIX FENNEKIN (on-field, array index 2) is
        // PINNED so it can never move to the front and the transposition is frozen. POST-FIX a misaligned
        // on-field mon (bench array index) is reorderable, so the whole party heals to the host sequence.
        const changed = adoptCoopHostPlayerPartyOrder(hostTargetOrder);
        return { changed, resultOrder: order(rig.guestScene) };
      });

      expect(healed.changed, "the party-order adopt reordered the misaligned transposition").toBe(true);
      expect(healed.resultOrder, "the guest party healed to the host's exact sequence (backstop)").toEqual(
        hostTargetOrder,
      );

      logs.flush();
    }, 240_000);
  },
);
