/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE next-command-barrier / turn-commit deadlock (Track R, campaign run 29651275134).
//
// After a mid-turn replacement fills the GUEST's OWN field slot, the guest opens its OWN
// post-replacement CommandPhase for the refilled mon (`replacement filled OUR slot 1 -> opening
// own CommandPhase`). The HOST, at that same turn, reaches its partner-path CommandPhase for the
// guest slot and parks in `requestPartnerCommand` awaiting the guest's PRODUCTION broadcast (a live
// human never installs a command responder - it broadcasts its own-slot command from its own
// CommandPhase).
//
// THE DEADLOCK (browser trace): when the guest diverted the turn to CoopReplayTurnPhase it armed a
// `requestTurnCommit(turn)` retry loop (awaitTurn) that keeps pinging the host (host replies
// `turnCommitPending`) FOREVER. That stale await is never cancelled at the replay->command PIVOT, so
// the guest is simultaneously "passively awaiting the host's turn resolution" (renderer model) AND
// "about to COMMAND its own slot" (command model) - a contradictory state while the host is (correctly)
// awaiting the guest's command. Existing duo replacement tests BYPASS this pivot (they reach the
// post-replacement CommandPhase via materializeGuestInputAfterReplacement, a fresh TurnInit), so the
// leaked request never surfaced.
//
// THE REPRO drives the EXACT production replay->command pivot across two real engines and forces the
// live MID-PARK ordering with a single-shot dropped checkpoint (the guest reaches `awaitTurn(2)` and
// arms the request BEFORE the retained re-send delivers the auto-summon checkpoint). It then asserts NO
// leaked turn-commit request/timer survives the pivot. RED before the fix (requests=1: the
// requestTurnCommit -> turnCommitPending loop), GREEN after (the pivot cancels the premature request;
// the re-queued CoopReplayTurnPhase behind the guest's own CommandPhase re-arms the await AFTER the
// command is broadcast).
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-barrier-deadlock.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { setCoopFaintSwitchWaitMs, setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
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
  type DuoRig,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveGuestReplayTurn,
  installDuoLogCapture,
  settleDuoPromise,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { COOP_NO_FAULT_PROFILE, wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The guest picks party slot 3 (CHARIZARD) as its own faint replacement (a guest-owned bench mon). */
const GUEST_PICK_SLOT = 3;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)(
  "co-op DUO next-command-barrier / turn-commit deadlock: guest commands its post-replacement own slot (Track R)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`barrier-deadlock-${Date.now()}`);
      // Bounded host faint-switch wait so a regression that stops the guest's pick surfaces fast.
      setCoopFaintSwitchWaitMs(4000);
      game.override
        .battleStyle("double")
        .startingWave(1)
        .enemySpecies(SpeciesId.MAGIKARP)
        .enemyLevel(100)
        .enemyMoveset(MoveId.GROWL)
        .startingLevel(50)
        .moveset([MoveId.EARTHQUAKE, MoveId.SPLASH, MoveId.TACKLE])
        .disableTrainerWaves();
    });

    afterEach(() => {
      setCoopFaintSwitchWaitMs(60_000);
      setCoopWaveBarrierMs(60_000);
      logs.dispose();
      clearCoopRuntime();
      initGlobalScene(game.scene);
    });

    /** The guest's TURN-1 own-slot command answer (the genuine production CoopBattleSync relay). */
    function wireGuestCommand(rig: DuoRig): void {
      rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
        command: Command.FIGHT,
        cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
        moveId: MoveId.SPLASH,
        targets: [BattlerIndex.ENEMY],
      }));
    }

    it("cancels the premature turn-commit request at the replay->command pivot (no turnCommitPending softlock loop)", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.LAPRAS, SpeciesId.CHARIZARD);
      const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 0xba1e17 });
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
      wireGuestCommand(rig);

      // Guest-owned bench (LAPRAS + CHARIZARD), so the guest's faint has an own bench to replace from.
      for (const scene of [rig.hostScene, rig.guestScene]) {
        scene.getPlayerParty()[2].coopOwner = "guest";
        scene.getPlayerParty()[3].coopOwner = "guest";
      }
      rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
      withClientSync(rig.guestCtx, () => {
        rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX].hp = 1;
      });

      const turn = rig.hostScene.currentBattle.turn;

      // TURN 1 (host): Snorlax EARTHQUAKE (spread) faints the 1-HP guest Gengar deterministically; the
      // guest slot's relayed SPLASH is moot. Level-100 Magikarp shrug it off (GROWL harmless).
      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.EARTHQUAKE, COOP_HOST_FIELD_INDEX);
        game.move.select(MoveId.SPLASH, COOP_GUEST_FIELD_INDEX);
        await game.phaseInterceptor.to("CoopTurnCommitPhase");
      });
      const hostSlotAfterFaint = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      expect(
        hostSlotAfterFaint == null || hostSlotAfterFaint.isFainted(),
        "the guest-owned field slot was vacated by the faint on the host",
      ).toBe(true);

      // GUEST renders turn 1: the faint presentation opens the guest's OWN picker
      // (CoopGuestFaintSwitchPhase). Stub the ONE PARTY open to pick CHARIZARD (slot 3); the relay
      // send + seq keying stay fully real.
      await withClient(rig.guestCtx, async () => {
        const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
        const realSetMode = ui.setMode.bind(ui);
        ui.setMode = (...args: unknown[]): unknown => {
          if (args[0] === UiMode.PARTY) {
            ui.setMode = realSetMode; // one-shot
            setCoopRuntime(rig.hostRuntime);
            try {
              (args[3] as (slotIndex: number, option: number) => void)(GUEST_PICK_SLOT, 0);
            } finally {
              setCoopRuntime(rig.guestRuntime);
            }
            return;
          }
          if (args[0] === UiMode.MESSAGE) {
            return; // the picker's close transition - a no-op headlessly
          }
          return realSetMode(...args);
        };
        try {
          await driveGuestReplayTurn(rig.guestScene, turn);
        } finally {
          ui.setMode = realSetMode;
        }
      });

      // MID-PARK ORDERING (the live deadlock's exact timing): DROP the first replacement checkpoint so the
      // guest's turn-2 CoopReplayTurnPhase reaches its `awaitTurn(2)` PARK (arming the requestTurnCommit retry
      // loop) BEFORE the host's retained re-send delivers the checkpoint. Production hits this naturally -
      // the guest reaches its next-turn await before the auto-summon checkpoint arrives.
      pair.armNextDrop("battleCheckpoint", "host");

      // HOST: summon the guest's pick and push the out-of-band replacement checkpoint. Settle the
      // material ACK under both destination contexts (two independent browser event loops).
      let hostAdvance: Promise<void> | undefined;
      await withClient(rig.hostCtx, async () => {
        hostAdvance = game.phaseInterceptor.to("CommandPhase", false);
        await drainLoopback();
      });
      expect(hostAdvance, "the host replacement crossing was started").toBeDefined();
      await settleDuoPromise(rig, hostAdvance!, "guest-picked faint replacement host crossing");
      const hostReplacement = rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX];
      expect(hostReplacement?.species.speciesId, "the HOST summoned the guest's pick (CHARIZARD)").toBe(
        SpeciesId.CHARIZARD,
      );

      // GUEST: drive the REAL turn-2 replay so it reaches its own next CommandPhase through the PRODUCTION
      // replay->command PIVOT (coop-replay-turn-phase.ts: the replacement checkpoint arrives mid-park and
      // the guest unshifts its OWN CommandPhase for the refilled slot). This is the exact path the live
      // deadlock takes - existing duo tests bypass it via materializeGuestInputAfterReplacement.
      await withClient(rig.guestCtx, async () => {
        rig.guestScene.currentBattle.turn = turn + 1;
        await driveGuestReplayTurn(rig.guestScene, turn + 1);
        await driveClientPhaseQueueTo(rig.guestScene, "guest-owned CommandPhase after replacement", {
          matches: phase =>
            phase.phaseName === "CommandPhase"
            && (phase as unknown as { getFieldIndex(): number }).getFieldIndex() === COOP_GUEST_FIELD_INDEX,
          perPhaseTimeoutMs: 5_000,
        });
      });

      expect(pair.faultsInjected(), "the mid-park checkpoint delivery was actually delayed").toBe(1);

      // RED (pre-fix) -> GREEN (post-fix): at the replay->command PIVOT the guest was passively awaiting the
      // host's turn-2 resolution (`awaitTurn(2)` armed `requestTurnCommit(2)` + its retry timer). Now that the
      // replacement filled the guest's OWN slot it will COMMAND that turn, not await it - so the premature
      // request MUST be cancelled at the pivot. Pre-fix this leaks: the guest pings the host
      // `requestTurnCommit -> turnCommitPending` FOREVER while the host is (correctly) awaiting the guest's
      // command - the observed barrier / turn-commit softlock shape.
      const guestStreamerDiag = (
        rig.guestRuntime as unknown as {
          battleStream: { retainedAuthorityDiagnostics: () => { requests: number; requestTimers: number } };
        }
      ).battleStream.retainedAuthorityDiagnostics();
      expect(
        guestStreamerDiag.requests,
        "no leaked turn-commit REQUEST survives the replay->command pivot (turnCommitPending loop cancelled)",
      ).toBe(0);
      expect(
        guestStreamerDiag.requestTimers,
        "no leaked turn-commit retry TIMER survives the replay->command pivot",
      ).toBe(0);

      // pokemonId parity: the host's requestPartnerCommand keys its await by partner.id and the guest's
      // broadcast keys by its own slot mon id - they MUST be identical or the await can never match. (Confirms
      // the command handshake itself is address-clean; the deadlock was the premature turn-commit request.)
      const hostSlotId = withClientSync(rig.hostCtx, () => rig.hostScene.getPlayerField()[COOP_GUEST_FIELD_INDEX]?.id);
      const guestSlotId = withClientSync(
        rig.guestCtx,
        () => rig.guestScene.getPlayerField()[COOP_GUEST_FIELD_INDEX]?.id,
      );
      expect(guestSlotId, "guest + host agree on the refilled slot mon id (command-address parity)").toBe(hostSlotId);

      // The re-queued CoopReplayTurnPhase (unshifted BEHIND the guest's own CommandPhase at the pivot) still
      // legitimately awaits the host's turn-2 resolution AFTER the command is broadcast - the fix cancels ONLY
      // the premature request, never the phase that re-establishes the await. Prove the phase queue is intact.
      const queued = withClientSync(rig.guestCtx, () => rig.guestScene.phaseManager.getQueuedPhaseNames?.() ?? []);
      const current = withClientSync(rig.guestCtx, () => rig.guestScene.phaseManager.getCurrentPhase()?.phaseName);
      expect(
        current === "CommandPhase" && queued.includes("CoopReplayTurnPhase"),
        "guest is at its own CommandPhase with the re-queued replay behind it (post-command await preserved)",
      ).toBe(true);

      logs.flush();
    }, 240_000);
  },
);
