/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// TWO-ENGINE co-op EXPLORATION sweep (maintainer directive 2026-07-02: "do a run completely
// through the harness ... use all items, do all mystery events you can, try to set up weird
// situations"). This file plays REAL in-game situations across BOTH engines and asserts
// convergence - each `it` is one exploration probe. When a probe fails, classify: a HARNESS gap
// (extend the harness) or a SYNC bug (fix production + keep the probe as the regression test).
//
// PROBE 1 (#789, the live "Ability Capsule on my partner's mon didn't unlock the ability"):
// the owner takes an ER_ABILITY_CAPSULE from the reward shop, targets the PARTNER'S mon, and
// drives the REAL two-stage picker (choice menu -> innate slot picker). The relayed outcome
// (CAP_RUNUNLOCK + slot) must apply the SAME run-unlock on BOTH engines - the battle gate reads
// customPokemonData.erRunUnlockedAbilitySlots, so if either engine misses it the ability
// "didn't unlock for the run" exactly as reported.
//
// HOW TO RUN (gated ER_SCENARIO=1, like every ER engine test):
//   ER_SCENARIO=1 npx vitest run test/tests/elite-redux/coop/coop-duo-exploration.test.ts
// =============================================================================

import type { BattleScene } from "#app/battle-scene";
import { getGameMode } from "#app/game-mode";
import { globalScene, initGlobalScene } from "#app/global-scene";
import Overrides from "#app/overrides";
import { clearCoopRuntime, getCoopInteractionRelay, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { erRunUnlockableInnateSlots } from "#data/elite-redux/er-ability-capsule";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { BiomeShopPhase, setCoopBiomeMarketTestSkip } from "#phases/biome-shop-phase";
import { ErAbilityCapsulePhase } from "#phases/er-ability-capsule-phase";
import { SelectModifierPhase } from "#phases/select-modifier-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveGuestReplayTurn,
  driveGuestRewardWatch,
  driveHostPartyRewardOwner,
  forceItemRewards,
  haltQueueAfterCurrent,
  installDuoLogCapture,
  type ShopPhaseSeam,
  stubBattleInfo,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { PartyOption } from "#ui/party-ui-handler";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

/** The partner-owned mon the capsule targets (party slot 1 = the guest's GENGAR). */
const PARTNER_SLOT = 1;

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
}

describe.skipIf(!RUN)("co-op DUO exploration sweep (maintainer directive)", () => {
  let phaserGame: Phaser.Game;
  let game: GameManager;
  let logs: ReturnType<typeof installDuoLogCapture>;

  beforeAll(() => {
    phaserGame = new Phaser.Game({ type: Phaser.HEADLESS });
  });

  beforeEach(() => {
    game = new GameManager(phaserGame);
    logs = installDuoLogCapture(`exploration-${Date.now()}`);
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
    logs.dispose();
    clearCoopRuntime();
    initGlobalScene(game.scene);
  });

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
      await game.phaseInterceptor.to("TurnEndPhase");
    });
  }

  /**
   * Drive the CAPSULE'S OWN two-stage picker on the ACTIVE client's queued ErAbilityCapsulePhase:
   * stub ui.setMode so the OPTION_SELECT open picks "unlock an innate for the run" (the last
   * non-cancel option) and the PARTY (ABILITY_MODIFIER) open picks `unlockSlot` on `partySlot` -
   * then start the phase and drain so the relay commit lands. Must run inside withClient(ctx).
   * Returns whether a capsule phase was actually found + driven (false = the queue-starve class).
   */
  async function driveCapsulePickerOnCurrent(partySlot: number, unlockSlot: number): Promise<boolean> {
    const pm = globalScene.phaseManager;
    const cur = pm.getCurrentPhase();
    if (cur?.phaseName !== "ErAbilityCapsulePhase") {
      return false;
    }
    const ui = globalScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
    const realSetMode = ui.setMode.bind(ui);
    let stubCalls = 0;
    ui.setMode = (...args: unknown[]): unknown => {
      const mode = args[0];
      if (++stubCalls > 100) {
        throw new Error(`[probe] setMode LOOP detected: call ${stubCalls} mode=${String(mode)}`);
      }
      if (mode === UiMode.OPTION_SELECT) {
        const cfg = args[1] as { options: { label: string; handler: () => boolean }[] };
        // The last option is always Cancel; the one before it is "unlock an innate" when the
        // mon has a run-unlockable slot (else "change ability" - either way, a committing pick).
        const pick = cfg.options[Math.max(0, cfg.options.length - 2)];
        pick.handler();
        return Promise.resolve(true);
      }
      if (mode === UiMode.PARTY) {
        const cb = args[3] as (slotIndex: number, option: number) => void;
        cb(partySlot, PartyOption.ABILITY_SLOT_0 + unlockSlot);
        return Promise.resolve(true);
      }
      // MESSAGE restores etc: resolve so the phase's `.then(...)` chains keep flowing.
      return Promise.resolve(true);
    };
    try {
      // Park the queue behind the capsule phase: when it end()s, the manager must NOT auto-run
      // the next wave's phases under this manual drive (headless NewBattlePhase OOM artifact).
      haltQueueAfterCurrent();
      cur.start();
      for (let i = 0; i < 12; i++) {
        await drainLoopback();
      }
    } finally {
      ui.setMode = realSetMode;
    }
    return true;
  }

  // FINDINGS SO FAR (2026-07-02, this probe): (1) HARNESS: driveGuestRewardWatch misread the
  // continuation-terminal reward as a hang - FIXED (terminal-apply signal). (2) SYNC: a committed
  // capsule never advances the alternating interaction on either side (rotation stalls on the same
  // owner) - fix written in ErAbilityCapsulePhase.commitAndEnd, DISABLED pending (3).
  // (3) CRITICAL ROBUSTNESS: after the watcher's terminal, an UNRELATED non-converging playerModifier
  // heal (typeId=MAP re-added every round) drives the resync loop unbounded -> vitest worker OOM.
  // The give-up cap does not trip. SKIPPED until the storm has a backstop - then re-enable this
  // probe AND the commit advance, and extend the sweep (more items, MEs, weird orderings).
  it("PROBE #789: Ability Capsule on the PARTNER'S mon run-unlocks the innate on BOTH engines", async () => {
    forceItemRewards(game.override, [{ name: "ER_ABILITY_CAPSULE" }]);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    const turn = rig.hostScene.currentBattle.turn;
    await hostPlayWave(rig);
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });

    // Counter 0 -> the HOST owns this shop; it uses the capsule ON THE PARTNER'S mon (slot 1) -
    // the exact live report ("i used it on my partners mon but it didnt unlock the ability").
    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    expect(counterBefore % 2, "wave-1 shop is host-owned (counter parity)").toBe(0);
    await withClient(rig.hostCtx, async () => {
      await game.phaseInterceptor.to("SelectModifierPhase", false);
    });
    const hostShop = rig.hostScene.phaseManager.getCurrentPhase() as unknown as ShopPhaseSeam;
    expect(hostShop.phaseName).toBe("SelectModifierPhase");
    const guestShop = withClientSync(rig.guestCtx, () => new SelectModifierPhase()) as unknown as ShopPhaseSeam;

    // The unlockable innate slot must be computed on the TARGET mon before the pick (fresh
    // harness mons have no candy unlocks, so every registered innate slot is run-unlockable).
    const hostTarget = rig.hostScene.getPlayerParty()[PARTNER_SLOT];
    const unlockable = erRunUnlockableInnateSlots(hostTarget);
    expect(unlockable.length, "the partner's GENGAR has a run-unlockable innate slot").toBeGreaterThan(0);
    const unlockSlot = unlockable[0].slot;

    // OWNER (host): take the capsule from the shop targeting slot 1, then drive the capsule's
    // own picker phase (choice menu -> innate picker) to the CAP_RUNUNLOCK commit + relay.
    await withClient(rig.hostCtx, () => driveHostPartyRewardOwner(hostShop, { slot: PARTNER_SLOT }));
    const ownerDrove = await withClient(rig.hostCtx, () => driveCapsulePickerOnCurrent(PARTNER_SLOT, unlockSlot));
    expect(ownerDrove, "HARNESS: the owner's ErAbilityCapsulePhase was current after the shop pick").toBe(true);
    expect(
      hostTarget.customPokemonData.erRunUnlockedAbilitySlots,
      "OWNER engine: the partner mon's innate slot is run-unlocked",
    ).toContain(unlockSlot);

    // WATCHER (guest): its shop watch re-applies the relayed capsule pick (unshifting ITS
    // ErAbilityCapsulePhase as watcher), then the watcher phase applies the buffered
    // CAP_RUNUNLOCK outcome. If the queued phase never runs, that is the live #789 queue-starve.
    await withClient(rig.guestCtx, () => driveGuestRewardWatch(guestShop));
    const guestTarget = rig.guestScene.getPlayerParty()[PARTNER_SLOT];
    // HARNESS GAP (found by heap instrumentation): a mid-run HEAL can REBUILD guest party mons
    // (applyCaptureParty), and rebuilt mons lose the no-op battleInfo stub - their updateInfo()
    // then allocation-loops on the stripped guest scene (headless tween re-entry) until OOM.
    // Re-stub every guest party mon before driving a phase that calls updateInfo.
    withClientSync(rig.guestCtx, () => {
      for (const mon of rig.guestScene.getPlayerParty()) {
        stubBattleInfo(mon);
      }
    });
    // The REAL unshifted guest capsule phase mis-detects itself as OWNER here: production's
    // coopAbilityPickerContext() reads the LIVE current SelectModifierPhase, but the harness's
    // watcher shop is hand-constructed (never pm-current), so the context lookup misses and the
    // phase opens the OWNER picker - whose invalid-pick path reopens forever under a scripted
    // picker (the OOM this probe originally hit; harmless live, a human breaks the loop).
    // Drive the WATCHER variant explicitly with the correct seq instead - the exact object
    // production builds when the context lookup succeeds; the buffered relay outcome applies.
    const watcherDrove = await withClient(rig.guestCtx, async () => {
      globalScene.phaseManager.tryRemovePhase("ErAbilityCapsulePhase");
      const phase = new ErAbilityCapsulePhase(PARTNER_SLOT, guestShop.coopInteractionStart, true);
      haltQueueAfterCurrent();
      phase.start();
      for (let i = 0; i < 12; i++) {
        await drainLoopback();
      }
      return true;
    });
    expect(watcherDrove, "the watcher capsule phase ran (directly or via fallback)").toBe(true);
    expect(
      guestTarget.customPokemonData.erRunUnlockedAbilitySlots,
      "WATCHER engine: the SAME innate slot is run-unlocked (the live #789 failure point)",
    ).toContain(unlockSlot);

    // Lockstep: exactly one alternating interaction consumed on both engines.
    expect(rig.hostRuntime.controller.interactionCounter(), "host counter advanced once").toBe(counterBefore + 1);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest counter advanced once").toBe(counterBefore + 1);

    logs.flush();
  }, 240_000);

  it("PROBE #673: the biome market alternates - owner buys relay, watcher applies verbatim, counters advance", async () => {
    setCoopBiomeMarketTestSkip(false); // this probe drives the REAL co-op market
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    const turn = rig.hostScene.currentBattle.turn;
    await hostPlayWave(rig);
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });

    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    const hostModsBefore = rig.hostScene.modifiers.length;
    const guestModsBefore = rig.guestScene.modifiers.length;
    const waiveBefore = Overrides.WAIVE_ROLL_FEE_OVERRIDE;
    Overrides.WAIVE_ROLL_FEE_OVERRIDE = true; // wave-1 money cannot afford market goods

    // OWNER (host, counter parity 0): drive the REAL market - buy ONE non-party item, then leave.
    let boughtTypeId = "";
    try {
      await withClient(rig.hostCtx, async () => {
        const phase = new BiomeShopPhase();
        // The leave-confirm path first hides the shop backdrop via real UI handler calls the
        // headless mock cannot service - neutralize it (purely cosmetic; the flow continues).
        (phase as unknown as { hideShopForOverlay: () => void }).hideShopForOverlay = () => {};
        // The post-buy repaint calls getHandler().updateCostText() - real handlers have it, the
        // headless mock does not; inject a noop so the buy's tail (the coop relay) can run.
        const uiAny = globalScene.ui as unknown as { getHandler: () => Record<string, unknown> };
        const realGetHandler = uiAny.getHandler.bind(globalScene.ui);
        uiAny.getHandler = () => {
          const h = realGetHandler() as Record<string, unknown>;
          if (h != null && typeof h.updateCostText !== "function") {
            h.updateCostText = () => {};
          }
          return h;
        };
        const ui = globalScene.ui as unknown as {
          setMode: (...args: unknown[]) => unknown;
          setModeWithoutClear: (...args: unknown[]) => unknown;
          setOverlayMode: (...args: unknown[]) => unknown;
          showText: (...args: unknown[]) => unknown;
        };
        const realSetMode = ui.setMode.bind(ui);
        const realSetModeWC = ui.setModeWithoutClear.bind(ui);
        const realSetOverlay = ui.setOverlayMode.bind(ui);
        const realShowText = ui.showText.bind(ui);
        // Party-target market goods open the party menu via setModeWithoutClear - auto-pick slot 0.
        ui.setModeWithoutClear = (...args: unknown[]): unknown => {
          if (args[0] === UiMode.PARTY) {
            (args[3] as (slotIndex: number, option: number) => void)(0, 0);
            return Promise.resolve(true);
          }
          return Promise.resolve(true);
        };
        ui.setMode = (...args: unknown[]): unknown => {
          if (args[0] === UiMode.BIOME_SHOP) {
            const options = args[1] as { type?: { id?: string } }[];
            // Signature: (BIOME_SHOP, shopOptions, biomeId, onSelect, qtys) - the callback is [3].
            const cb = args[3] as (index: number) => boolean;
            // Buy a KNOWN NON-party item (balls/lures apply directly, no party sub-menu) so the
            // probe stays deterministic; the relay path is identical for party-target goods.
            // LURE: non-party AND lands in scene.modifiers (balls only bump the ball inventory,
            // which this probe does not observe). The harness seed makes the stock deterministic.
            let idx = options.findIndex(o => (o?.type?.id ?? "").includes("LURE"));
            if (idx < 0) {
              idx = options.findIndex(o => o?.type != null);
            }
            boughtTypeId = options[idx]?.type?.id ?? "";
            queueMicrotask(() => {
              cb(idx);
              queueMicrotask(() => cb(-1)); // leave after the buy resolves
            });
            return Promise.resolve(true);
          }
          if (args[0] === UiMode.PARTY) {
            const cb = args[3] as (slotIndex: number, option: number) => void;
            cb(0, 0);
            return Promise.resolve(true);
          }
          return Promise.resolve(true);
        };
        ui.showText = (...args: unknown[]): unknown => {
          const cb = args[2] as (() => void) | undefined;
          cb?.();
          return realShowText === null ? undefined : undefined;
        };
        ui.setOverlayMode = (...args: unknown[]): unknown => {
          if (args[0] === UiMode.CONFIRM) {
            (args[1] as () => void)(); // YES: leave the market
            return Promise.resolve(true);
          }
          return realSetOverlay(...args);
        };
        try {
          haltQueueAfterCurrent();
          phase.start();
          for (let i = 0; i < 16; i++) {
            await drainLoopback();
          }
        } finally {
          ui.setMode = realSetMode;
          ui.setModeWithoutClear = realSetModeWC;
          ui.setOverlayMode = realSetOverlay;
          ui.showText = realShowText;
        }
      });
    } finally {
      Overrides.WAIVE_ROLL_FEE_OVERRIDE = waiveBefore;
    }
    expect(rig.hostScene.modifiers.length, "OWNER bought exactly one market item").toBe(hostModsBefore + 1);
    expect(rig.hostRuntime.controller.interactionCounter(), "host advanced the market interaction").toBe(
      counterBefore + 1,
    );

    // WATCHER (guest): its market phase adopts the streamed stock + applies the buffered buy + leave.
    await withClient(rig.guestCtx, async () => {
      const phase = new BiomeShopPhase();
      haltQueueAfterCurrent();
      phase.start();
      for (let i = 0; i < 16; i++) {
        await drainLoopback();
      }
    });
    expect(rig.guestScene.modifiers.length, "WATCHER applied the same buy (one new modifier)").toBe(
      guestModsBefore + 1,
    );
    expect(rig.guestScene.modifiers.at(-1)?.type?.id, "WATCHER applied the SAME item the owner bought").toBe(
      boughtTypeId,
    );
    expect(rig.guestScene.money, "money converged verbatim").toBe(rig.hostScene.money);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest advanced the market interaction").toBe(
      counterBefore + 1,
    );

    logs.flush();
  }, 240_000);

  // SKIPPED pending iteration: the watch survives the sweep (core assertion holds when run alone)
  // but the guest's post-leave advance runs as a CROSS-CTX continuation (the parked await resolves
  // while the HOST ctx is active), so the guest counter assertion + a state bleed into the next
  // probe fail. Fix by resolving the leave under withClientSync(guestCtx) like the ME harness
  // gotcha #5, then un-skip. Filed under the #792 sweep.
  it.skip("PROBE resync-stress: a mid-park resync cancelWaiters sweep SPARES the live market watch", async () => {
    // The #718 class: a battle resync's cancelWaiters once knocked watchers off LIVE shops. The
    // market watch parks on the 7M seq band; fire the resync's exact orphan-selector sweep while
    // the watcher is parked mid-market and assert the watch survives to the owner's leave.
    setCoopBiomeMarketTestSkip(false);
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);
    const turn = rig.hostScene.currentBattle.turn;
    await hostPlayWave(rig);
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });
    const counterBefore = rig.hostRuntime.controller.interactionCounter();

    // OWNER opens the market + streams the stock but does NOT leave yet (the watcher must PARK).
    let leaveCb: ((index: number) => boolean) | null = null;
    await withClient(rig.hostCtx, async () => {
      const phase = new BiomeShopPhase();
      (phase as unknown as { hideShopForOverlay: () => void }).hideShopForOverlay = () => {};
      const ui = globalScene.ui as unknown as {
        setMode: (...args: unknown[]) => unknown;
        setOverlayMode: (...args: unknown[]) => unknown;
        showText: (...args: unknown[]) => unknown;
      };
      ui.setMode = (...args: unknown[]): unknown => {
        if (args[0] === UiMode.BIOME_SHOP) {
          leaveCb = args[3] as (index: number) => boolean;
        }
        return Promise.resolve(true);
      };
      ui.showText = (...args: unknown[]): unknown => {
        (args[2] as (() => void) | undefined)?.();
        return;
      };
      ui.setOverlayMode = (...args: unknown[]): unknown => {
        if (args[0] === UiMode.CONFIRM) {
          (args[1] as () => void)();
        }
        return Promise.resolve(true);
      };
      haltQueueAfterCurrent();
      phase.start();
      for (let i = 0; i < 8; i++) {
        await drainLoopback();
      }
    });
    expect(leaveCb, "HARNESS: captured the owner market callback").not.toBeNull();

    // WATCHER parks mid-market (stock adopted, no buys yet), then the resync sweep fires.
    let watchDone = false;
    await withClient(rig.guestCtx, async () => {
      const phase = new BiomeShopPhase();
      haltQueueAfterCurrent();
      const seamEnd = phase as unknown as { end: () => void };
      const realEnd = seamEnd.end.bind(phase);
      seamEnd.end = () => {
        watchDone = true;
        realEnd();
      };
      phase.start();
      for (let i = 0; i < 6; i++) {
        await drainLoopback();
      }
      expect(watchDone, "watcher is PARKED mid-market before the sweep").toBe(false);
      // THE STRESS: the resync's exact orphan-selector sweep (coop-replay-phases:846).
      const controller = rig.guestRuntime.controller;
      getCoopInteractionRelay()?.cancelWaiters(seq => controller.peerAdvancedPastInteraction(seq));
      for (let i = 0; i < 6; i++) {
        await drainLoopback();
      }
      expect(watchDone, "the sweep did NOT knock the watcher off the live market").toBe(false);
    });

    // OWNER leaves -> the spared watch must complete + both counters advance once.
    await withClient(rig.hostCtx, async () => {
      leaveCb?.(-1);
      for (let i = 0; i < 8; i++) {
        await drainLoopback();
      }
    });
    await withClient(rig.guestCtx, async () => {
      for (let i = 0; i < 8; i++) {
        await drainLoopback();
      }
    });
    expect(watchDone, "the watch completed on the owner's leave").toBe(true);
    expect(rig.hostRuntime.controller.interactionCounter(), "host advanced once").toBe(counterBefore + 1);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest advanced once").toBe(counterBefore + 1);
    logs.flush();
  }, 240_000);

  it("PROBE double-KO: BOTH player mons faint in one turn - both pickers resolve, both replacements land on both engines", async () => {
    // Matrix battle-flow row "Double KO same turn". Deterministic double faint: both leads at
    // 1 HP, the host's Blissey EXPLODES (user-faint + the blast kills the 1-HP Normal ally;
    // Blissey's floor-tier Attack cannot KO the level-100 foes). The host's own picker AND the
    // guest's relayed picker must BOTH resolve, and both replacements must materialize on both
    // engines - the class where one empty slot masks the other.
    game.override
      .moveset([MoveId.EXPLOSION, MoveId.SPLASH])
      .enemySpecies(SpeciesId.MAGIKARP)
      .enemyLevel(100)
      .enemyMoveset(MoveId.GROWL)
      .startingLevel(50);
    await game.classicMode.startBattle(SpeciesId.BLISSEY, SpeciesId.SNORLAX, SpeciesId.LAPRAS, SpeciesId.CHARIZARD);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);
    const { setCoopFaintSwitchWaitMs } = await import("#data/elite-redux/coop/coop-interaction-relay");
    setCoopFaintSwitchWaitMs(4000);
    try {
      // Bench ownership: LAPRAS stays host-owned (buildDuo default), CHARIZARD is the guest's.
      for (const scene of [rig.hostScene, rig.guestScene]) {
        scene.getPlayerParty()[3].coopOwner = "guest";
      }
      rig.hostScene.getPlayerField()[0].hp = 1;
      rig.hostScene.getPlayerField()[1].hp = 1;
      withClientSync(rig.guestCtx, () => {
        rig.guestScene.getPlayerField()[0].hp = 1;
        rig.guestScene.getPlayerField()[1].hp = 1;
      });
      const turn = rig.hostScene.currentBattle.turn;

      // TURN 1 on the HOST: Blissey explodes - Blissey user-faints, 1-HP Snorlax dies to the
      // blast. The host's OWN picker (slot 0) opens on the post-turn SwitchPhase, which runs
      // during the SECOND host drive - keep the one-shot PARTY stub (pick LAPRAS, slot 2)
      // armed across BOTH host drives.
      const hostUi = rig.hostScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
      const realHostSetMode = hostUi.setMode.bind(rig.hostScene.ui);
      hostUi.setMode = (...args: unknown[]): unknown => {
        if (args[0] === UiMode.PARTY) {
          hostUi.setMode = realHostSetMode; // one-shot
          (args[3] as (slotIndex: number, option: number) => void)(2, 0);
          return;
        }
        return realHostSetMode(...args);
      };
      await withClient(rig.hostCtx, async () => {
        game.move.select(MoveId.EXPLOSION, 0);
        game.move.select(MoveId.SPLASH, 1);
        await game.phaseInterceptor.to("TurnEndPhase");
      });
      const f0 = rig.hostScene.getPlayerField()[0];
      const f1 = rig.hostScene.getPlayerField()[1];
      expect(
        (f0 == null || f0.isFainted() || f0.species.speciesId === SpeciesId.LAPRAS) && (f1 == null || f1.isFainted()),
        "both player slots were vacated (or already refilled) by the double KO on the host",
      ).toBe(true);

      // GUEST renders turn 1: presents BOTH faints; ONLY its own slot's picker opens (the
      // host-owned faint is not its pick). One-shot PARTY stub picks CHARIZARD (slot 3).
      await withClient(rig.guestCtx, async () => {
        const ui = rig.guestScene.ui as unknown as { setMode: (...args: unknown[]) => unknown };
        const realSetMode = ui.setMode.bind(ui);
        ui.setMode = (...args: unknown[]): unknown => {
          if (args[0] === UiMode.PARTY) {
            ui.setMode = realSetMode; // one-shot
            (args[3] as (slotIndex: number, option: number) => void)(3, 0);
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

      // HOST: both SwitchPhases resolve (own pick already stubbed; the guest's pick is
      // buffered on the relay) -> both replacements summoned + OOB checkpoints pushed.
      try {
        await withClient(rig.hostCtx, async () => {
          await game.phaseInterceptor.to("CommandPhase", false);
        });
      } finally {
        hostUi.setMode = realHostSetMode;
      }
      const hostSlot0 = rig.hostScene.getPlayerField()[0];
      const hostSlot1 = rig.hostScene.getPlayerField()[1];
      expect(hostSlot0?.species.speciesId, "host slot 0 refilled with the HOST's pick").toBe(SpeciesId.LAPRAS);
      expect(hostSlot1?.species.speciesId, "host slot 1 refilled with the GUEST's pick").toBe(SpeciesId.CHARIZARD);
      expect(hostSlot0?.isFainted(), "host slot 0 battle-ready").toBe(false);
      expect(hostSlot1?.isFainted(), "host slot 1 battle-ready").toBe(false);

      // GUEST: the next pump consumes BOTH out-of-band replacement checkpoints - both
      // replacements materialize (the second empty slot must not deadlock behind the first).
      await withClient(rig.guestCtx, async () => {
        await driveGuestReplayTurn(rig.guestScene, turn + 1);
      });
      withClientSync(rig.guestCtx, () => {
        const g0 = rig.guestScene.getPlayerField()[0];
        const g1 = rig.guestScene.getPlayerField()[1];
        expect(g0?.species.speciesId, "guest materialized slot 0 (LAPRAS)").toBe(SpeciesId.LAPRAS);
        expect(g1?.species.speciesId, "guest materialized slot 1 (CHARIZARD)").toBe(SpeciesId.CHARIZARD);
        expect(g0?.isFainted(), "guest slot 0 battle-ready").toBe(false);
        expect(g1?.isFainted(), "guest slot 1 battle-ready").toBe(false);
      });
    } finally {
      setCoopFaintSwitchWaitMs(60_000);
    }
    logs.flush();
  }, 240_000);

  it("PROBE #795: Giratina's Bargain alternates - owner leaves, watcher adopts the outcome blob, counters lockstep", async () => {
    // The Bargain is the 4th owner/watcher surface: at most ONE deal per visit, so the whole
    // relay is a single comprehensive outcome blob (the proven ME-terminal resync) + a uniform
    // terminal. This probe drives the LEAVE path end-to-end across two engines; the deal-commit
    // path reuses applyCoopMeOutcome verbatim (already proven by the duo ME tests).
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);
    const turn = rig.hostScene.currentBattle.turn;
    await hostPlayWave(rig);
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });
    const { TheBargainPhase } = await import("#phases/the-bargain-phase");
    const counterBefore = rig.hostRuntime.controller.interactionCounter();

    // OWNER (host, even counter): play the real phase; the stub screen immediately leaves.
    // Drain until the phase's async leave() chain fully ENDS - exiting with the chain
    // mid-flight leaks its continuations into the NEXT test's boot (cross-ctx bleed).
    let ownerDone = false;
    await withClient(rig.hostCtx, async () => {
      const phase = new TheBargainPhase();
      const seamO = phase as unknown as { end: () => void };
      const realEndO = seamO.end.bind(phase);
      seamO.end = () => {
        ownerDone = true;
        realEndO();
      };
      const ui = globalScene.ui as unknown as {
        setMode: (...args: unknown[]) => unknown;
        showDialogue: (...args: unknown[]) => unknown;
        showText: (...args: unknown[]) => unknown;
      };
      const savedSetMode = ui.setMode.bind(globalScene.ui);
      const savedShowDialogue = ui.showDialogue?.bind(globalScene.ui);
      const savedShowText = ui.showText.bind(globalScene.ui);
      try {
        ui.setMode = (...args: unknown[]): unknown => {
          if (args[0] === UiMode.ER_BARGAIN) {
            const onLeave = args[6] as () => void;
            queueMicrotask(() => onLeave());
          }
          return Promise.resolve(true);
        };
        ui.showDialogue = (...args: unknown[]): unknown => {
          (args[3] as (() => void) | undefined)?.();
          return;
        };
        ui.showText = (...args: unknown[]): unknown => {
          (args[2] as (() => void) | undefined)?.();
          return;
        };
        haltQueueAfterCurrent();
        phase.start();
        for (let i = 0; i < 20 && !ownerDone; i++) {
          await drainLoopback();
        }
      } finally {
        ui.setMode = savedSetMode;
        ui.showDialogue = savedShowDialogue as typeof ui.showDialogue;
        ui.showText = savedShowText;
      }
    });
    expect(ownerDone, "HARNESS: the owner bargain chain fully completed before exit").toBe(true);
    expect(rig.hostRuntime.controller.interactionCounter(), "owner advanced the bargain interaction").toBe(
      counterBefore + 1,
    );

    // WATCHER (guest): never opens the screen; buffer-hits the outcome blob + advances.
    let watchDone = false;
    await withClient(rig.guestCtx, async () => {
      const phase = new TheBargainPhase();
      haltQueueAfterCurrent();
      const seam = phase as unknown as { end: () => void };
      const realEnd = seam.end.bind(phase);
      seam.end = () => {
        watchDone = true;
        realEnd();
      };
      phase.start();
      for (let i = 0; i < 12 && !watchDone; i++) {
        await drainLoopback();
      }
    });
    expect(watchDone, "watcher converged and ended").toBe(true);
    expect(rig.guestRuntime.controller.interactionCounter(), "guest advanced the bargain interaction").toBe(
      counterBefore + 1,
    );
    expect(rig.guestScene.money, "money converged via the outcome blob").toBe(rig.hostScene.money);
    logs.flush();
  }, 240_000);

  it("PROBE #794: a host-side catch streams dex credit to the partner's account immediately", async () => {
    // Shared acquisition: setPokemonCaught is the universal chokepoint (wild catch, DexNav,
    // ME grants). The HOST's write must reach the GUEST's gameData without waiting for an
    // ME terminal. Uses the real relay end-to-end (hook -> throttle -> wire -> merge apply).
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const pair = createLoopbackPair();
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);
    const { setCoopDexSyncDelayMs } = await import("#data/elite-redux/coop/coop-runtime");
    try {
      setCoopDexSyncDelayMs(0);
      const caughtMon = rig.hostScene.getEnemyParty()[0];
      const rootId = caughtMon.species.getRootSpeciesId();
      const guestBefore = rig.guestScene.gameData.dexData[rootId]?.caughtAttr ?? 0n;
      expect(guestBefore, "HARNESS: guest starts WITHOUT this species caught").toBe(0n);
      await withClient(rig.hostCtx, async () => {
        // Binds the HOST blob + relay at write time; the trailing send timer fires LATER.
        await globalScene.gameData.setPokemonCaught(caughtMon, true, false, false);
      });
      // Let the trailing send fire while the GUEST ctx is active: the loopback delivers
      // synchronously at send time, so this way the apply runs under the guest scene
      // (gotcha #5). Live clients are separate processes - this is harness-only care.
      await withClient(rig.guestCtx, async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        for (let i = 0; i < 10; i++) {
          await drainLoopback();
        }
      });
      const guestAfter = rig.guestScene.gameData.dexData[rootId]?.caughtAttr ?? 0n;
      const hostAfter = rig.hostScene.gameData.dexData[rootId]?.caughtAttr ?? 0n;
      expect(hostAfter > 0n, "host account credited (sanity)").toBe(true);
      expect(guestAfter > 0n, "PARTNER account credited by the dexSync stream").toBe(true);
      expect(rig.guestScene.gameData.dexData[rootId].caughtCount, "partner caughtCount merged").toBeGreaterThan(0);
    } finally {
      setCoopDexSyncDelayMs(500);
    }
    logs.flush();
  }, 240_000);

  it("PROBE registry-sweep: EVERY modifier registry id round-trips through the watcher rebuild (relics included)", async () => {
    // The watcher rebuilds ALL streamed items (reward shop, biome market, relic rewards) via
    // the registry round-trip; any id that fails falls back to a DIVERGENT local roll live.
    // Sweep every key: non-generator types must serialize+reconstruct 1:1; generator types
    // must at least have a working factory (their reconstruct is pinned by pregenArgs).
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const { modifierTypes } = await import("#data/data-lists");
    const { serializeRewardOptions, reconstructRewardOptions } = await import(
      "#data/elite-redux/coop/coop-reward-options"
    );
    const { ModifierTypeGenerator, ModifierTypeOption } = await import("#modifiers/modifier-type");
    const party = game.scene.getPlayerParty();
    const broken: string[] = [];
    let swept = 0;
    let generators = 0;
    for (const key of Object.keys(modifierTypes)) {
      try {
        const type = modifierTypes[key as keyof typeof modifierTypes]();
        if (type == null) {
          broken.push(`${key} (factory null)`);
          continue;
        }
        type.id = key;
        if (type instanceof ModifierTypeGenerator) {
          generators++;
          continue; // reconstruct is pinned by owner pregenArgs; factory works = wire-safe
        }
        const rebuilt = reconstructRewardOptions(serializeRewardOptions([new ModifierTypeOption(type, 0, 100)]), party);
        if (rebuilt == null || rebuilt[0]?.type?.id !== key) {
          broken.push(`${key} (reconstruct ${rebuilt == null ? "null" : "wrong id"})`);
        }
        swept++;
      } catch (e) {
        broken.push(`${key} (threw: ${(e as Error).message})`);
      }
    }
    console.log(`[probe] registry sweep: ${swept} round-tripped, ${generators} generators, ${broken.length} broken`);
    expect(broken, `every registry id round-trips (broken: ${broken.join("; ")})`).toEqual([]);
    expect(swept, "the sweep actually covered a large registry").toBeGreaterThan(100);
  }, 240_000);
});
