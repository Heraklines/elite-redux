/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — bespoke ability `Library` (Batch 4, item 1) — data model.
//
// GENERAL ability (works on ANY holder). While the holder is active:
//   - RECORDING: the FIRST time each opposing Pokemon uses a move, that move is
//     recorded into the holder's Library. The Library holds the 3 most RECENTLY
//     recorded moves; recording a 4th evicts the oldest. Records only while the
//     holder is on-field; status moves are recordable.
//   - DAMPENER: a repeated use of a recorded move (i.e. a recorded move used on
//     a LATER turn than it was recorded) deals 15% less damage to the holder's
//     SIDE (both allies in doubles). The recording turn itself — and any
//     multi-hits within it — are exempt (DEFAULT: keyed on the record turn, so
//     the first use is never dampened).
//   - CASTING: the holder can cast recorded moves from a fight-menu panel (see
//     `library-panel.ts` / `fight-ui-handler.ts`). Casting is limited to 2 total
//     PP per battle SHARED across every library move. A cast DAMAGING move is
//     computed as SPECIAL using the holder's Sp.Atk vs the target's Sp.Def
//     regardless of the move's native category (status moves cast as-is for
//     utility).
//
// State is per-battle (wave-scoped) and keyed by the holder INSTANCE; it resets
// automatically when the wave advances.
// =============================================================================

import { PostSummonAbAttr } from "#abilities/ab-attrs";
import { globalScene } from "#app/global-scene";
import { MoveCategory } from "#enums/move-category";
import type { MoveId } from "#enums/move-id";
import type { Pokemon } from "#field/pokemon";
import type { Move } from "#moves/move";
import type { AbAttrBaseParams } from "#types/ability-types";

/** Hand-authored ER-custom ability id (both the ER-source id and the pokerogue id). */
export const ER_LIBRARY_ABILITY_ID = 5928;

/** Pure marker: Library is driven by the recording / dampener / cast seams. */
export class LibraryAbAttr extends PostSummonAbAttr {
  constructor() {
    super(false);
  }

  override apply(_params: AbAttrBaseParams): void {}
}

/** Maximum number of moves the Library retains (most-recent wins). */
export const LIBRARY_MAX_RECORDED = 3;

/** Total shared cast PP per battle across all library moves. */
export const LIBRARY_CAST_PP = 2;

/** Damage multiplier applied to the holder's side vs a repeated recorded move. */
export const LIBRARY_DAMPENER = 0.85;

/** One recorded move plus the turn it was recorded (for the first-use dampener exemption). */
interface LibraryEntry {
  moveId: MoveId;
  recordedTurnKey: string;
}

/** Per-holder, wave-scoped Library state. */
interface LibraryState {
  wave: number;
  entries: LibraryEntry[];
  /** Foes whose first move has already been recorded (once per foe). */
  recordedFoeIds: Set<number>;
  /** Shared cast PP remaining this battle. */
  castPpRemaining: number;
  /** A pending cast marker so the damage calc can force SPECIAL for the cast. */
  pendingCast?: { moveId: MoveId; turnKey: string };
}

const LIBRARY_STATE = new WeakMap<Pokemon, LibraryState>();

/** Stable identity for "this turn of this battle" (wave + turn number). */
function turnKey(): string {
  const battle = globalScene.currentBattle;
  return `${battle?.waveIndex ?? 0}:${battle?.turn ?? 0}`;
}

function currentWave(): number {
  return globalScene.currentBattle?.waveIndex ?? 0;
}

/** The holder's live (current-wave) Library state, resetting a stale one. */
function getState(holder: Pokemon): LibraryState {
  const existing = LIBRARY_STATE.get(holder);
  const wave = currentWave();
  if (existing && existing.wave === wave) {
    return existing;
  }
  const fresh: LibraryState = {
    wave,
    entries: [],
    recordedFoeIds: new Set(),
    castPpRemaining: LIBRARY_CAST_PP,
  };
  LIBRARY_STATE.set(holder, fresh);
  return fresh;
}

/** Whether `pokemon` carries an unsuppressed, active Library. */
export function hasLibrary(pokemon: Pokemon): boolean {
  return (
    pokemon.isActive(true) && pokemon.getAllActiveAbilityAttrs().some(a => a?.constructor?.name === "LibraryAbAttr")
  );
}

/** The moves currently recorded in the holder's Library (oldest → newest). */
export function getRecordedMoves(holder: Pokemon): MoveId[] {
  return getState(holder).entries.map(e => e.moveId);
}

/** Shared cast PP remaining for the holder this battle. */
export function getLibraryCastPp(holder: Pokemon): number {
  return getState(holder).castPpRemaining;
}

/**
 * Record `move` into `holder`'s Library (evicting the oldest beyond
 * {@linkcode LIBRARY_MAX_RECORDED}). Skips a foe already recorded this battle.
 */
function recordInto(holder: Pokemon, foe: Pokemon, move: Move): void {
  const state = getState(holder);
  if (state.recordedFoeIds.has(foe.id)) {
    return;
  }
  state.recordedFoeIds.add(foe.id);
  state.entries.push({ moveId: move.id, recordedTurnKey: turnKey() });
  if (state.entries.length > LIBRARY_MAX_RECORDED) {
    state.entries.shift();
  }
}

/**
 * Driven from `MovePhase.start` for a genuine (non-virtual) move use by `user`:
 * for each active opposing Library holder, record `user`'s FIRST move.
 */
export function erLibraryRecordFoeMove(user: Pokemon, move: Move): void {
  for (const holder of user.getOpponents()) {
    if (hasLibrary(holder)) {
      recordInto(holder, user, move);
    }
  }
}

/**
 * The Library damage multiplier applied when `defender` (on a Library holder's
 * side) is hit by a move recorded in that holder's Library on an EARLIER turn.
 * Returns {@linkcode LIBRARY_DAMPENER} (0.85) for such a repeated use, else 1.
 */
export function erLibraryDamageMultiplier(defender: Pokemon, move: Move): number {
  const now = turnKey();
  const sideMons = [defender, ...defender.getAllies()];
  for (const mon of sideMons) {
    if (!mon || !hasLibrary(mon)) {
      continue;
    }
    const entry = LIBRARY_STATE.get(mon)?.entries.find(e => e.moveId === move.id);
    if (entry && entry.recordedTurnKey !== now) {
      return LIBRARY_DAMPENER;
    }
  }
  return 1;
}

/** Whether the holder can currently cast (has recorded moves and shared PP left). */
export function canCastLibrary(holder: Pokemon): boolean {
  const state = getState(holder);
  return state.entries.length > 0 && state.castPpRemaining > 0;
}

/**
 * Mark `moveId` as being cast by `holder` this turn and consume one shared cast
 * PP. Returns `false` (no charge spent) when no PP remains.
 */
export function commitLibraryCast(holder: Pokemon, moveId: MoveId): boolean {
  const state = getState(holder);
  if (state.castPpRemaining <= 0) {
    return false;
  }
  state.castPpRemaining -= 1;
  state.pendingCast = { moveId, turnKey: turnKey() };
  return true;
}

/**
 * Whether `source`'s current use of `move` is a Library cast that should be
 * computed as SPECIAL (damaging casts use the holder's Sp.Atk vs Sp.Def). Read
 * from the damage calc. Consumes nothing — the marker clears on wave change.
 */
export function erLibraryCastIsSpecial(source: Pokemon, move: Move): boolean {
  if (move.category === MoveCategory.STATUS) {
    return false;
  }
  const state = LIBRARY_STATE.get(source);
  const pending = state?.pendingCast;
  return pending?.moveId === move.id && pending.turnKey === turnKey() && state?.wave === currentWave();
}

/** Test/inspection helper: reset a holder's Library state (isolate scenarios). */
export function resetLibraryState(holder: Pokemon): void {
  LIBRARY_STATE.delete(holder);
}
