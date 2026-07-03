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
//      the guest is a pure renderer (awaits the comprehensive meResync + LEAVE). DEPARTMENT_STORE_SALE.
//   2. GUEST-OWNED non-battle ME (counter 1, odd): the host CANNOT take the human pick, so it AWAITS
//      the guest's relayed option INDEX on 8M (coopHostAwaitGuestIndex) and applies it PROGRAMMATICALLY;
//      the guest renders the selector off the host presentation + relays its pick. DEPARTMENT_STORE_SALE.
//   3. BATTLE-HANDOFF ME (the documented #693 softlock class): an option that SPAWNS a battle relays
//      COOP_ME_BATTLE_HANDOFF (-1000) on the 9M term seq with NO trailing 8M meResync; the guest's
//      CoopReplayMePhase must finishWithoutLeaving() (end WITHOUT advancing - the single advance defers
//      to the TRUE ME terminal after the battle), NOT hang awaiting an 8M outcome. FIGHT_OR_FLIGHT opt 1.
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
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattleType } from "#enums/battle-type";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { MysteryEncounterPhase } from "#phases/mystery-encounter-phases";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuoForMe,
  drainGuestMeReplayToSettle,
  drainLoopback,
  driveGuestMeReplay,
  driveHostRewardShopOwner,
  installDuoLogCapture,
  relayGuestMeOptionIndexOnly,
  type ShopPhaseSeam,
  startGuestMeOutcomeRace,
  startGuestMeReplay,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { runMysteryEncounterToEnd, runSelectMysteryEncounterOption } from "#test/utils/encounter-test-utils";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** A valid ME wave: WILD, non-boss, in [10,180], waveIndex % 10 != 1 (see isMysteryEncounterValidForWave). */
const ME_WAVE = 12;

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
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
        await driveHostRewardShopOwner(hostShop, { takeReward: false });
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
      const guestReplay = await withClient(rig.guestCtx, () => driveGuestMeReplay(rig.guestScene));

      // The guest left the encounter exactly once (the single `settled` terminal).
      expect(guestReplay.settled, "guest CoopReplayMePhase settled (left once)").toBe(true);
      // The guest applied the host's comprehensive meResync exactly once (its sole convergence path).
      expect(applyMeOutcomeSpy.mock.calls.length, "guest applied the host's comprehensive meResync exactly once").toBe(
        1,
      );
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

    // ===========================================================================================
    // IT #2 - GUEST-OWNED non-battle ME (counter 1, odd). DISTINCT code path from the host-owned case:
    // the host CANNOT take the human pick, so MysteryEncounterPhase.coopHostAwaitGuestIndex() AWAITS the
    // guest's relayed option INDEX on 8M and applies it PROGRAMMATICALLY via handleOptionSelect; the
    // guest renders the selector off the host presentation and relays its cursor via
    // CoopReplayMePhase.handleGuestOptionSelect -> relay.sendInteractionChoice(8M,"me",index). This is the
    // bidirectional pick->await->outcome handshake, so it interleaves host/guest in explicit phases with
    // drainLoopback between (strict per-ctx; no cross-ctx await continuation under the wrong globalScene).
    // ===========================================================================================
    it("DUO ME: a GUEST-OWNED DEPARTMENT_STORE_SALE - guest relays the pick, host applies it programmatically, lockstep", async () => {
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
      withClientSync(rig.guestCtx, () => relayGuestMeOptionIndexOnly(replay, 0));

      // ===== STEP C (host): the relayed index's deliver-microtask is queued but UNFIRED. Pump the host
      // UNDER hostCtx: the first drainLoopback flushes it, the coopHostAwaitGuestIndex await resolves (its
      // .then() runs under the HOST scene), applies handleOptionSelect(option 0) PROGRAMMATICALLY, runs the
      // option chain through the embedded reward shop to PostMysteryEncounterPhase (streams meResync on 8M +
      // LEAVE on 9M into the GUEST's relay inbox - BUFFERED, since the guest has no pending waiter yet -
      // and advances the counter once). =====
      await withClient(rig.hostCtx, async () => {
        await drainLoopback(); // flush the index deliver-microtask -> host await resolves under the HOST scene
        await game.phaseInterceptor.to("SelectModifierPhase", false);
        const hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
        expect(hostShop.phaseName, "host reached the embedded end-of-ME reward shop").toBe("SelectModifierPhase");
        await driveHostRewardShopOwner(hostShop, { takeReward: false });
        await game.phaseInterceptor.to("PostMysteryEncounterPhase");
      });

      // The host APPLIED the guest's relayed pick programmatically (the load-bearing guest-owned proof).
      expect(
        handleOptionSelectSpy,
        "host applied the guest's relayed option via handleOptionSelect",
      ).toHaveBeenCalled();
      // The applied option was index 0 (the guest's relayed cursor), and it produced the TM-shop reward.
      expect(
        handleOptionSelectSpy.mock.calls.some(c => c[1] === 0),
        "host applied option INDEX 0 (the guest's pick)",
      ).toBe(true);
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
      expect(applyMeOutcomeSpy.mock.calls.length, "guest applied the host's comprehensive meResync exactly once").toBe(
        1,
      );
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
    // (FIGHT_OR_FLIGHT option 1 -> initBattleWithEnemyConfig) relays COOP_ME_BATTLE_HANDOFF (-1000) on the
    // 9M term seq with NO trailing 8M meResync. The guest's CoopReplayMePhase.awaitOutcomeThenTerminal
    // RACES 8M (outcome) vs 9M (terminal): the terminal wins, handleTerminalAction sees the battle-handoff
    // sentinel and calls finishWithoutLeaving() - it ends WITHOUT leaving the encounter and WITHOUT
    // advancing the counter (the single ME advance defers to the TRUE terminal AFTER the spawned battle).
    // This is the EXACT path that hung the guest pre-fix: a guest awaiting ONLY the 8M outcome parks forever
    // on a meResync the host never sends. The harness asserts the handoff boundary: settled via the
    // battle-handoff branch (NOT a leave), counter NOT advanced, no meResync applied, no hang.
    // ===========================================================================================
    it("DUO ME: a host-owned BATTLE-spawning ME (FIGHT_OR_FLIGHT opt 1) hands off via 9M with no meResync - guest finishes WITHOUT leaving/advancing, no hang", async () => {
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

      // ===== Drive the GUEST's CoopReplayMePhase. The host buffered COOP_ME_BATTLE_HANDOFF on 9M and NO
      // meResync on 8M. The guest's outcome/terminal race MUST resolve the 9M terminal (battle-handoff) and
      // finishWithoutLeaving - NOT hang awaiting an 8M meResync that never comes. driveGuestMeReplay drains
      // to `settled`; a no-progress stall THROWS (the #693 hang detection). =====
      const guestReplay = await withClient(rig.guestCtx, () => driveGuestMeReplay(rig.guestScene));

      // The guest settled (ended) - via the BATTLE-HANDOFF branch, NOT a leave. Discriminators:
      expect(guestReplay.settled, "guest CoopReplayMePhase settled (ended once) at the battle-handoff").toBe(true);
      // (1) NO meResync was applied (battle-handoff has no trailing 8M outcome - the softlock-class signature).
      expect(
        applyMeOutcomeSpy.mock.calls.length,
        "guest applied NO meResync at a battle-handoff (the 9M terminal had no trailing 8M outcome)",
      ).toBe(0);
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
  },
);
