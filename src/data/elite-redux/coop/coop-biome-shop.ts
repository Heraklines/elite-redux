/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op guest-side opener for an ME-EMBEDDED biome market (#832, audit P1#5).
//
// The Exotic Trader / Black Market / Import Bazaar mystery encounters open a real
// full-screen BiomeShopPhase market (not the vanilla reward row). The HOST runs the
// sole ME engine and STREAMS the shop stock under the biome reroll namespace
// (COOP_BIOME_STOCK_REROLL = 777, keyed by the pinned ME interaction counter). The
// authoritative GUEST never runs the ME engine - it is parked in CoopReplayMePhase -
// so it must open its OWN watcher market when that stock arrives, exactly like the
// #821 embedded-reward-shop handoff opens a watcher SelectModifierPhase.
//
// The ONLY difference from #821 is WHICH phase to open: a biome market must open a
// BiomeShopPhase (its coopBiomeWatch awaits the reroll-777 stock + the coopBiomeShopSeq
// buy relay), NOT a SelectModifierPhase (which awaits reroll 0 and would never adopt the
// 777 biome stock - audit P1#5 defect b). This module is the key-discriminating opener
// the CoopReplayMePhase shop handoff delegates to, kept OUT of that phase so the biome
// routing lives with the biome shop (which owns the 777 namespace).
//
// Engine-light (globalScene + the interaction relay only) so it is unit-testable
// headlessly over a LoopbackTransport. Both phases are pushed by their registered NAME
// (no class import) so this module never cycles back through the phase layer.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import { COOP_BIOME_STOCK_REROLL, parseCoopRewardOptionsKey } from "#data/elite-redux/coop/coop-interaction-relay";
import { failCoopSharedSession, getCoopInteractionRelay } from "#data/elite-redux/coop/coop-runtime";

/**
 * The `${seq}:${reroll}` reward-options key the host streams an ME-embedded biome market's stock under
 * (defect b: 777, the biome reroll namespace), for the ME pinned at `interactionCounter`. Negative
 * counters clamp to 0 to mirror {@linkcode coopBiomeShopSeq}'s guard so the guest keys match the host.
 */
export function coopBiomeShopStockKey(interactionCounter: number): string {
  return `${Math.max(0, interactionCounter)}:${COOP_BIOME_STOCK_REROLL}`;
}

/**
 * Whether the host has streamed ME-embedded BIOME market stock (reroll {@linkcode COOP_BIOME_STOCK_REROLL})
 * for this ME's pinned interaction counter, buffered with no waiter. True => the embedded shop the host
 * opened is a biome market (Exotic Trader / Black Market / Import Bazaar), so the guest must open a
 * BiomeShopPhase watcher; false => it is a vanilla reward screen (reroll 0), so the guest opens a
 * SelectModifierPhase (the unchanged #821 handoff).
 */
export function hasBufferedCoopBiomeShopStock(interactionCounter: number): boolean {
  const relay = getCoopInteractionRelay();
  if (relay == null) {
    return false;
  }
  return relay.hasBufferedRewardOptionsFor(coopBiomeShopStockKey(interactionCounter));
}

/**
 * #832 (audit P1#5): open the GUEST's embedded-ME shop in the phase that MATCHES what the host streamed.
 * The CoopReplayMePhase shop handoff (#821) calls this instead of hard-coding "SelectModifierPhase": when
 * the buffered stock is under the biome reroll namespace (777) the host opened a BiomeShopPhase market
 * (Exotic Trader / Black Market / Import Bazaar), so open a BiomeShopPhase (its start() resolves its own
 * owner/watcher + option role off the pinned ME counter and adopts the streamed 777 stock - defects a + b).
 * Otherwise the host opened a vanilla reward screen, so open a SelectModifierPhase (byte-identical to the
 * pre-#832 #821 behavior). Both are pushed by registered phase NAME so this module never imports the phases.
 */
export function openGuestMeEmbeddedShop(interactionCounter: number, bufferedOptionsKey?: string): void {
  if (hasBufferedCoopBiomeShopStock(interactionCounter)) {
    coopLog(
      "reward",
      "guest ME embedded-shop handoff: biome stock (reroll 777) buffered -> BiomeShopPhase watcher (#832)",
      {
        counter: interactionCounter,
      },
    );
    globalScene.phaseManager.unshiftNew("BiomeShopPhase");
    return;
  }
  const optionsAddress = bufferedOptionsKey == null ? null : parseCoopRewardOptionsKey(bufferedOptionsKey);
  if (
    bufferedOptionsKey != null
    && (optionsAddress == null || optionsAddress.seq !== Math.max(0, interactionCounter) || optionsAddress.reroll !== 0)
  ) {
    failCoopSharedSession("A Mystery reward handoff carried an invalid ordered surface address.");
    return;
  }
  coopLog("reward", "guest ME embedded-shop handoff: reward stock (reroll 0) -> SelectModifierPhase (#821)", {
    counter: interactionCounter,
    rewardSurface: optionsAddress?.rewardSurface,
  });
  globalScene.phaseManager.unshiftNew(
    "SelectModifierPhase",
    0,
    undefined,
    undefined,
    false,
    { kind: "ambient" },
    optionsAddress?.rewardSurface,
  );
}
