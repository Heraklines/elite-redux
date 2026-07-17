/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE guest-faint REPLACEMENT tick race (live seed EW0gvphu5Ps8dmWDaUKqgr8x, wave 8): the
// guest's active mon faints, the guest picks a LIVING bench replacement, the host summons it - and it
// "instantly dies" on the guest's screen and re-opens the picker in a loop, while the host is correct.
//
// ROOT CAUSE (confirmed from the live guest log): the host emits TWO state payloads around the
// replacement - the turn-1 RESOLUTION checkpoint (tick N, bi1 FAINTED, pre-summon) and, after the
// summon, the OUT-OF-BAND replacement checkpoint (tick N+1, bi1 ALIVE). The guest consumes the
// replacement mid-park FIRST (summons the living mon; #807 tick advances to N+1), then finalizes the
// PARKED turn-1 resolution: applyCoopCheckpoint correctly REJECTS the stale tick-N checkpoint - BUT its
// COMPANION fullField snapshot (applyCoopFieldSnapshot) was applied UNCONDITIONALLY, re-applying the
// pre-summon FAINTED bi1 state (`hp bi=1 host=0 -> applied`) and instantly re-KOing the freshly summoned
// replacement. Then the stale checksum mismatched -> a forced resync.
//
// THE DETECTION GAP this closes: the per-turn checkpoint / resync HEALS the state, so a convergence-only
// assertion sees the engines AGREE after healing and PASSES - never catching that the CHOOSER's screen
// showed a fainted replacement + a re-picker. This repro asserts the PRE-HEAL PRESENTED state on the
// chooser (the replacement's hp MUST be > 0, not re-KO'd) and that the faint-replacement turn takes ZERO
// forced resyncs. It FAILS on the pre-fix code (heal-masked) and PASSES after the production fix that
// gates the companion fullField + checksum on the checkpoint not being stale.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-guest-faint-party-desync.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { applyCoopAuthoritativeBattleState, applyCoopCheckpoint } from "#data/elite-redux/coop/coop-battle-engine";
import { CoopBattleStreamer } from "#data/elite-redux/coop/coop-battle-stream";
import { setCoopFaintSwitchWaitMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { settleCoopAuthoritativeProjection } from "#data/elite-redux/coop/coop-presentation";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import type {
  CoopAuthoritativeBattleStateV1,
  CoopBattleCheckpoint,
  CoopFullMonSnapshot,
} from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type CoopResyncProbe,
  type DuoRig,
  drainLoopback,
  driveGuestReplayTurn,
  installCoopResyncProbe,
  installDuoLogCapture,
  presentedFieldMon,
  setCoopHarnessLiveEvents,
  settleDuoPromise,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The guest picks party slot 3 (CHARIZARD) - a LIVING bench mon, NOT the auto-pick's first-legal (LAPRAS). */
const GUEST_PICK_SLOT = 3;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)(
  "co-op DUO guest-faint replacement tick race: the summoned replacement must not re-KO (#807)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;
    let resyncProbe: CoopResyncProbe | undefined;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`guest-faint-desync-${Date.now()}`);
      setCoopFaintSwitchWaitMs(4000);
      // The live path streams the faint LIVE (the picker opens off a live battleEvent, the turn resolution
      // is parked) - enable it so this repro matches production ordering, not the batch-only default.
      setCoopHarnessLiveEvents(true);
      game.override
        .battleStyle("double")
        .startingWave(1)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(100)
        .enemyMoveset(MoveId.GROWL)
        .startingLevel(50)
        .moveset([MoveId.EARTHQUAKE, MoveId.SPLASH])
        .disableTrainerWaves();
    });

    afterEach(() => {
      resyncProbe?.restore();
      resyncProbe = undefined;
      setCoopFaintSwitchWaitMs(60_000);
      setCoopHarnessLiveEvents(false);
      logs.dispose();
      clearCoopRuntime();
      initGlobalScene(game.scene);
    });

    /** The guest's own-slot command answer (the genuine production CoopBattleSync relay). */
    function wireGuestCommand(rig: DuoRig): void {
      rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
        command: Command.FIGHT,
        cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
        moveId: MoveId.SPLASH,
        targets: [BattlerIndex.ENEMY],
      }));
    }

    it("the guest-summoned replacement stays ALIVE after the parked stale resolution finalizes (no re-KO, no resync)", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.LAPRAS, SpeciesId.CHARIZARD);
      const pair = createLoopbackPair();
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);

      // Both bench mons GUEST-owned on both engines so the guest has a legal replacement.
      for (const scene of [rig.hostScene, rig.guestScene]) {
        scene.getPlayerParty()[2].coopOwner = "guest";
        scene.getPlayerParty()[3].coopOwner = "guest";
      }
      rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
      withClientSync(rig.guestCtx, () => {
        rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
      });

      const turn = rig.hostScene.currentBattle.turn;

      // Capture the host's turn-1 RESOLUTION payload (the stale, pre-summon checkpoint + fullField that the
      // guest parks). `emitTurn` is spied to READ the payload (calls through). Forced resyncs the guest
      // issues are tallied by the reusable harness DETECTION-MODEL probe (behavior-preserving).
      const emitTurnSpy: MockInstance = vi.spyOn(CoopBattleStreamer.prototype, "emitTurn");
      resyncProbe = installCoopResyncProbe(rig.guestRuntime);

      // TURN 1 on the HOST: Snorlax's spread EARTHQUAKE faints the 1-HP guest lead (Gengar); the lv100 foes
      // shrug it off. Emits the turn-1 resolution (bi1 FAINTED) at TurnEndPhase.
      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.EARTHQUAKE, COOP_HOST_FIELD_INDEX);
        game.move.select(MoveId.SPLASH, COOP_GUEST_FIELD_INDEX);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });

      // Pull the captured turn-1 resolution payload (the PARKED stale checkpoint - tick N, bi1 fainted).
      const call = emitTurnSpy.mock.calls.find(c => c[2] === turn);
      expect(call, "the host emitted a turn-1 resolution payload").toBeDefined();
      const staleCheckpoint = call?.[4] as CoopBattleCheckpoint;
      const staleChecksum = call?.[5] as string;
      const stalePreimage = call?.[6] as string | undefined;
      const staleFullField = call?.[7] as CoopFullMonSnapshot[] | undefined;
      const staleAuthoritativeState = call?.[8] as CoopAuthoritativeBattleStateV1 | undefined;
      expect(staleFullField, "the resolution carried the on-field fullField snapshot").toBeDefined();
      expect(staleAuthoritativeState, "the resolution carried the protocol-32 authoritative state").toBeDefined();

      // GUEST renders turn 1: the faint presentation opens the guest's OWN picker; stub the ONE PARTY open to
      // pick CHARIZARD - the RELAY send + seq keying stay fully real. This applies the tick-N resolution.
      await withClient(rig.guestCtx, async () => {
        const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
        const realSetMode = ui.setMode.bind(ui);
        ui.setMode = (...args: unknown[]): unknown => {
          if (args[0] === UiMode.PARTY) {
            ui.setMode = realSetMode; // one-shot
            (args[3] as (slotIndex: number, option: number) => void)(GUEST_PICK_SLOT, 0);
            return;
          }
          if (args[0] === UiMode.MESSAGE) {
            return;
          }
          return realSetMode(...args);
        };
        try {
          await driveGuestReplayTurn(rig.guestScene, turn);
        } finally {
          ui.setMode = realSetMode;
        }
      });

      // HOST: drive past its SwitchPhase - it awaits the guest's relayed pick and summons CHARIZARD, then
      // pushes the OUT-OF-BAND replacement checkpoint (tick N+1, bi1 ALIVE). The crossing settles
      // under BOTH destination contexts (the b59dba12 B-lane hang class: parked FAINT_SWITCH
      // envelopes starve the host's material-ACK barrier when only the host context runs).
      let hostAdvance: Promise<void> | undefined;
      await withClient(rig.hostCtx, async () => {
        hostAdvance = game.phaseInterceptor.to("CommandPhase", false) as Promise<void>;
        await drainLoopback();
      });
      expect(hostAdvance, "the host CommandPhase crossing was started").toBeDefined();
      await settleDuoPromise(rig, hostAdvance!, "guest-faint replacement host crossing");
      const hostReplacement = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      expect(hostReplacement?.species.speciesId, "the HOST summoned the guest's pick (CHARIZARD)").toBe(
        SpeciesId.CHARIZARD,
      );
      expect(hostReplacement?.isFainted(), "the replacement is battle-ready on the host").toBe(false);

      // GUEST consumes the OUT-OF-BAND replacement checkpoint mid-park (the exact production path:
      // CoopReplayTurnPhase's raced.kind === "checkpoint" branch), summoning CHARIZARD into bi1 (tick N+1).
      await withClient(rig.guestCtx, async () => {
        const envelope = rig.guestRuntime.battleStream.consumeCheckpoint();
        expect(envelope?.reason, "the guest received the out-of-band replacement checkpoint").toBe("replacement");
        if (envelope != null) {
          const checkpointApplied = applyCoopCheckpoint(envelope.checkpoint);
          const authoritativeApplied =
            checkpointApplied && applyCoopAuthoritativeBattleState(envelope.authoritativeState, true);
          if (authoritativeApplied) {
            expect(
              await settleCoopAuthoritativeProjection(envelope.authoritativeState),
              "the replacement's sprite and battle-info projection became usable before presentationReady",
            ).toBe(true);
            rig.guestRuntime.battleStream.retainAppliedOutOfBandCheckpoint(envelope);
            rig.guestRuntime.battleStream.acknowledgeReplacement(envelope, "materialApplied");
            rig.guestRuntime.battleStream.acknowledgeReplacement(envelope, "presentationReady");
            expect(
              rig.guestRuntime.battleStream.registerReplacementContinuation(envelope, {
                kind: "command",
                epoch: envelope.epoch,
                wave: envelope.wave,
                turn: envelope.turn,
              }),
              "the low-level apply cannot release host retention before its later real command UI",
            ).toBe(true);
          }
        }
      });

      expect(
        rig.guestScene.getPlayerParty().map(mon => mon.id),
        "replacement materialization preserves the host-authoritative party order",
      ).toEqual(rig.hostScene.getPlayerParty().map(mon => mon.id));

      // PRE-HEAL assertion #1 (the chooser's PRESENTED state, before the parked resolution finalizes): the
      // summoned replacement MUST be the CHOSEN species and ALIVE. A replacement that presents fainted here is
      // the live "it instantly dies" symptom - a FAILURE even though a later heal would converge it.
      withClientSync(rig.guestCtx, () => {
        const rep = presentedFieldMon(rig.guestScene, COOP_GUEST_FIELD_INDEX);
        expect(rep?.speciesId, "the guest materialized the CHOSEN replacement (CHARIZARD)").toBe(SpeciesId.CHARIZARD);
        expect(rep != null && rep.hp > 0 && !rep.fainted, "the guest's summoned replacement is presented ALIVE").toBe(
          true,
        );
      });

      const resyncsBeforeStaleFinalize = resyncProbe.count();

      // Model a delayed presentation write after the replacement's full state was applied.
      // Production HP/faint/move phases drain in this window; PP is intentionally perturbed
      // because it exposed the same missing post-animation reassertion in the long-run matrix.
      withClientSync(rig.guestCtx, () => {
        const replacement = rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
        const move = replacement?.getMoveset()[0];
        if (move != null) {
          move.ppUsed += 1;
        }
      });

      // Now the PARKED turn-1 resolution finalizes (the live tick race: it applies AFTER the newer replacement
      // checkpoint). applyCoopCheckpoint rejects the stale tick-N checkpoint; the fix must ALSO skip the
      // companion fullField + checksum so the stale pre-summon FAINTED bi1 state can never re-KO the newer
      // replacement (pre-fix: the ungated fullField re-KOs it + the stale checksum forces a resync).
      await withClient(rig.guestCtx, async () => {
        const finalize = rig.guestScene.phaseManager.create(
          "CoopFinalizeTurnPhase",
          turn,
          staleCheckpoint,
          staleChecksum,
          stalePreimage,
          staleFullField,
          staleAuthoritativeState,
          call?.[0] as number,
          call?.[1] as number,
          staleAuthoritativeState?.tick,
        );
        finalize.start();
      });

      // PRE-HEAL assertion #2 (the fix): the summoned replacement is STILL alive after the stale resolution
      // finalizes - the stale fullField did not re-KO it.
      withClientSync(rig.guestCtx, () => {
        const rep = presentedFieldMon(rig.guestScene, COOP_GUEST_FIELD_INDEX);
        expect(
          rep?.speciesId,
          "the replacement slot still holds the CHOSEN species after the stale finalize (no re-KO reset)",
        ).toBe(SpeciesId.CHARIZARD);
        expect(
          rep != null && rep.hp > 0 && !rep.fainted,
          "the guest's summoned replacement is STILL alive after the stale resolution finalized (no instant re-KO)",
        ).toBe(true);
        const hostPp = hostReplacement?.getMoveset()[0]?.ppUsed;
        const guestPp = rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX]?.getMoveset()[0]?.ppUsed;
        expect(guestPp, "the newer replacement state is reasserted after delayed presentation writes").toBe(hostPp);
        const replacement = rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
        expect(replacement?.visible, "the owner still sees the replacement container after stale finalize").toBe(true);
        expect(
          replacement?.getSprite()?.visible,
          "the owner still sees the replacement sprite after stale finalize",
        ).toBe(true);
        expect(
          replacement?.getBattleInfo()?.visible,
          "the owner still sees the replacement UI bar after stale finalize",
        ).toBe(true);
      });

      expect(
        rig.guestRuntime.battleStream.retainedAuthorityDiagnostics().terminal,
        "an already-finalized duplicate never rewrites staged ACK evidence into a shared terminal",
      ).toBe(false);

      // ZERO forced resyncs on the faint-replacement turn: a resync means a divergence the chooser could see.
      expect(
        resyncProbe.count(),
        "the stale-resolution finalize forced NO resync (a resync here is a player-facing divergence)",
      ).toBe(resyncsBeforeStaleFinalize);

      logs.flush();
    }, 240_000);
  },
);
