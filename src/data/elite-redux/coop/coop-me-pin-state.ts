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
    coopMeBespokeHost = false; // #823: ditto for the bespoke host-drive window
    // #834: let the phase module drop its adopted host presentation with the pin (a mid-ME
    // GameOver reaches clearCoopRuntime without an ME terminal; a stale presentation must not
    // leak into the next run's first encounter). Registered by coop-replay-me-phase at load.
    try {
      onMePinCleared?.();
    } catch {
      /* a cleanup hook must never break the pin state */
    }
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

// #823: a BESPOKE mini-game ME (quiz/braille/footprints...) is running on the HOST while the
// GUEST owns the encounter. The old 'safe-degrade' DISCARDED the pick and force-left (the
// Dormant Guardian strand); until the mirroring epic lands, the host drives the mini-game
// for real - this flag stands the host input gate down so it actually can.
let coopMeBespokeHost = false;

/** Whether a bespoke ME mini-game is being driven by the host right now (#823). */
export function coopMeBespokeHostDrives(): boolean {
  return coopMeBespokeHost;
}

/** Mark/clear the bespoke host-drive window (#823). */
export function setCoopMeBespokeHostDrives(on: boolean): void {
  coopMeBespokeHost = on;
}

// #834: cleanup hook invoked whenever the ME pin clears (counter -> -1). Lets higher modules
// (the replay phase's adopted presentation) reset alongside the pin without an import cycle.
let onMePinCleared: (() => void) | null = null;

/** Register the pin-cleared cleanup hook (#834). Last registration wins. */
export function setOnMePinCleared(fn: (() => void) | null): void {
  onMePinCleared = fn;
}

/** Mark the ME battle handoff as started (host pump end + guest terminal set this). */
export function setCoopMeHandoffBattleStarted(): void {
  coopMeHandoffBattle = true;
}
