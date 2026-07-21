/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op BIOME-MARKET CONTINUATION BUY (#866). The every-10-waves biome market
// (BiomeShopPhase, an owner-alternated interaction pinned on coopBiomeStart) stocks TMs / Ability
// Capsules / Memory-class items. Buying one of those runs SelectModifierPhase.applyModifier's
// "queuesContinuation" path (#25): a back-out copy of the shop is queued so escaping the move-learn
// returns to the shop. BiomeShopPhase inherited SelectModifierPhase.copy(), which (a) created a plain
// SelectModifierPhase (the VANILLA reward row, not the biome grid) and (b) copied coopInteractionStart
// - which the biome market NEVER pins (it pins coopBiomeStart). The result was an UNPINNED, wrong-typed
// orphan:
//   * its terminal hit coopAdvanceInteraction with coopInteractionStart=-1 -> the live "advance
//     interaction SKIP unpinned (#837)" that refuses to advance -> the counter never advances
//     symmetrically (the sibling fingerprint), and
//   * it opened a stray reward screen the WATCHER never mirrored -> the wave-10 owner/watcher biome-market
//     handshake stall ("owner can't see the menu", the watcher awaits a stock/leave that never lands).
//
// THE FIX (biome-shop-phase.ts): BiomeShopPhase overrides copy() to build its OWN class (re-opening the
// biome grid) carrying the biome PIN (coopBiomeStart) + roles + already-rolled stock, marked a
// continuation so start() re-opens WITHOUT re-handshaking. Its terminal advances from-pinned via
// coopBiomeTerminal (idempotent), never the base's unpinned advance.
//
// FAILS-BEFORE: the queued continuation is a plain SelectModifierPhase with no coopBiomeStart (unpinned
// orphan) + the "SKIP unpinned" WARN fires + the counter goes asymmetric. PASSES-AFTER: the continuation
// is a pinned BiomeShopPhase, no unpinned advance, both engines advance the interaction in lockstep.
//
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-biome-market-continuation.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { modifierTypes } from "#data/data-lists";
import { captureCoopAuthoritativeBattleState } from "#data/elite-redux/coop/coop-battle-engine";
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import {
  adoptRewardWatcherChoice,
  type CoopRewardOperationBinding,
  captureCoopRewardOperationBinding,
  commitRewardOwnerIntent,
} from "#data/elite-redux/coop/coop-reward-operation";
import {
  clearCoopRuntime,
  getCoopWaveBoundaryStatus,
  isCoopSharedTerminalFrozen,
  setCoopRuntime,
} from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import type { CoopMessage } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { generateModifierTypeOption } from "#data/mystery-encounters/utils/encounter-phase-utils";
import { BattlerIndex } from "#enums/battler-index";
import { Button } from "#enums/buttons";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { BiomeShopPhase, setCoopBiomeMarketTestSkip } from "#phases/biome-shop-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  advanceCoopActiveTime,
  buildDuo,
  type ClientCtx,
  clearCoopSchedulerActiveTimeClock,
  type DuoRig,
  drainLoopback,
  driveClientPhaseQueueTo,
  driveGuestReplayTurn,
  installCoopSchedulerActiveTimeClock,
  installDuoLogCapture,
  pumpDuoDestinations,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

/** Pump BOTH engines' scheduled inboxes once per round (two independent browser event loops). */
async function pumpBoth(rig: DuoRig, rounds = 1): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await withClient(rig.hostCtx, () => drainLoopback());
    await withClient(rig.guestCtx, () => drainLoopback());
  }
}

/** Wait for one client's real public UI mode while keeping that complete client context installed. */
async function waitForMode(ctx: ClientCtx, mode: UiMode, label: string): Promise<void> {
  // Headless Phaser does not tick every fade tween. The bounded production mode transition has a 2s force
  // path; retain this exact client's globals while that local timer/tween callback settles rather than
  // alternating the process-global harness context underneath it.
  await withClient(ctx, async () => {
    for (let i = 0; i < 320; i++) {
      if (ctx.scene.ui.getMode() === mode) {
        return;
      }
      await new Promise<void>(resolve => setTimeout(resolve, 10));
    }
    throw new Error(`${label} never opened ${UiMode[mode]} (stuck on ${UiMode[ctx.scene.ui.getMode()]})`);
  });
}

/** Press one public UI button, bounded by both-engine destination pumps just like two independent browsers. */
async function pressUntilAccepted(rig: DuoRig, ctx: ClientCtx, button: Button, label: string): Promise<void> {
  for (let i = 0; i < 80; i++) {
    const accepted = await withClient(ctx, () => ctx.scene.ui.processInput(button));
    await pumpBoth(rig);
    if (accepted) {
      return;
    }
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`${label} never accepted ${Button[button]}`);
}

/**
 * Bounded proof that the real guest boundary applied the exact retained DATA and, once its public shop
 * opens, recorded continuationReady. Pumping alternates complete client contexts; it never advances a phase.
 */
async function awaitGuestWaveTransaction(rig: DuoRig, wave: number, continuationReady: boolean): Promise<void> {
  for (let attempt = 0; attempt < 24; attempt++) {
    const status = getCoopWaveBoundaryStatus(wave, rig.guestRuntime);
    const current = rig.guestScene.phaseManager.getCurrentPhase();
    const boundaryReleased = current?.phaseName !== "BattleEndPhase";
    if (status?.dataApplied === true && boundaryReleased && (!continuationReady || status.continuationReady === true)) {
      return;
    }
    await pumpDuoDestinations(rig, 1);
  }
  const status = getCoopWaveBoundaryStatus(wave, rig.guestRuntime);
  const current = rig.guestScene.phaseManager.getCurrentPhase();
  throw new Error(
    `guest retained wave ${wave} did not reach ${continuationReady ? "continuationReady" : "dataApplied/release"} `
      + `within 24 destination pumps (current=${current?.phaseName ?? "none"} `
      + `authority=${status?.authority ?? "none"} dataApplied=${status?.dataApplied === true} `
      + `continuationReady=${status?.continuationReady === true})`,
  );
}

/** The private BiomeShopPhase members these probes drive/inspect. */
interface BiomeShopSeam {
  phaseName: string;
  start(): false | undefined;
  end(): void;
  coopBiomeStart: number;
  coopBiomeOwner: boolean;
  coopBiomeOptionOwner: boolean;
  coopBiomeContinuation: boolean;
  shopOptions: unknown[];
  qtys: number[];
  buildStock(): void;
  copy(): BiomeShopSeam;
  coopBiomeTerminal(): void;
  pendingIndex: number;
  coopPendingAuthorityOperationId: string | null;
  coopRewardOperationBinding: CoopRewardOperationBinding | null;
  applyCoopRelayedPurchase(modifier: unknown, validatedCost: number, authoritativeMoney: number): boolean;
  applyCoopProjectedMarketBuy(
    slot: number,
    modifierType: unknown,
    partySlot: number,
    nestedOption: number,
    validatedCost: number,
    operationId: string | undefined,
  ): boolean;
}

describe.skipIf(!RUN)("co-op DUO biome-market continuation buy (#866): pinned copy, lockstep advance", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    setCoopWaveBarrierMs(50);
    setCoopRendezvousWaitMs(50);
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`biome-market-continuation-${Date.now()}`);
    game.override
      .battleStyle("double")
      .startingWave(1)
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(1)
      .enemyMoveset(MoveId.SPLASH)
      .startingLevel(50)
      .moveset([MoveId.TACKLE, MoveId.SPLASH])
      .disableTrainerWaves();
  });

  afterEach(() => {
    setCoopBiomeMarketTestSkip(true);
    setCoopWaveBarrierMs(60_000);
    resetCoopRendezvousWaitMs();
    clearCoopSchedulerActiveTimeClock();
    logs.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

  function liveBiomeShop(): BiomeShopPhase {
    const phase = new BiomeShopPhase();
    (phase as unknown as { coopBoundaryStillLive(generation: number, wave: number): boolean }).coopBoundaryStillLive =
      () => true;
    return phase;
  }

  function wireGuestCommand(rig: DuoRig): void {
    rig.guestRuntime.battleSync.onCommandRequest(({ moveSlots }) => ({
      command: Command.FIGHT,
      cursor: moveSlots.length > 0 ? moveSlots[0] : 0,
      moveId: MoveId.TACKLE,
      targets: [BattlerIndex.ENEMY_2],
    }));
  }

  async function hostPlayWave(rig: DuoRig): Promise<void> {
    await withClient(rig.hostCtx, async () => {
      game.move.select(MoveId.TACKLE, COOP_HOST_FIELD_INDEX, BattlerIndex.ENEMY);
      game.move.select(MoveId.TACKLE, COOP_GUEST_FIELD_INDEX, BattlerIndex.ENEMY_2);
      await game.phaseInterceptor.to("CoopTurnCommitPhase");
    });
  }

  /** A single TM stock option (a CONTINUATION item, so a buy runs the queuesContinuation path). */
  function makeTmOption(): NonNullable<ReturnType<typeof generateModifierTypeOption>> {
    const opt = generateModifierTypeOption(modifierTypes.TM_GREAT, [MoveId.SWORDS_DANCE]);
    if (opt == null) {
      throw new Error("TM market fixture must materialize an option");
    }
    (opt as unknown as { cost: number }).cost = 100;
    return opt;
  }

  /** The live #moulas capture bought this non-continuation held item from a guest-owned market. */
  function makeWideLensOption(): NonNullable<ReturnType<typeof generateModifierTypeOption>> {
    const opt = generateModifierTypeOption(modifierTypes.WIDE_LENS);
    if (opt == null) {
      throw new Error("Wide Lens market fixture must materialize an option");
    }
    (opt as unknown as { cost: number }).cost = 100;
    return opt;
  }

  /** Prepare the exact retained host-side intent that a guest-owned market relay normally installs. */
  function prepareHostMarketIntent(phase: BiomeShopSeam, pinned: number, slot: number, data: number[]): string {
    const binding = captureCoopRewardOperationBinding();
    if (binding == null) {
      throw new Error("retained market test requires an installed host operation binding");
    }
    phase.coopRewardOperationBinding = binding;
    const wave = globalScene.currentBattle?.waveIndex ?? 0;
    const turn = globalScene.currentBattle?.turn ?? 0;
    // Under the all-V2 interaction cutover the host validates the guest proposal by its exact operation
    // identity (`params.action.operationId === opId`, or `proposal-operation-id-mismatch`). A real
    // cutover-active guest owner mints that typed intent first and carries the id on the wire; mirror it
    // here via the production owner-mint helper (mirrors CoopReplayMePhase's commitMeOwnerIntent idiom) so
    // the retained host intent addresses the same operation. The id is minted through
    // makeCoopOperationId + coopRewardOperationActionSlot inside commitRewardOwnerIntent.
    const guestProposal = commitRewardOwnerIntent(
      {
        surface: "market",
        pinned,
        label: "biomeShop",
        choice: slot,
        data,
        terminal: false,
        localRole: "guest",
        wave,
        turn,
      },
      binding,
    );
    const decision = adoptRewardWatcherChoice(
      {
        surface: "market",
        pinned,
        action: { choice: slot, data, operationId: guestProposal?.operationId },
        terminal: false,
        localRole: "host",
        wave,
        turn,
      },
      binding,
    );
    if (!decision.adopt || decision.requiresAuthorityCommit !== true || decision.operationId == null) {
      throw new Error(`host retained intent was not prepared: ${decision.adopt ? "incomplete" : decision.reason}`);
    }
    phase.coopPendingAuthorityOperationId = decision.operationId;
    return decision.operationId;
  }

  function marketMaterialSignature(): string {
    const state = captureCoopAuthoritativeBattleState(globalScene.currentBattle?.turn ?? 0);
    if (state == null) {
      throw new Error("market material signature requires a live battle image");
    }
    return JSON.stringify({
      money: state.money,
      playerParty: state.playerParty,
      playerModifiers: state.playerModifiers,
      pokeballCounts: state.pokeballCounts,
    });
  }

  /**
   * A shared terminal deliberately resets the scene once its quorum completes. Observe the last material
   * boundary before that reset (or the still-live boundary when finalization is asynchronous) so rollback
   * assertions distinguish an actual partial mutation from the intentional post-terminal empty title state.
   */
  function observeBeforeTerminalReset<T>(scene: BattleScene, read: () => T): { read(): T; dispose(): void } {
    let captured: T | undefined;
    let didCapture = false;
    const reset = scene.reset.bind(scene);
    const spy = vi.spyOn(scene, "reset").mockImplementation((clearScene, clearData, reloadI18n) => {
      captured = read();
      didCapture = true;
      reset(clearScene, clearData, reloadI18n);
    });
    return {
      read: () => (didCapture ? captured! : read()),
      dispose: () => spy.mockRestore(),
    };
  }

  // ===========================================================================================
  // A. DETERMINISTIC (no UI): copy() must produce a pinned BiomeShopPhase, not an unpinned reward-row
  // orphan. Pins as if the market opened at counter 9 (guest-owned in the live capture). FAILS-BEFORE:
  // the inherited copy() returns a plain SelectModifierPhase whose coopBiomeStart is undefined.
  // ===========================================================================================
  it("copy() of a biome market carries the biome PIN + type (not an unpinned reward-screen orphan)", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    const result = withClientSync(rig.hostCtx, () => {
      const phase = rig.hostScene.phaseManager.create("BiomeShopPhase") as unknown as BiomeShopSeam;
      // Pin as if the market opened at interaction 9 (guest-owned, host-watcher - the live capture).
      phase.coopBiomeStart = 9;
      phase.coopBiomeOwner = true;
      phase.coopBiomeOptionOwner = true;
      phase.shopOptions = [makeTmOption()];
      phase.qtys = [1];
      const copied = phase.copy();
      return {
        copiedBiomeStart: copied.coopBiomeStart,
        copiedContinuation: copied.coopBiomeContinuation,
        copiedStock: copied.shopOptions.length,
        copiedOwner: copied.coopBiomeOwner,
      };
    });

    logs.flush();
    // The copy inherits the SAME pinned biome interaction (9) - a plain SelectModifierPhase orphan has no
    // coopBiomeStart, so pre-fix this is `undefined` and the copy fires an UNPINNED advance at its terminal.
    expect(result.copiedBiomeStart, "the continuation copy inherits the biome market PIN").toBe(9);
    expect(result.copiedContinuation, "the copy is flagged a continuation (re-opens without re-handshaking)").toBe(
      true,
    );
    expect(result.copiedStock, "the copy re-opens the SAME rolled stock (no re-roll)").toBe(1);
    expect(result.copiedOwner, "the copy inherits the pick-owner role").toBe(true);
  }, 120_000);

  it("guest-owned Wide Lens intent is executed and priced by the host without ending the market", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    // Open the interaction control the way PRODUCTION does - via the real wave-1 reward boundary (the green
    // model in coop-duo-reward-operation.test.ts). hostPlayWave -> driveGuestReplayTurn -> reaching
    // SelectModifierPhase commits the WAVE_ADVANCE whose settled destination is an AWAIT_SUCCESSOR that admits
    // INTERACTION_COMMIT (coop-runtime.ts:9284-9300 - the REWARD_PRESENT and SHOP_PRESENT destinations are
    // BYTE-IDENTICAL there), so the market SHOP_BUY chain rides the SAME control the reward boundary opened.
    // The old synthetic advanceInteraction(0) only bumped the counter and opened NO control, so the market
    // buy had nothing to submit against ("expected false to be true" at applyCoopRelayedPurchase).
    const turn = rig.hostScene.currentBattle.turn;
    await hostPlayWave(rig);
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });

    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const control = (
      rig.hostRuntime as unknown as {
        v2ControlLedger?: { latestControl?: { kind?: string; allowedKinds?: string[]; allowNextWaveStart?: boolean } };
      }
    ).v2ControlLedger?.latestControl;
    // The reward boundary's control is exactly the AWAIT_SUCCESSOR the market must ride: it admits an
    // INTERACTION_COMMIT and permits the next wave to start (the byte-identical REWARD_PRESENT/SHOP_PRESENT
    // destination). Assert it so a regression that closes/retypes that control fails HERE, not opaquely below.
    expect(control?.kind, "the wave-1 reward boundary opened an AWAIT_SUCCESSOR").toBe("AWAIT_SUCCESSOR");
    expect(control?.allowedKinds, "that control admits the market's INTERACTION_COMMIT").toContain(
      "INTERACTION_COMMIT",
    );

    await withClient(rig.hostCtx, async () => {
      const phase = liveBiomeShop() as unknown as BiomeShopSeam;
      const option = makeWideLensOption();
      const target = rig.hostScene.getPlayerParty()[1];
      const modifier = option.type.newModifier(target);
      expect(modifier).not.toBeNull();
      // Align the market pin to the counter the reward boundary opened on. The host is the watcher/applier
      // (coopBiomeOwner=false) exactly as a guest-owned market relays to the host for authoritative pricing.
      phase.coopBiomeStart = counterBefore;
      phase.coopBiomeOwner = false;
      phase.coopBiomeOptionOwner = true;
      phase.shopOptions = [option];
      phase.qtys = [1];
      phase.pendingIndex = 0;
      rig.hostScene.money = 2_000;
      prepareHostMarketIntent(phase, counterBefore, 0, [1, 1_020, 0, 100]);

      expect(phase.applyCoopRelayedPurchase(modifier!, 100, 1_020)).toBe(true);

      expect(rig.hostRuntime.controller.interactionCounter(), "buy does not terminate the pinned market").toBe(
        counterBefore,
      );
      expect(rig.hostScene.money, "the host ignores raw proposed money and applies its exact local price").toBe(1_900);
      expect(phase.qtys[0], "watcher decrements the bought stock once").toBe(0);
      expect(phase.coopPendingAuthorityOperationId, "the complete retained host result releases the intent").toBeNull();
    });

    const allLogs = [...logs.host, ...logs.guest];
    expect(
      allLogs.filter(line => /advance interaction SKIP unpinned/i.test(line)),
      "a paid watcher replay never enters the free-reward terminal path",
    ).toHaveLength(0);
  }, 120_000);

  it("watcher rejects a failed market apply without adopting money or consuming stock", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    await withClient(rig.hostCtx, async () => {
      const phase = liveBiomeShop() as unknown as BiomeShopSeam;
      const option = makeWideLensOption();
      const modifier = option.type.newModifier(rig.hostScene.getPlayerParty()[1]);
      expect(modifier).not.toBeNull();
      phase.coopBiomeStart = 1;
      phase.coopBiomeOwner = false;
      phase.coopBiomeOptionOwner = true;
      phase.shopOptions = [option];
      phase.qtys = [1];
      phase.pendingIndex = 0;
      rig.hostScene.money = 2_000;
      prepareHostMarketIntent(phase, 1, 0, [1, 1_900, 0, 100]);
      const before = marketMaterialSignature();
      const terminalBoundary = observeBeforeTerminalReset(rig.hostScene, () => ({
        material: marketMaterialSignature(),
        qtys: [...phase.qtys],
        pendingIndex: phase.pendingIndex,
      }));

      const addModifierSpy = vi.spyOn(rig.hostScene, "addModifier").mockReturnValue(false);
      let observed: ReturnType<typeof terminalBoundary.read> | null = null;
      try {
        expect(phase.applyCoopRelayedPurchase(modifier!, 100, 1_900)).toBe(false);
        observed = terminalBoundary.read();
      } finally {
        addModifierSpy.mockRestore();
        terminalBoundary.dispose();
      }
      if (observed == null) {
        throw new Error("rejected market apply did not expose its terminal boundary");
      }

      expect(observed.material, "a rejected apply cannot mutate money, party, held items, or balls").toBe(before);
      expect(observed.qtys, "a rejected apply cannot consume authoritative stock").toEqual([1]);
      expect(observed.pendingIndex).toBe(0);
      expect(isCoopSharedTerminalFrozen(rig.hostRuntime), "a rejected addressed intent fails both peers closed").toBe(
        true,
      );
    });
  }, 120_000);

  it("thrown host TM execution restores the exact material image and cannot leak a continuation", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    await withClient(rig.hostCtx, async () => {
      rig.hostRuntime.controller.advanceInteraction(0);
      const phase = liveBiomeShop() as unknown as BiomeShopSeam;
      const tmOption = makeTmOption();
      const target = rig.hostScene.getPlayerParty()[0];
      const modifier = tmOption.type.newModifier(target);
      const leakedHeldItem = makeWideLensOption().type.newModifier(target);
      expect(modifier).not.toBeNull();
      expect(leakedHeldItem).not.toBeNull();
      phase.coopBiomeStart = 1;
      phase.coopBiomeOwner = false;
      phase.coopBiomeOptionOwner = true;
      phase.shopOptions = [tmOption];
      phase.qtys = [1];
      phase.pendingIndex = 0;
      rig.hostScene.money = 2_000;
      prepareHostMarketIntent(phase, 1, 0, [0, 1_900, 0, 100]);
      const before = marketMaterialSignature();
      const hpBefore = target.hp;
      const rngBefore = Phaser.Math.RND.state();
      const terminalBoundary = observeBeforeTerminalReset(rig.hostScene, () => ({
        material: marketMaterialSignature(),
        hp: target.hp,
        rng: Phaser.Math.RND.state(),
        qtys: [...phase.qtys],
        pendingIndex: phase.pendingIndex,
        queued: rig.hostScene.phaseManager.getQueuedPhaseNames(),
      }));

      const addModifierSpy = vi.spyOn(rig.hostScene, "addModifier").mockImplementation(() => {
        rig.hostScene.money = 17;
        target.hp = 1;
        Phaser.Math.RND.frac();
        (rig.hostScene.modifiers as unknown[]).push(leakedHeldItem!);
        (rig.hostScene.phaseManager as unknown as { unshiftPhase(queued: unknown): void }).unshiftPhase(phase.copy());
        throw new Error("injected TM apply failure after partial mutation");
      });
      let observed: ReturnType<typeof terminalBoundary.read> | null = null;
      try {
        expect(phase.applyCoopRelayedPurchase(modifier!, 100, 1_900)).toBe(false);
        observed = terminalBoundary.read();
      } finally {
        addModifierSpy.mockRestore();
        terminalBoundary.dispose();
      }
      if (observed == null) {
        throw new Error("thrown market apply did not expose its terminal boundary");
      }

      expect(observed.material, "money, party data, and held items return to the exact before-image").toBe(before);
      expect(observed.hp).toBe(hpBefore);
      expect(observed.rng, "a failed modifier cannot consume the authoritative RNG cursor").toBe(rngBefore);
      expect(observed.qtys).toEqual([1]);
      expect(observed.pendingIndex).toBe(0);
      expect(
        observed.queued.filter(name => name === "SelectModifierPhase"),
        "the failed TM cannot leave its market continuation runnable",
      ).toHaveLength(0);
      expect(isCoopSharedTerminalFrozen(rig.hostRuntime), "the partial apply enters the retained shared terminal").toBe(
        true,
      );
    });
  }, 120_000);

  it("malformed projected TM result rolls back stock and fails the guest continuation closed", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    await withClient(rig.guestCtx, async () => {
      const phase = liveBiomeShop() as unknown as BiomeShopSeam;
      const tmOption = makeTmOption();
      phase.coopBiomeStart = 0;
      phase.coopBiomeOwner = false;
      phase.coopBiomeOptionOwner = false;
      phase.shopOptions = [tmOption];
      phase.qtys = [1];
      phase.pendingIndex = 0;

      expect(phase.applyCoopProjectedMarketBuy(0, tmOption.type, -1, 0, 100, "reward:market:projected-tm")).toBe(false);
      expect(phase.qtys, "a rejected renderer projection cannot consume stock").toEqual([1]);
      expect(phase.pendingIndex).toBe(0);
      expect(
        rig.guestScene.phaseManager
          .getQueuedPhaseNames()
          .filter(name => name === "LearnMovePhase" || name === "SelectModifierPhase"),
        "no malformed LearnMove/market tail survives the rollback",
      ).toHaveLength(0);
      expect(isCoopSharedTerminalFrozen(rig.guestRuntime), "the guest cannot continue without its exact TM UI").toBe(
        true,
      );
    });
  }, 120_000);

  // ===========================================================================================
  // B. END-TO-END over BOTH engines: the OWNER buys a TM in the biome market + leaves; the WATCHER
  // adopts + applies + leaves. The queued continuation must be a PINNED BiomeShopPhase, NO "SKIP
  // unpinned" WARN may fire, and both engines must advance the interaction counter exactly once.
  // ===========================================================================================
  it("durability: a dropped SHOP_BUY commit still materializes the real TM buy + leave exactly once", async () => {
    setCoopBiomeMarketTestSkip(false); // drive the REAL co-op market
    // The every-ten-waves biome market only rolls on an x0 wave, so this leg starts at wave 10 (the other
    // deterministic probes in this file stay at the beforeEach default wave 1).
    game.override.startingWave(10);
    // Install the deterministic active-time clock BEFORE buildDuo so both shadows' schedulers adopt it: the
    // host's authority-log redelivery backoff is otherwise never exercisable under the manual pump.
    installCoopSchedulerActiveTimeClock();
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);

    // Retarget the fault at the REAL V2 wire artifact: the biome-market SHOP_BUY INTERACTION_COMMIT
    // authorityEntry (operationId `${epoch}:${owner}:SHOP_BUY:${slot}`). The legacy interactionChoice/biomeShop
    // carrier is v2ResultCarrierSuppressed under full V2 - never produced - so faulting it dropped nothing.
    // Drop ONLY the FIRST commit send (the immediate delivery); pass every later one (the host's redelivery).
    let buyCommitSends = 0;
    const isShopBuyInteractionCommit = (msg: CoopMessage): boolean =>
      msg.t === "authorityEntry"
      && msg.body.kind === "INTERACTION_COMMIT"
      && typeof msg.body.operationId === "string"
      && msg.body.operationId.includes(":SHOP_BUY:");
    const pair = wrapCoopFaultPair(
      createLoopbackPair(),
      {
        drop: 1,
        reorder: 0,
        delay: 0,
        faultable: (msg: CoopMessage): boolean => {
          if (!isShopBuyInteractionCommit(msg)) {
            return false;
          }
          buyCommitSends += 1;
          return buyCommitSends === 1;
        },
      },
      { seed: 0xb10e5a },
    );
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    // Open the interaction control the PRODUCTION way - via the real wave-1 reward boundary (the green model
    // in coop-duo-reward-operation.test.ts): hostPlayWave -> driveGuestReplayTurn commits the WAVE_ADVANCE
    // whose settled destination is the AWAIT_SUCCESSOR the market's SHOP_BUY chain rides.
    const wave = rig.hostScene.currentBattle.waveIndex;
    const turn = rig.hostScene.currentBattle.turn;
    await hostPlayWave(rig);
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });

    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    // Counter 0 => the HOST owns this interaction (the host buys + relays; the guest is the watcher).
    expect(counterBefore % 2, "counter 0: host is the market owner").toBe(0);

    const waiveBefore = Overrides.WAIVE_ROLL_FEE_OVERRIDE;
    Overrides.WAIVE_ROLL_FEE_OVERRIDE = true;
    rig.hostScene.money = 999999;

    // Track the continuation copy the owner's TM buy queues (its phaseName + carried biome pin).
    const queuedContinuation: { hasBiomeStart: boolean; biomeStart: number }[] = [];

    try {
      // (1) Reach the OWNER's REAL queued BiomeShopPhase and patch buildStock on THAT phase only so the sole
      // stock is a single continuation TM (a deterministic slot-0 buy). The guest adopts the streamed stock.
      await withClient(rig.hostCtx, () => game.phaseInterceptor.to("SelectModifierPhase", false));
      const hostMarket = rig.hostScene.phaseManager.getCurrentPhase();
      expect(hostMarket, "host reached the actual queued BiomeShopPhase").toBeInstanceOf(BiomeShopPhase);
      (hostMarket as unknown as { buildStock(): void }).buildStock = function (this: {
        shopOptions: unknown[];
        qtys: number[];
      }) {
        this.shopOptions = [makeTmOption()];
        this.qtys = [1];
      };
      const hostMarketSeam = hostMarket as unknown as BiomeShopSeam;

      const guestMarket = await withClient(rig.guestCtx, () =>
        driveClientPhaseQueueTo(rig.guestScene, "BiomeShopPhase", {
          matches: phase => phase instanceof BiomeShopPhase,
        }),
      );
      expect(guestMarket, "guest reached the actual queued BiomeShopPhase").toBeInstanceOf(BiomeShopPhase);

      // (2) The ordered V2 wave DATA installs before the market presentation exists.
      await awaitGuestWaveTransaction(rig, wave, false);

      // (3) Start the WATCHER FIRST so its awaitRewardOptions waiter is live before the owner streams stock,
      // then start the concrete owner. Both are the clients' REAL current-phase market instances.
      await withClient(rig.guestCtx, async () => {
        (guestMarket as unknown as { start(): void }).start();
        await drainLoopback();
      });
      await waitForMode(rig.guestCtx, UiMode.MESSAGE, "guest market watcher message");

      // Tap the OWNER phase manager: the TM buy queues a PINNED BiomeShopPhase continuation (carries
      // coopBiomeStart), never the unpinned plain-SelectModifierPhase orphan.
      const pm = rig.hostScene.phaseManager as unknown as { unshiftPhase(p: unknown): void };
      const origUnshift = pm.unshiftPhase.bind(pm);
      pm.unshiftPhase = (p: unknown): void => {
        const pp = p as { coopBiomeStart?: number };
        if (pp != null && Object.hasOwn(pp, "coopBiomeStart")) {
          queuedContinuation.push({ hasBiomeStart: true, biomeStart: pp.coopBiomeStart ?? -999 });
        }
        origUnshift(p);
      };
      try {
        await withClient(rig.hostCtx, async () => {
          hostMarketSeam.start();
          await drainLoopback();
        });
        await pumpDuoDestinations(rig, 4);

        // (4) OWNER buys the TM through the REAL public BIOME_SHOP UI. The nested party sub-pick reuses the
        // proven reward plumbing; auto-answer the ONE PARTY open the way the green reward owner driver does
        // (setModeWithoutClear, NOT the forbidden setModeBoundedWhen).
        await waitForMode(rig.hostCtx, UiMode.BIOME_SHOP, "host biome market");
        await withClient(rig.hostCtx, async () => {
          const ui = globalScene.ui as unknown as { setModeWithoutClear: (...args: unknown[]) => unknown };
          const realSetModeWithoutClear = ui.setModeWithoutClear.bind(ui);
          ui.setModeWithoutClear = (...args: unknown[]): unknown => {
            if (args[0] === UiMode.PARTY) {
              ui.setModeWithoutClear = realSetModeWithoutClear; // one-shot: restore before picking
              (args[3] as (slotIndex: number, option: number) => void)(0, 0);
              return;
            }
            return realSetModeWithoutClear(...args);
          };
          try {
            expect(
              rig.hostScene.ui.processInput(Button.ACTION),
              "owner buys the TM through the public BIOME_SHOP handler",
            ).toBe(true);
            for (let i = 0; i < 12; i++) {
              await drainLoopback();
            }
          } finally {
            ui.setModeWithoutClear = realSetModeWithoutClear;
          }
        });

        // The TM buy queued its pinned continuation copy and sent the SHOP_BUY INTERACTION_COMMIT whose
        // immediate delivery was DROPPED at the V2 envelope send seam (the guest never received it).
        expect(queuedContinuation.length, "the TM buy queued a BiomeShopPhase continuation (carries a biome pin)").toBe(
          1,
        );
        expect(queuedContinuation[0].biomeStart, "the continuation inherited the market pin (counter 0)").toBe(
          counterBefore,
        );
        expect(pair.faultsInjected(), "the REAL SHOP_BUY INTERACTION_COMMIT must actually be dropped").toBeGreaterThan(
          0,
        );
        expect(buyCommitSends, "only the immediate delivery has been sent so far (dropped)").toBe(1);

        // (5) Only the host's active-time redelivery backoff can recover the dropped commit - advance active
        // time to fire the lease tick, then let the microtasks deliver the re-crossed entry to the guest.
        await withClient(rig.hostCtx, async () => {
          advanceCoopActiveTime(300);
          await drainLoopback();
        });
        expect(
          buyCommitSends,
          "the host's scheduler-owned redelivery re-sent the SHOP_BUY INTERACTION_COMMIT",
        ).toBeGreaterThanOrEqual(2);
        await pumpDuoDestinations(rig, 8);

        // (6) OWNER leaves through the REAL public UI: CANCEL -> CONFIRM prompt -> ACTION (Yes).
        await waitForMode(rig.hostCtx, UiMode.BIOME_SHOP, "host biome market continuation grid");
        await pressUntilAccepted(rig, rig.hostCtx, Button.CANCEL, "biome market leave");
        await waitForMode(rig.hostCtx, UiMode.CONFIRM, "biome market leave confirmation");
        await pressUntilAccepted(rig, rig.hostCtx, Button.ACTION, "biome market confirm yes");
      } finally {
        pm.unshiftPhase = origUnshift;
      }
    } finally {
      Overrides.WAIVE_ROLL_FEE_OVERRIDE = waiveBefore;
    }

    // Pump both destinations through the retry/ACK transaction until BOTH local terminals cross exactly once.
    let advanced = false;
    for (let attempt = 0; attempt < 80; attempt++) {
      await pumpDuoDestinations(rig, 1);
      if (
        rig.hostRuntime.controller.interactionCounter() === counterBefore + 1
        && rig.guestRuntime.controller.interactionCounter() === counterBefore + 1
      ) {
        advanced = true;
        break;
      }
    }
    expect(
      advanced,
      `biome market did not advance both counters once (before=${counterBefore} `
        + `host=${rig.hostRuntime.controller.interactionCounter()} `
        + `guest=${rig.guestRuntime.controller.interactionCounter()})`,
    ).toBe(true);

    // Both engines advanced the alternating interaction exactly once - lockstep, no asymmetric drift.
    expect(rig.guestRuntime.controller.interactionCounter(), "watcher advanced the interaction once (lockstep)").toBe(
      counterBefore + 1,
    );
    expect(rig.hostRuntime.controller.interactionCounter(), "host still exactly one past the boundary").toBe(
      counterBefore + 1,
    );

    // The #837 "advance interaction SKIP unpinned" WARN (the sibling fingerprint) must NEVER fire - every
    // biome-market terminal, including the continuation copy's, advances from a real pin.
    const allLogs = [...logs.host, ...logs.guest];
    const unpinned = allLogs.filter(l => /advance interaction SKIP unpinned/i.test(l));
    logs.flush();
    expect(unpinned, `no unpinned advance may fire (got: ${unpinned.join(" | ")})`).toHaveLength(0);
  }, 240_000);
});
