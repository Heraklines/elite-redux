/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

// =============================================================================
// Elite Redux — ghost-team gauntlet wave schedule (#217).
//
// Pure scheduling, intentionally split from er-ghost-teams.ts (which pulls in
// heavy battle/pokemon modules) so this can be imported/tested in isolation.
// =============================================================================

import { globalScene } from "#app/global-scene";
import { type ErDifficulty, getErDifficulty } from "#data/elite-redux/er-run-difficulty";
import { Challenges } from "#enums/challenges";

// Ghost-wave schedule. Chosen to avoid fixed battles (rivals 8/16/25/42/55/76/
// 95/122/145/195, E4 182/184/186/188, champion 190), boss waves (% 10 === 0),
// x1 waves (% 10 === 1) and gym waves (% 30 === 20).
//
// ER (#364): ghosts used to exist ONLY in the final stretch (176+/192+), so
// almost nobody ever met one — the pool itself was healthy (hundreds of deep
// runs). A few MID-RUN ghost waves now pepper the climb; the endgame gauntlet
// stays dense. Spawning still requires a pool team that reached at least that
// wave, so mid-run ghosts draw from plenty of candidates.
//
// ACE = pure vanilla PokeRogue (#345): NO ghost trainers at all — the ghost
// gauntlet is an Elite/Hell feature.
const GHOST_WAVES: Readonly<Record<ErDifficulty, readonly number[]>> = {
  youngster: [],
  ace: [],
  elite: [87, 137, 163, 192, 196, 199],
  hell: [63, 87, 113, 137, 163, 176, 178, 192, 193, 194, 196, 197, 199],
  mystery: [63, 87, 113, 137, 163, 176, 178, 192, 193, 194, 196, 197, 199],
};

/** The ordered ghost waves for the current run's difficulty. */
export function ghostWavesForCurrentRun(): readonly number[] {
  return GHOST_WAVES[getErDifficulty()] ?? [];
}

/** Whether `waveIndex` is a ghost-trainer wave for the current difficulty. */
export function isErGhostWave(waveIndex: number): boolean {
  return ghostWavesForCurrentRun().includes(waveIndex);
}

/**
 * ER (#422): the Ghost Trainers challenge - EVERY trainer battle fields a
 * ghost team. An explicit player opt-in, so it applies on any difficulty
 * (the per-difficulty schedule above still drives normal runs).
 */
export function isErGhostChallengeActive(): boolean {
  try {
    return (globalScene.gameMode?.challenges ?? []).some(c => c.id === Challenges.GHOST_TRAINERS && c.value > 0);
  } catch {
    return false;
  }
}
