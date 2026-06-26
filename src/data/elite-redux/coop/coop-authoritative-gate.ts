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

/** The live predicate, installed by coop-runtime; `null` (the default) reads as `false`. */
let predicate: (() => boolean) | null = null;

/**
 * coop-runtime ONLY: install (or clear, with `null`) the real {@linkcode isCoopAuthoritativeGuestGated}
 * predicate. Called once when a session is registered and cleared on teardown so a subsequent solo /
 * lockstep run reads `false`.
 */
export function setCoopAuthoritativeGuestPredicate(fn: (() => boolean) | null): void {
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
    return predicate?.() === true;
  } catch {
    return false;
  }
}
