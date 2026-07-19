/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Co-op authoritative-guest GATE - a CYCLE-FREE leaf (#633 B6). `field/pokemon.ts`
// needs the "are we the authoritative co-op GUEST?" check to gate a structural
// party mutation (the Shedinja bonus-add). It cannot import `coop-runtime` directly:
// runtime -> coop-battle-engine -> #field/pokemon (a VALUE import of EnemyPokemon),
// so `pokemon -> runtime` would close a real value-level import cycle. This module
// imports NOTHING (no globalScene / Pokemon / engine), so it is safe to import from
// anywhere - including `pokemon.ts`. `coop-runtime` REGISTERS its real predicate here
// at session setup (mirrors the existing publisher hooks like setGhostPoolPublisher);
// before any session it is a hard `false`, so solo / host / lockstep are unaffected.
// =============================================================================

import { coopLog, isCoopDebug } from "#data/elite-redux/coop/coop-debug";

/** The live predicate, installed by coop-runtime; `null` (the default) reads as `false`. */
let predicate: (() => boolean) | null = null;

/** The live showdown-guest-flip predicate, installed by coop-runtime; `null` reads as `false`. */
let showdownFlipPredicate: (() => boolean) | null = null;

/**
 * coop-runtime ONLY: install (or clear, with `null`) the real {@linkcode isCoopAuthoritativeGuestGated}
 * predicate. Called once when a session is registered and cleared on teardown so a subsequent solo /
 * lockstep run reads `false`.
 */
export function setCoopAuthoritativeGuestPredicate(fn: (() => boolean) | null): void {
  // The two-engine harness swaps its process-global runtime for each synthetic
  // browser pump. The registered predicate is the same stable function and reads
  // the active runtime dynamically, so reassigning/logging it thousands of times
  // is neither a state change nor useful evidence.
  if (predicate === fn) {
    return;
  }
  // One-shot (session register / teardown) - log install vs clear so a stale-gate bug (a predicate
  // surviving into a later solo / lockstep run) is visible in the captured log.
  coopLog(
    "session",
    `coopAuthoritativeGuestPredicate ${fn == null ? "CLEARED (-> solo/host/lockstep reads false)" : "INSTALLED"}`,
  );
  predicate = fn;
}

/**
 * Whether THIS client is the GUEST of a live AUTHORITATIVE co-op session, read through the cycle-free
 * gate (#633 B6). Equivalent to `coop-runtime`'s `isCoopAuthoritativeGuest()`, but importable from the
 * `pokemon.ts` value-import cycle. Hard `false` before any session / for solo / host / lockstep, so
 * those paths are byte-for-byte unaffected. Fully guarded - a throwing predicate reads as `false`.
 */
export function isCoopAuthoritativeGuestGated(): boolean {
  try {
    const result = predicate?.() === true;
    // HOT (read on every gated structural party mutation): only log the rare TRUE result, and only
    // when debug is on, so the common solo/host FALSE path stays a single boolean check.
    if (result && isCoopDebug()) {
      coopLog("session", "isCoopAuthoritativeGuestGated -> true (authoritative GUEST gates a structural mutation)");
    }
    return result;
  } catch {
    return false;
  }
}

/**
 * coop-runtime ONLY: install (or clear, with `null`) the real {@linkcode isShowdownGuestFlipGated}
 * predicate. Called once when a session is registered and cleared on teardown.
 */
export function setShowdownGuestFlipPredicate(fn: (() => boolean) | null): void {
  showdownFlipPredicate = fn;
}

/**
 * Whether THIS client is the versus GUEST (the presentation perspective flip is active), read
 * through the cycle-free gate so `pokemon.ts` / the battle-info panels can consult it without
 * importing coop-runtime (a value-level import cycle). Hard `false` before any session / solo /
 * co-op / host, so those render paths are byte-for-byte unchanged. A throwing predicate reads
 * `false`. Presentation-only: the caller uses it read-only at render, never to mutate state.
 */
export function isShowdownGuestFlipGated(): boolean {
  try {
    return showdownFlipPredicate?.() === true;
  } catch {
    return false;
  }
}
