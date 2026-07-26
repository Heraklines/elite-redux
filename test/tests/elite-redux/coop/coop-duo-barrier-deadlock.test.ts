/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE next-command-barrier / turn-commit deadlock (Track R, campaign run 29651275134).
//
// After a mid-turn replacement fills the GUEST's OWN field slot, Authority V2 must install the exact
// post-replacement CommandPhase without first manufacturing a future replay wait. The host then parks in
// its partner CommandPhase until the guest broadcasts through its own public command handler.
//
// This reproduction delays the first replacement carrier, proves its retained resend still installs the
// command successor, and asserts that no stale requestTurnCommit retry survives. Both turn-one commands
// and the post-replacement boundary are driven through production phases and public UI handlers.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-barrier-deadlock.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import {
  type CoopV2InteractionCutover,
  clearActiveCoopV2InteractionCutover,
  setActiveCoopV2InteractionCutover,
} from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import {
  CoopInteractionRelay,
  setCoopFaintSwitchWaitMs,
  setCoopWaveBarrierMs,
} from "#data/elite-redux/coop/coop-interaction-relay";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_REWARD_CHOICE_KINDS } from "#data/elite-redux/coop/coop-seq-registry";
import { COOP_GUEST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveDuoGuestTackleThroughPublicUi,
  driveGuestReplayTurn,
  installDuoLogCapture,
  settleDuoPromise,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { COOP_NO_FAULT_PROFILE, wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";
const V2_REPLACEMENT_CUTOVER = process.env.COOP_AUTHORITY_V2_REPLACEMENT === "on";

/** The guest picks party slot 3 (CHARIZARD) as its own faint replacement (a guest-owned bench mon). */
const GUEST_PICK_SLOT = 3;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe("co-op Authority V2 reward watcher liveness", () => {
  afterEach(() => {
    clearActiveCoopV2InteractionCutover();
    vi.useRealTimers();
  });

  it("does not turn an elapsed remote-owner wait into a local shop leave or counter advance", async () => {
    vi.useFakeTimers();
    const pair = createLoopbackPair();
    const relay = new CoopInteractionRelay(pair.host);
    const elapsed = relay.awaitInteractionChoice(0, 1_200_000, COOP_REWARD_CHOICE_KINDS);
    await vi.advanceTimersByTimeAsync(1_200_000);
    const action = await elapsed;
    expect(action, "the real relay reports an elapsed owner wait as missing input, never as LEAVE").toBeNull();

    // This seam only asks whether cutover is installed; the production cutover object is otherwise unused
    // by result application. A structural stub keeps this regression focused on the phase's null policy.
    setActiveCoopV2InteractionCutover({} as CoopV2InteractionCutover);
    let mirrorEnded = 0;
    let counterAdvanced = 0;
    const phase = new SelectModifierPhase() as unknown as {
      coopShopSceneAlive(reason: string): boolean;
      coopEndMirror(): void;
      coopAdvanceInteraction(): void;
      coopApplyWatcherAction(
        seq: number,
        role: "host" | "guest",
        result: Awaited<typeof elapsed>,
      ): "continue" | "recover" | "end";
    };
    phase.coopShopSceneAlive = () => true;
    phase.coopEndMirror = () => {
      mirrorEnded++;
    };
    phase.coopAdvanceInteraction = () => {
      counterAdvanced++;
    };

    expect(phase.coopApplyWatcherAction(0, "host", action)).toBe("recover");
    expect(mirrorEnded, "the exact human-input surface remains installed").toBe(0);
    expect(counterAdvanced, "absence of input is never an authoritative interaction result").toBe(0);
    relay.dispose();
  });
});

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

    it("cancels the premature turn-commit request at the replay->command pivot (no turnCommitPending softlock loop)", async () => {
      await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR, SpeciesId.LAPRAS, SpeciesId.CHARIZARD);
      const pair = wrapCoopFaultPair(createLoopbackPair(), COOP_NO_FAULT_PROFILE, { seed: 0xba1e17 });
      const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);

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
      await driveDuoGuestTackleThroughPublicUi(game, rig, {
        restartAlreadyOpenHost: false,
        submitHostTackle: true,
        hostMoveId: MoveId.EARTHQUAKE,
        guestMoveId: MoveId.SPLASH,
      });
      await withClient(rig.hostCtx, async () => {
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
            const opened = realSetMode(...args);
            Promise.resolve(opened).then(
              () => {
                queueMicrotask(() => {
                  setCoopRuntime(rig.hostRuntime);
                  try {
                    (args[3] as (slotIndex: number, option: number) => void)(GUEST_PICK_SLOT, 0);
                  } finally {
                    setCoopRuntime(rig.guestRuntime);
                  }
                });
              },
              () => undefined,
            );
            return opened;
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

      // Delay the first replacement carrier. The renderer must remain on the ordered successor wait until
      // the retained resend arrives; it must never convert that wait into a guessed future turn replay.
      pair.armNextDrop(V2_REPLACEMENT_CUTOVER ? "authorityEntry" : "battleCheckpoint", "host");

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

      // GUEST: follow the ordered replacement successor to its real own-slot CommandPhase. Authority V2
      // does not manufacture or await a turn-2 replay before that successor exists; the retained replacement
      // entry releases the parked finalizer directly through the production projector.
      await withClient(rig.guestCtx, async () => {
        await driveClientPhaseQueueTo(rig.guestScene, "guest-owned CommandPhase after replacement", {
          matches: phase =>
            phase.phaseName === "CommandPhase"
            && (phase as unknown as { getFieldIndex(): number }).getFieldIndex() === COOP_GUEST_FIELD_INDEX,
          perPhaseTimeoutMs: 5_000,
        });
      });

      expect(
        pair.faultsInjected(),
        `the mid-park ${V2_REPLACEMENT_CUTOVER ? "V2 replacement entry" : "legacy checkpoint"} delivery was actually delayed`,
      ).toBe(1);

      // The renderer is now the command owner, so no passive turn-resolution request or retry timer may be
      // live while the authority waits for that command.
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
