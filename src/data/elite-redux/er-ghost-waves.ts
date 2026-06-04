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

import { type ErDifficulty, getErDifficulty } from "#data/elite-redux/er-run-difficulty";

// Endgame ghost-wave schedule. Chosen to avoid fixed battles (E4 182/184/186/188,
// champion 190, RIVAL_6 195), boss waves (% 10 === 0), x1 waves (% 10 === 1) and
// gym waves (% 30 === 20). Hell reaches a bit earlier (176/178) to fit all 8.
const GHOST_WAVES: Readonly<Record<ErDifficulty, readonly number[]>> = {
  ace: [196],
  elite: [192, 196, 199],
  hell: [176, 178, 192, 193, 194, 196, 197, 199],
};

/** The ordered ghost waves for the current run's difficulty. */
export function ghostWavesForCurrentRun(): readonly number[] {
  return GHOST_WAVES[getErDifficulty()] ?? [];
}

/** Whether `waveIndex` is a ghost-trainer wave for the current difficulty. */
export function isErGhostWave(waveIndex: number): boolean {
  return ghostWavesForCurrentRun().includes(waveIndex);
}
