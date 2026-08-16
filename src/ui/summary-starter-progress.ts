/*
 * SPDX-FileCopyrightText: 2024-2026 Pagefault Games
 *
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import type { StarterData, StarterDataEntry } from "#types/save-data";

export interface SummaryStarterProgress {
  root: StarterDataEntry | undefined;
  trueRoot: StarterDataEntry | undefined;
  current: StarterDataEntry | undefined;
}

export function resolveSummaryStarterProgress(
  starterData: Partial<StarterData>,
  rootSpeciesId: number,
  trueRootSpeciesId: number,
): SummaryStarterProgress {
  const root = starterData[rootSpeciesId] ?? starterData[trueRootSpeciesId];
  const trueRoot = starterData[trueRootSpeciesId] ?? root;
  return { root, trueRoot, current: root ?? trueRoot };
}
