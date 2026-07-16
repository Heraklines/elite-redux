/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// Co-op ME-EMBEDDED biome market (#832, audit P1#5). The Exotic Trader / Black Market / Import Bazaar
// mystery encounters open a full-screen BiomeShopPhase market. The HOST runs the sole ME engine and
// streams the shop stock under the BIOME reroll namespace (COOP_BIOME_STOCK_REROLL = 777), keyed by the
// pinned ME interaction counter; the authoritative GUEST (parked in CoopReplayMePhase) opens its OWN
// BiomeShopPhase watcher off that stream via the #821 handoff routed through openGuestMeEmbeddedShop.
//
// The two audit defects this proves fixed, engine-free over a LoopbackTransport (like coop-interaction-
// relay.test.ts) + a stub scene + a local session (like coop-shop-continuation-orphan.test.ts):
//  (b) KEY UNIFICATION - the biome stock rides reroll 777, so the guest MUST open a BiomeShopPhase (which
//      awaits 777), NOT a SelectModifierPhase (which awaits reroll 0 and would never adopt the 777 stock).
//      Proven: the host stream fires the guest's notification with the pinned-counter/777 key, the watcher
//      reconstructs the IDENTICAL stock, the buy relay round-trips on coopBiomeShopSeq, and the 777 key is
//      disjoint from the reward-shop 0 key. openGuestMeEmbeddedShop routes to the matching phase.
//  (c) NO DOUBLE-ADVANCE - the embedded biome market SUPPRESSES its own interaction advance while an ME is
//      in progress (the whole ME advances once at its true terminal), exactly like the embedded SelectModifierPhase.

import type { BattleScene } from "#app/battle-scene";
import { globalScene, initGlobalScene } from "#app/global-scene";
import {
  coopBiomeShopStockKey,
  hasBufferedCoopBiomeShopStock,
  openGuestMeEmbeddedShop,
} from "#data/elite-redux/coop/coop-biome-shop";
import {
  COOP_BIOME_STOCK_REROLL,
  COOP_INTERACTION_LEAVE,
  CoopInteractionRelay,
  coopBiomeShopSeq,
} from "#data/elite-redux/coop/coop-interaction-relay";
import { setCoopMeInteractionStart } from "#data/elite-redux/coop/coop-me-pin-state";
import { reconstructRewardOptions } from "#data/elite-redux/coop/coop-reward-options";
import {
  advanceCoopInteractionForContinuation,
  clearCoopRuntime,
  getCoopController,
  setCoopMeBattleInteractionCounter,
  startLocalCoopSession,
} from "#data/elite-redux/coop/coop-runtime";
import type { CoopSerializedRewardOption } from "#data/elite-redux/coop/coop-transport";
import { createLoopbackPair } from "#data/elite-redux/coop/coop-transport";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const flush = () => new Promise<void>(r => setTimeout(r, 0));

// A realistic curated Exotic Trader stock (fixed keys, like er-exotic-shop) as it crosses the wire.
const BIOME_STOCK: CoopSerializedRewardOption[] = [
  { id: "MASTER_BALL", tier: 4, upgradeCount: 0, cost: 5000 },
  { id: "LEFTOVERS", tier: 2, upgradeCount: 0, cost: 2000 },
  { id: "FOCUS_BAND", tier: 2, upgradeCount: 0, cost: 2400 },
];

describe("co-op ME-embedded biome market (#832, audit P1#5) - relay round-trip", () => {
  // (b) The host stream fires the guest's shop-handoff notification with the pinned-counter/777 key.
  it("host streams the ME-embedded biome stock (reroll 777); the guest notification fires with the pinned-counter key", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    // The guest's CoopReplayMePhase parks with NO rewardOptions waiter, so the stream BUFFERS and fires
    // onRewardOptionsBuffered - the exact seam the #821 handoff (routed to openGuestMeEmbeddedShop) hooks.
    let firedKey: string | null = null;
    watcher.onRewardOptionsBuffered = key => {
      firedKey = key;
    };

    const counter = 4; // an even ME counter (host-owned); the pinned start the biome shop keys off
    owner.sendRewardOptions(counter, COOP_BIOME_STOCK_REROLL, BIOME_STOCK);
    await flush();

    expect(firedKey).toBe(coopBiomeShopStockKey(counter)); // `${counter}:777`
    expect(watcher.hasBufferedRewardOptionsFor(coopBiomeShopStockKey(counter))).toBe(true);
  });

  // (b) The watcher adopts the IDENTICAL streamed stock (never re-rolls) - reconstruct is faithful.
  it("the guest watcher adopts the IDENTICAL streamed biome stock (reconstruct round-trip)", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    const counter = 4;
    const awaited = watcher.awaitRewardOptions(counter, COOP_BIOME_STOCK_REROLL);
    owner.sendRewardOptions(counter, COOP_BIOME_STOCK_REROLL, BIOME_STOCK);
    const streamed = await awaited;

    expect(streamed).toEqual(BIOME_STOCK);
    // The watcher rebuilds the owner's exact options against its own party (empty here). modifierTypes is
    // populated at test setup, so the reconstruct is engine-free (same as coop-reward-options.test.ts).
    const rebuilt = reconstructRewardOptions(streamed!, []);
    expect(rebuilt).not.toBeNull();
    expect(rebuilt!.map(o => o.type.id)).toEqual(BIOME_STOCK.map(o => o.id));
    expect(rebuilt!.map(o => o.cost)).toEqual(BIOME_STOCK.map(o => o.cost));
  });

  // The owner's buys ride the DEDICATED biome seq (7_000_000 + counter), FIFO, ending in the LEAVE sentinel.
  it("the buy relay round-trips on coopBiomeShopSeq FIFO, ending in the LEAVE sentinel", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const watcher = new CoopInteractionRelay(guest);

    const counter = 4;
    const seq = coopBiomeShopSeq(counter);
    expect(seq).toBe(7_000_000 + counter);

    // Owner buys slot 0 onto party mon 1 (money after = 3000), slot 2 (no target), then leaves.
    owner.sendInteractionChoice(seq, "biomeShop", 0, [1, 3000]);
    owner.sendInteractionChoice(seq, "biomeShop", 2, [-1, 600]);
    owner.sendInteractionChoice(seq, "biomeShop", COOP_INTERACTION_LEAVE);
    await flush();

    const buy1 = await watcher.awaitInteractionChoice(seq);
    expect(buy1?.choice).toBe(0);
    expect(buy1?.data).toEqual([1, 3000]);
    const buy2 = await watcher.awaitInteractionChoice(seq);
    expect(buy2?.choice).toBe(2);
    expect(buy2?.data).toEqual([-1, 600]);
    const leave = await watcher.awaitInteractionChoice(seq);
    expect(leave?.choice).toBe(COOP_INTERACTION_LEAVE);
  });

  // (b) The heart of the defect: the biome key (777) is DISJOINT from the reward-shop key (0) for the same
  // ME counter, so a SelectModifierPhase watcher (awaits reroll 0) would NEVER adopt the 777 biome stock.
  it("the biome stock key (777) does NOT satisfy a reward-shop watcher awaiting reroll 0 (the defect-b mismatch)", async () => {
    const { host, guest } = createLoopbackPair();
    const owner = new CoopInteractionRelay(host);
    const timer: { fire?: () => void } = {};
    const watcher = new CoopInteractionRelay(guest, {
      schedule: cb => {
        timer.fire = cb;
        return () => {};
      },
    });

    const counter = 4;
    owner.sendRewardOptions(counter, COOP_BIOME_STOCK_REROLL, BIOME_STOCK); // biome stock under 777
    // A generic reward-shop watcher (SelectModifierPhase.startCoopWatch) awaits reroll 0 for the SAME counter.
    const rewardWait = watcher.awaitRewardOptions(counter, 0, 1000);
    await flush();
    timer.fire?.(); // it times out - the 777 stock never satisfies the reroll-0 wait
    expect(await rewardWait).toBeNull();

    // But a BiomeShopPhase watcher awaiting reroll 777 DOES adopt it (buffered, so it resolves at once).
    const biomeWait = await watcher.awaitRewardOptions(counter, COOP_BIOME_STOCK_REROLL);
    expect(biomeWait).toEqual(BIOME_STOCK);
  });
});

describe("co-op ME-embedded biome market (#832, audit P1#5) - guest-open routing + advance suppression", () => {
  const rec = { unshifted: [] as string[], args: [] as unknown[][] };
  let prevGlobalScene: BattleScene;

  function makeStubScene(): BattleScene {
    return {
      gameMode: { isCoop: true },
      phaseManager: {
        unshiftNew(name: string, ...args: unknown[]): void {
          rec.unshifted.push(name);
          rec.args.push(args);
        },
        shiftPhase(): void {},
      },
    } as unknown as BattleScene;
  }

  beforeEach(() => {
    prevGlobalScene = globalScene;
    rec.unshifted = [];
    rec.args = [];
    initGlobalScene(makeStubScene());
  });

  afterEach(() => {
    // Clear BOTH ME pins (production sets/clears them together): the pin-state one the biome shop reads
    // for its counter/roles, and the runtime one advanceCoopInteractionForContinuation reads for suppression.
    setCoopMeInteractionStart(-1);
    setCoopMeBattleInteractionCounter(-1);
    clearCoopRuntime();
    // Citizenship (#710): restore the real scene so the NEXT ER_SCENARIO file's `new GameManager` does not
    // reuse this reset-less stub. Order-robust: each stub file restores before the next file's beforeEach.
    initGlobalScene(prevGlobalScene);
  });

  // (b) The key unification made concrete: the guest opens the phase that MATCHES what the host streamed.
  it("openGuestMeEmbeddedShop opens a BiomeShopPhase when biome stock (777) is buffered", async () => {
    const runtime = startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    const controller = getCoopController();
    expect(controller).not.toBeNull();
    controller!.role = "guest";

    const counter = controller!.interactionCounter();
    // Inject the host's biome stock into the guest's live relay (over the partner transport, host->guest).
    const hostSide = new CoopInteractionRelay(runtime.partnerTransport!);
    hostSide.sendRewardOptions(counter, COOP_BIOME_STOCK_REROLL, BIOME_STOCK);
    await flush();

    expect(hasBufferedCoopBiomeShopStock(counter)).toBe(true);
    openGuestMeEmbeddedShop(counter);
    expect(rec.unshifted).toEqual(["BiomeShopPhase"]);
    hostSide.dispose();
  });

  it("openGuestMeEmbeddedShop opens a SelectModifierPhase when NO biome stock is buffered (unchanged #821)", async () => {
    const runtime = startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    const controller = getCoopController();
    controller!.role = "guest";
    const counter = controller!.interactionCounter();

    // Only a REWARD-shop stock (reroll 0) is buffered - NOT a biome market.
    const hostSide = new CoopInteractionRelay(runtime.partnerTransport!);
    hostSide.sendRewardOptions(counter, 0, [{ id: "RARE_CANDY", tier: 1, upgradeCount: 0, cost: 0 }]);
    await flush();

    expect(hasBufferedCoopBiomeShopStock(counter)).toBe(false);
    openGuestMeEmbeddedShop(counter);
    expect(rec.unshifted).toEqual(["SelectModifierPhase"]);
    hostSide.dispose();
  });

  it("openGuestMeEmbeddedShop preserves the ordered P36 surface from the buffered live handoff", async () => {
    const runtime = startLocalCoopSession({ username: "Guest", netcodeMode: "authoritative" });
    const controller = getCoopController();
    controller!.role = "guest";
    const counter = controller!.interactionCounter();
    const rewardSurface = { ordinal: 0, surfaceId: "modifier:me:graves:0" } as const;
    const bufferedKey = `${counter}:0:${rewardSurface.ordinal}:${encodeURIComponent(rewardSurface.surfaceId)}`;

    const hostSide = new CoopInteractionRelay(runtime.partnerTransport!);
    hostSide.sendRewardOptions(counter, 0, [{ id: "RARE_CANDY", tier: 1, upgradeCount: 0, cost: 0 }], rewardSurface);
    await flush();

    openGuestMeEmbeddedShop(counter, bufferedKey);
    expect(rec.unshifted).toEqual(["SelectModifierPhase"]);
    expect(rec.args[0]?.[5], "the sixth SelectModifierPhase argument is the exact stable surface identity").toEqual(
      rewardSurface,
    );
    hostSide.dispose();
  });

  // (c) The embedded biome market suppresses its own interaction advance while an ME is in progress.
  it("the biome market SUPPRESSES its own interaction advance while an ME is in progress (no double-advance)", () => {
    startLocalCoopSession({ username: "Host", netcodeMode: "authoritative" });
    const controller = getCoopController();
    expect(controller).not.toBeNull();
    const advanceSpy = vi.spyOn(controller!, "advanceInteraction");

    // Inside an ME (the pins are set - production sets BOTH on ME entry): the ME owns the single advance at
    // its true terminal, so the embedded biome market's coopBiomeTerminal / coopBiomeWatch advance is a NO-OP
    // (advanceCoopInteractionForContinuation's coopMeInProgress guard) - the exact suppression the embedded
    // SelectModifierPhase uses.
    setCoopMeInteractionStart(0);
    setCoopMeBattleInteractionCounter(0);
    advanceCoopInteractionForContinuation(0);
    expect(advanceSpy).not.toHaveBeenCalled();

    // Outside an ME (the every-10-wave market): it advances normally, byte-identical to before.
    setCoopMeInteractionStart(-1);
    setCoopMeBattleInteractionCounter(-1);
    advanceCoopInteractionForContinuation(0);
    expect(advanceSpy).toHaveBeenCalledTimes(1);
  });
});
