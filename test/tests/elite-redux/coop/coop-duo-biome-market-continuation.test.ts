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
import { setCoopWaveBarrierMs } from "#data/elite-redux/coop/coop-interaction-relay";
import { resetCoopRendezvousWaitMs, setCoopRendezvousWaitMs } from "#data/elite-redux/coop/coop-rendezvous";
import { clearCoopRuntime, setCoopRuntime } from "#data/elite-redux/coop/coop-runtime";
import { COOP_GUEST_FIELD_INDEX, COOP_HOST_FIELD_INDEX } from "#data/elite-redux/coop/coop-session";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { generateModifierTypeOption } from "#data/mystery-encounters/utils/encounter-phase-utils";
import { BattlerIndex } from "#enums/battler-index";
import { Command } from "#enums/command";
import { GameModes } from "#enums/game-modes";
import { MoveId } from "#enums/move-id";
import { SpeciesId } from "#enums/species-id";
import { UiMode } from "#enums/ui-mode";
import { BiomeShopPhase, setCoopBiomeMarketTestSkip } from "#phases/biome-shop-phase";
import { GameManager } from "#test/framework/game-manager";
import {
  buildDuo,
  type DuoRig,
  drainLoopback,
  driveGuestReplayTurn,
  installDuoLogCapture,
  pumpDuoDestinations,
  withClient,
  withClientSync,
} from "#test/tools/coop-duo-harness";
import { wrapCoopFaultPair } from "#test/tools/coop-fault-transport";
import { createScheduledCoopPair } from "#test/tools/coop-scheduled-transport";
import Phaser from "phaser";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

const RUN = process.env.ER_SCENARIO === "1";

function toCoop(scene: BattleScene): void {
  scene.gameMode = getGameMode(GameModes.COOP);
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
  applyCoopRelayedPurchase(modifier: unknown, validatedCost: number, authoritativeMoney: number): void;
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
      await game.phaseInterceptor.to("TurnEndPhase");
    });
  }

  /** A single TM stock option (a CONTINUATION item, so a buy runs the queuesContinuation path). */
  function makeTmOption(): unknown {
    const opt = generateModifierTypeOption(modifierTypes.TM_GREAT, [MoveId.SWORDS_DANCE]);
    (opt as unknown as { cost: number }).cost = 100;
    return opt;
  }

  /** The live #moulas capture bought this non-continuation held item from a guest-owned market. */
  function makeWideLensOption(): ReturnType<typeof generateModifierTypeOption> {
    const opt = generateModifierTypeOption(modifierTypes.WIDE_LENS);
    (opt as unknown as { cost: number }).cost = 100;
    return opt;
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

  it("guest-owned market watcher applies Wide Lens as a paid replay without ending the market", async () => {
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const rig = await buildDuo(game, createLoopbackPair(), setCoopRuntime, toCoop);

    await withClient(rig.hostCtx, async () => {
      // Odd interaction => guest owns the market and the host is the watcher,
      // matching the tester capture. A peer counter broadcast is only advisory; each controller
      // crosses its own local terminal, so put both engines on the same pin explicitly.
      rig.hostRuntime.controller.advanceInteraction(0);
    });
    await withClient(rig.guestCtx, async () => {
      rig.guestRuntime.controller.advanceInteraction(0);
    });
    expect(rig.hostRuntime.controller.interactionCounter()).toBe(1);
    expect(rig.guestRuntime.controller.interactionCounter()).toBe(1);

    await withClient(rig.hostCtx, async () => {
      const phase = liveBiomeShop() as unknown as BiomeShopSeam;
      const option = makeWideLensOption();
      if (option == null) {
        throw new Error("Wide Lens must generate a concrete market option");
      }
      const target = rig.hostScene.getPlayerParty()[1];
      const modifier = option.type.newModifier(target);
      expect(modifier).not.toBeNull();
      phase.coopBiomeStart = 1;
      phase.coopBiomeOwner = false;
      phase.coopBiomeOptionOwner = true;
      phase.shopOptions = [option];
      phase.qtys = [1];
      phase.pendingIndex = 0;
      rig.hostScene.money = 2_000;

      phase.applyCoopRelayedPurchase(modifier!, 100, 1_020);

      expect(rig.hostRuntime.controller.interactionCounter(), "buy does not terminate the pinned market").toBe(1);
      expect(rig.hostScene.money, "watcher adopts the owner's exact post-buy money").toBe(1_020);
      expect(phase.qtys[0], "watcher decrements the bought stock once").toBe(0);
    });

    const allLogs = [...logs.host, ...logs.guest];
    expect(
      allLogs.filter(line => /advance interaction SKIP unpinned/i.test(line)),
      "a paid watcher replay never enters the free-reward terminal path",
    ).toHaveLength(0);
  }, 120_000);

  // ===========================================================================================
  // B. END-TO-END over BOTH engines: the OWNER buys a TM in the biome market + leaves; the WATCHER
  // adopts + applies + leaves. The queued continuation must be a PINNED BiomeShopPhase, NO "SKIP
  // unpinned" WARN may fire, and both engines must advance the interaction counter exactly once.
  // ===========================================================================================
  it("durability: dropped biomeShop relays still materialize TM buy + leave in ordinal order", async () => {
    setCoopBiomeMarketTestSkip(false); // drive the REAL co-op market
    await game.classicMode.startBattle(SpeciesId.SNORLAX, SpeciesId.GENGAR);
    const scheduledPair = createScheduledCoopPair({ automatic: true });
    const pair = wrapCoopFaultPair(
      scheduledPair,
      {
        drop: 1,
        reorder: 0,
        delay: 0,
        faultable: msg => msg.t === "interactionChoice" && msg.kind === "biomeShop",
      },
      { seed: 0xb10e5a },
    );
    const rig = await buildDuo(game, pair, setCoopRuntime, toCoop);
    wireGuestCommand(rig);

    const turn = rig.hostScene.currentBattle.turn;
    await hostPlayWave(rig);
    await withClient(rig.guestCtx, async () => {
      await driveGuestReplayTurn(rig.guestScene, turn);
    });
    scheduledPair.setAutomaticDelivery(false);

    const counterBefore = rig.hostRuntime.controller.interactionCounter();
    // Counter 0 => the HOST owns this interaction (the host buys + relays; the guest is the watcher).
    expect(counterBefore % 2, "counter 0: host is the market owner").toBe(0);

    const waiveBefore = Overrides.WAIVE_ROLL_FEE_OVERRIDE;
    Overrides.WAIVE_ROLL_FEE_OVERRIDE = true;
    rig.hostScene.money = 999999;

    // Track the continuation copy the owner's TM buy queues (its phaseName + carried biome pin).
    const queuedContinuation: { hasBiomeStart: boolean; biomeStart: number }[] = [];

    // Park the watcher's real market surface before the owner can buy or leave. P33 intentionally
    // retains the terminal until this reciprocal continuation exists; owner-first was the old harness
    // fiction that let one client cross the market while its partner had not opened it yet.
    await withClient(rig.guestCtx, async () => {
      const guestPhase = liveBiomeShop() as unknown as BiomeShopSeam;
      (guestPhase as unknown as { hideShopForOverlay: () => void }).hideShopForOverlay = () => {};
      const gui = globalScene.ui as unknown as { getHandler: () => Record<string, unknown> };
      const realGH = gui.getHandler.bind(globalScene.ui);
      gui.getHandler = () => {
        const h = realGH();
        if (h != null && typeof h.setStock !== "function") {
          h.setStock = () => {};
        }
        return h;
      };
      guestPhase.start();
      await drainLoopback();
      expect(guestPhase.coopBiomeStart, "the watcher opened the exact market interaction").toBe(counterBefore);
    });

    try {
      await withClient(rig.hostCtx, async () => {
        const phase = liveBiomeShop() as unknown as BiomeShopSeam;
        // Inject a TM as the sole stock item (a continuation item) so the buy runs queuesContinuation.
        (phase as unknown as { buildStock: () => void }).buildStock = function (this: {
          shopOptions: unknown[];
          qtys: number[];
        }) {
          this.shopOptions = [makeTmOption()];
          this.qtys = [1];
        };
        (phase as unknown as { hideShopForOverlay: () => void }).hideShopForOverlay = () => {};

        const pm = globalScene.phaseManager as unknown as { unshiftPhase(p: unknown): void };
        const origUnshift = pm.unshiftPhase.bind(pm);
        pm.unshiftPhase = (p: unknown): void => {
          const pp = p as { coopBiomeStart?: number };
          // Only the BiomeShopPhase continuation carries coopBiomeStart; a plain SelectModifierPhase does not.
          if (pp != null && Object.hasOwn(pp, "coopBiomeStart")) {
            queuedContinuation.push({ hasBiomeStart: true, biomeStart: pp.coopBiomeStart ?? -999 });
          }
          origUnshift(p);
        };

        const ui = globalScene.ui as unknown as {
          setMode: (...args: unknown[]) => unknown;
          setModeBoundedWhen: (...args: unknown[]) => Promise<"completed" | "forced" | "superseded">;
          setModeWithoutClear: (...args: unknown[]) => unknown;
          setOverlayMode: (...args: unknown[]) => unknown;
          showText: (...args: unknown[]) => unknown;
          getHandler: () => Record<string, unknown>;
        };
        const realGetHandler = ui.getHandler.bind(globalScene.ui);
        ui.getHandler = () => {
          const h = realGetHandler();
          if (h != null && typeof h.updateCostText !== "function") {
            h.updateCostText = () => {};
          }
          if (h != null && typeof h.setStock !== "function") {
            h.setStock = () => {};
          }
          return h;
        };
        ui.setModeWithoutClear = (...args: unknown[]): unknown => {
          if (args[0] === UiMode.PARTY) {
            (args[3] as (slotIndex: number, option: number) => void)(0, 0);
          }
          if (args[0] === UiMode.CONFIRM) {
            (args[1] as () => void)(); // co-op bounded confirm callback
          }
          return Promise.resolve(true);
        };
        let drove = false;
        ui.setModeBoundedWhen = (...args: unknown[]): Promise<"completed"> => {
          if (args[0] === UiMode.CONFIRM) {
            // BiomeShopPhase uses the bounded co-op transition seam for the
            // leave prompt. The old harness only drove setOverlayMode/
            // setModeWithoutClear, so it never clicked Yes and therefore never
            // sent the LEAVE terminal it later expected the watcher to apply.
            queueMicrotask(() => (args[3] as () => void)());
          }
          if (args[0] === UiMode.BIOME_SHOP && !drove) {
            drove = true;
            // Production opens the market through the bounded transition seam:
            // mode, timeout, liveness fence, stock, biome, public selection callback, quantities.
            const cb = args[5] as (index: number) => boolean;
            queueMicrotask(() => {
              cb(0); // buy the TM
              // A human cannot leave until the party pick has applied and the continuation grid is
              // available again. Wait for that exact production queue evidence instead of issuing a
              // second synthetic click in the buy's unresolved microtask.
              let attempts = 0;
              const leaveAfterContinuation = (): void => {
                if (queuedContinuation.length > 0 || attempts++ >= 8) {
                  cb(-1);
                  return;
                }
                setTimeout(leaveAfterContinuation, 0);
              };
              setTimeout(leaveAfterContinuation, 0);
            });
          }
          return Promise.resolve("completed");
        };
        ui.showText = (...args: unknown[]): unknown => {
          const cb = args[2];
          if (typeof cb === "function") {
            (cb as () => void)();
          }
          return;
        };
        ui.setOverlayMode = (...args: unknown[]): unknown => {
          if (args[0] === UiMode.CONFIRM) {
            (args[1] as () => void)(); // YES: leave the market
          }
          return Promise.resolve(true);
        };

        try {
          phase.start();
          for (let i = 0; i < 24; i++) {
            await drainLoopback();
          }
        } finally {
          pm.unshiftPhase = origUnshift;
        }
      });
    } finally {
      Overrides.WAIVE_ROLL_FEE_OVERRIDE = waiveBefore;
    }

    expect(
      rig.hostRuntime.controller.interactionCounter(),
      "the owner crosses its own local terminal after the human confirms Leave",
    ).toBe(counterBefore + 1);
    expect(pair.faultsInjected(), "the legacy market buy + leave stream must actually be dropped").toBeGreaterThan(0);
    // The continuation the buy queued is a PINNED BiomeShopPhase (carries coopBiomeStart), not the
    // unpinned plain-SelectModifierPhase orphan (pre-fix this array is empty - the copy had no coopBiomeStart).
    expect(queuedContinuation.length, "the TM buy queued a BiomeShopPhase continuation (carries a biome pin)").toBe(1);
    expect(queuedContinuation[0].biomeStart, "the continuation inherited the market pin (counter 0)").toBe(
      counterBefore,
    );

    // WATCHER (guest): adopt the retained stock/result and acknowledge its continuation. Then pump both
    // destinations through the retry/ACK transaction until the watcher's own local terminal crosses.
    await withClient(rig.guestCtx, async () => {
      for (let i = 0; i < 32; i++) {
        await drainLoopback();
        if (rig.guestRuntime.controller.interactionCounter() > counterBefore) {
          break;
        }
      }
    });
    await withClient(rig.hostCtx, async () => {
      for (let i = 0; i < 32 && rig.hostRuntime.controller.interactionCounter() === counterBefore; i++) {
        await drainLoopback();
      }
    });
    await withClient(rig.guestCtx, async () => {
      for (let i = 0; i < 32 && rig.guestRuntime.controller.interactionCounter() === counterBefore; i++) {
        await drainLoopback();
      }
    });
    // Fault recovery can require result -> material-applied -> authority release -> final counter broadcast.
    // Pump the bounded complete transaction, not merely the first result/ACK pair.
    await pumpDuoDestinations(rig, 8);

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
