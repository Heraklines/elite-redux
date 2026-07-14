/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op (#633 B9c): shared wire constants for the THREE ER ability-picker consumables
// (Ability Capsule / Greater Ability Capsule / Greater Ability Randomizer) used inside
// the alternating reward shop.
//
// THE BUG these fix: a player uses an ER ability item in the co-op shop; BOTH clients ran
// the picker phase and opened their OWN ability picker, picked independently -> diverged ->
// the watcher hung awaiting reward options the (already-advanced) owner never sent = SHOP
// SOFTLOCK.
//
// THE MODEL (mirrors the reward-shop owner/watcher relay in select-modifier-phase.ts): only
// the shop OWNER drives the picker + rolls RNG, then relays the resolved OUTCOME. The WATCHER never
// opens a picker and never rolls RNG - it awaits the owner's literal outcome and applies it. EVERY
// owner end-path (commit OR any cancel/guard) relays an outcome (CANCEL when nothing committed), so
// the watcher never stalls.
//
// CHANNEL ISOLATION (the BLOCKING bug the review caught): the outcome rides `interactionChoice`, but
// it MUST NOT share the shop's pinned seq - the reward-shop watch loop awaits `interactionChoice` on
// that raw seq and would STEAL the ability outcome (the watcher picker then hangs 20min = softlock),
// AND its dispatch keys off data[0], which used to alias COOP_ACT_* 1:1. So we route the outcome on a
// DEDICATED derived seq (coopAbilityPickerSeq) the shop loop never reads, AND the op codes are based
// well clear of the COOP_ACT_* range (defense-in-depth). The `choice` is also a dedicated sentinel.
// =============================================================================

import {
  armCoopAbilityOutcomeResend,
  type CoopAbilityOperationBinding,
  commitAbilityOwnerOutcome,
} from "#data/elite-redux/coop/coop-ability-operation";
import { coopLog } from "#data/elite-redux/coop/coop-debug";
import type { CoopInteractionRelay } from "#data/elite-redux/coop/coop-interaction-relay";
// #840: COOP_ABILITY_SEQ_BASE declared in coop-seq-registry (single source of truth), re-exported below.
import { COOP_ABILITY_SEQ_BASE } from "#data/elite-redux/coop/coop-seq-registry";
import type { CoopRole } from "#data/elite-redux/coop/coop-transport";

export { COOP_ABILITY_SEQ_BASE };

/**
 * Sentinel `choice` for a relayed ER ability-picker OUTCOME. Distinct from every reward/shop
 * cursor (>= 0) and from the reward-shop LEAVE(-1) / REROLL(-2) sentinels (coop-interaction-relay.ts),
 * so the shop's watch loop can never confuse one with a reward pick (C8). The relay test asserts this
 * sentinel stays distinct from LEAVE/REROLL.
 */
export const COOP_ABILITY_OUTCOME = -3;

/**
 * `data[0]` op code of a relayed ability-picker outcome. CANCEL is the DEFAULT outcome every
 * non-committing owner end-path relays, so the watcher always resolves and re-offers in parity
 * (it leaves the continuation copy, re-entering the shop watch). The rest are committed picks.
 */
// Op codes are based at 10 (NOT 0) so they never alias the reward-shop action codes COOP_ACT_REWARD(0)
// /SHOP(1)/TRANSFER(2)/LOCK(3) - belt-and-suspenders so that even a MISROUTED ability outcome reaching
// the shop loop's data[0]-keyed dispatch is at worst an "unknown action" (warn + no-op), never a
// phantom buy / transfer / lock. (The dedicated seq below already prevents the shop loop from seeing it.)
export const COOP_ABILITY_OP = {
  /** No pick committed (any cancel / guard / mon-vanished). data = [CANCEL]. */
  CANCEL: 10,
  /** Ability Capsule: cycle the active ability. data = [CYCLE]. */
  CAP_CYCLE: 11,
  /** Ability Capsule: run-unlock one innate slot. data = [CAP_RUNUNLOCK, slot]. */
  CAP_RUNUNLOCK: 12,
  /** Greater Capsule: permanently unlock one innate slot. data = [GCAP_PERM, slot]. */
  GCAP_PERM: 13,
  /** Greater Capsule: run-unlock two innate slots. data = [GCAP_RUN2, slotA, slotB]. */
  GCAP_RUN2: 14,
  /** Greater Randomizer: replace a slot with the host's LITERAL rolled abilityId. data = [GRAND, slot, abilityId]. */
  GRAND: 15,
} as const;

/**
 * Derive a DEDICATED relay seq for an ability-picker outcome from the shop's pinned interaction seq.
 * The reward-shop watch loop awaits `interactionChoice` on the RAW shop seq; routing the ability
 * outcome on a distinct derived seq means the shop loop NEVER consumes it and the picker is the sole
 * awaiter (fixing the BLOCKING channel collision). The large fixed base keeps it clear of the shop
 * seq (small), the learn-move seq and the ME seqs (~8-9 million). Two sequential ability
 * buys in one shop reuse the same derived seq SAFELY - each outcome is consumed by its picker's await
 * before the next picker runs (same as the shop loop reusing one seq across reward picks). Returns -1
 * for a non-co-op seq (the picker's `coopSeq < 0` guard already short-circuits before this is used).
 */
export function coopAbilityPickerSeq(shopSeq: number): number {
  const derived = shopSeq < 0 ? -1 : COOP_ABILITY_SEQ_BASE + shopSeq;
  // Per-ability-picker (not hot): log the seq derivation so a misrouted/colliding ability-picker
  // outcome is traceable (the dedicated derived seq is the channel-isolation guarantee).
  coopLog("ability", `coopAbilityPickerSeq shopSeq=${shopSeq} -> derivedSeq=${derived} base=${COOP_ABILITY_SEQ_BASE}`);
  return derived;
}

/**
 * Reverse-map a {@linkcode COOP_ABILITY_OP} numeric code to its name for greppable logging at the
 * relay's owner-send / watcher-apply sites - so a misrouted op (a code reaching the wrong dispatch)
 * is visible as a name in the captured log instead of a bare integer. Log-only; never alters flow.
 */
export function coopAbilityOpName(op: number): string {
  for (const [name, code] of Object.entries(COOP_ABILITY_OP)) {
    if (code === op) {
      return name;
    }
  }
  return `UNKNOWN(${op})`;
}

/**
 * How long the WATCHER waits for the owner's relayed ability outcome before giving up (then it
 * just ends + re-offers via the surviving copy, never hangs). Matches COOP_REWARD_WAIT_MS:
 * "wait for the human" - the owner is mid-picker, so this must exceed human deliberation.
 */
export const COOP_ABILITY_WAIT_MS = 1_200_000;

/** Routing/logging label for the relayed ability outcome (the relay treats `kind` as opaque). */
export const COOP_ABILITY_KIND = "abilityPicker";

/** Production owner carrier seam; operation journaling layers onto this without changing phase callers. */
export function sendCoopAbilityPickerOutcome(
  relay: CoopInteractionRelay | null,
  shopSeq: number,
  data: number[],
  context?: { localRole: CoopRole; wave: number; turn?: number },
  operationBinding?: CoopAbilityOperationBinding | null,
): void {
  if (context != null) {
    commitAbilityOwnerOutcome({ pinned: shopSeq, data, ...context }, operationBinding);
  }
  const derivedSeq = coopAbilityPickerSeq(shopSeq);
  relay?.sendInteractionChoice(derivedSeq, COOP_ABILITY_KIND, COOP_ABILITY_OUTCOME, [...data]);
  if (context?.localRole === "guest" && relay != null) {
    armCoopAbilityOutcomeResend(
      shopSeq,
      data,
      () => {
        relay.sendInteractionChoice(derivedSeq, COOP_ABILITY_KIND, COOP_ABILITY_OUTCOME, [...data]);
      },
      operationBinding,
    );
  }
}
