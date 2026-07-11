/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER achievement-expansion catalog-v2 (#900): PERSISTED RUN-LOCAL state (‡).
//
// Some new achievements track a fact that is scoped to ONE run but MUST survive a
// mid-run save/reload (otherwise a reload silently wipes an in-progress feat):
//   - READ_THE_FINE_PRINT : accepted Giratina's bargain, carry to the run victory.
//   - JUST_SAY_NO         : refused the bargain, clear when the next boss is won.
//   - BLACK_FRIDAY        : one black-market-purchase credit per run (dedupe flag).
//   - TECHNICAL_DIFFICULTIES : moves learned in the last reward phase (moveId -> wave).
//   - PARALLEL_PLAY       : the shared party mon ids that have scored a KO this run.
//   - LIFELINE_SUBSCRIPTION : the last wave a partner revive was credited on (dedupe).
//
// Mirrors the er-money-streak.ts reference implementation: module-level state +
// getErAchievementRunState/restoreErAchievementRunState serialize hooks wired into
// game-data.ts getSessionSaveData/loadSession + an optional SessionSaveData field.
// resetErAchievementRunState() clears it at a fresh run start (starter-select launch).
// =============================================================================

/** The serializable shape stored in the session save (all fields optional / defaulted). */
export interface ErAchievementRunSaveData {
  /** READ_THE_FINE_PRINT: the player accepted Giratina's bargain this run. */
  bargainAccepted?: boolean;
  /** JUST_SAY_NO: the player refused the bargain and no boss has been beaten since. */
  bargainRefusedPendingBoss?: boolean;
  /** BLACK_FRIDAY: a black-market purchase was already credited this run. */
  blackMarketCredited?: boolean;
  /** TECHNICAL_DIFFICULTIES: [moveId, waveLearned] for moves learned in a reward phase. */
  learnedMoveStamps?: [number, number][];
  /** PARALLEL_PLAY: shared party pokemon ids that scored at least one KO this run. */
  parallelPlayKoIds?: number[];
  /** LIFELINE_SUBSCRIPTION: the last wave a partner revive credit was granted. */
  lastCreditedReviveWave?: number;
}

interface ErAchievementRunState {
  bargainAccepted: boolean;
  bargainRefusedPendingBoss: boolean;
  blackMarketCredited: boolean;
  /** moveId -> the wave it was learned on (in the reward phase after a battle). */
  learnedMoveStamps: Map<number, number>;
  parallelPlayKoIds: Set<number>;
  lastCreditedReviveWave: number;
}

function freshState(): ErAchievementRunState {
  return {
    bargainAccepted: false,
    bargainRefusedPendingBoss: false,
    blackMarketCredited: false,
    learnedMoveStamps: new Map<number, number>(),
    parallelPlayKoIds: new Set<number>(),
    lastCreditedReviveWave: -1,
  };
}

let STATE: ErAchievementRunState = freshState();

/** The live run-local achievement state. */
export function erAchvRun(): ErAchievementRunState {
  return STATE;
}

/** Reset all run-local achievement state (new run start). */
export function resetErAchievementRunState(): void {
  STATE = freshState();
}

/** Serialize for the session save (undefined when nothing meaningful is set). */
export function getErAchievementRunState(): ErAchievementRunSaveData | undefined {
  const s = STATE;
  const stamps = [...s.learnedMoveStamps.entries()];
  const kos = [...s.parallelPlayKoIds];
  const hasData =
    s.bargainAccepted
    || s.bargainRefusedPendingBoss
    || s.blackMarketCredited
    || stamps.length > 0
    || kos.length > 0
    || s.lastCreditedReviveWave >= 0;
  if (!hasData) {
    return undefined;
  }
  return {
    bargainAccepted: s.bargainAccepted,
    bargainRefusedPendingBoss: s.bargainRefusedPendingBoss,
    blackMarketCredited: s.blackMarketCredited,
    learnedMoveStamps: stamps,
    parallelPlayKoIds: kos,
    lastCreditedReviveWave: s.lastCreditedReviveWave,
  };
}

/** Restore from a session save (legacy / absent -> fresh state). */
export function restoreErAchievementRunState(data: ErAchievementRunSaveData | undefined): void {
  STATE = freshState();
  if (!data) {
    return;
  }
  STATE.bargainAccepted = !!data.bargainAccepted;
  STATE.bargainRefusedPendingBoss = !!data.bargainRefusedPendingBoss;
  STATE.blackMarketCredited = !!data.blackMarketCredited;
  STATE.learnedMoveStamps = new Map(data.learnedMoveStamps ?? []);
  STATE.parallelPlayKoIds = new Set(data.parallelPlayKoIds ?? []);
  STATE.lastCreditedReviveWave = data.lastCreditedReviveWave ?? -1;
}
