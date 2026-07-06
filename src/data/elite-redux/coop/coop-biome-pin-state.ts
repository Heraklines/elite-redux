/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op BIOME-CHOICE interaction PIN (#848). The every-5-waves CROSSROADS and the ER
// World-Map biome PICK are ONE owner-alternated interaction when the owner LEAVES: the
// crossroads defers its terminal advance and unshifts SelectBiomePhase, which completes
// the SAME interaction (one owner drives both screens, one counter advance at the map
// terminal - the maintainer's "one interaction, not two"). This leaf module (zero imports)
// carries the pinned interaction counter ACROSS the two phases so SelectBiomePhase knows it
// is a chained continuation (it MUST advance) rather than a fresh natural biome-end.
//
// Modeled on coop-me-pin-state.ts: a leaf so its readers (select-biome-phase) never import
// the crossroads phase and vice-versa. ErCrossroadsPhase owns the SET (on Leave it keeps the
// pin) and CLEAR (on Stay it resolves the interaction itself); SelectBiomePhase reads the pin
// and clears it at its own terminal.
// =============================================================================

/** The interaction counter a crossroads LEAVE pinned + deferred to SelectBiomePhase, or -1. */
let coopBiomeInteractionStart = -1;

/** Whether a crossroads Leave has deferred its interaction to a chained SelectBiomePhase. */
export function coopBiomeInteractionInProgress(): boolean {
  return coopBiomeInteractionStart >= 0;
}

/** The pinned interaction counter of the deferred crossroads->biome chain (-1 when none). */
export function coopBiomeInteractionStartValue(): number {
  return coopBiomeInteractionStart;
}

/** Pin the deferred crossroads->biome interaction counter (ErCrossroadsPhase, on Leave). */
export function setCoopBiomeInteractionStart(counter: number): void {
  coopBiomeInteractionStart = counter;
}

/** Clear the deferred pin (SelectBiomePhase at its terminal, or a run teardown). */
export function clearCoopBiomeInteractionStart(): void {
  coopBiomeInteractionStart = -1;
}
