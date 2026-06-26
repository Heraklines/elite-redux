/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op (#633 B9b): shared wire constants for the shop "Check Team" (PARTY/CHECK) party
// MUTATION relay.
//
// THE BUG these fix: in the co-op reward shop, opening "Check Team" let the OWNER reorder /
// give / release / unsplice / rename / unpause-evolution / toggle a form-change item on the
// SHARED party - but the mutation applied ONLY on the owner's client. The party order / length /
// speciesId / formIndex / abilityId and the persistent-modifier multiset are ALL per-turn checksum
// hashed (coop-battle-checksum.ts), so an owner-only mutation here flipped the watcher's checksum
// -> resync storm (and for an on-field form toggle / release, a visible field divergence).
//
// THE MODEL (mirrors the reward-shop owner/watcher relay in select-modifier-phase.ts and the B9c
// ability-picker relay): the OWNER relays each resolved CHECK-mode mutation on the shop's pinned
// interaction seq, on the SAME owner->watcher `interactionChoice` channel reward picks ride, packed
// as data = [COOP_ACT_CHECK, COOP_CHECK_OP_*, ...payload]. The WATCHER never opens PARTY; it applies
// each relayed op verbatim against its identical party, resolving the target by the SLOT index
// captured pre-op (identical on both sides by FIFO replay).
//
// Engine-FREE (wire constants only) so it is importable from BOTH the SelectModifierPhase (the
// owner relay + watcher applier) and PartyUiHandler (the per-mutation source hooks) without a
// phase<->handler import cycle, and unit-testable headlessly with no game boot.
// =============================================================================

/**
 * The action-type code (data[0] of a relayed reward choice) for a "Check Team" party mutation.
 * Based at 4 so it stays clear of the reward-shop action codes COOP_ACT_REWARD(0)/SHOP(1)/
 * TRANSFER(2)/LOCK(3) in select-modifier-phase.ts - a misrouted CHECK op can never masquerade as
 * a reward buy / transfer / lock. CHECK ops are NON-terminal: the owner stays in the shop, so the
 * watcher applies the op and keeps watching.
 */
export const COOP_ACT_CHECK = 4;

/** The CHECK-mode op codes carried in data[1]; the per-op payload follows in data[2..]. */
export const COOP_CHECK_OP_REORDER = 0; // [from, to]
export const COOP_CHECK_OP_GIVE = 1; // [slot]
export const COOP_CHECK_OP_RELEASE = 2; // [slot]
export const COOP_CHECK_OP_UNSPLICE = 3; // [slot]
export const COOP_CHECK_OP_RENAME = 4; // [slot, ...nicknameCodePoints]
export const COOP_CHECK_OP_UNPAUSE_EVO = 5; // [slot]
export const COOP_CHECK_OP_FORM_ITEM = 6; // [slot, formItemIndex]

/** The relay `kind`/label (routing + logging only) for a CHECK-mode mutation. */
export const COOP_CHECK_KIND = "check";
