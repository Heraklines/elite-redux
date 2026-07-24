/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op MYSTERY ENCOUNTERS through the AUTHORITATIVE OPERATION PRIMITIVE
// (Wave-2c run-state migration; docs/plans/2026-07-10-coop-authoritative-run-state-migration.md
// §2.5 item 2, §5.1/§5.3). The migrated-path proof obligation:
//
//   1. END-TO-END, all THREE authoritative ME legs (flag ON): a full ME each of
//      - HOST-OWNED non-battle (DEPARTMENT_STORE_SALE): the guest's terminal is gated through
//        the operation primitive and adopts a host-stated terminal "leave".
//      - GUEST-OWNED non-battle (DEPARTMENT_STORE_SALE, odd counter): the guest mints an
//        ME_PICK intent; the HOST commits it (invariant 3).
//      - BATTLE-HANDOFF (FIGHT_OR_FLIGHT opt 1): the committed terminal STATES "battle" BEFORE
//        the guest builds its ME-battle phases - the #859/#860 phantom-turn structural cure.
//   2. ADVERSARIAL (engine-free, deterministic): a STALE decision from a PREVIOUS ME is REJECTED
//      (invariant 6, the #861 shape); a DUPLICATE re-delivery of an applied op is a no-op
//      (invariant 5); a LATE terminal arriving after the ME already terminal-adopted is dropped.
//   3. #859-SHAPE (engine-free): when the committed op states a NON-battle terminal, the watcher's
//      derived terminal is "leave" (it never routes to finishWithoutLeaving / builds the phantom
//      battle chain); a stale battle-handoff from an earlier ME is REJECTED, so it can never build
//      the phantom either. The type is stated by the OPERATION before any phase is constructed.
//
// The operation-gating (2/3) is ITSELF proof the primitive is active: with the flag OFF the
// watcher adopts the relayed sentinel verbatim (legacy pass-through). The companion duo suites
// (coop-duo-mystery, coop-duo-me-*) prove the surface stays green under BOTH flag states; this
// suite proves the NEW behavior the flag turns on.
//
// HOW TO RUN (gated ER_SCENARIO=1):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-me-operation.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { initGlobalScene } from "#app/global-scene";
import type { Phase } from "#app/phase";
import { decodeCoopV2InteractionEnvelope } from "#data/elite-redux/coop/authority-v2/cutover-interaction";
import * as coopEngine from "#data/elite-redux/coop/coop-battle-engine";
import * as meOp from "#data/elite-redux/coop/coop-me-operation";
import {
  isCoopMeOperationEnabled,
  resetCoopMeOperationFlag,
  resetCoopMeOperationState,
  setCoopMeOperationEnabled,
} from "#data/elite-redux/coop/coop-me-operation";
import {
  CoopOperationHost,
  createCoopRuntimeOpState,
  setActiveCoopRuntimeOpState,
} from "#data/elite-redux/coop/coop-operation-runtime";
import { clearCoopRuntime, coopHostStreamMeMessage, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import type { CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { BattleType } from "#enums/battle-type";
import { Button } from "#enums/buttons";
import { GameModes } from "#enums/game-modes";
import { MysteryEncounterType } from "#enums/mystery-encounter-type";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { GameManager } from "#test/framework/game-manager";
import {
  advanceCoopActiveTime,
  awaitRewardShopPhaseExit,
  buildDuoForMe,
  clearCoopSchedulerActiveTimeClock,
  drainGuestMeReplayToSettle,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveGuestMeReplay,
  driveHostMeRewardShopWithGuestReplay,
  installCoopSchedulerActiveTimeClock,
  installDuoLogCapture,
  relayGuestMeOptionIndexOnly,
  relayGuestMeShopLeaveSync,
  type ShopPhaseSeam,
  settleDuoPromise,
  startGuestMeOutcomeRace,
  startGuestMeReplay,
  startGuestMeShopOwner,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { runMysteryEncounterToEnd, runSelectMysteryEncounterOption } from "#test/utils/encounter-test-utils";
import Phaser from "phaser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** A valid ME wave (WILD, non-boss, in [10,180], waveIndex % 10 != 1). */
const ME_WAVE = 12;

/** Flip a freshly-built scene into the co-op game mode (shared by host + guest). */
function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

function committedInteractionOperation(message: CoopMessage) {
  if (message.t !== "authorityEntry") {
    return null;
  }
  return decodeCoopV2InteractionEnvelope({ ...message.body, context: message.ctx })?.envelope.pendingOperation ?? null;
}

function isCommittedMeOperation(message: CoopMessage, kind: string): boolean {
  return committedInteractionOperation(message)?.kind === kind;
}

describe.skipIf(!RUN)("co-op DUO mystery encounter via the operation primitive (Wave-2c)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`me-op-${Date.now()}`);
    // Direct operation-seam assertions below intentionally run without assembling a transport runtime.
    // Install the same per-runtime operation state production assembly provides so fail-loud runtime
    // isolation remains part of the contract instead of falling back to process-global state.
    setActiveCoopRuntimeOpState(createCoopRuntimeOpState());
    // Explicitly select the MIGRATED path from clean operation state (no leftover from a prior file).
    setCoopMeOperationEnabled(true);
    resetCoopMeOperationState();
    game.override
      .battleStyle("double")
      .startingWave(ME_WAVE)
      .mysteryEncounterChance(100)
      .startingLevel(50)
      .disableTrainerWaves();
  });

  afterEach(() => {
    clearCoopSchedulerActiveTimeClock();
    resetCoopMeOperationFlag();
    resetCoopMeOperationState();
    logs.dispose();
    clearCoopRuntime();
    setActiveCoopRuntimeOpState(null);
    vi.restoreAllMocks();
    // #710 harness-citizenship: buildDuoForMe builds a 2nd BattleScene (the guest) whose ctor steals
    // globalScene. Restore the host GameManager scene for the NEXT ER_SCENARIO file's GameManager.
    initGlobalScene(game.scene);
  });

  afterAll(() => {
    // best-effort
  });

  // =====================================================================================
  // LEG 1 - HOST-OWNED non-battle ME: the guest's terminal is gated through the operation
  // primitive and adopts a host-stated terminal "leave".
  // =====================================================================================
  it("LEG 1 (host-owned non-battle): the guest adopts the ME terminal THROUGH the operation primitive (terminal 'leave')", async () => {
    expect(isCoopMeOperationEnabled(), "the migrated ME-operation path is active for this test").toBe(true);

    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    expect(hostScene.currentBattle.battleType, "host reached a MYSTERY_ENCOUNTER wave").toBe(
      BattleType.MYSTERY_ENCOUNTER,
    );

    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore, "the ME opens on interaction counter 0 (host owns even)").toBe(0);

    const submitSpy = vi.spyOn(CoopOperationHost.prototype, "submit");
    const applyOutcomeSpy = vi.spyOn(coopEngine, "applyCoopMeOutcome");

    // Drive the HOST through the whole ME (buffers present + meResync + LEAVE), then the guest replays.
    let guestReplayPhase!: Phase;
    await withClient(rig.hostCtx, async () => {
      await runMysteryEncounterToEnd(game, 1);
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      const hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      // Drive the embedded reward shop to its leave (the host is the forced reward owner mid-ME).
      guestReplayPhase = await driveHostMeRewardShopWithGuestReplay(hostShop, rig.guestCtx, rig.guestScene);
      await game.phaseInterceptor.to("PostMysteryEncounterPhase");
    });

    const guestReplay = await withClient(rig.guestCtx, () => drainGuestMeReplayToSettle(guestReplayPhase));
    expect(guestReplay.settled, "guest CoopReplayMePhase settled (left once)").toBe(true);

    const terminals = submitSpy.mock.calls
      .map(call => call[0])
      .filter(intent => intent.kind === "ME_TERMINAL")
      .map(intent => intent.payload);
    expect(
      terminals.map(terminal => (meOp.isCompleteCoopMeTerminalPayload(terminal) ? terminal.terminal : null)),
      "the pre-reward settlement and final leave are two complete, ordered retained transactions",
    ).toEqual(["reward-settled", "leave"]);
    const leave = terminals[1];
    if (meOp.isCompleteCoopMeTerminalPayload(leave)) {
      expect(leave.destination.kind).toBe("continue");
    }
    expect(
      applyOutcomeSpy,
      "the guest materializes the pre-reward settlement and final leave state exactly once each",
    ).toHaveBeenCalledTimes(2);

    // Lockstep, same as the legacy suite: both advanced once for the whole ME.
    expect(rig.hostRuntime.controller.interactionCounter()).toBe(counterBefore + 1);
    expect(rig.guestRuntime.controller.interactionCounter()).toBe(counterBefore + 1);
    logs.flush();
  }, 300_000);

  it("DURABILITY: dropping the first retained leave transaction redelivers and executes it exactly once", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    installCoopSchedulerActiveTimeClock();
    let leaveCommitSends = 0;
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 1,
        reorder: 0,
        delay: 0,
        faultable: (message: CoopMessage): boolean => {
          const operation = committedInteractionOperation(message);
          if (
            operation?.kind !== "ME_TERMINAL"
            || !meOp.isCompleteCoopMeTerminalPayload(operation.payload)
            || operation.payload.terminal !== "leave"
          ) {
            return false;
          }
          leaveCommitSends += 1;
          return leaveCommitSends === 1;
        },
      },
      { seed: 0x6d3e },
    );
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const applyOutcomeSpy = vi.spyOn(coopEngine, "applyCoopMeOutcome");

    let guestReplayPhase!: Phase;
    await withClient(rig.hostCtx, async () => {
      await runMysteryEncounterToEnd(game, 1);
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      const hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      guestReplayPhase = await driveHostMeRewardShopWithGuestReplay(hostShop, rig.guestCtx, rig.guestScene);
      await game.phaseInterceptor.to("PostMysteryEncounterPhase");
    });
    expect(pair.faultsInjected(), "the first V2 ME terminal entry delivery must actually be dropped").toBeGreaterThan(
      0,
    );
    expect(leaveCommitSends, "only the immediate immutable leave entry has been sent so far").toBe(1);

    await withClient(rig.hostCtx, async () => {
      advanceCoopActiveTime(300);
      await drainLoopback();
    });
    expect(leaveCommitSends, "the Authority V2 log redelivered the retained leave entry").toBeGreaterThanOrEqual(2);

    const guestReplay = await withClient(rig.guestCtx, () => drainGuestMeReplayToSettle(guestReplayPhase));
    expect(guestReplay.settled, "the durable ME_TERMINAL must settle the real guest replay phase").toBe(true);
    expect(
      applyOutcomeSpy,
      "redelivery preserves exactly one apply for each ordered no-battle terminal step",
    ).toHaveBeenCalledTimes(2);
    expect(rig.guestRuntime.controller.interactionCounter()).toBe(counterBefore + 1);
    logs.flush();
  }, 300_000);

  it("STOPSHIP: losing the V2 control-installed receipt redelivers one immutable terminal without reapply", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    installCoopSchedulerActiveTimeClock();
    let armReceiptDrop = false;
    let terminalReceiptAttempts = 0;
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 1,
        reorder: 0,
        delay: 0,
        faultable: (message: CoopMessage): boolean => {
          if (
            !armReceiptDrop
            || message.t !== "authorityReceipt"
            || message.body.stage !== "controlInstalled"
            || !message.body.operationId.includes(":ME_TERMINAL:")
          ) {
            return false;
          }
          terminalReceiptAttempts += 1;
          return terminalReceiptAttempts === 1;
        },
      },
      { seed: 0x6d3e_2 },
    );
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const applyOutcomeSpy = vi.spyOn(coopEngine, "applyCoopMeOutcome");
    const hostSendSpy = vi.spyOn(pair.host, "send");

    let guestReplayPhase!: Phase;
    await withClient(rig.hostCtx, async () => {
      await runMysteryEncounterToEnd(game, 1);
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      const hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      guestReplayPhase = await driveHostMeRewardShopWithGuestReplay(hostShop, rig.guestCtx, rig.guestScene);
      await game.phaseInterceptor.to("PostMysteryEncounterPhase", false);
    });
    armReceiptDrop = true;
    await withClient(rig.hostCtx, () => hostScene.phaseManager.getCurrentPhase()!.start());
    const guestReplay = await withClient(rig.guestCtx, () => drainGuestMeReplayToSettle(guestReplayPhase));
    expect(guestReplay.settled, "the first terminal delivery settles the production guest replay").toBe(true);
    expect(pair.faultsInjected(), "the first V2 controlInstalled receipt was actually dropped").toBeGreaterThan(0);
    expect(terminalReceiptAttempts, "the replica emitted the dropped terminal receipt").toBe(1);

    await withClient(rig.hostCtx, async () => {
      advanceCoopActiveTime(300);
      await drainLoopback();
    });
    await withClient(rig.guestCtx, () => drainLoopback());
    await withClient(rig.hostCtx, () => drainLoopback());

    const terminalEntries = hostSendSpy.mock.calls
      .map(call => call[0])
      .filter(message => {
        const operation = committedInteractionOperation(message);
        return (
          operation?.kind === "ME_TERMINAL"
          && meOp.isCompleteCoopMeTerminalPayload(operation.payload)
          && operation.payload.terminal === "leave"
        );
      });
    expect(terminalEntries.length, "the authority redelivered the unretired terminal entry").toBeGreaterThanOrEqual(2);
    expect(
      new Set(terminalEntries.map(message => (message.t === "authorityEntry" ? message.body.operationId : null))).size,
      "every retry preserves one immutable operation identity",
    ).toBe(1);
    expect(
      new Set(terminalEntries.map(message => (message.t === "authorityEntry" ? message.body.revision : null))).size,
      "every retry preserves one global V2 revision",
    ).toBe(1);
    expect(applyOutcomeSpy, "duplicate V2 delivery never reapplies either ordered ME terminal").toHaveBeenCalledTimes(
      2,
    );
    expect(rig.hostRuntime.controller.interactionCounter()).toBe(counterBefore + 1);
    expect(rig.guestRuntime.controller.interactionCounter()).toBe(counterBefore + 1);
    logs.flush();
  }, 300_000);

  it("DURABILITY: dropping the top-level mePresent still materializes the host presentation", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;
    installCoopSchedulerActiveTimeClock();
    let presentationCommitSends = 0;
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 1,
        reorder: 0,
        delay: 0,
        faultable: (message: CoopMessage): boolean => {
          if (!isCommittedMeOperation(message, "ME_PRESENT")) {
            return false;
          }
          presentationCommitSends += 1;
          return presentationCommitSends === 1;
        },
      },
      { seed: 0x6d3f },
    );
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    const hostEncounter = hostScene.currentBattle.mysteryEncounter!;
    const populateHostTokens = hostEncounter.populateDialogueTokensFromRequirements.bind(hostEncounter);
    vi.spyOn(hostEncounter, "populateDialogueTokensFromRequirements").mockImplementation(() => {
      populateHostTokens();
      hostEncounter.dialogueTokens.durableProof = "host-authoritative";
    });
    rig.guestScene.currentBattle.mysteryEncounter!.dialogueTokens.durableProof = "guest-local";

    let guestReplayPhase!: Phase;
    await withClient(rig.hostCtx, async () => {
      await runMysteryEncounterToEnd(game, 1);
      expect(
        pair.faultsInjected(),
        "the first retained top-level presentation must actually be dropped",
      ).toBeGreaterThan(0);
      expect(presentationCommitSends, "the first V2 ME_PRESENT delivery was the dropped frame").toBe(1);
      advanceCoopActiveTime(300);
      await drainLoopback();
      expect(presentationCommitSends, "the Authority V2 log redelivered ME_PRESENT").toBeGreaterThanOrEqual(2);
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      const hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      guestReplayPhase = await driveHostMeRewardShopWithGuestReplay(hostShop, rig.guestCtx, rig.guestScene);
      await game.phaseInterceptor.to("PostMysteryEncounterPhase");
    });

    const guestReplay = await withClient(rig.guestCtx, () => drainGuestMeReplayToSettle(guestReplayPhase));
    expect(guestReplay.settled, "the guest replay still reaches its terminal").toBe(true);
    expect(
      rig.guestScene.currentBattle.mysteryEncounter!.dialogueTokens.durableProof,
      "the journal-delivered presentation must replace the guest-local token source",
    ).toBe("host-authoritative");
    logs.flush();
  }, 300_000);

  // =====================================================================================
  // LEG 2 - GUEST-OWNED non-battle ME: the guest MINTS an ME_PICK intent; the HOST COMMITS it.
  // =====================================================================================
  it("LEG 2 (guest-owned non-battle): the guest mints an ME_PICK intent, the HOST commits it through the primitive", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;

    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);

    // Seed the interaction counter to 1 (ODD -> guest owns the ME) via the real controller API.
    await withClient(rig.hostCtx, () => rig.hostRuntime.controller.advanceInteraction());
    await withClient(rig.guestCtx, () => rig.guestRuntime.controller.advanceInteraction());
    await drainLoopback();
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore, "the ME opens on interaction counter 1 (guest owns odd)").toBe(1);

    const authoritySubmitSpy = vi.spyOn(CoopOperationHost.prototype, "submit");

    // STEP A (host): reach MysteryEncounterPhase; the host parks awaiting the guest's relayed index.
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("MysteryEncounterPhase", false);
      await game.phaseInterceptor.to("MysteryEncounterPhase");
    });
    await drainLoopback();

    // STEP B (guest): start the divert, mint the exact typed/ordinal intent that the public selector mints,
    // then relay option index 0 synchronously (send-only). The race remains deferred until STEP D solely
    // because this two-engine harness shares one module graph; production browsers do not share globals.
    const replay = await withClient(rig.guestCtx, () => startGuestMeReplay(rig.guestScene));
    withClientSync(rig.guestCtx, () => relayGuestMeOptionIndexOnly(replay, 0));

    // STEP C (host): flush the relayed index; the host commits the guest's ME_PICK (invariant 3) + applies it,
    // then reaches the embedded reward shop (the #828 pick-watcher on a guest-owned ME - rolls + streams).
    let hostShop!: ShopPhaseSeam;
    await withClient(rig.hostCtx, async () => {
      await drainLoopback();
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      hostShop.start();
      await drainLoopback();
    });

    // THE MIGRATED BEHAVIOR: the HOST committed the guest-owned ME_PICK it received (a host-role commit).
    const hostPickCommits = authoritySubmitSpy.mock.calls
      .map((call, index) => ({ intent: call[0], result: authoritySubmitSpy.mock.results[index] }))
      .filter(({ intent }) => intent.kind === "ME_PICK" && intent.owner === 1);
    expect(
      hostPickCommits.length,
      "the HOST committed the guest's relayed ME_PICK through the operation primitive (invariant 3)",
    ).toBeGreaterThan(0);
    expect(
      hostPickCommits[0].result.type === "return"
        ? hostPickCommits[0].result.value.kind
        : hostPickCommits[0].result.type,
      "the authority accepted and committed the guest-owned intent",
    ).toMatch(/^(committed|reack)$/);
    expect(
      (hostPickCommits[0].intent.payload as { optionIndex: number }).optionIndex,
      "the committed ME_PICK carries the guest's relayed option index (0)",
    ).toBe(0);

    // STEP C2 (guest): the guest OWNS the reward pick (#828) - open its shop as owner, relay LEAVE sync.
    const guestShop = await withClient(rig.guestCtx, () => startGuestMeShopOwner(rig.guestScene));
    withClientSync(rig.guestCtx, () => relayGuestMeShopLeaveSync(guestShop));

    // STEP C3: the host commits the guest owner's LEAVE, the guest materializes the retained result and
    // returns its reciprocal proof, then the host is allowed to leave the embedded shop. This interleave
    // is the production two-browser barrier; a sequential host-only drain cannot cross it.
    await withClient(rig.hostCtx, async () => {
      for (let i = 0; i < 8; i++) {
        await drainLoopback();
      }
    });
    await withClient(rig.guestCtx, async () => {
      for (let i = 0; i < 16; i++) {
        await drainLoopback();
      }
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
    expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the counter once for the ME").toBe(
      counterBefore + 1,
    );

    // STEP D (guest): install the executable replay receiver after the embedded shop has closed. The host's
    // complete terminal was already retained while that nested surface owned the scene, so arming this exact
    // receiver must immediately reannounce readiness instead of waiting for a periodic durability resend.
    const guestDurability = rig.guestRuntime.durability;
    if (guestDurability == null) {
      throw new Error("guest-owned ME test lost its durability journal before terminal replay");
    }
    const terminalReadinessSpy = vi.spyOn(guestDurability, "reconnect");
    const guestReplay = await withClient(rig.guestCtx, async () => {
      startGuestMeOutcomeRace(replay);
      return drainGuestMeReplayToSettle(replay);
    });
    expect(
      terminalReadinessSpy,
      "the live Mystery replay receiver reannounced the retained complete terminal transaction",
    ).toHaveBeenCalled();
    expect(guestReplay.settled, "guest CoopReplayMePhase settled (left once)").toBe(true);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest counter lockstep after the ME").toBe(
      counterBefore + 1,
    );

    logs.flush();
  }, 300_000);

  // =====================================================================================
  // LEG 2b - TRACK R (run 29640634363 mystery lane): GUEST-OWNED NARRATION-BEARING ME. The guest owner
  // picks; the HOST commits the ME_PICK and RETAINS it until the guest proves the typed successor installed.
  // Post-pick narration is not executable control, so Authority V2 must project the exact next interaction
  // and emit its controlInstalled receipt before any reward shop opens. This LEG proves that ordered V2
  // crossing reaches the terminal and next command without falling back to the retired continuation journal.
  // =====================================================================================
  it("LEG 2b (guest-owned, narration-bearing): the committed ME_PICK continuation releases from the post-pick surface, no Title (Track R)", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.DEPARTMENT_STORE_SALE, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;

    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    // runToMysteryEncounter forces a 100% rate for its target wave. This leg crosses into wave 13 to
    // prove the real next-command continuation, so restore the ordinary-wave rate after wave 12 is built.
    game.override.mysteryEncounterChance(0);

    // Seed the interaction counter to 1 (ODD -> guest owns the ME).
    await withClient(rig.hostCtx, () => rig.hostRuntime.controller.advanceInteraction());
    await withClient(rig.guestCtx, () => rig.guestRuntime.controller.advanceInteraction());
    await drainLoopback();
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore, "the ME opens on interaction counter 1 (guest owns odd)").toBe(1);

    // Observe the real V2 wire proof. The retired operation-continuation journal is deliberately absent
    // from correctness: the replica may proceed only after it signs controlInstalled for the exact ME_PICK.
    const guestV2SendSpy = vi.spyOn(pair.guest, "send");

    // STEP A (host): reach MysteryEncounterPhase; the host parks awaiting the guest's relayed index.
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("MysteryEncounterPhase", false);
      await game.phaseInterceptor.to("MysteryEncounterPhase");
    });
    await drainLoopback();

    // STEP B (guest): start the divert -> CoopReplayMePhase (opens the selector as owner), then relay
    // option index 0 send-only (the harness split; the outcome race defers to STEP D).
    const replay = await withClient(rig.guestCtx, () => startGuestMeReplay(rig.guestScene));
    withClientSync(rig.guestCtx, () => relayGuestMeOptionIndexOnly(replay, 0));

    // STEP C (host): flush the relayed index; the host COMMITS the guest's ME_PICK (invariant 3), applies
    // it, and BROADCASTS the retained pick envelope. It then streams a post-pick NARRATION line (the guest
    // renders it in MESSAGE - a null continuation surface), and reaches the embedded reward shop.
    let hostShop!: ShopPhaseSeam;
    await withClient(rig.hostCtx, async () => {
      await drainLoopback();
      // Narration-bearing: stream one post-pick host line so the guest's onMeMessage secondary release path
      // is exercised too. The MESSAGE surface it renders in retires nothing (coopAuthorityContinuationSurface
      // MESSAGE -> null), so only the phase's own emit can release the retained pick.
      coopHostStreamMeMessage("The clerk rings up your order.");
      await game.phaseInterceptor.to("SelectModifierPhase", false);
      hostShop = hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
      hostShop.start();
      await drainLoopback();
    });

    // STEP C1 (guest): pump the guest so it APPLIES the broadcast ME_PICK envelope. The Track R
    // material-apply hook fires here and installs the entry's exact typed successor before any reward shop.
    // Snapshot the wire count first so the assertion isolates this ME_PICK apply window.
    const sendsBeforePickApply = guestV2SendSpy.mock.calls.length;
    const pickApplySends = await withClient(rig.guestCtx, async () => {
      for (let i = 0; i < 8; i++) {
        await drainLoopback();
      }
      return guestV2SendSpy.mock.calls.slice(sendsBeforePickApply).map(call => call[0]);
    });
    expect(
      pickApplySends.some(
        message =>
          message.t === "authorityReceipt"
          && message.body.stage === "controlInstalled"
          && message.body.operationId.includes(":ME_PICK:"),
      ),
      "the guest proved the committed ME_PICK successor installed before any shop opened (Authority V2)",
    ).toBe(true);

    // STEP C2 (guest): the guest OWNS the reward pick (#828) - open its shop as owner, relay LEAVE sync.
    const guestShop = await withClient(rig.guestCtx, () => startGuestMeShopOwner(rig.guestScene));
    withClientSync(rig.guestCtx, () => relayGuestMeShopLeaveSync(guestShop));

    // STEP C3 (host): drain so the guest owner's LEAVE applies, the host shop ends, and the option chain
    // runs to PostMysteryEncounterPhase (streams the terminal + advances once).
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
    expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the counter once for the ME").toBe(
      counterBefore + 1,
    );

    // STEP D (guest): start the outcome/terminal race and drain to the terminal. The guest REACHES its
    // terminal (settles) - it never fell to Title behind an unreleased pick.
    const guestReplay = await withClient(rig.guestCtx, async () => {
      startGuestMeOutcomeRace(replay);
      return drainGuestMeReplayToSettle(replay);
    });
    expect(guestReplay.settled, "guest CoopReplayMePhase reached its terminal (left once) - no Title").toBe(true);

    // The raw relay seam above intentionally stops at the ME terminal. Production does not: its real
    // PostMysteryEncounter/reward tail calls UI.setMode and reaches the next CommandPhase. Drive that exact
    // phase-manager path so the guest observes both still-retained public continuations (REWARD and
    // ME_TERMINAL) at wave+1/turn-1. Never notify the durability layer directly: this regression must fail
    // if a future real UI-to-relay call chain stops being wired.
    let hostMapCommitted = false;
    let guestMapCommitted = false;
    // Production ordering is host materialization/publication first, then guest carrier consumption.
    // Do not nest a host phase drive inside an outer guest withClient window: Promise continuations from
    // EncounterPhase assets/save/tweens can otherwise resume after the nested window restores the guest's
    // process-global scene, turning a host NextEncounterPhase into a correctly blocked guest renderer tail.
    const hostCommand = await withClient(rig.hostCtx, () =>
      driveClientPhaseQueueTo(rig.hostScene, "host post-ME CommandPhase", {
        matches: phase =>
          phase.phaseName === "CommandPhase"
          && (phase as unknown as { getFieldIndex(): number }).getFieldIndex() === COOP_HOST_FIELD_INDEX
          && rig.hostScene.currentBattle.waveIndex === ME_WAVE + 1
          && rig.hostScene.currentBattle.turn === 1,
        perPhaseTimeoutMs: 5_000,
        drivePublicPhaseInput: phase => {
          if (
            phase.phaseName === "SelectBiomePhase"
            && rig.hostScene.ui.getMode() === UiMode.ER_MAP
            && !hostMapCommitted
          ) {
            hostMapCommitted = rig.hostScene.ui.processInput(Button.ACTION);
            return hostMapCommitted;
          }
          return false;
        },
      }),
    );
    const guestCommand = await withClient(rig.guestCtx, () =>
      driveClientPhaseQueueTo(rig.guestScene, "guest post-ME CommandPhase", {
        matches: phase =>
          phase.phaseName === "CommandPhase"
          && (phase as unknown as { getFieldIndex(): number }).getFieldIndex() === COOP_GUEST_FIELD_INDEX
          && rig.guestScene.currentBattle.waveIndex === ME_WAVE + 1
          && rig.guestScene.currentBattle.turn === 1,
        perPhaseTimeoutMs: 5_000,
        drivePublicPhaseInput: phase => {
          if (
            phase.phaseName === "SelectBiomePhase"
            && rig.guestScene.ui.getMode() === UiMode.ER_MAP
            && !guestMapCommitted
          ) {
            guestMapCommitted = rig.guestScene.ui.processInput(Button.ACTION);
            return guestMapCommitted;
          }
          return false;
        },
      }),
    );

    // driveClientPhaseQueueTo deliberately stops BEFORE its target. Start both real CommandPhase objects
    // so their reciprocal rendezvous opens the public COMMAND surfaces that publish the two outstanding
    // continuation proofs. Merely making CommandPhase current is not player-observable and cannot retire
    // retained authority; the old fixture asserted zero pending immediately before this call chain.
    // Each client must start its OWN slot. The guest's preceding host-owned slot is a renderer-only
    // generated skip and driveClientPhaseQueueTo has already advanced past it. Queue every rendezvous
    // frame for its destination ClientCtx during this crossing: ordinary loopback can otherwise resolve
    // the guest's promise while the HOST's process-global scene is installed, a one-process-only failure
    // that cannot occur in two browsers. This is the same destination scheduler used by the canonical
    // production-fidelity driver.
    rig.pair.setDestinationContextDelivery?.(true);
    try {
      await withClient(rig.guestCtx, async () => {
        guestCommand.start();
        await drainLoopback();
      });
      await withClient(rig.hostCtx, async () => {
        hostCommand.start();
        await drainLoopback();
      });
      // Starting either realm first necessarily parks it at the reciprocal rendezvous.
      // A fixed one-sided drain loop is not representative of two event loops. Alternate both complete
      // destination contexts until both real phase starts expose COMMAND, bounded like production.
      const commandSurfacesOpened = (async () => {
        const deadline = Date.now() + 5_000;
        while (
          (rig.hostScene.ui.getMode() !== UiMode.COMMAND || rig.guestScene.ui.getMode() !== UiMode.COMMAND)
          && Date.now() < deadline
        ) {
          await new Promise<void>(resolve => setTimeout(resolve, 10));
        }
        if (rig.hostScene.ui.getMode() !== UiMode.COMMAND || rig.guestScene.ui.getMode() !== UiMode.COMMAND) {
          throw new Error(
            `post-ME command surfaces did not open: host=${UiMode[rig.hostScene.ui.getMode()]}, `
              + `guest=${UiMode[rig.guestScene.ui.getMode()]}`,
          );
        }
      })();
      await settleDuoPromise(rig, commandSurfacesOpened, "post-ME reciprocal command surfaces", {
        timeoutMs: 5_000,
        intervalMs: 5,
      });
    } finally {
      rig.pair.setDestinationContextDelivery?.(false);
    }
    expect(rig.hostScene.ui.getMode(), "host exposed the next public command continuation").toBe(UiMode.COMMAND);
    expect(rig.guestScene.ui.getMode(), "guest exposed the next public command continuation").toBe(UiMode.COMMAND);

    // Both engines converged in lockstep - no pick, reward, or terminal continuation stranded the run.
    expect(rig.hostRuntime.controller.interactionCounter(), "host counter is 2 after the ME").toBe(counterBefore + 1);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest counter is 2 after the ME (lockstep)").toBe(
      counterBefore + 1,
    );
    logs.flush();
  }, 300_000);

  // =====================================================================================
  // LEG 3 - BATTLE-HANDOFF ME (the #859/#860 phantom class). The committed terminal STATES "battle"
  // BEFORE the guest builds its ME-battle phases, so it routes off the OPERATION, never a leftover chain.
  // =====================================================================================
  it("LEG 3 (battle-handoff): the committed terminal STATES 'battle' before the guest builds phases (#859 structural cure)", async () => {
    await game.runToMysteryEncounter(MysteryEncounterType.FIGHT_OR_FLIGHT, [SpeciesId.SNORLAX, SpeciesId.GENGAR]);
    const hostScene = game.scene;

    const pair = createLoopbackPair();
    const rig = await buildDuoForMe(game, pair, setCoopRuntime, toCoop);
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore, "the ME opens on interaction counter 0 (host owns even)").toBe(0);

    const applyMeOutcomeSpy = vi.spyOn(coopEngine, "applyCoopMeOutcome");
    const submitSpy = vi.spyOn(CoopOperationHost.prototype, "submit");

    // Drive the HOST through the BATTLE option (relays COOP_ME_BATTLE_HANDOFF on 9M, NO meResync on 8M).
    await withClient(rig.hostCtx, async () => {
      await runSelectMysteryEncounterOption(game, 1);
      await game.phaseInterceptor.to("MysteryEncounterBattlePhase", false);
      expect(hostScene.phaseManager.getCurrentPhase()?.phaseName, "host spawned the ME battle").toBe(
        "MysteryEncounterBattlePhase",
      );
    });

    // Drive the guest while both destination event loops stay alive. ME_PRESENT's controlInstalled receipt
    // makes the authority publish ME_PICK, whose receipt then publishes the ordered ME_TERMINAL. A fixed
    // guest-only drain loop executes the host receipt callback under the wrong shared-process scene and
    // manufactures a gap that cannot occur in two browsers.
    rig.pair.setDestinationContextDelivery?.(true);
    const guestReplay = await (async () => {
      try {
        const guestReplayPending = withClient(rig.guestCtx, () => driveGuestMeReplay(rig.guestScene));
        return await settleDuoPromise(rig, guestReplayPending, "battle-handoff Mystery replay", {
          timeoutMs: 10_000,
          intervalMs: 5,
        });
      } finally {
        rig.pair.setDestinationContextDelivery?.(false);
      }
    })();
    expect(guestReplay.settled, "guest CoopReplayMePhase settled at the battle-handoff").toBe(true);

    const terminal = submitSpy.mock.calls.map(call => call[0]).find(intent => intent.kind === "ME_TERMINAL")?.payload;
    expect(meOp.isCompleteCoopMeTerminalPayload(terminal), "battle handoff is a complete retained transaction").toBe(
      true,
    );
    if (meOp.isCompleteCoopMeTerminalPayload(terminal)) {
      expect(terminal.terminal).toBe("battle");
      expect(terminal.destination.kind).toBe("battle");
      expect(terminal.outcome.authoritativeState?.enemyParty.length).toBeGreaterThan(0);
      expect(terminal.outcome.authoritativeState?.double, "the post-degrade battle shape is in the transaction").toBe(
        hostScene.currentBattle.double,
      );
      if (terminal.destination.kind === "battle") {
        expect(terminal.destination.encounterMode).toBe(hostScene.currentBattle.mysteryEncounter?.encounterMode);
        expect(terminal.destination.disableSwitch).toBe(false);
      }
    }

    // The battle state/party is now causally bound to the terminal and applies before its exact boot.
    expect(applyMeOutcomeSpy, "guest applies the battle terminal state exactly once").toHaveBeenCalledTimes(1);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest did NOT advance at the battle-handoff").toBe(
      counterBefore,
    );
    expect(rig.guestScene.currentBattle.mysteryEncounter, "guest did NOT leave the encounter").toBeDefined();

    logs.flush();
  }, 300_000);

  // Raw-terminal stale/duplicate tests moved to coop-me-terminal-transaction.test.ts: the retained
  // transaction receiver, not adoptMeWatcherChoice, now owns terminal identity/order/idempotence.
  it("an authoritative terminal retires unconfirmed sub-pick retries before the next encounter", () => {
    vi.useFakeTimers();
    try {
      let retransmits = 0;
      const pinned = 21;
      const id = meOp.commitMeOwnerIntent({
        kind: "ME_SUB",
        seq: 8_000_000 + pinned,
        pinned,
        step: 0,
        payload: { value: 0 },
        localRole: "guest",
        wave: 24,
        turn: 0,
        resend: () => retransmits++,
      });
      expect(id).not.toBeNull();

      vi.advanceTimersByTime(1_000);
      expect(retransmits, "the unconfirmed proposal retries while its encounter is open").toBe(1);

      meOp.settleCoopMeOwnerIntentRetries();
      vi.advanceTimersByTime(10_000);
      expect(retransmits, "the completed encounter cannot retransmit into a later ME").toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
