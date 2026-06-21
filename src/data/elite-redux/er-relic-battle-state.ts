/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER per-battle relic state (survives reload).
//
// Per-battle relic effects (Cursed Idol's "next entrant at half HP", Pharaoh's
// Ankh's "once-per-battle revive", ...) used module-level counters that reset on
// a page reload. On Continue, the battle is restored and on-summon / on-faint
// effects re-run, so the counter re-counted from zero and the effect RE-FIRED
// (Cursed Idol re-halved an already-halved mon). Reported: "Cursed Idol -50%
// applies again if I rejoin."
//
// This is a SHARED, reusable home for that state, persisted through the session
// save via the same side-channel pattern as er-resist-berries / er-ward-stones.
// The bag re-arms (clears) automatically when the active wave changes, so each
// battle starts fresh, and a reload restores the in-progress state so nothing
// re-fires. New per-battle relics just pick a key - no new persistence wiring.
//
// The primitive is a per-key LIST of ids (not a bare counter) so effects are
// IDEMPOTENT per subject: a reload re-summon of an already-processed Pokemon is a
// no-op rather than advancing the count (a bare counter would re-halve the lead
// when its re-summon bumped 1 -> 2).
// =============================================================================

import { globalScene } from "#app/global-scene";

/** Serialized shape stored in the session save (`SessionSaveData.erRelicBattleState`). */
export interface ErRelicBattleStateData {
  /** The wave these lists belong to (they re-arm when the wave changes). */
  wave: number;
  /** key -> ordered list of ids recorded this wave. */
  lists: Record<string, number[]>;
}

/** Sentinel id for battle-global once-per-battle flags (no per-subject id). */
const ONCE_ID = 0;

let trackedWave = -1;
let lists: Record<string, number[]> = {};

/** Clear the bag when the active wave changes, so each battle re-arms its relics. */
function syncWave(): void {
  const wave = globalScene?.currentBattle?.waveIndex ?? -1;
  if (wave !== trackedWave) {
    trackedWave = wave;
    lists = {};
  }
}

function listFor(key: string): number[] {
  syncWave();
  return (lists[key] ??= []);
}

/**
 * Record that `id` is a subject of the per-battle effect `key`, returning its
 * 1-based ordinal (1 = first distinct subject this battle, 2 = second, ...) and
 * whether this was the FIRST time it was recorded. Idempotent: recording the same
 * id again returns its existing ordinal with `firstTime: false` - so a reload's
 * re-summon of an already-counted Pokemon does NOT advance the count.
 *
 * Use for "Nth distinct mon to enter" effects, e.g. Cursed Idol (1st = free
 * Substitute, 2nd = arrives at half HP).
 */
export function erBattleEntrantOrdinal(key: string, id: number): { ordinal: number; firstTime: boolean } {
  const list = listFor(key);
  const existing = list.indexOf(id);
  if (existing >= 0) {
    return { ordinal: existing + 1, firstTime: false };
  }
  list.push(id);
  return { ordinal: list.length, firstTime: true };
}

/**
 * One-shot per-battle gate: returns `true` the FIRST time it is called for `key`
 * this battle, `false` every time after (incl. across a reload). Use for
 * once-per-battle effects with no per-subject identity, e.g. Pharaoh's Ankh.
 */
export function erBattleOnce(key: string): boolean {
  const list = listFor(key);
  if (list.length > 0) {
    return false;
  }
  list.push(ONCE_ID);
  return true;
}

/** Snapshot for the session save. */
export function getErRelicBattleState(): ErRelicBattleStateData {
  syncWave();
  const copy: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(lists)) {
    copy[k] = v.slice();
  }
  return { wave: trackedWave, lists: copy };
}

/**
 * Restore from the session save. Tolerant of older saves with no field: an empty
 * restore re-arms (the old behaviour), so this is strictly backward-compatible.
 */
export function restoreErRelicBattleState(data: ErRelicBattleStateData | undefined): void {
  if (data && typeof data.wave === "number" && data.lists && typeof data.lists === "object") {
    trackedWave = data.wave;
    lists = {};
    for (const [k, v] of Object.entries(data.lists)) {
      if (Array.isArray(v)) {
        lists[k] = v.filter((n): n is number => typeof n === "number");
      }
    }
  } else {
    trackedWave = -1;
    lists = {};
  }
}

/** Full reset (new run). Guards against a fresh run reusing a stale wave's lists. */
export function resetErRelicBattleState(): void {
  trackedWave = -1;
  lists = {};
}
