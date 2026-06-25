/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op trainer-victory -> reward determinism (#633, lockstep desync fix).
//
// In LOCKSTEP co-op BOTH clients run the full engine in step on a SHARED run seed.
// The trainer-victory -> reward boundary has no re-convergence barrier, so any
// PER-ACCOUNT branch on that path makes one client queue a phase (or take an async
// UI wait) the other does not, and the two clients drift / HANG with nothing to heal
// them until the next turn's checkpoint.
//
// This module centralizes the per-account divergence sources on the trainer-victory
// path as PURE, engine-free decisions keyed only on SHARED run state (or a constant
// co-op policy). Each function takes an explicit `isCoop` flag so the call site stays
// thin and the SOLO / AUTHORITATIVE paths NEVER reach this logic (byte-for-byte
// unchanged). These are deliberately free of globalScene so they unit-test without a
// live battle (mirrors coop-reward-options.ts).
// =============================================================================

/**
 * Whether to SHOW the trainer victory-dialogue flavor line.
 *
 * SOLO / AUTHORITATIVE: returns `null` to signal "use the existing per-account logic"
 * (the call site keeps its `hasCharSprite && !ui.shouldSkipDialogue(...)` branch exactly
 * as today).
 *
 * CO-OP (lockstep): returns `false` (ALWAYS-SKIP). The whole victory-message block is
 * bypassed on BOTH clients so the async-wait count is a CONSTANT 0, independent of every
 * per-account input. We cannot make ALWAYS-SHOW provably identical without editing
 * `ui.ts`: `ui.showDialogue` independently re-checks the per-account `shouldSkipDialogue`
 * (per-account `skipSeenDialogues` + `gameData.getSeenDialogues()`), and the per-account
 * `gameData.gender` feeds the i18n `context` which can change the `$` page-break count and
 * therefore the number of dialogue dismissals awaited. ALWAYS-SKIP is the only policy
 * whose await count does not depend on any per-account state, so it is the only one that
 * keeps the two lockstep clients structurally identical. Cost: the co-op-only loss of the
 * cosmetic victory flavor line; solo is untouched.
 *
 * @returns `false` to force-skip in co-op, or `null` to defer to the existing per-account
 * call-site logic in solo / authoritative.
 */
export function coopVictoryDialogueDecision(isCoop: boolean): false | null {
  return isCoop ? false : null;
}

/**
 * Whether to QUEUE the repeat-win boss-voucher `ModifierRewardPhase`.
 *
 * The original solo gate is `!validateVoucher(...)` - PER-ACCOUNT save history ("have I
 * already unlocked this boss voucher on a prior run"). That is inherently per-account and
 * has NO shared-run-state proxy, so two co-op clients diverge on it (one queues an extra
 * phase, the other does not) -> lockstep queue-length desync.
 *
 * CO-OP (lockstep): returns `false` - the reward phase is NEVER queued, so the queue is
 * structurally identical on both clients (constant 0 extra phases). The per-account voucher
 * CREDIT is unaffected: the call site still invokes `validateVoucher` for its side effect, so
 * each player still banks its own first-time `voucherCounts++` / achvBar. This is purely
 * SUBTRACTIVE (a repeat-win client loses only the repeat reward modifier) - never inflationary
 * - which is the deterministic, economy-honest choice (vs. always-queue, which would mint a
 * free voucher on every first co-op win). Do not "fix" this back into a per-account branch:
 * that reintroduces the desync.
 *
 * SOLO / AUTHORITATIVE: returns `creditedFirstTime === false` (i.e. the original
 * `!validateVoucher(...)`), byte-for-byte unchanged.
 *
 * @param isCoop - whether this is a live co-op run.
 * @param creditedFirstTime - the boolean `validateVoucher(...)` returned on THIS client
 *   (true only the first time this account unlocks the voucher).
 */
export function coopShouldQueueBossVoucherReward(isCoop: boolean, creditedFirstTime: boolean): boolean {
  if (isCoop) {
    return false;
  }
  return !creditedFirstTime;
}
