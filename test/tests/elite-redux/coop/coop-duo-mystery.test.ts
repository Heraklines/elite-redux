/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op MYSTERY ENCOUNTER runs (#633, #677/#678). The first tests that boot TWO REAL
// engines (host = sole authoritative engine; guest = pure renderer) through a real
// MysteryEncounterPhase + CoopReplayMePhase over createLoopbackPair, so a real host-vs-guest ME
// divergence surfaces organically in dev-logs/coop-duo/<run>/. Every OTHER co-op ME test is
// ENGINE-FREE / protocol-level (CoopMePump + CoopBattleStreamer with injected fakes).
//
// THREE distinct authoritative-ME code paths, each its own it():
//   1. HOST-OWNED non-battle ME (counter 0, even): the host drives the pick off its OWN local input;
//      the guest is a pure renderer that adopts the complete retained DATA+continuation. DEPARTMENT_STORE_SALE.
//   2. GUEST-OWNED non-battle ME (counter 1, odd): the host CANNOT take the human pick, so it AWAITS
//      the guest's relayed option INDEX on 8M (coopHostAwaitGuestIndex) and applies it PROGRAMMATICALLY;
//      the guest renders the selector off the host presentation + relays its pick. DEPARTMENT_STORE_SALE.
//   3. BATTLE-HANDOFF ME (the documented #693 softlock class): an option that SPAWNS a battle commits one
//      retained ME_TERMINAL carrying the comprehensive state + exact battle destination. The guest must
//      finishWithoutLeaving() (end WITHOUT advancing - the single advance defers to the TRUE ME terminal
//      after the battle), with no raw party/9M correctness dependency. FIGHT_OR_FLIGHT opt 1.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-mystery.test.ts --reporter=dot
//   (PowerShell: $env:ER_SCENARIO="1"; npx vitest run <path>)
//
// COMMON ASSERTS: interaction-counter lockstep on BOTH controllers (a non-battle ME advances exactly
// once; the battle-handoff does NOT advance at the handoff), the guest's CoopReplayMePhase settled via
// the RIGHT terminal branch (leave vs battle-handoff), and NO hang (a no-progress stall in the guest
// replay drain THROWS so a regression fails loudly with both clients' logs captured).
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import * as meOp from "#data/elite-redux/coop/coop-me-operation";
import { type CoopMePresentPayload, parseCoopOperationId } from "#data/elite-redux/coop/coop-operation-envelope";
import { clearCoopRuntime, getCoopInteractionRelay, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import type { CoopInteractionOutcome, CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
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
  drainGuestMeReplayNewRounds,
  drainGuestMeReplayToSettle,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveGuestMeReplay,
  driveGuestMirrorQuiz,
  driveGuestRewardWatch,
  driveHostMeRewardShopWithGuestReplay,
  driveHostRewardShopOwner,
  type ErQuizPhaseSeam,
  installDuoLogCapture,
  relayGuestMeShopLeaveSync,
  type ShopPhaseSeam,
  startGuestMeOutcomeRace,
  startGuestMeReplay,
  startGuestMeShopOwner,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { runMysteryEncounterToEnd, runSelectMysteryEncounterOption } from "#test/utils/encounter-test-utils";
// #831: force the press-your-luck bust roll to SURVIVE (deterministic 2+ round delve) - see IT #5.
import * as Common from "#utils/common";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** A valid ME wave: WILD, non-boss, in [10,180], waveIndex % 10 != 1 (see isMysteryEncounterValidForWave). */
const ME_WAVE = 12;

/** Unique committed Mystery operations observed on the retained transport, in first-send order. */
function committedMeOperations(calls: readonly (readonly CoopMessage[])[]): {
  id: string;
  kind: string;
  payload: unknown;
}[] {
  const byId = new Map<string, { id: string; kind: string; payload: unknown }>();
  for (const call of calls) {
    const message = call[0];
    if (message?.t !== "envelope") {
      continue;
    }
    const operation = message.envelope.pendingOperation;
    if (operation?.status !== "applied" || (!operation.kind.startsWith("ME_") && operation.kind !== "QUIZ_ANSWER")) {
      continue;
    }
    byId.set(operation.id, { id: operation.id, kind: operation.kind, payload: operation.payload });
  }
  return [...byId.values()];
}

/** Complete host-authored presentations carried by retained ME_PRESENT operations. */
function committedMePresentations(
  calls: readonly (readonly CoopMessage[])[],
): Extract<CoopInteractionOutcome, { k: "mePresent" }>[] {
  return committedMeOperations(calls).flatMap(operation => {
    if (operation.kind !== "ME_PRESENT") {
      return [];
    }
    const presentation = (operation.payload as CoopMePresentPayload).presentation;
    return presentation?.k === "mePresent" ? [presentation] : [];
  });
}

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/**
 * Mint the same retained owner intent and addressed proposal ordinal as the public Mystery selector.
 * The two-engine harness defers the replay's outcome race until the host has run, so it cannot invoke the
 * selector handler directly without resolving its promises under the shared process-global host context.
 */
function relayGuestMePickWithIntent(replay: Phase, scene: BattleScene, pinned: number, optionIndex: number): void {
  const relay = getCoopInteractionRelay();
  if (relay == null) {
    throw new Error("guest-owned ME test lost its production interaction relay");
  }
  const seq = (replay as unknown as { seq: number }).seq;
  const step = 0;
  const operationId = meOp.commitMeOwnerIntent({
    kind: "ME_PICK",
    seq,
    pinned,
    step,
    payload: { optionIndex },
    localRole: "guest",
    wave: scene.currentBattle.waveIndex,
    turn: scene.currentBattle.turn,
    resend: () => relay.sendInteractionChoice(seq, "me", optionIndex, [step]),
  });
  if (operationId == null) {
    throw new Error("guest-owned ME test could not retain its typed ME_PICK intent");
  }
  relay.sendInteractionChoice(seq, "me", optionIndex, [step]);
}

/**
 * #831 (IT #5 helper): pump the HOST to its next real {@linkcode MysteryEncounterPhase} (option-select
 * screen) and pick an option via the REAL {@linkcode MysteryEncounterUiHandler}. `cursorMoves` navigates
 * from the default cursor 0 (e.g. `[Button.RIGHT]` selects the 2nd option). MUST be called inside
 * withClient(rig.hostCtx). The caller installs a scoped `ui.showText` auto-advance so the intervening
 * ME narration / round-prompt messages resolve without the FIFO prompt handler (a delve queues a variable
 * number of them per round), leaving only the option pick + the one "appeared" showDialogue to the handler.
 * A drainLoopback after the phase runs flushes the round's freshly-streamed `mePresent` onto the guest
 * relay's 8M buffer.
 */
async function pickHostMeOption(
  game: GameManager,
  hostScene: BattleScene,
  cursorMoves: Button[],
  options: {
    /** The prior pick already started this repeated-round MysteryEncounterPhase. */
    alreadyStarted?: boolean;
    /** Keep hostCtx installed until the async pick chain starts the next repeated round. */
    startNextRound?: boolean;
  } = {},
): Promise<void> {
  if (!options.alreadyStarted) {
    await game.phaseInterceptor.to("MysteryEncounterPhase"); // start() ran: present streamed, ME UI mode, interrupted
  } else if (
    hostScene.phaseManager.getCurrentPhase()?.phaseName !== "MysteryEncounterPhase"
    || hostScene.ui.getMode() !== UiMode.MYSTERY_ENCOUNTER
  ) {
    throw new Error(
      `repeated Mystery pick expected an already-open selector; current=${hostScene.phaseManager.getCurrentPhase()?.phaseName ?? "none"} `
        + `ui=${UiMode[hostScene.ui.getMode()] ?? hostScene.ui.getMode()}`,
    );
  }
  await drainLoopback(); // flush the round's streamed mePresent onto the guest relay's 8M outcome inbox
  const uiHandler = hostScene.ui.getHandler() as unknown as { unblockInput(): void; processInput(b: number): boolean };
  uiHandler.unblockInput(); // ME handler blocks input for 1s on show; tests clear it
  for (const move of cursorMoves) {
    hostScene.ui.processInput(move);
  }
  hostScene.ui.processInput(Button.ACTION);
  if (options.startNextRound) {
    // The option callback is async (narration, chip damage, rewards). Do not install the guest's
    // process-global scene while that callback is still live: wait under hostCtx until the real next
    // MysteryEncounterPhase has started and exposed its public selector.
    await game.phaseInterceptor.to("MysteryEncounterPhase");
  }
}

describe.skipIf(!RUN)(
  "co-op DUO mystery encounter: two real engines - host-owned, guest-owned, and battle-handoff MEs (#633)",
  () => {
    let phaserGame: Phaser.Game;
    let game: GameManager;
    let logs: ReturnType<typeof installDuoLogCapture>;

    beforeAll(() => {
      phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
    });

    beforeEach(() => {
      game = new GameManager(phaserGame);
      logs = installDuoLogCapture(`mystery-${Date.now()}`);
      game.override
        .battleStyle("double")
        .startingWave(ME_WAVE)
        .mysteryEncounterChance(100)
        .startingLevel(50)
        .disableTrainerWaves();
    });

    afterEach(() => {
      logs.dispose();
      clearCoopRuntime();
      // #710 harness-citizenship: buildDuoForMe()/buildGuestScene() constructs a 2nd BattleScene (the
      // guest), whose ctor steals globalScene via initGlobalScene(this). Restore the host GameManager
      // scene so the NEXT ER_SCENARIO file's GameManager reuses a valid host scene, not the guest one.
      initGlobalScene(game.scene);
    });

    afterAll(() => {
      // best-effort
    });

    it("DUO ME: host drives a host-owned DEPARTMENT_STORE_SALE to its terminal; guest replays in lockstep, no hang", async () => {
      // ===== REACH: park the HOST on a real DEPARTMENT_STORE_SALE ME wave (still CLASSIC, the ME is
      // ROLLED here; nothing about this encounter's roll depends on isCoop - the co-op divergence is all
      // in the DRIVE path, which runs after the buildDuoForMe flip). runToMysteryEncounter ends at
      // EncounterPhase with currentBattle.mysteryEncounter set + the intro dialogue pending. =====
      await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [
        SpeciesId.SNORLAX,
        SpeciesId.GENGAR,
      ]);
      const hostScene = game.scene;
      expect(hostScene.currentBattle.battleType, "host reached a MYSTERY_ENCOUNTER wave").toBe(
        BattleType.MYSTERY_ENCOUNTER,
      );
      expect(hostScene.currentBattle.mysteryEncounter?.encounterType, "the forced ME is DEPARTMENT_STORE_SALE").toBe(
        MysteryEncounterType.DEPARTMENT_STORE_SALE,
      );
      // The host plays a co-op DOUBLE, so getPlayerField() returns both leads (host + guest owners).
      expect(hostScene.currentBattle.double, "co-op ME wave is a double").toBe(true);

      // ===== Stand up the two-engine rig over one loopback pair. buildDuoForMe flips the host into
      // co-op (role=host) + builds the guest scene + MIRRORS the host's mystery encounter onto it (NOT
      // the battle mirror - an ME wave has no enemy party). Host owns the ME at counter 0 (even). =====
      const pair = createLoopbackPair();
      const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);

      // The ME has NOT started yet (we parked at EncounterPhase). Both controllers are at counter 0.
      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      expect(counterBefore, "the ME opens on interaction counter 0 (host owns even)").toBe(0);
      expect(rig.guestRuntime.controller.interactionCounter(), "guest also at counter 0").toBe(0);

      // Spy the guest's comprehensive ME-outcome apply (the guest's SOLE convergence mechanism - it runs
      // no engine). It must fire EXACTLY once (the host streams meResync at its terminal).
      const applyMeOutcomeSpy = vi.spyOn(coopEngine, "applyCoopMeOutcome");
      let replay!: Phase;

      // ===== Drive the HOST through the ME FULLY (it FIFO-buffers presentation + meResync on 8M and the
      // LEAVE terminal on 9M into the relay), THEN drive the guest which drains with zero network wait.
      // Sequential discipline: a cross-ctx await continuation must never resume under the wrong
      // globalScene (the harness's owner-then-watcher rule). =====
      await withClient(rig.hostCtx, async () => {
        // Cross EncounterPhase's intro dialogue into the real MysteryEncounterPhase + pick option 1 (the
        // host OWNS this ME at counter 0, so it drives off its OWN local input via the REAL
        // MysteryEncounterUiHandler - the same path the vanilla ME tests use). coopBeginMePump fires the
        // host-owner path (beginOwner(8M, 9M)) + streams the entry checksum + mePresent on 8M. This runs
        // the option select THROUGH MysteryEncounterRewardsPhase (which unshifts the embedded reward
        // shop SelectModifierPhase). NON-battle ME, so isBattle=false.
        await runMysteryEncounterToEnd(game, 1);
        // Drive the host's REAL embedded reward shop (the end-of-ME SelectModifierPhase) to its leave -
        // NOT a raw .end(). This exercises MAJOR-3: the embedded shop's coopAdvanceInteraction() MUST
        // suppress its own advance while coopMeInProgress() is true (else the counter double-advances and
        // the ME's single advance desyncs into a duplicate reward screen). Inside an authoritative ME the
        // host is the FORCED reward owner, so driveHostRewardShopOwner drives the owner leave.
        await game.phaseInterceptor.to("SelectModifierPhase", false);
        const hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
        expect(hostShop.phaseName, "host reached the embedded end-of-ME reward shop").toBe("SelectModifierPhase");
        replay = await driveHostMeRewardShopWithGuestReplay(hostShop, rig.guestCtx, rig.guestScene);
        // The embedded shop MUST NOT have advanced the counter (it suppresses during the ME) - still 0.
        expect(
          rig.hostRuntime.controller.interactionCounter(),
          "embedded ME reward shop suppressed its own advance (MAJOR-3, still counter 0 mid-ME)",
        ).toBe(counterBefore);
        // Drive to the ME's true terminal: PostMysteryEncounterPhase streams meResync on 8M, coopEndMePump
        // sends LEAVE on 9M + advances the alternation counter ONCE for the whole ME.
        await game.phaseInterceptor.to("PostMysteryEncounterPhase");
      });

      // The host advanced the alternation counter exactly once for the whole ME (coopEndMePump).
      expect(
        rig.hostRuntime.controller.interactionCounter(),
        "host advanced the interaction counter once for the whole ME",
      ).toBe(counterBefore + 1);

      // Capture the host's authoritative post-ME state for the guest-convergence assert below. The guest
      // runs NO engine, so the comprehensive meResync is its SOLE path to these values; if the meResync
      // apply silently fails (it is wrapped in a swallow-all try/catch), the guest's seed / ME-save would
      // NOT converge - a real desync the bare counter assert alone would miss.
      const hostSeed = hostScene.seed;
      const hostEncounteredEvents = JSON.stringify(hostScene.mysteryEncounterSaveData.encounteredEvents);
      // The host pushed a SeenEncounterData for this ME during EncounterPhase, so its ME-save is non-empty.
      expect(
        hostScene.mysteryEncounterSaveData.encounteredEvents.length,
        "host recorded the ME in its ME-save (a non-trivial value the guest must converge to)",
      ).toBeGreaterThan(0);

      // ===== Drive the GUEST's REAL CoopReplayMePhase: it consumes the host's buffered 8M present +
      // 8M meResync + 9M LEAVE (FIFO), applies the outcome, leaves the encounter, advances once. A
      // no-progress stall THROWS (the hang detection). =====
      const guestReplay = await withClient(rig.guestCtx, () => drainGuestMeReplayToSettle(replay));

      // The guest left the encounter exactly once (the single `settled` terminal).
      expect(guestReplay.settled, "guest CoopReplayMePhase settled (left once)").toBe(true);
      // The guest applied the host's comprehensive meResync exactly once (its sole convergence path).
      expect(
        applyMeOutcomeSpy.mock.calls.length,
        "guest applied the pre-reward settlement and final leave state exactly once each",
      ).toBe(2);
      // CONVERGENCE: the apply actually SUCCEEDED (not silently swallowed) - the guest's RNG seed +
      // ME-save converged to the host's authoritative values. A swallowed apply (e.g. a party/dex apply
      // throwing before the seed/ME-save restore) would leave these DIVERGED, which this assert catches.
      expect(rig.guestScene.seed, "guest RNG seed converged to the host's via meResync").toBe(hostSeed);
      expect(
        JSON.stringify(rig.guestScene.mysteryEncounterSaveData.encounteredEvents),
        "guest ME-save (encounteredEvents) converged to the host's via meResync",
      ).toBe(hostEncounteredEvents);

      // ===== INTERACTION-COUNTER LOCKSTEP: both controllers advanced exactly once for the whole ME. =====
      expect(rig.hostRuntime.controller.interactionCounter(), "host counter is 1 after the ME (single advance)").toBe(
        counterBefore + 1,
      );
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        "guest counter is 1 after the ME (lockstep with host, single advance)",
      ).toBe(counterBefore + 1);

      logs.flush();
    }, 300_000);

    it("DUO ME live repro: host-owned HOT_SPRING move-on crosses the pumped selected-dialogue prompt and empty-shop terminal", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.ER_HOT_SPRING, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
      const hostScene = game.scene;
      expect(hostScene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.ER_HOT_SPRING);

      const pair = createLoopbackPair();
      const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      expect(counterBefore, "Hot Spring is host-owned at the initial even counter").toBe(0);
      let replay!: Phase;

      await withClient(rig.hostCtx, async () => {
        // Dispose the encounter intro using the normal prompt path, then stop on the live selector.
        game.onNextPrompt(
          "MysteryEncounterPhase",
          UiMode.MESSAGE,
          () => hostScene.ui.getMessageHandler().processInput(Button.ACTION),
          () => game.isCurrentPhase("MysteryEncounterOptionSelectedPhase"),
        );
        await game.phaseInterceptor.to("MysteryEncounterPhase");
        await drainLoopback();

        const selector = hostScene.ui.getHandler() as unknown as { unblockInput(): void };
        selector.unblockInput();

        // Exact live path: RIGHT selects "Move on", ACTION commits it through UI.processInput so
        // the ME pump observes and relays both inputs. Existing ME helpers call the handler directly
        // and therefore could not reproduce a pump/input-routing softlock here.
        resetCoopUiRelayTrace();
        expect(hostScene.ui.processInput(Button.RIGHT), "owner can move the live Hot Spring cursor").toBe(true);
        const realSetMode = hostScene.ui.setMode.bind(hostScene.ui);
        const realShowText = hostScene.ui.showText.bind(hostScene.ui);
        let messageModeReady = false;
        let selectedRenderedAfterMode = false;
        vi.spyOn(hostScene.ui, "setMode").mockImplementation(async (mode: UiMode, ...args: unknown[]) => {
          await realSetMode(mode, ...args);
          if (mode === UiMode.MESSAGE) {
            messageModeReady = true;
          }
        });
        vi.spyOn(hostScene.ui, "showText").mockImplementation((text, ...args) => {
          if (text.includes("spring's keepers")) {
            // Regression contract: the selected line must never be published until the asynchronous
            // MYSTERY_ENCOUNTER -> MESSAGE transition has installed the final message handler.
            selectedRenderedAfterMode = messageModeReady;
          }
          return realShowText(text, ...args);
        });
        expect(hostScene.ui.processInput(Button.ACTION), "owner can commit Move on through the ME pump").toBe(true);
        expect(
          getCoopUiRelayEdges().some(
            edge => edge.mode === UiMode.MYSTERY_ENCOUNTER && edge.carrier === "interactionChoice",
          ),
          "the public mystery-event UI input reached the production interaction relay",
        ).toBe(true);
        expect(hostScene.ui.getMode(), "the selected line switched to the message handler").toBe(UiMode.MESSAGE);

        // Hot Spring's move-on option queues an empty healing shop. Drive the real boundary and then
        // the true PostMysteryEncounter terminal; the shop must not consume the ME counter itself.
        await game.phaseInterceptor.to("SelectModifierPhase", false);
        expect(
          selectedRenderedAfterMode,
          "Hot Spring selected narration rendered only after the MESSAGE transition completed",
        ).toBe(true);
        const hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
        replay = await driveHostMeRewardShopWithGuestReplay(hostShop, rig.guestCtx, rig.guestScene);
        expect(rig.hostRuntime.controller.interactionCounter(), "empty ME shop did not double-advance").toBe(
          counterBefore,
        );
        await game.phaseInterceptor.to("PostMysteryEncounterPhase");
      });

      expect(rig.hostRuntime.controller.interactionCounter(), "host completed the Hot Spring exactly once").toBe(
        counterBefore + 1,
      );
      const guestReplay = await withClient(rig.guestCtx, () => drainGuestMeReplayToSettle(replay));
      expect(guestReplay.settled, "guest left the exact Hot Spring terminal without parking").toBe(true);
      expect(rig.guestRuntime.controller.interactionCounter(), "guest Hot Spring counter converged").toBe(
        counterBefore + 1,
      );

      logs.flush();
    }, 300_000);

    it("DUO ME live repro: fieldless CLEANSING_FONT retains a complete final leave after its no-shop reward tail", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.ER_CLEANSING_FONT, [
        SpeciesId.SNORLAX,
        SpeciesId.GENGAR,
        SpeciesId.BLASTOISE,
        SpeciesId.CHARIZARD,
        SpeciesId.VENUSAUR,
        SpeciesId.PIKACHU,
      ]);
      const hostScene = game.scene;
      const pair = createLoopbackPair();
      const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      let replay!: Phase;

      await withClient(rig.hostCtx, async () => {
        await runMysteryEncounterToEnd(game, 1);
        // Cleansing Font option 1 queues PartyHeal -> MysteryEncounterRewards -> EggLapse -> PostME,
        // but deliberately opens no modifier shop. Park the true terminal before start so the guest can
        // consume the retained reward-settled image through its real replay phase first.
        await game.phaseInterceptor.to("PostMysteryEncounterPhase", false);
      });
      replay = await withClient(rig.guestCtx, () => startGuestMeReplay(rig.guestScene));
      await withClient(rig.hostCtx, () => {
        hostScene.phaseManager.getCurrentPhase().start();
      });

      expect(
        rig.hostRuntime.controller.interactionCounter(),
        "the fieldless no-shop terminal committed instead of terminating the shared session",
      ).toBe(counterBefore + 1);
      const guestReplay = await withClient(rig.guestCtx, () => drainGuestMeReplayToSettle(replay));
      expect(guestReplay.settled, "the guest adopted the final complete terminal and left once").toBe(true);
      expect(rig.guestRuntime.controller.interactionCounter(), "both clients advanced the same ME exactly once").toBe(
        counterBefore + 1,
      );

      logs.flush();
    }, 300_000);

    // ===========================================================================================
    // IT #2 - GUEST-OWNED non-battle ME (counter 1, odd). DISTINCT code path from the host-owned case,
    // and the #828 REWARD-OWNERSHIP fix's home test. TWO relayed picks, both owned by the GUEST:
    //   (a) TOP-LEVEL option: the host CANNOT take the human pick, so MysteryEncounterPhase
    //       .coopHostAwaitGuestIndex() AWAITS the guest's relayed option INDEX on 8M and applies it
    //       PROGRAMMATICALLY via handleOptionSelect; the guest renders the selector + relays its cursor.
    //   (b) #828 EMBEDDED REWARD SHOP: the shop's authorities SPLIT. The HOST stays the OPTION owner (the
    //       sole ME engine rolls + STREAMS the pool - the guest's diverged RNG can't roll it) but becomes
    //       the reward-pick WATCHER; the GUEST (the ME owner) ADOPTS the streamed options and OWNS the
    //       interactive PICK, relaying it for the host to apply. Pre-#828 the host was FORCED to own the
    //       pick even on a guest-owned ME (the maintainer's live bug: they owned the event but the relic
    //       pick behaved as the host's). Asserted here: hostShop.coopWatcher === true, guestShop.coopWatcher
    //       === false, both counters advance exactly once in lockstep.
    // Both are the bidirectional pick->await->outcome handshake, so they interleave host/guest in explicit
    // phases with drainLoopback between (strict per-ctx; no cross-ctx await continuation under the wrong
    // globalScene - the owner sends under withClientSync, the watcher applies under a later drain in its ctx).
    // ===========================================================================================
    it("DUO ME: a GUEST-OWNED DEPARTMENT_STORE_SALE - guest owns BOTH the top-level pick AND the embedded reward shop (#828); host applies both; lockstep", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [
        SpeciesId.SNORLAX,
        SpeciesId.GENGAR,
      ]);
      const hostScene = game.scene;
      expect(hostScene.currentBattle.battleType, "host reached a MYSTERY_ENCOUNTER wave").toBe(
        BattleType.MYSTERY_ENCOUNTER,
      );

      const pair = createLoopbackPair();
      const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);

      // SEED the interaction counter to 1 (ODD -> guest owns the ME) via the REAL controller API. Both
      // controllers advance once (0->1) and drain; the broadcasts only set a deferred pendingRemote (==1,
      // not ahead of the live counter), so neither double-advances. This is the least-hacky way to land
      // coopMeInteractionStart on an odd counter without poking module state.
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

      const applyMeOutcomeSpy = vi.spyOn(coopEngine, "applyCoopMeOutcome");
      const handleOptionSelectSpy = vi.spyOn(MysteryEncounterPhase.prototype, "handleOptionSelect");

      // ===== STEP A (host): reach MysteryEncounterPhase + run start() so coopBeginMePump fires (host =
      // beginOwner, since authoritative + role=host EVEN on a guest-OWNED ME), coopHostStreamPresentation
      // streams mePresent on 8M, and coopHostAwaitGuestIndex parks AWAITING the guest's index on 8M (the
      // host does NOT own the pick at counter 1, so it cannot drive off local input). The phase stays
      // open (no end()) until the index arrives. The intro-dialogue prompts are auto-driven by
      // runToMysteryEncounter's onNextPrompt; `to(...,false)` parks before running, then `to(...)` runs it. =====
      await withClient(rig.hostCtx, async () => {
        await game.phaseInterceptor.to("MysteryEncounterPhase", false);
        await game.phaseInterceptor.to("MysteryEncounterPhase");
      });
      await drainLoopback();
      // The host applied NO option yet (it is awaiting the guest's index).
      expect(handleOptionSelectSpy, "host has NOT applied any option before the guest relays").not.toHaveBeenCalled();

      // ===== STEP B (guest): start the divert -> CoopReplayMePhase (it adopts the host presentation,
      // resolves ownsMe=TRUE at counter 1, opens the selector, returns), then SEND option index 0 (the TM
      // shop) via withClientSync - the SEND ONLY, NOT the outcome/terminal race. SYNCHRONOUS send is
      // critical: it swaps to guestCtx, sends the "me" index on 8M (schedules the loopback deliver-
      // microtask), and swaps BACK - all before any microtask flushes. So the host's
      // coopHostAwaitGuestIndex await (pending from STEP A) is resolved UNDER the HOST scene in STEP C, NOT
      // under this guest ctx (a cross-ctx handleOptionSelect against the guest's empty
      // mysteryEncounterSaveData is the harness's #1 footgun). The guest's OWN outcome/terminal race is
      // deferred to STEP D so ITS awaits also resolve under the guest scene. =====
      const replay = await withClient(rig.guestCtx, () => startGuestMeReplay(rig.guestScene));
      withClientSync(rig.guestCtx, () => relayGuestMePickWithIntent(replay, rig.guestScene, counterBefore, 0));

      // ===== STEP C (host): the relayed index's deliver-microtask is queued but UNFIRED. Pump the host
      // UNDER hostCtx: the first drainLoopback flushes it, the coopHostAwaitGuestIndex await resolves (its
      // .then() runs under the HOST scene), applies handleOptionSelect(option 0) PROGRAMMATICALLY, and runs
      // the option chain to the embedded end-of-ME reward shop. #828: on a GUEST-OWNED ME the reward shop's
      // OPTION owner is the HOST (the sole ME engine rolls + STREAMS the pool) but the reward-pick WATCHER
      // (the GUEST owns the pick). So we START the host shop (it rolls + streams its options + parks its
      // watcher loop awaiting the guest's relayed pick) and drain to flush the option stream to the guest -
      // the host shop does NOT complete here (it awaits the guest owner's pick, applied in STEP C3). =====
      let hostShop!: ShopPhaseSeam;
      await withClient(rig.hostCtx, async () => {
        await drainLoopback(); // flush the index deliver-microtask -> host await resolves under the HOST scene
        await game.phaseInterceptor.to("SelectModifierPhase", false);
        hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
        expect(hostShop.phaseName, "host reached the embedded end-of-ME reward shop").toBe("SelectModifierPhase");
        hostShop.start(); // #828 pick WATCHER on a guest-owned ME: rolls + STREAMS options, parks awaiting the guest pick
        await drainLoopback(); // flush the option stream to the guest relay buffer
        // start() pins the shop to the LIVE counter, which mid-ME is the (odd) ME counter -> guest owns it.
        expect(hostShop.coopInteractionStart, "host shop pinned to the ME counter (odd -> guest owns)").toBe(
          counterBefore,
        );
        expect(
          hostShop.coopWatcher,
          "#828: host's embedded shop is the reward pick WATCHER on a guest-owned ME (host stays the option owner)",
        ).toBe(true);
      });

      // The host APPLIED the guest's relayed TOP-LEVEL pick programmatically (the load-bearing guest-owned proof).
      expect(
        handleOptionSelectSpy,
        "host applied the guest's relayed option via handleOptionSelect",
      ).toHaveBeenCalled();
      // The applied option was index 0 (the guest's relayed cursor), and it produced the TM-shop reward.
      expect(
        handleOptionSelectSpy.mock.calls.some(c => c[1] === 0),
        "host applied option INDEX 0 (the guest's pick)",
      ).toBe(true);
      // MAJOR-3: the embedded ME reward shop suppresses its own advance mid-ME - still counter 1.
      expect(
        rig.hostRuntime.controller.interactionCounter(),
        "embedded ME reward shop suppressed its own advance (MAJOR-3, still mid-ME at the guest-owned counter)",
      ).toBe(counterBefore);

      // ===== STEP C2 (guest): the guest OWNS the ME, so it OWNS the reward PICK (#828 - the maintainer's
      // fix). Open its OWN embedded shop as the reward pick OWNER: because the shop pins the (odd) ME
      // counter it resolves the pick to the guest, ADOPTS the host's streamed options (buffer-hit), and
      // opens the interactive owner screen. Then relay the owner's LEAVE SYNCHRONOUSLY (withClientSync) so
      // the host's pick-watcher await resolves UNDER the host ctx in STEP C3 (the cross-ctx footgun the
      // top-level pick handshake also dodges). =====
      const guestShop = await withClient(rig.guestCtx, () => startGuestMeShopOwner(rig.guestScene));
      expect(
        guestShop.coopWatcher,
        "#828: guest's embedded shop DRIVES the reward pick (OWNER) on a guest-owned ME - the maintainer's fix",
      ).toBe(false);
      expect(guestShop.coopInteractionStart, "guest shop pinned to the SAME ME counter as the host").toBe(
        counterBefore,
      );
      expect(
        (guestShop.typeOptions as unknown[]).length,
        "guest ADOPTED the host's streamed reward options (never re-rolled its diverged ME pool)",
      ).toBeGreaterThan(0);
      withClientSync(rig.guestCtx, () => relayGuestMeShopLeaveSync(guestShop));

      // ===== STEP C3 (host): drain so the guest owner's LEAVE deliver-microtask flushes UNDER hostCtx ->
      // the host watcher loop applies it, the host shop ends, and the option chain runs to
      // PostMysteryEncounterPhase (streams meResync on 8M + LEAVE on 9M into the GUEST's relay inbox -
      // BUFFERED, since the guest's outcome race is deferred to STEP D - and advances the counter once). =====
      await withClient(rig.hostCtx, async () => {
        for (let i = 0; i < 16; i++) {
          await drainLoopback();
          await withClient(rig.guestCtx, () => drainLoopback());
          await drainLoopback();
          if (hostScene.phaseManager.getCurrentPhase()?.phaseName !== "SelectModifierPhase") {
            break;
          }
        }
        await withClient(rig.guestCtx, () => awaitRewardShopPhaseExit(guestShop));
        await game.phaseInterceptor.to("PostMysteryEncounterPhase");
      });

      // The host advanced the alternation counter exactly once for the whole ME.
      expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the counter once for the ME").toBe(
        counterBefore + 1,
      );

      const hostSeed = hostScene.seed;
      const hostEncounteredEvents = JSON.stringify(hostScene.mysteryEncounterSaveData.encounteredEvents);

      // ===== STEP D (guest): NOW start the guest's outcome/terminal race UNDER guestCtx (its awaits
      // BUFFER-HIT the host's already-buffered meResync on 8M + LEAVE on 9M and resolve under the GUEST
      // scene), then drain to the terminal: applyCoopMeOutcome + leaveEncounterWithoutBattle + advance all
      // run against the GUEST scene, so the guest genuinely converges. =====
      const guestReplay = await withClient(rig.guestCtx, async () => {
        startGuestMeOutcomeRace(replay);
        return drainGuestMeReplayToSettle(replay);
      });

      expect(guestReplay.settled, "guest CoopReplayMePhase settled (left once)").toBe(true);
      expect(
        applyMeOutcomeSpy.mock.calls.length,
        "guest applied the pre-reward settlement and final leave state exactly once each",
      ).toBe(2);
      // CONVERGENCE: the guest's seed + ME-save converged to the host's via the meResync.
      expect(rig.guestScene.seed, "guest RNG seed converged to the host's via meResync").toBe(hostSeed);
      expect(
        JSON.stringify(rig.guestScene.mysteryEncounterSaveData.encounteredEvents),
        "guest ME-save converged to the host's via meResync",
      ).toBe(hostEncounteredEvents);

      // ===== INTERACTION-COUNTER LOCKSTEP: both controllers advanced exactly once for the whole ME. =====
      expect(rig.hostRuntime.controller.interactionCounter(), "host counter is 2 after the ME (single advance)").toBe(
        counterBefore + 1,
      );
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        "guest counter is 2 after the ME (lockstep with host, single advance)",
      ).toBe(counterBefore + 1);

      logs.flush();
    }, 300_000);

    // ===========================================================================================
    // IT #3 - BATTLE-HANDOFF ME (the documented #693 softlock class). An ME OPTION that SPAWNS a battle
    // (FIGHT_OR_FLIGHT option 1 -> initBattleWithEnemyConfig) commits a complete retained battle terminal.
    // The guest applies that exact DATA image and destination, then calls finishWithoutLeaving() - it ends
    // WITHOUT leaving the encounter and WITHOUT advancing the counter (the single ME advance defers to the
    // TRUE terminal AFTER the spawned battle). The harness asserts the handoff boundary: settled via the
    // battle-handoff branch (NOT a leave), counter NOT advanced, state applied once, no hang.
    // ===========================================================================================
    it("DUO ME: a host-owned BATTLE-spawning ME hands off via one retained state+destination transaction", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.FIGHT_OR_FLIGHT, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
      const hostScene = game.scene;
      expect(hostScene.currentBattle.mysteryEncounter?.encounterType, "the forced ME is FIGHT_OR_FLIGHT").toBe(
        MysteryEncounterType.FIGHT_OR_FLIGHT,
      );

      const pair = createLoopbackPair();
      const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);

      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      expect(counterBefore, "the ME opens on interaction counter 0 (host owns even)").toBe(0);

      const applyMeOutcomeSpy = vi.spyOn(coopEngine, "applyCoopMeOutcome");

      // ===== Drive the HOST through option 1 (the BATTLE option). runSelectMysteryEncounterOption presses
      // the host's REAL MysteryEncounterUiHandler for option 1; then we pump to MysteryEncounterBattlePhase
      // (parked) - which is AFTER initBattleWithEnemyConfig has streamed the boss (coopHostStreamMeBattleParty)
      // and relayed COOP_ME_BATTLE_HANDOFF on the 9M term seq (coopMeOwnerRelayBattleHandoff). The host does
      // NOT call coopEndMePump here (the single advance defers past the spawned battle). =====
      await withClient(rig.hostCtx, async () => {
        await runSelectMysteryEncounterOption(game, 1);
        await game.phaseInterceptor.to("MysteryEncounterBattlePhase", false);
        expect(
          hostScene.phaseManager.getCurrentPhase()?.phaseName,
          "host spawned the ME battle (reached MysteryEncounterBattlePhase)",
        ).toBe("MysteryEncounterBattlePhase");
      });
      // The host did NOT advance the counter at the handoff (the single advance defers past the battle).
      expect(
        rig.hostRuntime.controller.interactionCounter(),
        "host did NOT advance at the battle-handoff (advance defers past the spawned battle)",
      ).toBe(counterBefore);

      // ===== Drive the GUEST's CoopReplayMePhase. Its now-live retained receiver requests any fast host
      // tail, applies the complete state image, and opens the exact battle destination. driveGuestMeReplay
      // drains to `settled`; a no-progress stall THROWS (the #693 hang detection). =====
      const guestReplay = await withClient(rig.guestCtx, () => driveGuestMeReplay(rig.guestScene));

      // The guest settled (ended) - via the BATTLE-HANDOFF branch, NOT a leave. Discriminators:
      expect(guestReplay.settled, "guest CoopReplayMePhase settled (ended once) at the battle-handoff").toBe(true);
      // (1) The comprehensive battle-handoff state applies exactly once before control opens.
      expect(applyMeOutcomeSpy.mock.calls.length, "guest applied the retained battle-handoff state exactly once").toBe(
        1,
      );
      // (2) the guest did NOT advance the counter (finishWithoutLeaving defers the single advance past the
      // spawned battle - a leaveDefensive would have advanced). This is the load-bearing handoff assertion.
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        "guest did NOT advance at the battle-handoff (finishWithoutLeaving, NOT leaveDefensive)",
      ).toBe(counterBefore);
      // (3) the guest did NOT leave the encounter (its mysteryEncounter is still set - the spawned battle
      // would now run host-authoritatively on both engines; leaveEncounterWithoutBattle would have cleared it).
      expect(
        rig.guestScene.currentBattle.mysteryEncounter,
        "guest did NOT leave the encounter at the battle-handoff (the battle runs next)",
      ).toBeDefined();
      // (4) #818: in co-op a scripted 1v1 ME battle is a TRUE 2v2 - the host DUPLICATED the
      // single scripted mon (FIGHT_OR_FLIGHT spawns one boss) and forced the double flag, so
      // both players field a mon. Both copies are the same species; the copy has its own id.
      const hostEnemies = hostScene.currentBattle.enemyParty;
      expect(hostEnemies.length, "host ME battle fields TWO enemies (scripted 1v1 duplicated, #818)").toBe(2);
      expect(hostScene.currentBattle.double, "host ME battle is a DOUBLE (#818)").toBe(true);
      expect(hostEnemies[1].species.speciesId, "the duplicate is the SAME species as the scripted mon").toBe(
        hostEnemies[0].species.speciesId,
      );
      expect(hostEnemies[1].id, "the duplicate has its OWN pokemon id").not.toBe(hostEnemies[0].id);
      expect(
        rig.guestScene.currentBattle.enemyParty.map(mon => ({ id: mon.id, species: mon.species.speciesId })),
        "guest adopted the exact host battle party from the retained transaction",
      ).toEqual(hostEnemies.map(mon => ({ id: mon.id, species: mon.species.speciesId })));

      // ===== LOCKSTEP at the handoff boundary: BOTH controllers are still at counterBefore (the single ME
      // advance is deferred to the TRUE terminal after the spawned battle + its shop). NO double-advance,
      // NO hang. =====
      expect(rig.hostRuntime.controller.interactionCounter(), "host counter unchanged at the handoff").toBe(
        counterBefore,
      );
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        "guest counter unchanged at the handoff (lockstep)",
      ).toBe(counterBefore);

      logs.flush();
    }, 300_000);

    it("DUO ME: Still Waters streams the complete bounded mirror team and reaches battle handoff without identity drift", async () => {
      const party = [SpeciesId.SNORLAX, SpeciesId.GENGAR];
      await game.runToMysteryEncounter(MysteryEncounterType.ER_STILL_WATERS, party);
      const hostScene = game.scene;
      expect(hostScene.currentBattle.mysteryEncounter?.encounterType).toBe(MysteryEncounterType.ER_STILL_WATERS);

      const pair = createLoopbackPair();
      const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      const authoritativePartyAtSelection = hostScene.getPlayerParty().map(mon => mon.species.speciesId);

      await withClient(rig.hostCtx, async () => {
        await runSelectMysteryEncounterOption(game, 1);
        await game.phaseInterceptor.to("MysteryEncounterBattlePhase", false);
      });
      const guestReplay = await withClient(rig.guestCtx, () => driveGuestMeReplay(rig.guestScene));

      expect(guestReplay.settled).toBe(true);
      expect(rig.hostRuntime.controller.interactionCounter()).toBe(counterBefore);
      expect(rig.guestRuntime.controller.interactionCounter()).toBe(counterBefore);

      const hostEnemies = hostScene.currentBattle.enemyParty;
      const guestEnemies = rig.guestScene.currentBattle.enemyParty;
      expect(hostEnemies, "the complete live co-op party is mirrored as the enemy trainer team").toHaveLength(
        authoritativePartyAtSelection.length,
      );
      expect(hostEnemies.map(mon => mon.species.speciesId)).toEqual(authoritativePartyAtSelection);
      expect(new Set(hostEnemies.map(mon => mon.id)).size, "every mirror receives a unique authoritative id").toBe(
        authoritativePartyAtSelection.length,
      );
      expect(
        guestEnemies.map(mon => ({ id: mon.id, species: mon.species.speciesId })),
        "the guest adopts the exact host mirror identities and ordering",
      ).toEqual(hostEnemies.map(mon => ({ id: mon.id, species: mon.species.speciesId })));

      logs.flush();
    }, 300_000);

    // ===========================================================================================
    // IT #4 - #818 CO-OP QUIZ MIRRORING (the leaf-glue PROOF). A quiz-bearing ME (ER_SEALED_DOOR, the
    // Unown CIPHER) runs its embedded ErQuizPhase on BOTH real engines. This is a DISTINCT authoritative
    // path from IT #1: the option chain unshifts an ErQuizPhase, and the mini-game is a whole multi-
    // question sub-phase whose ENGINE outcome only the HOST owns. So:
    //   - HOST (drive side, counter 0): ErQuizPhase.start streams the whole SESSION to the guest as a
    //     `mePresent` subPrompt { kind:"quiz" } on the 8M pump seq, then each committed answer relays out
    //     as a bare "quizAns" integer on the disjoint 8_500_000 family (coopQuizAnswerSeq).
    //   - GUEST (follow side): its CoopReplayMePhase RACES the 8M outcome, sees the quiz subPrompt, and
    //     settleForWatcherQuiz DETACHES + unshifts a mirror ErQuizPhase off the identical streamed
    //     questions. That mirror FOLLOWS - each question arms coopQuizAwaitRemoteAnswer, buffer-hits the
    //     owner's relayed integer, and self-feeds onAnswer with ZERO local input - landing the identical
    //     answers. The re-armed outcome/terminal race then applies the post-quiz meResync + runs the true
    //     LEAVE terminal (leave + advance ONCE) via the settledDetached duty branch.
    // ER_SEALED_DOOR chosen because "cipher" needs NO per-question sprite atlas loads (Unown icons are
    // boot-loaded) and it is NON-battle; the answer index is a fixed 0 per question, so both engines
    // commit the identical choices. The option opens an embedded reward/heal shop after the quiz (like
    // IT #1's DEPARTMENT_STORE_SALE), driven exactly as IT #1 drives it.
    // ===========================================================================================
    it("DUO ME: #818 quiz mirroring - host drives an ER_SEALED_DOOR cipher quiz + streams it; guest mirror quiz FOLLOWs the relayed answers, meResync + leave in lockstep", async () => {
      /** The Sealed Door decodes GLYPH_COUNT (3) Unown cipher words on the shared ErQuiz engine. */
      const QUIZ_QUESTIONS = 3;
      /** Option 1 is the cipher-quiz option (option 2 leaves the door sealed). */
      const QUIZ_OPTION = 1;
      /** The DRIVE side commits a fixed answer index per question; both engines apply the identical choice. */
      const HOST_ANSWER = 0;
      /** #818: the per-question owner->follower answer relay lives on the 8_500_000 family (coopQuizAnswerSeq). */
      const QUIZ_ANSWER_SEQ_BASE = 8_500_000;

      // ===== REACH: park the HOST on a real ER_SEALED_DOOR ME wave, then stand up the two-engine rig
      // (host owns the ME at counter 0). Identical structure to IT #1. =====
      await game.runToMysteryEncounter(MysteryEncounterType.ER_SEALED_DOOR, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
      const hostScene = game.scene;
      expect(hostScene.currentBattle.battleType, "host reached a MYSTERY_ENCOUNTER wave").toBe(
        BattleType.MYSTERY_ENCOUNTER,
      );
      expect(hostScene.currentBattle.mysteryEncounter?.encounterType, "the forced ME is ER_SEALED_DOOR").toBe(
        MysteryEncounterType.ER_SEALED_DOOR,
      );

      const pair = createLoopbackPair();
      const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
      const hostTransportSendSpy = vi.spyOn(pair.host, "send");

      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      expect(counterBefore, "the quiz ME opens on interaction counter 0 (host owns even)").toBe(0);
      expect(rig.guestRuntime.controller.interactionCounter(), "guest also at counter 0").toBe(0);

      // Spy the guest's sole convergence mechanism (fires EXACTLY once at the host's terminal meResync).
      const applyMeOutcomeSpy = vi.spyOn(coopEngine, "applyCoopMeOutcome");
      // Tap the retained host transport. P33 carries the quiz session and every host-owned answer as
      // addressed operations; the raw mePresent/quizAns relays are intentionally absent in journal mode.
      let guestMePhase: Phase | undefined;
      let guestQuizQuestions = 0;
      let guestQuizAnswered = 0;
      let guestQuizShop: ShopPhaseSeam | undefined;

      // A mirror-quiz handoff must be INTERLEAVED (the IT #2 split), NOT driven host-fully-first. On the
      // quiz's `mePresent subPrompt {kind:"quiz"}`, the guest's CoopReplayMePhase.start races the 8M outcome
      // against the 9M terminal, then settleForWatcherQuiz RE-ARMS that race. If the host had already
      // buffered the 9M LEAVE (the host-fully-first ordering IT #1 uses), the FIRST race's terminalArm
      // buffer-HITS + consumes it, and the re-armed terminalArm finds an empty 9M inbox and never resolves -
      // so the guest converges (meResync) but never runs the leave + advance. So we park the host BEFORE its
      // terminal (STEP A), run the guest's quiz handoff + mirror quiz while the 9M inbox is still empty
      // (STEP B, first terminalArm network-waits), then fire the host's terminal (STEP C) so the guest's
      // ALREADY-ARMED re-armed race consumes the meResync + LEAVE (STEP D). STEP C uses withClientSync so
      // the loopback deliver-microtasks flush UNDER the GUEST ctx in STEP D (the cross-ctx footgun the IT #2
      // guest-owned handshake also dodges), keeping applyCoopMeOutcome + leaveEncounterWithoutBattle +
      // advanceInteraction all against the GUEST scene/controller.

      // ===== STEP A (host): select the quiz option, run its embedded ErQuizPhase headlessly (answer every
      // question via the ER_QUIZ handler's stored callback), drive the post-quiz embedded shop, and PARK at
      // PostMysteryEncounterPhase WITHOUT running it - so the session + quizAns are buffered but the terminal
      // meResync (8M) + LEAVE (9M) are NOT sent yet (they only fire in PostMysteryEncounterPhase.start). =====
      await withClient(rig.hostCtx, async () => {
        // Cross the intro dialogue into MysteryEncounterPhase (coopBeginMePump pins the ME counter +
        // streams the presentation, so coopQuizSide() resolves "drive") and pick the cipher-quiz option.
        await runSelectMysteryEncounterOption(game, QUIZ_OPTION);

        // runSelectMysteryEncounterOption leaves stale prompts whose expire conditions (MessagePhase /
        // MysteryEncounterPhase, expiring on OptionSelected/Command/TurnInit) never recur once we cross into
        // ErQuizPhase - left in the single-file FIFO prompt queue they park at prompts[0] and starve the quiz
        // prompts. Drop them; the quiz drive below owns the prompt queue from here.
        (game.promptHandler as unknown as { prompts: unknown[] }).prompts.length = 0;

        // Advance the option's "selected" dialogue so its option phase runs (transition + unshift ErQuizPhase).
        game.onNextPrompt(
          "MysteryEncounterOptionSelectedPhase",
          UiMode.MESSAGE,
          () => game.scene.ui.getHandler().processInput(Button.ACTION),
          () => game.isCurrentPhase("ErQuizPhase"),
        );

        // Complete the owner's async quiz with hostCtx continuously installed. Two browsers have separate
        // globals; switching this one-realm fixture to guestCtx between questions makes the host phase's
        // captured lifecycle fence correctly reject its own continuation. The safe, player-real boundary
        // is the reciprocal reward screen: retain the complete session and answers, then let the follower
        // consume them while the host is parked there and before the final ME terminal exists.
        for (let q = 0; q < QUIZ_QUESTIONS; q++) {
          game.onNextPrompt(
            "ErQuizPhase",
            UiMode.ER_QUIZ,
            () => {
              const handler = game.scene.ui.getHandler() as unknown as { onChoice: ((i: number) => void) | null };
              handler.onChoice?.(HOST_ANSWER);
            },
            () => game.isCurrentPhase("PostMysteryEncounterPhase"),
          );
        }
        await game.phaseInterceptor.to("SelectModifierPhase", false);
        const hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
        expect(hostShop.phaseName, "host reached the embedded post-quiz reward shop").toBe("SelectModifierPhase");
        await driveHostRewardShopOwner(hostShop, {
          takeReward: false,
          // Start the guest's retained replay, consume the complete quiz FIFO, and enter its production
          // watcher shop before the owner is allowed to commit LEAVE.
          partnerReady: async () => {
            await withClient(rig.guestCtx, async () => {
              // Observe the exact phase the replay creates. A real scheduler may already run all three
              // retained answers before startGuestMeReplay's final drain returns, so current-phase polling
              // cannot demand that the consumed quiz becomes current again.
              const factory = rig.guestScene.phaseManager as unknown as {
                create: (phaseName: string, ...args: unknown[]) => Phase;
              };
              const originalCreate = factory.create;
              let quizPhase: ErQuizPhaseSeam | undefined;
              let quizStartObserved = false;
              factory.create = function captureMirrorQuiz(phaseName: string, ...args: unknown[]): Phase {
                const created = originalCreate.call(this, phaseName, ...args);
                if (phaseName === "ErQuizPhase") {
                  quizPhase = created as unknown as ErQuizPhaseSeam;
                  const originalStart = created.start;
                  created.start = function observeMirrorQuizStart(): void {
                    quizStartObserved = true;
                    originalStart.call(this);
                  };
                }
                return created;
              };
              try {
                guestMePhase = await startGuestMeReplay(rig.guestScene);
              } finally {
                factory.create = originalCreate;
              }
              if (quizPhase == null) {
                throw new Error("guest retained quiz session created no production ErQuizPhase");
              }
              guestQuizQuestions = quizPhase.questions.length;
              if (quizPhase.answered < QUIZ_QUESTIONS) {
                if (rig.guestScene.phaseManager.getCurrentPhase() !== (quizPhase as unknown as Phase)) {
                  await driveClientPhaseQueueTo(rig.guestScene, "captured mirrored ErQuizPhase", {
                    matches: phase => phase === (quizPhase as unknown as Phase),
                    maxPhases: 16,
                  });
                }
                guestQuizAnswered = await driveGuestMirrorQuiz(rig.guestScene, quizPhase, QUIZ_QUESTIONS, {
                  alreadyStarted: quizStartObserved,
                });
              } else {
                // The production scheduler consumed the complete retained FIFO while the replay handoff was
                // draining. Preserve that evidence instead of fabricating or re-entering an old quiz.
                guestQuizAnswered = quizPhase.answered;
              }
              guestQuizShop = await startGuestMeShopOwner(rig.guestScene);
            });
          },
          partnerSettle: async () => {
            if (guestQuizShop == null) {
              throw new Error("guest quiz reward continuation never opened its reciprocal shop");
            }
            await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestQuizShop!, { alreadyStarted: true }));
          },
        });
        // MAJOR-3: the embedded ME shop suppresses its own advance mid-ME - still counter 0.
        expect(
          rig.hostRuntime.controller.interactionCounter(),
          "embedded post-quiz ME shop suppressed its own advance (MAJOR-3, still counter 0 mid-ME)",
        ).toBe(counterBefore);
        // PARK before the true terminal (do NOT run it): the meResync + LEAVE are streamed only inside
        // PostMysteryEncounterPhase.start (STEP C), so the guest's 9M inbox stays empty through STEP B.
        await game.phaseInterceptor.to("PostMysteryEncounterPhase", false);
      });

      // The host has NOT advanced yet (its terminal is parked, not run).
      expect(
        rig.hostRuntime.controller.interactionCounter(),
        "host has NOT advanced yet (terminal parked before PostMysteryEncounterPhase.start)",
      ).toBe(counterBefore);

      // ===== DRIVE-SIDE PROOF (host): one retained quiz SESSION plus one addressed answer per question.
      const quizSessionSends = committedMePresentations(hostTransportSendSpy.mock.calls).filter(
        outcome => outcome.subPrompt?.kind === "quiz",
      );
      expect(
        quizSessionSends.length,
        "host retained the quiz SESSION as an ME_PRESENT subPrompt { kind:'quiz' } (#818)",
      ).toBe(1);
      const streamedSession = quizSessionSends[0];
      expect(
        streamedSession.subPrompt?.kind === "quiz" ? streamedSession.subPrompt.questions.length : -1,
        "the retained session carries all GLYPH_COUNT questions",
      ).toBe(QUIZ_QUESTIONS);

      const quizAnswerOperations = committedMeOperations(hostTransportSendSpy.mock.calls).filter(
        operation => operation.kind === "QUIZ_ANSWER",
      );
      expect(quizAnswerOperations.length, "host retained one addressed QUIZ_ANSWER operation per question (#818)").toBe(
        QUIZ_QUESTIONS,
      );
      // Each answer retains its own per-question address (seq*8000 + QUIZ_ANSWER tag + question index)
      // and carries the fixed committed choice.
      expect(
        quizAnswerOperations.map(operation => parseCoopOperationId(operation.id)?.pinnedSeq),
        "quiz answers use exact per-question retained addresses (order-proof, collision-free)",
      ).toEqual([
        QUIZ_ANSWER_SEQ_BASE * 8000 + 5000,
        (QUIZ_ANSWER_SEQ_BASE + 1) * 8000 + 5001,
        (QUIZ_ANSWER_SEQ_BASE + 2) * 8000 + 5002,
      ]);
      expect(
        quizAnswerOperations.every((operation, questionIndex) => {
          const payload = operation.payload as { questionIndex: number; choice: number };
          return payload.questionIndex === questionIndex && payload.choice === HOST_ANSWER;
        }),
        "every retained quiz answer carries the exact question and committed choice",
      ).toBe(true);

      // ===== STEP B (guest): start the divert, drain to the quiz handoff (the first outcome/terminal race
      // sees the buffered quiz session but an EMPTY 9M inbox, so its terminalArm network-waits WITHOUT
      // consuming a terminal), and run the mirror ErQuizPhase - the FOLLOW side, buffer-hitting every
      // owner-relayed quizAns with zero local input. The re-armed race is left PARKED (its outcomeArm2 +
      // terminalArm2 pending) so STEP D can resolve it under the guest ctx. =====
      expect(
        guestMePhase,
        "guest QUEUED its mirror ErQuizPhase after the quiz handoff (#818 settleForWatcherQuiz)",
      ).toBeDefined();
      expect(guestQuizQuestions, "guest mirror quiz renders the host's identical streamed questions").toBe(
        QUIZ_QUESTIONS,
      );
      expect(
        guestQuizAnswered,
        "guest mirror quiz consumed every owner-relayed answer with zero local input (FOLLOW side, #818)",
      ).toBe(QUIZ_QUESTIONS);
      // The guest has adopted the pre-reward settlement but has NOT advanced yet: the host has not sent
      // the ordered final LEAVE after the public reward surface.
      expect(
        applyMeOutcomeSpy.mock.calls.length,
        "guest applied exactly the retained pre-reward settlement while the final terminal stays parked",
      ).toBe(1);
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        "guest has NOT advanced yet (host terminal still parked)",
      ).toBe(counterBefore);

      // ===== STEP C (host, SYNCHRONOUS): fire PostMysteryEncounterPhase.start() - for a no-outro non-battle
      // ME it runs fully synchronously: it streams the comprehensive meResync (8M) + the LEAVE terminal (9M)
      // + advances the host counter, all in one stack. withClientSync installs the host ctx, runs it, and
      // RESTORES the ctx before any microtask flushes - so the loopback deliver-microtasks it scheduled are
      // still pending and will flush under the GUEST ctx in STEP D. =====
      withClientSync(rig.hostCtx, () => {
        rig.hostScene.phaseManager.getCurrentPhase()!.start();
      });
      // The host advanced the alternation counter exactly once for the whole quiz ME.
      expect(
        rig.hostRuntime.controller.interactionCounter(),
        "host advanced the interaction counter once for the whole quiz ME",
      ).toBe(counterBefore + 1);

      // Capture the host's authoritative post-ME state for the guest-convergence assert (as in IT #1); the
      // meResync captured the host's state at STEP C, so the guest converges to exactly these values.
      const hostSeed = hostScene.seed;
      const hostEncounteredEvents = JSON.stringify(hostScene.mysteryEncounterSaveData.encounteredEvents);
      expect(
        hostScene.mysteryEncounterSaveData.encounteredEvents.length,
        "host recorded the quiz ME in its ME-save (a non-trivial value the guest must converge to)",
      ).toBeGreaterThan(0);

      // ===== STEP D (guest): drain so the host's now-buffered meResync (8M) + LEAVE (9M) deliver to the
      // guest's PARKED re-armed race UNDER the guest ctx - applyCoopMeOutcome converges the guest, then the
      // LEAVE runs leaveEncounterWithoutBattle + advanceInteraction via the settledDetached duty branch. =====
      await withClient(rig.guestCtx, async () => {
        for (let i = 0; i < 24; i++) {
          await drainLoopback();
          if (
            applyMeOutcomeSpy.mock.calls.length > 0
            && rig.guestRuntime.controller.interactionCounter() > counterBefore
          ) {
            break;
          }
        }
      });

      // The guest's CoopReplayMePhase settled (via the quiz handoff, then the detached leave terminal).
      expect(
        (guestMePhase as unknown as { settled: boolean }).settled,
        "guest CoopReplayMePhase settled (quiz handoff + detached leave)",
      ).toBe(true);
      // The retained lifecycle applies two distinct images: pre-reward preparation, then final leave.
      expect(
        applyMeOutcomeSpy.mock.calls.length,
        "guest applied the ordered pre-reward and final Mystery state images exactly once each",
      ).toBe(2);
      // CONVERGENCE: the guest's RNG seed + ME-save converged to the host's authoritative values.
      expect(rig.guestScene.seed, "guest RNG seed converged to the host's via meResync").toBe(hostSeed);
      expect(
        JSON.stringify(rig.guestScene.mysteryEncounterSaveData.encounteredEvents),
        "guest ME-save (encounteredEvents) converged to the host's via meResync",
      ).toBe(hostEncounteredEvents);

      // ===== INTERACTION-COUNTER LOCKSTEP: both controllers advanced exactly once for the whole quiz ME. =====
      expect(
        rig.hostRuntime.controller.interactionCounter(),
        "host counter is 1 after the quiz ME (single advance)",
      ).toBe(counterBefore + 1);
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        "guest counter is 1 after the quiz ME (lockstep with host, single advance)",
      ).toBe(counterBefore + 1);

      logs.flush();
    }, 300_000);

    // ===========================================================================================
    // IT #5 - #831 REPEATED OPTION-SELECT ROUNDS (audit P0#1, GROUP REPEAT). The 8 press-your-luck delves
    // + Safari Zone re-fire MysteryEncounterPhase(optionSelectSettings) each round ("descend again? / dig
    // again?"). On the host each re-fire re-streams a FRESH top-level `mePresent` (no subPrompt) on 8M via
    // coopHostStreamPresentation. PRE-FIX the guest handled exactly ONE top-level present: a re-fired bare
    // mePresent fell to the "stray outcome" branch (coop-replay-me-phase.ts) and resolved toward the
    // terminal, so a HOST-OWNED delve froze the guest on round 1 (it never re-rendered rounds 2+ and dropped
    // the terminal meResync); a GUEST-OWNED delve softlocked (the host's coopHostAwaitGuestIndex blocked for
    // the 20-min ceiling). POST-FIX awaitOutcomeThenTerminal treats a bare mePresent on a live unsettled
    // phase as a NEW ROUND (beginNewRound): re-render the selector off the fresh presentation + re-arm the
    // race, inheriting the ONE live 9M terminal arm (#818) so a fast host's already-buffered LEAVE is never
    // lost. This drives a REAL 2-round ER_INTO_THE_CALDERA delve (DIVE -> PUSH[survive] -> BANK) on a
    // HOST-OWNED encounter (counter 0) and asserts: the host re-streamed a fresh present per round, the guest
    // re-rendered BOTH new rounds (two adopted presentations), the terminal still settled ONCE (single
    // meResync apply + leave), and both counters advanced exactly once in lockstep - no hang.
    //
    // A press-your-luck round is deterministic here by forcing randSeedInt to its MAX (the bust roll
    // `randSeedInt(10000) < chance*10000` can never fire, so every PUSH SURVIVES) and driving the host's real
    // UI. Interleaved like IT #4 (host parks BEFORE its terminal so the guest runs its rounds while 9M is
    // empty, then the host fires the terminal) - the #818 latent race would otherwise let the FIRST race's
    // terminalArm buffer-consume a fast host's LEAVE and strand the re-armed rounds.
    // ===========================================================================================
    it("DUO ME: a HOST-OWNED 2-round press-your-luck delve (ER_INTO_THE_CALDERA) - guest re-renders BOTH rounds, terminal settles once, lockstep, no hang (#831)", async () => {
      /** DIVE (option 0) starts the delve; RISE (option 1) leaves. */
      const DIVE_OPTION_CURSOR: Button[] = [];
      /** Each press-your-luck round: PUSH = cursor 0, BANK = cursor 1 (Button.RIGHT). */
      const PUSH_CURSOR: Button[] = [];
      const BANK_CURSOR: Button[] = [Button.RIGHT];
      /** DIVE + PUSH(survive) + BANK => the guest sees TWO repeated-select rounds after the initial present. */
      const EXPECTED_NEW_ROUNDS = 2;

      // ===== REACH: park the HOST on a real ER_INTO_THE_CALDERA ME wave, then stand up the two-engine rig
      // (host owns the ME at counter 0 - even). Identical structure to IT #1 / IT #4. =====
      await game.runToMysteryEncounter(MysteryEncounterType.ER_INTO_THE_CALDERA, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
      const hostScene = game.scene;
      expect(hostScene.currentBattle.battleType, "host reached a MYSTERY_ENCOUNTER wave").toBe(
        BattleType.MYSTERY_ENCOUNTER,
      );
      expect(hostScene.currentBattle.mysteryEncounter?.encounterType, "the forced ME is ER_INTO_THE_CALDERA").toBe(
        MysteryEncounterType.ER_INTO_THE_CALDERA,
      );

      const pair = createLoopbackPair();
      const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
      const hostTransportSendSpy = vi.spyOn(pair.host, "send");

      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      expect(counterBefore, "the delve opens on interaction counter 0 (host owns even)").toBe(0);
      expect(rig.guestRuntime.controller.interactionCounter(), "guest also at counter 0").toBe(0);

      // Spy the guest's sole convergence mechanism (fires EXACTLY once at the host's terminal meResync).
      const applyMeOutcomeSpy = vi.spyOn(coopEngine, "applyCoopMeOutcome");
      // Tap the retained host transport: each round is a distinct addressed ME_PRESENT operation.
      let replay!: Phase;
      let newRounds = 0;
      let guestShop!: ShopPhaseSeam;

      // ===== STEP A (host): drive the REAL delve DIVE -> PUSH(survives) -> BANK, then the embedded reward
      // shop, and PARK at PostMysteryEncounterPhase WITHOUT running it - so the 3 round presents are streamed
      // + buffered on the guest's 8M inbox, but the terminal meResync (8M) + LEAVE (9M) are NOT sent yet
      // (they fire only in PostMysteryEncounterPhase.start, STEP C). =====
      await withClient(rig.hostCtx, async () => {
        // Drive the delve deterministically: force randSeedInt to its MAX so the bust roll never fires
        // (every PUSH survives), and auto-advance ME narration / round-prompt messages (a delve queues a
        // variable count per round) via a scoped ui.showText that invokes its callback immediately.
        const randSpy = vi
          .spyOn(Common, "randSeedInt")
          .mockImplementation((range: number, min = 0) => min + Math.max(0, range - 1));
        const showTextSpy = vi.spyOn(hostScene.ui, "showText").mockImplementation((_text, _delay, callback) => {
          if (typeof callback === "function") {
            callback();
          }
        });
        // The only showDialogue in the reach path is "A mysterious encounter appeared!" (EncounterPhase,
        // speaker "???"); auto-advance it via the prompt handler (showText auto-advance can't see it).
        game.onNextPrompt(
          "EncounterPhase",
          UiMode.MESSAGE,
          () =>
            (hostScene.ui.getHandler() as unknown as { processInput(b: number): boolean }).processInput(Button.ACTION),
          () => game.isCurrentPhase("MysteryEncounterPhase"),
          true,
        );
        try {
          // Round 0: pick DIVE (starts the press-your-luck loop -> re-fires round 1).
          await pickHostMeOption(game, hostScene, DIVE_OPTION_CURSOR, { startNextRound: true });
          await withClient(rig.guestCtx, async () => {
            replay = await startGuestMeReplay(rig.guestScene);
            newRounds = await drainGuestMeReplayNewRounds(replay, 1);
          });
          expect(newRounds, "guest rendered repeated delve round 1 while the owner waited").toBe(1);

          // Round 1: pick PUSH -> survives (randSeedInt mocked to max) -> re-fires round 2.
          await pickHostMeOption(game, hostScene, PUSH_CURSOR, {
            alreadyStarted: true,
            startNextRound: true,
          });
          await withClient(rig.guestCtx, async () => {
            newRounds = await drainGuestMeReplayNewRounds(replay, EXPECTED_NEW_ROUNDS);
          });
          expect(newRounds, "guest rendered repeated delve round 2 while the owner waited").toBe(EXPECTED_NEW_ROUNDS);

          // Round 2: pick BANK -> ends the delve (sets rewards + leaves) -> embedded reward shop.
          await pickHostMeOption(game, hostScene, BANK_CURSOR, { alreadyStarted: true });
          // Drive the embedded end-of-ME reward shop (owner leave). MAJOR-3: it suppresses its own advance
          // mid-ME, so the counter stays at 0 here.
          await game.phaseInterceptor.to("SelectModifierPhase", false);
          const hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
          expect(hostShop.phaseName, "host reached the embedded end-of-delve reward shop").toBe("SelectModifierPhase");
          await driveHostRewardShopOwner(hostShop, {
            takeReward: false,
            // Materialize every buffered delve round on the watcher before the owner leaves the
            // reciprocal shop. The rounds were already rendered in lockstep above; now both browsers
            // are physically present at the retained reward boundary at the same time.
            partnerReady: async () => {
              guestShop = await withClient(rig.guestCtx, () => startGuestMeShopOwner(rig.guestScene));
            },
            partnerSettle: async () => {
              await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop, { alreadyStarted: true }));
            },
          });
          expect(
            rig.hostRuntime.controller.interactionCounter(),
            "embedded ME reward shop suppressed its own advance (MAJOR-3, still counter 0 mid-ME)",
          ).toBe(counterBefore);
          // PARK before the true terminal (do NOT run it): the meResync + LEAVE are streamed only inside
          // PostMysteryEncounterPhase.start (STEP C), so the guest's 9M inbox stays empty through STEP B.
          await game.phaseInterceptor.to("PostMysteryEncounterPhase", false);
        } finally {
          showTextSpy.mockRestore();
          randSpy.mockRestore();
          // Clear any leftover prompts so nothing fires against the host scene during the guest pumps.
          (game.promptHandler as unknown as { prompts: unknown[] }).prompts.length = 0;
        }
      });

      // The host has NOT advanced yet (its terminal is parked, not run).
      expect(
        rig.hostRuntime.controller.interactionCounter(),
        "host has NOT advanced yet (terminal parked before PostMysteryEncounterPhase.start)",
      ).toBe(counterBefore);

      // ===== HOST DRIVE-SIDE PROOF: the host retained a distinct top-level `ME_PRESENT` (no subPrompt)
      // per round - the initial DIVE/RISE present + one per re-fired round (PUSH/BANK x2) = 3. =====
      const presentSends = committedMePresentations(hostTransportSendSpy.mock.calls).filter(
        presentation => presentation.subPrompt == null,
      );
      expect(
        presentSends.length,
        "host retained a fresh bare ME_PRESENT per round (initial DIVE/RISE + 2 re-fired rounds)",
      ).toBe(EXPECTED_NEW_ROUNDS + 1);
      // #831 host label fix: the re-fired rounds stream the ROUND's overrideOptions (PUSH/BANK), NOT the
      // stale base DIVE/RISE options - so the guest renders the round's real prompt. Round labels differ
      // from the initial present's labels; PRE-FIX they were identical (base options re-streamed).
      expect(
        JSON.stringify(presentSends[1].labels),
        "re-fired round 1 streamed the ROUND's option labels, not the stale base DIVE/RISE labels (#831 host fix)",
      ).not.toBe(JSON.stringify(presentSends[0].labels));

      // ===== STEP B (guest): run the guest's REAL CoopReplayMePhase. It consumes the 3 buffered presents
      // FIFO on 8M: present#0 at start() (watcher render), then present#1 + present#2 each as a NEW ROUND
      // (beginNewRound re-renders + re-arms, inheriting the live 9M arm). The 9M terminal inbox is still
      // empty, so the phase PARKS (does NOT settle) after the 2 new rounds. A no-progress stall would leave
      // newRoundsRendered < 2 and fail the assert below (loud, not a hang). =====
      // The load-bearing #831 assertion: the guest re-rendered BOTH repeated-select rounds (pre-fix it
      // rendered ZERO - the re-fired presents fell to the stray branch and it headed for the terminal).
      expect(newRounds, "guest re-rendered BOTH repeated option-select rounds (two adopted presentations) (#831)").toBe(
        EXPECTED_NEW_ROUNDS,
      );
      // The real embedded reward continuation has taken control, but the replay's exactly-once terminal
      // guard must remain open until the final PostMysteryEncounter terminal actually exists.
      expect(
        (replay as unknown as { settled: boolean }).settled,
        "guest CoopReplayMePhase remains live before the final Mystery terminal",
      ).toBe(false);
      // The guest has adopted the pre-reward settlement but has not advanced (the final leave is parked).
      expect(
        applyMeOutcomeSpy.mock.calls.length,
        "guest applied exactly the retained pre-reward settlement while the final terminal stays parked",
      ).toBe(1);
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        "guest has NOT advanced yet (host terminal still parked)",
      ).toBe(counterBefore);

      // ===== STEP C (host, SYNCHRONOUS): fire PostMysteryEncounterPhase.start() - for a no-outro non-battle
      // ME it runs synchronously: streams the comprehensive meResync (8M) + the LEAVE terminal (9M) +
      // advances the host counter. withClientSync restores the ctx before any loopback deliver-microtask
      // flushes, so they flush under the GUEST ctx in STEP D (the cross-ctx footgun IT #2 / IT #4 also dodge). =====
      withClientSync(rig.hostCtx, () => {
        rig.hostScene.phaseManager.getCurrentPhase()!.start();
      });
      expect(
        rig.hostRuntime.controller.interactionCounter(),
        "host advanced the interaction counter once for the whole delve (single advance)",
      ).toBe(counterBefore + 1);

      const hostSeed = hostScene.seed;
      const hostEncounteredEvents = JSON.stringify(hostScene.mysteryEncounterSaveData.encounteredEvents);

      // ===== STEP D (guest): drain so the host's now-buffered meResync (8M) + LEAVE (9M) deliver to the
      // guest's PARKED re-armed race UNDER the guest ctx: applyCoopMeOutcome converges the guest, then the
      // LEAVE runs leaveEncounterWithoutBattle + advanceInteraction (the single terminal). =====
      await withClient(rig.guestCtx, async () => {
        for (let i = 0; i < 16; i++) {
          await drainLoopback();
          if (
            applyMeOutcomeSpy.mock.calls.length === 1
            && rig.guestRuntime.controller.interactionCounter() === counterBefore + 1
          ) {
            break;
          }
        }
      });

      // The terminal STILL settles exactly once after the multi-round loop (all existing terminal machinery
      // unchanged): the guest left once, applied the host's meResync once.
      expect(
        (replay as unknown as { settled: boolean }).settled,
        "guest replay remained exactly-once settled through the detached delve terminal",
      ).toBe(true);
      expect(
        applyMeOutcomeSpy.mock.calls.length,
        "guest applied the ordered pre-reward and final Mystery state images exactly once each",
      ).toBe(2);
      // CONVERGENCE: the guest's RNG seed + ME-save converged to the host's authoritative post-delve values.
      expect(rig.guestScene.seed, "guest RNG seed converged to the host's via meResync").toBe(hostSeed);
      expect(
        JSON.stringify(rig.guestScene.mysteryEncounterSaveData.encounteredEvents),
        "guest ME-save (encounteredEvents) converged to the host's via meResync",
      ).toBe(hostEncounteredEvents);

      // ===== INTERACTION-COUNTER LOCKSTEP: both controllers advanced EXACTLY ONCE for the whole multi-round
      // delve (the repeated rounds are ONE alternation step - no per-round double-advance). =====
      expect(
        rig.hostRuntime.controller.interactionCounter(),
        "host counter is 1 after the delve (single advance)",
      ).toBe(counterBefore + 1);
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        "guest counter is 1 after the delve (lockstep with host, single advance)",
      ).toBe(counterBefore + 1);

      logs.flush();
    }, 300_000);

    // ===========================================================================================
    // IT #6 - #839 MID-DIVERT ME-ENTRY HEAL SAFETY (the live co-op softlock). A guest-owned ME opens; the
    // guest's me-entry full-state checksum MISMATCHES the host's (the live root: an ME-granted mon's
    // divergent per-client id diverged the saveDataDigest - closed by the H1 fix in coop-savedata-digest,
    // but ANY mismatch here must be handled the same). The guest requests a stateSync and applies the
    // host's full snapshot WHILE it is diverting into CoopReplayMePhase. PRE-#839 that heal ran with
    // suppressResummon=FALSE: the field COMPOSITION re-summon (reconcileCoopEnemyField / reconcileCoopPlayerField)
    // tore the ME field/divert down out from under the parked selector -> the guest orphaned its
    // CoopReplayMePhase and softlocked (one screen continued, the other could not). POST-#839 the heal is
    // suppressResummon=TRUE (advisory, cheap scalar + module-let writes only; it never re-summons the
    // field, never touches the phase queue, never cancels a relay waiter), so the divert SURVIVES and the
    // ME proceeds to convergence regardless of whether the early heal fully closed the gap.
    //
    // This drives the REAL me-entry path (host stamps its authoritative checksum -> guest handler
    // mismatches -> requestStateSync -> host answers with captureCoopFullSnapshot -> guest applies), so it
    // asserts the runtime's OWN suppressResummon choice (a revert to FALSE fails the spy assert), then
    // proves no orphan by completing the guest-owned ME (relay pick -> host applies -> lockstep convergence).
    // ===========================================================================================
    it("DUO ME (#839): a me-entry checksum MISMATCH mid-divert heals with suppressResummon=TRUE - the guest keeps its selector, never orphans CoopReplayMePhase, and completes the ME in lockstep", async () => {
      await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [
        SpeciesId.SNORLAX,
        SpeciesId.GENGAR,
      ]);
      const hostScene = game.scene;
      expect(hostScene.currentBattle.battleType, "host reached a MYSTERY_ENCOUNTER wave").toBe(
        BattleType.MYSTERY_ENCOUNTER,
      );

      const pair = createLoopbackPair();
      const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);

      // Seed counter 1 (ODD -> guest owns the ME, so it OPENS its own selector) - the IT #2 setup.
      await withClient(rig.hostCtx, () => {
        rig.hostRuntime.controller.advanceInteraction();
      });
      await withClient(rig.guestCtx, () => {
        rig.guestRuntime.controller.advanceInteraction();
      });
      await drainLoopback();
      const counterBefore = rig.hostRuntime.controller.interactionCounter();
      expect(counterBefore, "the ME opens on interaction counter 1 (guest owns odd)").toBe(1);

      const applyMeOutcomeSpy = vi.spyOn(coopEngine, "applyCoopMeOutcome");
      const handleOptionSelectSpy = vi.spyOn(MysteryEncounterPhase.prototype, "handleOptionSelect");

      // ===== STEP A (host): reach MysteryEncounterPhase - coopBeginMePump streams the presentation on 8M
      // and coopHostAwaitGuestIndex parks AWAITING the guest's index (host can't take a human pick at an odd
      // counter). This ALSO stamps the host's authoritative me-entry checksum (sendMeChecksum). =====
      await withClient(rig.hostCtx, async () => {
        await game.phaseInterceptor.to("MysteryEncounterPhase", false);
        await game.phaseInterceptor.to("MysteryEncounterPhase");
      });
      await drainLoopback();

      // ===== STEP B (guest): divert into CoopReplayMePhase - adopt the host presentation, resolve
      // ownsMe=TRUE at counter 1, OPEN the selector. This is the in-flight mid-divert parked state. =====
      const replay = await withClient(rig.guestCtx, () => startGuestMeReplay(rig.guestScene));
      expect(
        rig.guestScene.phaseManager.getCurrentPhase()?.phaseName,
        "guest diverted into CoopReplayMePhase with its selector open",
      ).toBe("CoopReplayMePhase");
      const guestFieldBefore = withClientSync(rig.guestCtx, () => rig.guestScene.getPlayerField().length);

      // ===== INJECT the mid-divert me-entry heal (#839): force a checksum MISMATCH (diverge the guest's
      // money), then fire the REAL path - host stamps its authoritative checksum, the guest's onMeChecksum
      // handler mismatches, requests a stateSync, the host answers with its full snapshot, and the guest
      // applies it WHILE parked in the divert. =====
      const applyFullSnapshotSpy = vi.spyOn(coopEngine, "applyCoopFullSnapshot");
      const meSeq = (replay as unknown as { seq: number }).seq;
      withClientSync(rig.guestCtx, () => {
        rig.guestScene.money += 424_242; // diverge so captureCoopChecksum mismatches the host's
      });
      withClientSync(rig.hostCtx, () => {
        rig.hostRuntime.battleStream.sendMeChecksum(meSeq, coopEngine.captureCoopChecksum());
      });
      // Complete the async round-trip across ctxs: (guest) recv checksum -> requestStateSync; (host) answer
      // with its authoritative snapshot under the HOST scene; (guest) receive + apply the heal.
      await withClient(rig.guestCtx, () => drainLoopback());
      await withClient(rig.hostCtx, () => drainLoopback());
      await withClient(rig.guestCtx, () => drainLoopback());

      // The heal fired, and it was SAFE: suppressResummon=TRUE on every me-entry apply (the runtime's own
      // choice - a revert to FALSE fails here). applyCoopFullSnapshot touches no phase queue and cancels no
      // relay waiter, so the divert is undisturbed.
      const heals = applyFullSnapshotSpy.mock.calls;
      expect(heals.length, "the me-entry mismatch fired the stateSync heal mid-divert").toBeGreaterThan(0);
      expect(
        heals.every(c => c[2] === true),
        "every mid-divert me-entry heal ran with suppressResummon=TRUE (advisory, no field re-summon) (#839)",
      ).toBe(true);
      applyFullSnapshotSpy.mockRestore();

      // The in-flight ME divert SURVIVED the heal: the guest is STILL parked in CoopReplayMePhase (not
      // orphaned), NOT settled, its on-field composition intact, and the money healed to the host's value.
      expect(
        rig.guestScene.phaseManager.getCurrentPhase()?.phaseName,
        "guest is STILL in CoopReplayMePhase after the mid-divert heal (divert not orphaned) (#839)",
      ).toBe("CoopReplayMePhase");
      expect(
        (replay as unknown as { settled: boolean }).settled,
        "guest ME divert did NOT settle/leave on the advisory heal (#839)",
      ).toBe(false);
      expect(
        withClientSync(rig.guestCtx, () => rig.guestScene.getPlayerField().length),
        "guest on-field composition intact through the heal (no field re-summon torn it down) (#839)",
      ).toBe(guestFieldBefore);

      // ===== PROVE NO ORPHAN by completing the guest-owned ME through convergence (the IT #2 handshake).
      // The selector is still live, so the guest relays its pick, the host applies it, and both advance in
      // lockstep - impossible if the heal had orphaned the divert. =====
      withClientSync(rig.guestCtx, () => relayGuestMePickWithIntent(replay, rig.guestScene, counterBefore, 0));

      let hostShop!: ShopPhaseSeam;
      await withClient(rig.hostCtx, async () => {
        await drainLoopback();
        await game.phaseInterceptor.to("SelectModifierPhase", false);
        hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
        hostShop.start();
        await drainLoopback();
      });
      expect(
        handleOptionSelectSpy,
        "host applied the guest's relayed option post-heal (the divert selector was NOT orphaned) (#839)",
      ).toHaveBeenCalled();

      const guestShop = await withClient(rig.guestCtx, () => startGuestMeShopOwner(rig.guestScene));
      withClientSync(rig.guestCtx, () => relayGuestMeShopLeaveSync(guestShop));

      await withClient(rig.hostCtx, async () => {
        for (let i = 0; i < 16; i++) {
          await drainLoopback();
          await withClient(rig.guestCtx, () => drainLoopback());
          await drainLoopback();
          if (hostScene.phaseManager.getCurrentPhase()?.phaseName !== "SelectModifierPhase") {
            break;
          }
        }
        await game.phaseInterceptor.to("PostMysteryEncounterPhase");
      });
      const hostSeed = hostScene.seed;

      const guestReplay = await withClient(rig.guestCtx, async () => {
        startGuestMeOutcomeRace(replay);
        return drainGuestMeReplayToSettle(replay);
      });

      // CONVERGENCE + LOCKSTEP: the guest settled once, applied the host's meResync once, its seed converged,
      // and BOTH counters advanced exactly once - the ME proceeded to completion despite the mid-divert heal.
      expect(guestReplay.settled, "guest CoopReplayMePhase settled (completed the ME after the heal) (#839)").toBe(
        true,
      );
      expect(
        applyMeOutcomeSpy.mock.calls.length,
        "guest applied the pre-reward settlement and final leave state exactly once each",
      ).toBe(2);
      expect(rig.guestScene.seed, "guest RNG seed converged to the host's via meResync").toBe(hostSeed);
      expect(rig.hostRuntime.controller.interactionCounter(), "host advanced once for the whole ME").toBe(
        counterBefore + 1,
      );
      expect(
        rig.guestRuntime.controller.interactionCounter(),
        "guest advanced once for the whole ME (lockstep) - no softlock (#839)",
      ).toBe(counterBefore + 1);

      logs.flush();
    }, 300_000);
  },
);
