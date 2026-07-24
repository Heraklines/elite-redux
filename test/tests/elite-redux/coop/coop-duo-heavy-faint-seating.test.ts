/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE guest faint-replacement SEATING in a heavily-fainted party (live seed
// 5ncYiLOw1a4JQZ0MAzWA1izj, wave 3, both parties down to ~2 live mons). #799/#848 fixed the seating
// with only the lead fainted; this isolates the NEXT layer: when the party is heavily fainted and only
// ONE legal replacement remains, SwitchPhase's SOLO "override field index to 0 in a double where 2/3
// legal members fainted at once" collapse (switch-phase.ts) fires. That collapse is NOT co-op-aware -
// each player owns a FIXED field slot (host = 0, guest = 1), so seating a GUEST replacement into slot 0
// (or the two engines resolving the collapse DIFFERENTLY off their own party views) puts the pick in the
// WRONG slot: the host seats it while the guest leaves that slot ABSENT
//   `player PASS2 reposition speciesId=201 from=0 to=1 bi=1`
//   `checksum turn=1 MISMATCH -> resync   field.bi#1: host={sp201 partyIndex:1} guest=<absent>`
// which then re-detects an empty/wrong slot and re-opens the picker in a loop ("switches in, instantly
// faints, endless loop" = issue 4).
//
// THE FIX (switch-phase.ts): in co-op ALWAYS keep this.fieldIndex (the owner's fixed slot), never collapse
// to 0. This repro faints BOTH leads + the whole host bench so only the guest's pick is legal (the exact
// override trigger), then asserts the host seats the pick in the GUEST's slot (1) - NOT collapsed to 0 -
// and that BOTH engines present the SAME species in that slot (no absent slot) with ZERO forced resyncs.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-heavy-faint-seating.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, coopOwnerOfPlayerFieldSlot, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { Move } from "#moves/move";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type CoopResyncProbe,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveDuoGuestTackleThroughPublicUi,
  driveGuestReplayTurn,
  installCoopResyncProbe,
  installDuoLogCapture,
  presentedFieldMon,
  setCoopHarnessLiveEvents,
  settleDuoPromise,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { createScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import { hostOwnedFaintPending, registerHostFaintAutoPick } from "#test/tools/coop-soak-driver";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The guest picks party slot 3 (CHARIZARD) - the LONE legal replacement in the heavily-fainted party. */
const GUEST_PICK_SLOT = 3;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)(
  "co-op DUO heavy-faint seating: a lone-survivor guest replacement seats in the guest slot (not collapsed to 0)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;
    let resyncProbe: CoopResyncProbe | undefined;
    let accuracySpy: MockInstance | undefined;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      // Force-hit so the foe's spread ROCK_SLIDE reliably KOs both 1-HP leads (the framework clamps sub-100
      // accuracy to a guaranteed miss otherwise). A determinism knob.
      accuracySpy = vi.spyOn(Move.prototype, "calculateBattleAccuracy").mockReturnValue(-1);
      setCoopFaintSwitchWaitMs(4000);
      setCoopWaveBarrierMs(50);
      setCoopHarnessLiveEvents(true);
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`heavy-faint-seating-${Date.now()}`);
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

    it("both leads faint, only the guest's pick is legal: the host seats it in the GUEST slot (no collapse-to-0, no absent, no resync)", async () => {
      await game.classicMode.startBattle(
        SpeciesId.AERODACTYL, // 0 host  (lead at 1 HP; faints - host is then OUT)
        SpeciesId.GENGAR, // 1 guest (lead at 1 HP; faints - the guest picks its replacement)
        SpeciesId.LAPRAS, // 2 host  (bench - PRE-FAINTED)
        SpeciesId.CHARIZARD, // 3 guest (the LONE legal replacement)
        SpeciesId.BLASTOISE, // 4 host  (bench - PRE-FAINTED)
        SpeciesId.VENUSAUR, // 5 guest (bench - PRE-FAINTED)
      );
      const pair = createScheduledCoopPair({ automatic: true });
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      // Automatic microtask delivery is boot-only. From the first gameplay input onward every frame must
      // resume under its destination browser's scene/runtime, exactly as two independent tabs behave.
      pair.setAutomaticDelivery(false);

      // Tag host EVEN / guest ODD and PRE-FAINT everything except the leads + CHARIZARD (slot 3), so when the
      // leads fall the ONLY legal party member is CHARIZARD -> SwitchPhase's solo collapse-to-0 override fires.
      for (const scene of [rig.hostScene, rig.guestScene]) {
        const party = scene.getPlayerParty();
        for (let i = 0; i < party.length; i++) {
          party[i].coopOwner = i % 2 === 0 ? "host" : "guest";
        }
        for (const faintedSlot of [2, 4, 5]) {
          party[faintedSlot].hp = 0;
          party[faintedSlot].status = null;
        }
      }

      // Both leads at 1 HP on BOTH engines so the foe's spread ROCK_SLIDE KOs them the SAME turn.
      rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX].hp = 1;
      rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
      withClientSync(rig.guestCtx, () => {
        rig.guestScene.getPlayerField()[COOP_HOST_FIELD_INDEX].hp = 1;
        rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
      });

      const turn = rig.hostScene.currentBattle.turn;
      resyncProbe = installCoopResyncProbe(rig.guestRuntime);

      // TURN 1: both seats choose their harmless first move through the real COMMAND/FIGHT handlers; the
      // foe's spread ROCK_SLIDE KOs both 1-HP leads. This establishes the same V2 command predecessor that
      // two browsers create instead of answering a synthetic commandRequest callback.
      await driveDuoGuestTackleThroughPublicUi(game, rig, {
        restartAlreadyOpenHost: false,
        submitHostTackle: true,
      });
      await withClient(rig.hostCtx, async () => {
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      const hostLead = rig.hostScene.getPlayerField()[COOP_HOST_FIELD_INDEX];
      const guestLead = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      expect(hostLead == null || hostLead.isFainted(), "the HOST-owned lead fainted this turn").toBe(true);
      expect(guestLead == null || guestLead.isFainted(), "the GUEST-owned lead fainted this turn").toBe(true);

      // Render the turn first. Authority V2 orders the host-owned empty replacement before it exposes the
      // guest-owned PARTY picker, so an early setMode callback is not a player-reachable input surface.
      await withClient(rig.guestCtx, () => driveGuestReplayTurn(rig.guestScene, turn));

      // HOST: cross past its SwitchPhases. The HOST-owned slot has no legal same-owner bench -> its picker
      // CLOSES (issue 3). The GUEST-owned slot summons CHARIZARD; PRE-FIX the solo override collapses the seat
      // to slot 0, POST-FIX it seats in the GUEST's own slot (1). Register the host auto-picker in case any
      // host-owned faint remains pending (it will not here, but the guard is harness-standard).
      // The crossing settles under BOTH destination contexts (the b59dba12 B-lane hang class:
      // parked FAINT_SWITCH envelopes starve the host's material-ACK barrier host-only).
      let hostAdvance: Promise<void> | undefined;
      await withClient(rig.hostCtx, async () => {
        if (hostOwnedFaintPending(rig)) {
          registerHostFaintAutoPick(game, rig);
        }
        hostAdvance = game.phaseInterceptor.to("CommandPhase", false) as Promise<void>;
        await drainLoopback();
      });
      expect(hostAdvance, "the host CommandPhase crossing was started").toBeDefined();

      // The host's typed empty-slot commit is the ordered permit for the guest picker. Drive the replica to
      // that exact phase, then choose CHARIZARD with the same DOWN/ACTION inputs a real player sends.
      await withClient(rig.guestCtx, async () => {
        const picker = await driveClientPhaseQueueTo(rig.guestScene, "ordered lone-survivor guest replacement", {
          matches: phase => phase.phaseName === "CoopGuestFaintSwitchPhase",
          pumpPeer: () => withClient(rig.hostCtx, () => drainLoopback()),
        });
        picker.start();
        let actionable = false;
        for (let i = 0; i < 100 && !actionable; i++) {
          await drainLoopback();
          const handler = rig.guestScene.ui.getHandler() as unknown as {
            active?: boolean;
            isCoopV2InputActionable?: () => boolean;
          };
          actionable =
            rig.guestScene.ui.getMode() === UiMode.PARTY
            && handler.active === true
            && handler.isCoopV2InputActionable?.() === true;
        }
        expect(actionable, "the ordered V2 chain opened one actionable guest picker").toBe(true);
        for (let i = 0; i < GUEST_PICK_SLOT; i++) {
          expect(rig.guestScene.ui.processInput(Button.DOWN)).toBe(true);
        }
        expect(rig.guestScene.ui.processInput(Button.ACTION)).toBe(true);
        expect(rig.guestScene.ui.processInput(Button.ACTION)).toBe(true);

        let pickerClosed = false;
        for (let i = 0; i < 100 && !pickerClosed; i++) {
          await withClient(rig.hostCtx, () => drainLoopback());
          await drainLoopback();
          await new Promise<void>(resolve => setTimeout(resolve, 0));
          pickerClosed = rig.guestScene.phaseManager.getCurrentPhase() !== picker;
        }
        expect(pickerClosed, "the guest picker closed under its owning browser context").toBe(true);
      });
      await settleDuoPromise(rig, hostAdvance!, "heavy-faint seating host crossing");

      // THE DISCRIMINATING ASSERTION: the host seated the guest's pick in the GUEST's field slot (1), NOT
      // collapsed to slot 0. Pre-fix slot 1 is ABSENT (the pick landed at slot 0) - the live `guest=<absent>`.
      const hostGuestSlot = presentedFieldMon(rig.hostScene, COOP_GUEST_FIELD_INDEX);
      expect(hostGuestSlot, "the guest's field slot 1 is NOT absent on the host (no collapse-to-0)").not.toBeNull();
      expect(
        hostGuestSlot?.speciesId,
        "the host seated the guest's pick (CHARIZARD) in the GUEST's own slot (1), never collapsed to 0",
      ).toBe(SpeciesId.CHARIZARD);
      expect(
        withClientSync(rig.hostCtx, () => coopOwnerOfPlayerFieldSlot(COOP_GUEST_FIELD_INDEX)),
        "host resolves field slot 1 as GUEST-owned",
      ).toBe("guest");

      // GUEST turn-2 pump: materializes the replacement from the out-of-band checkpoint into the SAME slot.
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn + 1);
      });

      // BOTH engines present the SAME chosen species in the SAME slot (1) - no absent slot, seating agrees.
      withClientSync(rig.guestCtx, () => {
        const guestSlot1 = presentedFieldMon(rig.guestScene, COOP_GUEST_FIELD_INDEX);
        expect(guestSlot1, "the guest's field slot 1 is NOT absent (the live `guest=<absent>` symptom)").not.toBeNull();
        expect(
          guestSlot1?.speciesId,
          "guest materialized its pick (CHARIZARD) in ITS slot - same species/slot as the host",
        ).toBe(SpeciesId.CHARIZARD);
        expect(guestSlot1 != null && guestSlot1.hp > 0 && !guestSlot1.fainted, "the replacement presents ALIVE").toBe(
          true,
        );
        expect(coopOwnerOfPlayerFieldSlot(COOP_GUEST_FIELD_INDEX), "guest resolves field slot 1 as GUEST-owned").toBe(
          "guest",
        );
      });

      // ZERO forced resyncs across the seating interaction (the live `MISMATCH -> resync`).
      expect(resyncProbe.count(), "the lone-survivor seating replacement forced NO resync").toBe(0);

      logs.flush();
    }, 240_000);
  },
);
