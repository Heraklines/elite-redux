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

// =============================================================================
// #848 TEST-SCOPED picker auto-resolve. The OWNER of the crossroads / World-Map pick drives a REAL
// UI prompt that awaits a human - correct in production, but a HEADLESS multi-wave test (coop-battle-
// control, the soak runs) that only drives command phases never answers it, so the owner side would
// hang forever at the wave-5 boundary (and a single-engine WATCHER would network-wait the full
// human-deliberation timeout). Under vitest, unless a test EXPLICITLY opts into driving the picker
// (setCoopBiomePickerDrivenByTest, RESET in teardown), the owner prompt AUTO-RESOLVES to the
// deterministic fallback (the same seed-deterministic path the watcher backstop uses, so both engines
// converge identically) after a short scoped delay, and the watcher wait is capped short. Live builds
// NEVER define VITEST, so production keeps the real prompt with no timeout - byte-identical behavior.
//
// Modeled on coop-rendezvous.ts getCoopRendezvousWaitMs (an explicitly-SET flag + a RESET helper, NOT
// a bare latching `let` that survives file boundaries - the #833 latch class the reset helper closes).
// This module stays a leaf: `process.env` is a global (no import).
// =============================================================================

/** The short scoped delay/timeout (ms) the owner auto-resolve + watcher backstop use under vitest. */
const COOP_BIOME_TEST_AUTORESOLVE_MS = 30;

/** Whether a test has explicitly opted into driving the REAL crossroads / World-Map picker. */
let coopBiomePickerDrivenByTest = false;

function inVitest(): boolean {
  return typeof process !== "undefined" && !!process.env?.VITEST;
}

/**
 * True when the owner prompt should AUTO-RESOLVE and the watcher wait should be capped: under vitest,
 * unless the running test opted into driving the real picker. Always false in a live build (no VITEST),
 * so production is untouched.
 */
export function coopBiomePickerAutoResolvesInTest(): boolean {
  return inVitest() && !coopBiomePickerDrivenByTest;
}

/** The short scoped delay/timeout (ms) for the vitest auto-resolve + capped watcher wait. */
export function coopBiomePickerAutoResolveMs(): number {
  return COOP_BIOME_TEST_AUTORESOLVE_MS;
}

/**
 * Opt THIS test into driving the REAL crossroads / World-Map picker (owner opens the actual screen; no
 * auto-resolve). A test that drives the picker MUST call this in beforeEach and
 * {@linkcode resetCoopBiomePickerDrivenByTest} in teardown (NOT re-clear by any other means - the reset
 * helper is the anti-latch discipline, like resetCoopRendezvousWaitMs).
 */
export function setCoopBiomePickerDrivenByTest(): void {
  coopBiomePickerDrivenByTest = true;
}

/** Restore the DEFAULT (auto-resolve under vitest). Tests that opted in MUST call this in teardown. */
export function resetCoopBiomePickerDrivenByTest(): void {
  coopBiomePickerDrivenByTest = false;
}
