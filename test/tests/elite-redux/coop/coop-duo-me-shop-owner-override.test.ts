/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// PROBE #809 (matrix probe 4): ME-SHOP OWNER OVERRIDE - an ME with an embedded reward shop where the ME
// OWNER differs from the shop's OPTION owner. Inside an authoritative mystery encounter the embedded shop's
// two authorities SPLIT (#828, hardened by the #850 post-ME pin work):
//   - OPTION authority (roll the pool + STREAM it vs adopt the streamed list) is FORCED to the HOST - it is
//     the sole ME engine; the guest diverted into CoopReplayMePhase never ran the encounter, so a
//     guest-rolled pool would diverge. So the host ALWAYS rolls + streams and the guest adopts.
//   - PICK authority (drive the interactive pick + relay it) resolves off the shop's PINNED counter, which
//     mid-ME is the ME's pinned counter (#850) - so the ME OWNER drives, regardless of the live counter.
// On a GUEST-OWNED ME (odd counter) the two axes genuinely split: the HOST is the OPTION owner but the pick
// WATCHER, and the GUEST is the option WATCHER (adopts) but the pick OWNER (drives). Pre-#828 the host was
// FORCED to own the pick even on a guest-owned ME (the maintainer's live bug: they owned the event but the
// relic pick behaved as the host's).
//
// This probe drives a GUEST-OWNED DEPARTMENT_STORE_SALE (embedded shop) across two real engines and asserts
// the probe-4 invariant crisply: EXACTLY ONE driver (host shop is the reward-pick WATCHER, guest shop is the
// OWNER - the ME owner drives even though the option owner is the OTHER player), the embedded shop is pinned
// to the ME counter (not the drifting live counter, #850), it does NOT advance the counter on its own
// (MAJOR-3), and the whole ME advances the alternation counter EXACTLY ONCE in lockstep with the guest
// converging (seed + ME-save) to the host. It hardens the same #828/#850 split coop-duo-mystery IT #2 covers,
// as the matrix's dedicated probe-4 regression guard.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-me-shop-owner-override.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import { decodeCoopV2InteractionEnvelope } from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import type { CoopMeTerminalPayload } from "#data/elite-redux/coop/coop-operation-envelope";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import type { CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { getCoopUiRelayEdges, resetCoopUiRelayTrace } from "#data/elite-redux/coop/coop-ui-relay-trace";
import { BattleType } from "#enums/battle-type";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { MysteryEncounterPhase } from "#phases/mystery-encounter-phases";
import { GameManager } from "#test/framework/game-manager";
import {
  awaitRewardShopPhaseExit,
  buildDuoForMe,
  drainGuestMeReplayToSettle,
  drainLoopback,
  installDuoLogCapture,
  type ShopPhaseSeam,
  startGuestMeReplay,
  startGuestMeShopOwner,
  withClient,
} from "#test/tools/coop-duo-harness";
import { createScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** A valid ME wave: WILD, non-boss, in [10,180], waveIndex % 10 != 1 (see isMysteryEncounterValidForWave). */
const ME_WAVE = 12;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** Unique committed Mystery terminal operations observed on the retained transport, in first-send order. */
function committedMeTerminals(calls: readonly (readonly CoopMessage[])[]): {
  id: string;
  payload: CoopMeTerminalPayload;
}[] {
  const byId = new Map<string, { id: string; payload: CoopMeTerminalPayload }>();
  for (const call of calls) {
    const message = call[0];
    const operation = message == null ? null : committedInteractionOperation(message);
    if (operation?.status !== "applied" || operation.kind !== "ME_TERMINAL") {
      continue;
    }
    byId.set(operation.id, { id: operation.id, payload: operation.payload as CoopMeTerminalPayload });
  }
  return [...byId.values()];
}

function committedInteractionOperation(message: CoopMessage) {
  if (message.t !== "authorityEntry") {
    return null;
  }
  return decodeCoopV2InteractionEnvelope({ ...message.body, context: message.ctx })?.envelope.pendingOperation ?? null;
}

describe.skipIf(!RUN)(
  "co-op DUO ME-shop owner override: guest-owned ME drives the pick, host stays the option owner (#828/#850/#809)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      resetCoopUiRelayTrace();
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`me-shop-owner-override-${Date.now()}`);
      game.override
        .battleStyle("double")
        .startingWave(ME_WAVE)
        .mysteryEncounterChance(100)
        .startingLevel(50)
        .disableTrainerWaves();
    });

    afterEach(() => {
      resetCoopUiRelayTrace();
      logs.dispose();
      clearCoopRuntime();
      // #710 harness-citizenship: buildDuoForMe builds a 2nd BattleScene (the guest); restore the host scene.
      initGlobalScene(game.scene);
    });

    afterAll(() => {
      // best-effort
    });

    it("guest-owned ME embedded shop: exactly one driver (guest owns the pick), single counter advance, converges", async () => {
      // REACH: park the host on a real DEPARTMENT_STORE_SALE ME (embedded reward shop).
      await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [
        SpeciesId.SNORLAX,
        SpeciesId.GENGAR,
      ]);
      const hostScene = game.scene;
      expect(hostScene.currentBattle.battleType, "host reached a MYSTERY_ENCOUNTER wave").toBe(
        BattleType.MYSTERY_ENCOUNTER,
      );

      const pair = createScheduledCoopPair({ automatic: true });
      const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
      const hostSend = vi.spyOn(pair.host, "send");

      // SEED the interaction counter to 1 (ODD -> the GUEST owns the ME + its embedded pick). Both controllers
      // advance 0->1 and drain (the broadcasts only set a deferred pendingRemote, so neither double-advances).
      await withClient(rig.hostCtx, () => {
        rig.hostRuntime.controller.advanceInteraction();
      });
      await withClient(rig.guestCtx, () => {
        rig.guestRuntime.controller.advanceInteraction();
      });
      await drainLoopback();
      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      expect(counterBefore, "the ME opens on interaction counter 1 (guest owns odd)").toBe(1);
      expect(rig.guestRuntime.controller.interactionCounter(), "guest also at counter 1").toBe(1);
      // From this point every destination queue is delivered only while that client's complete scene/runtime
      // context is installed. This lets the real public guest selector arm its retained outcome race without
      // any continuation ever resuming under the host's process-global scene.
      rig.hostCtx.pumpInbound = () => pair.flush("host");
      rig.guestCtx.pumpInbound = () => pair.flush("guest");
      pair.setAutomaticDelivery(false);

      const applyMeOutcomeSpy = vi.spyOn(coopEngine, "applyCoopMeOutcome");
      const handleOptionSelectSpy = vi.spyOn(MysteryEncounterPhase.prototype, "handleOptionSelect");

      // STEP A (host): reach MysteryEncounterPhase + run start(). The host does NOT own the pick at counter 1,
      // so coopHostAwaitGuestIndex parks AWAITING the guest's relayed option index (no local drive).
      await withClient(rig.hostCtx, async () => {
        await game.phaseInterceptor.to("MysteryEncounterPhase", false);
        await game.phaseInterceptor.to("MysteryEncounterPhase");
      });
      await drainLoopback();
      expect(handleOptionSelectSpy, "host has NOT applied any option before the guest relays").not.toHaveBeenCalled();

      // STEP B (guest): start the divert -> CoopReplayMePhase (resolves ownsMe=TRUE at counter 1, opens the
      // selector), then choose option 0 through the public MYSTERY_ENCOUNTER handler. The public adapter
      // mints the exact ME_PICK intent before its compatibility carrier and arms the retained outcome race.
      const replay = await withClient(rig.guestCtx, () => startGuestMeReplay(rig.guestScene));
      await withClient(rig.guestCtx, async () => {
        expect(rig.guestScene.ui.getMode(), "guest-owned Mystery selector is public and interactive").toBe(
          UiMode.MYSTERY_ENCOUNTER,
        );
        const handler = rig.guestScene.ui.getHandler() as unknown as { unblockInput?: () => void };
        handler.unblockInput?.();
        expect(rig.guestScene.ui.processInput(Button.ACTION), "guest commits ME option 0 through public UI").toBe(true);
        await drainLoopback();
      });
      expect(
        getCoopUiRelayEdges().some(
          edge => edge.mode === UiMode.MYSTERY_ENCOUNTER && edge.carrier === "interactionChoice",
        ),
        "the public guest Mystery selector emitted its operation-backed proposal carrier",
      ).toBe(true);

      // STEP C (host): flush the relayed index -> the host applies handleOptionSelect(0) programmatically and
      // runs the option chain to the embedded reward shop. START the host shop: on a guest-owned ME it is the
      // OPTION owner (rolls + STREAMS) but the reward-pick WATCHER, so it parks awaiting the guest's pick.
      let hostShop!: ShopPhaseSeam;
      await withClient(rig.hostCtx, async () => {
        await drainLoopback(); // host await resolves under the HOST scene
        await game.phaseInterceptor.to("SelectModifierPhase", false);
        hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
        expect(hostShop.phaseName, "host reached the embedded end-of-ME reward shop").toBe("SelectModifierPhase");
        hostShop.start(); // rolls + STREAMS options, parks awaiting the guest pick
        await drainLoopback();

        // #850 PIN: the embedded shop is pinned to the ME counter (odd), NOT the drifting live counter.
        expect(hostShop.coopInteractionStart, "host shop pinned to the ME counter (odd -> guest owns the pick)").toBe(
          counterBefore,
        );
        // PROBE-4 DRIVER SPLIT (host side): the host's embedded shop is the reward-pick WATCHER (it does NOT
        // drive the pick) even though it IS the option owner - the "other player" from the ME owner's view.
        expect(
          hostShop.coopWatcher,
          "the host's embedded shop is the reward-pick WATCHER on a guest-owned ME (option owner, not pick driver)",
        ).toBe(true);
      });

      // The host applied the guest's relayed TOP-LEVEL pick programmatically (the guest-owned proof).
      expect(
        handleOptionSelectSpy,
        "host applied the guest's relayed option via handleOptionSelect",
      ).toHaveBeenCalled();
      expect(
        hostSend.mock.calls.every(([message]) => {
          const operation = committedInteractionOperation(message);
          return operation?.kind !== "ME_PICK";
        }),
        "the guest ME_PICK proposal stays telemetry and consumes no mechanical Authority V2 revision",
      ).toBe(true);
      // The immutable mechanical results are the ordered ME_TERMINAL images asserted below. Letting the
      // proposal itself enter the global log would create a second ordering authority and shift every
      // successor revision; the public relay edge plus host application above are its complete proof.
      // MAJOR-3: the embedded ME reward shop suppresses its own advance mid-ME - still at the ME counter.
      expect(
        rig.hostRuntime.controller.interactionCounter(),
        "embedded ME reward shop suppressed its own advance (MAJOR-3, still mid-ME)",
      ).toBe(counterBefore);

      // STEP C2 (guest): the GUEST owns the ME -> it OWNS the reward PICK. Open its embedded shop as the pick
      // OWNER: it pins the same (odd) ME counter, ADOPTS the host's streamed options (never re-rolls its
      // diverged pool), and drives. Leave through its public cancel/confirmation UI; the guest-owned reward
      // intent remains parked until the host watcher validates it and returns the retained authoritative result.
      const guestShop = await withClient(rig.guestCtx, () => startGuestMeShopOwner(rig.guestScene));
      // PROBE-4 DRIVER SPLIT (guest side): the guest's embedded shop DRIVES the pick (OWNER) - EXACTLY ONE
      // driver across the two engines, and it is the ME owner (guest), not the option owner (host).
      expect(
        guestShop.coopWatcher,
        "the guest's embedded shop DRIVES the reward pick (OWNER) on a guest-owned ME - the #828 fix",
      ).toBe(false);
      expect(guestShop.coopInteractionStart, "guest shop pinned to the SAME ME counter as the host").toBe(
        counterBefore,
      );
      expect(
        (guestShop.typeOptions as unknown[]).length,
        "guest ADOPTED the host's streamed reward options (never re-rolled its diverged ME pool)",
      ).toBeGreaterThan(0);
      // EXACTLY ONE DRIVER (the crisp probe-4 invariant): the two shops disagree on coopWatcher - one drives,
      // one watches - so there is never a double-driver or a zero-driver (the deadlock/duplicate-screen class).
      expect(
        hostShop.coopWatcher !== guestShop.coopWatcher,
        "exactly one engine drives the embedded ME pick (host watches, guest drives)",
      ).toBe(true);
      await withClient(rig.guestCtx, async () => {
        expect(rig.guestScene.ui.getMode(), "guest embedded reward owner opened its public picker").toBe(
          UiMode.MODIFIER_SELECT,
        );
        const handler = rig.guestScene.ui.getHandler() as unknown as { unblockInput?: () => void };
        handler.unblockInput?.();
        expect(rig.guestScene.ui.processInput(Button.CANCEL), "guest requests embedded reward leave via UI").toBe(true);
        await drainLoopback();
        expect(rig.guestScene.ui.getMode(), "embedded reward leave opened public confirmation").toBe(UiMode.CONFIRM);
        (rig.guestScene.ui.getHandler() as unknown as { unblockInput?: () => void }).unblockInput?.();
        expect(rig.guestScene.ui.processInput(Button.ACTION), "guest confirms embedded reward leave via UI").toBe(true);
        await drainLoopback();
      });
      expect(
        getCoopUiRelayEdges().some(
          edge =>
            (edge.mode === UiMode.MODIFIER_SELECT || edge.mode === UiMode.CONFIRM)
            && edge.carrier === "interactionChoice",
        ),
        "the public guest reward UI emitted its operation-backed proposal carrier",
      ).toBe(true);

      // STEP C3: host commits the guest proposal, guest materializes the retained result and returns its
      // proof, then host can release the reciprocal shop barrier and enter the ME terminal.
      await withClient(rig.hostCtx, async () => {
        for (let i = 0; i < 8; i++) {
          await drainLoopback();
        }
      });
      await withClient(rig.guestCtx, async () => {
        for (let i = 0; i < 16; i++) {
          await drainLoopback();
        }
        // The retained RESULT has mechanically completed the guest-owned shop, but its public MESSAGE
        // transition is still the executable surface until Phase.end() releases it. A browser scheduler
        // waits for that close before PostMystery can receive the ordered final leave; prove the same edge.
        await awaitRewardShopPhaseExit(guestShop);
      });
      await withClient(rig.hostCtx, async () => {
        for (let i = 0; i < 16; i++) {
          await drainLoopback();
          if (hostScene.phaseManager.getCurrentPhase()?.phaseName !== "SelectModifierPhase") {
            break;
          }
        }
        await game.phaseInterceptor.to("PostMysteryEncounterPhase");
      });
      expect(
        hostSend.mock.calls.some(([message]) => {
          const operation = committedInteractionOperation(message);
          return operation?.kind === "REWARD" && operation.status === "applied" && operation.owner === 1;
        }),
        "the host validated the public guest reward proposal and retained the typed REWARD result",
      ).toBe(true);

      // The host advanced the alternation counter EXACTLY ONCE for the whole ME (the embedded shop added none).
      expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the counter once for the whole ME").toBe(
        counterBefore + 1,
      );

      const hostSeed = hostScene.seed;
      const hostEncounteredEvents = JSON.stringify(hostScene.mysteryEncounterSaveData.encounteredEvents);

      // STEP D (guest): the public selector already armed the outcome/terminal race. Drain it now so the
      // retained reward result, meResync, and terminal all apply under the GUEST scene (genuine converge).
      const guestReplay = await withClient(rig.guestCtx, async () => {
        return drainGuestMeReplayToSettle(replay);
      });

      // ----- ASSERTIONS -----
      expect(guestReplay.settled, "guest CoopReplayMePhase settled (left the ME exactly once)").toBe(true);
      const terminals = committedMeTerminals(hostSend.mock.calls);
      expect(
        terminals.map(({ payload }) => [payload.terminal, payload.destination.kind]),
        "host committed the ordered pre-reward and final Mystery destinations exactly once each",
      ).toEqual([
        ["reward-settled", "reward"],
        ["leave", "continue"],
      ]);
      expect(
        new Set(terminals.map(({ id }) => id)).size,
        "the two terminal state images have distinct operation IDs",
      ).toBe(2);
      expect(
        applyMeOutcomeSpy.mock.calls.length,
        "guest applied the pre-reward settlement and final leave state exactly once each",
      ).toBe(2);

      // CONVERGENCE: the guest's RNG seed + ME-save converged to the host's authoritative values via meResync.
      expect(rig.guestScene.seed, "guest RNG seed converged to the host's via meResync").toBe(hostSeed);
      expect(
        JSON.stringify(rig.guestScene.mysteryEncounterSaveData.encounteredEvents),
        "guest ME-save (encounteredEvents) converged to the host's via meResync",
      ).toBe(hostEncounteredEvents);

      // SINGLE COUNTER ADVANCE IN LOCKSTEP: the whole ME + embedded shop is ONE interaction on BOTH engines.
      expect(rig.hostRuntime.controller.interactionCounter(), "host counter advanced exactly once for the ME").toBe(
        counterBefore + 1,
      );
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        "guest counter advanced exactly once (lockstep) - no double advance from the embedded shop",
      ).toBe(counterBefore + 1);

      logs.flush();
    }, 300_000);
  },
);
