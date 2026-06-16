/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER #439 - run-scoped BUFF CATALOGUE, increment 1: the pure data substrate for
// temporary run-wide buffs (the layer events like the Great Forge / Caldera /
// Buried City / full Aurora talk to). NO UI and NO scene dependency - module-level
// state, reset per run, so it is unit testable and can't break the run flow.
//
// A buff carries a KIND (what it modifies), a signed MAGNITUDE (how much, read by
// the consuming system - e.g. a money buff of +0.5 means "+50% money"), and a
// duration in waves (null = whole run). Buffs are keyed by sourceKey so a source
// re-granting REFRESHES its buff instead of stacking duplicates. getBuffBonus()
// sums the magnitudes of all active buffs of a kind for the consumer to apply.
//
// Later increments: tick the durations each wave, persist on save, wire the
// consuming systems (money / stats / shiny luck), and the events that grant them.
// =============================================================================

/** What a run buff modifies. The consuming system decides how to apply the bonus. */
export type ErBuffKind =
  | "atk" // team Attack: apply as a (1 + bonus) multiplier
  | "def" // team Defense
  | "spa" // team Sp. Atk
  | "spd" // team Sp. Def
  | "spe" // team Speed
  | "money" // money gained: (1 + bonus) multiplier
  | "expGain" // EXP gained: (1 + bonus) multiplier
  | "shinyLuck"; // flat luck added to shiny rolls

/** A single active run buff. JSON-safe (all primitives) so it persists trivially. */
export interface ErRunBuff {
  /** Stable identifier of the buff's source (event id). Re-granting refreshes it. */
  sourceKey: string;
  /** Short player-facing label (English-only; ER custom strings are English). */
  label: string;
  /** What the buff modifies. */
  kind: ErBuffKind;
  /** Signed magnitude, read by the consuming system (e.g. +0.5 = +50%). */
  magnitude: number;
  /** Waves of run remaining, or null for a whole-run buff. */
  wavesLeft: number | null;
}

let runBuffs: ErRunBuff[] = [];

/** Clear all run buffs. Called once at run start (alongside the other ER resets). */
export function resetErRunBuffs(): void {
  runBuffs = [];
}

/**
 * Grant (or refresh) a run buff. If a buff with the same sourceKey already exists
 * it is replaced - sources refresh their own buff rather than stacking duplicates.
 * A non-positive wavesLeft (and not null) is treated as "already expired" and the
 * buff is dropped.
 */
export function grantErRunBuff(buff: ErRunBuff): void {
  const next = runBuffs.filter(b => b.sourceKey !== buff.sourceKey);
  if (buff.wavesLeft == null || buff.wavesLeft > 0) {
    next.push({ ...buff });
  }
  runBuffs = next;
}

/** The active run buffs (read-only snapshot for the overlay / consumers). */
export function getErRunBuffs(): readonly ErRunBuff[] {
  return runBuffs;
}

/** True if any run buff is active (drives whether an indicator has content). */
export function hasErRunBuffs(): boolean {
  return runBuffs.length > 0;
}

/** Sum the magnitudes of every active buff of a kind (0 if none). */
export function getErBuffBonus(kind: ErBuffKind): number {
  let total = 0;
  for (const buff of runBuffs) {
    if (buff.kind === kind) {
      total += buff.magnitude;
    }
  }
  return total;
}

/**
 * Advance all timed buffs by one wave: decrement wavesLeft (whole-run buffs with
 * a null duration are untouched) and drop any that hit 0. Returns the number of
 * buffs that expired this tick.
 */
export function tickErRunBuffs(): number {
  let expired = 0;
  runBuffs = runBuffs.filter(buff => {
    if (buff.wavesLeft == null) {
      return true;
    }
    buff.wavesLeft -= 1;
    if (buff.wavesLeft <= 0) {
      expired += 1;
      return false;
    }
    return true;
  });
  return expired;
}

// --- Session persistence ----------------------------------------------------

/** A serializable snapshot of the run's buffs for the session save. */
export interface ErRunBuffSaveData {
  buffs: ErRunBuff[];
}

/** Snapshot the active run buffs for the session save. */
export function getErRunBuffSaveData(): ErRunBuffSaveData {
  return { buffs: runBuffs.map(b => ({ ...b })) };
}

/**
 * Restore run buffs from a session save. Tolerant of undefined (older saves) and
 * of malformed payloads - unusable entries are dropped, never thrown. Always
 * resets first so a reload can't accumulate stale buffs.
 */
export function restoreErRunBuffState(data: ErRunBuffSaveData | undefined | null): void {
  resetErRunBuffs();
  if (!data || !Array.isArray(data.buffs)) {
    return;
  }
  for (const buff of data.buffs) {
    if (
      buff != null &&
      typeof buff.sourceKey === "string" &&
      typeof buff.kind === "string" &&
      typeof buff.magnitude === "number"
    ) {
      runBuffs.push({
        sourceKey: buff.sourceKey,
        label: typeof buff.label === "string" ? buff.label : buff.sourceKey,
        kind: buff.kind,
        magnitude: buff.magnitude,
        wavesLeft: typeof buff.wavesLeft === "number" ? buff.wavesLeft : null,
      });
    }
  }
}
