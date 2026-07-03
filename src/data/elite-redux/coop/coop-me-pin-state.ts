/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op mystery-encounter interaction PIN (#633). The interaction counter the
// in-progress ME pinned on lives HERE - a leaf module with zero imports - so its
// readers (encounter-phase-utils, ui.ts, select-modifier-phase) never import the
// heavy `mystery-encounter-phases` phase module (which itself imports
// encounter-phase-utils: that edge was an import CYCLE). mystery-encounter-phases
// owns all the WRITES through the setter and re-exports the readers for its
// existing consumers.
// =============================================================================

/** The interaction counter the in-progress ME pinned on, or -1 when not in an ME. */
let coopMeInteractionStart = -1;

/** Whether a co-op mystery encounter is currently in progress (a pin is set). */
export function coopMeInProgress(): boolean {
  return coopMeInteractionStart >= 0;
}

/**
 * The interaction counter the in-progress ME pinned on (== `seq - COOP_ME_PUMP_SEQ_BASE`),
 * or -1 when not in an ME. The host's await-and-apply path + the engine sub-prompt relays
 * (encounter-phase-utils) and the host input block (ui.ts) read it to key their seq
 * channels onto the SAME pinned counter the pump opened on, never the live counter.
 */
export function coopMeInteractionStartValue(): number {
  return coopMeInteractionStart;
}

/** Write the ME pin (mystery-encounter-phases owns every call site). */
export function setCoopMeInteractionStart(counter: number): void {
  coopMeInteractionStart = counter;
  if (counter < 0) {
    coopMeHandoffBattle = false; // the ME ended - the handoff exemption ends with it
  }
}

// #817 (live BOTH-frozen at the ME battle): once an ME option SPAWNS A BATTLE, the ME pin
// stays set through the fight (the post-battle rewards/terminal still key off it), but the
// ui.ts input/stream gates MUST stand down - they are selector-era gates, and leaving them
// up froze the battle's command UI on both clients while its messages streamed down the
// (already-closed) ME narration channel. This flag marks "the handoff battle has started".
let coopMeHandoffBattle = false;

/** Whether the in-progress ME has handed off to its spawned battle (#817). */
export function coopMeHandoffBattleStarted(): boolean {
  return coopMeHandoffBattle;
}

/** Mark the ME battle handoff as started (host pump end + guest terminal set this). */
export function setCoopMeHandoffBattleStarted(): void {
  coopMeHandoffBattle = true;
}
