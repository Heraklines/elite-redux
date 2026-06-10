/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// ER money streak (#348).
//
// Every party Pokémon tracks a streak of consecutive FAINT-FREE waves. Each
// full 3 waves of streak grants that mon +1% to wave money rewards, capped at
// +10% per mon — a full team of six at max streak yields +60%. A faint resets
// that mon's streak to zero (revives don't restore it: the wave it fainted in
// still counts as broken).
//
// Wiring:
//   - FaintPhase           → recordErStreakFaint(pokemon)   (player mons)
//   - BattleEndPhase (win) → advanceErMoneyStreaks()        (alive mons +1)
//   - getWaveMoneyAmount   → ×(1 + erTeamMoneyBonusPercent()/100)
//   - Summary screen       → mini-badge "₽ +N%" when a mon's bonus > 0
//   - Session save/load    → getErMoneyStreakEntries / restoreErMoneyStreaks
// =============================================================================

import { globalScene } from "#app/global-scene";
import type { Pokemon } from "#field/pokemon";

/** Per-mon streak bonus cap (%): 10 → a 6-mon team caps at 60%. */
const PER_MON_CAP_PCT = 10;
/** Faint-free waves required per +1%. */
const WAVES_PER_PERCENT = 3;

/** pokemonId → consecutive faint-free waves. */
let STREAKS = new Map<number, number>();
/** pokemonIds that fainted during the CURRENT wave (streak broken). */
const FAINTED_THIS_WAVE = new Set<number>();

/** Reset all streak state (new run start). */
export function resetErMoneyStreaks(): void {
  STREAKS = new Map();
  FAINTED_THIS_WAVE.clear();
}

/** Record a faint — breaks the mon's streak for this wave and resets it. */
export function recordErStreakFaint(pokemon: Pokemon): void {
  if (!pokemon.isPlayer()) {
    return;
  }
  FAINTED_THIS_WAVE.add(pokemon.id);
  STREAKS.set(pokemon.id, 0);
}

/**
 * Advance streaks at the end of a WON wave: every party mon that did not
 * faint during the wave gains +1; fainted mons stay at 0. Call once per
 * victorious battle (BattleEndPhase).
 */
export function advanceErMoneyStreaks(): void {
  for (const mon of globalScene.getPlayerParty()) {
    if (FAINTED_THIS_WAVE.has(mon.id) || mon.isFainted()) {
      STREAKS.set(mon.id, 0);
      continue;
    }
    STREAKS.set(mon.id, (STREAKS.get(mon.id) ?? 0) + 1);
  }
  FAINTED_THIS_WAVE.clear();
}

/** This mon's current streak in waves (0 if untracked). */
export function erStreakWaves(pokemonId: number): number {
  return STREAKS.get(pokemonId) ?? 0;
}

/** This mon's current money bonus in percent (0–10). */
export function erStreakBonusPercent(pokemonId: number): number {
  return Math.min(PER_MON_CAP_PCT, Math.floor(erStreakWaves(pokemonId) / WAVES_PER_PERCENT));
}

/** The whole party's current money bonus in percent (0–60). */
export function erTeamMoneyBonusPercent(): number {
  let total = 0;
  try {
    for (const mon of globalScene.getPlayerParty()) {
      total += erStreakBonusPercent(mon.id);
    }
  } catch {
    return 0; // scene not ready (e.g. menu money displays) — no bonus
  }
  return total;
}

/** Serialise for the session save. */
export function getErMoneyStreakEntries(): [number, number][] {
  return [...STREAKS.entries()];
}

/** Restore from a session save (legacy saves: undefined → fresh streaks). */
export function restoreErMoneyStreaks(entries: readonly [number, number][] | undefined): void {
  STREAKS = new Map(entries ?? []);
  FAINTED_THIS_WAVE.clear();
}
